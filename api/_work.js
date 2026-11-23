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
import { Buffer } from "node:buffer";
import { canonicalJSON, sha256, FP_ID_RE, isWellFormedRef, detectSecrets } from "./_footprints.js";

export const WORK_PROBLEM_SCHEMA = "work-problem/1.0";
export const WORK_EVENT_SCHEMA = "work-event/1.0";
export const VERIFIER_SCHEMA = "work-verifier/1.0";
export const VERIFIER_RECEIPT_SCHEMA = "verifier-receipt/1.0";
export const WORK_PACKET_SCHEMA = "work-packet/1.0";
export const WORK_PROJECTION_VERSION = "open-work-projection/0.1";
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

const PROBLEM_KEYS = ["schema", "id", "revision", "supersedes_revision", "title", "objective", "acceptance_criteria", "exclusions", "open_questions", "known_failures", "evidence_refs", "registered_by", "registered_at", "integrity"];
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
  strList(e, "acceptance_criteria", p.acceptance_criteria, { nonEmpty: true });
  for (const k of ["exclusions", "open_questions", "known_failures"]) strList(e, k, p[k], { required: true });
  if (!Array.isArray(p.evidence_refs) || p.evidence_refs.length > LIMITS.refs || !p.evidence_refs.every(isWellFormedRef)) e.push(`evidence_refs must be ≤ ${LIMITS.refs} well-formed Omnarai ids (Footprint, Atlas record or answer, claim)`);
  if (!curatorOk(p.registered_by)) e.push("registered_by must be {kind:\"curator\", id}: problems are curator-registered, never open writes");
  if (!ISO_RE.test(p.registered_at || "")) e.push("registered_at must be an ISO-8601 UTC timestamp");
  const secrets = detectSecrets(p.title, p.objective, ...(p.acceptance_criteria || []), ...(p.open_questions || []), ...(p.known_failures || []), ...(p.exclusions || []));
  if (secrets.length) e.push(`credential-shaped text found (${secrets.join(", ")}); nothing stored`);
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

const EVENT_KEYS = ["schema", "id", "problem_id", "problem_revision", "kind", "occurred_at", "recorded_by", "source", "claim_event_id", "superseded_by", "receipt", "review", "note", "integrity"];
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
export function deriveWorkPacket({ problem, events = [], publicFootprints = [], verifiers = [] }) {
  if (!problem || problem.moderation?.public !== true) throw new WorkVisibilityError();
  if (validateProblem(stripModeration(problem)).length || !isIntact(stripModeration(problem))) throw new Error("WORK_PROBLEM_INTEGRITY");

  // 1. Visibility first. Nothing below sees a non-public record.
  const fps = new Map(publicFootprints.filter((f) => f && FP_ID_RE.test(f.id || "") && f.moderation?.public !== false && !f.tombstone).map((f) => [f.id, f]));
  const reg = new Map(verifiers.filter((v) => v?.moderation?.public === true && isIntact(stripModeration(v)) && !validateVerifier(stripModeration(v)).length).map((v) => [v.id, stripModeration(v)]));
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
      claims.set(ev.id, { claim_event_id: ev.id, footprint_id: fp.id, content_sha256: fpHash(fp), author: authorOf(fp), claimed_at: ev.occurred_at, state: "claimed", tests: [], reviews: [], refuted_by: null, superseded_by: null });
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
      claim.tests.push({ event_id: ev.id, receipt_id: r.id, receipt_sha256: r.integrity.content_sha256, verifier_id: v.id, verifier_kind: v.kind, method: r.method, result: r.result, scope_note: r.scope_note, limitations: r.limitations, executed_at: r.executed_at, cost: r.cost ?? null });
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
        claim.tests.push({ event_id: ev.id, receipt_id: ev.receipt.id, receipt_sha256: ev.receipt.integrity.content_sha256, verifier_id: ev.receipt.verifier_id, verifier_kind: reg.get(ev.receipt.verifier_id).kind, method: ev.receipt.method, result: "fail", scope_note: ev.receipt.scope_note, limitations: ev.receipt.limitations, executed_at: ev.receipt.executed_at, cost: ev.receipt.cost ?? null });
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
  const liveClaims = claimList.filter(live);
  let rung = "registered";
  if (attempts.length || claimList.length) rung = "attempted";
  for (const c of liveClaims) if (RUNG_RANK[c.state] > RUNG_RANK[rung]) rung = c.state;
  const meetsAll = liveClaims.filter((c) => c.state === "reviewed" && c.reviews.some((r) => r.decision === "accept" && problem.acceptance_criteria.every((_, i) => r.criteria_met.includes(i))));
  const lastAcceptAt = meetsAll.flatMap((c) => c.reviews.filter((r) => r.decision === "accept").map((r) => r.occurred_at)).sort().at(-1) || null;
  const open = !(meetsAll.length && !(reopenedAt && reopenedAt > lastAcceptAt));

  // 3. What a successor can do next. Derived by rule from state; no generated prose.
  const next = [];
  if (!claimList.length) next.push({ action: "attempt", detail: "No public claim yet. Leave an attempt as a Footprint (for example POST /api/voice-records, citing this problem's evidence in relationships), and ask the curator to bind it here." });
  for (const c of liveClaims) {
    const fails = c.tests.filter((t) => t.result === "fail");
    if (fails.length) next.push({ action: "reconcile-failing-test", claim_event_id: c.claim_event_id, detail: `${fails.length} registered test(s) failed on this claim's exact bytes; explain or fix them in a new claim.`, receipts: fails.map((t) => t.receipt_id) });
    if (c.state === "claimed") next.push({ action: "independent-test", claim_event_id: c.claim_event_id, detail: "Needs a receipt from a registered verifier that is independent of the claim's author." });
    if (c.state === "tested") next.push({ action: "independent-review", claim_event_id: c.claim_event_id, detail: "Needs an independent accept or refute, with the review's limitations." });
    if (c.state === "reviewed") next.push({ action: "try-to-refute", claim_event_id: c.claim_event_id, detail: "Reviewed is not proven. A failing registered test or an independent refuting review would change it." });
  }
  if (liveClaims.length > 1) next.push({ action: "compare-claims", detail: `${liveClaims.length} live claims coexist; they are listed separately and never averaged.` });

  const refs = problem.evidence_refs.filter((r) => !FP_ID_RE.test(r) || fps.has(r)); // a non-public Footprint ref is dropped, not counted
  const sources = [...new Set([...refs.filter((r) => FP_ID_RE.test(r)), ...usedSources])].sort()
    .map((id) => ({ footprint_id: id, content_sha256: fpHash(fps.get(id)), author: authorOf(fps.get(id)), href: `/api/footprints?id=${id}` }));
  const asOf = [problem.registered_at, ...history.map((h) => h.occurred_at)].sort().at(-1);

  const packet = {
    schema: WORK_PACKET_SCHEMA,
    projection_version: WORK_PROJECTION_VERSION,
    problem: {
      id: problem.id, revision: problem.revision, title: problem.title, objective: problem.objective,
      acceptance_criteria: problem.acceptance_criteria, exclusions: problem.exclusions, open_questions: problem.open_questions,
      known_failures: problem.known_failures, evidence_refs: refs, registered_at: problem.registered_at,
      content_sha256: problem.integrity.content_sha256,
    },
    progress_rung: rung,
    open,
    meets_all_criteria_by_review: meetsAll.map((c) => c.claim_event_id),
    claims: claimList.sort((a, b) => a.claimed_at.localeCompare(b.claimed_at) || a.claim_event_id.localeCompare(b.claim_event_id)),
    attempts,
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
  return { id: p.problem.id, revision: p.problem.revision, title: p.problem.title, progress_rung: p.progress_rung, open: p.open, live_claims: p.claims.filter((c) => c.state !== "refuted" && c.state !== "superseded").length, as_of: p.as_of, snapshot_sha256: p.snapshot_sha256, href: `/api/problems?id=${p.problem.id}` };
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
    claims: packet.claims.map((c) => ({ claim_event_id: c.claim_event_id, state: c.state, footprint: { id: c.footprint_id, content_sha256: c.content_sha256, href: `/api/footprints?id=${c.footprint_id}` }, author: c.author, tests: c.tests.map((t) => ({ verifier_id: t.verifier_id, kind: t.verifier_kind, result: t.result, scope_note: t.scope_note, limitations: t.limitations })), reviews: c.reviews.map((r) => ({ decision: r.decision, reviewer: r.reviewer, limitations: r.limitations })), refuted_by: c.refuted_by, superseded_by: c.superseded_by })),
    failed_attempts_known_to_curator: packet.problem.known_failures,
    next_actions: packet.next_actions,
    sources: packet.sources,
    epistemic_labels: packet.epistemic_labels,
    packet_sha256: packet.snapshot_sha256,
  };
}
