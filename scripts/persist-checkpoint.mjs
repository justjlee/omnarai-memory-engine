// Persist a fable-atlas-batch checkpoint that never reached its final write.
//
// fable-atlas-batch.mjs generates all records, checkpointing after each one, then
// persists the whole batch in ONE appendGrownEntries call at the end (single
// load-modify-write is the concurrency-safe primitive — see api/_grown.js). If
// the process dies before that call, every completed record is still on disk in
// the checkpoint and nothing is in the store. This replays that final write.
//
// Used 2026-07-18 when the host process was killed during record 8/8 of set 2:
// seven complete records were recovered from the checkpoint, the eighth was lost
// mid-synthesis and re-run separately.
//
// Idempotent — appendGrownEntries skips ids already present.
//
//   node scripts/persist-checkpoint.mjs <checkpoint.json> --dry
//   node scripts/persist-checkpoint.mjs <checkpoint.json>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry");
const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: node scripts/persist-checkpoint.mjs <checkpoint.json> [--dry]");
  process.exit(1);
}
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { loadGrownMemory, appendGrownEntries } = await import("../api/_grown.js");

const items = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
if (!Array.isArray(items) || !items.length) { console.error("checkpoint is empty or not an array"); process.exit(1); }

// Integrity gate: a half-written record must never be pushed into the store.
const bad = [];
for (const it of items) {
  const e = it?.entry;
  const problems = [];
  if (!e?.id) problems.push("no id");
  if (!e?.provenance?.question) problems.push("no question");
  if (!(e?.provenance?.answers || []).length) problems.push("no answers");
  if (!e?.full_text) problems.push("no full_text");
  if (!Array.isArray(it?.embedding) || it.embedding.length !== 512) problems.push("bad embedding");
  if (problems.length) bad.push({ id: e?.id || "(none)", problems });
}
if (bad.length) {
  console.error("REFUSING — incomplete records in checkpoint:");
  for (const b of bad) console.error(`  ${b.id}: ${b.problems.join(", ")}`);
  process.exit(1);
}

const grown = await loadGrownMemory();
const have = new Set(grown.entries.map((e) => e.id));
const fresh = items.filter((it) => !have.has(it.entry.id));
console.log(`checkpoint: ${items.length} records · already in store: ${items.length - fresh.length} · to write: ${fresh.length}`);
for (const it of fresh) {
  const models = it.entry.provenance.answers.map((a) => a.model);
  console.log(`  ${it.entry.id} [${it.cluster}] score=${it.score} tensions=${it.entry.provenance.tensions.length} models=${models.length} (${models.join(",")})`);
}
if (DRY) { console.log("--dry: no write."); process.exit(0); }
if (!fresh.length) { console.log("nothing to write."); process.exit(0); }

const total = await appendGrownEntries(fresh.map((it) => ({ entry: it.entry, embedding: it.embedding })));
console.log(`\npersisted: ${fresh.length} · grown total now: ${total}`);
