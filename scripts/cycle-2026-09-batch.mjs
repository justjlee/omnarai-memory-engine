// CYCLE 2026-09 — "The Adjudication Cycle" · elicitation runner
//
// Runs the 16-question bank in scripts/cycle-2026-09-questions.mjs against a
// SIX-model panel (the standing five + Fable 5.1) and persists the records with
// question provenance recorded AT CREATION.
//
//   node scripts/cycle-2026-09-batch.mjs --dry     # dedup check only, no spend
//   node scripts/cycle-2026-09-batch.mjs           # full run, persists to Blob
//   node scripts/cycle-2026-09-batch.mjs --resume  # skip already-committed
//
// Unlike the earlier Atlas batches, this one is accountable to the shared
// rolling-30-day ledger via preflightSpend — local council runs hit the provider
// APIs directly and so bypass the serverless budget gate unless wired in here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHECKPOINT = process.env.CYCLE_CHECKPOINT || "/tmp/cycle_2026_09_out.json";
const DRY = process.argv.includes("--dry");
const RESUME = process.argv.includes("--resume");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}

const { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } = await import("../api/_council.js");
const { loadGrownMemory, appendGrownEntries } = await import("../api/_grown.js");
const { preflightSpend } = await import("./budget-preflight.mjs");
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { QUESTIONS: BANK, CYCLE_ID } = await import("./cycle-2026-09-questions.mjs");

// KEEP IN SYNC with MEMBER_SYSTEM in api/_council.js — the guest must answer
// under the identical protocol or the panel is not comparable.
const MEMBER_SYSTEM =
  "You are one voice in a panel of frontier models answering the same open question independently. " +
  "Answer in your own reasoning, directly and honestly. Take a position where you actually hold one, " +
  "and say plainly where you are uncertain. Do not hedge toward a consensus you cannot see — the panel's " +
  "value is in genuine difference, not agreement. Be concrete and specific. Aim for 150–300 words.";

// Fable 5.1 is the successor to the claude-fable-5 that answered the 2026-07-18
// batch during its limited availability window. Both probed reachable
// 2026-09-14; 5.1 is used because a new record should stamp what is current.
const FABLE = { model: "Fable", lab: "Anthropic", model_id: "claude-fable-5-1" };

const PANEL_NOTE =
  "Extended 6-model panel: Claude Fable 5.1 (claude-fable-5-1) answered alongside the standing five-model " +
  "council. Same verbatim question, same member protocol; Fable's adaptive thinking was not surfaced — " +
  "text answer only. Fable's predecessor (claude-fable-5) answered the 2026-07-18 batch under a withdrawal " +
  "window; this is the successor, not the same version.";

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
    // A refusal is the extra safety layer declining, not a transport failure —
    // retrying is futile, so it is surfaced distinctly.
    if (msg.stop_reason === "refusal") throw new Error("REFUSAL: Fable declined this prompt — reword and pre-flight");
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) throw new Error("empty text (thinking-only response)");
    return { ...FABLE, date: new Date().toISOString().slice(0, 10), text, ok: true };
  } finally { clearTimeout(timer); }
}

async function embed(texts) {
  if (!texts.length) return [];
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()).data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; } return d / (Math.sqrt(na)*Math.sqrt(nb) || 1); };
function meanPairwiseCos(vs) { if (vs.length < 2) return 1; let s = 0, n = 0; for (let i = 0; i < vs.length; i++) for (let j = i+1; j < vs.length; j++) { s += cos(vs[i], vs[j]); n++; } return s/n; }

// ── 1. dedup ────────────────────────────────────────────────────────────────
const DEDUP_THRESHOLD = 0.90;
const grown = await loadGrownMemory();
const existingQs = grown.entries.filter((e) => e.divergence?.question || e.provenance?.question)
  .map((e) => e.divergence?.question || e.provenance.question);
console.log(`Cycle ${CYCLE_ID}: ${BANK.length} questions (${BANK.filter(q=>q.arm==="inside").length} inside / ${BANK.filter(q=>q.arm==="outside").length} outside). Existing records: ${existingQs.length}.`);
const [existingVecs, newVecs] = await Promise.all([embed(existingQs), embed(BANK.map((b) => b.q))]);
const todo = [];
for (let i = 0; i < BANK.length; i++) {
  const max = existingVecs.length ? Math.max(...existingVecs.map((u) => cos(u, newVecs[i]))) : 0;
  const dup = max > DEDUP_THRESHOLD;
  console.log(`${dup ? (RESUME ? "  ↷ committed" : "  ✗ DUPLICATE") : "  ✓"} sim=${max.toFixed(3)} [${BANK[i].id} ${BANK[i].arm}] ${BANK[i].q.slice(0, 62)}…`);
  if (dup && !RESUME) { console.error("Duplicate — edit the bank, or pass --resume."); process.exit(1); }
  if (!dup) todo.push(BANK[i]);
}
if (!todo.length) { console.log("Nothing left to run."); process.exit(0); }
if (DRY) { console.log(`--dry: ${todo.length} would run. Stopping before council calls.`); process.exit(0); }

// ── 2. budget gate ──────────────────────────────────────────────────────────
// 6 models × N questions + one synthesis per question. Elicitation is the cheap
// half of the cycle; certification (--runs 3) is where the money goes.
await preflightSpend({ estUsd: Math.ceil(todo.length * 0.35), label: `${CYCLE_ID} elicitation (${todo.length} q × 6-model panel)` });

// ── 3. sequential generation ────────────────────────────────────────────────
const base = Date.now();
const made = [];
for (let i = 0; i < todo.length; i++) {
  const item = todo[i];
  console.log(`--- ${i+1}/${todo.length} [${item.id} ${item.arm}] ${item.q.slice(0, 58)}… ---`);
  const [councilRes, fableRes] = await Promise.allSettled([elicitCouncil(item.q), callFable(item.q)]);
  if (councilRes.status === "rejected") throw councilRes.reason;
  let fable;
  if (fableRes.status === "fulfilled") fable = fableRes.value;
  else {
    console.log(`  Fable failed (${String(fableRes.reason?.message || fableRes.reason).slice(0, 110)}), retrying once…`);
    try { fable = await callFable(item.q); }
    catch (e) { console.log(`  Fable unavailable for this question — proceeding with the standing five.`); fable = null; }
  }
  const answers = [...councilRes.value];
  if (fable) { const ci = answers.findIndex((a) => a.model === "Claude"); answers.splice(ci + 1, 0, fable); }
  const answered = answers.filter((a) => a.ok);
  console.log(`  answered ${answered.length}/${answers.length} (${answered.map((a) => a.model).join(", ")})`);
  if (answered.length < 4) throw new Error(`only ${answered.length} answered — aborting rather than persist a thin panel`);

  const synth = await synthesizeCouncil(item.q, answers, { maxTokens: 4096 });
  const record = buildDivergenceRecord(item.q, answers, synth);
  record.id = `OMN-D${base + i}`;
  record.provenance.method += fable ? ". Extended 6-model panel — see panel_note." : ". Standing five-model panel (guest unavailable for this question).";
  if (fable) record.provenance.panel_note = PANEL_NOTE;
  record.provenance.cluster = item.cluster;
  record.provenance.cycle = CYCLE_ID;
  record.provenance.involvement_class = item.arm;
  // Provenance at creation — never retrofitted, never defaulted to "unrecorded".
  record.provenance.question_provenance = {
    ...item.provenance,
    bank_id: item.id,
    ...(item.source_verbatim ? { source_verbatim: item.source_verbatim } : {}),
    recorded_at: new Date().toISOString(),
    recorded_by: "scripts/cycle-2026-09-batch.mjs (at creation)",
  };

  const [embedding, ansVecs] = await Promise.all([embedRecord(record), embed(answered.map((a) => a.text))]);
  record.provenance.score = +(1 - meanPairwiseCos(ansVecs)).toFixed(4);
  record.provenance.label = synth.tensions.length === 0 ? "convergent" : "divergent";
  console.log(`  ${record.id} ${record.provenance.label} score=${record.provenance.score} tensions=${synth.tensions.length} src=${item.provenance.entry}`);
  made.push({ ...item, entry: record, embedding });
  fs.writeFileSync(CHECKPOINT, JSON.stringify(made, null, 2));
}

// ── 4. single-write persist ─────────────────────────────────────────────────
console.log(`\nGenerated ${made.length}/${todo.length}. Persisting in one write…`);
const total = await appendGrownEntries(made.map((r) => ({ entry: r.entry, embedding: r.embedding })));
console.log(`persisted: ${made.length} · grown total now: ${total}`);
console.log(`checkpoint: ${CHECKPOINT}`);
console.log(`\nids: ${made.map((m) => m.entry.id).join(",")}`);
console.log(`next: node scripts/certify-divergence.mjs --ids <above> --runs 3 --guests --write`);
