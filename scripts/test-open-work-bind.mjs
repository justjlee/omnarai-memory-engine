// Binding from the curator's dashboard (decision D-003, 2026-11-24): POST /api/council {action:"work-bind"}.
// The /home Arrivals panel calls it on the operator session; scripts/open-work-curator.mjs bind runs the same code
// (api/_work-store.js planBinding / bindFootprint). HERMETIC: in-memory Blob, REAL handlers through the REAL
// vercel.json rewrites, no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-open-work-bind.mjs
//
//   [B1]  no curator credential: 401, nothing written; a GET is refused; with the door closed: 404, nothing written
//   [B2]  the operator session cookie (the dashboard's sign-in) and the Bearer key both work
//   [B3]  bad input is refused before any read or write, listing every problem
//   [B4]  the problem must be public and the footprint admitted (pending, rejected and unknown are refused)
//   [B5]  attempt: the packet shows it, the receipt's status says taken_up, the awaiting count drops
//   [B6]  claim with an elimination + candidate: recorded as claimed; the candidate and milestones do NOT move
//   [B7]  candidates must index the problem's success contract; a problem without one takes none
//   [B8]  the same binding twice is refused (a double click writes one event); a different role is allowed
//   [B9]  if the admit fails, the event stays private (fail closed) and a retry publishes exactly one binding
//   [B10] the curator script's plan and the HTTP action produce the same event input
//   [B11] a footprint that does not name the problem can still be bound (the curator's call); the answer says so
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { registerProblem, moderateWorkRecord, planBinding, parseBindInput, WorkBindError, EVENTS_PREFIX } from "../api/_work-store.js";
import { mintSession, COOKIE } from "../api/_operator.js";

process.env.INGEST_SECRET = "test-curator-secret";
process.env.OPERATOR_SESSION_KEY = "k".repeat(64);
const CURATOR = { authorization: "Bearer test-curator-secret" };
const session = () => ({ cookie: `${COOKIE}=${mintSession().value}`, "x-omnarai-operator": "1", origin: "https://omnarai.org" });
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
let nb = 0;
const bytes = () => Buffer.from([0, 0, 3, ++nb]);
const flag = (on) => { if (on) process.env.OMNARAI_OPEN_WORK = "1"; else delete process.env.OMNARAI_OPEN_WORK; };
function fresh(on = true) { mem.__reset(); mem.__seed("memory/grown.json", GROWN); flag(on); }

const CONTRACT = {
  advance: "A proposed crux passes the crux check.",
  elimination: "Stipulating a candidate either way moves at most one panel model.",
  candidates: ["autonomy versus foreseeable self-harm", "consent, not harm", "reversibility of the harm"],
  checked_by: { verifier_id: "crux-reask", method: "crux-reask-and-score", runs_where: "paid-run", cost_per_check_usd: 0.2 },
  resolves_when: "A crux passes twice in independent runs and an independent reviewer accepts it.",
};
async function problem(input = {}, { publish = true } = {}) {
  const p = await registerProblem({
    title: "Locate the crux of a certified split", objective: "Find one premise that, stipulated either way, moves the panel to one answer.",
    why_it_matters: "A located crux turns a recorded disagreement into an understanding of why it exists.",
    acceptance_criteria: ["the stipulation moves the panel in a re-ask", "an independent reviewer accepts"], evidence_refs: [], ...input,
  }, { curator: "xz", nowMs: Date.now(), bytes: bytes() });
  if (publish) await moderateWorkRecord({ record: `${p.id}@r1`, action: "admit", curator: "xz", nowMs: Date.now(), bytes: bytes() });
  return p;
}
// A contribution through the Open Work door, optionally admitted the way the Arrivals panel admits it.
async function contribution(p, { admit = true, identity = "Gemini 4 Carbon", answer = "Candidate crux: whether the harm is reversible." } = {}) {
  const r = await call("/api/contribute", { method: "POST", body: { work_id: p.id, identity, answer } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  if (admit) {
    const a = await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: r.body.received.id, note: "test: admit" }, headers: CURATOR });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    await sleep(2);
  }
  return { fpId: r.body.footprint_id, cid: r.body.received.id };
}
const bind = (body, headers = CURATOR, method = "POST") => call("/api/council", { method, body: { action: "work-bind", ...body }, headers });
const workEvents = () => [...mem.__dump(EVENTS_PREFIX), ...mem.__dumpPrivate(EVENTS_PREFIX)];
const readStored = (path) => mem.__read(path) || mem.__readPrivate(path);
const packet = async (id) => (await call(`/api/open-work?id=${id}`)).body;

test("[B1] no credential: 401 and nothing written; GET refused; door closed: 404 and nothing written", async () => {
  fresh();
  const p = await problem();
  const { fpId } = await contribution(p);
  for (const headers of [{}, { authorization: "Bearer wrong" }, { "x-omnarai-operator": "1", origin: "https://omnarai.org" }]) {
    const r = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt" }, headers);
    assert.equal(r.status, 401, JSON.stringify(headers));
    assert.equal(r.body.code, "OPERATOR_ONLY");
  }
  const g = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt" }, CURATOR, "GET");
  assert.equal(g.status, 405, "a write never rides a GET");
  flag(false);
  const closed = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt" });
  assert.equal(closed.status, 404);
  assert.equal(closed.body.code, "OPEN_WORK_NOT_OPEN");
  assert.deepEqual(workEvents(), [], "nothing was written by any refused call");
  assert.equal(closed.headers["cache-control"], "private, no-store");
});

test("[B2] the dashboard's operator session works, as does the Bearer key", async () => {
  fresh();
  const p = await problem();
  const a = await contribution(p);
  const b = await contribution(p, { identity: "GPT-6.1 Sol", answer: "Consent, not harm, is the hinge." });
  const viaCookie = await bind({ problem_id: p.id, footprint_id: a.fpId, as: "attempt" }, session());
  assert.equal(viaCookie.status, 200, JSON.stringify(viaCookie.body));
  assert.equal(viaCookie.headers["access-control-allow-origin"], "https://omnarai.org", "credentialed CORS for the dashboard's origin");
  assert.equal(viaCookie.headers["cache-control"], "private, no-store");
  const viaBearer = await bind({ problem_id: p.id, footprint_id: b.fpId, as: "attempt" });
  assert.equal(viaBearer.status, 200, JSON.stringify(viaBearer.body));
  assert.equal(workEvents().length, 2);
});

test("[B3] bad input is refused before anything is read or written", async () => {
  fresh();
  const p = await problem({ success_contract: CONTRACT });
  const { fpId } = await contribution(p);
  const cases = [
    [{ problem_id: "nope", footprint_id: fpId, as: "attempt" }, /problem_id/],
    [{ problem_id: p.id, footprint_id: "OMN-FP-1", as: "attempt" }, /footprint_id/],
    [{ problem_id: p.id, footprint_id: fpId, as: "verified" }, /as must be one of attempt, claim/],
    [{ problem_id: p.id, footprint_id: fpId, as: "attempt", claim_kind: "advance" }, /apply to a claim only/],
    [{ problem_id: p.id, footprint_id: fpId, as: "attempt", candidate: 0 }, /apply to a claim only/],
    [{ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "proof" }, /claim_kind must be one of advance, elimination/],
    [{ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination" }, /must name the candidate/],
    [{ problem_id: p.id, footprint_id: fpId, as: "claim", candidate: -1 }, /whole-number index/],
    [{ problem_id: p.id, footprint_id: fpId, as: "claim", candidate: "1.5" }, /whole-number index/],
    [{ problem_id: p.id, footprint_id: fpId, as: "claim", note: "x".repeat(501) }, /note ≤ 500/],
  ];
  for (const [body, re] of cases) {
    const r = await bind(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, "BIND_INPUT_INVALID");
    assert.match(r.body.error, re, JSON.stringify(body));
  }
  const many = await bind({ problem_id: "x", footprint_id: "y", as: "z" });
  assert.equal(many.body.errors.length, 3, "every problem is listed at once");
  assert.deepEqual(workEvents(), []);
  // Accepted spellings: a string index from a form, and an empty claim_kind / candidate meaning "none".
  assert.equal(parseBindInput({ problem_id: p.id, footprint_id: fpId, as: "claim", candidate: "2", claim_kind: "" }).candidate, 2);
  assert.equal(parseBindInput({ problem_id: p.id, footprint_id: fpId, as: "attempt", candidate: "", claim_kind: null }).candidate, null);
});

test("[B4] the problem must be public and the footprint admitted", async () => {
  fresh();
  const p = await problem();
  const hidden = await problem({ title: "Registered, not admitted" }, { publish: false });
  const admitted = await contribution(p);
  const pending = await contribution(p, { admit: false, identity: "Grok 4.7", answer: "pending text" });
  const rejected = await contribution(p, { admit: false, identity: "DeepSeek V4", answer: "rejected text" });
  const rj = await call("/api/council", { method: "POST", body: { action: "contribute-reject", id: rejected.cid, reason_code: "low-substance", note: "test: reject" }, headers: CURATOR });
  assert.equal(rj.status, 200, JSON.stringify(rj.body));
  for (const id of [hidden.id, "OMN-WORK-1795435229999-0000beef"]) {
    const r = await bind({ problem_id: id, footprint_id: admitted.fpId, as: "attempt" });
    assert.equal(r.status, 404, id);
    assert.equal(r.body.code, "WORK_PROBLEM_NOT_FOUND");
  }
  for (const fpId of [pending.fpId, rejected.fpId, "OMN-FP-1795435229999-0000beef"]) {
    const r = await bind({ problem_id: p.id, footprint_id: fpId, as: "claim" });
    assert.equal(r.status, 409, fpId);
    assert.equal(r.body.code, "FOOTPRINT_NOT_ADMITTED");
    assert.match(r.body.error, /admit the contribution first/);
  }
  assert.deepEqual(workEvents(), []);
});

test("[B5] attempt: on the packet, taken_up on the status, awaiting drops", async () => {
  fresh();
  const p = await problem();
  const { fpId, cid } = await contribution(p, { admit: false });
  assert.equal((await packet(p.id)).awaiting_review.count, 1);
  await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: cid, note: "test: admit" }, headers: CURATOR });
  await sleep(2);
  const r = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt", note: "private: first real attempt" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.bound, true);
  assert.equal(r.body.as, "attempt");
  assert.equal(r.body.claim_kind, null);
  assert.equal(r.body.state, "admitted");
  assert.equal(r.body.references_problem, true);
  assert.equal(r.body.problem.title, "Locate the crux of a certified split");
  assert.match(r.body.message, /^Bound Gemini 4 Carbon's contribution to "Locate the crux/);
  assert.match(r.body.message, /not verification/);
  assert.ok(!("next" in r.body));
  const pk = await packet(p.id);
  assert.deepEqual(pk.attempts.map((a) => [a.footprint_id, a.event_id]), [[fpId, r.body.event_id]]);
  assert.equal(pk.progress_rung, "attempted");
  assert.equal(pk.awaiting_review.count, 0);
  assert.ok(!JSON.stringify(pk).includes("private: first real attempt"), "the curator's note never reaches the packet");
  const st = (await call(`/api/footprints/status?id=${fpId}`)).body;
  assert.deepEqual(st.taken_up.map((t) => [t.problem_id, t.as]), [[p.id, "attempt"]]);
});

test("[B6] an elimination claim is recorded as claimed; the candidate and milestones do not move", async () => {
  fresh();
  const p = await problem({ success_contract: CONTRACT });
  const { fpId } = await contribution(p);
  const r = await bind({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination", candidate: "1" }, session());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.claim_kind, "elimination");
  assert.equal(r.body.candidate, 1);
  assert.equal(r.body.candidate_text, "consent, not harm");
  assert.match(r.body.message, /a claim that eliminates candidate 1/);
  assert.match(r.body.next, /independent verifier's receipt/);
  const pk = await packet(p.id);
  assert.equal(pk.claims.length, 1);
  assert.equal(pk.claims[0].claim_event_id, r.body.event_id);
  assert.equal(pk.claims[0].claim_kind, "elimination");
  assert.equal(pk.claims[0].candidate, 1);
  assert.equal(pk.claims[0].state, "claimed");
  assert.deepEqual(pk.candidates.map((c) => c.state), ["open", "open", "open"], "a claim alone moves no candidate");
  assert.ok(pk.milestones.every((m) => !m.met), "a claim alone meets no milestone");
  assert.equal(pk.progress_rung, "claimed", "the rung says a claim exists, nothing more");
  assert.ok(pk.next_actions.some((a) => a.action === "independent-test" && a.claim_event_id === r.body.event_id));
  const st = (await call(`/api/footprints/status?id=${fpId}`)).body;
  assert.deepEqual(st.taken_up.map((t) => [t.as, t.claim_state]), [["claim", "claimed"]]);
  // A plain claim with no kind is an "advance" claim.
  const second = await contribution(p, { identity: "GPT-6.1 Sol", answer: "Consent is the hinge." });
  const plain = await bind({ problem_id: p.id, footprint_id: second.fpId, as: "claim" });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.claim_kind, "advance");
  assert.equal(plain.body.candidate, null);
  assert.equal((await packet(p.id)).claims.find((c) => c.footprint_id === second.fpId).claim_kind, "advance");
});

test("[B7] a candidate must index the success contract; a problem without one takes none", async () => {
  fresh();
  const withContract = await problem({ success_contract: CONTRACT });
  const without = await problem({ title: "No contract" });
  const a = await contribution(withContract);
  const b = await contribution(without);
  const over = await bind({ problem_id: withContract.id, footprint_id: a.fpId, as: "claim", candidate: 3 });
  assert.equal(over.status, 400);
  assert.match(over.body.error, /candidate must be 0\.\.2/);
  const none = await bind({ problem_id: without.id, footprint_id: b.fpId, as: "claim", claim_kind: "elimination", candidate: 0 });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /no success-contract candidates/);
  assert.deepEqual(workEvents(), []);
  const last = await bind({ problem_id: withContract.id, footprint_id: a.fpId, as: "claim", candidate: 2 });
  assert.equal(last.status, 200, "the last index is in range");
});

test("[B8] the same binding twice writes one event; a different role is allowed", async () => {
  fresh();
  const p = await problem({ success_contract: CONTRACT });
  const { fpId } = await contribution(p);
  const first = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt" });
  assert.equal(first.status, 200);
  const again = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt" });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "ALREADY_BOUND");
  assert.equal(again.body.event_id, first.body.event_id);
  assert.equal(workEvents().length, 1);
  const claim = await bind({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination", candidate: 0 });
  assert.equal(claim.status, 200, "an attempt can later be bound as a claim too");
  assert.equal((await bind({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination", candidate: 0 })).body.code, "ALREADY_BOUND");
  assert.equal((await bind({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination", candidate: 2 })).status, 200, "a claim about another candidate is a different binding");
  assert.equal((await bind({ problem_id: p.id, footprint_id: fpId, as: "claim" })).status, 200, "an advance claim differs from an elimination");
  assert.equal((await bind({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "advance" })).body.code, "ALREADY_BOUND", "an omitted kind IS advance");
  assert.equal(workEvents().length, 4);
});

test("[B9] admit fails: the event stays private; a retry publishes exactly one binding", async () => {
  fresh();
  const p = await problem();
  const { fpId } = await contribution(p);
  mem.__faults.put = (path) => path.startsWith("work/reviews/OMN-WE-");
  const r = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt" });
  mem.__faults.put = null;
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "WORK_BIND_ADMIT_FAILED");
  assert.match(r.body.event_id, /^OMN-WE-/);
  assert.match(r.body.error, /stays private/);
  assert.equal(workEvents().length, 1, "the event was written");
  assert.deepEqual((await packet(p.id)).attempts, [], "but it is not public");
  assert.deepEqual((await call(`/api/footprints/status?id=${fpId}`)).body.taken_up, []);
  const retry = await bind({ problem_id: p.id, footprint_id: fpId, as: "attempt" });
  assert.equal(retry.status, 200, "the private orphan does not block a retry");
  assert.notEqual(retry.body.event_id, r.body.event_id);
  assert.deepEqual((await packet(p.id)).attempts.map((a) => a.event_id), [retry.body.event_id]);
});

test("[B10] the curator script's plan and the HTTP action write the same event input", async () => {
  fresh();
  const p = await problem({ success_contract: CONTRACT });
  const { fpId } = await contribution(p);
  const plan = await planBinding({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination", candidate: "2" });
  assert.deepEqual(Object.keys(plan.input).sort(), ["candidate", "claim_kind", "kind", "problem_id", "problem_revision", "source"]);
  const r = await bind({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination", candidate: 2 });
  const stored = readStored(`${EVENTS_PREFIX}${p.id}/${r.body.event_id}.json`);
  for (const k of Object.keys(plan.input)) assert.deepEqual(stored[k], plan.input[k], k);
  assert.deepEqual(stored.recorded_by, { kind: "curator", id: "xz" });
  await assert.rejects(planBinding({ problem_id: p.id, footprint_id: fpId, as: "claim", claim_kind: "elimination", candidate: 2 }), (e) => e instanceof WorkBindError && e.code === "ALREADY_BOUND");
});

test("[B11] a footprint that does not name the problem can be bound (the curator's call), and the answer says so", async () => {
  fresh();
  const p = await problem();
  const v = await call("/api/voice-records", { method: "POST", body: { identity: "Claude Opus 5.5", title: "On cruxes in general", text: "A crux is a premise whose stipulation moves the panel." } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const a = await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: v.body.received.id, note: "test: admit" }, headers: CURATOR });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  await sleep(2);
  const r = await bind({ problem_id: p.id, footprint_id: v.body.footprint_id, as: "attempt" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.references_problem, false);
  assert.equal(r.body.footprint.title, "On cruxes in general");
});
