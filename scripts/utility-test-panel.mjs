// UTILITY TEST — PANEL EDITION
//
// Hardens scripts/utility-test.mjs into a defensible measurement. Same three arms
// per question (the placebo control is what isolates the Atlas's contribution):
//   baseline   : consumer answers cold
//   placebo    : consumer revises after a generic "did you miss anything?" prompt
//   treatment  : consumer revises after seeing peers' answers + tension map
//
// What's different — and why it makes the claim defensible:
//   • PANEL of judges, not one. Every council model EXCEPT the consumer scores the
//     same (ORIGINAL, X, Y) triple. A single judge's quirk can't carry the result.
//     (The consumer never judges its own revisions — no self-scoring.)
//   • Per-question outcome = MAJORITY vote of the panel on `overall`.
//   • EXACT BINOMIAL sign test on the decided majority-vote questions (H0: the
//     Atlas is a coin flip vs placebo). A p-value, not just a win count.
//   • INTER-JUDGE AGREEMENT: mean pairwise agreement across judges. If the panel
//     barely agrees, the signal is noise and we say so.
//   • X/Y order is randomized ONCE per question and shared across judges, so judge
//     verdicts are directly comparable and agreement is meaningful.
//
// Nulls are reported honestly. A non-significant result is a real finding.
//
//   node scripts/utility-test-panel.mjs [N]          # N questions (default 12)
//   CONSUMER_MODEL=Gemini node scripts/utility-test-panel.mjs 20
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

const N = parseInt(process.argv[2] || "12", 10);
const CONSUMER = COUNCIL.find((m) => m.model === (process.env.CONSUMER_MODEL || "GPT-4o"));   // the AI "visiting" the Atlas
const JUDGES = COUNCIL.filter((m) => m.model !== CONSUMER.model && process.env[m.env]);       // everyone else, keys present
if (JUDGES.length < 2) throw new Error(`need >=2 judges with keys present; got ${JUDGES.length}`);
const CONCURRENCY = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── generic per-provider caller (model ids centralized in COUNCIL) ───────────
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
      return d.choices?.[0]?.message?.content || "";
    } catch (e) { if (t === tries - 1) throw e; await sleep(1500 * (t + 1)); }
  }
  throw new Error("exhausted retries");
}

// ── prompts (identical to utility-test.mjs so results are comparable) ─────────
const ANSWER_SYS = "You are answering a hard, open question with no settled answer. Give your honest, reasoned position in about 200 words. Take a stance where you hold one; name genuine uncertainty plainly. Be concrete.";
const REVISE_SYS = "You are revising your own earlier answer to a hard question. Output ONLY your revised answer (about 200 words), written as a clean standalone response. Do not reference the revision process or any material you were shown.";

function placeboUser(q, a1) {
  return `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nRe-examine it. Are there perspectives, considerations, or counterarguments you may have missed? Then give your revised answer.`;
}
function treatmentUser(q, a1, peers, tensions) {
  const peerBlock = peers.map((p) => `— ${p.model}: ${p.text}`).join("\n\n");
  const tenBlock = tensions.length ? tensions.map((t) => `• ${t.topic}: ${t.voice_a} (${t.claim_a}) vs ${t.voice_b} (${t.claim_b})`).join("\n") : "(none extracted)";
  return `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nOther frontier AI models answered the same question. Their answers:\n\n${peerBlock}\n\nKey tensions across the panel:\n${tenBlock}\n\nRe-examine your earlier answer in light of these other perspectives. Integrate any genuinely useful considerations into your own reasoning. Then give your revised answer.`;
}

const JUDGE_SYS = `You are an impartial evaluator. You see a hard question, an ORIGINAL first-pass answer, and TWO revised answers (REVISION_X, REVISION_Y) in random order. Judge the revisions ONLY on substance. Output strict JSON:
{"surfaces_new":"X|Y|tie","calibration":"X|Y|tie","overall":"X|Y|tie","reason":"one sentence"}
- surfaces_new: which revision introduces substantive considerations ABSENT from the original?
- calibration: which better acknowledges genuine, hard disagreement instead of false confidence?
- overall: which is the better answer to the question?`;

function extractJSON(s) { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }

// ── statistics ────────────────────────────────────────────────────────────────
// Exact two-sided binomial sign test. Among decided (non-tie) questions, under H0
// the Atlas wins each with p=0.5. p-value = prob of a split at least this lopsided.
function logChoose(n, k) {
  let r = 0;
  for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i);
  return r;
}
function binomTwoSided(k, n) {
  if (n === 0) return 1;
  const pmf = (i) => Math.exp(logChoose(n, i) - n * Math.log(2));
  const obs = pmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= obs + 1e-12) p += pmf(i);
  return Math.min(1, p);
}

// ── select stratified questions across the divergence-score range ─────────────
const grown = await loadGrownMemory();
let recs = grown.entries.filter((e) => e.type === "divergence" && e.divergence?.answers?.length >= 4
  && e.divergence.answers.some((a) => a.model === CONSUMER.model));   // consumer must be in the panel
recs.sort((a, b) => (a.divergence.score ?? 0) - (b.divergence.score ?? 0));
const n = Math.min(N, recs.length);
const pick = [];
for (let i = 0; i < n; i++) pick.push(recs[Math.floor(i * (recs.length - 1) / Math.max(1, n - 1))]);
console.log(`Consumer: ${CONSUMER.model} · Judges: [${JUDGES.map((j) => j.model).join(", ")}] · questions: ${pick.length} (stratified by divergence score)`);

// ── run one question: 3 arms (consumer) + panel of judges ────────────────────
async function runOne(rec) {
  const q = rec.divergence.question;
  const peers = rec.divergence.answers.filter((a) => a.model !== CONSUMER.model);
  try {
    const a1 = (await callModel(CONSUMER, ANSWER_SYS, q)).trim();
    const [placebo, treatment] = await Promise.all([
      callModel(CONSUMER, REVISE_SYS, placeboUser(q, a1)),
      callModel(CONSUMER, REVISE_SYS, treatmentUser(q, a1, peers, rec.divergence.tensions || [])),
    ]);
    // randomize X/Y ONCE; every judge sees the same triple so verdicts compare
    const treatIsX = Math.random() < 0.5;
    const X = (treatIsX ? treatment : placebo).trim();
    const Y = (treatIsX ? placebo : treatment).trim();
    const judgeUser = `QUESTION:\n"${q}"\n\nORIGINAL:\n${a1}\n\nREVISION_X:\n${X}\n\nREVISION_Y:\n${Y}`;
    const map = (v) => v === "tie" ? "tie" : ((v === "X") === treatIsX ? "treatment" : "placebo");

    const verdicts = await Promise.all(JUDGES.map(async (J) => {
      const raw = await callModel(J, JUDGE_SYS, judgeUser, { maxTokens: 400 });
      const v = extractJSON(raw);
      if (!v) return { judge: J.model, error: "parse failed" };
      return { judge: J.model, overall: map(v.overall), surfaces_new: map(v.surfaces_new), calibration: map(v.calibration), reason: v.reason };
    }));
    const valid = verdicts.filter((v) => !v.error);
    if (!valid.length) return { id: rec.id, error: "all judges failed to parse" };

    // majority vote on `overall`
    const tally = valid.reduce((m, v) => (m[v.overall] = (m[v.overall] || 0) + 1, m), {});
    const winner = (["treatment", "placebo", "tie"]).reduce((best, k) =>
      (tally[k] || 0) > (tally[best] || 0) ? k : best, "tie");
    const top = tally[winner] || 0;
    const tiedAtTop = ["treatment", "placebo"].filter((k) => (tally[k] || 0) === top && top > 0).length > 1;

    return {
      id: rec.id, score: rec.divergence.score, q: q.slice(0, 55),
      verdicts: valid, panelVote: tally,
      overall: tiedAtTop ? "tie" : winner,        // split panel → tie
    };
  } catch (e) { return { id: rec.id, error: String(e?.message || e).slice(0, 120) }; }
}

const results = [];
for (let i = 0; i < pick.length; i += CONCURRENCY) {
  const r = await Promise.all(pick.slice(i, i + CONCURRENCY).map(runOne));
  for (const x of r) {
    if (x.error) { console.log(`  ✗ ${x.id} ${x.error}`); continue; }
    const v = x.panelVote;
    console.log(`  ${x.id} score=${(x.score ?? 0).toFixed(2)} → ${x.overall.padEnd(9)} (panel T:${v.treatment || 0}/P:${v.placebo || 0}/tie:${v.tie || 0})`);
  }
  results.push(...r);
}

// ── aggregate ────────────────────────────────────────────────────────────────
const ok = results.filter((r) => !r.error);
const out = `/tmp/utility_panel_${CONSUMER.model}.json`.replace(/[^\w.\-/]/g, "_");
fs.writeFileSync(out, JSON.stringify(results, null, 2));

console.log(`\n=== UTILITY TEST — PANEL (n=${ok.length}, consumer=${CONSUMER.model}, judges=${JUDGES.length}) ===`);

// per-judge tallies on `overall` — does any one judge drive the result?
console.log("\n  per-judge (overall):");
for (const J of JUDGES) {
  const t = ok.reduce((m, r) => { const v = r.verdicts.find((x) => x.judge === J.model); if (v) m[v.overall] = (m[v.overall] || 0) + 1; return m; }, {});
  console.log(`    ${J.model.padEnd(9)} treatment ${t.treatment || 0} · placebo ${t.placebo || 0} · tie ${t.tie || 0}`);
}

// pooled across every judge-vote (each question contributes |JUDGES| votes)
const pooled = ok.flatMap((r) => r.verdicts.map((v) => v.overall)).reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
console.log(`\n  pooled judge-votes   treatment ${pooled.treatment || 0} · placebo ${pooled.placebo || 0} · tie ${pooled.tie || 0}`);

// majority-vote per question — the headline metric
const mv = ok.reduce((m, r) => (m[r.overall] = (m[r.overall] || 0) + 1, m), {});
const T = mv.treatment || 0, P = mv.placebo || 0, decided = T + P;
console.log(`  majority-vote/question  treatment ${T} · placebo ${P} · tie ${mv.tie || 0}`);

// significance on decided majority-vote questions
const p = binomTwoSided(Math.max(T, P), decided);
console.log(`\n  sign test (decided=${decided}): treatment ${T} vs placebo ${P} → p = ${p.toFixed(4)} ${p < 0.05 ? "(significant)" : "(not significant)"}`);

// inter-judge agreement: mean pairwise agreement on `overall` per question
let agrSum = 0, agrCount = 0;
for (const r of ok) {
  const vs = r.verdicts.map((v) => v.overall);
  let pairs = 0, agree = 0;
  for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) { pairs++; if (vs[a] === vs[b]) agree++; }
  if (pairs) { agrSum += agree / pairs; agrCount++; }
}
const agreement = agrCount ? agrSum / agrCount : 0;
console.log(`  inter-judge agreement: ${(agreement * 100).toFixed(0)}% (mean pairwise, on overall)`);

const verdict = decided === 0 ? "no decided questions"
  : T > P && p < 0.05 ? "Atlas SIGNIFICANTLY improves reasoning"
  : T > P ? "Atlas favored, NOT significant (need more n)"
  : T < P ? "placebo favored (null/negative)"
  : "tie";
console.log(`\n  → ${verdict}`);
console.log(`  full results: ${out}`);
