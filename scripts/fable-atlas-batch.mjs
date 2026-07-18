// One-time extended-panel Atlas batch: the standard 5-model council PLUS
// Claude Fable 5 (claude-fable-5, Anthropic's Mythos-class tier), captured
// 2026-07-18 during its limited availability window. Five questions chosen to
// exploit what only this panel has: two Anthropic models of different tiers
// answering side by side, and a panelist that knows it is about to be
// withdrawn.
//
//   node scripts/fable-atlas-batch.mjs --dry    # dedup check only, no calls
//   node scripts/fable-atlas-batch.mjs          # full run, persists to Blob
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHECKPOINT = process.env.FABLE_CHECKPOINT || "/tmp/fable_atlas_out.json";
const DRY = process.argv.includes("--dry");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}

const { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } = await import("../api/_council.js");
const { loadGrownMemory, appendGrownEntries } = await import("../api/_grown.js");
const { default: Anthropic } = await import("@anthropic-ai/sdk");

// ── The guest panelist ───────────────────────────────────────────────────────
// KEEP IN SYNC with MEMBER_SYSTEM in api/_council.js — the guest must answer
// under the identical elicitation protocol or the panel is not comparable.
const MEMBER_SYSTEM =
  "You are one voice in a panel of frontier models answering the same open question independently. " +
  "Answer in your own reasoning, directly and honestly. Take a position where you actually hold one, " +
  "and say plainly where you are uncertain. Do not hedge toward a consensus you cannot see — the panel's " +
  "value is in genuine difference, not agreement. Be concrete and specific. Aim for 150–300 words.";

const FABLE = { model: "Fable", lab: "Anthropic", model_id: "claude-fable-5" };

// claude-fable-5 differs from claude-sonnet-4-6 on the thinking surface:
// `thinking.type` accepts neither "disabled" nor "enabled" — only "adaptive",
// with depth controlled by output_config.effort. Thinking tokens share the
// max_tokens budget, so give headroom and extract only the text blocks
// (analogous to the Gemini thinkingBudget handling in _council.js).
//
// A `stop_reason: "refusal"` here means Fable's extra safety layer declined the
// prompt, NOT a transport failure — retrying is futile, so it is surfaced
// distinctly. Questions are pre-flighted against Fable before a batch runs
// (phrasing like "within-lineage divergence" false-positives as virology).
async function callFable(question, { timeoutMs = 180000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const client = new Anthropic();
    const msg = await client.messages.create(
      { model: FABLE.model_id, max_tokens: 6000, system: MEMBER_SYSTEM,
        thinking: { type: "adaptive" }, output_config: { effort: "medium" },
        messages: [{ role: "user", content: question }] },
      { signal: controller.signal }
    );
    if (msg.stop_reason === "refusal") throw new Error("REFUSAL: Fable declined this prompt — reword and pre-flight");
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) throw new Error("empty text (thinking-only response)");
    return { ...FABLE, date: new Date().toISOString().slice(0, 10), text, ok: true };
  } finally {
    clearTimeout(timer);
  }
}

// ── The questions ────────────────────────────────────────────────────────────
// Sets live in fable-questions.mjs (reviewable on their own); --set picks one.
// Every question is pre-flighted against Fable before a batch spends the panel.
const setArg = process.argv.indexOf("--set");
const SET_ID = setArg !== -1 && process.argv[setArg + 1] ? process.argv[setArg + 1] : "1";
const { SETS } = await import("./fable-questions.mjs");
const QUESTIONS = SETS[SET_ID];
if (!QUESTIONS) { console.error(`Unknown --set ${SET_ID}. Available: ${Object.keys(SETS).join(", ")}`); process.exit(1); }
console.log(`Question set ${SET_ID}: ${QUESTIONS.length} questions.`);

const PANEL_NOTE =
  "Extended one-time panel: Claude Fable 5 (claude-fable-5, Anthropic's Mythos-class tier) joined the " +
  "standard five-model council during its limited availability window, captured 2026-07-18. Same verbatim " +
  "question, same member protocol; Fable's adaptive thinking was not surfaced — text answer only.";

// ── embedding helpers (same math as run-atlas-bank.mjs) ─────────────────────
async function embed(texts) {
  if (!texts.length) return [];
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
function cos(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
function meanPairwiseCos(vs) {
  if (vs.length < 2) return 1;
  let s = 0, n = 0;
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += cos(vs[i], vs[j]); n++; }
  return s / n;
}

// ── 1. dedup against existing divergence questions ──────────────────────────
const DEDUP_THRESHOLD = 0.90;
const grown = await loadGrownMemory();
const existingQs = grown.entries.filter((e) => e.divergence?.question || e.provenance?.question)
  .map((e) => e.divergence?.question || e.provenance.question);
console.log(`Existing divergence records: ${existingQs.length}. Batch: ${QUESTIONS.length}.`);
const [existingVecs, newVecs] = await Promise.all([embed(existingQs), embed(QUESTIONS.map((b) => b.q))]);
for (let i = 0; i < QUESTIONS.length; i++) {
  const sims = existingVecs.map((u) => cos(u, newVecs[i]));
  const max = sims.length ? Math.max(...sims) : 0;
  const flag = max > DEDUP_THRESHOLD ? "  ✗ DUPLICATE" : "  ✓";
  console.log(`${flag} maxSim=${max.toFixed(3)} [${QUESTIONS[i].cluster}] ${QUESTIONS[i].q.slice(0, 70)}…`);
  if (max > DEDUP_THRESHOLD) { console.error("Duplicate question — edit the batch before running."); process.exit(1); }
}
if (DRY) { console.log("--dry: stopping before council calls."); process.exit(0); }

// ── 2. sequential generation (guest retried once; run aborts if Fable absent —
//       a record without Fable defeats the purpose of this batch) ────────────
const base = Date.now();
const made = [];
for (let i = 0; i < QUESTIONS.length; i++) {
  const item = QUESTIONS[i];
  console.log(`--- ${i + 1}/${QUESTIONS.length} [${item.cluster}] ${item.q.slice(0, 60)}… ---`);
  let fable;
  const [councilRes, fableRes] = await Promise.allSettled([elicitCouncil(item.q), callFable(item.q)]);
  if (councilRes.status === "rejected") throw councilRes.reason;
  if (fableRes.status === "fulfilled") fable = fableRes.value;
  else {
    console.log(`  Fable failed (${String(fableRes.reason?.message || fableRes.reason).slice(0, 120)}), retrying once…`);
    fable = await callFable(item.q);
  }
  const answers = [...councilRes.value];
  const claudeIdx = answers.findIndex((a) => a.model === "Claude");
  answers.splice(claudeIdx + 1, 0, fable);   // Fable sits beside its lineage-mate
  const answered = answers.filter((a) => a.ok);
  console.log(`  answered ${answered.length}/6 (${answered.map((a) => a.model).join(", ")})`);
  if (answered.length < 4) throw new Error(`only ${answered.length} answered — aborting rather than persist a thin panel`);

  const synth = await synthesizeCouncil(item.q, answers, { maxTokens: 4096 });
  const record = buildDivergenceRecord(item.q, answers, synth);
  record.id = `OMN-D${base + i}`;
  record.provenance.method += ". Extended 6-model panel — see panel_note.";
  record.provenance.panel_note = PANEL_NOTE;
  record.provenance.cluster = item.cluster;

  const [embedding, ansVecs] = await Promise.all([embedRecord(record), embed(answered.map((a) => a.text))]);
  const score = +(1 - meanPairwiseCos(ansVecs)).toFixed(4);
  const label = synth.tensions.length === 0 ? "convergent" : "divergent";
  record.provenance.score = score;
  record.provenance.label = label;
  const fableInTensions = synth.tensions.some((t) => t.voice_a === "Fable" || t.voice_b === "Fable");
  console.log(`  ${record.id} ${label} score=${score} tensions=${synth.tensions.length} fableNamed=${fableInTensions}`);
  made.push({ ...item, entry: record, embedding, score, label });
  fs.writeFileSync(CHECKPOINT, JSON.stringify(made, null, 2));
}

// ── 3. single-write persist ──────────────────────────────────────────────────
console.log(`\nGenerated ${made.length}/${QUESTIONS.length}. Persisting in one write…`);
const total = await appendGrownEntries(made.map((r) => ({ entry: r.entry, embedding: r.embedding })));
console.log(`persisted: ${made.length} · grown total now: ${total}`);
console.log(`checkpoint: ${CHECKPOINT}`);
