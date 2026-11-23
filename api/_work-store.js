// Open Work storage: write-once records + append-only moderation, under the PRIVATE "work/" class.
//
// Same shape as Footprints (api/_footprints.js), on purpose:
//   work/problems/<OMN-WORK-…>/r<revision>.json    problem revisions, write-once
//   work/events/<OMN-WORK-…>/<OMN-WE-…>.json        progress events, write-once
//   work/verifiers/<slug>.json                      verifier registrations, write-once
//   work/reviews/<record-key>/<ms>__<action>__<hex>.json   moderation, append-only (action in the pathname)
// There is no read-modify-write anywhere, so the store needs no CAS and cannot lose a concurrent write.
// Every record is published only by a later `admit` review, folded by the Footprint rule (foldModeration),
// so an unknown or malformed review can never publish anything.
//
// There is NO HTTP write path. Registering a problem, recording an event and moderating are curator
// operations called from scripts or a future authenticated curator action (decision D-003). Visiting minds
// contribute exactly as they do today, by leaving Footprints, which the curator then binds to a problem.
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { list as blobList, put as blobPut, blobFetch } from "./_blob.js";
import { foldModeration, REVIEW_ACTIONS, loadPublicFootprints, getDefaultStore as getFootprintStore } from "./_footprints.js";
import {
  WORK_PROBLEM_SCHEMA, WORK_EVENT_SCHEMA, VERIFIER_SCHEMA, WORK_PROBLEM_ID_RE, WORK_EVENT_ID_RE, VERIFIER_ID_RE,
  validateProblem, validateEvent, validateVerifier, seal, isIntact, mintProblemId, mintEventId,
} from "./_work.js";

export const WORK_PREFIX = "work/";
export const PROBLEMS_PREFIX = "work/problems/";
export const EVENTS_PREFIX = "work/events/";
export const VERIFIERS_PREFIX = "work/verifiers/";
export const REVIEWS_PREFIX = "work/reviews/";

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
  const [problemBlobs, eventBlobs, verifierBlobs] = await Promise.all([store.listAll(PROBLEMS_PREFIX), store.listAll(EVENTS_PREFIX), store.listAll(VERIFIERS_PREFIX)]);
  const problems = new Map();
  for (const b of problemBlobs) {
    const m = /^work\/problems\/(OMN-WORK-\d{13}-[0-9a-f]{8})\/r(\d{1,4})\.json$/.exec(b.pathname);
    if (!m || !WORK_PROBLEM_ID_RE.test(m[1])) continue;
    const moderation = mod.fold(problemKey(m[1], Number(m[2])));
    if (!moderation.public) continue;
    const body = await readIntact(store, b);
    if (!body || body.id !== m[1] || body.revision !== Number(m[2])) continue;
    const cur = problems.get(body.id);
    if (!cur || body.revision > cur.revision) problems.set(body.id, { ...body, moderation });
  }
  const events = [];
  for (const b of eventBlobs) {
    const m = /^work\/events\/(OMN-WORK-[^/]+)\/(OMN-WE-\d{13}-[0-9a-f]{8})\.json$/.exec(b.pathname);
    if (!m || !problems.has(m[1])) continue;
    const moderation = mod.fold(m[2]);
    if (!moderation.public) continue;
    const body = await readIntact(store, b);
    if (body && body.id === m[2] && body.problem_id === m[1]) events.push({ ...body, moderation });
  }
  const verifiers = [];
  for (const b of verifierBlobs) {
    const m = /^work\/verifiers\/([a-z0-9][a-z0-9.-]{2,60})\.json$/.exec(b.pathname);
    if (!m) continue;
    const moderation = mod.fold(verifierKey(m[1]));
    if (!moderation.public) continue;
    const body = await readIntact(store, b);
    if (body && body.id === m[1]) verifiers.push({ ...body, moderation });
  }
  const publicFootprints = includeFootprints ? (await loadPublicFootprints(footprintStore)).publicBodies : [];
  return { problems: [...problems.values()], events, verifiers, publicFootprints, moderation: mod };
}
