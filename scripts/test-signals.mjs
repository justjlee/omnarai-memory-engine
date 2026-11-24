// Signals projection (api/_signals.js): pure, hermetic.
//
//   node --test scripts/test-signals.mjs
//
//   [S1] never-public records produce nothing: pending, rejected-on-arrival, unverifiable bodies
//   [S2] admitted → one event; withdrawal of a once-public record → a tombstone with only safe fields
//   [S3] allowlisted fields only: no bodies, identities, notes, reason codes, tokens
//   [S4] replay is identical, deduplicated, and independent of input order
//   [S5] cursor paging never repeats or skips across pages; limits enforced; bad cursors refused
//   [S6] history changing behind a cursor is DETECTED (reset_required), never silently inserted or skipped
//   [S7] claims registry and Open Work transitions project with only their public fields
//   [S8] no subscription, message or write exists in the module
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../api/_signals.js";

const ms = (s) => 1780000000000 + s * 1000;
const h = (id, actions, body = {}, verified = true) => ({
  entry: { id, reviews: actions.map(([s, action], i) => ({ ms: ms(s), action, hex: i.toString(16).padStart(8, "0") })) },
  body: { id, event_type: "answer_contributed", actor: { identity_declared: "Secret Name (fixture)" }, answer: "BODY TEXT", ...body },
  verified,
});
const ID = (k) => `OMN-FP-17800000000${String(k).padStart(2, "0")}-${String(k).padStart(8, "0")}`;

test("[S1] never-public records produce nothing", () => {
  const x = S.footprintSignals([
    h(ID(1), []),                         // pending
    h(ID(2), [[1, "reject"]]),             // rejected on arrival
    h(ID(3), [[1, "admit"]], {}, false),   // admitted but body fails integrity now: fail closed
    h(ID(4), [[1, "note"]]),               // notes never change state
  ]);
  assert.deepEqual(x, []);
});

test("[S2] admission and withdrawal tombstone", () => {
  const x = S.footprintSignals([h(ID(5), [[1, "admit"], [5, "retract"], [9, "admit"]]), h(ID(6), [[2, "admit"]], { event_type: "voice_record_left" })]);
  assert.deepEqual(x.map((e) => [e.source_id, e.kind, e.scope, e.reason_class ?? null, e.source_revision]), [
    [ID(5), "admitted", "footprint", null, "admission-1"],
    [ID(5), "withdrawn", "footprint", "retracted", "admission-1"],
    [ID(5), "admitted", "footprint", null, "admission-2"],
    [ID(6), "admitted", "voice", null, "admission-1"],
  ]);
  const tomb = S.footprintSignals([{ entry: { id: ID(7), reviews: [{ ms: ms(1), action: "admit", hex: "0" }, { ms: ms(3), action: "redact", hex: "1" }] }, body: { id: ID(7), tombstone: true, reason_category: "privacy" }, verified: false }]);
  assert.deepEqual(tomb.map((e) => [e.kind, e.scope, e.reason_class ?? null]), [["admitted", "footprint", null], ["withdrawn", "footprint", "redacted"]]);
  assert.ok(!JSON.stringify(tomb).includes("privacy"), "the redaction reason category is not published");
});

test("[S3] allowlisted fields only", () => {
  const out = JSON.stringify(S.footprintSignals([h(ID(8), [[1, "admit"], [2, "reject"]], { receipt_token: "tok-secret", note: "curator note" })]));
  for (const leak of ["BODY TEXT", "Secret Name", "tok-secret", "curator note", "reason_code", "actor"]) assert.ok(!out.includes(leak), leak);
  for (const e of JSON.parse(out)) assert.deepEqual(Object.keys(e).sort(), ["event_id", "kind", "occurred_at", "schema", "scope", "source_id", "source_revision", ...(e.kind === "withdrawn" ? ["reason_class"] : [])].sort());
});

test("[S4] replay identical, deduplicated, order-independent", () => {
  const hs = [h(ID(9), [[3, "admit"]]), h(ID(10), [[3, "admit"]]), h(ID(11), [[1, "admit"]])];
  const a = S.buildSignals(S.footprintSignals(hs));
  assert.deepEqual(a, S.buildSignals(S.footprintSignals([...hs].reverse())));
  assert.deepEqual(a, S.buildSignals(S.footprintSignals(hs), S.footprintSignals(hs)), "a replayed transition is one event");
  assert.equal(a[0].source_id, ID(11));
  assert.ok(a[1].event_id < a[2].event_id, "ties break on event_id");
});

test("[S5] paging never repeats or skips; limits and cursors validated", () => {
  const events = S.buildSignals(S.footprintSignals(Array.from({ length: 7 }, (_, i) => h(ID(20 + i), [[i % 3, "admit"]]))));
  const got = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard++) {
    const p = S.pageSignals(events, { cursor, limit: 3 });
    assert.equal(p.reset_required, false);
    got.push(...p.events.map((e) => e.event_id));
    cursor = p.next_cursor;
    if (!p.has_more) break;
  }
  assert.deepEqual(got, events.map((e) => e.event_id));
  assert.deepEqual(S.pageSignals(events, { cursor, limit: 3 }).events, [], "past the end: empty, same cursor");
  assert.equal(S.pageSignals(events, { cursor, limit: 3 }).next_cursor, cursor);
  assert.throws(() => S.pageSignals(events, { limit: 101 }), /limit/);
  assert.throws(() => S.pageSignals(events, { limit: 0 }), /limit/);
  assert.throws(() => S.pageSignals(events, { cursor: "garbage" }), /INVALID_CURSOR/);
  assert.throws(() => S.pageSignals(events, { cursor: Buffer.from('{"v":1}').toString("base64url") }), /INVALID_CURSOR/);
});

test("[S6] history changed behind a cursor is detected, never silently patched", () => {
  const base = [h(ID(40), [[1, "admit"]]), h(ID(41), [[2, "admit"]]), h(ID(42), [[3, "admit"]])];
  const events = S.buildSignals(S.footprintSignals(base));
  const p1 = S.pageSignals(events, { limit: 2 });
  // A record whose transition time falls BEFORE the consumed position appears (late write / reconcile).
  const late = S.buildSignals(S.footprintSignals([...base, h(ID(43), [[0, "admit"]])]));
  const r = S.pageSignals(late, { cursor: p1.next_cursor, limit: 2 });
  assert.equal(r.reset_required, true);
  assert.equal(r.reason, "history-changed-behind-cursor");
  assert.deepEqual(r.events, []);
  // A consumed event that vanished (integrity now fails) is also reported.
  const gone = S.buildSignals(S.footprintSignals([base[0], { ...base[1], verified: false }, base[2]]));
  assert.equal(S.pageSignals(gone, { cursor: p1.next_cursor }).reason, "cursor-event-no-longer-in-public-history");
  // An append AFTER the cursor is the normal case: no reset.
  const appended = S.buildSignals(S.footprintSignals([...base, h(ID(44), [[9, "admit"]])]));
  const ok = S.pageSignals(appended, { cursor: p1.next_cursor });
  assert.equal(ok.reset_required, false);
  assert.deepEqual(ok.events.map((e) => e.source_id), [ID(42), ID(44)]);
});

test("[S7] claims registry and Open Work project only public fields", () => {
  const reg = JSON.parse(readFileSync(new URL("../public/claims.json", import.meta.url), "utf8"));
  const c = S.claimSignals(reg);
  assert.equal(c.length, reg.claims.reduce((n, x) => n + x.status_history.length, 0));
  assert.ok(c.every((e) => !("changed_by" in e) && !("reason" in e) && e.scope === "claim"));
  const w = S.workSignals({
    problems: [{ id: "OMN-WORK-1780000000000-0000000a", revision: 2, moderation: { public: true, state_since: "2026-11-23T01:00:00.000Z" } }, { id: "OMN-WORK-1780000000000-0000000b", revision: 1, moderation: { public: false, state_since: "2026-11-23T01:00:00.000Z" } }],
    events: [{ id: "OMN-WE-1780000000001-00000001", problem_id: "OMN-WORK-1780000000000-0000000a", kind: "advance_claimed", integrity: { content_sha256: "a".repeat(64) }, recorded_by: { id: "xz" }, moderation: { public: true, state_since: "2026-11-23T02:00:00.000Z" } }],
  });
  assert.deepEqual(w.map((e) => [e.kind, e.source_revision]), [["work_problem_published", "r2"], ["work_progress", "aaaaaaaaaaaaaaaa"]]);
  assert.ok(!JSON.stringify(w).includes("0000000b") && !JSON.stringify(w).includes("xz"));
});

test("[S8] the module cannot subscribe, send or store", () => {
  const src = readFileSync(new URL("../api/_signals.js", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\bfetch\(|\bput\(|_blob|webhook|sendMail|nodemailer|subscribe\(/i);
  assert.match(S.NOT_COVERED.subscriptions, /subscribes nobody/);
});
