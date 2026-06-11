// BUILD LONGITUDINAL CANON — selects the fixed question set that the daily cron
// (api/cron-longitudinal.js) re-asks the council, one per day, days 1..N of each
// month. Each month becomes one EPOCH of frontier-disagreement-over-time — the
// dataset no one else is collecting and nobody can backfill: once gpt-4o or
// gemini-2.5 retires, the record of what it disagreed about is gone.
//
// Selection from the live Atlas: 12 sharpest splits + 4 mid + 4 lowest
// (known-convergent CONTROLS — a divergence time series needs a convergence
// baseline to show the instrument can read "no change" too).
//
// THE CANON IS FROZEN ONCE COMMITTED. Longitudinal value depends on asking the
// SAME questions verbatim every epoch. Refuses to overwrite without --force.
//
//   node scripts/build-longitudinal-canon.mjs [--force]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { loadGrownMemory } = await import("../api/_grown.js");

const OUT = path.join(ROOT, "api", "_canon.js");
if (fs.existsSync(OUT) && !process.argv.includes("--force")) {
  console.error("api/_canon.js exists — the canon is frozen. Use --force only if you intend to break epoch comparability.");
  process.exit(1);
}

const grown = await loadGrownMemory();
const recs = grown.entries
  .filter((e) => e.type === "divergence" && e.divergence?.question && e.divergence?.answers?.length >= 4 && e.divergence.score != null)
  .sort((a, b) => b.divergence.score - a.divergence.score);

const midStart = Math.floor(recs.length / 2) - 2;
const chosen = [
  ...recs.slice(0, 12),
  ...recs.slice(midStart, midStart + 4),
  ...recs.slice(-4),
];
// de-dup by question text, preserve order
const seen = new Set();
const canon = [];
for (const r of chosen) {
  const q = r.divergence.question.trim();
  if (seen.has(q)) continue;
  seen.add(q);
  canon.push({
    canon_id: `LC-${String(canon.length + 1).padStart(2, "0")}`,
    question: q,
    source_record: r.id,
    original_score: r.divergence.score,
  });
}

const banner = `// LONGITUDINAL CANON — FROZEN ${new Date().toISOString().slice(0, 10)}.
// Do not edit, reorder, or reword: epoch-over-epoch comparability depends on the
// council answering the IDENTICAL question each month. Generated once by
// scripts/build-longitudinal-canon.mjs from the live Atlas (12 sharpest splits +
// 4 mid + 4 known-convergent controls). api/cron-longitudinal.js asks question
// (UTC day-of-month − 1) daily; days ${canon.length + 1}–31 are idle.
`;
fs.writeFileSync(OUT, `${banner}export const CANON = ${JSON.stringify(canon, null, 2)};\n`);
console.log(`Froze ${canon.length} canon questions → api/_canon.js`);
for (const c of canon) console.log(`  ${c.canon_id} [${c.original_score.toFixed(2)}] ${c.question.slice(0, 80)}`);
