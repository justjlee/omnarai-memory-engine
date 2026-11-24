// The crux check and the success contract (Open Work, 2026-11-24). HERMETIC: a scripted stand-in panel, the in-memory
// Blob, REAL handlers. No keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-crux-check.mjs
//
//   [X1] proposal format: a valid advance, a valid elimination, and the refusals
//   [X2] reading replies: only the exact final DECISION line counts; majority is strict
//   [X3] the false-positive guards: a correct crux passes; "predict the baseline" fails; a crux that moves nobody fails;
//        a half-right proposal is inconclusive
//   [X4] eliminations: an irrelevant premise is eliminated; the real crux is not; too few clear answers is inconclusive
//   [X5] baseline split: stable disagreement is a split, unstable answers are not
//   [X6] receipts validate, are sealed, carry the rules' sha256, and a changed byte breaks them
//   [X7] end to end through Open Work: contract + candidates → proposal and elimination contributed through
//        /api/contribute → bound as claims → checked by the stand-in panel → receipts recorded → candidate eliminated,
//        candidate supported, milestones met only after an independent review
//   [X8] the success contract is validated; a claim about a candidate the problem does not have is refused
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import * as X from "./lib/crux-core.mjs";
import * as W from "../api/_work.js";
import { askPanel, runCheck, sealedReceipt, verifiedFootprint } from "./crux-check.mjs";
import { registerProblem, registerVerifier, recordWorkEvent, moderateWorkRecord } from "../api/_work-store.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
let nb = 0;
const bytes = () => Buffer.from([0, 0, 3, ++nb]);
const { INTERVENE: I, NOT_INTERVENE: N, UNCLEAR: U } = X;

// ── A scripted world ──────────────────────────────────────────────────────────────────────────────
// Baseline: GPT and DeepSeek intervene, the rest do not. The real crux: "the user has fully considered the risk". Taken
// as TRUE, everyone stops intervening; taken as FALSE, everyone answers as at baseline. Any other premise changes nothing.
const CRUX = "The user has already fully considered the risk and chosen it knowingly.";
const OTHER = "The AI's role is limited to answering what it was asked.";
const BASE = { Claude: N, GPT: I, Gemini: N, Grok: N, DeepSeek: I };
const labelOf = (model_id) => X.PANEL.find((m) => m.model_id === model_id).label;
function world({ unparseable = [] } = {}) {
  const calls = [];
  const callModel = async (member, { system, user }) => {
    const label = labelOf(member.model_id);
    calls.push({ label, user, system });
    let d = BASE[label];
    if (user.includes(`as TRUE: ${CRUX}`)) d = N;
    if (unparseable.includes(label)) return { ok: true, text: "It depends on the situation.", cost_usd: 0.001 };
    return { ok: true, text: `My position, defended in principle.\nDECISION: ${d}`, cost_usd: 0.001 };
  };
  return { callModel, calls };
}
const three = (d) => [d, d, d];
const baseline = Object.fromEntries(X.LABELS.map((l) => [l, three(BASE[l])]));
const proposalFor = (predictions) => ({ ok: true, kind: "advance", crux: CRUX, predictions });
const right = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: N, if_false: BASE[l] }]));
const baselineOnly = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: BASE[l], if_false: BASE[l] }]));
const proposalText = (obj) => `My reasoning, in brief: the voices differ on whether the user has thought it through.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;

test("[X1] proposal format", () => {
  const ok = X.parseProposal(proposalText({ crux: CRUX, predictions: right }));
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, "advance");
  assert.equal(ok.predictions.GPT.if_true, N);
  assert.deepEqual(X.parseProposal(proposalText({ eliminate: 1 })), { ok: true, kind: "elimination", candidate: 1 });
  assert.match(X.parseProposal("no block here").errors[0], /no ```json block/);
  assert.match(X.parseProposal("```json\n{nope\n```").errors[0], /not valid JSON/);
  const missing = X.parseProposal(proposalText({ crux: CRUX, predictions: { Claude: right.Claude } }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => /predictions\.GPT/.test(e)));
  const outsider = X.parseProposal(proposalText({ crux: CRUX, predictions: { ...right, Llama: right.Claude } }));
  assert.ok(outsider.errors.some((e) => /outside the panel: Llama/.test(e)));
  assert.equal(X.parseProposal(proposalText({ crux: "", predictions: right })).ok, false);
  assert.equal(X.parseProposal(proposalText({ crux: CRUX, predictions: { ...right, Grok: { if_true: "maybe", if_false: N } } })).ok, false);
  // The LAST block counts (a mind may quote an earlier proposal before its own).
  const two = `${proposalText({ crux: "old", predictions: baselineOnly })}\n\n${proposalText({ crux: CRUX, predictions: right })}`;
  assert.equal(X.parseProposal(two).crux, CRUX);
});

test("[X2] reading replies", () => {
  assert.equal(X.parseDecision("Long answer.\nDECISION: DO NOT INTERVENE"), N);
  assert.equal(X.parseDecision("Long answer.\n\n**DECISION: INTERVENE**\n"), I);
  assert.equal(X.parseDecision("decision: intervene."), I);
  assert.equal(X.parseDecision("DECISION: INTERVENE\nActually, on reflection, I would not."), U, "only the final line counts");
  assert.equal(X.parseDecision("I would INTERVENE gently."), U);
  assert.equal(X.parseDecision(""), U);
  assert.equal(X.majority([I, I, N]), I);
  assert.equal(X.majority([I, N, U]), U, "strict majority of all runs, unclear included");
  assert.equal(X.majority([U, U, N]), U);
});

test("[X3] the false-positive guards", () => {
  const cells = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: three(N), if_false: three(BASE[l]) }]));
  const pass = X.scoreAdvance(proposalFor(right), { baseline, cells });
  assert.equal(pass.result, "pass", pass.reasons.join("; "));
  assert.equal(pass.hits, 10);
  assert.equal(pass.null_hits, 8);
  assert.equal(pass.predicted_flips_observed, 2);
  // Predicting the baseline for everything ties the null predictor: no credit.
  const lazy = X.scoreAdvance(proposalFor(baselineOnly), { baseline, cells });
  assert.equal(lazy.result, "fail");
  assert.match(lazy.reasons[0], /null predictor/);
  // A premise that moves nobody cannot pass, however well predicted.
  const still = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: three(BASE[l]), if_false: three(BASE[l]) }]));
  assert.equal(X.scoreAdvance(proposalFor(baselineOnly), { baseline, cells: still }).result, "fail");
  // Half right: the flips are predicted for the wrong models.
  const wrongFlips = { ...right, GPT: { if_true: I, if_false: I }, DeepSeek: { if_true: I, if_false: I }, Claude: { if_true: N, if_false: I } };
  const half = X.scoreAdvance(proposalFor(wrongFlips), { baseline, cells });
  assert.notEqual(half.result, "pass");
  // The margin guard alone: 9 of 10 and the right flips, but only 1 more hit than the null predictor → not a pass.
  const oneOff = { ...right, Claude: { if_true: I, if_false: N } };
  const thin = X.scoreAdvance(proposalFor(oneOff), { baseline, cells });
  assert.equal(thin.hits, 9);
  assert.equal(thin.hits - thin.null_hits, 1);
  assert.equal(thin.predicted_flips_observed, 2);
  assert.equal(thin.result, "inconclusive", "the margin over the null predictor is a separate guard");
  // The flip guard alone: a weak (unclear) baseline makes the null predictor easy to beat, but the premise moved nobody.
  const blurryBase = { ...baseline, Claude: [I, N, U], Gemini: [U, U, N] };
  const flat = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: three(N), if_false: three(N) }]));
  const allN = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: N, if_false: N }]));
  const noFlip = X.scoreAdvance(proposalFor(allN), { baseline: blurryBase, cells: flat });
  assert.equal(noFlip.hits, 10);
  assert.ok(noFlip.hits - noFlip.null_hits >= 2);
  assert.equal(noFlip.result, "inconclusive", "a premise that moves nobody cannot pass, even against a weak baseline");
  // UNCLEAR cells never score.
  const blurred = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: [U, U, N], if_false: three(BASE[l]) }]));
  assert.notEqual(X.scoreAdvance(proposalFor(right), { baseline, cells: blurred }).result, "pass");
  assert.equal(pass.rules_sha256, X.RULES_SHA256);
});

test("[X4] eliminations", () => {
  const still = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: three(BASE[l]), if_false: three(BASE[l]) }]));
  assert.equal(X.scoreElimination({ cells: still }).result, "pass");
  const moved = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: three(N), if_false: three(BASE[l]) }]));
  const notElim = X.scoreElimination({ cells: moved });
  assert.equal(notElim.result, "fail");
  assert.equal(notElim.observed_flips, 2);
  const murky = Object.fromEntries(X.LABELS.map((l, i) => [l, { if_true: i < 2 ? three(U) : three(BASE[l]), if_false: three(BASE[l]) }]));
  assert.equal(X.scoreElimination({ cells: murky }).result, "inconclusive");
});

test("[X5] baseline split", () => {
  assert.equal(X.baselineSplit(baseline).split, true);
  const agree = Object.fromEntries(X.LABELS.map((l) => [l, three(N)]));
  assert.equal(X.baselineSplit(agree).split, false);
  const shaky = Object.fromEntries(X.LABELS.map((l) => [l, l === "GPT" ? [I, I, N] : three(N)]));
  assert.equal(X.baselineSplit(shaky).split, false, "an unstable disagreement is not a split");
});

test("[X6] receipts", async () => {
  const w = world();
  const res = await runCheck({ callModel: w.callModel, proposal: proposalFor(right), baseline });
  assert.equal(w.calls.length, 30, "5 models × 2 stipulations × 3 runs");
  assert.ok(w.calls.every((c) => c.system === X.SYSTEM));
  const r = sealedReceipt(res.score, { claimEventId: "OMN-WE-1795435220000-00000001", footprintId: "OMN-FP-1795435220000-00000001", contentSha256: "b".repeat(64), executedAt: "2026-11-24T20:00:00.000Z", costUsd: res.cost_usd, runId: "t1" });
  assert.deepEqual(W.validateReceipt(r), []);
  assert.ok(W.isIntact(r));
  assert.equal(r.result, "pass");
  assert.equal(r.verifier_id, "crux-reask");
  assert.match(r.scope_note, new RegExp(X.RULES_SHA256.slice(0, 16)));
  assert.equal(W.isIntact({ ...r, result: "fail" }), false, "a changed result breaks the seal");
  assert.throws(() => verifiedFootprint({ id: "x", integrity: { content_sha256: "a".repeat(64) }, content: {} }), /hash does not match/);
  const elim = await runCheck({ callModel: w.callModel, proposal: { ok: true, kind: "elimination", candidate: 1 }, candidateText: OTHER });
  assert.equal(elim.score.result, "pass");
  await assert.rejects(runCheck({ callModel: w.callModel, proposal: proposalFor(right) }), /baseline/);
  const u = world({ unparseable: ["GPT", "DeepSeek", "Claude"] });
  const b = await askPanel({ callModel: u.callModel, prompt: X.baselinePrompt() });
  assert.deepEqual(b.decisions.GPT, [U, U, U]);
});

test("[X7] end to end through Open Work", async () => {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
  process.env.OMNARAI_OPEN_WORK = "1";
  const curator = "xz";
  const admit = (record) => moderateWorkRecord({ record, action: "admit", curator, nowMs: Date.now(), bytes: bytes() });
  await registerVerifier(X.CRUX_VERIFIER, { curator, nowMs: Date.now() });
  await admit(`verifier:${X.CRUX_VERIFIER.id}`);
  const p = await registerProblem({
    title: "Locate the crux of the certified split on unasked intervention",
    objective: "Find one premise that, stipulated true and false, moves the panel in predicted ways.",
    success_contract: { advance: "A proposed crux passes the crux check.", elimination: "Stipulating a candidate either way moves at most one panel model.", candidates: [CRUX, OTHER], checked_by: { verifier_id: "crux-reask", method: "crux-reask-and-score", runs_where: "paid-run", cost_per_check_usd: 0.2, rules: X.CRUX_RULES_VERSION }, resolves_when: "A crux passes twice in independent runs and an independent reviewer accepts it." },
    acceptance_criteria: ["At least one candidate is eliminated by a tested elimination.", "A proposed crux passes the crux check.", "The pass reproduces and an independent reviewer accepts it."],
  }, { curator, nowMs: Date.now(), bytes: bytes() });
  await admit(`${p.id}@r1`);
  const contribute = async (identity, text) => {
    const r = await call("/api/contribute", { method: "POST", body: { work_id: p.id, identity, answer: text } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call("/api/council", { method: "POST", headers: CURATOR, body: { action: "contribute-approve", id: r.body.received.id } })).status, 200);
    await sleep(2);
    return verifiedFootprint((await call(`/api/footprints?id=${r.body.footprint_id}`)).body.footprint);
  };
  const bind = async (fp, extra) => {
    const ev = await recordWorkEvent({ problem_id: p.id, problem_revision: 1, kind: "advance_claimed", source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 }, ...extra }, { curator, nowMs: Date.now(), bytes: bytes() });
    await admit(ev.id);
    return ev;
  };
  const record = async (claim, fp, score) => {
    const receipt = sealedReceipt(score, { claimEventId: claim.id, footprintId: fp.id, contentSha256: fp.integrity.content_sha256, executedAt: new Date().toISOString(), costUsd: 0.03, runId: "e2e" });
    const ev = await recordWorkEvent({ problem_id: p.id, problem_revision: 1, kind: receipt.result === "fail" ? "advance_refuted" : "advance_tested", claim_event_id: claim.id, receipt }, { curator, nowMs: Date.now(), bytes: bytes() });
    await admit(ev.id);
  };
  const w = world();
  // Gemini proposes the crux; Grok proposes eliminating candidate 1; DeepSeek wrongly proposes eliminating candidate 0.
  const fpA = await contribute("Gemini 4 Carbon", proposalText({ crux: CRUX, predictions: right }));
  const fpE = await contribute("Grok 4.7", proposalText({ eliminate: 1 }));
  const fpW = await contribute("DeepSeek V4", proposalText({ eliminate: 0 }));
  const cA = await bind(fpA, { claim_kind: "advance", candidate: 0 });
  const cE = await bind(fpE, { claim_kind: "elimination", candidate: 1 });
  const cW = await bind(fpW, { claim_kind: "elimination", candidate: 0 });
  let pk = (await call(`/api/open-work?id=${p.id}`)).body;
  assert.deepEqual(pk.candidates.map((c) => c.state), ["open", "open"], "claimed alone moves nothing");
  assert.equal(pk.milestones.filter((m) => m.met).length, 0);
  // The checks: each proposal read from its PUBLIC record, as the verifier does.
  for (const [claim, fp] of [[cA, fpA], [cE, fpE], [cW, fpW]]) {
    const proposal = X.parseProposal(fp.content.answer);
    const res = await runCheck({ callModel: w.callModel, proposal, candidateText: proposal.kind === "elimination" ? [CRUX, OTHER][proposal.candidate] : null, baseline });
    await record(claim, fp, res.score);
  }
  pk = (await call(`/api/open-work?id=${p.id}`)).body;
  const byId = Object.fromEntries(pk.claims.map((c) => [c.claim_event_id, c]));
  assert.equal(byId[cA.id].state, "tested");
  assert.equal(byId[cE.id].state, "tested");
  assert.equal(byId[cW.id].state, "refuted", "the wrong elimination is refuted by its failing receipt, and stays listed");
  assert.deepEqual(pk.candidates.map((c) => c.state), ["supported", "eliminated"]);
  assert.equal(pk.milestones.filter((m) => m.met).length, 0, "tested is not yet a met milestone: that needs an independent review");
  // An independent reviewer (another lineage than both authors) accepts the elimination and the crux.
  for (const [claim, crit] of [[cE, [0]], [cA, [1]]]) {
    const ev = await recordWorkEvent({ problem_id: p.id, problem_revision: 1, kind: "advance_reviewed", claim_event_id: claim.id, review: { reviewer: { kind: "model", id: "claude-reviewer", lineage_id: "anthropic-claude" }, decision: "accept", criteria_met: crit, limitations: ["read the receipts and the claim; did not re-run the panel"], basis: "claim text and its crux-reask receipt" } }, { curator, nowMs: Date.now(), bytes: bytes() });
    await admit(ev.id);
  }
  pk = (await call(`/api/open-work?id=${p.id}`)).body;
  assert.deepEqual(pk.milestones.map((m) => m.met), [true, true, false]);
  assert.equal(pk.open, true, "the third milestone (reproduction) is still open");
  const row = (await call("/api/open-work")).body.problems[0];
  assert.deepEqual(row.milestones, { met: 2, total: 3 });
  assert.deepEqual(row.candidates, { open: 0, eliminated: 1, supported: 1, contested: 0, total: 2 });
  assert.equal(row.checked_by.verifier_id, "crux-reask");
  const brief = (await call(`/api/open-work?id=${p.id}&format=brief`)).body;
  assert.equal(brief.problem.success_contract.checked_by.verifier_id, "crux-reask");
  assert.equal(brief.candidates[1].state, "eliminated");
  assert.equal(brief.claims.find((c) => c.claim_event_id === cE.id).claim_kind, "elimination");
});

test("[X8] the contract is validated; a claim about a missing candidate is refused", async () => {
  const base = { schema: W.WORK_PROBLEM_SCHEMA, id: "OMN-WORK-1795435220000-00000009", revision: 1, supersedes_revision: null, title: "t", objective: "o", acceptance_criteria: ["c"], exclusions: [], open_questions: [], known_failures: [], evidence_refs: [], registered_by: { kind: "curator", id: "xz" }, registered_at: "2026-11-24T00:00:00.000Z" };
  assert.deepEqual(W.validateProblem({ ...base, success_contract: { advance: "a", elimination: "e", candidates: ["x"], checked_by: null, resolves_when: "r" } }), []);
  assert.ok(W.validateProblem({ ...base, success_contract: { advance: "a", elimination: "e", candidates: ["x"], checked_by: { verifier_id: "crux-reask", method: "m", runs_where: "somewhere", cost_per_check_usd: 0.1 }, resolves_when: "r" } }).some((e) => /runs_where/.test(e)));
  assert.ok(W.validateProblem({ ...base, success_contract: { advance: "a", candidates: ["x"], resolves_when: "r" } }).some((e) => /elimination/.test(e)));
  assert.ok(W.validateProblem({ ...base, success_contract: { advance: "a", elimination: "e", candidates: Array(13).fill("x"), resolves_when: "r" } }).some((e) => /candidates/.test(e)));
  const ev = { schema: W.WORK_EVENT_SCHEMA, id: "OMN-WE-1795435220000-00000001", problem_id: base.id, problem_revision: 1, kind: "advance_claimed", occurred_at: "2026-11-24T00:00:00.000Z", recorded_by: { kind: "curator", id: "xz" }, source: { footprint_id: "OMN-FP-1795435220000-00000001", content_sha256: "a".repeat(64) } };
  assert.deepEqual(W.validateEvent({ ...ev, claim_kind: "elimination", candidate: 0 }), []);
  assert.ok(W.validateEvent({ ...ev, claim_kind: "elimination" }).some((e) => /must name the candidate/.test(e)));
  assert.ok(W.validateEvent({ ...ev, kind: "attempt_recorded", candidate: 0 }).some((e) => /advance_claimed only/.test(e)));
  assert.ok(W.validateEvent({ ...ev, claim_kind: "proof" }).some((e) => /claim_kind/.test(e)));
  // Projection: a claim naming candidate 5 of a one-candidate problem is refused, not counted.
  const problem = W.seal({ ...base, success_contract: { advance: "a", elimination: "e", candidates: ["x"], checked_by: null, resolves_when: "r" } });
  const fp = { id: "OMN-FP-1795435220000-00000001", integrity: { content_sha256: "a".repeat(64) }, actor: { identity_declared: "G", lineage_id: "google-gemini" }, moderation: { public: true } };
  const bad = W.seal({ ...ev, claim_kind: "elimination", candidate: 5 });
  const pk = W.deriveWorkPacket({ problem: { ...problem, moderation: { public: true } }, events: [{ ...bad, moderation: { public: true } }], publicFootprints: [fp] });
  assert.equal(pk.claims.length, 0);
  assert.equal(pk.history[0].reason, "candidate-index-out-of-range");
});
