// Replay the --write step of certify-divergence.mjs from its per-record checkpoint.
//
// WHY: certify-divergence flushes results to atlas/certify-checkpoint.json after
// EVERY record, but persists certification blocks onto the live records in ONE
// patchGrownCertifications call AFTER the whole loop (certify-divergence.mjs,
// `if (WRITE)` near the end). So a host death at record 24 of 25 loses zero
// measurements and ALL persistence — hours of elicitation that never reach the
// store. That is the same shape of loss that hit the Fable batch on 2026-07-18.
//
// This script closes that gap after the fact: it rebuilds the certification
// blocks from the checkpoint and writes them in one call. Cheap insurance —
// re-running the batch instead would cost thousands of model calls.
//
//   node scripts/persist-certifications.mjs --dry
//   node scripts/persist-certifications.mjs
//   node scripts/persist-certifications.mjs atlas/certify-batch-2026-07.json
//
// Idempotent in effect: patchGrownCertifications is additive and moves any prior
// block into the new one's history[], so a re-run does not destroy evidence.
//
// KEEP IN SYNC: certBlock() below mirrors certify-divergence.mjs. If the block
// shape changes there, change it here. The shapes are asserted compatible by
// scripts/test-cert-block-parity.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const CHECKPOINT = path.resolve(ROOT, fileArg || "atlas/certify-checkpoint.json");

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { loadGrownMemory, patchGrownCertifications } = await import("../api/_grown.js");

// Mirror of certify-divergence.mjs certBlock(). K_PARA / T_REROLLS / METHOD are
// read from the checkpoint's meta rather than redeclared, so a replay always
// reports the parameters the RUN actually used, not this script's defaults.
function certBlock(r, meta) {
  return {
    tier: r.certification,
    dri: r.dri != null ? +r.dri.toFixed(3) : null,
    split_persistence: r.split_persistence != null ? +r.split_persistence.toFixed(3) : null,
    between_spread: r.between_spread != null ? +r.between_spread.toFixed(4) : null,
    within_spread: r.within_spread != null ? +r.within_spread.toFixed(4) : null,
    between_floor: r.between_floor ?? null,
    flips: Object.values(r.per_model || {}).flatMap((m) => [m.p2?.label, m.p3?.label]).filter((l) => l === "flipped").length,
    concedes: Object.values(r.per_model || {}).flatMap((m) => [m.p2?.label, m.p3?.label]).filter((l) => l === "conceded").length,
    paraphrase_k: meta?.K_PARA ?? 3,
    rerolls: meta?.T_REROLLS ?? 3,
    method: meta?.method ?? null,
    ...(r.coverage && !r.coverage.complete ? { coverage: r.coverage } : {}),
    certified_at: new Date().toISOString(),
    ...(r.reproducibility ? { reproducibility: r.reproducibility } : {}),
    // Marks a grade that reached the store via replay rather than the run's own
    // final write. The measurements are identical; only the write path differs.
    persisted_via: "persist-certifications.mjs (checkpoint replay)",
  };
}

if (!fs.existsSync(CHECKPOINT)) { console.error(`no checkpoint at ${CHECKPOINT}`); process.exit(1); }
const cp = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
const meta = cp.meta || {};
const results = cp.results || [];
const ok = results.filter((r) => !r.error && r.certification);
const errored = results.filter((r) => r.error);

console.log(`checkpoint: ${CHECKPOINT}`);
console.log(`  method=${meta.method} runs=${meta.runs} done=${meta.done ?? results.length}/${meta.of ?? "?"} chat_calls=${meta.chat_calls ?? "?"}`);
console.log(`  gradeable: ${ok.length} · errored: ${errored.length}`);

const grown = await loadGrownMemory();
const known = new Set(grown.entries.map((e) => e.id));
const missing = ok.filter((r) => !known.has(r.id));
if (missing.length) console.log(`  ⚠ ${missing.length} id(s) not in the store, will be skipped: ${missing.map((r) => r.id).join(", ")}`);

const already = ok.filter((r) => grown.entries.find((e) => e.id === r.id)?.divergence?.certification);
if (already.length) console.log(`  note: ${already.length} record(s) already carry a block — patch moves the prior grade into history[], never discards it.`);

const tally = ok.reduce((a, r) => { a[r.certification] = (a[r.certification] || 0) + 1; return a; }, {});
console.log(`  tiers: ${JSON.stringify(tally)}`);
for (const r of ok) {
  const unc = r.coverage && !r.coverage.complete ? ` UNCOVERED=${(r.coverage.uncovered_voices || []).join(",")}` : "";
  const rep = r.reproducibility ? ` [${r.reproducibility.tiers.join(",")}]` : "";
  console.log(`    ${r.id} ${r.certification}${rep}${unc}`);
}

if (DRY) { console.log("\n--dry: no write."); process.exit(0); }
const certs = Object.fromEntries(ok.filter((r) => known.has(r.id)).map((r) => [r.id, certBlock(r, meta)]));
const n = Object.keys(certs).length;
if (!n) { console.log("\nnothing to write."); process.exit(0); }
console.log(`\npersisting ${n} certification block(s)…`);
const updated = await patchGrownCertifications(certs);
console.log(updated == null
  ? "  ✗ blob write FAILED — records unchanged (check BLOB_READ_WRITE_TOKEN)."
  : `  ✓ ${updated} record(s) now carry a certification block.`);
