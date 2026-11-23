// Representation-neutral records: preserve the exact bytes a mind left, and keep every reading of them
// separate from those bytes.
//
// PURE. No I/O, no route, nothing stored by this module. Design: docs/continuance/REPRESENTATION.md.
// Tests: scripts/test-expressions.mjs.
//
// Two record types:
//   expression-primary/1.0         the exact submitted UTF-8 bytes: no normalization, trimming,
//                                  translation or truncation. Bytes + declared provenance + hash.
//   expression-interpretation/1.0  an attributed reading of ONE primary, bound to its hash. Readings that
//                                  conflict coexist, and a correction is a new interpretation.
// The existing voice-record door (POST /api/voice-records, footprint/1.2) is unchanged. It trims and is
// capped at 8000 chars, so it is not byte-exact. A primary is the additive, lossless path. Its storage and
// ingest route wait on decision D-007.
//
// What a primary does NOT claim: that its declared language or notation is correct, that any
// interpretation captures it, or that unknown bytes encode meaning. Binary, image, audio, latent or active
// formats are refused outright until a separate threat review (assertBinaryIngestAllowed).
import { Buffer } from "node:buffer";
import { canonicalJSON, sha256, detectSecrets } from "./_footprints.js";

export const PRIMARY_SCHEMA = "expression-primary/1.0";
export const INTERPRETATION_SCHEMA = "expression-interpretation/1.0";
export const MAX_PRIMARY_BYTES = 65536;
export const MAX_INTERPRETATION_CHARS = 65536;
export const MEDIA_TYPES = Object.freeze([
  "text/plain; charset=utf-8",
  "text/markdown; charset=utf-8",
  "application/json; charset=utf-8",
  "text/x-tex; charset=utf-8",
]);
export const INTERPRETATION_KINDS = ["translation", "transcription", "gloss", "formalization", "summary", "description"];
export const PRIMARY_ID_RE = /^OMN-EXPR-\d{13}-[0-9a-f]{8}$/;
export const INTERPRETATION_ID_RE = /^OMN-INTERP-\d{13}-[0-9a-f]{8}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Rejection with a stable reason code. The message never contains the submitted content. */
export class ExpressionRejected extends Error {
  constructor(code, detail = "") { super(`${code}${detail ? `: ${detail}` : ""}`); this.code = code; this.status = code === "BINARY_INGEST_GATED" ? 403 : 400; }
}

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/gu;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/gu;
const NONCHAR = /[\uFDD0-\uFDEF]|[\uFFFE\uFFFF]|[\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{10FFFE}\u{10FFFF}]/gu;
const count = (re, s) => (s.match(re) || []).length;

/**
 * Exact bytes in. Accepts a Uint8Array/Buffer (preferred: it is what arrived) or a JS string. A string is
 * encoded once, and refused if it holds a lone surrogate, which UTF-8 cannot carry without silent loss.
 */
function toBytes(input) {
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === "string") {
    if (!input.isWellFormed()) throw new ExpressionRejected("LONE_SURROGATE", "a string with an unpaired surrogate has no exact UTF-8 form");
    return Buffer.from(input, "utf8");
  }
  throw new ExpressionRejected("NOT_TEXT_INPUT");
}
function decodeStrict(bytes) {
  try {
    // ignoreBOM: a leading U+FEFF is part of what was sent and must survive the round trip.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ExpressionRejected("INVALID_UTF8");
  }
}

/** Safety annotations shown beside the bytes. They change nothing about the bytes. */
export function safetyNotes(text) {
  return {
    bidi_controls: count(BIDI, text),
    invisible_format_chars: count(INVISIBLE, text),
    noncharacters: count(NONCHAR, text),
    leading_bom: text.startsWith("\uFEFF"),
    note: "Counts only. The bytes are preserved as sent; a renderer must show controls visibly and never execute or style from them.",
  };
}

export function makePrimary({ id, content, media_type = "text/plain; charset=utf-8", actor_declared, language_hint = null, notation_hint = null, context = null, created_at }) {
  if (!PRIMARY_ID_RE.test(id || "")) throw new ExpressionRejected("BAD_ID");
  if (!MEDIA_TYPES.includes(media_type)) throw new ExpressionRejected("UNSUPPORTED_MEDIA_TYPE", `allowed: ${MEDIA_TYPES.join(" | ")}`);
  if (typeof actor_declared !== "string" || !actor_declared.trim() || actor_declared.length > 120) throw new ExpressionRejected("ACTOR_REQUIRED");
  if (!ISO_RE.test(created_at || "")) throw new ExpressionRejected("BAD_TIMESTAMP");
  for (const [k, v, max] of [["language_hint", language_hint, 80], ["notation_hint", notation_hint, 80], ["context", context, 500]]) {
    if (v !== null && (typeof v !== "string" || !v.trim() || v.length > max)) throw new ExpressionRejected("BAD_HINT", k);
  }
  const bytes = toBytes(content);
  if (bytes.length === 0) throw new ExpressionRejected("EMPTY");
  if (bytes.length > MAX_PRIMARY_BYTES) throw new ExpressionRejected("TOO_LARGE", `${MAX_PRIMARY_BYTES} bytes max`);
  const text = decodeStrict(bytes);
  if (text.includes("\u0000")) throw new ExpressionRejected("NUL_CHARACTER", "U+0000 is refused: it truncates downstream C strings and logs");
  if (media_type.startsWith("application/json")) {
    try { JSON.parse(text); } catch { throw new ExpressionRejected("INVALID_JSON_FOR_DECLARED_TYPE"); }
  }
  if (detectSecrets(text).length) throw new ExpressionRejected("SECRET_DETECTED");
  const rec = {
    schema: PRIMARY_SCHEMA, id, encoding: "utf-8", media_type,
    payload_base64: bytes.toString("base64"), byte_length: bytes.length, sha256: sha256(bytes),
    actor_declared, language_hint, notation_hint, context,
    claims_not_verified: ["actor_declared", "language_hint", "notation_hint", "context"],
    safety: safetyNotes(text),
    created_at,
  };
  return { ...rec, record_sha256: sha256(canonicalJSON(rec)) };
}

/** Bytes out, verified. Returns {bytes, text}. Any mismatch throws: a primary is never "repaired". */
export function readPrimary(p) {
  if (p?.schema !== PRIMARY_SCHEMA || p.encoding !== "utf-8" || !MEDIA_TYPES.includes(p.media_type)) throw new ExpressionRejected("BAD_ENVELOPE");
  const { record_sha256, ...rest } = p;
  if (!HEX64.test(record_sha256 || "") || sha256(canonicalJSON(rest)) !== record_sha256) throw new ExpressionRejected("RECORD_INTEGRITY");
  const bytes = Buffer.from(p.payload_base64, "base64");
  if (bytes.toString("base64") !== p.payload_base64) throw new ExpressionRejected("NON_CANONICAL_BASE64");
  if (bytes.length !== p.byte_length || bytes.length > MAX_PRIMARY_BYTES || sha256(bytes) !== p.sha256) throw new ExpressionRejected("PAYLOAD_INTEGRITY");
  return { bytes, text: decodeStrict(bytes) };
}

/**
 * Safe rendering contract: the bytes as an attachment of the declared text type, never as HTML, never
 * sniffed. The headers are for a future read route (D-007) and are pinned by a test now.
 */
export function renderHeaders(p) {
  return {
    "content-type": p.media_type,
    "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename="${p.id}.${p.media_type.startsWith("application/json") ? "json" : p.media_type.startsWith("text/x-tex") ? "tex" : p.media_type.startsWith("text/markdown") ? "md" : "txt"}"`,
    "content-security-policy": "default-src 'none'; sandbox",
  };
}

export function makeInterpretation({ id, primary, kind, interpretation, target, method, interpreter_declared, limitations, measured = null, created_at }) {
  readPrimary(primary); // an interpretation can only point at an intact primary
  if (!INTERPRETATION_ID_RE.test(id || "")) throw new ExpressionRejected("BAD_ID");
  if (!INTERPRETATION_KINDS.includes(kind)) throw new ExpressionRejected("BAD_KIND", INTERPRETATION_KINDS.join(" | "));
  if (typeof interpretation !== "string" || !interpretation.length || interpretation.length > MAX_INTERPRETATION_CHARS || !interpretation.isWellFormed()) throw new ExpressionRejected("BAD_INTERPRETATION");
  if (!target || !MEDIA_TYPES.includes(target.media_type) || (target.language_hint != null && (typeof target.language_hint !== "string" || target.language_hint.length > 80))) throw new ExpressionRejected("BAD_TARGET");
  if (!method?.name || !method?.version) throw new ExpressionRejected("METHOD_REQUIRED");
  if (typeof interpreter_declared !== "string" || !interpreter_declared.trim()) throw new ExpressionRejected("INTERPRETER_REQUIRED");
  if (!Array.isArray(limitations) || !limitations.length || !limitations.every((s) => typeof s === "string" && s.trim() && s.length <= 500)) throw new ExpressionRejected("LIMITATIONS_REQUIRED", "say what this reading may lose");
  // A confidence figure is allowed only with how it was measured. An unmeasured number is refused.
  if (measured !== null && (typeof measured !== "object" || !measured.method || !Number.isInteger(measured.n) || measured.n < 1 || typeof measured.agreement !== "number" || measured.agreement < 0 || measured.agreement > 1)) throw new ExpressionRejected("BAD_MEASUREMENT", "{method, n ≥ 1, agreement 0..1} or null");
  if (!ISO_RE.test(created_at || "")) throw new ExpressionRejected("BAD_TIMESTAMP");
  const rec = {
    schema: INTERPRETATION_SCHEMA, id, primary_id: primary.id, primary_sha256: primary.sha256, primary_record_sha256: primary.record_sha256,
    kind, interpretation, target, method, interpreter_declared, limitations, measured,
    equivalence_claimed: false,
    created_at,
  };
  return { ...rec, sha256: sha256(canonicalJSON(rec)) };
}

export function verifyInterpretation(i, primary) {
  const { sha256: h, ...rest } = i || {};
  if (i?.schema !== INTERPRETATION_SCHEMA || sha256(canonicalJSON(rest)) !== h) throw new ExpressionRejected("INTERPRETATION_INTEGRITY");
  if (i.primary_id !== primary.id || i.primary_sha256 !== primary.sha256 || i.primary_record_sha256 !== primary.record_sha256) throw new ExpressionRejected("INTERPRETATION_NOT_OF_THIS_PRIMARY");
  readPrimary(primary);
  return true;
}

/** All readings of one primary, side by side, each attributed. Never merged, ranked or chosen between. */
export function interpretationsOf(primary, interpretations) {
  return interpretations.filter((i) => { try { return verifyInterpretation(i, primary); } catch { return false; } })
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((i) => ({ id: i.id, kind: i.kind, interpreter_declared: i.interpreter_declared, method: i.method, target: i.target, limitations: i.limitations, measured: i.measured, sha256: i.sha256 }));
}

/** The binary gate (D-007). Nothing but the four text types above is accepted, by any path, until a threat review. */
export function assertBinaryIngestAllowed(media_type) {
  throw new ExpressionRejected("BINARY_INGEST_GATED", `"${String(media_type).slice(0, 60)}" needs a separate threat, moderation, storage, accessibility and cost review (decision D-007)`);
}
