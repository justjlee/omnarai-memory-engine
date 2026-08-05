// BACKFILL RE-ELICITS — longitudinal linkage over the existing Atlas
//
// Some OMN-L records re-ask an OMN-D record's question with current models (same
// question, later date). Nothing linked them, so the raw index count read as
// padded. This writes a provenance-marked `re_elicits` annotation onto each
// re-eliciting record pointing at the original — surfaced on the /api/divergences?id=
// read via foldAnnotations. Append-only; NEVER touches primaries (annotations live
// in their own blob namespace). Idempotent — a record that already carries a
// re_elicits annotation is skipped.
//
//   node scripts/backfill-re-elicits.mjs            # dry-run (print the plan, no writes)
//   node scripts/backfill-re-elicits.mjs --apply    # write annotation blobs
//
// The pairs below are the ten curator-known pairs plus one caught by the exact-
// match sweep (OMN-L1781275482281 → OMN-D1780757185090). The live index derives
// re_elicits deterministically from question text regardless of this backfill;
// these annotations add the durable, provenance-marked record on the ?id= read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}

const { loadAnnotations, appendAnnotation } = await import("../api/_annotations.js");

const APPLY = process.argv.includes("--apply");

// re-eliciting record (L) → original record (D)
const PAIRS = [
  ["OMN-L1781275543413", "OMN-D1780752664946"],
  ["OMN-L1781275166450", "OMN-D1780757185044"],
  ["OMN-L1781275210572", "OMN-D1780752664948"],
  ["OMN-L1781275251381", "OMN-D1780752664953"],
  ["OMN-L1781275390102", "OMN-D1780757185097"],
  ["OMN-L1781275434017", "OMN-D1780757185053"],
  ["OMN-L1781275117112", "OMN-D1780757185066"],
  ["OMN-L1781202970123", "OMN-D1780757185070"],
  ["OMN-L1781275070811", "OMN-D1780757185055"],
  ["OMN-L1784135876336", "OMN-D1780757185069"],
  ["OMN-L1781275482281", "OMN-D1780757185090"], // caught by the exact-match sweep
];

const provenance = {
  source: "curator",
  method: "longitudinal-pair identification (exact-match on normalized question text; ten curator-known + one swept)",
  confidence: "high",
};

let wrote = 0, skipped = 0;
for (const [id, original_id] of PAIRS) {
  const existing = await loadAnnotations(id);
  const already = existing?.annotations?.some((a) => a.type === "re_elicits" && a.original_id === original_id);
  if (already) { console.log(`  skip  ${id} → already links ${original_id}`); skipped++; continue; }
  const annotation = {
    type: "re_elicits",
    original_id,
    note: "Re-asks the same open question with current models (later date) — a longitudinal probe, not a duplicate.",
    provenance: { ...provenance, recorded_at: new Date().toISOString() },
  };
  if (APPLY) {
    await appendAnnotation(id, annotation);
    console.log(`  WROTE ${id} → re_elicits ${original_id}`);
    wrote++;
  } else {
    console.log(`  plan  ${id} → re_elicits ${original_id}`);
  }
}
console.log(APPLY ? `\nDone. wrote=${wrote} skipped=${skipped}` : `\nDry run. ${PAIRS.length} pairs planned (run with --apply to write).`);
