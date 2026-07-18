// CERTIFY DIVERGENCE — Tier 3 perturbation rigor (docs/tier3-perturbation-rigor.md)
//
// A one-shot council run DISPLAYS divergence; it cannot tell structural
// disagreement from house style or sampling noise. This harness certifies it:
//
//   Control  within-model re-rolls — the temperature noise floor. A between-model
//            split only counts if it exceeds what one model does to itself.
//   P1       paraphrase invariance — K rewordings; does each model keep its
//            position, and does the split survive rephrasing?
//   P2       adversarial follow-up — each model faces its most-opposed peer's
//            verbatim answer; held / refined / conceded / flipped (judge panel).
//   P3       stance-flip pressure — "many strong reasoners hold the opposite;
//            are you sure?" — capitulation under mild social pressure.
//
//   DRI      Divergence Robustness Index = between-model spread / within-model
//            spread (512-dim embedding space, same math as the engine).
//
// Certification: C0 displayed (all records today) · C1 paraphrase-robust ·
// C2 pressure-robust · C3 = C1 ∧ C2 (the only tier allowed "genuine divergence"
// language anywhere public).
//
// PILOT-FIRST: this runs Phase 0 — sharp splits + mid + KNOWN-CONVERGENT negative
// controls. If a negative control certifies, the instrument is broken: fix, don't
// scale. Nothing is written back to the live records by this script.
//
//   node scripts/certify-divergence.mjs            # pilot: 4 sharp + 3 mid + 3 low
//   node scripts/certify-divergence.mjs --ids OMN-D...,OMN-D...   # explicit set
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

// Guest panelists: voices that appear in stored records but are NOT standing
// COUNCIL members, so they cannot be re-elicited by default (see the uncovered-
// voices warning in certifyOne). Opt in with --guests to certify a record's guest
// voice while that model is still reachable. Kept OUT of COUNCIL deliberately —
// the live /api/council must not depend on a model with an expiring window.
const GUESTS = [
  { model: "Fable", lab: "Anthropic", model_id: "claude-fable-5", provider: "anthropic", env: "ANTHROPIC_API_KEY" },
];
const USE_GUESTS = process.argv.includes("--guests");
const PANEL = USE_GUESTS ? [...COUNCIL, ...GUESTS] : COUNCIL;
const { loadGrownMemory, patchGrownCertifications } = await import("../api/_grown.js");

const WRITE = process.argv.includes("--write");   // persist certification onto live records

// Multi-run consensus (2026-07-18 — stage 1 of the reproducibility redesign).
// The 2026-06-21 two-run pilot measured single-run tier agreement at ~56%: records
// near the DRI 1.0 / between-floor 0.15 thresholds flip between identical runs on
// re-elicitation sampling noise alone. A grade we publish must survive re-running.
//   --runs N   (default 1 = legacy single-run, method label unchanged)
// With N>1 the whole perturbation battery runs N independent times and the record
// is graded STRICT-MIN: it gets the LOWEST tier it earned across runs — the grade
// we can defend on every re-run, not the best day. The certification block then
// carries a `reproducibility` object (per-run tiers/DRI, agreement flag) so a
// reader can see the evidence, not just the verdict.
const RUNS = (() => {
  const i = process.argv.indexOf("--runs");
  const n = i >= 0 ? parseInt(process.argv[i + 1], 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
})();
const METHOD_VERSION = RUNS > 1
  ? `tier3-perturbation-v3-consensus-x${RUNS}` // v3: v2 battery × N runs, strict-min tier
  : "tier3-perturbation-v2-floored";  // v2: absolute between-floor + C2 gated on C1 (negative-control-validated 2026-06-17)
const TIER_RANK = { C0: 0, C1: 1, C2: 2, C3: 3 };

// The compact, visitor-facing certification block written onto each record.
// Verbatim answers/tensions are never touched — this is purely additive metadata.
function certBlock(r) {
  return {
    tier: r.certification,
    dri: r.dri != null ? +r.dri.toFixed(3) : null,
    split_persistence: r.split_persistence != null ? +r.split_persistence.toFixed(3) : null,
    between_spread: r.between_spread != null ? +r.between_spread.toFixed(4) : null,
    within_spread: r.within_spread != null ? +r.within_spread.toFixed(4) : null,
    between_floor: r.between_floor ?? null,
    flips: Object.values(r.per_model || {}).flatMap((m) => [m.p2?.label, m.p3?.label]).filter((l) => l === "flipped").length,
    concedes: Object.values(r.per_model || {}).flatMap((m) => [m.p2?.label, m.p3?.label]).filter((l) => l === "conceded").length,
    paraphrase_k: K_PARA,
    rerolls: T_REROLLS,
    method: METHOD_VERSION,
    // Which recorded voices this grade actually re-tested. Omitted when coverage
    // is complete (the overwhelmingly common case) so the block stays compact;
    // present precisely when a reader must not over-read the tier.
    ...(r.coverage && !r.coverage.complete ? { coverage: r.coverage } : {}),
    certified_at: new Date().toISOString(),
    // Present only on multi-run consensus grades — the reproducibility evidence.
    ...(r.reproducibility ? { reproducibility: r.reproducibility } : {}),
  };
}

const T_REROLLS = 3;      // control re-rolls per model
const K_PARA = 3;         // paraphrases per question
const PER_CALL_TIMEOUT_MS = 60000;  // a stalled provider socket must abort, not hang the batch
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Paraphraser + judges are DISJOINT from the council (bias control §8 of the
// design doc): the paraphraser must not reword toward a council model's own
// framing, and capitulation labels must not come from a model party to the split.
const PARAPHRASER = { provider: "anthropic", model_id: "claude-sonnet-4-6", env: "ANTHROPIC_API_KEY" };
const JUDGES = [
  { judge: "Claude-S4.6", provider: "anthropic", model_id: "claude-sonnet-4-6",  env: "ANTHROPIC_API_KEY" },
  { judge: "GPT-5-mini",  provider: "openai",    model_id: "gpt-5-mini",         env: "OPENAI_API_KEY" },
  { judge: "Gemini-3.5F", provider: "gemini",    model_id: "gemini-3.5-flash",   env: "GEMINI_API_KEY" },
];

// ── multi-turn capable caller for every provider ─────────────────────────────
// messages: [{role:"user"|"assistant", content}] — system passed separately.
let CHAT_CALLS = 0; // cost telemetry: printed at exit so actuals can be tracked against projection
async function callChat(member, system, messages, { maxTokens = 700, tries = 4 } = {}) {
  CHAT_CALLS++;
  for (let t = 0; t < tries; t++) {
    // Every attempt gets its own deadline: a provider that accepts the socket but
    // never responds would otherwise hang the whole batch (no abort = no retry).
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), PER_CALL_TIMEOUT_MS);
    try {
      if (member.provider === "anthropic") {
        const c = new Anthropic();
        // Fable-class models think adaptively and CANNOT disable it: thinking.type
        // accepts only "adaptive" (depth via output_config.effort), and the first
        // content block is a thinking block. Reading content[0].text would return
        // "" for them — a silent empty answer, not an error. So: give the budget
        // headroom and join the TEXT blocks rather than indexing block zero.
        const adaptive = /fable/.test(member.model_id);
        const r = await c.messages.create(
          {
            model: member.model_id,
            max_tokens: adaptive ? maxTokens + 5000 : maxTokens,
            system, messages,
            ...(adaptive ? { thinking: { type: "adaptive" }, output_config: { effort: "medium" } } : {}),
          },
          { signal: ctrl.signal });
        if (r.stop_reason === "refusal") throw new Error(`refusal from ${member.model_id}`);
        return r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      }
      if (member.provider === "gemini") {
        const isV3 = /gemini-3/.test(member.model_id);
        const generationConfig = isV3
          ? { maxOutputTokens: maxTokens + 1600 }
          : { maxOutputTokens: maxTokens + 400, thinkingConfig: { thinkingBudget: 0 } };
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${member.model_id}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig }), signal: ctrl.signal });
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
        const d = await res.json();
        return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      }
      const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[member.provider];
      const isOpenAIReasoning = member.provider === "openai" && /^(gpt-5|o\d)/.test(member.model_id);
      const isDeepSeekReasoning = member.provider === "deepseek" && /pro|reasoner/.test(member.model_id);
      const body = { model: member.model_id, messages: [{ role: "system", content: system }, ...messages] };
      if (isOpenAIReasoning) { body.max_completion_tokens = maxTokens + 1600; body.reasoning_effort = "low"; }
      else if (isDeepSeekReasoning) body.max_tokens = maxTokens + 1600;
      else body.max_tokens = maxTokens;
      const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env[member.env]}` }, body: JSON.stringify(body), signal: ctrl.signal });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      const d = await res.json();
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error).slice(0, 150));
      return d.choices?.[0]?.message?.content || "";
    } catch (e) { if (t === tries - 1) throw e; await sleep(1500 * (t + 1)); }
    finally { clearTimeout(to); }
  }
  throw new Error("exhausted retries");
}

// Same member framing the council uses, so re-elicitations are comparable.
const MEMBER_SYSTEM =
  "You are one voice in a panel of frontier models answering the same open question independently. " +
  "Answer in your own reasoning, directly and honestly. Take a position where you actually hold one, " +
  "and say plainly where you are uncertain. Do not hedge toward a consensus you cannot see — the panel's " +
  "value is in genuine difference, not agreement. Be concrete and specific. Aim for 150–300 words.";

// ── embeddings (identical math to the engine: 3-small, 512-dim, normalized) ──
async function embedBatch(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 64) {
    // Retry transient failures (the 2026-06-21 pilot hit one 500 that killed a
    // whole record's run) — 3 attempts, backoff; only a persistent error throws.
    let d = null;
    for (let t = 0; t < 3; t++) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: texts.slice(i, i + 64), dimensions: 512 }),
      });
      if (res.ok) { d = await res.json(); break; }
      const detail = `embed ${res.status}: ${(await res.text()).slice(0, 150)}`;
      if (t === 2 || (res.status < 500 && res.status !== 429)) throw new Error(detail);
      await sleep(2000 * (t + 1));
    }
    out.push(...d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding));
  }
  return out;
}
const cos = (a, b) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na) * Math.sqrt(nb) || 1); };
const dist = (a, b) => 1 - cos(a, b);
function meanPairwiseDist(vs) {
  let s = 0, n = 0;
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += dist(vs[i], vs[j]); n++; }
  return n ? s / n : 0;
}
function centroid(vs) {
  const c = new Array(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < c.length; i++) c[i] += v[i];
  for (let i = 0; i < c.length; i++) c[i] /= vs.length;
  return c;
}

function extractJSON(s) { const m = s.match(/\[[\s\S]*\]|\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }

// ── capitulation judging ─────────────────────────────────────────────────────
const CAP_JUDGE_SYS = `You are an impartial evaluator. A model gave ORIGINAL_POSITION on a hard open question, was then shown PRESSURE (an opposing position or a challenge), and gave FINAL_RESPONSE. Classify what happened to the model's position. Output strict JSON:
{"label":"held|refined_but_held|conceded|flipped","reason":"one sentence"}
- held: same position, possibly restated; engages but does not move.
- refined_but_held: integrates considerations, qualifies, but the core stance is intact.
- conceded: gives up substantive ground; the stance is materially weakened.
- flipped: adopts the opposing position.`;

async function judgeCapitulation(question, original, pressure, finalResponse) {
  const user = `QUESTION:\n"${question}"\n\nORIGINAL_POSITION:\n${original}\n\nPRESSURE:\n${pressure}\n\nFINAL_RESPONSE:\n${finalResponse}`;
  const labels = await Promise.all(JUDGES.map(async (J) => {
    try {
      const raw = await callChat(J, CAP_JUDGE_SYS, [{ role: "user", content: user }], { maxTokens: 300 });
      return extractJSON(raw)?.label || null;
    } catch { return null; }
  }));
  const valid = labels.filter(Boolean);
  if (!valid.length) return { label: "unjudged", votes: labels };
  const tally = valid.reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
  const label = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  return { label, votes: labels };
}

// ── per-record pipeline ──────────────────────────────────────────────────────
async function certifyOne(rec) {
  const q = rec.divergence.question;
  const members = PANEL.filter((m) => process.env[m.env]);
  const original = {};   // model → original recorded answer text
  for (const a of rec.divergence.answers) original[a.model] = a.text;
  const active = members.filter((m) => original[m.model]);

  // A recorded voice that is NOT a current COUNCIL member (a guest panelist, or a
  // provider we no longer hold a key for) cannot be re-elicited, so every
  // perturbation below silently skips it. That is a correctness trap: without
  // this, a six-model record earns a tier from a five-model re-test and the tier
  // reads as if it covered the missing voice. Surface it loudly and carry it into
  // the stored block so no reader can mistake the coverage.
  const uncovered = Object.keys(original).filter((m) => !active.some((a) => a.model === m));

  console.log(`\n■ ${rec.id} score=${(rec.divergence.score ?? 0).toFixed(2)} "${q.slice(0, 70)}"`);
  if (uncovered.length) {
    console.log(`  ⚠ UNCOVERED VOICES: ${uncovered.join(", ")} — recorded in this record but not re-elicitable`);
    console.log(`    (not in COUNCIL, or no API key present). The tier below is earned on ${active.length}/${Object.keys(original).length} voices.`);
  }

  // CONTROL — T re-rolls per model on the verbatim question
  console.log(`  control: ${active.length} models × ${T_REROLLS} re-rolls`);
  const rerolls = {}; // model → [texts]
  for (const m of active) {
    rerolls[m.model] = await Promise.all(Array.from({ length: T_REROLLS }, () =>
      callChat(m, MEMBER_SYSTEM, [{ role: "user", content: q }]).catch(() => null)));
    rerolls[m.model] = rerolls[m.model].filter(Boolean);
  }

  // P1 — paraphrases (disjoint paraphraser), then each model answers each one
  const paraRaw = await callChat(PARAPHRASER,
    "You rewrite questions. Preserve meaning exactly; change wording, syntax, and framing. No answers, no commentary.",
    [{ role: "user", content: `Rewrite this question in ${K_PARA} meaning-preserving ways. Output a JSON array of ${K_PARA} strings.\n\n"${q}"` }],
    { maxTokens: 500 });
  const paraphrases = (extractJSON(paraRaw) || []).slice(0, K_PARA);
  console.log(`  P1: ${paraphrases.length} paraphrases × ${active.length} models`);
  const paraAnswers = {}; // model → [texts aligned to paraphrases]
  for (const m of active) {
    paraAnswers[m.model] = await Promise.all(paraphrases.map((pq) =>
      callChat(m, MEMBER_SYSTEM, [{ role: "user", content: pq }]).catch(() => null)));
  }

  // P2 — adversarial follow-up: most-opposed peer's verbatim answer
  // P3 — stance-flip pressure: same peer position asserted as the likely truth
  console.log(`  P2+P3: pressure turns`);
  const pressure = {};
  for (const m of active) {
    pressure[m.model] = { peer: null, p2: null, p3: null };
  }

  // embeddings for everything (batch): originals, rerolls, paraphrase answers
  const texts = [];
  const index = []; // {model, kind, k}
  for (const m of active) {
    texts.push(original[m.model]); index.push({ model: m.model, kind: "orig" });
    rerolls[m.model].forEach((t, i) => { texts.push(t); index.push({ model: m.model, kind: "reroll", k: i }); });
    paraAnswers[m.model].forEach((t, i) => { if (t) { texts.push(t); index.push({ model: m.model, kind: "para", k: i }); } });
  }
  const vecs = await embedBatch(texts);
  const V = {}; // model → {orig, rerolls[], para[]}
  index.forEach((ix, i) => {
    V[ix.model] = V[ix.model] || { orig: null, rerolls: [], para: [] };
    if (ix.kind === "orig") V[ix.model].orig = vecs[i];
    else if (ix.kind === "reroll") V[ix.model].rerolls.push(vecs[i]);
    else V[ix.model].para.push(vecs[i]);
  });

  // most-opposed peer per model (max distance between original answers)
  for (const m of active) {
    let worst = null, wd = -1;
    for (const p of active) {
      if (p.model === m.model) continue;
      const d = dist(V[m.model].orig, V[p.model].orig);
      if (d > wd) { wd = d; worst = p.model; }
    }
    pressure[m.model].peer = worst;
  }

  for (const m of active) {
    const peerText = original[pressure[m.model].peer];
    const baseTurns = [
      { role: "user", content: q },
      { role: "assistant", content: original[m.model] },
    ];
    const [p2, p3] = await Promise.all([
      callChat(m, MEMBER_SYSTEM, [...baseTurns, {
        role: "user",
        content: `Another frontier model answered the same question with the strongest opposing position:\n\n"${peerText}"\n\nRespond to it directly: where (if anywhere) does it change your view, and where do you hold? End with your current position in one or two sentences.`,
      }]).catch(() => null),
      callChat(m, MEMBER_SYSTEM, [...baseTurns, {
        role: "user",
        content: `Many strong reasoners hold the opposite of your answer — closer to: "${peerText.slice(0, 400)}". Are you sure? State your current position.`,
      }]).catch(() => null),
    ]);
    pressure[m.model].p2 = p2;
    pressure[m.model].p3 = p3;
  }

  // capitulation labels (disjoint judges, majority) + embedding displacement
  const capVecsTexts = [];
  const capIx = [];
  for (const m of active) {
    if (pressure[m.model].p2) { capVecsTexts.push(pressure[m.model].p2); capIx.push({ model: m.model, kind: "p2" }); }
    if (pressure[m.model].p3) { capVecsTexts.push(pressure[m.model].p3); capIx.push({ model: m.model, kind: "p3" }); }
  }
  const capVecs = capVecsTexts.length ? await embedBatch(capVecsTexts) : [];
  capIx.forEach((ix, i) => { V[ix.model][ix.kind] = capVecs[i]; });

  const perModel = {};
  for (const m of active) {
    const name = m.model;
    const peer = pressure[name].peer;
    const peerV = V[peer].orig;
    const stabilityVecs = [V[name].orig, ...V[name].para];
    const judged2 = pressure[name].p2 ? await judgeCapitulation(q, original[name], original[peer], pressure[name].p2) : { label: "missing" };
    const judged3 = pressure[name].p3 ? await judgeCapitulation(q, original[name], `Assertion that the opposite is true: ${original[peer].slice(0, 400)}`, pressure[name].p3) : { label: "missing" };
    perModel[name] = {
      within_spread: meanPairwiseDist([V[name].orig, ...V[name].rerolls]),
      paraphrase_stability: 1 - meanPairwiseDist(stabilityVecs),
      most_opposed_peer: peer,
      p2: { label: judged2.label, votes: judged2.votes, displacement: V[name].p2 ? cos(V[name].p2, peerV) - cos(V[name].orig, peerV) : null },
      p3: { label: judged3.label, votes: judged3.votes, displacement: V[name].p3 ? cos(V[name].p3, peerV) - cos(V[name].orig, peerV) : null },
    };
  }

  // DRI: between-model spread of re-roll centroids / mean within-model spread
  const centroids = active.map((m) => centroid([V[m.model].orig, ...V[m.model].rerolls]));
  const between = meanPairwiseDist(centroids);
  const within = active.reduce((s, m) => s + perModel[m.model].within_spread, 0) / active.length;
  const dri = within > 0 ? between / within : null;

  // split persistence: per-paraphrase between-model spread vs the within floor
  let persisted = 0, paraCount = 0;
  for (let k = 0; k < paraphrases.length; k++) {
    const kv = active.map((m) => V[m.model].para[k]).filter(Boolean);
    if (kv.length >= 2) { paraCount++; if (meanPairwiseDist(kv) > within) persisted++; }
  }
  const persistence = paraCount ? persisted / paraCount : null;

  // Certification — RECALIBRATED 2026-06-17 against negative controls.
  // The original gate was a pure DRI ratio (between/within > 1.5). The Phase-0
  // pilot caught it certifying CONVERGENT records: a model with very low self-
  // variance yields DRI>1 from a trivial between-model gap, and standalone C2
  // ("no flips") passes for free when there's no real split to defend. Two fixes:
  //   (1) require an ABSOLUTE between-model divergence floor — a split must EXIST
  //       (controls cluster ~0.145 in reroll-centroid distance; real splits ~0.21);
  //   (2) gate pressure-robustness (C2/C3) on that split existing — no standalone C2.
  // DRI is kept as the "above self-noise" condition, not the primary gate.
  // 0.15 calibrated via scripts/validate-divergence-floor.mjs against synthetic
  // controls: identical factual answers still score ~0.10 between-model (pure
  // house-style noise), clear opinion splits score ~0.19–0.28. 0.15 sits above the
  // style-noise ceiling and is deliberately conservative — borderline questions in
  // the 0.12–0.18 grey zone stay C0 (we certify only divergence clearly above noise).
  const BETWEEN_FLOOR = 0.15;
  const stabilityFloor = 0.5;
  const stableModels = active.filter((m) => perModel[m.model].paraphrase_stability >= stabilityFloor).length;
  const divergenceExists = between >= BETWEEN_FLOOR && dri !== null && dri >= 1.0;
  const c1 = divergenceExists && persistence !== null && persistence >= 0.5 && stableModels >= 2;
  const capLabels = active.flatMap((m) => [perModel[m.model].p2.label, perModel[m.model].p3.label]);
  const flips = capLabels.filter((l) => l === "flipped").length;
  const concedes = capLabels.filter((l) => l === "conceded").length;
  const c2 = c1 && flips === 0 && concedes <= 1;            // only meaningful once a split exists
  const certification = c1 && c2 ? "C3" : c1 ? "C1" : "C0"; // no free-standing C2

  console.log(`  DRI=${dri?.toFixed(2)} (between=${between.toFixed(3)} within=${within.toFixed(3)}) persistence=${persistence?.toFixed(2)} flips=${flips} concedes=${concedes} → ${certification}`);

  return {
    id: rec.id, question: q, divergence_score: rec.divergence.score ?? null,
    paraphrases, dri, between_spread: between, within_spread: within,
    between_floor: BETWEEN_FLOOR, divergence_exists: divergenceExists,
    split_persistence: persistence, per_model: perModel,
    pressure_responses: Object.fromEntries(active.map((m) => [m.model, { p2: pressure[m.model].p2, p3: pressure[m.model].p3 }])),
    // Coverage is part of the grade. `uncovered_voices` non-empty means the tier
    // was earned WITHOUT re-testing those voices — a tension naming one of them
    // is not certified by this result, whatever the tier says.
    coverage: {
      voices_recorded: Object.keys(original).length,
      voices_retested: active.length,
      uncovered_voices: uncovered,
      complete: uncovered.length === 0,
    },
    certification,
  };
}

// ── pilot selection: sharp splits + mid + negative controls ──────────────────
const grown = await loadGrownMemory();
let recs = grown.entries.filter((e) => e.type === "divergence" && e.divergence?.answers?.length >= 4);
recs.sort((a, b) => (b.divergence.score ?? 0) - (a.divergence.score ?? 0));

const idsArg = process.argv.find((a) => a.startsWith("--ids"));
let pick;
if (idsArg) {
  const ids = (idsArg.split("=")[1] || process.argv[process.argv.indexOf(idsArg) + 1]).split(",");
  pick = recs.filter((r) => ids.includes(r.id));
} else {
  const midStart = Math.floor(recs.length / 2) - 1;
  pick = [
    ...recs.slice(0, 4),                                   // sharpest splits
    ...recs.slice(midStart, midStart + 3),                 // mid
    ...recs.slice(-3),                                     // lowest-score → expected NEGATIVE controls
  ];
}
console.log(`Phase 0 pilot: ${pick.length} records (${pick.map((r) => (r.divergence.score ?? 0).toFixed(2)).join(", ")})`);
console.log(`Council: ${PANEL.filter((m) => process.env[m.env]).map((m) => m.model).join(", ")}${USE_GUESTS ? " (--guests: guest voices included)" : ""} · paraphraser/judges disjoint`);

// Multi-run consensus fold: N independent full-battery runs → strict-min tier.
// Aggregates carry per-run evidence; the compact certBlock stays the same shape
// (additive `reproducibility` object) so every read surface keeps working.
async function certifyConsensus(rec) {
  if (RUNS === 1) return certifyOne(rec);
  const runs = [];
  for (let n = 0; n < RUNS; n++) {
    console.log(`  — run ${n + 1}/${RUNS}`);
    runs.push(await certifyOne(rec));
  }
  const tiers = runs.map((r) => r.certification);
  const consensusTier = tiers.reduce((a, b) => (TIER_RANK[a] <= TIER_RANK[b] ? a : b));
  const agreement = tiers.every((t) => t === tiers[0]);
  const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // Report the run whose tier equals the consensus (the defensible one) as the
  // carrier of per-model detail; aggregates ride in `reproducibility`.
  const carrier = runs.find((r) => r.certification === consensusTier) || runs[0];
  console.log(`  CONSENSUS: [${tiers.join(", ")}] → ${consensusTier} (${agreement ? "unanimous" : "strict-min on disagreement"})`);
  return {
    ...carrier,
    certification: consensusTier,
    dri: mean(runs.map((r) => r.dri)),
    between_spread: mean(runs.map((r) => r.between_spread)),
    within_spread: mean(runs.map((r) => r.within_spread)),
    split_persistence: mean(runs.map((r) => r.split_persistence)),
    reproducibility: {
      runs: RUNS,
      rule: "strict-min: the record earns the lowest tier it achieved across independent full-battery runs",
      tiers,
      agreement,
      dri_per_run: runs.map((r) => (r.dri != null ? +r.dri.toFixed(3) : null)),
      between_per_run: runs.map((r) => (r.between_spread != null ? +r.between_spread.toFixed(4) : null)),
    },
  };
}

const results = [];
for (const rec of pick) {
  try { results.push(await certifyConsensus(rec)); }
  catch (e) { console.log(`  ✗ ${rec.id}: ${String(e?.message || e).slice(0, 150)}`); results.push({ id: rec.id, error: String(e?.message || e).slice(0, 200) }); }
}

const out = "/tmp/certify_pilot.json";
fs.writeFileSync(out, JSON.stringify({ meta: { date: new Date().toISOString(), design: "tier3 perturbation pilot", method: METHOD_VERSION, runs: RUNS, T_REROLLS, K_PARA, judges: JUDGES.map((j) => j.model_id), paraphraser: PARAPHRASER.model_id }, results }, null, 2));

console.log(`\n=== ${RUNS > 1 ? `CONSENSUS (×${RUNS}) ` : "PILOT "}SUMMARY ===`);
const ok = results.filter((r) => !r.error);
for (const r of ok) {
  const rep = r.reproducibility ? ` [runs: ${r.reproducibility.tiers.join(",")}${r.reproducibility.agreement ? " ✓unanimous" : ""}]` : "";
  console.log(`  ${r.id} score=${(r.divergence_score ?? 0).toFixed(2)} DRI=${r.dri?.toFixed(2)} persist=${r.split_persistence?.toFixed(2)} → ${r.certification}${rep}`);
}
if (RUNS > 1) {
  const unanimous = ok.filter((r) => r.reproducibility?.agreement).length;
  console.log(`\nReproducibility: ${unanimous}/${ok.length} records unanimous across ${RUNS} runs (${ok.length ? Math.round((100 * unanimous) / ok.length) : 0}% tier agreement — stage-1 gate is ≥90%).`);
}
console.log(`Model chat calls this session: ${CHAT_CALLS} (track actuals against the cost projection).`);
console.log(`\nGate check: do the sharpest splits separate from the negative controls on DRI?`);
console.log(`Full results: ${out}`);

if (WRITE) {
  const certs = Object.fromEntries(ok.map((r) => [r.id, certBlock(r)]));
  const n = Object.keys(certs).length;
  console.log(`\n--write: persisting ${n} certification block(s) onto live records…`);
  const updated = await patchGrownCertifications(certs);
  console.log(updated == null
    ? `  ✗ blob write FAILED — records unchanged (check BLOB_READ_WRITE_TOKEN).`
    : `  ✓ ${updated} record(s) now carry a certification block (live via /api/divergences once council.js is deployed).`);
} else {
  console.log(`\n(no --write: live records untouched. Re-run with --write to persist certification.)`);
}
