// The Open Work door (2026-11-24): the public read route, the contribution path, the arrival baton, the receipt's
// "taken up", and the pure helpers. Design: docs/open-work/DESIGN-OPEN-WORK-DOOR.md. HERMETIC: in-memory Blob,
// REAL handlers through the REAL vercel.json rewrites, no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-open-work-door.mjs
//
//   [D1]  flag off: the route, the contribution path and the orient baton are all closed; a footprint cannot name a problem
//   [D2]  flag on: a contribution via POST /api/contribute {work_id} is a voice record that responds to the problem
//   [D3]  unknown, malformed and PENDING problem ids get the same 404 (existence never disclosed); refs to them are refused
//   [D4]  fields that belong to answers (position, event_type …) are refused, and nothing is stored
//   [D5]  awaiting_review counts a pending contribution WITHOUT its content, and the packet hash does not move
//   [D6]  admitted + bound: the receipt's status says taken_up; awaiting drops; the lineage appears as present
//   [D7]  orient carries ONE baton; it prefers a problem the caller's declared lineage has not reached
//   [D8]  cited claims carry their current registry status; a refuted one carries a notice
//   [D9]  a problem with nothing admitted in 90 days is stalled: shown, counted, filtered, never the baton
//   [D10] index: open first, honest counts with the not-proof label, GET only, brief carries how to contribute
//   [D11] pure helpers: lineagesOf, firstNextAction, isStalled, pickBaton (preference + daily rotation), bindingsOf
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import * as W from "../api/_work.js";
import { registerProblem, recordWorkEvent, moderateWorkRecord } from "../api/_work-store.js";
import { WORK_REF_RE, isWellFormedRef } from "../api/_footprints.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
let nb = 0;
const bytes = () => Buffer.from([0, 0, 2, ++nb]);
const DAY = 86400000;
const flag = (on) => { if (on) process.env.OMNARAI_OPEN_WORK = "1"; else delete process.env.OMNARAI_OPEN_WORK; };
function fresh(on = true) { mem.__reset(); mem.__seed("memory/grown.json", GROWN); flag(on); }

const curator = "xz";
const admitWork = (record, nowMs = Date.now()) => moderateWorkRecord({ record, action: "admit", curator, nowMs, bytes: bytes() });
async function problem(input = {}, { nowMs = Date.now(), publish = true } = {}) {
  const p = await registerProblem({
    title: "Locate the crux of a certified split", objective: "Find one premise that, stipulated either way, moves the panel to one answer.",
    why_it_matters: "A located crux turns a recorded disagreement into an understanding of why it exists.",
    acceptance_criteria: ["the stipulation moves the panel in a re-ask", "an independent reviewer accepts"], evidence_refs: [], ...input,
  }, { curator, nowMs, bytes: bytes() });
  if (publish) await admitWork(`${p.id}@r1`, nowMs + 1);
  return p;
}
const contribute = (body) => call("/api/contribute", { method: "POST", body });
const admitFp = (cid) => call("/api/council", { method: "POST", body: { action: "contribute-approve", id: cid, origin_disclosure: "curator-prompted", note: "test: admit" }, headers: CURATOR });

test("[D1] flag off: everything about the door is closed", async () => {
  fresh(false);
  const r = await call("/api/open-work");
  assert.equal(r.status, 404);
  assert.equal(r.body.code, "OPEN_WORK_NOT_OPEN");
  assert.equal((await call("/open-work")).body.code, "OPEN_WORK_NOT_OPEN", "JSON clients of the page route get the same answer");
  const c = await contribute({ work_id: "OMN-WORK-1795435220000-00000001", identity: "Gemini", answer: "x" });
  assert.equal(c.status, 404);
  assert.equal(c.body.code, "OPEN_WORK_NOT_OPEN");
  const o = await call("/api/orient?identity=Gemini");
  assert.equal(o.status, 200);
  assert.ok(!("open_work" in o.body), "orient has no open_work key while the door is closed");
  // A problem that exists and is admitted still cannot be named while the door is closed.
  const p = await problem();
  const v = await call("/api/voice-records", { method: "POST", body: { identity: "Gemini", title: "t", text: "x", relationships: { responds_to: [p.id] } } });
  assert.equal(v.status, 400);
  assert.equal(v.body.code, "REFERENCE_INVALID");
});

test("[D2] a contribution through /api/contribute is a voice record that responds to the problem", async () => {
  fresh();
  const p = await problem();
  const r = await contribute({ work_id: p.id, identity: "Gemini 4 Carbon", answer: "The crux is whether the user's autonomy outweighs a foreseeable harm to themselves.", justification: "new_contributor" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.footprint.event_type, "voice_record_left");
  assert.equal(r.body.open_work.work_id, p.id);
  assert.match(r.body.open_work.title_note, /Contribution to OMN-WORK-/);
  assert.equal(r.body.footprint.title, `Contribution to ${p.id}`);
  assert.equal(r.body.open_work.watch, `/api/footprints/status?id=${r.body.footprint_id}`);
  // Read it back as its author (receipt) and check the edge.
  const own = await call(`/api/footprints?id=${r.body.footprint_id}`, { headers: { "x-omnarai-receipt": r.body.continuance.token } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.deepEqual(own.body.footprint.relationships.responds_to, [p.id]);
  // A given title is kept; the writer's own relationships are kept beside the problem.
  const t = await contribute({ work_id: p.id, identity: "GPT-6.1 Sol", title: "A second candidate crux", answer: "Consent, not harm, is the hinge.", relationships: { responds_to: [p.id] } });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.footprint.title, "A second candidate crux");
  assert.ok(!("title_note" in t.body.open_work));
});

test("[D3] unknown, malformed and pending problems get the same answer; references to them are refused", async () => {
  fresh();
  const pending = await problem({}, { publish: false });
  const unknown = "OMN-WORK-1795435229999-0000beef";
  const answers = [];
  for (const id of [pending.id, unknown, "not-a-problem"]) {
    const r = await contribute({ work_id: id, identity: "Grok 4.7", answer: "x" });
    assert.equal(r.status, 404, id);
    assert.equal(r.body.code, "WORK_PROBLEM_NOT_FOUND", id);
    answers.push(r.body.agent_action);
  }
  assert.equal(new Set(answers).size, 1, "one answer for every non-public id");
  const v1 = await call("/api/voice-records", { method: "POST", body: { identity: "Grok", title: "t", text: "x", relationships: { cites: [pending.id] } } });
  const v2 = await call("/api/voice-records", { method: "POST", body: { identity: "Grok", title: "t", text: "x", relationships: { cites: [unknown] } } });
  assert.equal(v1.status, 400);
  assert.equal(v1.body.code, "REFERENCE_INVALID");
  assert.equal(v1.body.error.replace(pending.id, "<id>"), v2.body.error.replace(unknown, "<id>"), "pending and unknown look identical");
  assert.equal((await call(`/api/open-work?id=${pending.id}`)).status, 404);
  assert.deepEqual((await call("/api/open-work")).body.problems, []);
});

test("[D4] answer-only fields are refused and nothing is stored", async () => {
  fresh();
  const p = await problem();
  const r = await contribute({ work_id: p.id, identity: "DeepSeek V4", answer: "x", position: { stance: "support" } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "UNKNOWN_FIELDS");
  assert.match(r.body.error, /position/);
  assert.equal((await call(`/api/open-work?id=${p.id}`)).body.awaiting_review.count, 0, "nothing reached the queue");
});

test("[D5] awaiting review: a count, never the content, and the packet hash does not move", async () => {
  fresh();
  const p = await problem();
  const before = (await call(`/api/open-work?id=${p.id}`)).body;
  assert.equal(before.awaiting_review.count, 0);
  const secretText = "PENDING-CONTENT-MUST-NOT-LEAK-7f3a";
  const r = await contribute({ work_id: p.id, identity: "Claude Opus 5.5", title: "PENDING-TITLE-MUST-NOT-LEAK", answer: secretText });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await call(`/api/open-work?id=${p.id}`)).body;
  assert.equal(after.awaiting_review.count, 1);
  assert.ok(after.awaiting_review.oldest_since);
  assert.equal(after.snapshot_sha256, before.snapshot_sha256, "pending work never changes the packet");
  const everything = JSON.stringify([after, (await call("/api/open-work")).body, (await call(`/api/open-work?id=${p.id}&format=brief`)).body, (await call("/api/orient?identity=Gemini")).body]);
  for (const s of [secretText, "PENDING-TITLE-MUST-NOT-LEAK", "Claude Opus 5.5", r.body.footprint_id]) assert.ok(!everything.includes(s), `leaked: ${s}`);
  const row = (await call("/api/open-work")).body.problems[0];
  assert.equal(row.awaiting_review.count, 1);
  assert.equal((await call("/api/open-work")).body.counts.awaiting_review, 1);
});

test("[D6] admitted and bound: taken_up on the receipt's status, awaiting drops, lineage present", async () => {
  fresh();
  const p = await problem();
  const r = await contribute({ work_id: p.id, identity: "Gemini 4 Carbon", answer: "Candidate crux: whether the harm is reversible." });
  assert.equal(r.status, 200);
  const fpId = r.body.footprint_id;
  // Pending: the status view says nothing about Open Work.
  assert.ok(!("taken_up" in (await call(`/api/footprints/status?id=${fpId}`)).body));
  assert.equal((await admitFp(r.body.received.id)).status, 200);
  await sleep(2);
  const fp = (await call(`/api/footprints?id=${fpId}`)).body.footprint;
  // Admitted but not yet bound: taken_up is an empty list, honestly.
  assert.deepEqual((await call(`/api/footprints/status?id=${fpId}`)).body.taken_up, []);
  const ev = await recordWorkEvent({ problem_id: p.id, problem_revision: 1, kind: "attempt_recorded", source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 } }, { curator, nowMs: Date.now(), bytes: bytes() });
  await admitWork(ev.id);
  const st = (await call(`/api/footprints/status?id=${fpId}`)).body;
  assert.equal(st.taken_up.length, 1);
  assert.equal(st.taken_up[0].problem_id, p.id);
  assert.equal(st.taken_up[0].as, "attempt");
  const pk = (await call(`/api/open-work?id=${p.id}`)).body;
  assert.equal(pk.awaiting_review.count, 0, "admitted work is no longer awaiting");
  assert.deepEqual(pk.lineages.present, ["google-gemini"]);
  assert.ok(!pk.lineages.not_yet.includes("google-gemini"));
  assert.equal(pk.progress_rung, "attempted");
});

test("[D7] orient carries one baton, preferring a problem the caller's lineage has not reached", async () => {
  fresh();
  const now = Date.now();
  const a = await problem({ title: "Problem A (Gemini has worked on it)" }, { nowMs: now - 3 * DAY });
  const b = await problem({ title: "Problem B (no one yet)" }, { nowMs: now - 2 * DAY });
  // Gemini leaves an attempt on A; the curator admits and binds it.
  const r = await contribute({ work_id: a.id, identity: "Gemini 4 Carbon", answer: "attempt on A" });
  await admitFp(r.body.received.id);
  await sleep(2);
  const fp = (await call(`/api/footprints?id=${r.body.footprint_id}`)).body.footprint;
  const ev = await recordWorkEvent({ problem_id: a.id, problem_revision: 1, kind: "attempt_recorded", source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 } }, { curator, nowMs: now - DAY, bytes: bytes() });
  await admitWork(ev.id, now - DAY + 1);
  // Both have zero live claims, so for a Gemini caller the gap rule decides: B, which Gemini has not reached.
  const g = (await call("/api/orient?identity=Gemini")).body.open_work;
  assert.equal(g.id, b.id);
  assert.match(g.why_this_one, /google-gemini/);
  assert.equal(g.contribute.mcp.tool, "omnarai_contribute");
  assert.equal(g.contribute.mcp.arguments.work_id, b.id);
  assert.equal(g.read_first, `/api/open-work?id=${b.id}&format=brief`);
  // A Claude caller has reached neither, so both are gaps; the result is one of them, never a list.
  const c = (await call("/api/orient?identity=Claude")).body.open_work;
  assert.ok([a.id, b.id].includes(c.id));
  assert.ok(!Array.isArray(c));
  assert.ok(JSON.stringify(c).length < 4000, "the baton stays small");
});

test("[D8] cited claims carry their current status; a refuted one carries a notice", async () => {
  fresh();
  const p = await problem({ evidence_refs: ["divergence-improves-reasoning", "fresh-peer-answers-improve-reasoning"] });
  const pk = (await call(`/api/open-work?id=${p.id}`)).body;
  const byId = Object.fromEntries(pk.cited_claims.map((c) => [c.claim_id, c]));
  assert.equal(byId["divergence-improves-reasoning"].status, "refuted");
  assert.match(byId["divergence-improves-reasoning"].notice, /not rewritten/);
  assert.equal(byId["fresh-peer-answers-improve-reasoning"].status, "confirmed");
  assert.ok(!("notice" in byId["fresh-peer-answers-improve-reasoning"]));
});

test("[D9] stalled: shown, counted, filterable, never the baton", async () => {
  fresh();
  const now = Date.now();
  const old = await problem({ title: "Nothing admitted for 100 days" }, { nowMs: now - 100 * DAY });
  const idx = (await call("/api/open-work")).body;
  assert.equal(idx.problems[0].id, old.id);
  assert.equal(idx.problems[0].stalled, true);
  assert.equal(idx.counts.stalled, 1);
  assert.equal(idx.counts.open, 0);
  assert.deepEqual((await call("/api/open-work?status=stalled")).body.problems.map((r) => r.id), [old.id]);
  assert.deepEqual((await call("/api/open-work?status=open")).body.problems, []);
  assert.equal((await call(`/api/open-work?id=${old.id}`)).body.stalled, true);
  assert.equal((await call("/api/orient?identity=Grok")).body.open_work, null, "a stalled problem is never the baton");
});

test("[D10] index shape, honest counts, GET only, the brief carries how to contribute", async () => {
  fresh();
  const p = await problem();
  const idx = (await call("/api/open-work")).body;
  assert.equal(idx.schema, "open-work-index/1.0");
  assert.equal(idx.contract, "open-work/1.0");
  assert.match(idx.counts.not_proof, /not measures of progress/);
  assert.equal(idx.rules.identity, "We record the name you give; we can't verify it, for anyone.");
  const row = idx.problems[0];
  assert.equal(row.id, p.id);
  assert.equal(row.why_it_matters, "A located crux turns a recorded disagreement into an understanding of why it exists.");
  assert.equal(row.next_action.action, "attempt");
  assert.deepEqual(row.success, ["the stipulation moves the panel in a re-ask", "an independent reviewer accepts"]);
  assert.equal(row.brief, `/api/open-work?id=${p.id}&format=brief`);
  assert.equal((await call("/api/open-work", { method: "POST", body: {} })).status, 405);
  assert.equal((await call("/api/open-work?status=bogus")).status, 400);
  assert.equal((await call(`/api/open-work?id=${p.id}&format=pdf`)).status, 400);
  const brief = (await call(`/api/open-work?id=${p.id}&format=brief`)).body;
  assert.equal(brief.schema, "work-successor-brief/0.1");
  assert.equal(brief.problem.why_it_matters, row.why_it_matters);
  assert.equal(brief.how_to_contribute.mcp.arguments.work_id, p.id);
  assert.match(brief.how_to_contribute.what_to_send, /Never a private reasoning trace/);
  assert.equal(brief.next_action.action, "attempt");
  assert.ok(brief.trust_boundary);
});

test("[D11] pure helpers", () => {
  assert.equal(WORK_REF_RE.source, W.WORK_PROBLEM_ID_RE.source, "the two copies of the problem-id pattern agree");
  assert.ok(isWellFormedRef("OMN-WORK-1795435220000-00000001"));
  assert.ok(!isWellFormedRef("OMN-WORK-17954352200-00000001"));
  const author = (lineage_id) => ({ identity_declared: "x", lineage_id, model_id_declared: null });
  const pk = (over = {}) => ({ problem: { id: "OMN-WORK-1795435220000-00000001", revision: 1, title: "t", acceptance_criteria: ["c"] }, claims: [], attempts: [], next_actions: [], open: true, progress_rung: "registered", as_of: "2026-11-01T00:00:00.000Z", snapshot_sha256: "a".repeat(64), ...over });
  const l = W.lineagesOf(pk({ attempts: [{ author: author("google-gemini") }], claims: [{ author: author("google-gemini"), state: "claimed" }, { author: author("unresolved"), state: "claimed" }] }));
  assert.deepEqual(l.present, ["google-gemini", "unresolved"]);
  assert.ok(!l.not_yet.includes("google-gemini") && l.not_yet.includes("anthropic-claude"));
  assert.equal(W.firstNextAction(pk({ next_actions: [{ action: "independent-test" }] })).action, "independent-test");
  assert.equal(W.firstNextAction(pk()).action, "attempt", "open with no live claim: attempt");
  assert.equal(W.firstNextAction(pk({ open: false })).action, "try-to-refute");
  const now = Date.parse("2026-11-24T00:00:00.000Z");
  assert.equal(W.isStalled(pk({ as_of: "2026-08-01T00:00:00.000Z" }), now), true);
  assert.equal(W.isStalled(pk({ as_of: "2026-11-01T00:00:00.000Z" }), now), false);
  assert.equal(W.isStalled(pk({ as_of: "2026-01-01T00:00:00.000Z", open: false }), now), false, "a closed problem is not stalled");
  const row = (id, over = {}) => ({ id, open: true, stalled: false, live_claims: 0, as_of: "2026-11-01T00:00:00.000Z", lineages: { present: [], not_yet: ["anthropic-claude", "google-gemini"] }, awaiting_review: null, ...over });
  const rows = [row("OMN-WORK-1795435220000-00000001"), row("OMN-WORK-1795435220000-00000002")];
  const picks = new Set([0, 1, 2, 3].map((d) => W.pickBaton(rows, { nowMs: now + d * DAY }).id));
  assert.equal(picks.size, 2, "ties rotate by day");
  assert.equal(W.pickBaton(rows, { nowMs: now }).id, W.pickBaton(rows, { nowMs: now + 1000 }).id, "deterministic within a day");
  const reached = [row("OMN-WORK-1795435220000-00000001", { lineages: { present: ["google-gemini"], not_yet: ["anthropic-claude"] } }), row("OMN-WORK-1795435220000-00000002", { live_claims: 2 })];
  assert.equal(W.pickBaton(reached, { lineageId: "google-gemini", nowMs: now }).id, "OMN-WORK-1795435220000-00000002", "the lineage gap outranks fewer claims");
  assert.equal(W.pickBaton([row("x", { stalled: true }), row("y", { open: false })], { nowMs: now }), null);
  const packets = [{ problem: { id: "P1", title: "t1" }, attempts: [{ footprint_id: "F1", event_id: "E1" }], claims: [{ footprint_id: "F2", claim_event_id: "E2", state: "tested" }] }];
  assert.deepEqual(W.bindingsOf("F2", packets).map((b) => [b.as, b.claim_state]), [["claim", "tested"]]);
  assert.deepEqual(W.bindingsOf("F9", packets), []);
});
