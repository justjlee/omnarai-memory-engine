// Inheritance study 001 — canonical hashing and record sealing.
//
// REUSES the engine's one canonicalization ("sorted-keys-json/1", api/_footprints.js — the same bytes /api/manifest and
// every Footprint hash use), so a study record and a Footprint can never disagree about what "the same content" means.
// Pure: no I/O, no clock, no randomness.
import { canonicalJSON, sha256 as sha256Text, CANONICALIZATION } from "../../../api/_footprints.js";

export { canonicalJSON, CANONICALIZATION };
export const PROTOCOL = "omnarai.inheritance-study/0.1";
export const schemaVersion = (kind) => `omnarai.inheritance-study.${kind}/0.1`;
export const RECORD_KINDS = ["study", "task_family", "task", "artifact", "evaluation", "snapshot", "trial", "run", "ablation", "report"];

export const sha256 = (value) => sha256Text(typeof value === "string" ? value : canonicalJSON(value));

// A record's own `sha256` covers every other field. Sealing is idempotent; a sealed record re-hashes to its field.
export function hashRecord(record) {
  // eslint-disable-next-line no-unused-vars
  const { sha256: _ignored, ...rest } = record || {};
  return sha256(rest);
}
export function seal(record) {
  // eslint-disable-next-line no-unused-vars
  const { sha256: _ignored, ...rest } = record;
  return { ...rest, sha256: sha256(rest) };
}
export function isSealedIntact(record) {
  return Boolean(record && typeof record.sha256 === "string" && /^[0-9a-f]{64}$/.test(record.sha256) && record.sha256 === hashRecord(record));
}
export class IntegrityError extends Error {
  constructor(code, detail) { super(`${code}${detail ? ` ${detail}` : ""}`); this.code = code; }
}
export function assertSealed(record, what = record?.id || "record") {
  if (!isSealedIntact(record)) throw new IntegrityError("RECORD_INTEGRITY", what);
  return record;
}

// Opaque, content-derived id suffix. Ids never carry a family label, so a sealed held-out family is not named by the
// ids of its tasks in any log.
export const hexId = (value, n = 12) => sha256(value).slice(0, n);

// Deterministic PRNG (mulberry32). Seeds are integers or strings (hashed). Every random choice in the study goes through
// one of these, so a plan or a mock run is a pure function of its seed.
export function rng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : parseInt(sha256(String(seed)).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export const tokensFor = (chars) => Math.ceil((chars || 0) / 4); // same rule as scripts/lib/model-prices.mjs
