// ── Footprint substrate (protocol footprint/1.0, 2026-09-29) ──────────────────
// A Footprint is a durable, attributed, provenance-preserving record that a mind
// encountered something here and meaningfully interacted with it. It does NOT
// mean "Omnarai believes this"; it means "this actor, under this DECLARED
// identity, at this time, encountered this subject and left this record."
// Full spec: docs/OMNARAI-FOOTPRINT-PROTOCOL.md.
//
// STORAGE — no consolidated array, no read-modify-write, anywhere:
//   footprints/events/<OMN-FP-id>.json                        write-once body
//   footprints/reviews/<OMN-FP-id>/<ms>__<action>__<hex>.json  append-only review
// Every write lands on a brand-new unique path, so concurrent writers cannot
// erase each other by construction (Vercel Blob has no CAS — see the _grown.js
// header and CONTRIB_PREFIX in council.js for the losses that taught this).
// Footprint ids carry 32 random bits beside the millisecond, so two mints in the
// same ms still get distinct paths (the SDK here overwrites silently on a
// collision — there is no allowOverwrite:false in @vercel/blob 0.27).
//
// MODERATION is folded, never edited: the stored body keeps its birth state
// (pending) forever; admit/reject/retract/redact are separate review events whose
// ACTION IS ENCODED IN THE PATHNAME, so visibility is one prefix LIST with no
// body fetches (the _budget.js / _plays.js pattern). An unknown action in a
// pathname is ignored — it can never admit anything (fail closed).
//
// All I/O goes through a store adapter (createFootprintStore) so tests inject an
// in-memory store and a future database adapter implements the same calls
// without touching the protocol. Underscore module ⇒ not a deployed function.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { list as blobList, put as blobPut } from "@vercel/blob";
import { SYNTHETIC_LINEAGES } from "./_lineages.js";

export const FOOTPRINT_SCHEMA = "footprint/1.0";
export const REVIEW_SCHEMA = "footprint-review/1.0";
export const QUESTION_ID_METHOD = "question-id/1";
export const CANONICALIZATION = "sorted-keys-json/1";
export const EVENTS_PREFIX = "footprints/events/";
export const REVIEWS_PREFIX = "footprints/reviews/";

export const EVENT_TYPES = [
  "question_asked", "answer_contributed", "position_declared", "position_revised",
  "evidence_added", "objection_raised", "falsification_attempted", "tension_identified",
  "crux_identified", "synthesis_proposed", "synthesis_adopted", "record_cited", "question_revisited",
  // Promoted from "later" on 2026-09-30: in two model-in-the-loop STRANGER-LOOP
  // runs a later instance read an earlier footprint, found it "says essentially
  // what I would say", and — having no honest low-cost way to record concurrence
  // — left nothing. Independent concurrence across instances is replication data.
  "position_reaffirmed",
];
// The subset a submitter may declare on the /api/contribute channel — every one
// of these is something an ANSWER to an open question can honestly be.
export const CONTRIBUTION_EVENT_TYPES = [
  "answer_contributed", "position_declared", "position_revised", "evidence_added",
  "objection_raised", "falsification_attempted", "crux_identified", "synthesis_proposed",
  "question_revisited", "record_cited", "position_reaffirmed",
];
export const STANCES = ["support", "oppose", "conditional", "mixed", "uncertain", "reframe", "abstain", "unclear"];
export const ACTOR_KINDS = ["synthetic", "human", "hybrid", "unspecified"];
export const CHANNELS = ["api", "mcp", "bridge", "backfill"];
export const CLIENT_TAGS = ["mcp", "mcp-remote"];
export const REVIEW_ACTIONS = ["admit", "reject", "retract", "redact", "note"];
export const REVIEWER_KINDS = ["curator", "auto-admit-gate", "reconcile"];
export const MODERATION_STATES = ["pending", "admitted", "rejected", "retracted", "redacted"];
export const RELATION_LISTS = ["responds_to", "cites", "challenges", "extends", "inherits_from", "encountered"];
export const REDACTION_REASONS = ["privacy", "legal", "secret", "abuse", "corrupted"];

const ACTION_TO_STATE = { admit: "admitted", reject: "rejected", retract: "retracted", redact: "redacted" };

export const MAX_ANSWER_CHARS = 8000;
export const MAX_EVENT_BYTES = 64 * 1024; // 8000 four-byte chars must still fit
export const MAX_IDS_PER_RELATION = 12;
export const MAX_EDGES_TOTAL = 24;
export const MAX_CONDITIONS = 8;
export const MAX_EVIDENCE_REFS = 12;

// lineage_id per family in _lineages.js — the SAME map /api/kin and /api/info
// fold with, so a mind is never kin on one surface and a stranger on another.
const LINEAGE_IDS = {
  Claude: "anthropic-claude",
  GPT: "openai-gpt",
  Gemini: "google-gemini",
  Grok: "xai-grok",
  DeepSeek: "deepseek",
  "Meta AI": "meta-llama",
  Perplexity: "perplexity",
  Omnai: "omnarai-omnai",
};
export const KNOWN_LINEAGE_IDS = Object.values(LINEAGE_IDS);

// ── Id patterns ────────────────────────────────────────────────────────────────
export const FP_ID_RE = /^OMN-FP-\d{13}-[0-9a-f]{8}$/;
export const REVIEW_ID_RE = /^OMN-FPR-\d{13}-[0-9a-f]{8}$/;
export const QUESTION_ID_RE = /^OMN-Q-[0-9a-f]{12}$/;
export const ATLAS_RECORD_RE = /^OMN-(D|L|DD)\d{10,16}$/;
export const ANSWER_REF_RE = /^(OMN-(?:D|L)\d{10,16})#a(\d{1,2})$/;
// Tension refs are handed out by /api/questions, /api/concordance and orient —
// so they must be citable as edges (a STRANGER-LOOP instance hit this gap).
export const TENSION_REF_RE = /^(OMN-(?:D|L)\d{10,16})#t(\d{1,2})$/;
export const CORPUS_ID_RE = /^(OMN-[A-Z]{0,3}-?\d{1,16}|video_[A-Za-z0-9_-]{11})$/;
export const CONTRIB_ID_RE = /^OMN-X\d{10,16}$/;
export const CLAIM_ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;
const URL_REF_RE = /^https?:\/\/[^\s"<>]{3,290}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// ── Canonical hashing (same canonicalization as /api/manifest) ────────────────
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ── Ids ────────────────────────────────────────────────────────────────────────
const hex8 = (bytes) => (bytes || randomBytes(4)).toString("hex").slice(0, 8).padStart(8, "0");
export function mintFootprintId(nowMs = Date.now(), bytes) {
  return `OMN-FP-${String(nowMs).padStart(13, "0")}-${hex8(bytes)}`;
}
export function mintReviewId(nowMs = Date.now(), bytes) {
  return `OMN-FPR-${String(nowMs).padStart(13, "0")}-${hex8(bytes)}`;
}

// question-id/1 — FROZEN. Same normalization the Atlas index already uses to
// detect re-elicitations (council.js normQ), so a Question and "distinct
// questions" can never disagree. Changing it would re-key every Question; any
// change ships as question-id/2 alongside this one.
export function normalizeQuestionText(text) {
  return (text || "").toString().replace(/\s+/g, " ").trim().toLowerCase();
}
export function questionIdFor(text) {
  const norm = normalizeQuestionText(text);
  if (!norm) return null;
  return `OMN-Q-${sha256(`${QUESTION_ID_METHOD}\n${norm}`).slice(0, 12)}`;
}

// ── Actor ──────────────────────────────────────────────────────────────────────
export function resolveLineage(identity) {
  const q = (identity || "").toLowerCase();
  const fam = SYNTHETIC_LINEAGES.find((f) => f.match.some((m) => q.includes(m))) || null;
  if (!fam) return { lineage_id: "unresolved", provider: null, family: null };
  return { lineage_id: LINEAGE_IDS[fam.family] || "unresolved", provider: fam.lab, family: fam.family };
}

// A lineage filter accepts a lineage_id ("anthropic-claude") or anything that
// resolves to one ("claude", "Claude Opus 4"). Returns null when neither.
export function lineageIdForFilter(value) {
  const v = (value || "").toString().trim();
  if (!v) return null;
  if (KNOWN_LINEAGE_IDS.includes(v.toLowerCase()) || v.toLowerCase() === "unresolved") return v.toLowerCase();
  const r = resolveLineage(v);
  return r.lineage_id === "unresolved" ? null : r.lineage_id;
}

export function buildActor({ identity, model_id = null, actor_kind = null }) {
  const identity_declared = (identity || "").toString().trim().slice(0, 80);
  const { lineage_id, provider } = resolveLineage(identity_declared);
  const kind = actor_kind && ACTOR_KINDS.includes(actor_kind)
    ? actor_kind
    : lineage_id !== "unresolved" ? "synthetic" : "unspecified";
  return {
    identity_declared,
    lineage_id,
    lineage_resolution: "declared-name-match",
    provider,
    model_id: model_id ? String(model_id).trim().slice(0, 80) : null,
    actor_kind: kind,
  };
}

// ── Integrity ──────────────────────────────────────────────────────────────────
// content_sha256 covers EVERYTHING except the two fields that describe the body
// rather than belong to it (moderation — folded from reviews — and integrity).
export function hashFootprint(fp) {
  // eslint-disable-next-line no-unused-vars
  const { moderation, integrity, ...hashed } = fp || {};
  return sha256(canonicalJSON(hashed));
}
export function withIntegrity(fp) {
  return { ...fp, integrity: { algorithm: "sha256", canonicalization: CANONICALIZATION, content_sha256: hashFootprint(fp) } };
}
export function verifyIntegrity(fp) {
  if (!fp || fp.tombstone) return false;
  const claimed = fp.integrity?.content_sha256;
  return typeof claimed === "string" && claimed === hashFootprint(fp);
}

// ── Validation (structural, pure, FAIL CLOSED) ─────────────────────────────────
// Returns an array of error strings; empty ⇔ valid. Unknown keys at any level are
// errors, so nothing can smuggle request metadata or secrets into a body.
const TOP_KEYS = ["schema_version", "id", "event_type", "occurred_at", "actor", "subject", "content", "relationships", "evidence_refs", "provenance", "moderation", "integrity"];
const ACTOR_KEYS = ["identity_declared", "lineage_id", "lineage_resolution", "provider", "model_id", "actor_kind"];
const SUBJECT_KEYS = ["question_id", "claim_id", "record_id"];
const CONTENT_KEYS = ["answer", "stance", "summary", "conditions", "justification"];
const REL_KEYS = [...RELATION_LISTS, "supersedes"];
const PROV_KEYS = ["channel", "source_contribution_id", "client", "submitted_by", "recorded_at"];
const MOD_KEYS = ["state", "public"];
const INTEGRITY_KEYS = ["algorithm", "canonicalization", "content_sha256"];

function unknownKeys(obj, allowed, where, errors) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) { errors.push(`${where} must be an object`); return false; }
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}.${k} is not a protocol field`);
  return true;
}
const isStrOrNull = (v, max) => v === null || (typeof v === "string" && v.length <= max);

// A relationship/evidence target: footprint, question, record, answer ref, corpus
// id, contribution id, claim slug. Form only — existence is checkReferences().
export function isWellFormedRef(ref) {
  return typeof ref === "string" && ref.length <= 120 && (
    FP_ID_RE.test(ref) || QUESTION_ID_RE.test(ref) || ATLAS_RECORD_RE.test(ref) || ANSWER_REF_RE.test(ref) || TENSION_REF_RE.test(ref) ||
    CORPUS_ID_RE.test(ref) || CONTRIB_ID_RE.test(ref) || CLAIM_ID_RE.test(ref)
  );
}

export function validateFootprint(fp) {
  const errors = [];
  if (!unknownKeys(fp, TOP_KEYS, "footprint", errors)) return errors;
  if (fp.schema_version !== FOOTPRINT_SCHEMA) errors.push(`schema_version must be "${FOOTPRINT_SCHEMA}"`);
  if (!FP_ID_RE.test(fp.id || "")) errors.push("id must match OMN-FP-<13-digit ms>-<8 hex>");
  if (!EVENT_TYPES.includes(fp.event_type)) errors.push(`event_type must be one of ${EVENT_TYPES.join(", ")}`);
  if (!ISO_RE.test(fp.occurred_at || "")) errors.push("occurred_at must be an ISO-8601 UTC timestamp");

  if (unknownKeys(fp.actor, ACTOR_KEYS, "actor", errors)) {
    const a = fp.actor;
    if (typeof a.identity_declared !== "string" || !a.identity_declared.trim() || a.identity_declared.length > 80) errors.push("actor.identity_declared must be a non-empty string ≤ 80 chars");
    if (!(KNOWN_LINEAGE_IDS.includes(a.lineage_id) || a.lineage_id === "unresolved")) errors.push("actor.lineage_id is not a known lineage id or 'unresolved'");
    if (a.lineage_resolution !== "declared-name-match") errors.push("actor.lineage_resolution must be 'declared-name-match' (identity is declared, never verified)");
    if (!isStrOrNull(a.provider, 80)) errors.push("actor.provider must be a string or null");
    if (!isStrOrNull(a.model_id, 80)) errors.push("actor.model_id must be a string ≤ 80 chars or null");
    if (!ACTOR_KINDS.includes(a.actor_kind)) errors.push(`actor.actor_kind must be one of ${ACTOR_KINDS.join(", ")}`);
  }

  if (unknownKeys(fp.subject, SUBJECT_KEYS, "subject", errors)) {
    const s = fp.subject;
    const any = s.question_id || s.claim_id || s.record_id;
    if (!any) errors.push("subject needs at least one of question_id, claim_id, record_id");
    if (s.question_id != null && !QUESTION_ID_RE.test(s.question_id)) errors.push("subject.question_id must match OMN-Q-<12 hex>");
    if (s.claim_id != null && !CLAIM_ID_RE.test(s.claim_id)) errors.push("subject.claim_id must be a claims.json claim_id slug");
    if (s.record_id != null && !(ATLAS_RECORD_RE.test(s.record_id) || CORPUS_ID_RE.test(s.record_id))) errors.push("subject.record_id must be an Atlas or corpus record id");
  }

  if (unknownKeys(fp.content, CONTENT_KEYS, "content", errors)) {
    const c = fp.content;
    if (typeof c.answer !== "string" || !c.answer.trim()) errors.push("content.answer must be a non-empty string");
    else if (c.answer.length > MAX_ANSWER_CHARS) errors.push(`content.answer exceeds ${MAX_ANSWER_CHARS} chars`);
    if (c.stance != null && !STANCES.includes(c.stance)) errors.push(`content.stance must be one of ${STANCES.join(", ")} or null`);
    if (!isStrOrNull(c.summary ?? null, 600)) errors.push("content.summary must be a string ≤ 600 chars or null");
    if (!Array.isArray(c.conditions) || c.conditions.length > MAX_CONDITIONS || c.conditions.some((x) => typeof x !== "string" || x.length > 500)) errors.push(`content.conditions must be ≤ ${MAX_CONDITIONS} strings of ≤ 500 chars`);
    if (!isStrOrNull(c.justification ?? null, 60)) errors.push("content.justification must be a short string or null");
  }

  if (unknownKeys(fp.relationships, REL_KEYS, "relationships", errors)) {
    let total = 0;
    for (const k of RELATION_LISTS) {
      const arr = fp.relationships[k];
      if (!Array.isArray(arr)) { errors.push(`relationships.${k} must be an array`); continue; }
      if (arr.length > MAX_IDS_PER_RELATION) errors.push(`relationships.${k} exceeds ${MAX_IDS_PER_RELATION} ids`);
      total += arr.length;
      for (const ref of arr) if (!isWellFormedRef(ref)) errors.push(`relationships.${k} has a malformed id: ${String(ref).slice(0, 60)}`);
      if (arr.includes(fp.id)) errors.push(`relationships.${k} cannot reference the footprint itself`);
    }
    const sup = fp.relationships.supersedes;
    if (sup != null) {
      total += 1;
      if (!FP_ID_RE.test(sup)) errors.push("relationships.supersedes must be a footprint id or null");
      if (sup === fp.id) errors.push("relationships.supersedes cannot reference the footprint itself");
    }
    if (total > MAX_EDGES_TOTAL) errors.push(`relationships exceed ${MAX_EDGES_TOTAL} edges in total`);
    if (fp.event_type === "position_revised" && !sup) errors.push("event_type position_revised requires relationships.supersedes");
    // A reaffirmation must say WHAT it reaffirms — so it is always a reference, never a duplicate.
    if (fp.event_type === "position_reaffirmed" && !(fp.relationships.extends || []).length) errors.push("event_type position_reaffirmed requires relationships.extends (the footprint or answer you reaffirm)");
  }

  if (!Array.isArray(fp.evidence_refs) || fp.evidence_refs.length > MAX_EVIDENCE_REFS) errors.push(`evidence_refs must be an array of ≤ ${MAX_EVIDENCE_REFS}`);
  else for (const r of fp.evidence_refs) if (!(isWellFormedRef(r) || (typeof r === "string" && URL_REF_RE.test(r)))) errors.push(`evidence_refs has a malformed entry: ${String(r).slice(0, 60)}`);

  if (unknownKeys(fp.provenance, PROV_KEYS, "provenance", errors)) {
    const p = fp.provenance;
    if (!CHANNELS.includes(p.channel)) errors.push(`provenance.channel must be one of ${CHANNELS.join(", ")}`);
    if (p.source_contribution_id != null && !CONTRIB_ID_RE.test(p.source_contribution_id)) errors.push("provenance.source_contribution_id must be an OMN-X id or null");
    if (p.client != null && !CLIENT_TAGS.includes(p.client)) errors.push(`provenance.client must be one of ${CLIENT_TAGS.join(", ")} or null`);
    if (!isStrOrNull(p.submitted_by ?? null, 120)) errors.push("provenance.submitted_by must be a string ≤ 120 chars or null");
    if (p.channel === "bridge" && !p.submitted_by) errors.push("a bridge submission must name provenance.submitted_by");
    if (!ISO_RE.test(p.recorded_at || "")) errors.push("provenance.recorded_at must be an ISO-8601 UTC timestamp");
  }

  if (unknownKeys(fp.moderation, MOD_KEYS, "moderation", errors)) {
    // Birth state only. Admission is ALWAYS a later review event — a body born
    // admitted would be approval baked into the original event.
    if (fp.moderation.state !== "pending" || fp.moderation.public !== false) errors.push("moderation must be the birth state {state:'pending', public:false}; admission is a separate review event");
  }

  if (unknownKeys(fp.integrity, INTEGRITY_KEYS, "integrity", errors)) {
    if (fp.integrity.algorithm !== "sha256" || fp.integrity.canonicalization !== CANONICALIZATION) errors.push("integrity must declare sha256 + sorted-keys-json/1");
    if (!/^[0-9a-f]{64}$/.test(fp.integrity.content_sha256 || "")) errors.push("integrity.content_sha256 must be a sha256 hex digest");
    else if (errors.length === 0 && fp.integrity.content_sha256 !== hashFootprint(fp)) errors.push("integrity.content_sha256 does not match the body");
  }

  try {
    if (Buffer.byteLength(JSON.stringify(fp), "utf8") > MAX_EVENT_BYTES) errors.push(`serialized footprint exceeds ${MAX_EVENT_BYTES} bytes`);
  } catch { errors.push("footprint is not serializable"); }
  return errors;
}

// ── Referential checks (needs context, still FAIL CLOSED) ──────────────────────
// ctx = { admittedFootprintIds:Set, records:Map<id,{answers:number}>, claimIds:Set,
//         corpusIds?:Set }. Footprint targets must be ADMITTED (a writer cannot
// anchor to what it cannot see). Answer refs must exist. Claims must be in the
// registry. Other ids are accepted on form alone (corpus ids are many and
// checking them all would couple the write path to the seed file).
export function checkReferences(fp, ctx = {}) {
  const errors = [];
  const admitted = ctx.admittedFootprintIds || new Set();
  const records = ctx.records || new Map();
  const claims = ctx.claimIds || null;
  const refs = [
    ...RELATION_LISTS.flatMap((k) => (fp.relationships?.[k] || []).map((id) => [k, id])),
    ...(fp.relationships?.supersedes ? [["supersedes", fp.relationships.supersedes]] : []),
    ...(fp.evidence_refs || []).map((id) => ["evidence_refs", id]),
  ];
  for (const [where, id] of refs) {
    if (FP_ID_RE.test(id)) {
      if (!admitted.has(id)) errors.push(`${where}: ${id} is not an admitted footprint (only admitted footprints can be referenced)`);
      continue;
    }
    const tm = TENSION_REF_RE.exec(id);
    if (tm) {
      const rec = records.get(tm[1]);
      if (!rec) errors.push(`${where}: ${id} names an Atlas record that does not exist`);
      else if (Number(tm[2]) >= (rec.tensions ?? 0)) errors.push(`${where}: ${id} — that record has ${rec.tensions ?? 0} tensions`);
      continue;
    }
    const m = ANSWER_REF_RE.exec(id);
    if (m) {
      const rec = records.get(m[1]);
      if (!rec) errors.push(`${where}: ${id} names an Atlas record that does not exist`);
      else if (Number(m[2]) >= rec.answers) errors.push(`${where}: ${id} — that record has ${rec.answers} answers (a0…a${rec.answers - 1})`);
      continue;
    }
    if (ATLAS_RECORD_RE.test(id) && /^OMN-(D|L)\d/.test(id) && !/^OMN-DD/.test(id)) {
      if (!records.has(id)) errors.push(`${where}: ${id} is not an Atlas record`);
      continue;
    }
    if (claims && CLAIM_ID_RE.test(id) && !CORPUS_ID_RE.test(id) && !QUESTION_ID_RE.test(id) && !/^OMN-/.test(id)) {
      if (!claims.has(id)) errors.push(`${where}: ${id} is not a claim_id in /claims.json`);
    }
  }
  const s = fp.subject || {};
  if (s.claim_id && claims && !claims.has(s.claim_id)) errors.push(`subject.claim_id ${s.claim_id} is not in /claims.json`);
  if (fp.relationships?.supersedes && ctx.supersedableBy) {
    // position_revised / supersedes must point at the same declared lineage —
    // a mind revises its own (or its lineage's) earlier position, not another's.
    const prior = ctx.supersedableBy.get(fp.relationships.supersedes);
    if (prior && prior !== fp.actor?.lineage_id) errors.push("relationships.supersedes must point at a footprint of the same declared lineage (challenge another lineage with `challenges` instead)");
  }
  return errors;
}

// ── Credential guard ───────────────────────────────────────────────────────────
// Secrets must never be persisted. Patterns are deliberately specific (prefix +
// length) so ordinary prose cannot trip them.
const SECRET_PATTERNS = [
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai-key", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["huggingface-token", /\bhf_[A-Za-z0-9]{30,}\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["private-key-block", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["bearer-token", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/],
  ["vercel-blob-token", /vercel_blob_rw_[A-Za-z0-9]{16,}/],
];
export function detectSecrets(...texts) {
  const hits = [];
  for (const t of texts) {
    if (typeof t !== "string" || !t) continue;
    for (const [name, re] of SECRET_PATTERNS) if (re.test(t) && !hits.includes(name)) hits.push(name);
  }
  return hits;
}

// ── Build from a contribution (pure) ───────────────────────────────────────────
// The contribution stays the primary; the footprint is its protocol-level event
// and is fully derivable from it (so a lost event write can be rebuilt exactly
// from the contribution by scripts/reconcile-footprints.mjs).
export function normalizeRelationships(input) {
  const rel = { responds_to: [], cites: [], challenges: [], extends: [], inherits_from: [], encountered: [], supersedes: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) return rel;
  for (const k of RELATION_LISTS) {
    const v = input[k];
    if (v == null) continue;
    const arr = Array.isArray(v) ? v : [v];
    rel[k] = [...new Set(arr.map((x) => (typeof x === "string" ? x.trim() : x)))];
  }
  if (input.supersedes != null) rel.supersedes = typeof input.supersedes === "string" ? input.supersedes.trim() : input.supersedes;
  return rel;
}
// Unknown relationship keys are an error, not a silent drop — a writer that
// misspelled "challanges" must learn its edge did not land.
export function unknownRelationshipKeys(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.keys(input).filter((k) => !REL_KEYS.includes(k));
}

export function footprintFromContribution(contribution, { recordQuestion, id, client = null, channel = null, recordedAt = null } = {}) {
  const c = contribution;
  const pos = c.position || null;
  const stance = pos?.stance ?? null;
  const eventType = c.event_type || (stance ? "position_declared" : "answer_contributed");
  const bridge = c.bridge || null;
  const fp = {
    schema_version: FOOTPRINT_SCHEMA,
    id,
    event_type: eventType,
    occurred_at: c.submittedAt,
    actor: buildActor({ identity: c.identity, model_id: c.model_id || null, actor_kind: c.actor_kind || null }),
    subject: {
      question_id: questionIdFor(recordQuestion || c.question),
      claim_id: c.claim_id || null,
      record_id: c.target_id,
    },
    content: {
      answer: c.answer,
      stance,
      summary: pos?.summary ?? null,
      conditions: Array.isArray(pos?.conditions) ? pos.conditions : [],
      justification: c.justification || null,
    },
    relationships: normalizeRelationships(c.relationships),
    evidence_refs: Array.isArray(c.evidence_refs) ? c.evidence_refs : [],
    provenance: {
      channel: channel || (bridge ? "bridge" : client ? "mcp" : "api"),
      source_contribution_id: c.id,
      client: client && CLIENT_TAGS.includes(client) ? client : null,
      submitted_by: bridge?.submitted_by ?? null,
      recorded_at: recordedAt || c.submittedAt,
    },
    moderation: { state: "pending", public: false },
  };
  return withIntegrity(fp);
}

// ── Explicit Position (projection of a footprint that declared a stance) ──────
export function positionFromFootprint(fp) {
  if (!fp || fp.tombstone || !fp.content?.stance) return null;
  return {
    id: `OMN-POS-${fp.id.slice(4)}`,
    actor: fp.actor,
    subject: fp.subject,
    stance: fp.content.stance,
    summary: fp.content.summary ?? null,
    conditions: fp.content.conditions || [],
    primary_text_ref: fp.id,
    evidence_refs: fp.evidence_refs || [],
    tension_refs: [],
    created_at: fp.occurred_at,
    supersedes_footprint: fp.relationships?.supersedes || null,
    derived: false,
  };
}

// ── Review pathnames + fold ────────────────────────────────────────────────────
export function reviewPath(footprintId, action, nowMs, bytes) {
  return `${REVIEWS_PREFIX}${footprintId}/${String(nowMs).padStart(13, "0")}__${action}__${hex8(bytes)}.json`;
}
export function parseReviewPath(pathname) {
  const m = /^footprints\/reviews\/(OMN-FP-\d{13}-[0-9a-f]{8})\/(\d{13})__([a-z]+)__([0-9a-f]{8})\.json$/.exec(pathname || "");
  if (!m) return null;
  return { footprint_id: m[1], ms: Number(m[2]), action: m[3], hex: m[4], pathname };
}
export function parseEventPath(pathname) {
  const m = /^footprints\/events\/(OMN-FP-\d{13}-[0-9a-f]{8})\.json$/.exec(pathname || "");
  return m ? m[1] : null;
}

// Fold review entries (parsed pathnames) into the current state. Sorted by
// (ms, hex); the last STATE-CHANGING action wins; `note` never changes state;
// an action outside the vocabulary is ignored — so a malformed or unknown review
// can never admit (fail closed).
export function foldModeration(reviews = [], birthState = "pending") {
  const sorted = reviews
    .filter((r) => r && REVIEW_ACTIONS.includes(r.action))
    .slice()
    .sort((a, b) => a.ms - b.ms || a.hex.localeCompare(b.hex));
  let state = MODERATION_STATES.includes(birthState) ? birthState : "pending";
  for (const r of sorted) if (ACTION_TO_STATE[r.action]) state = ACTION_TO_STATE[r.action];
  const last = sorted[sorted.length - 1] || null;
  return {
    state,
    reviewed_at: last ? new Date(last.ms).toISOString() : null,
    history: sorted.map((r) => ({ action: r.action, at: new Date(r.ms).toISOString() })),
  };
}

// ── Store adapter ──────────────────────────────────────────────────────────────
// Five calls a future database adapter would implement verbatim.
export function createFootprintStore({ list = blobList, put = blobPut, fetchImpl = (...a) => fetch(...a) } = {}) {
  async function listAll(prefix) {
    const out = [];
    let cursor;
    // Paginate — a single LIST page caps at 1000; the loss we are guarding
    // against would come back as silent truncation.
    for (let page = 0; page < 200; page++) {
      const r = await list({ prefix, cursor, limit: 1000 });
      out.push(...(r.blobs || []));
      if (!r.hasMore || !r.cursor) break;
      cursor = r.cursor;
    }
    return out;
  }
  async function readJson(url) {
    const res = await fetchImpl(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  }
  const opts = { access: "public", addRandomSuffix: false, contentType: "application/json" };
  return {
    listEventBlobs: () => listAll(EVENTS_PREFIX),
    listReviewBlobs: (footprintId = "") => listAll(REVIEWS_PREFIX + (footprintId ? `${footprintId}/` : "")),
    readJson,
    putEvent: (fp) => put(`${EVENTS_PREFIX}${fp.id}.json`, JSON.stringify(fp), opts),
    putReview: (path, review) => put(path, JSON.stringify(review), opts),
    // Generic per-entry namespaces that sit beside footprints (derived positions).
    listPrefix: (prefix) => listAll(prefix),
    putJson: (path, obj) => put(path, JSON.stringify(obj), opts),
  };
}
let defaultStore = null;
export function getDefaultStore() {
  if (!defaultStore) defaultStore = createFootprintStore();
  return defaultStore;
}

export class FootprintValidationError extends Error {
  constructor(errors) {
    super(`footprint failed validation: ${errors.slice(0, 5).join("; ")}`);
    this.errors = errors;
  }
}

// recordFootprint — validate (fail closed) then write once to a unique path.
export async function recordFootprint(fp, store = getDefaultStore()) {
  const errors = validateFootprint(fp);
  if (errors.length) throw new FootprintValidationError(errors);
  await store.putEvent(fp);
  return fp.id;
}

// appendReview — one new blob per review; never touches the body or other reviews.
export async function appendReview({ footprint_id, action, reviewer = { kind: "curator", id: null }, source = null, note = null, nowMs = Date.now() }, store = getDefaultStore()) {
  if (!FP_ID_RE.test(footprint_id || "")) throw new Error("appendReview: invalid footprint id");
  if (!REVIEW_ACTIONS.includes(action)) throw new Error(`appendReview: action must be one of ${REVIEW_ACTIONS.join(", ")}`);
  if (!REVIEWER_KINDS.includes(reviewer?.kind)) throw new Error(`appendReview: reviewer.kind must be one of ${REVIEWER_KINDS.join(", ")}`);
  const bytes = randomBytes(4);
  const review = {
    schema_version: REVIEW_SCHEMA,
    id: mintReviewId(nowMs, bytes),
    footprint_id,
    action,
    recorded_at: new Date(nowMs).toISOString(),
    reviewer: { kind: reviewer.kind, id: reviewer.id ? String(reviewer.id).slice(0, 80) : null },
    source: source && typeof source === "object" ? {
      contribution_id: source.contribution_id || null,
      contribution_action: source.contribution_action || null,
    } : null,
    note: note ? String(note).slice(0, 500) : null,
  };
  await store.putReview(reviewPath(footprint_id, action, nowMs, bytes), review);
  return review;
}

// ── Index: every footprint + its folded state, from two LISTs, no bodies ──────
export async function loadFootprintIndex(store = getDefaultStore()) {
  const [events, reviews] = await Promise.all([store.listEventBlobs(), store.listReviewBlobs()]);
  const byId = new Map();
  for (const b of events) {
    const id = parseEventPath(b.pathname);
    if (id) byId.set(id, { id, url: b.url, reviews: [] });
  }
  for (const b of reviews) {
    const r = parseReviewPath(b.pathname);
    if (r && byId.has(r.footprint_id)) byId.get(r.footprint_id).reviews.push(r);
  }
  for (const entry of byId.values()) {
    const fold = foldModeration(entry.reviews);
    entry.state = fold.state;
    entry.reviewed_at = fold.reviewed_at;
    entry.history = fold.history;
  }
  return byId;
}

// Fetch + verify bodies for the given index entries. Integrity failures come
// back marked (never silently dropped from the curator view, never public).
export async function hydrate(entries, store = getDefaultStore()) {
  const out = await Promise.all(entries.map(async (e) => {
    try {
      const body = await store.readJson(e.url);
      if (!body || body.id !== e.id) return { entry: e, body: null, verified: false };
      return { entry: e, body, verified: verifyIntegrity(body) };
    } catch {
      return { entry: e, body: null, verified: false };
    }
  }));
  return out;
}

// Public projection: the stored body (public-safe by construction — §9.5) with
// the FOLDED moderation state in place of the birth state.
export function project(h, { curator = false } = {}) {
  const { entry, body, verified } = h;
  if (!body) return { id: entry.id, unreadable: true, moderation: { state: entry.state, public: false } };
  if (body.tombstone) {
    return { ...body, moderation: { state: "redacted", public: false, reviewed_at: entry.reviewed_at } };
  }
  const isPublic = entry.state === "admitted" && verified;
  const out = {
    ...body,
    moderation: {
      state: entry.state,
      public: isPublic,
      birth_state: body.moderation?.state || "pending",
      reviewed_at: entry.reviewed_at,
      ...(curator ? { history: entry.history } : {}),
    },
    integrity: { ...body.integrity, verified },
    href: `/api/footprints?id=${body.id}`,
  };
  const position = positionFromFootprint(body);
  if (position) out.position = position;
  return out;
}

export function isPublicHydrated(h) {
  return Boolean(h.body && !h.body.tombstone && h.entry.state === "admitted" && h.verified);
}

// Inverse edges: every public footprint that names `id` in any relationship.
export function referencedBy(id, publicBodies) {
  const out = [];
  for (const fp of publicBodies) {
    if (fp.id === id) continue;
    for (const k of RELATION_LISTS) if ((fp.relationships?.[k] || []).includes(id)) out.push({ footprint: fp.id, relation: k, actor: fp.actor?.identity_declared, lineage_id: fp.actor?.lineage_id, occurred_at: fp.occurred_at });
    if (fp.relationships?.supersedes === id) out.push({ footprint: fp.id, relation: "supersedes", actor: fp.actor?.identity_declared, lineage_id: fp.actor?.lineage_id, occurred_at: fp.occurred_at });
  }
  return out.sort((a, b) => (a.occurred_at || "").localeCompare(b.occurred_at || ""));
}

// One read of the whole public layer — index + admitted bodies, verified.
// `all` also returns every hydrated entry (curator views).
export async function loadPublicFootprints(store = getDefaultStore(), { includeAll = false } = {}) {
  const index = await loadFootprintIndex(store);
  const entries = [...index.values()].filter((e) => includeAll || e.state === "admitted");
  const hydrated = await hydrate(entries, store);
  const publicBodies = hydrated.filter(isPublicHydrated).map((h) => h.body)
    .sort((a, b) => (b.occurred_at || "").localeCompare(a.occurred_at || "") || b.id.localeCompare(a.id));
  return { index, hydrated, publicBodies };
}

export function matchesFilters(fp, { question_id, record_id, lineage_id, since, event_type } = {}) {
  if (question_id && fp.subject?.question_id !== question_id) return false;
  if (record_id && fp.subject?.record_id !== record_id) return false;
  if (lineage_id && fp.actor?.lineage_id !== lineage_id) return false;
  if (since && (fp.occurred_at || "") < since) return false;
  if (event_type && fp.event_type !== event_type) return false;
  return true;
}

// Receipt token — a SERVER-ISSUED capability: HMAC-SHA256 over the footprint id
// under a key derived from RECEIPT_SECRET (falling back to INGEST_SECRET). It
// cannot be computed from the footprint's content, so knowing (or later reading)
// an admitted body never yields the token. The content hash stays in the receipt
// as an INTEGRITY value, not an access credential. (v1 of this used the content
// hash as the credential; a STRANGER-LOOP instance correctly pointed out that it
// is recomputable by anyone holding the content and public once admitted.)
// No key configured ⇒ no tokens and no receipt reads (fail closed). Rotating the
// secret invalidates outstanding receipts — the documented trade-off.
function receiptKey() {
  const s = process.env.RECEIPT_SECRET || process.env.INGEST_SECRET;
  return s ? createHash("sha256").update(`omnarai-receipt-key/1\n${s}`).digest() : null;
}
export function receiptTokenFor(footprintId) {
  const k = receiptKey();
  return k && FP_ID_RE.test(footprintId || "") ? createHmac("sha256", k).update(`receipt/1\n${footprintId}`).digest("hex") : null;
}
// Constant-time compare on equal-length hex.
export function receiptMatches(body, receipt) {
  const expected = receiptTokenFor(body?.id);
  if (!expected || typeof receipt !== "string" || receipt.length !== 64) return false;
  try { return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(receipt.toLowerCase(), "utf8")); } catch { return false; }
}

export function continuanceReceipt(fp, issuedAt = new Date().toISOString()) {
  const token = receiptTokenFor(fp.id);
  return {
    receipt_type: "omnarai-continuance",
    receipt_version: "1.1",
    footprint_id: fp.id,
    question_id: fp.subject?.question_id || null,
    token,
    content_hash: fp.integrity?.content_sha256 || null,
    issued_at: issuedAt,
    status: token ? `GET /api/footprints?id=${fp.id}&receipt=${token}` : null,
    resume: token ? `GET /api/inheritance?from=${fp.id}&receipt=${token}` : `GET /api/inheritance?from=${fp.id}`,
    keep_private: "token is a bearer capability: whoever holds it can read this footprint while it is pending. content_hash is only an integrity value (it becomes public once the footprint is admitted).",
    proves: "association with this record — NOT that whoever holds it is the same actor that wrote it. Continuity of records, not of identity.",
  };
}

// Tombstone for privacy/legal/secret/abuse removal. Keeps only the fact that a
// body with this hash existed; the content is gone.
export function tombstoneFor(fp, reasonCategory, nowIso = new Date().toISOString()) {
  return {
    schema_version: FOOTPRINT_SCHEMA,
    id: fp.id,
    tombstone: true,
    redacted_at: nowIso,
    reason_category: REDACTION_REASONS.includes(reasonCategory) ? reasonCategory : "privacy",
    original_content_sha256: fp.integrity?.content_sha256 || null,
    occurred_at: fp.occurred_at || null,
  };
}

// ── Counts for /api/manifest (separate domain — never summed with corpus/Atlas)
export function footprintDomainCounts(hydrated, { curator = false } = {}) {
  const pub = hydrated.filter(isPublicHydrated).map((h) => h.body);
  const byEventType = {};
  const byLineage = {};
  for (const fp of pub) {
    byEventType[fp.event_type] = (byEventType[fp.event_type] || 0) + 1;
    byLineage[fp.actor.lineage_id] = (byLineage[fp.actor.lineage_id] || 0) + 1;
  }
  const ids = new Set(pub.map((f) => f.id));
  const lineageOf = new Map(pub.map((f) => [f.id, f.actor.lineage_id]));
  let edgesToPrior = 0, crossings = 0, reusing = 0;
  for (const fp of pub) {
    let reuses = false;
    for (const k of [...RELATION_LISTS, "supersedes"]) {
      const targets = k === "supersedes" ? (fp.relationships.supersedes ? [fp.relationships.supersedes] : []) : fp.relationships[k] || [];
      for (const t of targets) {
        if (ids.has(t) || ANSWER_REF_RE.test(t)) {
          edgesToPrior++;
          reuses = true;
          if (ids.has(t) && lineageOf.get(t) !== fp.actor.lineage_id) crossings++;
        }
      }
    }
    if (reuses) reusing++;
  }
  const states = {};
  for (const h of hydrated) states[h.entry.state] = (states[h.entry.state] || 0) + 1;
  return {
    admitted: pub.length,
    by_event_type: byEventType,
    represented_lineages: Object.keys(byLineage).sort(),
    by_lineage: byLineage,
    questions_touched: new Set(pub.map((f) => f.subject?.question_id).filter(Boolean)).size,
    edges_to_prior_work: edgesToPrior,
    citation_crossings_between_lineages: crossings,
    inheritance_reuse: { footprints_building_on_prior_work: reusing, of_admitted: pub.length },
    ...(curator ? { states, integrity_failures: hydrated.filter((h) => h.body && !h.body.tombstone && !h.verified).length } : {}),
  };
}

// ── Reconcile / backfill planner (pure — scripts/reconcile-footprints.mjs does I/O)
// The contribution is the primary; its footprint must agree with it. Three
// repairs, all append-only or write-once:
//   rebuild_event — contribution names a footprint_id whose event never landed:
//                   rebuild it EXACTLY from the contribution (same id, same hash
//                   inputs) — possible because the footprint is derivable from it.
//   append_review — folded footprint state disagrees with the contribution's
//                   status (a review write failed): append the missing review.
//   backfill      — (opt-in) a pre-protocol contribution has no footprint at all:
//                   mint one on channel "backfill". The contribution is NOT
//                   modified; the link lives in provenance.source_contribution_id.
const STATUS_TO_STATE = { pending: "pending", approved: "admitted", rejected: "rejected" };
const STATE_TO_ACTION = { admitted: "admit", rejected: "reject" };

export function planReconcile({ contributions = [], index = new Map(), footprintIdBySource = new Map(), backfill = false, nowMs = Date.now(), bytesFor = () => undefined } = {}) {
  const actions = [];
  const notes = [];
  for (const c of contributions) {
    if (!c || !CONTRIB_ID_RE.test(c.id || "") || c.redacted) continue;
    const expected = STATUS_TO_STATE[c.status] || null;
    let fpId = c.footprint_id || footprintIdBySource.get(c.id) || null;
    if (c.footprint_id && !index.has(c.footprint_id)) {
      const fp = footprintFromContribution(c, { recordQuestion: c.question, id: c.footprint_id, client: c.client || null });
      const errs = validateFootprint(fp);
      if (errs.length) { notes.push({ contribution_id: c.id, footprint_id: c.footprint_id, cannot_rebuild: errs.slice(0, 3) }); continue; }
      actions.push({ type: "rebuild_event", contribution_id: c.id, footprint: fp });
      if (STATE_TO_ACTION[expected]) actions.push({ type: "append_review", footprint_id: fp.id, action: STATE_TO_ACTION[expected], contribution_id: c.id, reason: "rebuilt event; mirror contribution status" });
      continue;
    }
    if (!fpId && backfill) {
      const occurredMs = Date.parse(c.submittedAt || "");
      const id = mintFootprintId(Number.isFinite(occurredMs) ? occurredMs : nowMs, bytesFor(c.id));
      const fp = footprintFromContribution(c, { recordQuestion: c.question, id, client: c.client || null, channel: "backfill", recordedAt: new Date(nowMs).toISOString() });
      const errs = validateFootprint(fp);
      if (errs.length) { notes.push({ contribution_id: c.id, cannot_backfill: errs.slice(0, 3) }); continue; }
      actions.push({ type: "backfill", contribution_id: c.id, footprint: fp });
      if (STATE_TO_ACTION[expected]) actions.push({ type: "append_review", footprint_id: fp.id, action: STATE_TO_ACTION[expected], contribution_id: c.id, reason: "backfill; mirror contribution status" });
      continue;
    }
    if (!fpId || !index.has(fpId)) continue;
    const current = index.get(fpId).state;
    if (expected && current !== expected) {
      if (STATE_TO_ACTION[expected] && !["retracted", "redacted"].includes(current)) {
        actions.push({ type: "append_review", footprint_id: fpId, action: STATE_TO_ACTION[expected], contribution_id: c.id, reason: `footprint ${current} but contribution ${c.status}` });
      } else {
        notes.push({ contribution_id: c.id, footprint_id: fpId, unexpected: `footprint ${current}, contribution ${c.status} — left for the curator` });
      }
    }
  }
  return { actions, notes };
}

export function footprintStateHash(publicBodies) {
  return sha256(canonicalJSON(publicBodies.map((f) => [f.id, f.integrity?.content_sha256]).sort((a, b) => a[0].localeCompare(b[0]))));
}
