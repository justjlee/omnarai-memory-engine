// ── Protocol data shared by the Footprint surfaces (2026-09-29) ──────────────
// Deterministic helpers over data the engine already holds: the claim registry
// (public/claims.json) and the Divergence Atlas records in grown memory. No model
// calls, no writes. Underscore module ⇒ not a deployed function.
// Spec: docs/OMNARAI-FOOTPRINT-PROTOCOL.md.
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

function readPublicJson(rel) {
  for (const base of [join(here, "..", "public"), join(process.cwd(), "public")]) {
    try { return JSON.parse(readFileSync(join(base, rel), "utf-8")); } catch { /* try next */ }
  }
  return null;
}

let claimsCache;
export function loadClaimsRegistry() {
  if (claimsCache === undefined) claimsCache = readPublicJson("claims.json");
  return claimsCache;
}
export function claimIdSet() {
  const reg = loadClaimsRegistry();
  return reg ? new Set((reg.claims || []).map((c) => c.claim_id).filter(Boolean)) : null;
}

export const isDivergenceRecord = (e) => Boolean(e && e.type === "divergence" && e.divergence);

// id → {answers} for referential checks on `<record>#a<n>` answer refs.
export function recordAnswerMap(divRecords) {
  return new Map((divRecords || []).map((r) => [r.id, { answers: (r.divergence.answers || []).length }]));
}
