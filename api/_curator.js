// Curator gate for writes that change what the engine serves.
// Same rule as council.js curatorAuthed (Bearer INGEST_SECRET; no secret set ⇒
// closed), compared in constant time. Underscore module ⇒ not a deployed function.
//
// Why it exists (2026-10-21): /api/store approve|reject and /api/concepts
// approve|reject had no check at all. Anyone could propose a text, approve it into
// grown memory (which query.js merges into the served corpus) and choose its ring,
// including "core". The proposal log shows no approval since 2026-06-02, all the
// curator's own.
import { timingSafeEqual } from "node:crypto";

export function curatorAuthed(req) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false;
  const token = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const CURATOR_ONLY = {
  error: "Bearer INGEST_SECRET required — approving or rejecting is the curator's decision.",
  code: "CURATOR_ONLY",
  agent_action: "Propose instead (POST {action:'propose', ...}); a proposal waits for curator review.",
  retryable: false,
};
