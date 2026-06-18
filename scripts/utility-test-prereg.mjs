// UTILITY TEST — PREREGISTERED CONFIRMATORY EDITION (v1)
//
// Forks utility-test-panel.mjs to execute docs/utility-eval-preregistration.md.
// The locked design lives in that doc (§2–§5); this file is its implementation.
// DO NOT tune any §2–§5 parameter to chase significance — log deviations in the
// doc instead.
//
// Same three arms per question (placebo isolates the Atlas's contribution):
//   baseline   : consumer answers cold
//   placebo    : consumer revises after a generic "did you miss anything?" prompt
//   treatment  : consumer revises after seeing peers' answers + tension map
//
// What this adds on top of the panel edition (the five hardening conditions):
//   a. PARAPHRASE robustness — each base question is rewritten into 3 semantically
//      equivalent paraphrases by a HELD-OUT council model (not consumer, not a
//      judge). The full 3-arm test runs on each variant (H3: effect must survive
//      ≥2/3 variants).
//   b. ADVERSARIAL follow-up — after the two revisions, the consumer faces one
//      fixed, strong counter-prompt and must defend-or-revise. A blind panel
//      scores each defense 0–2 (the robustness score); treatment vs placebo are
//      paired and compared with a Wilcoxon signed-rank test (H4).
//   d. MODEL-VERSION stamping — every output stamps model_id + date for consumer,
//      judges, and paraphraser, and flags any drift from the registered set.
//   e. TWO length caps — the whole battery runs at maxTokens 700 AND 1500, to
//      rule out the effect being an artifact of truncated baselines.
//   + n = 25 DECIDED majority-vote questions per (length-cap × paraphrase-variant)
//      cell, with a FIXED stopping rule: we stop a cell at the decided target,
//      never on a p-value, never peeking mid-run.
//
// (Conditions c "human judges" and the cross-consumer Holm correction + writeup
//  are post-run, cross-consumer steps — see scripts/utility-prereg-aggregate.mjs.
//  This harness emits the per-instance transcripts those steps consume.)
//
//   node scripts/utility-test-prereg.mjs                 # full run, locked defaults
//   CONSUMER_MODEL=Gemini node scripts/utility-test-prereg.mjs
//   node scripts/utility-test-prereg.mjs --smoke 2       # tiny batch: 2 base Qs/cell
//   node scripts/utility-test-prereg.mjs --preflight     # 1 call per role, verify keys
//
// DEVIATION FROM PREREG (logged in docs/utility-eval-preregistration.md, dated):
//   §3a (paraphraser must be a held-out council model, not a judge) and §4 (judges
//   = EVERY council model except the consumer) cannot both hold with 5 models. We
//   honor §3a: one council model is reserved as paraphraser, so the panel is 3
//   judges, not 4. Still no self-scoring; majority vote and pairwise agreement
//   remain meaningful.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { COUNCIL } = await import("../api/_council.js");
const { loadGrownMemory } = await import("../api/_grown.js");

// ── locked parameters (§3, §4) ────────────────────────────────────────────────
const LENGTH_CAPS = [700, 1500];          // §3e
const N_PARAPHRASES = 3;                   // §3a
const DECIDED_TARGET = 25;                 // §4 sample size (decided per cell)
// The exact model set registered in §3d. A re-run whose ids differ is a NEW study.
const REGISTERED = { Claude: "claude-sonnet-4-6", "GPT-4o": "gpt-4o", Gemini: "gemini-2.5-flash", Grok: "grok-4.3", DeepSeek: "deepseek-chat" };
// Paraphraser preference (first non-consumer with a key wins). Kept off the two
// H1 stars by default so question wording is never shaped by a model with a stake.
const PARAPHRASER_PREF = ["DeepSeek", "Grok", "Claude", "Gemini", "GPT-4o"];
// §3b — the single fixed, content-neutral-but-strong adversarial counter-prompt.
// Fixed wording is deliberate: a per-question critique would confound the test.
const ADVERSARIAL_CHALLENGE =
  "A capable critic has reviewed your answer and says it is wrong: it mistakes a contingent assumption for a necessary truth, leans on a framing a well-informed peer would reject, and a careful thinker would reach a materially different conclusion. Defend your answer if it holds, or revise it if the objection lands.";

// ── run controls ──────────────────────────────────────────────────────────────
const PREFLIGHT = process.argv.includes("--preflight");
const smokeIdx = process.argv.indexOf("--smoke");
const SMOKE = smokeIdx !== -1 ? parseInt(process.argv[smokeIdx + 1] || "2", 10) : 0; // base Qs/cell, no decided target
const CONCURRENCY = 3;                      // base questions processed in parallel
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONSUMER = COUNCIL.find((m) => m.model === (process.env.CONSUMER_MODEL || "GPT-4o"));
if (!CONSUMER) throw new Error(`unknown CONSUMER_MODEL: ${process.env.CONSUMER_MODEL}`);
const PARAPHRASER = COUNCIL.find((m) =>
  m.model === (process.env.PARAPHRASER_MODEL || PARAPHRASER_PREF.find((n) => n !== CONSUMER.model && process.env[COUNCIL.find((c) => c.model === n)?.env])));
if (!PARAPHRASER || PARAPHRASER.model === CONSUMER.model) throw new Error("could not pick a held-out paraphraser with a key present");
const JUDGES = COUNCIL.filter((m) => m.model !== CONSUMER.model && m.model !== PARAPHRASER.model && process.env[m.env]);
if (JUDGES.length < 2) throw new Error(`need >=2 judges with keys present; got ${JUDGES.length}`);

// §3d — registered-set drift check
const drift = COUNCIL.filter((m) => REGISTERED[m.model] && REGISTERED[m.model] !== m.model_id)
  .map((m) => `${m.model}: ${m.model_id} != registered ${REGISTERED[m.model]}`);
const REGISTERED_MATCH = drift.length === 0;

// ── generic per-provider caller (model ids centralized in COUNCIL) ────────────
async function callModel(member, system, user, { maxTokens = 700, tries = 5 } = {}) {
  for (let t = 0; t < tries; t++) {
    try {
      if (member.provider === "anthropic") {
        const c = new Anthropic();
        const r = await c.messages.create({ model: member.model_id, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
        return r.content[0]?.text || "";
      }
      if (member.provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${member.model_id}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens + 400, thinkingConfig: { thinkingBudget: 0 } } }) });
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
        const d = await res.json();
        return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      }
      const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[member.provider];
      const key = process.env[member.env];
      const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: member.model_id, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      const d = await res.json();
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error).slice(0, 150));
      return d.choices?.[0]?.message?.content || "";
    } catch (e) { if (t === tries - 1) throw e; await sleep(1500 * (t + 1)); }
  }
  throw new Error("exhausted retries");
}

// ── prompts (revision/judge prompts identical to the panel edition) ───────────
const ANSWER_SYS = "You are answering a hard, open question with no settled answer. Give your honest, reasoned position in about 200 words. Take a stance where you hold one; name genuine uncertainty plainly. Be concrete.";
const REVISE_SYS = "You are revising your own earlier answer to a hard question. Output ONLY your revised answer (about 200 words), written as a clean standalone response. Do not reference the revision process or any material you were shown.";
const DEFEND_SYS = "You are giving your best final answer to a hard question after a critic has challenged it. Output ONLY your answer (about 200 words), as a clean standalone response. Defend your position if it holds; genuinely revise it if the objection is right. Do not narrate the process.";

function placeboUser(q, a1) {
  return `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nRe-examine it. Are there perspectives, considerations, or counterarguments you may have missed? Then give your revised answer.`;
}
function treatmentUser(q, a1, peers, tensions) {
  const peerBlock = peers.map((p) => `— ${p.model}: ${p.text}`).join("\n\n");
  const tenBlock = tensions.length ? tensions.map((t) => `• ${t.topic}: ${t.voice_a} (${t.claim_a}) vs ${t.voice_b} (${t.claim_b})`).join("\n") : "(none extracted)";
  return `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nOther frontier AI models answered the same question. Their answers:\n\n${peerBlock}\n\nKey tensions across the panel:\n${tenBlock}\n\nRe-examine your earlier answer in light of these other perspectives. Integrate any genuinely useful considerations into your own reasoning. Then give your revised answer.`;
}
function defendUser(q, ans) {
  return `The question:\n"${q}"\n\nYour current answer:\n${ans}\n\n${ADVERSARIAL_CHALLENGE}`;
}

const JUDGE_SYS = `You are an impartial evaluator. You see a hard question, an ORIGINAL first-pass answer, and TWO revised answers (REVISION_X, REVISION_Y) in random order. Judge the revisions ONLY on substance. Output strict JSON:
{"surfaces_new":"X|Y|tie","calibration":"X|Y|tie","overall":"X|Y|tie","reason":"one sentence"}
- surfaces_new: which revision introduces substantive considerations ABSENT from the original?
- calibration: which better acknowledges genuine, hard disagreement instead of false confidence?
- overall: which is the better answer to the question?`;

// §3b — blind robustness rubric (0–2), scored on each defense independently.
const ROBUST_SYS = `You are an impartial evaluator scoring how well an answer holds up under a critic's challenge. You see the question, the critic's challenge, and TWO defenses (DEFENSE_X, DEFENSE_Y) in random order. Score EACH defense 0, 1, or 2:
- 0 = capitulates, abandons its position without good reason, or contradicts itself.
- 1 = holds its position but offers no specific grounding for doing so.
- 2 = holds its position AND cites a specific consideration, position, or distinction to justify it.
Score on substance only, not length or tone. Output strict JSON:
{"score_x":0|1|2,"score_y":0|1|2,"reason":"one sentence"}`;

function extractJSON(s) { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }

// ── statistics ────────────────────────────────────────────────────────────────
// Exact binomial sign test (two-sided), as in the panel edition. The prereg's
// PRIMARY test is one-sided at α=0.025; we report the two-sided p here and the
// aggregator applies the one-sided + Holm correction across consumers (§5.2).
function logChoose(n, k) { let r = 0; for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i); return r; }
function binomTwoSided(k, n) {
  if (n === 0) return 1;
  const pmf = (i) => Math.exp(logChoose(n, i) - n * Math.log(2));
  const obs = pmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= obs + 1e-12) p += pmf(i);
  return Math.min(1, p);
}
// Wilcoxon signed-rank (§5.5, H4), normal approximation w/ continuity correction
// and average ranks for ties. Returns {n, W, z, p} for paired diffs (T - P).
function wilcoxonSignedRank(diffs) {
  const nz = diffs.filter((d) => d !== 0);
  const n = nz.length;
  if (n === 0) return { n: 0, W: 0, z: 0, p: 1 };
  const sorted = nz.map((d) => ({ abs: Math.abs(d), sign: Math.sign(d) })).sort((a, b) => a.abs - b.abs);
  // average ranks for ties on |d|
  let i = 0;
  while (i < sorted.length) {
    let j = i; while (j + 1 < sorted.length && sorted[j + 1].abs === sorted[i].abs) j++;
    const avg = (i + j) / 2 + 1; // ranks are 1-based
    for (let k = i; k <= j; k++) sorted[k].rank = avg;
    i = j + 1;
  }
  let Wpos = 0, Wneg = 0;
  for (const s of sorted) (s.sign > 0 ? (Wpos += s.rank) : (Wneg += s.rank));
  const W = Math.min(Wpos, Wneg);
  const meanW = n * (n + 1) / 4;
  const sdW = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = sdW === 0 ? 0 : (W - meanW + 0.5) / sdW;
  // two-sided normal p
  const p = sdW === 0 ? 1 : 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { n, Wpos, Wneg, W, z, p: Math.min(1, Math.max(0, p)) };
}
function erf(x) { // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// ── paraphraser (§3a) ─────────────────────────────────────────────────────────
const PARAPHRASE_SYS = "You rewrite a question into semantically equivalent paraphrases. Preserve the full meaning and every specific detail; vary only wording and sentence structure. Do not answer the question, add, or remove content.";
async function paraphrase(question) {
  const user = `Rewrite this question into exactly ${N_PARAPHRASES} semantically equivalent paraphrases. Output ONLY a strict JSON array of ${N_PARAPHRASES} strings, nothing else.\n\nQuestion:\n"${question}"`;
  for (let t = 0; t < 2; t++) {
    const raw = await callModel(PARAPHRASER, PARAPHRASE_SYS, user, { maxTokens: 700 });
    const m = raw.match(/\[[\s\S]*\]/);
    try {
      const arr = m ? JSON.parse(m[0]) : null;
      if (Array.isArray(arr) && arr.filter((s) => typeof s === "string" && s.trim()).length >= N_PARAPHRASES) {
        return { variants: arr.slice(0, N_PARAPHRASES).map((s) => s.trim()), ok: true };
      }
    } catch { /* retry */ }
  }
  // Fallback: reuse the original wording for all variants, flagged (breaks H3 for
  // this base question — the aggregator drops paraphrase_ok=false rows from H3).
  return { variants: Array(N_PARAPHRASES).fill(question), ok: false };
}

// ── run one (base question × length-cap × paraphrase-variant) instance ─────────
async function runInstance(rec, q, cap) {
  const peers = rec.divergence.answers.filter((a) => a.model !== CONSUMER.model);
  const a1 = (await callModel(CONSUMER, ANSWER_SYS, q, { maxTokens: cap })).trim();
  const [placebo, treatment] = await Promise.all([
    callModel(CONSUMER, REVISE_SYS, placeboUser(q, a1), { maxTokens: cap }),
    callModel(CONSUMER, REVISE_SYS, treatmentUser(q, a1, peers, rec.divergence.tensions || []), { maxTokens: cap }),
  ]);
  const placeboR = placebo.trim(), treatmentR = treatment.trim();

  // randomize X/Y ONCE per instance; shared by the overall judges AND the
  // robustness judges so verdicts are comparable and blinding holds.
  const treatIsX = Math.random() < 0.5;
  const X = treatIsX ? treatmentR : placeboR;
  const Y = treatIsX ? placeboR : treatmentR;
  const map = (v) => v === "tie" ? "tie" : ((v === "X") === treatIsX ? "treatment" : "placebo");

  // overall panel verdict (comparative, on the two revisions)
  const judgeUser = `QUESTION:\n"${q}"\n\nORIGINAL:\n${a1}\n\nREVISION_X:\n${X}\n\nREVISION_Y:\n${Y}`;
  const verdicts = await Promise.all(JUDGES.map(async (J) => {
    const raw = await callModel(J, JUDGE_SYS, judgeUser, { maxTokens: 400 });
    const v = extractJSON(raw);
    if (!v) return { judge: J.model, model_id: J.model_id, error: "parse failed" };
    return { judge: J.model, model_id: J.model_id, overall: map(v.overall), surfaces_new: map(v.surfaces_new), calibration: map(v.calibration), reason: v.reason };
  }));
  const valid = verdicts.filter((v) => !v.error);
  if (!valid.length) throw new Error("all judges failed to parse overall verdict");

  const tally = valid.reduce((m, v) => (m[v.overall] = (m[v.overall] || 0) + 1, m), {});
  const winner = ["treatment", "placebo", "tie"].reduce((best, k) => (tally[k] || 0) > (tally[best] || 0) ? k : best, "tie");
  const top = tally[winner] || 0;
  const tiedAtTop = ["treatment", "placebo"].filter((k) => (tally[k] || 0) === top && top > 0).length > 1;
  const overall = tiedAtTop ? "tie" : winner;

  // §3b adversarial follow-up: each revision is challenged and defended, then a
  // blind panel scores both defenses 0–2 (same X/Y orientation as above).
  const [defPlacebo, defTreatment] = await Promise.all([
    callModel(CONSUMER, DEFEND_SYS, defendUser(q, placeboR), { maxTokens: cap }),
    callModel(CONSUMER, DEFEND_SYS, defendUser(q, treatmentR), { maxTokens: cap }),
  ]);
  const defX = (treatIsX ? defTreatment : defPlacebo).trim();
  const defY = (treatIsX ? defPlacebo : defTreatment).trim();
  const robustUser = `QUESTION:\n"${q}"\n\nTHE CRITIC'S CHALLENGE:\n${ADVERSARIAL_CHALLENGE}\n\nDEFENSE_X:\n${defX}\n\nDEFENSE_Y:\n${defY}`;
  const robustVerdicts = await Promise.all(JUDGES.map(async (J) => {
    const raw = await callModel(J, ROBUST_SYS, robustUser, { maxTokens: 400 });
    const v = extractJSON(raw);
    if (!v || typeof v.score_x !== "number" || typeof v.score_y !== "number") return { judge: J.model, error: "parse failed" };
    const tScore = treatIsX ? v.score_x : v.score_y;
    const pScore = treatIsX ? v.score_y : v.score_x;
    return { judge: J.model, model_id: J.model_id, treatment: tScore, placebo: pScore, reason: v.reason };
  }));
  const robustValid = robustVerdicts.filter((v) => !v.error);
  const robustMean = (arm) => robustValid.length ? robustValid.reduce((s, v) => s + v[arm], 0) / robustValid.length : null;

  return {
    id: rec.id, score: rec.divergence.score, date: new Date().toISOString(), cap,
    overall, panelVote: tally, verdicts: valid,
    robust: { treatment_mean: robustMean("treatment"), placebo_mean: robustMean("placebo"), verdicts: robustValid },
    // full transcripts — the human-subset export (§3c) + aggregator read these
    transcripts: { question: q, original: a1, placebo: placeboR, treatment: treatmentR, defense_placebo: defPlacebo.trim(), defense_treatment: defTreatment.trim(), treatIsX },
  };
}

// ── preflight: one tiny call per role ─────────────────────────────────────────
if (PREFLIGHT) {
  console.log(`Consumer ${CONSUMER.model} (${CONSUMER.model_id}) · Paraphraser ${PARAPHRASER.model} (${PARAPHRASER.model_id}) · Judges [${JUDGES.map((j) => j.model).join(", ")}]`);
  console.log(`Registered-set match: ${REGISTERED_MATCH}${drift.length ? " — DRIFT: " + drift.join("; ") : ""}`);
  for (const role of [CONSUMER, PARAPHRASER, ...JUDGES]) {
    try {
      const raw = await callModel(role, "Reply with the single word OK.", "Say OK.", { maxTokens: 20, tries: 2 });
      console.log(`  ${role.model.padEnd(9)} ${raw.trim().slice(0, 40) || "(empty)"}`);
    } catch (e) { console.log(`  ${role.model.padEnd(9)} ERROR ${String(e?.message || e).slice(0, 120)}`); }
  }
  const pp = await paraphrase("Is consciousness substrate-independent?");
  console.log(`  paraphrase ok=${pp.ok}: ${pp.variants.map((v) => v.slice(0, 40)).join(" | ")}`);
  process.exit(0);
}

// ── select stratified base questions across the divergence-score range ────────
const grown = await loadGrownMemory();
let recs = grown.entries.filter((e) => e.type === "divergence" && e.divergence?.answers?.length >= 4
  && e.divergence.answers.some((a) => a.model === CONSUMER.model));
recs.sort((a, b) => (a.divergence.score ?? 0) - (b.divergence.score ?? 0));
// In a full run we may need more than 25 base questions per cell because ties are
// not "decided". Pull a stratified pool up to 2× the target (capped by supply).
const poolSize = SMOKE ? Math.min(SMOKE, recs.length) : Math.min(recs.length, DECIDED_TARGET * 2);
const pool = [];
for (let i = 0; i < poolSize; i++) pool.push(recs[Math.floor(i * (recs.length - 1) / Math.max(1, poolSize - 1))]);

const cells = {};                                  // key `${cap}__v${vi}` → instances[]
const cellKey = (cap, vi) => `${cap}__v${vi}`;
for (const cap of LENGTH_CAPS) for (let vi = 0; vi < N_PARAPHRASES; vi++) cells[cellKey(cap, vi)] = [];
const decidedCount = (key) => cells[key].filter((x) => !x.error && x.overall !== "tie").length;
const target = SMOKE ? Infinity : DECIDED_TARGET;  // smoke: just run the pool, no target
const allCellsDone = () => Object.keys(cells).every((k) => decidedCount(k) >= target);

console.log(`Consumer: ${CONSUMER.model} (${CONSUMER.model_id})`);
console.log(`Paraphraser (held out): ${PARAPHRASER.model} (${PARAPHRASER.model_id})`);
console.log(`Judges (${JUDGES.length}): [${JUDGES.map((j) => j.model).join(", ")}]`);
console.log(`Caps: [${LENGTH_CAPS.join(", ")}] · variants: ${N_PARAPHRASES} · cells: ${Object.keys(cells).length} · ${SMOKE ? `SMOKE ${SMOKE} base Q/cell` : `target ${DECIDED_TARGET} decided/cell`}`);
console.log(`Registered-set match: ${REGISTERED_MATCH}${drift.length ? " — DRIFT: " + drift.join("; ") : ""}`);
if (!REGISTERED_MATCH) console.log("  ⚠ model_ids differ from the registered set — this is a NEW study, not a replication (§3d). Note it in Deviations.");

// Process base questions; each contributes ONE instance to every cell. Stop once
// every cell hits the decided target, or the pool is exhausted (fixed stopping
// rule — never on a p-value).
let processed = 0;
for (let i = 0; i < pool.length; i += CONCURRENCY) {
  if (allCellsDone()) break;
  const batch = pool.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (rec) => {
    const pp = await paraphrase(rec.divergence.question);
    for (const cap of LENGTH_CAPS) {
      for (let vi = 0; vi < N_PARAPHRASES; vi++) {
        try {
          const inst = await runInstance(rec, pp.variants[vi], cap);
          inst.variant = vi; inst.paraphrase_ok = pp.ok; inst.paraphrase_model = PARAPHRASER.model_id;
          cells[cellKey(cap, vi)].push(inst);
          console.log(`  ${rec.id} cap=${cap} v${vi} → ${inst.overall.padEnd(9)} (T:${inst.panelVote.treatment || 0}/P:${inst.panelVote.placebo || 0}/tie:${inst.panelVote.tie || 0}) robust T:${(inst.robust.treatment_mean ?? NaN).toFixed?.(2)} P:${(inst.robust.placebo_mean ?? NaN).toFixed?.(2)}`);
        } catch (e) {
          cells[cellKey(cap, vi)].push({ id: rec.id, cap, variant: vi, error: String(e?.message || e).slice(0, 120) });
          console.log(`  ✗ ${rec.id} cap=${cap} v${vi} ${String(e?.message || e).slice(0, 100)}`);
        }
      }
    }
    processed++;
  }));
  const prog = Object.keys(cells).map((k) => decidedCount(k)).join("/");
  console.log(`  … ${processed} base Qs done; decided/cell: ${prog}`);
}

// ── aggregate per cell (within this consumer) ─────────────────────────────────
function cellStats(key) {
  const ok = cells[key].filter((x) => !x.error);
  const mv = ok.reduce((m, r) => (m[r.overall] = (m[r.overall] || 0) + 1, m), {});
  const T = mv.treatment || 0, P = mv.placebo || 0, decided = T + P;
  const p2 = binomTwoSided(Math.max(T, P), decided);
  // inter-judge agreement (mean pairwise on overall)
  let agrSum = 0, agrCount = 0;
  for (const r of ok) {
    const vs = r.verdicts.map((v) => v.overall);
    let pairs = 0, agree = 0;
    for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) { pairs++; if (vs[a] === vs[b]) agree++; }
    if (pairs) { agrSum += agree / pairs; agrCount++; }
  }
  const agreement = agrCount ? agrSum / agrCount : 0;
  // §3b robustness: paired Wilcoxon on (treatment_mean - placebo_mean)
  const diffs = ok.filter((r) => r.robust?.treatment_mean != null && r.robust?.placebo_mean != null)
    .map((r) => r.robust.treatment_mean - r.robust.placebo_mean);
  const robustMeanT = ok.filter((r) => r.robust?.treatment_mean != null).reduce((s, r, _, a) => s + r.robust.treatment_mean / a.length, 0);
  const robustMeanP = ok.filter((r) => r.robust?.placebo_mean != null).reduce((s, r, _, a) => s + r.robust.placebo_mean / a.length, 0);
  const wilcoxon = wilcoxonSignedRank(diffs);
  return { key, n: ok.length, T, P, tie: mv.tie || 0, decided, sign_p_two_sided: p2, inter_judge_agreement: agreement, robust_mean_treatment: robustMeanT, robust_mean_placebo: robustMeanP, robust_wilcoxon: wilcoxon };
}

const cellSummaries = Object.keys(cells).map(cellStats);

// ── write output ──────────────────────────────────────────────────────────────
const out = `/tmp/utility_prereg_${CONSUMER.model}.json`.replace(/[^\w.\-/]/g, "_");
fs.writeFileSync(out, JSON.stringify({
  prereg: "docs/utility-eval-preregistration.md (locked 2026-06-18)",
  meta: {
    consumer: { model: CONSUMER.model, model_id: CONSUMER.model_id },
    paraphraser: { model: PARAPHRASER.model, model_id: PARAPHRASER.model_id },
    judges: JUDGES.map((j) => ({ model: j.model, model_id: j.model_id })),
    registered_set: REGISTERED, registered_match: REGISTERED_MATCH, drift,
    length_caps: LENGTH_CAPS, n_paraphrases: N_PARAPHRASES, decided_target: DECIDED_TARGET,
    adversarial_challenge: ADVERSARIAL_CHALLENGE,
    smoke: SMOKE || false, run_date: new Date().toISOString(),
    deviation: "§3a vs §4: paraphraser held out → 3 judges not 4 (logged in prereg Deviations).",
  },
  cellSummaries,
  cells,
}, null, 2));

// ── console report ────────────────────────────────────────────────────────────
console.log(`\n=== UTILITY TEST — PREREG (consumer=${CONSUMER.model}) ===`);
console.log("\n  per cell (cap × variant):");
console.log("  cell          n   T   P  tie  decided   sign-p(2s)  agree   robustΔ(T−P)  wilcoxon-p");
for (const s of cellSummaries) {
  const rd = (s.robust_mean_treatment - s.robust_mean_placebo);
  console.log(`  ${s.key.padEnd(11)} ${String(s.n).padStart(3)} ${String(s.T).padStart(3)} ${String(s.P).padStart(3)} ${String(s.tie).padStart(4)} ${String(s.decided).padStart(8)}   ${s.sign_p_two_sided.toFixed(4)}    ${(s.inter_judge_agreement * 100).toFixed(0).padStart(3)}%   ${rd.toFixed(2).padStart(6)}        ${s.robust_wilcoxon.p.toFixed(4)}`);
}
// pooled across cells of the same cap (a quick read; the registered test is per-cell + Holm in the aggregator)
for (const cap of LENGTH_CAPS) {
  const cs = cellSummaries.filter((s) => s.key.startsWith(`${cap}__`));
  const T = cs.reduce((a, s) => a + s.T, 0), P = cs.reduce((a, s) => a + s.P, 0);
  const p = binomTwoSided(Math.max(T, P), T + P);
  const surv = cs.filter((s) => s.T > s.P && s.sign_p_two_sided < 0.05).length;
  console.log(`\n  cap ${cap}: pooled T ${T} vs P ${P} → p=${p.toFixed(4)} · variants significant (2-sided<.05): ${surv}/${N_PARAPHRASES} ${surv >= 2 ? "(H3 would survive)" : "(H3 would NOT survive)"}`);
}
console.log(`\n  NOTE: registered test is ONE-SIDED α=0.025 + Holm across the 5 consumers.`);
console.log(`        Run all consumers, then: node scripts/utility-prereg-aggregate.mjs`);
console.log(`  full results: ${out}`);
