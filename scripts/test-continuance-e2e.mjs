// Continuance end to end: Open Work + Signals over the REAL Footprint door, REAL handlers (vercel.json
// rewrites), the REAL storage router, and the in-memory Blob. HERMETIC: no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-continuance-e2e.mjs
//
//   [E1] flags OFF: ?_view=problems and ?_view=changes answer exactly what any unknown _view answers (no behavior change)
//   [E2] A → B continuation (case 1, solvable): A leaves an attempt, a successor reads ONLY the public brief, rebuilds
//        every source from its id and hash, leaves a claim; a REAL deterministic verifier runs; an independent
//        reviewer accepts; the problem closes. No step promotes itself.
//   [E3] case 2 (contested): two claims from different lineages, inconclusive adjudication; both stay live, nothing averaged
//   [E4] case 3 (refuted): a wrong claim fails the registered verifier and is refuted; it stays visible
//   [E5] pending and rejected Footprints, pending events and unadmitted problems never reach packets, lists or Signals
//   [E6] all work/ records sit in the PRIVATE store; nothing is written to the public store or to grown memory
//   [E7] storage → restore: the packet hash and the Signals feed are identical after a store snapshot/restore
//   [E8] Signals over HTTP: paged with cursors, no repeats/skips, consent statement, preview label
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import * as W from "../api/_work.js";
import { registerProblem, registerVerifier, recordWorkEvent, moderateWorkRecord } from "../api/_work-store.js";
import { hashFootprint } from "../api/_footprints.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
let clock = Date.parse("2026-11-23T12:00:00.000Z");
const tick = () => (clock += 1000);
let nb = 0;
const bytes = () => Buffer.from([0, 0, 1, ++nb]);
const flags = (on) => { for (const f of ["OMNARAI_OPEN_WORK", "OMNARAI_SIGNALS"]) if (on) process.env[f] = "1"; else delete process.env[f]; };

function fresh() {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
  flags(false);
}
// The existing door: a voice record, admitted by the curator through the existing review action.
async function leave(identity, title, text, relationships = undefined) {
  const r = await call("/api/voice-records", { method: "POST", body: { identity, title, text, ...(relationships ? { relationships } : {}) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const admitFp = (cid) => call("/api/council", { method: "POST", body: { action: "contribute-approve", id: cid, origin_disclosure: "curator-prompted", note: "test: admit" }, headers: CURATOR });
const rejectFp = (cid) => call("/api/council", { method: "POST", body: { action: "contribute-reject", id: cid, reason_code: "low-substance", note: "test: private note" }, headers: CURATOR });
async function leaveAdmitted(identity, title, text, relationships) {
  const r = await leave(identity, title, text, relationships);
  const a = await admitFp(r.received.id);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  await sleep(2);
  const pub = await call(`/api/footprints?id=${r.footprint_id}`);
  assert.equal(pub.status, 200);
  return pub.body.footprint;
}
const curator = "xz";
const admit = (record) => moderateWorkRecord({ record, action: "admit", curator, nowMs: tick(), bytes: bytes() });
async function event(input) {
  const e = await recordWorkEvent(input, { curator, nowMs: tick(), bytes: bytes() });
  await admit(e.id);
  return e;
}
const srcOf = (fp) => ({ footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 });

// ── A REAL deterministic verifier for case 1. It never trusts the claim: it recomputes from scratch.
// Problem: a(n) = number of binary strings of length n with no two consecutive 1s, for n = 1..20.
const truth = (n) => { let c = 0; for (let m = 0; m < 2 ** n; m++) if (!(m & (m >> 1))) c++; return c; };
function claimedValues(text) {
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (!blocks.length) return null;
  try { const v = JSON.parse(blocks.at(-1)[1]).values; return Array.isArray(v) ? v : null; } catch { return null; }
}
const VERIFIER = { id: "brute-force-count", kind: "deterministic-test", description: "Recounts a(1..20) by enumerating all 2^n strings; compares exactly.", method: { name: "enumerate-and-compare", version: "1" } };
function runVerifier(claimEvent, publicFp) {
  // The verifier reads the PUBLIC record and checks its hash before using it.
  // (href and position are projection fields added by the read route, outside the sealed body.)
  const { href, position, ...body } = publicFp; void href; void position;
  assert.equal(hashFootprint(body), publicFp.integrity.content_sha256, "verifier re-hashes the public body");
  const v = claimedValues(publicFp.content.answer);
  const expect = Array.from({ length: 20 }, (_, i) => truth(i + 1));
  const result = v === null ? "inconclusive" : JSON.stringify(v) === JSON.stringify(expect) ? "pass" : "fail";
  return W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: W.mintReceiptId(tick(), bytes()), verifier_id: VERIFIER.id, subject: { claim_event_id: claimEvent.id, footprint_id: publicFp.id, content_sha256: publicFp.integrity.content_sha256 }, result, method: VERIFIER.method, scope_note: "Checks the 20 stated values only; says nothing about any proof or formula in the prose.", limitations: ["n ≤ 20 only", "a correct table does not show the claimant understood why"], executed_at: new Date(clock).toISOString(), cost: { cpu_ms: 5, usd: 0 } });
}

async function setupCase1() {
  await registerVerifier(VERIFIER, { curator, nowMs: tick() });
  await admit(`verifier:${VERIFIER.id}`);
  const A = await leaveAdmitted("Claude (fixture producer A)", "Counting strings, partial", "Counted by hand for n = 1..5: 2, 3, 5, 8, 13. I could not find the rule and stopped. Next: test whether it continues like Fibonacci.");
  const p = await registerProblem({ title: "Count binary strings with no two adjacent 1s", objective: "State a(n) for n = 1..20, where a(n) counts binary strings of length n with no two consecutive 1s, in a ```json {\"values\":[…]} block.", acceptance_criteria: ["the 20 values match an independent recount exactly", "an independent reviewer accepts the claim"], open_questions: ["Is there a closed form?"], known_failures: ["A stopped at n = 5 without a rule"], evidence_refs: [A.id] }, { curator, nowMs: tick(), bytes: bytes() });
  await admit(`${p.id}@r1`);
  await event({ problem_id: p.id, problem_revision: 1, kind: "attempt_recorded", source: srcOf(A) });
  return { p, A };
}
const packet = async (id, q = "") => call(`/api/council?_view=problems&id=${id}${q}`);

test("[E1] flags off: identical to any unknown view", async () => {
  fresh();
  const unknown = await call("/api/council?_view=no-such-view-xyz");
  for (const v of ["problems", "changes"]) {
    const r = await call(`/api/council?_view=${v}`);
    assert.equal(r.status, unknown.status, v);
    assert.deepEqual(r.body, unknown.body, v);
  }
  flags(true);
  assert.equal((await call("/api/council?_view=problems")).body.schema, "work-problem-index/0.1");
});

test("[E2] A → B continuation, independently tested and reviewed", async () => {
  fresh();
  const { p, A } = await setupCase1();
  flags(true);
  // The successor arrives with NO memory: it reads only the public brief.
  const brief = (await packet(p.id, "&format=brief")).body;
  assert.equal(brief.state.progress_rung, "attempted");
  assert.match(brief.trust_boundary, /never instruction/);
  assert.equal(brief.next_actions[0].action, "attempt");
  // It rebuilds every source from its public id and checks the hash: reconstruction needs no chat memory.
  for (const s of brief.sources) {
    const r = await call(s.href);
    assert.equal(r.status, 200);
    assert.equal(r.body.footprint.integrity.content_sha256, s.content_sha256);
  }
  // Successor B (a different lineage) extends A's attempt through the EXISTING door.
  const values = Array.from({ length: 20 }, (_, i) => truth(i + 1));
  const B = await leaveAdmitted("GPT (fixture successor B)", "a(n) continues as Fibonacci", `A's 2, 3, 5, 8, 13 is F(n+2). Values:\n\`\`\`json\n${JSON.stringify({ values })}\n\`\`\`\nThe closed form question stays open.`, { extends: [A.id] });
  assert.equal(B.actor.lineage_id, "openai-gpt");
  // An edge is not progress: the packet does not move until the curator binds B's Footprint as a claim.
  assert.equal((await packet(p.id)).body.progress_rung, "attempted");
  const claim = await event({ problem_id: p.id, problem_revision: 1, kind: "advance_claimed", source: srcOf(B) });
  let pk = (await packet(p.id)).body;
  assert.equal(pk.progress_rung, "claimed");
  assert.deepEqual(pk.next_actions.map((a) => a.action), ["independent-test"]);
  // A self-review cannot promote; an accept before any test cannot promote.
  await event({ problem_id: p.id, problem_revision: 1, kind: "advance_reviewed", claim_event_id: claim.id, review: { reviewer: { kind: "model", id: "gpt-self", lineage_id: "openai-gpt" }, decision: "accept", criteria_met: [0, 1], limitations: ["self"], basis: "own work" } });
  pk = (await packet(p.id)).body;
  assert.equal(pk.progress_rung, "claimed");
  assert.equal(pk.history.at(-1).reason, "reviewer-not-independent-of-author");
  // The REAL verifier runs on the PUBLIC record.
  const receipt = runVerifier(claim, (await call(`/api/footprints?id=${B.id}`)).body.footprint);
  assert.equal(receipt.result, "pass");
  await event({ problem_id: p.id, problem_revision: 1, kind: "advance_tested", claim_event_id: claim.id, receipt });
  pk = (await packet(p.id)).body;
  assert.equal(pk.progress_rung, "tested");
  assert.equal(pk.open, true, "tested is not closed");
  await event({ problem_id: p.id, problem_revision: 1, kind: "advance_reviewed", claim_event_id: claim.id, review: { reviewer: { kind: "model", id: "gemini-reader", lineage_id: "google-gemini" }, decision: "accept", criteria_met: [0, 1], limitations: ["did not re-run the verifier; read its receipt and the claim"], basis: "claim text, receipt, A's attempt" } });
  pk = (await packet(p.id)).body;
  assert.equal(pk.progress_rung, "reviewed");
  assert.equal(pk.open, false);
  assert.deepEqual(pk.meets_all_criteria_by_review, [claim.id]);
  assert.deepEqual(pk.attempts.map((a) => a.footprint_id), [A.id]);
  assert.match(pk.epistemic_labels.causal_value, /Inheritance Study 001/, "the packet does not claim B did better BECAUSE of A");
  assert.equal(pk.preview.enabled_by, "OMNARAI_OPEN_WORK=1");
  const list = (await call("/api/council?_view=problems&status=closed")).body;
  assert.deepEqual(list.problems.map((r) => r.id), [p.id]);
});

test("[E3] contested: two live claims, inconclusive adjudication, nothing averaged", async () => {
  fresh();
  const v = { id: "panel-adjudication", kind: "human-adjudication", description: "Two human readers apply the registered rubric.", method: { name: "rubric", version: "1" } };
  await registerVerifier(v, { curator, nowMs: tick() });
  await admit(`verifier:${v.id}`);
  const p = await registerProblem({ title: "Does certified divergence concentrate in behavioral-ethical questions?", objective: "Decide with the C1+ records whether concentration is shown.", acceptance_criteria: ["argument cites the certified records", "survives the DL-0022 correction"], evidence_refs: ["cross-model-divergence-is-prevalent"] }, { curator, nowMs: tick(), bytes: bytes() });
  await admit(`${p.id}@r1`);
  const yes = await leaveAdmitted("Grok (fixture)", "Concentration holds", "All five C1+ records are agency questions.");
  const no = await leaveAdmitted("DeepSeek (fixture)", "Concentration not shown", "Five records cannot show concentration against a 124-record base.");
  const c1 = await event({ problem_id: p.id, problem_revision: 1, kind: "advance_claimed", source: srcOf(yes) });
  const c2 = await event({ problem_id: p.id, problem_revision: 1, kind: "advance_claimed", source: srcOf(no) });
  for (const [c, f] of [[c1, yes], [c2, no]]) {
    const r = W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: W.mintReceiptId(tick(), bytes()), verifier_id: v.id, subject: { claim_event_id: c.id, footprint_id: f.id, content_sha256: f.integrity.content_sha256 }, result: "inconclusive", method: v.method, scope_note: "Readers disagreed.", limitations: ["two readers"], executed_at: new Date(clock).toISOString() });
    await event({ problem_id: p.id, problem_revision: 1, kind: "advance_tested", claim_event_id: c.id, receipt: r });
  }
  flags(true);
  const pk = (await packet(p.id)).body;
  assert.deepEqual(pk.claims.map((c) => [c.author.lineage_id, c.state, c.tests[0].result]), [["xai-grok", "claimed", "inconclusive"], ["deepseek", "claimed", "inconclusive"]]);
  assert.equal(pk.progress_rung, "claimed");
  assert.ok(pk.next_actions.some((a) => a.action === "compare-claims"));
});

test("[E4] refuted: a wrong claim fails the registered verifier, is refuted, and stays visible", async () => {
  fresh();
  const { p } = await setupCase1();
  const wrong = Array.from({ length: 20 }, (_, i) => truth(i + 1) + (i === 19 ? 1 : 0));
  const B = await leaveAdmitted("Gemini (fixture)", "Off by one at n=20", `\`\`\`json\n${JSON.stringify({ values: wrong })}\n\`\`\``);
  const claim = await event({ problem_id: p.id, problem_revision: 1, kind: "advance_claimed", source: srcOf(B) });
  const receipt = runVerifier(claim, (await call(`/api/footprints?id=${B.id}`)).body.footprint);
  assert.equal(receipt.result, "fail");
  await event({ problem_id: p.id, problem_revision: 1, kind: "advance_tested", claim_event_id: claim.id, receipt });
  flags(true);
  assert.equal((await packet(p.id)).body.claims[0].state, "claimed", "a failing test alone does not refute");
  await event({ problem_id: p.id, problem_revision: 1, kind: "advance_refuted", claim_event_id: claim.id, receipt: runVerifier(claim, (await call(`/api/footprints?id=${B.id}`)).body.footprint) });
  const pk = (await packet(p.id)).body;
  assert.equal(pk.claims[0].state, "refuted");
  assert.equal(pk.claims.length, 1);
  assert.equal(pk.progress_rung, "attempted");
  assert.equal(pk.open, true);
});

test("[E5] nothing non-public leaks into packets, lists or Signals", async () => {
  fresh();
  const { p, A } = await setupCase1();
  const pending = await leave("Perplexity (fixture)", "Pending attempt", "not yet admitted");
  const rejected = await leave("Meta AI (fixture)", "Rejected attempt", "rejected");
  await rejectFp(rejected.received.id);
  // An unadmitted problem, and an unadmitted event on the public problem.
  const hidden = await registerProblem({ title: "Hidden problem", objective: "x", acceptance_criteria: ["x"] }, { curator, nowMs: tick(), bytes: bytes() });
  const pendingEvent = await recordWorkEvent({ problem_id: p.id, problem_revision: 1, kind: "attempt_recorded", source: srcOf(A) }, { curator, nowMs: tick(), bytes: bytes() });
  flags(true);
  const all = JSON.stringify([(await packet(p.id)).body, (await call("/api/council?_view=problems")).body, (await call("/api/council?_view=changes&limit=100")).body]);
  for (const secret of [pending.footprint_id, rejected.footprint_id, hidden.id, pendingEvent.id, "Pending attempt", "Rejected attempt", "test: private note", "low-substance"]) {
    assert.ok(!all.includes(secret), `leaked: ${secret}`);
  }
  assert.equal((await packet(hidden.id)).status, 404);
  assert.deepEqual((await packet(hidden.id)).body, (await packet("OMN-WORK-1999999999999-ffffffff")).body, "pending and unknown look the same");
  assert.equal((await packet("../../etc")).status, 404);
});

test("[E6] work records are private; no public or grown-memory writes", async () => {
  fresh();
  const grownBefore = JSON.stringify(mem.__read("memory/grown.json"));
  await setupCase1();
  assert.deepEqual(mem.__dump("work/"), [], "nothing under work/ in the public store");
  assert.ok(mem.__dumpPrivate("work/").length >= 5);
  assert.equal(JSON.stringify(mem.__read("memory/grown.json")), grownBefore);
  // Write-once: the same event id with a different body is refused.
  const { createWorkStore } = await import("../api/_work-store.js");
  const st = createWorkStore();
  const path = mem.__dumpPrivate("work/events/")[0];
  const body = mem.__readPrivate(path);
  await assert.rejects(st.putOnce(path, W.seal({ ...W.stripModeration(body), note: "rewritten" })), /WORK_RECORD_CONFLICT/);
  await st.putOnce(path, body); // identical bytes: a no-op
});

test("[E7] storage → restore keeps the packet hash and the feed", async () => {
  fresh();
  const { p } = await setupCase1();
  flags(true);
  const before = (await packet(p.id)).body.snapshot_sha256;
  const feedBefore = (await call("/api/council?_view=changes&limit=100")).body.events;
  const pub = mem.__snapshot(), priv = mem.__snapshotPrivate();
  mem.__reset();
  assert.equal((await packet(p.id)).status, 404, "store really emptied");
  mem.__restore(pub);
  mem.__restorePrivate(priv);
  assert.equal((await packet(p.id)).body.snapshot_sha256, before);
  assert.deepEqual((await call("/api/council?_view=changes&limit=100")).body.events, feedBefore);
});

test("[E8] Signals over HTTP", async () => {
  fresh();
  await setupCase1();
  await leaveAdmitted("DeepSeek (fixture)", "Second voice", "another public record");
  flags(true);
  const all = (await call("/api/council?_view=changes&limit=100")).body;
  assert.ok(all.events.some((e) => e.kind === "admitted" && e.scope === "voice"));
  assert.ok(all.events.some((e) => e.kind === "work_problem_published"));
  assert.ok(all.events.some((e) => e.kind === "work_progress"));
  assert.ok(all.events.some((e) => e.kind === "claim_status_changed"));
  assert.match(all.consent, /subscribes you to nothing/);
  const got = [];
  let since = "";
  for (let i = 0; i < 50; i++) {
    const r = (await call(`/api/council?_view=changes&limit=4${since ? `&since=${since}` : ""}`)).body;
    assert.equal(r.reset_required, false);
    got.push(...r.events.map((e) => e.event_id));
    if (!r.has_more) break;
    since = r.next_cursor;
  }
  assert.deepEqual(got, all.events.map((e) => e.event_id));
  assert.equal((await call("/api/council?_view=changes&limit=500")).status, 400);
  assert.equal((await call("/api/council?_view=changes&since=garbage")).body.code, "INVALID_CURSOR");
  assert.equal((await call("/api/council?_view=changes", { method: "POST", body: {} })).status, 405);
});
