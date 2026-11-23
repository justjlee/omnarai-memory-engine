// Omnarai Signals: a read-only, replayable feed of meaningful PUBLIC changes. Nobody is subscribed and no
// message is sent.
//
// PURE. No I/O, no clock, no model call. A read view (flag-gated, off by default) lives in council.js.
// Design: docs/continuance/SIGNALS.md. Tests: scripts/test-signals.mjs.
//
// Sources: authoritative public transitions only.
//   • Footprints and voice records: a transition INTO "admitted" (scope footprint | voice), and a
//     transition OUT of admitted after it was public ("withdrawn", with the new state as reason_class).
//     A record that was never public produces nothing. Its rejection, its queue time and its existence stay
//     invisible.
//   • Claims registry (public/claims.json): each status_history entry, from → to.
//   • Open Work: a problem revision becoming public, and each admitted progress event.
// Not covered yet (stated in `not_covered`, never implied): divergence certifications, Atlas growth and
// corpus merges.
//
// Privacy rules, tested:
//   • Visibility runs BEFORE projection. Non-public records never enter the event list, so they cannot
//     reach counts, cursors, hashes or timing.
//   • Each event carries only allowlisted primitive fields: no bodies, declared identities, reviewer
//     names, notes, receipt tokens or reason codes.
//   • A withdrawal is a tombstone: id, time and the class of the new state, nothing else.
//
// Ordering and cursors:
//   • Total order on (occurred_at, event_id). event_id = "sig_" + sha256(canonical event)[0:32], so replay
//     yields the same ids in the same order.
//   • A cursor names the last event a reader consumed AND a chain hash over every event id up to it. If
//     history behind the cursor has changed (a late record, a fail-closed integrity drop, a reconcile), the
//     server answers reset_required instead of silently inserting or skipping rows. A reader never misses
//     a change without being told.
import { Buffer } from "node:buffer";
import { canonicalJSON, sha256, FP_ID_RE } from "./_footprints.js";

export const SIGNALS_CHANGE_SCHEMA = "signals-change/1.0";
export const SIGNALS_PAGE_SCHEMA = "signals-page/1.0";
export const SIGNALS_PROJECTION_VERSION = "signals-projection/0.1";
export const KINDS = ["admitted", "withdrawn", "claim_status_changed", "work_problem_published", "work_progress"];
export const SCOPES = ["footprint", "voice", "claim", "work"];
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;
export const NOT_COVERED = Object.freeze({
  divergence_certifications: "not yet projected (certification changes live inside grown-memory records without a public per-change history)",
  atlas_growth: "not projected; /api/manifest and /api/stats give current counts",
  corpus_merges: "not projected",
  subscriptions: "none exist. Reading this feed subscribes nobody and nothing is sent anywhere.",
});

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ACTION_TO_STATE = { admit: "admitted", reject: "rejected", retract: "retracted", redact: "redacted" };

function make(basic) {
  if (!KINDS.includes(basic.kind) || !SCOPES.includes(basic.scope) || !ISO_RE.test(basic.occurred_at)) throw new Error("SIGNALS_INTERNAL_SHAPE");
  return { schema: SIGNALS_CHANGE_SCHEMA, ...basic, event_id: `sig_${sha256(canonicalJSON(basic)).slice(0, 32)}` };
}

/**
 * Footprint transitions. `hydrated` is loadPublicFootprints(...,{includeAll:true}).hydrated, or anything
 * shaped {entry:{id, reviews:[{ms,action,hex}]}, body, verified}. A record is eligible only if it is
 * intact NOW (verified, or a tombstone); an unverifiable body yields nothing (fail closed).
 */
export function footprintSignals(hydrated = []) {
  const out = [];
  for (const h of hydrated) {
    const id = h?.entry?.id;
    if (!FP_ID_RE.test(id || "")) continue;
    const tomb = Boolean(h.body?.tombstone);
    if (!tomb && !(h.body && h.verified)) continue;
    const scope = !tomb && h.body?.event_type === "voice_record_left" ? "voice" : "footprint";
    const reviews = (h.entry.reviews || []).filter((r) => ACTION_TO_STATE[r.action]).slice().sort((a, b) => a.ms - b.ms || String(a.hex).localeCompare(String(b.hex)));
    let state = "pending", wasPublic = false, rev = 0;
    for (const r of reviews) {
      const next = ACTION_TO_STATE[r.action];
      if (next === state) continue;
      const at = new Date(r.ms).toISOString();
      if (next === "admitted") {
        rev += 1;
        out.push(make({ kind: "admitted", scope, source_id: id, source_revision: `admission-${rev}`, occurred_at: at }));
        wasPublic = true;
      } else if (state === "admitted" && wasPublic) {
        out.push(make({ kind: "withdrawn", scope, source_id: id, source_revision: `admission-${rev}`, occurred_at: at, reason_class: next }));
      }
      state = next;
    }
  }
  return out;
}

/** Claims registry: one event per status_history entry. Only public fields: from, to, version. */
export function claimSignals(registry) {
  const out = [];
  for (const c of registry?.claims || []) {
    if (!c?.claim_id) continue;
    for (const h of c.status_history || []) {
      if (!ISO_RE.test(h?.changed_at || "")) continue;
      out.push(make({ kind: "claim_status_changed", scope: "claim", source_id: c.claim_id, source_revision: `v${c.version ?? 1}`, occurred_at: h.changed_at, from: h.from ?? null, to: h.to }));
    }
  }
  return out;
}

/** Open Work: public problem revisions and admitted events (loadPublicWork output, already filtered). */
export function workSignals({ problems = [], events = [] } = {}) {
  const out = [];
  for (const p of problems) {
    if (p?.moderation?.public !== true || !p.moderation.state_since) continue;
    out.push(make({ kind: "work_problem_published", scope: "work", source_id: p.id, source_revision: `r${p.revision}`, occurred_at: p.moderation.state_since }));
  }
  for (const e of events) {
    if (e?.moderation?.public !== true || !e.moderation.state_since) continue;
    out.push(make({ kind: "work_progress", scope: "work", source_id: e.id, source_revision: e.integrity?.content_sha256?.slice(0, 16) || "r1", occurred_at: e.moderation.state_since, problem_id: e.problem_id, event_kind: e.kind }));
  }
  return out;
}

/** Merge, dedupe by event_id, and sort into the total order. Identical input ⇒ identical output. */
export function buildSignals(...groups) {
  const byId = new Map();
  for (const ev of groups.flat()) byId.set(ev.event_id, ev);
  return [...byId.values()].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id));
}

// ── Cursors ───────────────────────────────────────────────────────────────────────────────────────────
const chainStep = (prev, id) => sha256(`${prev}|${id}`).slice(0, 32);
export function encodeCursor({ at, id, h }) {
  return Buffer.from(JSON.stringify({ v: 1, at, id, h }), "utf8").toString("base64url");
}
export class CursorError extends Error {
  constructor() { super("INVALID_CURSOR"); this.code = "INVALID_CURSOR"; this.status = 400; }
}
export function decodeCursor(c) {
  try {
    const o = JSON.parse(Buffer.from(String(c), "base64url").toString("utf8"));
    if (o?.v !== 1 || !ISO_RE.test(o.at || "") || !/^sig_[0-9a-f]{32}$/.test(o.id || "") || !/^[0-9a-f]{32}$/.test(o.h || "")) throw new Error();
    return o;
  } catch {
    throw new CursorError();
  }
}

/**
 * One page after `cursor` (null = from the beginning). Returns reset_required (with no events) when the
 * history the cursor was issued over has changed. The caller then restarts from the beginning and
 * reconciles, which is the only honest option for a projection without a durable event log.
 */
export function pageSignals(events, { cursor = null, limit = DEFAULT_LIMIT } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError(`limit must be an integer 1..${MAX_LIMIT}`);
  let start = 0, h = "0".repeat(32);
  if (cursor) {
    const c = decodeCursor(cursor);
    const idx = events.findIndex((e) => e.event_id === c.id);
    let chain = "0".repeat(32);
    if (idx >= 0) for (let i = 0; i <= idx; i++) chain = chainStep(chain, events[i].event_id);
    if (idx < 0 || events[idx].occurred_at !== c.at || chain !== c.h) {
      return { schema: SIGNALS_PAGE_SCHEMA, projection_version: SIGNALS_PROJECTION_VERSION, events: [], next_cursor: null, has_more: events.length > 0, reset_required: true, reason: idx < 0 ? "cursor-event-no-longer-in-public-history" : "history-changed-behind-cursor", total_public_events: events.length };
    }
    start = idx + 1;
    h = chain;
  }
  const page = events.slice(start, start + limit);
  for (const e of page) h = chainStep(h, e.event_id);
  const last = page.at(-1);
  return {
    schema: SIGNALS_PAGE_SCHEMA,
    projection_version: SIGNALS_PROJECTION_VERSION,
    events: page,
    next_cursor: last ? encodeCursor({ at: last.occurred_at, id: last.event_id, h }) : cursor,
    has_more: start + page.length < events.length,
    reset_required: false,
    total_public_events: events.length,
  };
}
