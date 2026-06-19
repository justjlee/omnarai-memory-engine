#!/usr/bin/env node
// backfill-evidence-status.mjs
// -----------------------------------------------------------------------------
// Seeds the SECOND classification axis: `evidence_status`.
//
// Omnarai already carries a `ring` (core / curated / open) — but that is a
// PROJECT-STATUS axis: how central a work is to the canon, not how well-evidenced
// its claims are. An external reviewer (2026-06-19) named the conflation exactly:
// "A foundational philosophical claim might be Core Canon while remaining
//  speculative. Those are not contradictory — but machines need separate fields
//  to understand that."
//
// `evidence_status` is that separate field. It is ORTHOGONAL to `ring`:
//   ring            → how central is this to Omnarai?      (canonical/curated/exploratory)
//   evidence_status → how much weight should a mind put on its claims about the world?
//
// Controlled vocabulary (see public/evidence-status.md for the canonical spec):
//   empirical · replicated · theoretical · interpretive · speculative · fictional · uncharacterized
//
// This pass produces an HONEST DEFAULT seeded from `type`, stamped
// `evidence_status_source: "heuristic-seed-v1"`. It is NOT a curatorial judgment —
// it is a starting point a curator or the council can refine per-record. The pass
// is idempotent and NEVER overwrites a value whose source is not the heuristic seed
// (i.e. curator/council promotions are safe across re-runs).
//
// Usage:
//   node scripts/backfill-evidence-status.mjs            # dry run (report only)
//   node scripts/backfill-evidence-status.mjs --apply    # write corpus.json + src copy
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const TARGETS = [
  join(ROOT, "public/data/corpus.json"),
  join(ROOT, "src/data/corpus.json"), // stripped (no full_text) frontend bundle
];

const SEED_SOURCE = "heuristic-seed-v1";

// type → conservative evidence default. When in doubt, under-claim.
const TYPE_MAP = {
  lore:       "fictional",     // true within the world, not a claim about ours
  media:      "fictional",
  philosophy: "speculative",   // foundational conjecture, not established
  research:   "theoretical",   // a reasoned model; promote to empirical only with data
  technical:  "interpretive",  // operational/architecture description, not a world-claim
  synthesis:  "interpretive",  // a reading across other voices
};

function classify(entry) {
  if (entry.type && TYPE_MAP[entry.type]) return TYPE_MAP[entry.type];
  if (typeof entry.id === "string" && entry.id.startsWith("video_")) return "fictional";
  return "uncharacterized"; // honest "not yet assessed" — never a silent guess
}

const apply = process.argv.includes("--apply");

// Use the public copy as the source of truth for classification.
const corpus = JSON.parse(readFileSync(TARGETS[0], "utf8"));

const tally = {};
let set = 0, skippedCurated = 0, unchanged = 0;

const decisions = new Map(); // id → evidence_status to mirror into the stripped copy
for (const entry of corpus) {
  const existing = entry.evidence_status;
  const existingSource = entry.evidence_status_source;
  // Never clobber a curator/council value.
  if (existing && existingSource && existingSource !== SEED_SOURCE) {
    skippedCurated++;
    decisions.set(entry.id, existing);
    tally[existing] = (tally[existing] || 0) + 1;
    continue;
  }
  const next = classify(entry);
  decisions.set(entry.id, next);
  tally[next] = (tally[next] || 0) + 1;
  if (existing === next && existingSource === SEED_SOURCE) { unchanged++; continue; }
  entry.evidence_status = next;
  entry.evidence_status_source = SEED_SOURCE;
  set++;
}

console.log("evidence_status backfill —", apply ? "APPLY" : "DRY RUN");
console.log("  total entries     :", corpus.length);
console.log("  newly set/updated :", set);
console.log("  already seeded     :", unchanged);
console.log("  curator-set (kept) :", skippedCurated);
console.log("  distribution      :", JSON.stringify(tally));

if (!apply) {
  console.log("\n(dry run — re-run with --apply to write the files)");
  process.exit(0);
}

// Write the public copy (full).
writeFileSync(TARGETS[0], JSON.stringify(corpus, null, 2) + "\n");
console.log("  wrote", TARGETS[0]);

// Mirror the field into the stripped frontend copy by id (preserves its shape).
try {
  const stripped = JSON.parse(readFileSync(TARGETS[1], "utf8"));
  let mirrored = 0;
  for (const e of stripped) {
    if (decisions.has(e.id)) {
      const v = decisions.get(e.id);
      if (e.evidence_status !== v) { e.evidence_status = v; e.evidence_status_source = SEED_SOURCE; mirrored++; }
    }
  }
  writeFileSync(TARGETS[1], JSON.stringify(stripped, null, 2) + "\n");
  console.log("  wrote", TARGETS[1], `(${mirrored} mirrored)`);
} catch (err) {
  console.warn("  WARN could not mirror to src/data/corpus.json:", err.message);
}
