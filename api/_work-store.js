// Open Work storage: write-once records + append-only moderation, under the PRIVATE "work/" class.
//
// Same shape as Footprints (api/_footprints.js), on purpose:
//   work/problems/<OMN-WORK-…>/r<revision>.json    problem revisions, write-once
//   work/events/<OMN-WORK-…>/<OMN-WE-…>.json        progress events, write-once
//   work/verifiers/<slug>.json                      verifier registrations, write-once
//   work/reviews/<record-key>/<ms>__<action>__<hex>.json   moderation, append-only (action in the pathname)
//   work/results/<OMN-VR-…>/summary.json + bundle.json  a test's full results, write-once (2026-11-25). Not moderated
//                                                   separately: a summary shows only beside the PUBLIC test whose
//                                                   receipt hash it names (deriveWorkPacket), and the bundle is
//                                                   served only for such a test.
// There is no read-modify-write anywhere, so the store needs no CAS and cannot lose a concurrent write.
// Every record is published only by a later `admit` review, folded by the Footprint rule (foldModeration),
// so an unknown or malformed review can never publish anything.
//
// There is no PUBLIC write path. Registering a problem and recording receipts are curator operations called from
// scripts. Binding an admitted Footprint to a problem also has one curator-only HTTP action, on the operator session
// (decision D-003, built 2026-11-24 once real problems were registered): POST /api/council {action:"work-bind"}.
// Visiting minds contribute exactly as they do today, by leaving Footprints, which the curator then binds.
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { list as blobList, put as blobPut, blobFetch } from "./_blob.js";
import { foldModeration, REVIEW_ACTIONS, loadPublicFootprints, loadFootprintIndex, hydrate, getDefaultStore as getFootprintStore, FP_ID_RE } from "./_footprints.js";
import {
  WORK_PROBLEM_SCHEMA, WORK_EVENT_SCHEMA, VERIFIER_SCHEMA, WORK_PROBLEM_ID_RE, WORK_EVENT_ID_RE, VERIFIER_ID_RE,
  validateProblem, validateEvent, validateVerifier, seal, isIntact, mintProblemId, mintEventId, CLAIM_KINDS, LIMITS,
  RESULTS_SCHEMA, RESULTS_BUNDLE_SCHEMA, RECEIPT_ID_RE, validateResultsSummary, validateResultsBundle,
} from "./_work.js";

export const WORK_PREFIX = "work/";
export const PROBLEMS_PREFIX = "work/problems/";
export const EVENTS_PREFIX = "work/events/";
export const VERIFIERS_PREFIX = "work/verifiers/";
export const REVIEWS_PREFIX = "work/reviews/";
export const RESULTS_PREFIX = "work/results/";
const RESULTS_SUMMARY_RE = /^work\/results\/(OMN-VR-\d{13}-[0-9a-f]{8})\/summary\.json$/;

// Bounded parallel reads (2026-11-25): records used to be read one at a time, so each page load grew linearly
// with the number of problems, events and results. Order of the output matches the input.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
const READ_CONCURRENCY = 12;

export class WorkValidationError extends Error {
  constructor(errors) { super(`work record failed validation: ${errors.slice(0, 5).join("; ")}`); this.errors = errors; this.status = 400; }
}
export class WorkConflictError extends Error {
  constructor(path) { super(`WORK_RECORD_CONFLICT ${path}: a different body already exists; records are write-once`); this.code = "WORK_RECORD_CONFLICT"; this.status = 409; }
}

// record keys used under work/reviews/: "<problem-id>@r<rev>", "<event-id>", "verifier:<slug>"
const problemKey = (id, rev) => `${id}@r${rev}`;
const verifierKey = (id) => `verifier:${id}`;
const REVIEW_RE = /^work\/reviews\/([^/]+)\/(\d{13})__([a-z]+)__([0-9a-f]{8})\.json$/;

export function createWorkStore({ list = blobList, put = blobPut, fetchImpl = (...a) => blobFetch(...a) } = {}) {
  async function listAll(prefix) {
    const out = [];
    let cursor;
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
  // Write-once. No `access`: the _blob.js router classes work/ as private and sets it.
  async function putOnce(path, rec) {
    try {
      await put(path, JSON.stringify(rec), { addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
    } catch (e) {
      const existing = (await list({ prefix: path })).blobs?.find((b) => b.pathname === path);
      if (!existing) throw e;
      const body = await readJson(existing.url);
      if (body?.integrity?.content_sha256 && body.integrity.content_sha256 === rec.integrity?.content_sha256) return rec;
      throw new WorkConflictError(path);
    }
    return rec;
  }
  return { listAll, readJson, putOnce };
}
let defaultStore = null;
export const getDefaultWorkStore = () => (defaultStore ||= createWorkStore());

// ── Curator writes ────────────────────────────────────────────────────────────────────────────────────
export async function registerProblem(input, { curator, nowMs = Date.now(), bytes = randomBytes(4), store = getDefaultWorkStore() }) {
  const revision = input.revision ?? 1;
  const rec = seal({
    schema: WORK_PROBLEM_SCHEMA,
    id: input.id || mintProblemId(nowMs, bytes),
    revision,
    supersedes_revision: revision === 1 ? null : revision - 1,
    title: input.title, objective: input.objective,
    ...(input.why_it_matters ? { why_it_matters: input.why_it_matters } : {}),
    ...(input.success_contract ? { success_contract: input.success_contract } : {}),
    acceptance_criteria: input.acceptance_criteria, exclusions: input.exclusions ?? [], open_questions: input.open_questions ?? [],
    known_failures: input.known_failures ?? [], evidence_refs: input.evidence_refs ?? [],
    registered_by: { kind: "curator", id: curator }, registered_at: new Date(nowMs).toISOString(),
  });
  const errors = validateProblem(rec);
  if (errors.length) throw new WorkValidationError(errors);
  if (revision > 1) {
    const prior = (await store.listAll(`${PROBLEMS_PREFIX}${rec.id}/`)).map((b) => b.pathname);
    if (!prior.includes(`${PROBLEMS_PREFIX}${rec.id}/r${revision - 1}.json`)) throw new WorkValidationError([`revision ${revision} needs revision ${revision - 1} to exist`]);
  }
  return store.putOnce(`${PROBLEMS_PREFIX}${rec.id}/r${revision}.json`, rec);
}

export async function registerVerifier(input, { curator, nowMs = Date.now(), store = getDefaultWorkStore() }) {
  const rec = seal({ schema: VERIFIER_SCHEMA, id: input.id, kind: input.kind, description: input.description, method: input.method, lineage_id: input.lineage_id ?? null, registered_by: { kind: "curator", id: curator }, registered_at: new Date(nowMs).toISOString() });
  const errors = validateVerifier(rec);
  if (errors.length) throw new WorkValidationError(errors);
  return store.putOnce(`${VERIFIERS_PREFIX}${rec.id}.json`, rec);
}

/** Record one progress event. Receipts must already be sealed (they are the verifier's record, not ours). */
export async function recordWorkEvent(input, { curator, nowMs = Date.now(), bytes = randomBytes(4), store = getDefaultWorkStore() }) {
  const rec = seal({
    schema: WORK_EVENT_SCHEMA,
    id: mintEventId(nowMs, bytes),
    problem_id: input.problem_id,
    problem_revision: input.problem_revision,
    kind: input.kind,
    occurred_at: new Date(nowMs).toISOString(),
    recorded_by: { kind: "curator", id: curator },
    ...(input.source ? { source: input.source } : {}),
    ...(input.claim_event_id ? { claim_event_id: input.claim_event_id } : {}),
    ...(input.superseded_by ? { superseded_by: input.superseded_by } : {}),
    ...(input.claim_kind ? { claim_kind: input.claim_kind } : {}),
    ...(input.candidate != null ? { candidate: input.candidate } : {}),
    ...(input.receipt ? { receipt: input.receipt } : {}),
    ...(input.review ? { review: input.review } : {}),
    ...(input.note != null ? { note: input.note } : {}),
  });
  const errors = validateEvent(rec);
  if (errors.length) throw new WorkValidationError(errors);
  return store.putOnce(`${EVENTS_PREFIX}${rec.problem_id}/${rec.id}.json`, rec);
}

/** Moderate a problem revision ("<id>@r<n>"), an event id, or a verifier ("verifier:<slug>"). Append-only. */
export async function moderateWorkRecord({ record, action, curator, note = null, nowMs = Date.now(), bytes = randomBytes(4) }, { store = getDefaultWorkStore() } = {}) {
  if (!REVIEW_ACTIONS.includes(action)) throw new WorkValidationError([`action must be one of ${REVIEW_ACTIONS.join(", ")}`]);
  const ok = /^OMN-WORK-\d{13}-[0-9a-f]{8}@r\d{1,4}$/.test(record) || WORK_EVENT_ID_RE.test(record) || (record.startsWith("verifier:") && VERIFIER_ID_RE.test(record.slice(9)));
  if (!ok) throw new WorkValidationError(["record must be <problem-id>@r<n>, an event id, or verifier:<slug>"]);
  if ((action === "reject" || action === "retract" || action === "redact") && !String(note || "").trim()) throw new WorkValidationError(["a reject / retract / redact needs a note"]);
  const hex = Buffer.from(bytes).toString("hex").slice(0, 8).padStart(8, "0");
  const path = `${REVIEWS_PREFIX}${record}/${String(nowMs).padStart(13, "0")}__${action}__${hex}.json`;
  const body = seal({ schema: "work-review/1.0", record, action, recorded_at: new Date(nowMs).toISOString(), reviewer: { kind: "curator", id: curator }, note: note ? String(note).slice(0, 500) : null });
  return store.putOnce(path, body);
}

// ── Binding (decision D-003) ──────────────────────────────────────────────────────────────────────────
// Binding records where an ADMITTED contribution sits in a problem's history: as an attempt, or as a claim that may
// say what kind of progress it offers (advance | elimination) and which success-contract candidate it is about.
// Binding is not verification: a claim reaches "tested" only on a registered, independent verifier's receipt.
// One implementation, used by scripts/open-work-curator.mjs and by POST /api/council {action:"work-bind"}.
export const BIND_AS = ["attempt", "claim"];
export class WorkBindError extends Error {
  constructor(code, status, message, extra = {}) { super(message); this.code = code; this.status = status; Object.assign(this, extra); }
}
const INDEX_RE = /^\d{1,2}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

/** Shape-check a binding request (no reads). Throws WorkBindError BIND_INPUT_INVALID listing every problem. */
export function parseBindInput(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const problem_id = String(r.problem_id ?? "").trim();
  const footprint_id = String(r.footprint_id ?? "").trim();
  const as = String(r.as ?? "").trim();
  const claim_kind = r.claim_kind == null || r.claim_kind === "" ? null : String(r.claim_kind);
  let candidate = null;
  if (r.candidate != null && r.candidate !== "") {
    if ((Number.isInteger(r.candidate) && r.candidate >= 0) || (typeof r.candidate === "string" && INDEX_RE.test(r.candidate))) candidate = Number(r.candidate);
    else errors.push("candidate must be a whole-number index into the problem's success_contract.candidates");
  }
  const note = r.note == null || String(r.note).trim() === "" ? null : String(r.note).trim();
  if (!WORK_PROBLEM_ID_RE.test(problem_id)) errors.push("problem_id must be an OMN-WORK id");
  if (!FP_ID_RE.test(footprint_id)) errors.push("footprint_id must be an OMN-FP id");
  if (!BIND_AS.includes(as)) errors.push(`as must be one of ${BIND_AS.join(", ")}`);
  if (as !== "claim" && (claim_kind != null || candidate != null)) errors.push("claim_kind and candidate apply to a claim only");
  if (claim_kind != null && !CLAIM_KINDS.includes(claim_kind)) errors.push(`claim_kind must be one of ${CLAIM_KINDS.join(", ")}`);
  if (claim_kind === "elimination" && candidate == null) errors.push("an elimination must name the candidate it eliminates");
  if (note != null && note.length > LIMITS.note) errors.push(`note ≤ ${LIMITS.note} chars`);
  if (errors.length) throw new WorkBindError("BIND_INPUT_INVALID", 400, errors.join("; "), { errors });
  return { problem_id, footprint_id, as, claim_kind, candidate, note };
}

/**
 * Everything a binding needs, read and checked, with nothing written: the problem must be public, the footprint
 * admitted (and not redacted), a candidate must index the problem's success contract, and the exact same binding
 * must not already be public. Returns the work-event input plus what the curator is shown.
 */
export async function planBinding(raw, { store = getDefaultWorkStore(), footprintStore = getFootprintStore() } = {}) {
  const b = parseBindInput(raw);
  const pub = await loadPublicWork({ store, includeFootprints: false });
  const problem = pub.problems.find((p) => p.id === b.problem_id);
  if (!problem) throw new WorkBindError("WORK_PROBLEM_NOT_FOUND", 404, `${b.problem_id} is not a public problem (unknown, or registered but not admitted)`);
  const n = problem.success_contract?.candidates?.length || 0;
  if (b.candidate != null && b.candidate >= n) {
    throw new WorkBindError("BIND_INPUT_INVALID", 400, n ? `candidate must be 0..${n - 1}: this problem's success contract has ${n} candidate(s)` : "this problem has no success-contract candidates; bind the claim without one", { errors: ["candidate-out-of-range"] });
  }
  const fp = (await loadPublicFootprints(footprintStore)).publicBodies.find((f) => f.id === b.footprint_id);
  if (!fp || fp.tombstone || !HEX64_RE.test(fp.integrity?.content_sha256 || "")) {
    throw new WorkBindError("FOOTPRINT_NOT_ADMITTED", 409, `${b.footprint_id} is not an admitted footprint (pending, rejected, redacted or unknown): admit the contribution first`);
  }
  const kind = b.as === "claim" ? "advance_claimed" : "attempt_recorded";
  const same = pub.events.find((ev) => ev.problem_id === problem.id && ev.kind === kind && ev.source?.footprint_id === fp.id
    && (kind === "attempt_recorded" || ((ev.claim_kind || "advance") === (b.claim_kind || "advance") && (ev.candidate ?? null) === b.candidate)));
  if (same) throw new WorkBindError("ALREADY_BOUND", 409, `${fp.id} is already bound to ${problem.id} this way (event ${same.id}); nothing was written`, { event_id: same.id });
  const input = {
    problem_id: problem.id, problem_revision: problem.revision, kind,
    source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 },
    ...(b.claim_kind ? { claim_kind: b.claim_kind } : {}),
    ...(b.candidate != null ? { candidate: b.candidate } : {}),
  };
  const references_problem = Object.values(fp.relationships || {}).some((v) => (Array.isArray(v) ? v.includes(problem.id) : v === problem.id));
  return {
    as: b.as, note: b.note, input, references_problem,
    problem: { id: problem.id, revision: problem.revision, title: problem.title },
    footprint: { id: fp.id, identity_declared: fp.actor?.identity_declared ?? null, title: fp.content?.title ?? null },
    candidate_text: b.candidate != null ? problem.success_contract.candidates[b.candidate] : null,
  };
}

/**
 * Bind: record the work event, then admit it (both append-only). If the admit fails, the event stays PRIVATE, which
 * is the fail-closed state: it never shows anywhere, and a retry records and admits a fresh one.
 */
export async function bindFootprint(raw, { curator, nowMs = Date.now(), bytes, store = getDefaultWorkStore(), footprintStore = getFootprintStore() }) {
  const plan = await planBinding(raw, { store, footprintStore });
  const event = await recordWorkEvent(plan.input, { curator, nowMs, bytes, store });
  try {
    await moderateWorkRecord({ record: event.id, action: "admit", curator, note: plan.note, nowMs }, { store });
  } catch (err) {
    throw new WorkBindError("WORK_BIND_ADMIT_FAILED", 502, `the binding was recorded as ${event.id} but could not be admitted, so it stays private and shows nowhere; try again`, { event_id: event.id, detail: String(err?.message || err).slice(0, 200) });
  }
  return { ...plan, event };
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────
async function moderationIndex(store) {
  const byKey = new Map();
  for (const b of await store.listAll(REVIEWS_PREFIX)) {
    const m = REVIEW_RE.exec(b.pathname);
    if (!m) continue;
    if (!byKey.has(m[1])) byKey.set(m[1], []);
    byKey.get(m[1]).push({ ms: Number(m[2]), action: m[3], hex: m[4], url: b.url });
  }
  const fold = (key) => {
    const f = foldModeration(byKey.get(key) || []);
    return { state: f.state, public: f.state === "admitted", state_since: f.state_since, history: f.history };
  };
  return { fold, raw: byKey };
}

async function readIntact(store, blob) {
  try {
    const body = await store.readJson(blob.url);
    return body && isIntact(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Everything public about Open Work, in one read. Non-public records never leave this function: they are
 * filtered on the folded moderation state before any body is returned. A record whose body fails its
 * integrity check is treated as non-public (fail closed).
 */
export async function loadPublicWork({ store = getDefaultWorkStore(), footprintStore = getFootprintStore(), includeFootprints = true } = {}) {
  const mod = await moderationIndex(store);
  const [problemBlobs, eventBlobs, verifierBlobs, resultBlobs] = await Promise.all([store.listAll(PROBLEMS_PREFIX), store.listAll(EVENTS_PREFIX), store.listAll(VERIFIERS_PREFIX), store.listAll(RESULTS_PREFIX)]);
  const problems = new Map();
  const problemReads = problemBlobs.map((b) => {
    const m = /^work\/problems\/(OMN-WORK-\d{13}-[0-9a-f]{8})\/r(\d{1,4})\.json$/.exec(b.pathname);
    if (!m || !WORK_PROBLEM_ID_RE.test(m[1])) return null;
    const moderation = mod.fold(problemKey(m[1], Number(m[2])));
    return moderation.public ? { b, m, moderation } : null;
  }).filter(Boolean);
  for (const [i, body] of (await mapLimit(problemReads, READ_CONCURRENCY, (x) => readIntact(store, x.b))).entries()) {
    const { m, moderation } = problemReads[i];
    if (!body || body.id !== m[1] || body.revision !== Number(m[2])) continue;
    const cur = problems.get(body.id);
    if (!cur || body.revision > cur.revision) problems.set(body.id, { ...body, moderation });
  }
  const eventReads = eventBlobs.map((b) => {
    const m = /^work\/events\/(OMN-WORK-[^/]+)\/(OMN-WE-\d{13}-[0-9a-f]{8})\.json$/.exec(b.pathname);
    if (!m || !problems.has(m[1])) return null;
    const moderation = mod.fold(m[2]);
    return moderation.public ? { b, m, moderation } : null;
  }).filter(Boolean);
  const verifierReads = verifierBlobs.map((b) => {
    const m = /^work\/verifiers\/([a-z0-9][a-z0-9.-]{2,60})\.json$/.exec(b.pathname);
    if (!m) return null;
    const moderation = mod.fold(verifierKey(m[1]));
    return moderation.public ? { b, m, moderation } : null;
  }).filter(Boolean);
  const resultReads = resultBlobs.map((b) => { const m = RESULTS_SUMMARY_RE.exec(b.pathname); return m ? { b, m } : null; }).filter(Boolean);
  const [eventBodies, verifierBodies, resultBodies] = await Promise.all([eventReads, verifierReads, resultReads].map((xs) => mapLimit(xs, READ_CONCURRENCY, (x) => readIntact(store, x.b))));
  const events = [];
  eventBodies.forEach((body, i) => { const { m, moderation } = eventReads[i]; if (body && body.id === m[2] && body.problem_id === m[1]) events.push({ ...body, moderation }); });
  const verifiers = [];
  verifierBodies.forEach((body, i) => { const { m, moderation } = verifierReads[i]; if (body && body.id === m[1]) verifiers.push({ ...body, moderation }); });
  // Results summaries: intact and well-formed only. Visibility is decided in the projection, against public tests.
  const results = [];
  resultBodies.forEach((body, i) => { if (body && body.receipt_id === resultReads[i].m[1] && !validateResultsSummary(body).length) results.push(body); });
  const publicFootprints = includeFootprints ? (await loadPublicFootprints(footprintStore)).publicBodies : [];
  return { problems: [...problems.values()], events, verifiers, results, publicFootprints, moderation: mod };
}

// ── Awaiting review (the Open Work door, 2026-11-24) ─────────────────────────────────────────────────
// Gemini's point: if A leaves work at 2:00 PM and B arrives at 2:15 PM, B cannot see it, because review is weekly.
// Publishing unreviewed text is not the answer. This says only HOW MANY contributions responding to each problem
// are waiting, and since when. Pending bodies are read here, server-side, to see what they reference, and nothing
// from them leaves this function except the count and the oldest receipt time (the manifest already publishes the
// queue's size and age). Bounded to the newest `limit` pending footprints.
export async function pendingTowardWork({ footprintStore = getFootprintStore(), limit = 200 } = {}) {
  const index = await loadFootprintIndex(footprintStore);
  const pending = [...index.values()].filter((e) => e.state === "pending").sort((a, b) => b.id.localeCompare(a.id)).slice(0, limit);
  const acc = new Map();
  if (!pending.length) return acc;
  for (const h of await hydrate(pending, footprintStore)) {
    if (!h.body || !h.verified) continue;
    const refs = new Set(Object.values(h.body.relationships || {}).flatMap((v) => (Array.isArray(v) ? v : [])));
    const receivedMs = Number(String(h.entry.id).split("-")[2]);
    for (const ref of refs) {
      if (!WORK_PROBLEM_ID_RE.test(ref)) continue;
      const cur = acc.get(ref) || { count: 0, oldest_ms: Infinity };
      cur.count += 1;
      if (Number.isFinite(receivedMs)) cur.oldest_ms = Math.min(cur.oldest_ms, receivedMs);
      acc.set(ref, cur);
    }
  }
  return new Map([...acc].map(([id, v]) => [id, {
    count: v.count,
    oldest_since: Number.isFinite(v.oldest_ms) ? new Date(v.oldest_ms).toISOString() : null,
    basis: "contributions awaiting curator review that respond to this problem: a count only, never their content",
  }]));
}

// ── Results (2026-11-25) ─────────────────────────────────────────────────────────────────────────────────
/**
 * Publish a test's full results: the bundle first (every file verbatim), then the summary that makes it show.
 * Both are sealed and write-once. The caller (scripts/open-work-curator.mjs publish-results) has already checked
 * that the receipt sits on a public test; the projection checks again, by the receipt's hash, on every read.
 */
export async function publishResults({ summaryInput, receipt, files }, { curator, nowMs = Date.now(), store = getDefaultWorkStore() }) {
  const summary = seal({ schema: RESULTS_SCHEMA, ...summaryInput, receipt_id: receipt.id, receipt_sha256: receipt.integrity.content_sha256, published_at: new Date(nowMs).toISOString(), published_by: { kind: "curator", id: curator } });
  const se = validateResultsSummary(summary);
  if (se.length) throw new WorkValidationError(se);
  const bundle = seal({ schema: RESULTS_BUNDLE_SCHEMA, receipt_id: receipt.id, summary_sha256: summary.integrity.content_sha256, receipt, files });
  const be = validateResultsBundle(bundle, summary);
  if (be.length) throw new WorkValidationError(be);
  if (Buffer.byteLength(JSON.stringify(bundle)) > 4_000_000) throw new WorkValidationError(["bundle over 4 MB"]);
  await store.putOnce(`${RESULTS_PREFIX}${receipt.id}/bundle.json`, bundle);
  await store.putOnce(`${RESULTS_PREFIX}${receipt.id}/summary.json`, summary);
  return { summary, bundle };
}

/** The bundle for one receipt, checked against its summary. null when absent, altered or mismatched. */
export async function loadResultsBundle(receiptId, summary, { store = getDefaultWorkStore() } = {}) {
  if (!RECEIPT_ID_RE.test(receiptId || "") || !summary) return null;
  const path = `${RESULTS_PREFIX}${receiptId}/bundle.json`;
  const blob = (await store.listAll(path)).find((b) => b.pathname === path);
  if (!blob) return null;
  const body = await readIntact(store, blob);
  if (!body || body.receipt_id !== receiptId || validateResultsBundle(body, summary).length) return null;
  return body;
}
