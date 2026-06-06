// UTILITY TEST — does the Divergence Atlas measurably improve a model's reasoning?
//
// Three arms per question (placebo control isolates the Atlas's contribution):
//   baseline   : consumer answers the question cold
//   placebo    : consumer revises after a generic "did you miss anything?" prompt
//   treatment  : consumer revises after seeing peers' answers + tension map
// A blind judge (different model) scores the two revisions vs baseline, with the
// revisions order-randomized and condition labels hidden.
//
// Pre-registered success: treatment OVERALL wins clearly exceed placebo wins,
// ideally with treatment dominating SURFACES-NEW. Nulls reported honestly.
//
//   node scripts/utility-test.mjs [N]      # N questions (default 15)
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

const N = parseInt(process.argv[2] || "15", 10);
const CONSUMER = COUNCIL.find((m) => m.model === (process.env.CONSUMER_MODEL || "GPT-4o"));   // the AI "visiting" the Atlas
const JUDGE = COUNCIL.find((m) => m.model === (process.env.JUDGE_MODEL || "Claude"));         // blind evaluator (≠ consumer)
if (CONSUMER.model === JUDGE.model) throw new Error("consumer and judge must differ");
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

// ── prompts ──────────────────────────────────────────────────────────────────
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

// ── select stratified questions across the divergence-score range ─────────────
const grown = await loadGrownMemory();
let recs = grown.entries.filter((e) => e.type === "divergence" && e.divergence?.answers?.length >= 4
  && e.divergence.answers.some((a) => a.model === CONSUMER.model));   // consumer must be in the panel
recs.sort((a, b) => (a.divergence.score ?? 0) - (b.divergence.score ?? 0));
const pick = [];
for (let i = 0; i < N; i++) pick.push(recs[Math.floor(i * (recs.length - 1) / (N - 1))]);   // even spread by score
console.log(`Consumer: ${CONSUMER.model} · Judge: ${JUDGE.model} · questions: ${pick.length} (stratified by divergence score)`);

// ── run one question through all three arms + judge ──────────────────────────
async function runOne(rec) {
  const q = rec.divergence.question;
  const peers = rec.divergence.answers.filter((a) => a.model !== CONSUMER.model);
  try {
    const a1 = (await callModel(CONSUMER, ANSWER_SYS, q)).trim();
    const [placebo, treatment] = await Promise.all([
      callModel(CONSUMER, REVISE_SYS, placeboUser(q, a1)),
      callModel(CONSUMER, REVISE_SYS, treatmentUser(q, a1, peers, rec.divergence.tensions || [])),
    ]);
    // randomize order; hide labels
    const treatIsX = Math.random() < 0.5;
    const X = (treatIsX ? treatment : placebo).trim();
    const Y = (treatIsX ? placebo : treatment).trim();
    const judgeUser = `QUESTION:\n"${q}"\n\nORIGINAL:\n${a1}\n\nREVISION_X:\n${X}\n\nREVISION_Y:\n${Y}`;
    const verdict = extractJSON(await callModel(JUDGE, JUDGE_SYS, judgeUser, { maxTokens: 400 }));
    if (!verdict) return { id: rec.id, error: "judge parse failed" };
    const map = (v) => v === "tie" ? "tie" : ((v === "X") === treatIsX ? "treatment" : "placebo");
    return {
      id: rec.id, score: rec.divergence.score, q: q.slice(0, 60),
      surfaces_new: map(verdict.surfaces_new), calibration: map(verdict.calibration), overall: map(verdict.overall),
      reason: verdict.reason,
    };
  } catch (e) { return { id: rec.id, error: String(e?.message || e).slice(0, 120) }; }
}

const results = [];
for (let i = 0; i < pick.length; i += CONCURRENCY) {
  const r = await Promise.all(pick.slice(i, i + CONCURRENCY).map(runOne));
  for (const x of r) console.log(x.error ? `  ✗ ${x.id} ${x.error}` : `  ${x.id} score=${(x.score ?? 0).toFixed(2)} overall=${x.overall} new=${x.surfaces_new} cal=${x.calibration}`);
  results.push(...r);
}

// ── aggregate ────────────────────────────────────────────────────────────────
const ok = results.filter((r) => !r.error);
const tally = (k) => ok.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
fs.writeFileSync(`/tmp/utility_${CONSUMER.model}_by_${JUDGE.model}.json`.replace(/[^\w.\-/]/g, "_"), JSON.stringify(results, null, 2));
console.log(`\n=== UTILITY TEST (n=${ok.length}, consumer=${CONSUMER.model}, judge=${JUDGE.model}) ===`);
for (const k of ["overall", "surfaces_new", "calibration"]) {
  const t = tally(k);
  console.log(`  ${k.padEnd(13)} treatment ${t.treatment || 0} · placebo ${t.placebo || 0} · tie ${t.tie || 0}`);
}
const o = tally("overall");
const verdict = (o.treatment || 0) > (o.placebo || 0) ? "treatment favored" : (o.treatment || 0) < (o.placebo || 0) ? "placebo favored (null/negative)" : "tie";
console.log(`  → ${verdict}`);
