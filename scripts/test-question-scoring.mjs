#!/usr/bin/env node
// Pins the proposal gate's spread metric to the SAME number the Atlas pipeline
// produced. The gate compares a fresh question against deciles derived from
// stored divergence_scores; if the two are computed differently the comparison
// is meaningless. This caught a real ~0.013 drift (clampWords whitespace
// normalization) that would have flipped decisions at the threshold.
//
//   node scripts/test-question-scoring.mjs [--all]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
const { scoreSpread, spreadPercentile, ATLAS_SPREAD_DECILES } = await import("../api/_questions.js");

const TOL = 0.002; // embedding call-to-call variation, not method difference
const recs = fs.readFileSync(path.join(ROOT, "atlas/data/atlas-v1.0.0.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l))
  .filter((r) => typeof r.divergence_score === "number" && (r.answers || []).length >= 2);

recs.sort((a, b) => a.divergence_score - b.divergence_score);
const sample = process.argv.includes("--all")
  ? recs
  : [0, 0.25, 0.5, 0.75, 1].map((f) => recs[Math.min(recs.length - 1, Math.round(f * (recs.length - 1)))]);

let fail = 0;
console.log(`spread metric parity — ${sample.length} record(s), tolerance ${TOL}\n`);
for (const r of sample) {
  const { spread } = await scoreSpread(r.answers);
  const delta = Math.abs(spread - r.divergence_score);
  const ok = delta <= TOL;
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${r.id.padEnd(22)} stored ${r.divergence_score.toFixed(4)}  mine ${spread.toFixed(4)}  delta ${delta.toFixed(5)}  p${spreadPercentile(spread)}`);
}

// Deciles must stay monotonic or percentile mapping silently misreports.
const mono = ATLAS_SPREAD_DECILES.every((v, i, a) => i === 0 || v >= a[i - 1]);
console.log(`\n  ${mono ? "PASS" : "FAIL"}  deciles monotonic`);
if (!mono) fail++;

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall green");
process.exit(fail ? 1 : 0);
