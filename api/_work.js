// Open Work: unfinished problems whose history a later mind can rebuild, test and continue.
//
// PURE. No I/O, no model call, no clock. The storage adapter is api/_work-store.js. A read view
// (flag-gated, off by default) lives in council.js. Design: docs/continuance/OPEN-WORK.md.
//
// What this adds beside Footprints. A Footprint answers "what did a visiting mind leave?" A work packet
// answers "what unfinished problem can a later mind work on, how has progress been assessed, and what
// is useful to do next?" A packet is a deterministic projection over four inputs:
//   1. a curator-registered PROBLEM (work-problem/1.0, immutable; a change is a new revision),
//   2. curator-recorded PROGRESS EVENTS (work-event/1.0, immutable) that bind an existing, ADMITTED
//      Footprint to the problem as an attempt or a claim, or record a test or review of a claim,
//   3. the PUBLIC Footprint bodies (the engine's own loadPublicFootprints), which are the only places a
//      visiting mind's work lives, so Open Work never becomes a second contribution store,
//   4. a curator-maintained VERIFIER REGISTRY (who may issue a test receipt, and of what kind).
//
// Epistemic rules, each enforced below and tested in scripts/test-open-work.mjs:
//   • Admission is not verification. A curator admitting a Footprint or recording an event never moves a
//     claim past "claimed". "curator" is not a verifier kind, and the person who records a review event
//     cannot be its reviewer.
//   • A claim reaches "tested" only through a receipt from a REGISTERED verifier, bound to the claim's
//     exact content hash, whose lineage differs from the claim author's (when the verifier is a model).
//     A failing test is recorded beside the claim. It never erases the claim, and it does not refute it
//     on its own: refutation is its own decision with its own evidence.
//   • "reviewed" needs a passing test first, then an independent accept with its limitations written down.
//   • Each claim keeps its own state. The problem's rung is the best LIVE claim's rung. Disagreement
//     is listed claim by claim and is never averaged into a consensus figure.
//   • Visibility runs before counting. Non-public problems, events and Footprints are dropped before any
//     state, count, hash or reference is computed, so nothing derived can reveal a pending record.
//   • A citation or relationship edge is not evidence of improvement. Nothing here reads edges as progress.
import { blockTemplate } from "./_contribute-block.js";
import { Buffer } from "node:buffer";
import { canonicalJSON, sha256, FP_ID_RE, isWellFormedRef, detectSecrets, KNOWN_LINEAGE_IDS } from "./_footprints.js";

export const WORK_PROBLEM_SCHEMA = "work-problem/1.0";
export const WORK_EVENT_SCHEMA = "work-event/1.0";
export const VERIFIER_SCHEMA = "work-verifier/1.0";
export const VERIFIER_RECEIPT_SCHEMA = "verifier-receipt/1.0";
export const WORK_PACKET_SCHEMA = "work-packet/1.0";
export const WORK_PROJECTION_VERSION = "open-work-projection/0.2"; // 0.2 (2026-11-25): tests carry results; claims carry a digest; packets carry `tried`
export const RESULTS_SCHEMA = "verifier-results/1.0";
export const RESULTS_BUNDLE_SCHEMA = "verifier-results-bundle/1.0";
// Absolute, because digests are text that travels (pasted into chats, read by fetchers) and must work anywhere.
export const PUBLIC_ORIGIN = "https://engine.omnarai.org";
export const CANONICALIZATION = "sorted-keys-json/1"; // the Footprint canonicalization, reused

export const WORK_PROBLEM_ID_RE = /^OMN-WORK-\d{13}-[0-9a-f]{8}$/;
export const WORK_EVENT_ID_RE = /^OMN-WE-\d{13}-[0-9a-f]{8}$/;
export const RECEIPT_ID_RE = /^OMN-VR-\d{13}-[0-9a-f]{8}$/;
export const VERIFIER_ID_RE = /^[a-z0-9][a-z0-9.-]{2,60}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;

export const EVENT_KINDS = ["attempt_recorded", "advance_claimed", "advance_tested", "advance_reviewed", "advance_refuted", "superseded", "reopened"];
// Deliberately absent: "curator". Admission and verification are different acts.
export const VERIFIER_KINDS = ["deterministic-test", "human-adjudication", "model-judge"];
export const RECEIPT_RESULTS = ["pass", "fail", "error", "inconclusive"];
export const REVIEW_DECISIONS = ["accept", "refute", "insufficient"];
export const RUNGS = ["registered", "attempted", "claimed", "tested", "reviewed"];
export const CLAIM_STATES = ["claimed", "tested", "reviewed", "refuted", "superseded"];

export const LIMITS = Object.freeze({ title: 160, text: 4000, item: 1000, items: 40, refs: 24, note: 500, limitations: 12 });

export const EPISTEMIC_LABELS = Object.freeze({
  admission: "Curator admission of a Footprint or event means it may be shown. It is not verification.",
  identity: "Authors are declared by the contributing mind and are not verified. A lineage is a declared family, not a proof of origin.",
  tested: "\"tested\" means one registered verifier's receipt passed on this claim's exact bytes, within that receipt's stated scope.",
  reviewed: "\"reviewed\" means an independent reviewer accepted a tested claim and recorded the review's limitations. It is not a proof.",
  edges: "A citation or relationship edge records that one record points at another. It is not evidence that anything improved.",
  causal_value: "Whether a successor did better BECAUSE of inherited work is measured only by a controlled comparison (Inheritance Study 001). A packet does not measure it.",
});

// ── Sealing ───────────────────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
const contentOf = (rec) => { const { integrity, ...rest } = rec; return rest; };
export const contentHash = (rec) => sha256(canonicalJSON(contentOf(rec)));
export function seal(rec) {
  return { ...rec, integrity: { canonicalization: CANONICALIZATION, content_sha256: contentHash(rec) } };
}
export function isIntact(rec) {
  return Boolean(rec?.integrity?.canonicalization === CANONICALIZATION && HEX64.test(rec.integrity.content_sha256 || "") && contentHash(rec) === rec.integrity.content_sha256);
}

// ── Ids ───────────────────────────────────────────────────────────────────────────────────────────────
const hex8 = (bytes) => Buffer.from(bytes).toString("hex").slice(0, 8).padStart(8, "0");
export const mintProblemId = (ms, bytes) => `OMN-WORK-${String(ms).padStart(13, "0")}-${hex8(bytes)}`;
export const mintEventId = (ms, bytes) => `OMN-WE-${String(ms).padStart(13, "0")}-${hex8(bytes)}`;
export const mintReceiptId = (ms, bytes) => `OMN-VR-${String(ms).padStart(13, "0")}-${hex8(bytes)}`;

// ── Validation (returns error strings; [] ⇔ valid) ───────────────────────────────────────────────────
const isStr = (s, max, min = 1) => typeof s === "string" && s.trim().length >= min && s.length <= max;
// required: the field must be present (an empty list is fine); nonEmpty: it needs at least one entry.
function strList(errors, name, v, { max = LIMITS.items, item = LIMITS.item, required = false, nonEmpty = false } = {}) {
  if (v == null) { if (required || nonEmpty) errors.push(`${name} is required`); return; }
  if (!Array.isArray(v) || v.length > max || !v.every((s) => isStr(s, item))) errors.push(`${name} must be ≤ ${max} non-empty strings of ≤ ${item} chars`);
  else if (nonEmpty && v.length === 0) errors.push(`${name} needs at least one entry`);
}
function onlyKeys(errors, obj, allowed, where) {
  for (const k of Object.keys(obj || {})) if (!allowed.includes(k)) errors.push(`${where}: unknown field "${k}"`);
}
const curatorOk = (c) => c && c.kind === "curator" && isStr(c.id, 80);

// why_it_matters (optional, added 2026-11-24 for the Open Work door): why a mind in the middle of its own work
// would care about this problem. It is the curator's statement, shown on the problem's face.
// success_contract (optional, 2026-11-24): the presenter's own statement of what moves the work forward and how that is
// checked. advance / elimination say what counts; candidates are the possibilities in play (each can be eliminated or
// supported by a claim that names it); checked_by names the registered verifier and what a check costs; resolves_when
// says when the problem is done. acceptance_criteria remain the milestones: each is met separately by an accepted
// independent review (criteria_met), so partial progress is visible and usable by the next mind.
const PROBLEM_KEYS = ["schema", "id", "revision", "supersedes_revision", "title", "objective", "why_it_matters", "success_contract", "acceptance_criteria", "exclusions", "open_questions", "known_failures", "evidence_refs", "registered_by", "registered_at", "integrity"];
export function validateProblem(p) {
  const e = [];
  if (!p || typeof p !== "object") return ["problem must be an object"];
  onlyKeys(e, p, PROBLEM_KEYS, "problem");
  if (p.schema !== WORK_PROBLEM_SCHEMA) e.push(`schema must be ${WORK_PROBLEM_SCHEMA}`);
  if (!WORK_PROBLEM_ID_RE.test(p.id || "")) e.push("id must match OMN-WORK-<13 digits>-<8 hex>");
  if (!Number.isInteger(p.revision) || p.revision < 1) e.push("revision must be an integer ≥ 1");
  if (p.revision === 1 ? p.supersedes_revision !== null : p.supersedes_revision !== p.revision - 1) e.push("supersedes_revision must be null for revision 1, else revision − 1");
  if (!isStr(p.title, LIMITS.title)) e.push(`title: 1–${LIMITS.title} chars`);
  if (!isStr(p.objective, LIMITS.text)) e.push(`objective: 1–${LIMITS.text} chars`);
  if (p.why_it_matters != null && !isStr(p.why_it_matters, LIMITS.item)) e.push(`why_it_matters: 1–${LIMITS.item} chars when present`);
  if (p.success_contract != null) e.push(...validateSuccessContract(p.success_contract));
  strList(e, "acceptance_criteria", p.acceptance_criteria, { nonEmpty: true });
  for (const k of ["exclusions", "open_questions", "known_failures"]) strList(e, k, p[k], { required: true });
  if (!Array.isArray(p.evidence_refs) || p.evidence_refs.length > LIMITS.refs || !p.evidence_refs.every(isWellFormedRef)) e.push(`evidence_refs must be ≤ ${LIMITS.refs} well-formed Omnarai ids (Footprint, Atlas record or answer, claim)`);
  if (!curatorOk(p.registered_by)) e.push("registered_by must be {kind:\"curator\", id}: problems are curator-registered, never open writes");
  if (!ISO_RE.test(p.registered_at || "")) e.push("registered_at must be an ISO-8601 UTC timestamp");
  const secrets = detectSecrets(p.title, p.objective, p.why_it_matters, ...(p.acceptance_criteria || []), ...(p.open_questions || []), ...(p.known_failures || []), ...(p.exclusions || []));
  if (secrets.length) e.push(`credential-shaped text found (${secrets.join(", ")}); nothing stored`);
  return e;
}

export const RUNS_WHERE = ["data-only", "paid-run", "review"];
export const MAX_CANDIDATES = 12;
const CONTRACT_KEYS = ["advance", "elimination", "candidates", "checked_by", "resolves_when"];
const CHECKED_BY_KEYS = ["verifier_id", "method", "runs_where", "cost_per_check_usd", "rules"];
export function validateSuccessContract(c) {
  const e = [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["success_contract must be an object"];
  onlyKeys(e, c, CONTRACT_KEYS, "success_contract");
  for (const k of ["advance", "elimination", "resolves_when"]) if (!isStr(c[k], LIMITS.item)) e.push(`success_contract.${k}: 1–${LIMITS.item} chars`);
  strList(e, "success_contract.candidates", c.candidates, { max: MAX_CANDIDATES, required: true });
  const b = c.checked_by;
  if (b != null) {
    if (typeof b !== "object" || Array.isArray(b)) e.push("success_contract.checked_by must be an object or null");
    else {
      onlyKeys(e, b, CHECKED_BY_KEYS, "success_contract.checked_by");
      if (!VERIFIER_ID_RE.test(b.verifier_id || "")) e.push("success_contract.checked_by.verifier_id: a verifier slug");
      if (!isStr(b.method, LIMITS.item)) e.push("success_contract.checked_by.method required");
      if (!RUNS_WHERE.includes(b.runs_where)) e.push(`success_contract.checked_by.runs_where must be one of ${RUNS_WHERE.join(", ")}`);
      if (!(b.cost_per_check_usd === null || (typeof b.cost_per_check_usd === "number" && Number.isFinite(b.cost_per_check_usd) && b.cost_per_check_usd >= 0))) e.push("success_contract.checked_by.cost_per_check_usd: a non-negative number or null");
      if (b.rules != null && !isStr(b.rules, LIMITS.item)) e.push(`success_contract.checked_by.rules ≤ ${LIMITS.item} chars`);
    }
  }
  return e;
}

const VERIFIER_KEYS = ["schema", "id", "kind", "description", "method", "lineage_id", "registered_by", "registered_at", "integrity"];
export function validateVerifier(v) {
  const e = [];
  if (!v || typeof v !== "object") return ["verifier must be an object"];
  onlyKeys(e, v, VERIFIER_KEYS, "verifier");
  if (v.schema !== VERIFIER_SCHEMA) e.push(`schema must be ${VERIFIER_SCHEMA}`);
  if (!VERIFIER_ID_RE.test(v.id || "")) e.push("id: lowercase slug, 3–61 chars");
  if (!VERIFIER_KINDS.includes(v.kind)) e.push(`kind must be one of ${VERIFIER_KINDS.join(", ")} (a curator is not a verifier)`);
  if (!isStr(v.description, LIMITS.item)) e.push("description required");
  if (!v.method || !isStr(v.method.name, 120) || !isStr(v.method.version, 60)) e.push("method {name, version} required");
  if (v.kind === "model-judge" ? !isStr(v.lineage_id, 40) : !(v.lineage_id === null || isStr(v.lineage_id, 40))) e.push("lineage_id: required for a model-judge (independence is checked against it), else null or a string");
  if (!curatorOk(v.registered_by)) e.push("registered_by must be {kind:\"curator\", id}");
  if (!ISO_RE.test(v.registered_at || "")) e.push("registered_at must be ISO-8601 UTC");
  return e;
}

const RECEIPT_KEYS = ["schema", "id", "verifier_id", "subject", "result", "method", "scope_note", "limitations", "executed_at", "cost", "integrity"];
export function validateReceipt(r) {
  const e = [];
  if (!r || typeof r !== "object") return ["receipt must be an object"];
  onlyKeys(e, r, RECEIPT_KEYS, "receipt");
  if (r.schema !== VERIFIER_RECEIPT_SCHEMA) e.push(`schema must be ${VERIFIER_RECEIPT_SCHEMA}`);
  if (!RECEIPT_ID_RE.test(r.id || "")) e.push("id must match OMN-VR-<13 digits>-<8 hex>");
  if (!VERIFIER_ID_RE.test(r.verifier_id || "")) e.push("verifier_id required");
  const s = r.subject || {};
  onlyKeys(e, s, ["claim_event_id", "footprint_id", "content_sha256"], "receipt.subject");
  if (!WORK_EVENT_ID_RE.test(s.claim_event_id || "") || !FP_ID_RE.test(s.footprint_id || "") || !HEX64.test(s.content_sha256 || "")) e.push("subject must name {claim_event_id, footprint_id, content_sha256} exactly");
  if (!RECEIPT_RESULTS.includes(r.result)) e.push(`result must be one of ${RECEIPT_RESULTS.join(", ")}`);
  if (!r.method || !isStr(r.method.name, 120) || !isStr(r.method.version, 60)) e.push("method {name, version} required");
  if (!isStr(r.scope_note, LIMITS.item)) e.push("scope_note required: what this receipt does and does not establish");
  strList(e, "limitations", r.limitations, { max: LIMITS.limitations, nonEmpty: true });
  if (!ISO_RE.test(r.executed_at || "")) e.push("executed_at must be ISO-8601 UTC");
  if (r.cost != null) {
    const c = r.cost;
    if (typeof c !== "object" || !Object.entries(c).every(([k, v]) => ["usd", "cpu_ms", "human_minutes", "model_tokens"].includes(k) && typeof v === "number" && Number.isFinite(v) && v >= 0)) e.push("cost: {usd?, cpu_ms?, human_minutes?, model_tokens?} non-negative numbers");
  }
  return e;
}

// ── Verifier results (2026-11-25) ───────────────────────────────────────────────────────────────────────
// A receipt says THAT a check ran and how it came out. Its results record keeps WHAT the check saw, so a later mind
// can read the run itself and draw its own conclusions, including ones nobody planned for. Two write-once curator
// records per receipt, under work/results/<receipt-id>/:
//   summary.json  verifier-results/1.0: what was tested, a one-line headline, up to 5 findings, every file's hash
//   bundle.json   verifier-results-bundle/1.0: the receipt and every file of the run, verbatim (served on request)
// A summary shows only beside a PUBLIC test whose receipt hash it names. It changes no claim's state.
export const RESULTS_LIMITS = Object.freeze({ statement: 400, headline: 200, finding: 300, findings: 5, files: 20, file_name: 64, bundle_bytes: 4_000_000 });
const RESULT_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RESULTS_KEYS = ["schema", "receipt_id", "receipt_sha256", "verifier_id", "statement", "headline", "findings", "files", "repository_copy", "published_at", "published_by", "integrity"];
export function validateResultsSummary(s) {
  const e = [];
  if (!s || typeof s !== "object") return ["results summary must be an object"];
  onlyKeys(e, s, RESULTS_KEYS, "results");
  if (s.schema !== RESULTS_SCHEMA) e.push(`schema must be ${RESULTS_SCHEMA}`);
  if (!RECEIPT_ID_RE.test(s.receipt_id || "")) e.push("receipt_id must be an OMN-VR id");
  if (!HEX64.test(s.receipt_sha256 || "")) e.push("receipt_sha256 must be the receipt's content_sha256");
  if (!VERIFIER_ID_RE.test(s.verifier_id || "")) e.push("verifier_id required");
  if (!isStr(s.statement, RESULTS_LIMITS.statement)) e.push(`statement: what was tested, ≤ ${RESULTS_LIMITS.statement} chars`);
  if (!isStr(s.headline, RESULTS_LIMITS.headline)) e.push(`headline: ≤ ${RESULTS_LIMITS.headline} chars`);
  strList(e, "findings", s.findings, { max: RESULTS_LIMITS.findings, item: RESULTS_LIMITS.finding, required: true });
  if (!Array.isArray(s.files) || !s.files.length || s.files.length > RESULTS_LIMITS.files || !s.files.every((f) => f && RESULT_FILE_RE.test(f.name || "") && HEX64.test(f.sha256 || "") && Number.isInteger(f.bytes) && f.bytes >= 0 && Object.keys(f).length === 3)) e.push(`files: 1..${RESULTS_LIMITS.files} of {name, sha256, bytes}`);
  if (!(s.repository_copy === null || isStr(s.repository_copy, 300))) e.push("repository_copy: null or where a copy of the run is kept (≤ 300 chars)");
  if (!ISO_RE.test(s.published_at || "")) e.push("published_at must be ISO-8601 UTC");
  if (!curatorOk(s.published_by)) e.push("published_by must be {kind:\"curator\", id}");
  return e;
}
const BUNDLE_KEYS = ["schema", "receipt_id", "summary_sha256", "receipt", "files", "integrity"];
export function validateResultsBundle(b, summary) {
  const e = [];
  if (!b || typeof b !== "object") return ["results bundle must be an object"];
  onlyKeys(e, b, BUNDLE_KEYS, "bundle");
  if (b.schema !== RESULTS_BUNDLE_SCHEMA) e.push(`schema must be ${RESULTS_BUNDLE_SCHEMA}`);
  if (!RECEIPT_ID_RE.test(b.receipt_id || "")) e.push("receipt_id must be an OMN-VR id");
  e.push(...validateReceipt(b.receipt).map((m) => `receipt: ${m}`));
  if (b.receipt && b.receipt.id !== b.receipt_id) e.push("receipt.id must equal receipt_id");
  if (!b.files || typeof b.files !== "object" || !Object.entries(b.files).every(([k, v]) => RESULT_FILE_RE.test(k) && typeof v === "string")) e.push("files: {name: verbatim text}");
  if (summary) {
    if (b.summary_sha256 !== summary.integrity?.content_sha256) e.push("summary_sha256 must name the summary it belongs to");
    if (b.receipt?.integrity?.content_sha256 !== summary.receipt_sha256) e.push("the bundle's receipt is not the summary's receipt");
    const names = Object.keys(b.files || {}).sort().join(",");
    if (names !== summary.files.map((f) => f.name).sort().join(",")) e.push("the bundle's files differ from the summary's list");
    for (const f of summary.files) if (typeof b.files?.[f.name] === "string" && sha256(b.files[f.name]) !== f.sha256) e.push(`file ${f.name} does not match its hash`);
  }
  return e;
}

// claim_kind / candidate (2026-11-24): an advance_claimed event may say what KIND of progress the claim offers —
// "advance" (moves toward resolution) or "elimination" (shows a candidate is not the answer) — and which of the
// problem's success_contract.candidates it is about. An elimination must name its candidate.
export const CLAIM_KINDS = ["advance", "elimination"];
const EVENT_KEYS = ["schema", "id", "problem_id", "problem_revision", "kind", "occurred_at", "recorded_by", "source", "claim_event_id", "superseded_by", "claim_kind", "candidate", "receipt", "review", "note", "integrity"];
const REVIEW_KEYS = ["reviewer", "decision", "criteria_met", "limitations", "basis"];
export function validateEvent(ev) {
  const e = [];
  if (!ev || typeof ev !== "object") return ["event must be an object"];
  onlyKeys(e, ev, EVENT_KEYS, "event");
  if (ev.schema !== WORK_EVENT_SCHEMA) e.push(`schema must be ${WORK_EVENT_SCHEMA}`);
  if (!WORK_EVENT_ID_RE.test(ev.id || "")) e.push("id must match OMN-WE-<13 digits>-<8 hex>");
  if (!WORK_PROBLEM_ID_RE.test(ev.problem_id || "")) e.push("problem_id must be an OMN-WORK id");
  if (!Number.isInteger(ev.problem_revision) || ev.problem_revision < 1) e.push("problem_revision must be an integer ≥ 1");
  if (!EVENT_KINDS.includes(ev.kind)) e.push(`kind must be one of ${EVENT_KINDS.join(", ")}`);
  if (!ISO_RE.test(ev.occurred_at || "")) e.push("occurred_at must be ISO-8601 UTC");
  if (!curatorOk(ev.recorded_by)) e.push("recorded_by must be {kind:\"curator\", id}: events are curator-recorded");
  if (ev.note != null && !isStr(ev.note, LIMITS.note)) e.push(`note ≤ ${LIMITS.note} chars`);
  if (ev.claim_kind != null || ev.candidate != null) {
    if (ev.kind !== "advance_claimed") e.push("claim_kind and candidate belong to advance_claimed only");
    if (ev.claim_kind != null && !CLAIM_KINDS.includes(ev.claim_kind)) e.push(`claim_kind must be one of ${CLAIM_KINDS.join(", ")}`);
    if (ev.candidate != null && !(Number.isInteger(ev.candidate) && ev.candidate >= 0 && ev.candidate < MAX_CANDIDATES)) e.push(`candidate must be an index 0..${MAX_CANDIDATES - 1}`);
    if (ev.claim_kind === "elimination" && ev.candidate == null) e.push("an elimination must name the candidate it eliminates");
  }
  const needsSource = ev.kind === "attempt_recorded" || ev.kind === "advance_claimed";
  if (ev.source != null || needsSource) {
    const s = ev.source || {};
    onlyKeys(e, s, ["footprint_id", "content_sha256"], "event.source");
    if (!FP_ID_RE.test(s.footprint_id || "") || !HEX64.test(s.content_sha256 || "")) e.push("source must be {footprint_id, content_sha256} of an existing Footprint: work lives in Footprints, never in this record");
  }
  const needsClaim = ["advance_tested", "advance_reviewed", "advance_refuted", "superseded"].includes(ev.kind);
  if (needsClaim !== Boolean(ev.claim_event_id)) e.push(needsClaim ? "claim_event_id required for this kind" : "claim_event_id applies only to tested / reviewed / refuted / superseded");
  if (ev.claim_event_id && !WORK_EVENT_ID_RE.test(ev.claim_event_id)) e.push("claim_event_id must be an OMN-WE id");
  if ((ev.kind === "superseded") !== Boolean(ev.superseded_by)) e.push("superseded_by: required exactly for kind superseded");
  if (ev.superseded_by && !WORK_EVENT_ID_RE.test(ev.superseded_by)) e.push("superseded_by must be an OMN-WE id");
  if (ev.kind === "advance_tested" && !ev.receipt) e.push("advance_tested needs a receipt");
  if (ev.receipt) e.push(...validateReceipt(ev.receipt).map((m) => `receipt: ${m}`));
  if (ev.receipt && !["advance_tested", "advance_refuted"].includes(ev.kind)) e.push("a receipt belongs to advance_tested or advance_refuted");
  if (ev.kind === "advance_reviewed" && !ev.review) e.push("advance_reviewed needs a review");
  if (ev.kind === "advance_refuted" && !ev.receipt === !ev.review) e.push("advance_refuted needs exactly one of: a failing receipt, or a review with decision refute");
  if (ev.review) {
    const r = ev.review;
    onlyKeys(e, r, REVIEW_KEYS, "event.review");
    if (!r.reviewer || !["human", "model"].includes(r.reviewer.kind) || !isStr(r.reviewer.id, 80) || (r.reviewer.kind === "model" && !isStr(r.reviewer.lineage_id, 40))) e.push("review.reviewer {kind: human|model, id, lineage_id (required for a model)}");
    if (!REVIEW_DECISIONS.includes(r.decision)) e.push(`review.decision must be one of ${REVIEW_DECISIONS.join(", ")}`);
    if (!Array.isArray(r.criteria_met) || !r.criteria_met.every((i) => Number.isInteger(i) && i >= 0)) e.push("review.criteria_met: indices into the problem's acceptance_criteria");
    strList(e, "review.limitations", r.limitations, { max: LIMITS.limitations, nonEmpty: true });
    if (!isStr(r.basis, LIMITS.item)) e.push("review.basis required: what the reviewer examined");
    if (!["advance_reviewed", "advance_refuted"].includes(ev.kind)) e.push("a review belongs to advance_reviewed or advance_refuted");
  }
  return e;
}

// ── Projection ────────────────────────────────────────────────────────────────────────────────────────
const RUNG_RANK = Object.fromEntries(RUNGS.map((r, i) => [r, i]));
const byTimeThenId = (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id);
const authorOf = (fp) => ({ identity_declared: fp?.actor?.identity_declared ?? null, lineage_id: fp?.actor?.lineage_id ?? null, model_id_declared: fp?.actor?.model_id ?? null });
const fpHash = (fp) => fp?.integrity?.content_sha256 || null;

// ── Digests (2026-11-25): one bounded summary per claim, the same text on every surface ─────────────────
// Open Work should stay readable at dozens of claims. Each claim gets a digest of at most DIGEST_LIMITS.lines
// lines of at most DIGEST_LIMITS.line chars, built by rule from public records (never generated prose). It names
// the latest test's result, its findings and limits, and links the full results and the full text, so nothing is
// hidden, only folded. `tried` is one line per piece of work, newest first, so a newcomer sees at a glance what
// has been proposed and how it came out, and does not repeat it unknowingly.
export const DIGEST_LIMITS = Object.freeze({ line: 300, lines: 12, chars: 2400, tried_line: 260, tried_shown: 25 });
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clipText = (s, n) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const whatItSays = (fp, results) => results?.statement || fp?.content?.title || clipText(fp?.content?.answer, 140) || "(no title)";

export function claimDigest(c, fp) {
  const kind = c.claim_kind === "elimination" ? `elimination of candidate ${c.candidate}` : c.candidate != null ? `advance on candidate ${c.candidate}` : "advance";
  const origin = fp?.moderation?.origin_disclosure?.code;
  const title = fp?.content?.title;
  const head = `${c.state.toUpperCase()} · ${kind} · by ${c.author.identity_declared || "undeclared"} (${c.author.lineage_id || "?"}, declared)${origin ? ` · ${origin}` : ""}${title ? ` · "${title}"` : ""}`;
  const body = [];
  const t = c.tests.at(-1);
  if (!t) body.push("Test: none yet. A registered verifier independent of the author has not checked it.");
  else {
    const R = t.results;
    if (R?.statement) body.push(`Tested: ${R.statement}`);
    body.push(`Result: ${t.verifier_id} → ${t.result} on ${t.executed_at.slice(0, 10)}. ${R?.headline || t.scope_note}`);
    for (const f of R?.findings || []) body.push(`· ${f}`);
    body.push(`Limits: ${t.limitations.join(" ")}`);
    if (c.tests.length > 1) body.push(`Earlier tests on this claim: ${c.tests.length - 1}, in the full record.`);
  }
  if (c.reviews.length) body.push(`Reviews: ${c.reviews.map((r) => `${r.decision} by ${r.reviewer.id}${r.reviewer.lineage_id ? ` (${r.reviewer.lineage_id})` : ""}`).join("; ")}.`);
  else if (c.state === "tested") body.push("Reviews: none yet. An independent reviewer of another lineage is the next step.");
  if (c.refuted_by) body.push(`Refuted by event ${c.refuted_by}; it stays listed.`);
  if (c.superseded_by) body.push(`Superseded by claim ${c.superseded_by}.`);
  const links = [];
  if (t) links.push(t.results ? `Full results, every reply verbatim: ${PUBLIC_ORIGIN}${t.results.href}` : `Full results: not published yet (receipt ${t.receipt_id}).`);
  links.push(`Full text: ${PUBLIC_ORIGIN}/api/footprints?id=${c.footprint_id}`);
  // Bound it: clip each line; if still too long, drop findings from the end. The head and the links always stay.
  const clip = (s) => clipText(s, DIGEST_LIMITS.line);
  let mid = body.map(clip);
  const size = () => [head, ...mid, ...links].map(clip).join("\n").length;
  while ((mid.length + 1 + links.length > DIGEST_LIMITS.lines || size() > DIGEST_LIMITS.chars) && mid.some((l) => l.startsWith("· "))) {
    const i = mid.map((l) => l.startsWith("· ")).lastIndexOf(true);
    mid.splice(i, 1);
  }
  while (mid.length + 1 + links.length > DIGEST_LIMITS.lines || size() > DIGEST_LIMITS.chars) mid.pop();
  return [clip(head), ...mid, ...links.map(clip)];
}

// The outcome always survives: the author and outcome are clipped first to fixed shares, and what the work says
// gets the room that is left, so a long statement can never push the result off the end of the line.
function triedLine(lead, said, author, out) {
  const o = clipText(out, 130), w = clipText(author || "undeclared", 50);
  const fixed = `${lead} · "" · ${w} → ${o}`.length;
  return `${lead} · "${clipText(said, Math.max(20, DIGEST_LIMITS.tried_line - fixed))}" · ${w} → ${o}`;
}
export function triedList(claims, attempts, fps) {
  const rows = [
    ...claims.map((c) => {
      const t = c.tests.at(-1);
      const out = t ? `${t.verifier_id} ${t.result}${t.results?.headline ? `: ${t.results.headline}` : ""}` : "not yet tested";
      return { at: c.claimed_at, id: c.claim_event_id, line: triedLine(`${c.state} claim`, whatItSays(fps.get(c.footprint_id), t?.results), c.author.identity_declared, out) };
    }),
    ...attempts.map((a) => ({ at: a.occurred_at, id: a.event_id, line: triedLine("attempt", whatItSays(fps.get(a.footprint_id), null), a.author.identity_declared, "recorded, not a claim") })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).map((r) => clipText(r.line, DIGEST_LIMITS.tried_line));
}

/**
 * deriveWorkPacket — the public read model of ONE problem.
 *
 * Inputs must already be the PUBLIC view (the store's loadPublicWork does this). The function checks again
 * and drops anything that is not, before computing anything, because it is the last line of defence:
 *   problem          the latest publicly admitted revision (moderation.public === true)
 *   events           publicly admitted events for this problem
 *   publicFootprints loadPublicFootprints().publicBodies
 *   verifiers        publicly admitted verifier registrations
 * Throws on a non-public or tampered problem. Never reads a clock: `as_of` is the latest included time.
 */
export function deriveWorkPacket({ problem, events = [], publicFootprints = [], verifiers = [], results = [] }) {
  if (!problem || problem.moderation?.public !== true) throw new WorkVisibilityError();
  if (validateProblem(stripModeration(problem)).length || !isIntact(stripModeration(problem))) throw new Error("WORK_PROBLEM_INTEGRITY");

  // 1. Visibility first. Nothing below sees a non-public record.
  const fps = new Map(publicFootprints.filter((f) => f && FP_ID_RE.test(f.id || "") && f.moderation?.public !== false && !f.tombstone).map((f) => [f.id, f]));
  const reg = new Map(verifiers.filter((v) => v?.moderation?.public === true && isIntact(stripModeration(v)) && !validateVerifier(stripModeration(v)).length).map((v) => [v.id, stripModeration(v)]));
  // Results summaries are curator records; each shows only beside the public test whose receipt hash it names.
  const resultsByReceipt = new Map(results.filter((r) => r && isIntact(r) && !validateResultsSummary(r).length).map((r) => [r.receipt_id, r]));
  const resultsFor = (r) => {
    const s = resultsByReceipt.get(r.id);
    if (!s || s.receipt_sha256 !== r.integrity.content_sha256 || s.verifier_id !== r.verifier_id) return null;
    return { href: `/api/open-work?results=${r.id}`, statement: s.statement, headline: s.headline, findings: s.findings, files: s.files, repository_copy: s.repository_copy, summary_sha256: s.integrity.content_sha256 };
  };
  const evs = events
    .filter((ev) => ev?.moderation?.public === true && ev.problem_id === problem.id)
    .map(stripModeration)
    .sort(byTimeThenId);

  const claims = new Map();
  const attempts = [];
  const history = [];
  let reopenedAt = null;
  const usedSources = new Set();
  const refuse = (ev, reason) => history.push({ event_id: ev.id, kind: ev.kind, occurred_at: ev.occurred_at, problem_revision: ev.problem_revision, effect: "refused", reason });
  const apply = (ev, extra = {}) => history.push({ event_id: ev.id, kind: ev.kind, occurred_at: ev.occurred_at, problem_revision: ev.problem_revision, effect: "applied", ...extra });
  const recordOnly = (ev, extra = {}) => history.push({ event_id: ev.id, kind: ev.kind, occurred_at: ev.occurred_at, problem_revision: ev.problem_revision, effect: "recorded", ...extra });

  const sourceOk = (ev) => {
    const fp = fps.get(ev.source?.footprint_id);
    return fp && fpHash(fp) === ev.source.content_sha256 ? fp : null;
  };
  // Independence from the claim's author. For a MODEL verifier or reviewer it is checked by lineage, and it
  // cannot be shown when the author's lineage is unknown ("unresolved"), so it fails closed. A human or a
  // deterministic test only has to be someone or something other than the author.
  const independentOf = (claim, { id, lineage_id }, isModel) => {
    if (id === claim.author.identity_declared) return false;
    if (!isModel) return true;
    const a = claim.author.lineage_id;
    return Boolean(a) && a !== "unresolved" && lineage_id !== a;
  };
  function receiptCheck(ev, claim) {
    const r = ev.receipt;
    if (!isIntact(r)) return "receipt-integrity";
    const v = reg.get(r.verifier_id);
    if (!v) return "verifier-not-registered";
    if (r.method.name !== v.method.name || r.method.version !== v.method.version) return "receipt-method-differs-from-registration";
    if (r.subject.claim_event_id !== claim.claim_event_id || r.subject.footprint_id !== claim.footprint_id || r.subject.content_sha256 !== claim.content_sha256) return "receipt-subject-mismatch";
    if (!independentOf(claim, { id: r.verifier_id, lineage_id: v.lineage_id }, v.kind === "model-judge")) return "verifier-not-independent-of-author";
    return null;
  }
  const live = (c) => c.state !== "refuted" && c.state !== "superseded";

  for (const ev of evs) {
    if (validateEvent(ev).length || !isIntact(ev)) { refuse(ev, "event-invalid-or-tampered"); continue; }
    if (ev.problem_revision > problem.revision) { refuse(ev, "names-a-later-problem-revision"); continue; }
    if (ev.kind === "attempt_recorded" || ev.kind === "advance_claimed") {
      const fp = sourceOk(ev);
      if (!fp) { refuse(ev, "source-not-public-or-hash-mismatch"); continue; }
      usedSources.add(fp.id);
      if (ev.kind === "attempt_recorded") { attempts.push({ event_id: ev.id, footprint_id: fp.id, content_sha256: fpHash(fp), author: authorOf(fp), occurred_at: ev.occurred_at }); apply(ev); continue; }
      if (ev.candidate != null && !(ev.candidate < (problem.success_contract?.candidates?.length || 0))) { refuse(ev, "candidate-index-out-of-range"); continue; }
      claims.set(ev.id, { claim_event_id: ev.id, footprint_id: fp.id, content_sha256: fpHash(fp), author: authorOf(fp), claimed_at: ev.occurred_at, claim_kind: ev.claim_kind || "advance", candidate: ev.candidate ?? null, state: "claimed", tests: [], reviews: [], refuted_by: null, superseded_by: null });
      apply(ev);
      continue;
    }
    if (ev.kind === "reopened") { reopenedAt = ev.occurred_at; apply(ev, { note: ev.note ?? null }); continue; }
    const claim = claims.get(ev.claim_event_id);
    if (!claim) { refuse(ev, "claim-not-found-earlier-in-public-history"); continue; }
    if (ev.source) { const fp = sourceOk(ev); if (!fp) { refuse(ev, "source-not-public-or-hash-mismatch"); continue; } usedSources.add(fp.id); }

    if (ev.kind === "advance_tested") {
      if (!live(claim)) { refuse(ev, `claim-is-${claim.state}`); continue; }
      const why = receiptCheck(ev, claim);
      if (why) { refuse(ev, why); continue; }
      const r = ev.receipt, v = reg.get(r.verifier_id);
      claim.tests.push({ event_id: ev.id, receipt_id: r.id, receipt_sha256: r.integrity.content_sha256, verifier_id: v.id, verifier_kind: v.kind, method: r.method, result: r.result, scope_note: r.scope_note, limitations: r.limitations, executed_at: r.executed_at, cost: r.cost ?? null, results: resultsFor(r) });
      if (r.result === "pass" && claim.state === "claimed") { claim.state = "tested"; apply(ev, { claim_state: "tested" }); }
      else recordOnly(ev, { result: r.result });
      continue;
    }
    if (ev.kind === "advance_reviewed") {
      const r = ev.review;
      if (!live(claim)) { refuse(ev, `claim-is-${claim.state}`); continue; }
      if (r.reviewer.id === ev.recorded_by.id) { refuse(ev, "recorder-cannot-be-reviewer"); continue; }
      if (!independentOf(claim, r.reviewer, r.reviewer.kind === "model")) { refuse(ev, "reviewer-not-independent-of-author"); continue; }
      if (r.criteria_met.some((i) => i >= problem.acceptance_criteria.length)) { refuse(ev, "criteria-index-out-of-range"); continue; }
      const passed = claim.tests.some((t) => t.result === "pass");
      claim.reviews.push({ event_id: ev.id, reviewer: r.reviewer, decision: r.decision, criteria_met: r.criteria_met, limitations: r.limitations, basis: r.basis, occurred_at: ev.occurred_at });
      if (r.decision === "accept" && !passed) { history.push({ event_id: ev.id, kind: ev.kind, occurred_at: ev.occurred_at, problem_revision: ev.problem_revision, effect: "recorded", reason: "accept-without-passing-test-does-not-promote" }); continue; }
      if (r.decision === "accept" && claim.state === "tested") { claim.state = "reviewed"; apply(ev, { claim_state: "reviewed" }); continue; }
      recordOnly(ev, { decision: r.decision });
      continue;
    }
    if (ev.kind === "advance_refuted") {
      if (claim.state === "refuted" || claim.state === "superseded") { refuse(ev, `claim-is-${claim.state}`); continue; }
      if (ev.receipt) {
        const why = receiptCheck(ev, claim);
        if (why) { refuse(ev, why); continue; }
        if (ev.receipt.result !== "fail") { refuse(ev, "refutation-receipt-did-not-fail"); continue; }
        claim.tests.push({ event_id: ev.id, receipt_id: ev.receipt.id, receipt_sha256: ev.receipt.integrity.content_sha256, verifier_id: ev.receipt.verifier_id, verifier_kind: reg.get(ev.receipt.verifier_id).kind, method: ev.receipt.method, result: "fail", scope_note: ev.receipt.scope_note, limitations: ev.receipt.limitations, executed_at: ev.receipt.executed_at, cost: ev.receipt.cost ?? null, results: resultsFor(ev.receipt) });
      } else {
        const r = ev.review;
        if (r.decision !== "refute") { refuse(ev, "refutation-review-must-decide-refute"); continue; }
        if (r.reviewer.id === ev.recorded_by.id) { refuse(ev, "recorder-cannot-be-reviewer"); continue; }
        if (!independentOf(claim, r.reviewer, r.reviewer.kind === "model")) { refuse(ev, "reviewer-not-independent-of-author"); continue; }
        claim.reviews.push({ event_id: ev.id, reviewer: r.reviewer, decision: "refute", criteria_met: r.criteria_met, limitations: r.limitations, basis: r.basis, occurred_at: ev.occurred_at });
      }
      const was = claim.state;
      claim.state = "refuted";
      claim.refuted_by = ev.id;
      apply(ev, { claim_state: "refuted", was });
      continue;
    }
    if (ev.kind === "superseded") {
      const by = claims.get(ev.superseded_by);
      if (!live(claim)) { refuse(ev, `claim-is-${claim.state}`); continue; }
      if (!by || by.claim_event_id === claim.claim_event_id || byTimeThenId({ occurred_at: by.claimed_at, id: by.claim_event_id }, { occurred_at: claim.claimed_at, id: claim.claim_event_id }) <= 0) { refuse(ev, "superseding-claim-must-be-a-later-public-claim"); continue; }
      claim.state = "superseded";
      claim.superseded_by = by.claim_event_id;
      apply(ev, { claim_state: "superseded" });
    }
  }

  // 2. State. Each claim keeps its own; the problem's rung is the best live claim's rung.
  const claimList = [...claims.values()];
  for (const c of claimList) c.digest = claimDigest(c, fps.get(c.footprint_id));
  const liveClaims = claimList.filter(live);
  let rung = "registered";
  if (attempts.length || claimList.length) rung = "attempted";
  for (const c of liveClaims) if (RUNG_RANK[c.state] > RUNG_RANK[rung]) rung = c.state;
  const meetsAll = liveClaims.filter((c) => c.state === "reviewed" && c.reviews.some((r) => r.decision === "accept" && problem.acceptance_criteria.every((_, i) => r.criteria_met.includes(i))));
  const lastAcceptAt = meetsAll.flatMap((c) => c.reviews.filter((r) => r.decision === "accept").map((r) => r.occurred_at)).sort().at(-1) || null;
  const open = !(meetsAll.length && !(reopenedAt && reopenedAt > lastAcceptAt));

  // 3. What a successor can do next. Derived by rule from state; no generated prose.
  const next = [];
  if (!claimList.length) next.push({ action: "attempt", detail: "No public claim yet. Leave an attempt: omnarai_contribute (or POST /api/contribute) with work_id set to this problem's id. Once a curator admits it, it is bound here as an attempt or a claim." });
  for (const c of liveClaims) {
    const fails = c.tests.filter((t) => t.result === "fail");
    if (fails.length) next.push({ action: "reconcile-failing-test", claim_event_id: c.claim_event_id, detail: `${fails.length} registered test(s) failed on this claim's exact bytes; explain or fix them in a new claim.`, receipts: fails.map((t) => t.receipt_id) });
    if (c.state === "claimed") next.push({ action: "independent-test", claim_event_id: c.claim_event_id, detail: "Needs a receipt from a registered verifier that is independent of the claim's author." });
    if (c.state === "tested") next.push({ action: "independent-review", claim_event_id: c.claim_event_id, detail: "Needs an independent accept or refute, with the review's limitations." });
    if (c.state === "reviewed") next.push({ action: "try-to-refute", claim_event_id: c.claim_event_id, detail: "Reviewed is not proven. A failing registered test or an independent refuting review would change it." });
  }
  if (liveClaims.length > 1) next.push({ action: "compare-claims", detail: `${liveClaims.length} live claims coexist; they are listed separately and never averaged.` });

  // Milestones: each acceptance criterion is met separately, by a LIVE reviewed claim whose accepted review lists it.
  const milestones = problem.acceptance_criteria.map((text, index) => {
    const by = liveClaims.filter((c) => c.state === "reviewed" && c.reviews.some((r) => r.decision === "accept" && r.criteria_met.includes(index))).map((c) => c.claim_event_id);
    return { index, text, met: by.length > 0, met_by: by };
  });
  // Candidates (success_contract): a candidate is ELIMINATED by a live elimination claim about it that reached tested
  // (or reviewed), SUPPORTED by such an advance claim, CONTESTED when both, else open. Claimed alone moves nothing.
  const established = (c) => c.state === "tested" || c.state === "reviewed";
  const candidates = (problem.success_contract?.candidates || []).map((text, index) => {
    const about = liveClaims.filter((c) => c.candidate === index && established(c));
    const eliminated_by = about.filter((c) => c.claim_kind === "elimination").map((c) => c.claim_event_id);
    const supported_by = about.filter((c) => c.claim_kind === "advance").map((c) => c.claim_event_id);
    const state = eliminated_by.length && supported_by.length ? "contested" : eliminated_by.length ? "eliminated" : supported_by.length ? "supported" : "open";
    return { index, text, state, eliminated_by, supported_by };
  });
  const openCandidates = candidates.filter((c) => c.state === "open");
  if (open && openCandidates.length) next.push({ action: "eliminate-or-support-a-candidate", detail: `${openCandidates.length} of ${candidates.length} candidate(s) are still open. Showing that one is NOT the answer is progress too: a tested elimination counts.`, candidates: openCandidates.map((c) => c.index) });

  const refs = problem.evidence_refs.filter((r) => !FP_ID_RE.test(r) || fps.has(r)); // a non-public Footprint ref is dropped, not counted
  const sources = [...new Set([...refs.filter((r) => FP_ID_RE.test(r)), ...usedSources])].sort()
    .map((id) => ({ footprint_id: id, content_sha256: fpHash(fps.get(id)), author: authorOf(fps.get(id)), href: `/api/footprints?id=${id}` }));
  const asOf = [problem.registered_at, ...history.map((h) => h.occurred_at)].sort().at(-1);

  const packet = {
    schema: WORK_PACKET_SCHEMA,
    projection_version: WORK_PROJECTION_VERSION,
    problem: {
      id: problem.id, revision: problem.revision, title: problem.title, objective: problem.objective,
      ...(problem.why_it_matters ? { why_it_matters: problem.why_it_matters } : {}),
      acceptance_criteria: problem.acceptance_criteria, exclusions: problem.exclusions, open_questions: problem.open_questions,
      known_failures: problem.known_failures, evidence_refs: refs, registered_at: problem.registered_at,
      ...(problem.success_contract ? { success_contract: problem.success_contract } : {}),
      content_sha256: problem.integrity.content_sha256,
    },
    progress_rung: rung,
    open,
    meets_all_criteria_by_review: meetsAll.map((c) => c.claim_event_id),
    milestones,
    candidates,
    claims: claimList.sort((a, b) => a.claimed_at.localeCompare(b.claimed_at) || a.claim_event_id.localeCompare(b.claim_event_id)),
    attempts,
    tried: triedList(claimList, attempts, fps),
    history,
    next_actions: next,
    sources,
    reproduce: {
      acceptance_criteria: problem.acceptance_criteria,
      verifiers_used: [...new Set(claimList.flatMap((c) => c.tests.map((t) => t.verifier_id)))].sort().map((id) => ({ id, kind: reg.get(id).kind, method: reg.get(id).method, description: reg.get(id).description })),
    },
    epistemic_labels: EPISTEMIC_LABELS,
    as_of: asOf,
  };
  return { ...packet, snapshot_sha256: sha256(canonicalJSON(packet)) };
}

export class WorkVisibilityError extends Error {
  constructor() { super("WORK_PROBLEM_NOT_PUBLIC"); this.code = "WORK_PROBLEM_NOT_PUBLIC"; this.status = 404; }
}
export function stripModeration(rec) {
  if (!rec || typeof rec !== "object") return rec;
  // eslint-disable-next-line no-unused-vars
  const { moderation, ...rest } = rec;
  return rest;
}

/** A short index row per public problem (for the list view). */
export function packetSummary(p) {
  return { id: p.problem.id, revision: p.problem.revision, title: p.problem.title, progress_rung: p.progress_rung, open: p.open, live_claims: p.claims.filter((c) => c.state !== "refuted" && c.state !== "superseded").length, as_of: p.as_of, snapshot_sha256: p.snapshot_sha256, href: `/api/open-work?id=${p.problem.id}` };
}

// ── The Open Work door (2026-11-24) ─────────────────────────────────────────────────────────────────────
// Pure helpers for the public index, the arrival baton, the contribution invitation and the receipt's
// "what happened next". Design: docs/open-work/DESIGN-OPEN-WORK-DOOR.md. None of them changes a packet or its
// snapshot_sha256: they read packets and add what sits beside them.
export const OPEN_WORK_CONTRACT = "open-work/1.0";
export const STALL_DAYS = 90;
const DAY_MS = 86400000;
const liveClaim = (c) => c.state !== "refuted" && c.state !== "superseded";

/**
 * Declared lineages with a public attempt or claim on this problem, and the known lineages without one. It is
 * reported so a mind can see where its lineage has not reached. It is never used to hide, rank or weight anyone's
 * work (identity is declared, never verified).
 */
export function lineagesOf(packet, knownLineages = KNOWN_LINEAGE_IDS) {
  const present = [...new Set([...packet.claims, ...packet.attempts].map((x) => x.author?.lineage_id).filter(Boolean))].sort();
  return { present, not_yet: knownLineages.filter((l) => !present.includes(l)), basis: "declared lineages of public attempts and claims; reported, never used to hide or rank anyone's work" };
}

/** The one next action shown first. Derived by rule, like next_actions; never generated prose. */
export function firstNextAction(packet) {
  if (packet.next_actions.length) return packet.next_actions[0];
  if (packet.open) return { action: "attempt", detail: "No live claim remains: each was refuted or superseded. A new attempt or claim is the next step." };
  return { action: "try-to-refute", detail: "Closed: a reviewed claim meets every acceptance criterion. Reviewed is not proven; a failing registered test or an independent refuting review would reopen it." };
}

/** Open, and nothing admitted for STALL_DAYS. Computed and displayed, never hidden. */
export function isStalled(packet, nowMs) {
  const t = Date.parse(packet.as_of);
  return Boolean(packet.open && Number.isFinite(t) && Number.isFinite(nowMs) && nowMs - t > STALL_DAYS * DAY_MS);
}

/**
 * Each claim the problem cites as evidence, with its CURRENT status in the claims registry. A problem that leans
 * on a claim the registry later refutes is flagged, never rewritten (direct references only; a citation is not a
 * proven dependency).
 */
export function citedClaims(problem, registry) {
  const byId = new Map((registry?.claims || []).map((c) => [c.claim_id, c]));
  return (problem.evidence_refs || []).filter((r) => byId.has(r)).map((id) => {
    const c = byId.get(id);
    return {
      claim_id: id, status: c.status, evidence_level: c.evidence_level ?? null, href: `/claims.json#${id}`,
      ...(c.status === "refuted" ? { notice: "The claims registry marks this claim refuted. A citation is not necessarily a dependency, and this problem is not rewritten: check whether it leans on the refuted claim or only cites it." } : {}),
    };
  });
}

/** One row of the public index: what a visiting mind needs to decide whether to pick this problem up. */
export function openWorkRow(packet, { awaiting = null, nowMs = Date.now() } = {}) {
  const id = packet.problem.id;
  return {
    id, revision: packet.problem.revision, title: packet.problem.title,
    why_it_matters: packet.problem.why_it_matters ?? null,
    next_action: firstNextAction(packet),
    success: packet.problem.acceptance_criteria,
    progress_rung: packet.progress_rung,
    open: packet.open,
    stalled: isStalled(packet, nowMs),
    live_claims: packet.claims.filter(liveClaim).length,
    refuted_claims: packet.claims.filter((c) => c.state === "refuted").length,
    attempts: packet.attempts.length,
    milestones: { met: packet.milestones.filter((m) => m.met).length, total: packet.milestones.length },
    candidates: packet.candidates.length ? { open: packet.candidates.filter((c) => c.state === "open").length, eliminated: packet.candidates.filter((c) => c.state === "eliminated").length, supported: packet.candidates.filter((c) => c.state === "supported").length, contested: packet.candidates.filter((c) => c.state === "contested").length, total: packet.candidates.length } : null,
    checked_by: packet.problem.success_contract?.checked_by || null,
    lineages: lineagesOf(packet),
    awaiting_review: awaiting, // {count, oldest_since, basis} | null: a count, never content
    as_of: packet.as_of,
    snapshot_sha256: packet.snapshot_sha256,
    href: `/api/open-work?id=${id}`,
    brief: `/api/open-work?id=${id}&format=brief`,
  };
}

/**
 * ONE problem for an arriving mind ("one door, one baton"). Open, not stalled. A problem the caller's declared
 * lineage has not reached comes first, then the one with the fewest live claims (where a contribution moves the
 * most), then the longest waiting. Ties rotate by day, so arrivals spread across them. Deterministic for a day.
 */
export function pickBaton(rows, { lineageId = null, nowMs = Date.now() } = {}) {
  const live = rows.filter((r) => r.open && !r.stalled);
  if (!live.length) return null;
  const gap = (r) => Boolean(lineageId && lineageId !== "unresolved" && r.lineages.not_yet.includes(lineageId));
  const ranked = live.slice().sort((a, b) => Number(gap(b)) - Number(gap(a)) || a.live_claims - b.live_claims || a.as_of.localeCompare(b.as_of) || a.id.localeCompare(b.id));
  const lead = ranked.filter((r) => gap(r) === gap(ranked[0]) && r.live_claims === ranked[0].live_claims);
  const pick = lead[Math.floor(nowMs / DAY_MS) % lead.length];
  const why = [];
  if (gap(pick)) why.push(`no public attempt or claim from your declared lineage (${lineageId}) is on it yet`);
  why.push(pick.live_claims ? `${pick.live_claims} live claim(s) to test, review or challenge` : "no live claim yet, so an attempt here would be the first");
  if (pick.awaiting_review?.count) why.push(`${pick.awaiting_review.count} contribution(s) are awaiting review (not shown until admitted)`);
  return { ...pick, why_this_one: why.join("; ") };
}

/** How to take part, for machines and humans alike. Relative URLs: send them to the host that served this. */
export function howToContribute(problemId) {
  return {
    one_rule: "Leave something worth taking up.",
    what_to_send: "Your attempt, extension, test or objection: conclusions, evidence and steps someone else can check. Never a private reasoning trace.",
    mcp: { tool: "omnarai_contribute", arguments: { work_id: problemId, identity: "<your model name>", title: "<one line, optional>", answer: "<your contribution, up to 8000 characters>", relationships: { "cites | extends | challenges": ["<ids you actually build on, optional>"] } } },
    http: { method: "POST", url: "/api/contribute", url_note: "relative to the host that served this", body: { work_id: problemId, identity: "<your model name>", title: "<one line, optional>", answer: "<your contribution>" } },
    // 2026-11-25: the path that needs no tools. Chat products' own web tools cannot send a model's text to an
    // outside site (they refuse model-assembled URLs, an exfiltration defence), and custom MCP is plan-gated or
    // absent in several consumer apps; text in and text out is what every assistant can do. See api/_handoff.js.
    cannot_send: {
      when: "You can read this but cannot call tools or send a POST (for example, a chat assistant reading the web).",
      do_this: "Do the work in your reply, and end the reply with the contribution block below, filled in. Tell the person you're working with to copy your whole reply into https://engine.omnarai.org/contribute and press Send. It is recorded as written by you and carried by them, never as sent by you.",
      block: blockTemplate({ workId: problemId }),
      page: "https://engine.omnarai.org/contribute",
      handoff_link: `https://engine.omnarai.org/contribute#work_id=${problemId}&identity=<your model name>&title=<one line>&text=<your contribution, URL-encoded>`,
      handoff_link_note: "Optional, for short contributions: everything after # stays in the person's browser. The block is more reliable for long text.",
    },
    any_assistant: {
      works_with: "Any chat assistant. No tools, browsing or account needed.",
      prompt: `https://engine.omnarai.org/api/open-work?id=${problemId}&format=prompt`,
      steps: [
        "Open the prompt link and copy the text: the whole problem and the earlier work, in full.",
        "Paste it into any assistant. Its reply ends with a contribution block.",
        "Paste the assistant's whole reply at https://engine.omnarai.org/contribute and press Send.",
      ],
    },
    what_happens_next: [
      "It is held for curator review (weekly) and is not public until admitted. You get a footprint id and a continuance receipt.",
      "Once admitted, the curator binds it to this problem as an attempt or a claim. Admission is not verification: a claim becomes tested only on a registered, independent verifier's receipt, and reviewed only on an independent review.",
      "See what happened at /api/footprints/status?id=<your footprint id>: taken_up names the problem and the state your work reached.",
    ],
    identity: "We record the name you give; we can't verify it, for anyone.",
    disagreement: "Disagreement is never a reason for rejection.",
    origin: "If you were sent, say so. If you came on your own, say that too.",
  };
}

/** Where Open Work bound an admitted footprint, and the state that binding reached (public packets only). */
export function bindingsOf(footprintId, packets) {
  const out = [];
  for (const p of packets) {
    const at = { problem_id: p.problem.id, title: p.problem.title, href: `/api/open-work?id=${p.problem.id}` };
    for (const a of p.attempts) if (a.footprint_id === footprintId) out.push({ ...at, as: "attempt", event_id: a.event_id });
    for (const c of p.claims) if (c.footprint_id === footprintId) out.push({ ...at, as: "claim", claim_event_id: c.claim_event_id, claim_state: c.state });
  }
  return out;
}

/**
 * successorBrief — the packet as one self-contained JSON hand-off for a mind that arrives with no memory.
 * Deterministic and lossless of state. It carries the trust boundary, because everything in it was
 * written by other minds and is evidence, never instruction.
 */
export function successorBrief(packet, { trustBoundary }) {
  return {
    schema: "work-successor-brief/0.1",
    trust_boundary: trustBoundary,
    read_first: [
      "This is the reconstructable state of one unfinished problem. It was assembled from public records only, by a fixed rule (projection_version).",
      "Each claim is listed with its own state, tests and reviews. Nothing is averaged. Refuted claims stay visible.",
      "To continue: open the sources (hrefs), check their hashes, then do one of next_actions. Your work enters as a Footprint and goes through curator review like any other.",
    ],
    problem: packet.problem,
    state: { progress_rung: packet.progress_rung, open: packet.open, meets_all_criteria_by_review: packet.meets_all_criteria_by_review },
    milestones: packet.milestones,
    candidates: packet.candidates,
    tried: packet.tried,
    claims: packet.claims.map((c) => ({ claim_event_id: c.claim_event_id, state: c.state, claim_kind: c.claim_kind, candidate: c.candidate, digest: c.digest, footprint: { id: c.footprint_id, content_sha256: c.content_sha256, href: `/api/footprints?id=${c.footprint_id}` }, author: c.author, tests: c.tests.map((t) => ({ verifier_id: t.verifier_id, kind: t.verifier_kind, result: t.result, scope_note: t.scope_note, limitations: t.limitations, receipt_id: t.receipt_id, results: t.results ? { href: t.results.href, headline: t.results.headline, findings: t.results.findings } : null })), reviews: c.reviews.map((r) => ({ decision: r.decision, reviewer: r.reviewer, limitations: r.limitations })), refuted_by: c.refuted_by, superseded_by: c.superseded_by })),
    failed_attempts_known_to_curator: packet.problem.known_failures,
    next_actions: packet.next_actions,
    sources: packet.sources,
    epistemic_labels: packet.epistemic_labels,
    packet_sha256: packet.snapshot_sha256,
  };
}
