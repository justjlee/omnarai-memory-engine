// Run the Divergence Atlas question bank: dedup → batched council generation →
// divergence scoring → SINGLE-write persist to the grown Blob. Checkpoints every
// batch so council output is never lost to a write failure.
//
//   node scripts/run-atlas-bank.mjs           # full run (persists)
//   node scripts/run-atlas-bank.mjs --dry     # dedup + report only, no council calls
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHECKPOINT = "/tmp/atlas_bank_out.json";
const DRY = process.argv.includes("--dry");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { BANK } = await import("./atlas-question-bank.mjs");
const { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } = await import("../api/_council.js");
const { loadGrownMemory, appendGrownEntries } = await import("../api/_grown.js");

const DEDUP_THRESHOLD = 0.90;  // cosine on question embeddings
const BATCH = 5;

// ── embedding + similarity helpers ───────────────────────────────────────────
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

// ── 1. dedup against existing records + within the bank ──────────────────────
const grown = await loadGrownMemory();
const existingQs = grown.entries.filter((e) => e.divergence?.question).map((e) => e.divergence.question);
console.log(`Existing divergence records: ${existingQs.length}. Bank: ${BANK.length}.`);
const [existingVecs, bankVecs] = await Promise.all([embed(existingQs), embed(BANK.map((b) => b.q))]);

const accepted = [], acceptedVecs = [];
for (let i = 0; i < BANK.length; i++) {
  const v = bankVecs[i];
  const sims = [...existingVecs, ...acceptedVecs].map((u) => cos(u, v));
  const max = sims.length ? Math.max(...sims) : 0;
  if (max > DEDUP_THRESHOLD) { console.log(`  dedup skip (${max.toFixed(3)}): ${BANK[i].q.slice(0, 64)}…`); continue; }
  accepted.push(BANK[i]); acceptedVecs.push(v);
}
console.log(`After dedup: ${accepted.length} to run (${BANK.length - accepted.length} skipped).`);
if (DRY) { console.log("--dry: stopping before council calls."); process.exit(0); }

// ── 2. batched generation (parallel within batch) ────────────────────────────
async function generate(item, idSeed) {
  try {
    const answers = await elicitCouncil(item.q);
    const answered = answers.filter((a) => a.ok);
    if (answered.length < 2) return { ...item, error: `only ${answered.length} answered` };
    const synth = await synthesizeCouncil(item.q, answers);
    const record = buildDivergenceRecord(item.q, answers, synth);
    record.id = `OMN-D${idSeed}`;
    const [embedding, ansVecs] = await Promise.all([embedRecord(record), embed(answered.map((a) => a.text))]);
    const score = +(1 - meanPairwiseCos(ansVecs)).toFixed(4);   // higher = more divergent
    const label = synth.tensions.length === 0 ? "convergent" : "divergent";
    record.provenance.score = score;
    record.provenance.label = label;
    return { ...item, entry: record, embedding, score, label, tensions: synth.tensions.length, answered: answered.length };
  } catch (e) { return { ...item, error: String(e?.message || e).slice(0, 160) }; }
}

const base = Date.now();
const made = [];
for (let i = 0; i < accepted.length; i += BATCH) {
  const slice = accepted.slice(i, i + BATCH);
  console.log(`--- batch ${i / BATCH + 1}/${Math.ceil(accepted.length / BATCH)} (${slice.length}) ---`);
  const res = await Promise.all(slice.map((it, j) => generate(it, base + i + j)));
  for (const r of res) {
    if (r.error) console.log(`  ERROR [${r.cluster}] ${r.error}: ${r.q.slice(0, 50)}…`);
    else console.log(`  ${r.entry.id} ${r.label} score=${r.score} tensions=${r.tensions} ans=${r.answered}/5 [${r.cluster}]`);
    made.push(r);
  }
  fs.writeFileSync(CHECKPOINT, JSON.stringify(made, null, 2));
}

// ── 3. single-write persist ──────────────────────────────────────────────────
const good = made.filter((r) => !r.error && r.entry);
const items = good.map((r) => ({ entry: r.entry, embedding: r.embedding }));
console.log(`\nGenerated ${good.length}/${accepted.length}. Persisting in one write…`);
const total = await appendGrownEntries(items);

// ── 4. summary ───────────────────────────────────────────────────────────────
const conv = good.filter((r) => r.label === "convergent").length;
const div = good.filter((r) => r.label === "divergent").length;
const scores = good.map((r) => r.score).sort((a, b) => a - b);
const med = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
console.log(`\n=== DONE ===`);
console.log(`persisted: ${good.length} · grown total now: ${total}`);
console.log(`divergent: ${div} · convergent: ${conv}`);
console.log(`divergence score — min ${scores[0]?.toFixed(3)} · median ${med?.toFixed(3)} · max ${scores[scores.length - 1]?.toFixed(3)}`);
const errs = made.filter((r) => r.error);
if (errs.length) console.log(`errors: ${errs.length} (${errs.map((e) => e.cluster).join(", ")})`);
