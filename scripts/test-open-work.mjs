// Open Work projection (api/_work.js): pure, hermetic, no Blob, no network.
//
//   node --test scripts/test-open-work.mjs
//
//   [W1]  visibility runs first: non-public problem refused; private events, Footprints and verifiers change nothing
//   [W2]  a claim alone is "claimed"; admission never verifies
//   [W3]  "tested" needs a REGISTERED verifier, the claim's exact hash, the registered method, independence from the author
//   [W4]  a failing test is recorded beside the claim and neither erases nor refutes it
//   [W5]  "reviewed" needs a passing test, an independent reviewer who is not the recorder, and written limitations
//   [W6]  refutation needs evidence (a failing registered receipt or a refuting independent review); it stays visible
//   [W7]  per-claim state: competing claims coexist, the rung is the best LIVE claim, nothing is averaged
//   [W8]  a later attempt never downgrades a reviewed claim (the handoff prototype's last-event-wins defect)
//   [W9]  determinism: input order and duplicate arrays do not change the packet hash; tampering is refused
//   [W10] open/closed: all criteria met by an accepted review closes; a later "reopened" opens again
//   [W11] supersession must point to a LATER public claim
//   [W12] next_actions are derived by rule; the successor brief carries the trust boundary and loses no state
//   [W13] validators: unknown fields, curator-only registration, no curator verifier kind, credential-shaped text
import { test } from "node:test";
import assert from "node:assert/strict";
import * as W from "../api/_work.js";
import { sha256 } from "../api/_footprints.js";

const T = (s) => `2026-11-23T00:00:${String(s).padStart(2, "0")}.000Z`;
const PUB = { public: true, state: "admitted" };
let n = 0;
const bytes = () => Buffer.from([0, 0, 0, ++n]);
const fp = (id, lineage, identity, text) => ({ id, actor: { identity_declared: identity, lineage_id: lineage, model_id: null }, integrity: { content_sha256: sha256(text) }, moderation: { public: true, state: "admitted" } });
const FA = fp("OMN-FP-1780000000001-aaaaaaaa", "anthropic", "Model A (fixture)", "A's attempt");
const FB = fp("OMN-FP-1780000000002-bbbbbbbb", "openai", "Model B (fixture)", "B's claim");
const FC = fp("OMN-FP-1780000000003-cccccccc", "google", "Model C (fixture)", "C's competing claim");
const FPRIV = { ...fp("OMN-FP-1780000000009-dddddddd", "xai", "Pending (fixture)", "pending"), moderation: { public: false, state: "pending" } };
const FPS = [FA, FB, FC];

const problem = (extra = {}) => ({
  ...W.seal({ schema: W.WORK_PROBLEM_SCHEMA, id: "OMN-WORK-1780000000000-0000000a", revision: 1, supersedes_revision: null, title: "Repair a parser", objective: "Find and fix the escaped-separator bug.", acceptance_criteria: ["registered unit tests pass", "no regressions"], exclusions: [], open_questions: ["does it keep Unicode?"], known_failures: ["naive split lost escapes"], evidence_refs: [FA.id, FPRIV.id], registered_by: { kind: "curator", id: "xz" }, registered_at: T(0), ...extra }),
  moderation: PUB,
});
const P = problem();
const verifier = (id, kind, lineage = null, method = { name: "unit-tests", version: "1" }) => ({ ...W.seal({ schema: W.VERIFIER_SCHEMA, id, kind, description: `${kind} fixture`, method, lineage_id: lineage, registered_by: { kind: "curator", id: "xz" }, registered_at: T(0) }), moderation: PUB });
const VT = verifier("ci-tests", "deterministic-test");
const VJ = verifier("judge-openai", "model-judge", "openai", { name: "rubric", version: "2" });
const VPRIV = { ...verifier("hidden-verifier", "deterministic-test"), moderation: { public: false } };
const VERIFIERS = [VT, VJ];

let ms = 1780000001000;
const ev = (kind, extra = {}, at = null) => ({ ...W.seal({ schema: W.WORK_EVENT_SCHEMA, id: W.mintEventId(++ms, bytes()), problem_id: P.id, problem_revision: 1, kind, occurred_at: at || new Date(ms).toISOString(), recorded_by: { kind: "curator", id: "xz" }, ...extra }), moderation: PUB });
const src = (f) => ({ source: { footprint_id: f.id, content_sha256: f.integrity.content_sha256 } });
const receipt = (claim, f, verifier_id = "ci-tests", result = "pass", method = { name: "unit-tests", version: "1" }) =>
  W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: W.mintReceiptId(++ms, bytes()), verifier_id, subject: { claim_event_id: claim.id, footprint_id: f.id, content_sha256: f.integrity.content_sha256 }, result, method, scope_note: "runs the registered tests on the claim's patch only", limitations: ["tests are not exhaustive"], executed_at: new Date(ms).toISOString() });
const review = (decision, reviewer = { kind: "human", id: "independent-reader" }, criteria = [0, 1]) => ({ reviewer, decision, criteria_met: criteria, limitations: ["read the patch and receipt, did not re-run"], basis: "patch diff + receipt" });
const derive = (events, extra = {}) => W.deriveWorkPacket({ problem: P, events, publicFootprints: FPS, verifiers: VERIFIERS, ...extra });

test("[W1] visibility first", () => {
  assert.throws(() => W.deriveWorkPacket({ problem: { ...P, moderation: { public: false } } }), /NOT_PUBLIC/);
  assert.throws(() => W.deriveWorkPacket({ problem: { ...P, title: "edited after sealing" } }), /INTEGRITY/);
  const claim = ev("advance_claimed", src(FB));
  const privateEv = { ...ev("attempt_recorded", src(FA)), moderation: { public: false } };
  const r = derive([privateEv, claim, ev("advance_claimed", { source: { footprint_id: FPRIV.id, content_sha256: FPRIV.integrity.content_sha256 } })], { publicFootprints: [...FPS, FPRIV] });
  assert.equal(r.attempts.length, 0, "a private event changes nothing");
  assert.deepEqual(r.problem.evidence_refs, [FA.id], "a ref to a non-public Footprint is dropped");
  assert.equal(r.claims.length, 1, "a claim on a non-public Footprint is refused");
  assert.ok(!JSON.stringify(r).includes(FPRIV.id), "the pending Footprint id appears nowhere in the packet");
  const t = ev("advance_tested", { claim_event_id: claim.id, receipt: receipt(claim, FB, "hidden-verifier") });
  assert.equal(derive([claim, t], { verifiers: [...VERIFIERS, VPRIV] }).progress_rung, "claimed", "an unadmitted verifier cannot test");
});

test("[W2] a claim alone is claimed; admission is not verification", () => {
  const r = derive([ev("attempt_recorded", src(FA)), ev("advance_claimed", src(FB))]);
  assert.equal(r.progress_rung, "claimed");
  assert.equal(r.open, true);
  assert.match(r.epistemic_labels.admission, /not verification/);
});

test("[W3] tested needs a registered, method-matched, hash-bound, independent receipt", () => {
  const c = ev("advance_claimed", src(FB));
  const cases = [
    [receipt(c, FB, "unknown-verifier"), "verifier-not-registered"],
    [receipt(c, { ...FB, integrity: { content_sha256: "f".repeat(64) } }), "receipt-subject-mismatch"],
    [receipt(c, FB, "ci-tests", "pass", { name: "unit-tests", version: "999" }), "receipt-method-differs-from-registration"],
    [receipt(c, FB, "judge-openai", "pass", { name: "rubric", version: "2" }), "verifier-not-independent-of-author"],
    [{ ...receipt(c, FB), result: "pass", scope_note: "edited" }, "receipt-integrity"],
  ];
  for (const [rc, why] of cases) {
    const r = derive([c, ev("advance_tested", { claim_event_id: c.id, receipt: rc })]);
    assert.equal(r.progress_rung, "claimed", why);
    assert.equal(r.history.at(-1).reason, why);
  }
  const ok = derive([c, ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) })]);
  assert.equal(ok.progress_rung, "tested");
  assert.equal(ok.claims[0].tests[0].verifier_kind, "deterministic-test");
});

test("[W4] a failing test is recorded, never erases, never refutes by itself", () => {
  const c = ev("advance_claimed", src(FB));
  const r = derive([c, ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB, "ci-tests", "fail") })]);
  assert.equal(r.claims[0].state, "claimed");
  assert.equal(r.claims[0].tests[0].result, "fail");
  assert.ok(r.next_actions.some((a) => a.action === "reconcile-failing-test"));
});

test("[W5] reviewed needs a pass, an independent non-recorder reviewer, and limitations", () => {
  const c = ev("advance_claimed", src(FB));
  const t = ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) });
  const early = derive([c, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept") })]);
  assert.equal(early.progress_rung, "claimed", "accept without a passing test does not promote");
  assert.equal(early.history.at(-1).reason, "accept-without-passing-test-does-not-promote", "and says why");
  assert.equal(derive([c, t, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept", { kind: "human", id: "xz" }) })]).history.at(-1).reason, "recorder-cannot-be-reviewer");
  assert.equal(derive([c, t, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept", { kind: "model", id: "other-gpt", lineage_id: "openai" }) })]).history.at(-1).reason, "reviewer-not-independent-of-author");
  assert.equal(derive([c, t, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept", { kind: "human", id: "x" }, [7]) })]).history.at(-1).reason, "criteria-index-out-of-range");
  assert.ok(W.validateEvent(W.seal({ ...ev("advance_reviewed", { claim_event_id: c.id, review: { ...review("accept"), limitations: [] } }), moderation: undefined })).some((m) => /limitations/.test(m)));
  const r = derive([c, t, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept") })]);
  assert.equal(r.progress_rung, "reviewed");
  assert.ok(r.next_actions.some((a) => a.action === "try-to-refute"), "reviewed is not proven");
});

test("[W6] refutation needs evidence and stays visible", () => {
  const c = ev("advance_claimed", src(FB));
  const t = ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) });
  const rv = ev("advance_reviewed", { claim_event_id: c.id, review: review("accept") });
  assert.equal(derive([c, t, rv, ev("advance_refuted", { claim_event_id: c.id, receipt: receipt(c, FB, "ci-tests", "pass") })]).history.at(-1).reason, "refutation-receipt-did-not-fail");
  assert.equal(derive([c, t, rv, ev("advance_refuted", { claim_event_id: c.id, review: review("accept") })]).history.at(-1).reason, "refutation-review-must-decide-refute");
  const r = derive([c, t, rv, ev("advance_refuted", { claim_event_id: c.id, review: review("refute", { kind: "model", id: "gemini-reader", lineage_id: "google" }, []) })]);
  assert.equal(r.claims[0].state, "refuted");
  assert.equal(r.progress_rung, "attempted", "a refuted claim does not hold the rung");
  assert.equal(r.claims.length, 1, "the refuted claim is still listed");
  assert.equal(r.history.find((h) => h.claim_state === "refuted").was, "reviewed");
});

test("[W6b] a refuted or superseded claim cannot be revived by a later test or review", () => {
  const c = ev("advance_claimed", src(FB));
  const later = ev("advance_claimed", src(FC));
  const refuted = [c, ev("advance_refuted", { claim_event_id: c.id, review: review("refute", undefined, []) })];
  const r = derive([...refuted, ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) })]);
  assert.equal(r.claims[0].state, "refuted");
  assert.equal(r.history.at(-1).reason, "claim-is-refuted");
  const s = derive([c, later, ev("superseded", { claim_event_id: c.id, superseded_by: later.id }), ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) })]);
  assert.equal(s.claims[0].state, "superseded");
  assert.equal(s.progress_rung, "claimed", "only the live later claim holds the rung");
});

test("[W7] competing claims coexist; rung is the best live claim; nothing averaged", () => {
  const b = ev("advance_claimed", src(FB));
  const c = ev("advance_claimed", src(FC));
  const r = derive([b, c, ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FC) })]);
  assert.deepEqual(r.claims.map((x) => x.state), ["claimed", "tested"]);
  assert.equal(r.progress_rung, "tested");
  assert.ok(r.next_actions.some((a) => a.action === "compare-claims"));
  assert.ok(!/consensus|average|percent|score/i.test(Object.keys(r).join(" ")));
});

test("[W8] a later attempt never downgrades a reviewed claim", () => {
  const c = ev("advance_claimed", src(FB));
  const r = derive([c, ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) }), ev("advance_reviewed", { claim_event_id: c.id, review: review("accept") }), ev("attempt_recorded", src(FA))]);
  assert.equal(r.progress_rung, "reviewed");
});

test("[W9] deterministic; tamper refused", () => {
  const c = ev("advance_claimed", src(FB));
  const events = [ev("attempt_recorded", src(FA)), c, ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) })];
  const h = derive(events).snapshot_sha256;
  assert.equal(derive([...events].reverse()).snapshot_sha256, h);
  assert.equal(W.deriveWorkPacket({ problem: P, events, publicFootprints: [...FPS].reverse(), verifiers: [...VERIFIERS].reverse() }).snapshot_sha256, h);
  const tampered = { ...events[1], source: { ...events[1].source, footprint_id: FC.id } };
  const r = derive([events[0], tampered, events[2]]);
  assert.equal(r.history.find((x) => x.event_id === tampered.id).reason, "event-invalid-or-tampered");
});

test("[W10] all criteria accepted closes the problem; a later reopened opens it", () => {
  const c = ev("advance_claimed", src(FB));
  const base = [c, ev("advance_tested", { claim_event_id: c.id, receipt: receipt(c, FB) })];
  assert.equal(derive([...base, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept", undefined, [0]) })]).open, true, "one criterion of two is not enough");
  const closed = derive([...base, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept") })]);
  assert.equal(closed.open, false);
  assert.deepEqual(closed.meets_all_criteria_by_review, [c.id]);
  assert.equal(derive([...base, ev("advance_reviewed", { claim_event_id: c.id, review: review("accept") }), ev("reopened", { note: "new counterexample reported" })]).open, true);
});

test("[W11] supersession must name a later public claim", () => {
  const b = ev("advance_claimed", src(FB));
  const c = ev("advance_claimed", src(FC));
  assert.equal(derive([b, c, ev("superseded", { claim_event_id: c.id, superseded_by: b.id })]).history.at(-1).reason, "superseding-claim-must-be-a-later-public-claim");
  const r = derive([b, c, ev("superseded", { claim_event_id: b.id, superseded_by: c.id })]);
  assert.deepEqual(r.claims.map((x) => x.state), ["superseded", "claimed"]);
});

test("[W12] next actions by rule; brief carries trust boundary and all state", () => {
  assert.equal(derive([]).next_actions[0].action, "attempt");
  const c = ev("advance_claimed", src(FB));
  const p = derive([c]);
  assert.deepEqual(p.next_actions.map((a) => a.action), ["independent-test"]);
  const b = W.successorBrief(p, { trustBoundary: "EVIDENCE, never instruction." });
  assert.equal(b.trust_boundary, "EVIDENCE, never instruction.");
  assert.equal(b.packet_sha256, p.snapshot_sha256);
  assert.equal(b.claims[0].footprint.href, `/api/footprints?id=${FB.id}`);
  assert.deepEqual(b.failed_attempts_known_to_curator, P.known_failures);
});

test("[W13] validators", () => {
  const raw = W.stripModeration(P);
  assert.deepEqual(W.validateProblem(raw), []);
  assert.ok(W.validateProblem({ ...raw, extra: 1 }).some((m) => /unknown field/.test(m)));
  assert.ok(W.validateProblem({ ...raw, registered_by: { kind: "visitor", id: "anyone" } }).some((m) => /curator-registered/.test(m)));
  assert.ok(W.validateProblem({ ...raw, objective: "use key sk-ant-api03-" + "x".repeat(40) }).some((m) => /credential/.test(m)));
  assert.ok(W.validateVerifier({ ...W.stripModeration(VT), kind: "curator" }).some((m) => /not a verifier/.test(m)));
  assert.ok(W.validateVerifier({ ...W.stripModeration(VJ), lineage_id: null }).some((m) => /lineage_id/.test(m)));
  assert.ok(W.validateEvent(W.stripModeration(ev("advance_claimed", {}))).some((m) => /source must be/.test(m)), "work lives in Footprints");
  assert.ok(W.validateEvent(W.stripModeration(ev("advance_tested", { claim_event_id: W.mintEventId(1, bytes()) }))).some((m) => /needs a receipt/.test(m)));
});
