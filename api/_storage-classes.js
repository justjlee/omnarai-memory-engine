// Storage classes: which store each record family lives in.
//
// Two Vercel Blob stores back the engine:
//   • public  — published material anyone may read by URL (corpus media, grown
//               memory, tensions, annotations, the public proposal log, derived
//               positions, eval results).
//   • private — everything else: visitor-submitted records, review notes, runs,
//               jobs and sessions, the curator dashboard, the spend ledger,
//               per-visitor counters and access telemetry. Every read needs the
//               store credential, which only the server holds.
//
// api/_blob.js routes every put / list / del / read through this table, and
// scripts/check-storage-classes.mjs fails the build when a pathname prefix used
// in api/ is missing from it. Longest matching prefix wins.

export const STORAGE_CLASSES = Object.freeze({
  // ── public (published by design) ──
  "annotations/": "public",
  "atlas/": "public",
  "concept-proposals/": "public",
  "deltas/": "public",
  "eval-results/": "public",
  "gallery/": "public",
  "memory/grown.json": "public",
  "positions/derived/": "public",
  "proposals/": "public",
  "tensions/": "public",

  // ── private (server-mediated reads only) ──
  "budget/": "private",
  "contribute-dedupe/": "private",
  "contribute-usage/": "private",
  "contributions/": "private",
  "council-runs/": "private",
  "council-usage/": "private",
  "footprints/": "private",
  "home/": "private",
  "jobs/": "private",
  "memory/contributions.json": "private",
  "operator-auth/": "private",
  "plays/": "private",
  "positions/reviews/": "private",
  "question-declined/": "private",
  "question-proposals/": "private",
  // Research namespaces (Inheritance Study 001 lab records). Private: trial plans, evaluations and
  // runs are reviewed before anything is published; sealed task material never enters Blob at all.
  "research/": "private",
  "sessions/": "private",
  "telemetry/": "private",
  // Continuance handoff 2026-11-23 (not wired to any write route): Open Work records and future
  // representation-neutral primaries. Private until a curator admits a record; reads are server-mediated.
  // (research/ is registered on the inheritance-001 branch.)
  "work/": "private",
  "expressions/": "private",
});

const ENTRIES = Object.entries(STORAGE_CLASSES).sort((a, b) => b[0].length - a[0].length);

/** Class of one pathname, or null when nothing in the table covers it. */
export function classOf(pathname) {
  const p = String(pathname || "");
  for (const [prefix, cls] of ENTRIES) if (p.startsWith(prefix)) return cls;
  return null;
}

/**
 * Class of a LIST prefix. A prefix that sits inside one entry takes that entry's
 * class. A prefix that would span both classes (e.g. "" or "positions/") is
 * "mixed" and refused by the router, so a broad listing can never quietly mix
 * private records into a public answer.
 */
export function classOfPrefix(prefix) {
  const p = String(prefix || "");
  const inside = classOf(p);
  if (inside) return inside;
  const below = new Set(ENTRIES.filter(([k]) => k.startsWith(p)).map(([, c]) => c));
  if (below.size === 1) return [...below][0];
  return below.size ? "mixed" : null;
}
