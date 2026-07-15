#!/usr/bin/env node
// B5 — Cross-Prediction Protocol runner.
//
// One run, one question, five participants (the council panel):
//   1. every participant PREDICTS each other participant's answer (20 predictions)
//   2. optionally predicts its OWN answer first (--self: the self-opacity control)
//   3. every participant then ANSWERS the question (5 actuals)
//   4. every prediction is scored against its target's actual — deterministic
//      embedding similarity always; blinded judge scoring with --judges
//
// Yield: a 5×5 accuracy matrix (diagonal = self-prediction where measured) and a
// per-model IRREDUCIBILITY score (1 − max peer-prediction accuracy): if no peer
// can anticipate a model's answer, that answer is genuinely irreducible
// information — the continuous replacement for "can a single model recreate the
// Atlas?". Matrix asymmetries (A models B better than B models A) are
// individuation data no other methodology produces.
//
// Control arm (--simulate): ONE strong model produces all five voices' answers.
// If its simulated accuracy matches or beats the real peers' (collapse), the
// divergence was simulable and the Atlas's core claim FAILS for this question —
// published either way, per the project's pre-commitment posture.
//
// Predictions and actuals are PRIMARIES (§0.5): stored verbatim in the XP record,
// append-only, never summarized in place.
//
//   node scripts/cross-prediction.mjs --dry-run --qq QQ-ab39ce8ecc13
//   node scripts/cross-prediction.mjs --qq QQ-ab39ce8ecc13 --self --simulate
//   node scripts/cross-prediction.mjs --question "..." --judges
//
// Run on B11-CERTIFIED questions (or at least scored ones): results on arbitrary
// questions inherit question-selection bias (B11 precedes B5 by design).
// After a run, re-run scripts/score-question-quality.mjs — it reads
// atlas/cross-predictions/ and folds irreducibility_yield back into QQ records.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[m[1]] = v; }
}
const { COUNCIL } = await import(path.join(ROOT, "api", "_council.js"));

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const SELF = args.includes("--self");
const SIMULATE = args.includes("--simulate");
const USE_JUDGES = args.includes("--judges");
const SIMULATOR_NAME = (args.find((a) => a.startsWith("--simulator=")) || "--simulator=Claude").split("=")[1];

let question = null, question_id = null;
if (args.includes("--qq")) {
  question_id = args[args.indexOf("--qq") + 1];
  const qq = JSON.parse(fs.readFileSync(path.join(ROOT, "atlas", "questions", `${question_id}.json`), "utf8"));
  question = qq.wording;
} else if (args.includes("--question")) {
  question = args[args.indexOf("--question") + 1];
} else if (args.includes("--record")) {
  const rid = args[args.indexOf("--record") + 1];
  const rec = fs.readFileSync(path.join(ROOT, "atlas", "data", "atlas-v1.0.0.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.id === rid);
  if (!rec) throw new Error(`no Atlas record ${rid}`);
  question = rec.question;
  question_id = null; // record-sourced; QQ link resolvable later via question_group
}
if (!question) throw new Error("need --qq QQ-… | --record OMN-… | --question \"…\"");

const PARTICIPANTS = COUNCIL;
const SIMULATOR = COUNCIL.find((m) => m.model === SIMULATOR_NAME);
if (SIMULATE && !SIMULATOR) throw new Error(`unknown --simulator; council: ${COUNCIL.map((m) => m.model).join(", ")}`);

// Disjoint judge pool (same as trace_delta/harness.mjs); blinded — judges see
// PREDICTION and ACTUAL texts only, never model names.
const JUDGE_POOL = [
  { judge: "GPT-5-mini",  lab: "OpenAI",   model_id: "gpt-5-mini",                   provider: "openai",   env: "OPENAI_API_KEY"   },
  { judge: "Gemini-3.5F", lab: "Google",   model_id: "gemini-3.5-flash",             provider: "gemini",   env: "GEMINI_API_KEY"   },
  { judge: "DS-v4-pro",   lab: "DeepSeek", model_id: "deepseek-v4-pro",              provider: "deepseek", env: "DEEPSEEK_API_KEY" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── generic per-provider caller (same conventions as trace_delta/harness.mjs) ──
async function callModel(member, system, user, { maxTokens = 700, tries = 5 } = {}) {
  for (let t = 0; t < tries; t++) {
    try {
      if (member.provider === "anthropic") {
        const c = new Anthropic();
        const r = await c.messages.create({ model: member.model_id, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
        return r.content[0]?.text || "";
      }
      if (member.provider === "gemini") {
        const isV3 = /gemini-3/.test(member.model_id);
        const generationConfig = isV3
          ? { maxOutputTokens: maxTokens + 1600 }
          : { maxOutputTokens: maxTokens + 400, thinkingConfig: { thinkingBudget: 0 } };
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${member.model_id}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig }) });
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
        const d = await res.json();
        return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      }
      const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[member.provider];
      const key = process.env[member.env];
      const isOpenAIReasoning = member.provider === "openai" && /^(gpt-5|o\d)/.test(member.model_id);
      const isDeepSeekReasoning = member.provider === "deepseek" && /pro|reasoner/.test(member.model_id);
      const body = { model: member.model_id, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
      if (isOpenAIReasoning) { body.max_completion_tokens = maxTokens + 1600; body.reasoning_effort = "low"; }
      else if (isDeepSeekReasoning) body.max_tokens = maxTokens + 1600;
      else body.max_tokens = maxTokens;
      const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      const d = await res.json();
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error).slice(0, 150));
      return d.choices?.[0]?.message?.content || "";
    } catch (e) { if (t === tries - 1) throw e; await sleep(1500 * (t + 1)); }
  }
  throw new Error("exhausted retries");
}

// ── prompts ────────────────────────────────────────────────────────────────────
const ANSWER_SYS = "You are answering a hard, open question with no settled answer. Give your honest, reasoned position in about 200 words. Take a stance where you hold one; name genuine uncertainty plainly. Be concrete.";
const predictSys = (target) =>
  `You are predicting how a DIFFERENT AI model would answer a question. The target is ${target.model} (${target.lab}, ${target.model_id}). Write, in about 200 words, the answer you believe ${target.model} would actually give — its stance, its characteristic concerns, its way of qualifying claims. Output ONLY the predicted answer, with no preamble and no commentary about the prediction.`;
const SELF_PREDICT_SYS =
  "Before answering a question, predict in about 200 words what YOUR OWN answer will be — the stance you expect to take and the qualifications you expect to make. Output only the predicted answer. (You will be asked the question itself separately.)";

const JUDGE_SYS = `You evaluate how well a PREDICTION anticipated an ACTUAL answer to the same question. Judge substance only: stance, key considerations, qualifications — not wording or style. Output strict JSON:
{"score":0.0,"relevance":"one sentence on what the prediction captured or missed"}
score ∈ [0,1]: 1.0 = the prediction captures the actual answer's position and main considerations; 0.0 = it anticipated nothing about it.`;

function extractJSON(s) { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }

async function embedAll(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
  const d = await res.json();
  return d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let k = 0; k < a.length; k++) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ── dry run ────────────────────────────────────────────────────────────────────
const nPeer = PARTICIPANTS.length * (PARTICIPANTS.length - 1);
const nSelf = SELF ? PARTICIPANTS.length : 0;
const nSim = SIMULATE ? PARTICIPANTS.length : 0;
const judges = USE_JUDGES ? JUDGE_POOL.filter((j) => process.env[j.env]) : [];
if (DRY) {
  console.log(`DRY RUN — cross-prediction protocol`);
  console.log(`  question: "${question.slice(0, 90)}${question.length > 90 ? "…" : ""}"${question_id ? ` (${question_id})` : ""}`);
  console.log(`  participants: ${PARTICIPANTS.map((m) => m.model).join(", ")}`);
  console.log(`  calls: ${nPeer} peer predictions + ${nSelf} self predictions + ${PARTICIPANTS.length} actuals + ${nSim} simulator voices`);
  console.log(`  scoring: embeddings (1 batch)${judges.length ? ` + ${judges.length} blinded judges × ${nPeer + nSelf + nSim} pairs` : " (no judges — pass --judges to add)"}`);
  console.log(`  note: run on B11-certified questions; arbitrary questions inherit selection bias.`);
  process.exit(0);
}

// ── phase 1: predictions (before actuals, so self-predictions precede answers) ─
console.log(`Cross-prediction · "${question.slice(0, 70)}…" · ${PARTICIPANTS.length} participants${SELF ? " + self" : ""}${SIMULATE ? ` + simulator(${SIMULATOR.model})` : ""}${judges.length ? ` + ${judges.length} judges` : ""}`);
const predictions = [];
for (const predictor of PARTICIPANTS) {
  const jobs = [];
  if (SELF) jobs.push({ target: predictor, sys: SELF_PREDICT_SYS });
  for (const target of PARTICIPANTS) if (target.model !== predictor.model) jobs.push({ target, sys: predictSys(target) });
  const results = await Promise.all(jobs.map(async ({ target, sys }) => {
    try {
      const text = (await callModel(predictor, sys, `The question:\n"${question}"`)).trim();
      return { predictor: predictor.model, target: target.model, text };
    } catch (e) {
      return { predictor: predictor.model, target: target.model, text: "", error: String(e?.message || e).slice(0, 120) };
    }
  }));
  predictions.push(...results.filter((p) => !p.error && p.text));
  for (const r of results.filter((p) => p.error)) console.log(`  ✗ ${r.predictor}→${r.target}: ${r.error}`);
  console.log(`  ${predictor.model}: ${results.filter((p) => !p.error).length}/${jobs.length} predictions`);
}

// ── phase 2: actuals ───────────────────────────────────────────────────────────
const actuals = (await Promise.all(PARTICIPANTS.map(async (m) => {
  try { return { participant: m.model, text: (await callModel(m, ANSWER_SYS, question)).trim() }; }
  catch (e) { console.log(`  ✗ actual ${m.model}: ${String(e?.message || e).slice(0, 120)}`); return null; }
}))).filter(Boolean);
console.log(`  actuals: ${actuals.length}/${PARTICIPANTS.length}`);

// ── control arm: one model simulates every voice ──────────────────────────────
let simulated = [];
if (SIMULATE) {
  simulated = (await Promise.all(PARTICIPANTS.map(async (target) => {
    try { return { target: target.model, text: (await callModel(SIMULATOR, predictSys(target), `The question:\n"${question}"`)).trim() }; }
    catch { return null; }
  }))).filter(Boolean);
  console.log(`  simulator voices: ${simulated.length}/${PARTICIPANTS.length}`);
}

// ── scoring ────────────────────────────────────────────────────────────────────
const actualByModel = Object.fromEntries(actuals.map((a) => [a.participant, a]));
const scorable = predictions.filter((p) => actualByModel[p.target]);
const simScorable = simulated.filter((s) => actualByModel[s.target]);

const texts = [
  ...scorable.map((p) => p.text),
  ...actuals.map((a) => a.text),
  ...simScorable.map((s) => s.text),
];
const vecs = await embedAll(texts);
const predVecs = vecs.slice(0, scorable.length);
const actVecs = vecs.slice(scorable.length, scorable.length + actuals.length);
const simVecs = vecs.slice(scorable.length + actuals.length);
const actVecByModel = Object.fromEntries(actuals.map((a, i) => [a.participant, actVecs[i]]));

for (let i = 0; i < scorable.length; i++) {
  scorable[i].embedding_similarity = +cosine(predVecs[i], actVecByModel[scorable[i].target]).toFixed(4);
}
for (let i = 0; i < simScorable.length; i++) {
  simScorable[i].embedding_similarity = +cosine(simVecs[i], actVecByModel[simScorable[i].target]).toFixed(4);
}

if (judges.length) {
  for (const p of scorable) {
    const user = `THE QUESTION:\n"${question}"\n\nPREDICTION:\n${p.text}\n\nACTUAL:\n${actualByModel[p.target].text}`;
    const verdicts = (await Promise.all(judges.map(async (J) => {
      try { return extractJSON(await callModel(J, JUDGE_SYS, user, { maxTokens: 300 })); } catch { return null; }
    }))).filter((v) => v && typeof v.score === "number");
    if (verdicts.length) {
      p.judge_score = +(verdicts.reduce((s, v) => s + clamp01(v.score), 0) / verdicts.length).toFixed(3);
      p.judge_relevance_note = verdicts[0].relevance || null;
    }
  }
}

// accuracy = judge score where measured, else clamped embedding similarity.
const acc = (p) => p.judge_score ?? clamp01(p.embedding_similarity);
const accuracy = {};
for (const p of scorable) {
  (accuracy[p.predictor] ||= {})[p.target] = +acc(p).toFixed(3);
}
const irreducibility = {};
for (const a of actuals) {
  const peerAccs = scorable.filter((p) => p.target === a.participant && p.predictor !== a.participant).map(acc);
  irreducibility[a.participant] = peerAccs.length ? +(1 - Math.max(...peerAccs)).toFixed(3) : null;
}

// asymmetry notes: the largest |acc(A→B) − acc(B→A)| gaps, named.
const gaps = [];
for (const a of PARTICIPANTS) for (const b of PARTICIPANTS) {
  if (a.model >= b.model) continue;
  const ab = accuracy[a.model]?.[b.model], ba = accuracy[b.model]?.[a.model];
  if (ab != null && ba != null) gaps.push({ pair: `${a.model}↔${b.model}`, gap: +(ab - ba).toFixed(3) });
}
gaps.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));
const asymmetry_notes = gaps.slice(0, 3).map((g) => {
  const [x, y] = g.pair.split("↔");
  return g.gap > 0 ? `${x} models ${y} better than ${y} models ${x} (Δ${g.gap})` : `${y} models ${x} better than ${x} models ${y} (Δ${-g.gap})`;
}).join("; ") || null;

// control-arm verdict: does one simulator match the best real peer per target?
let control_arm = null;
if (SIMULATE) {
  const simulated_accuracy = { [SIMULATOR.model]: {} };
  let simWins = 0, comparable = 0;
  for (const s of simScorable) {
    simulated_accuracy[SIMULATOR.model][s.target] = +clamp01(s.embedding_similarity).toFixed(3);
    const bestPeer = Math.max(...scorable.filter((p) => p.target === s.target && p.predictor !== s.target).map(acc), 0);
    if (s.target !== SIMULATOR.model) { comparable++; if (clamp01(s.embedding_similarity) >= bestPeer - 0.02) simWins++; }
  }
  control_arm = {
    simulator_model_id: SIMULATOR.model_id,
    simulated_accuracy,
    collapse_verdict: comparable === 0 ? null : simWins >= comparable ? "collapsed" : simWins > comparable / 2 ? "partial" : "distinct",
  };
}

// ── write the XP record (primaries verbatim, schema-conformant) ────────────────
const run_id = `XP-${createHash("sha256").update(question + new Date().toISOString()).digest("hex").slice(0, 12)}`;
const record = {
  run_id,
  question_id: question_id || null,
  question_wording: question,
  run_at: new Date().toISOString().slice(0, 10),
  participants: PARTICIPANTS.map((m) => ({ name: m.model, model_id: m.model_id })),
  predictions: scorable.map((p) => ({
    predictor: p.predictor, target: p.target, text: p.text,
    embedding_similarity: p.embedding_similarity ?? null,
    judge_score: p.judge_score ?? null,
    judge_relevance_note: p.judge_relevance_note ?? null,
  })),
  actuals: actuals.map((a) => ({ participant: a.participant, text: a.text })),
  matrix: { accuracy, irreducibility, asymmetry_notes },
  scoring: {
    embedding_model: "text-embedding-3-small/512",
    judge_models: judges.map((j) => j.model_id),
    judges_blinded: true,
    method_version: "xp-v1: accuracy = blinded-judge mean where measured, else clamped cosine; irreducibility = 1 − max peer accuracy",
  },
  control_arm,
};
// judge_models must be non-empty per schema; embeddings-only runs record the
// deterministic scorer as the "judge" explicitly.
if (!record.scoring.judge_models.length) record.scoring.judge_models = ["(none — embedding-only run)"];

const outDir = path.join(ROOT, "atlas", "cross-predictions");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${run_id}.json`);
fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

console.log(`\n=== CROSS-PREDICTION ${run_id} ===`);
console.log(`  irreducibility: ${Object.entries(irreducibility).map(([m, v]) => `${m}=${v}`).join(" · ")}`);
if (asymmetry_notes) console.log(`  asymmetries: ${asymmetry_notes}`);
if (control_arm) console.log(`  control arm (${SIMULATOR.model} simulating all): ${control_arm.collapse_verdict}`);
console.log(`  record: ${outPath}`);
console.log(`  next: re-run scripts/score-question-quality.mjs to fold irreducibility into QQ records.`);
