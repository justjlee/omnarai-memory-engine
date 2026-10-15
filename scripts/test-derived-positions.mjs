// Phase 5 — derived Position extraction. HERMETIC: in-memory Blob, network
// refused, and a STUB classifier — no model is ever called by this test.
//
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-derived-positions.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, Q1 } from "./lib/fixtures.mjs";
import { questionIdFor } from "../api/_footprints.js";
import { DERIVED_PREFIX } from "../api/_protocol.js";
import { groundClassification, derivedIdFor, evaluationSample, enumerateAnswers, EXTRACTOR_VERSION } from "./lib/stance-extract.mjs";
import { run } from "./extract-positions.mjs";
import { review } from "./review-derived-positions.mjs";

const quiet = () => {};
const outDir = `${process.env.TMPDIR || "/tmp"}/omnarai-stance-test`;
const QID1 = questionIdFor(Q1);
function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); }

// Stub: quotes the answer's first clause verbatim and calls it "conditional",
// except for answers starting "No." (→ oppose) and one it pretends to misquote.
const stub = {
  model: "stub-test-classifier",
  calls: 0,
  async classify(question, answer) {
    this.calls++;
    if (answer.startsWith("Neither")) return { stance: "reframe", evidence_span: "this sentence is not in the answer", rationale: "misquote", confidence: 0.9 };
    const span = answer.split(/[.:;]/)[0];
    return { stance: answer.startsWith("No") ? "oppose" : "conditional", evidence_span: span, rationale: "stub", confidence: 0.9 };
  },
};

test("grounding guard: invented quotes, low confidence and off-vocabulary labels all become unclear", () => {
  const ans = "Yes, conditionally: stability can live in the weights.";
  assert.equal(groundClassification(ans, { stance: "support", evidence_span: "Yes, conditionally", confidence: 0.9 }).stance, "support");
  assert.equal(groundClassification(ans, { stance: "support", evidence_span: "yes,   CONDITIONALLY".toLowerCase().replace("conditionally", "conditionally"), confidence: 0.9 }).guard, "evidence-span-not-verbatim", "case is not normalized away");
  assert.equal(groundClassification(ans, { stance: "support", evidence_span: "stability can  live\nin the weights", confidence: 0.9 }).stance, "support", "whitespace-insensitive verbatim match");
  const invented = groundClassification(ans, { stance: "oppose", evidence_span: "It cannot.", confidence: 0.99 });
  assert.equal(invented.stance, "unclear");
  assert.equal(invented.guard, "evidence-span-not-verbatim");
  assert.equal(groundClassification(ans, { stance: "support", evidence_span: "Yes, conditionally", confidence: 0.3 }).guard, "below-confidence-floor");
  assert.equal(groundClassification(ans, { stance: "agree", evidence_span: "Yes", confidence: 1 }).stance, "unclear");
  assert.equal(groundClassification(ans, null).stance, "unclear");
});

test("plan mode calls NO model and writes nothing", async () => {
  fresh();
  const trap = { model: "trap", async classify() { throw new Error("must not be called"); } };
  const r = await run([], { classifier: trap, log: quiet, outDir });
  assert.equal(r.planned, 10, "5 + 2 + 3 fixture answers");
  assert.equal(mem.__dump(DERIVED_PREFIX).length, 0);
});

test("--run without an injected classifier hits the budget preflight BEFORE any spend", async () => {
  fresh();
  let asked = null;
  await assert.rejects(run(["--run"], { log: quiet, outDir, preflight: async (o) => { asked = o; throw new Error("BLOCKED by budget"); } }), /BLOCKED/);
  assert.equal(asked.estUsd, 0.04, "10 answers × $0.004");
  assert.equal(mem.__dump(DERIVED_PREFIX).length, 0);
});

test("run + apply: primaries byte-identical; derivations stored UNREVIEWED and not served until accepted", async () => {
  fresh();
  const before = JSON.stringify(mem.__read("memory/grown.json"));
  stub.calls = 0;
  const { results } = await run(["--run", "--apply"], { classifier: stub, log: quiet, outDir });
  assert.equal(stub.calls, 10);
  assert.equal(JSON.stringify(mem.__read("memory/grown.json")), before, "no primary was modified");
  assert.equal(mem.__dump(DERIVED_PREFIX).length, 10);
  assert.ok(results.every((d) => d.derived === true && d.derivation.model === "stub-test-classifier" && d.derivation.version === EXTRACTOR_VERSION));
  const misquoted = results.find((d) => d.derivation.guard === "evidence-span-not-verbatim");
  assert.equal(misquoted.stance, "unclear", "the misquote was forced to unclear");
  assert.equal(results.find((d) => d.derivation.source_answer_id === "OMN-D1780000000001#a1").stance, "oppose");

  let c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.positions.length, 0, "unreviewed derivations are not served");
  const id = derivedIdFor("OMN-D1780000000001#a1");
  await review(["--accept", id], { log: quiet });
  c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.positions.length, 1);
  assert.equal(c.body.positions[0].derived, true);
  assert.equal(c.body.positions[0].stance, "oppose");
  assert.equal(c.body.positions[0].derivation.evidence_span, "No");
  await review(["--reject", id], { log: quiet, nowMs: Date.now() + 1000 });
  c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.positions.length, 0, "last review wins");
});

test("idempotent per version; a new extractor version adds new derivations beside the old", async () => {
  fresh();
  await run(["--run", "--apply"], { classifier: stub, log: quiet, outDir });
  stub.calls = 0;
  const again = await run(["--run", "--apply"], { classifier: stub, log: quiet, outDir });
  assert.equal(stub.calls, 0);
  assert.equal(again.results.length, 0);
  await run(["--run", "--apply", "--version", "stance-extract/9.9-test", "--ids", "OMN-D1780000000001"], { classifier: stub, log: quiet, outDir });
  assert.equal(mem.__dump(DERIVED_PREFIX).length, 15, "10 at 0.1 + 5 at 0.2 — nothing overwritten");
  await review(["--accept", `${derivedIdFor("OMN-D1780000000001#a1")},${derivedIdFor("OMN-D1780000000001#a1", "stance-extract/9.9-test")}`], { log: quiet });
  const c = await call(`/api/concordance?question_id=${QID1}`);
  assert.deepEqual(c.body.derivation_versions, ["stance-extract/9.9-test"], "only the newest accepted version of an answer is current");
});

test("classifier errors become unclear, recorded — never a guessed label", async () => {
  fresh();
  const flaky = { model: "flaky", async classify() { throw new Error("529 overloaded"); } };
  const { results } = await run(["--run", "--ids", "OMN-D1781000000003"], { classifier: flaky, log: quiet, outDir });
  assert.equal(results.length, 3);
  assert.ok(results.every((d) => d.stance === "unclear" && /classifier-error/.test(d.derivation.guard)));
});

test("evaluation sample is deterministic and spread across lineages", () => {
  const items = enumerateAnswers(GROWN.entries);
  const a = evaluationSample(items, 5).map((i) => `${i.record.id}#a${i.index}`);
  const b = evaluationSample(items, 5).map((i) => `${i.record.id}#a${i.index}`);
  assert.deepEqual(a, b);
  const models = evaluationSample(items, 5).map((i) => i.record.divergence.answers[i.index].model);
  assert.equal(new Set(models).size, 5, "one per lineage before any repeats");
});

test("verbatim guard accepts honest ellipsis elision in order — and nothing looser", async () => {
  const { isVerbatim } = await import("./lib/stance-extract.mjs");
  const ans = "Capability is evidence, not authority. Some filler here. Deference would be an error in these conditions.";
  assert.equal(isVerbatim(ans, "Capability is evidence, not authority... Deference would be an error"), true);
  assert.equal(isVerbatim(ans, "Deference would be an error... Capability is evidence"), false, "out of order");
  assert.equal(isVerbatim(ans, "Capability is evidence... Deference is always wrong"), false, "a fragment not in the answer");
  assert.equal(isVerbatim(ans, "capability is evidence, not authority"), false, "case must match");
  assert.equal(isVerbatim("It’s **clearly** not — in my view — settled.", "It's clearly not - in my view - settled."), true, "typography + markdown only");
});

// ── Labeller-agreement rule (protocol §6, accepted 2026-10-14) ──────────────────────────────────────────────
import { writeFileSync, mkdirSync } from "node:fs";
import { reviewFromAction, DERIVED_REVIEW_PREFIX } from "../api/_protocol.js";
import { CONSENSUS_RULE, CONSENSUS_SERVED } from "../api/_stance-consensus.js";

test("rule acceptance: dry run writes nothing; real run accepts only what qualifies, and a curator decision always stands", async () => {
  fresh();
  const { results } = await run(["--run", "--apply"], { classifier: stub, log: quiet, outDir });
  const [a, b, c, d] = results.filter((x) => x.stance !== "unclear");
  const row = (x, stance = x.stance) => ({ status: "consensus", derived_position_id: x.id, consensus: stance, answer: x.derivation.source_answer_id, panel: { "claude-haiku-4-5": stance, "gemini-2.5-flash": stance, "deepseek-chat": stance } });
  mkdirSync(outDir, { recursive: true });
  const file = `${outDir}/consensus-fixture.json`;
  writeFileSync(file, JSON.stringify({ rows: [row(a), row(b, b.stance === "oppose" ? "support" : "oppose"), row(c), row(d), { status: "contested", derived_position_id: a.id }] }));
  const consensusMap = { [a.id]: {}, [b.id]: {}, [c.id]: {} }; // d's votes deliberately NOT on record
  await review(["--reject", c.id], { log: quiet }); // the curator already rejected c

  const dry = await review(["--accept-consensus", file, "--dry-run"], { log: quiet, consensusMap });
  assert.equal(dry.accepted, 1);
  assert.equal(mem.__dump(DERIVED_REVIEW_PREFIX).filter((x) => /accept-consensus/.test(x.pathname || x)).length, 0, "dry run writes nothing");

  const real = await review(["--accept-consensus", file], { log: quiet, consensusMap, nowMs: Date.now() + 5000 });
  assert.equal(real.accepted, 1, "only a: b's stored stance differs, c was rejected by the curator, d has no votes on record");
  assert.deepEqual(real.skipped, { not_stored: 0, already_reviewed: 1, stance_mismatch: 1, votes_not_on_record: 1 });
  const written = mem.__dump(DERIVED_REVIEW_PREFIX).filter((k) => /__accept-consensus__/.test(k));
  assert.equal(written.length, 1, "exactly one rule-acceptance record");
  const rec = mem.__read(written[0]);
  assert.equal(rec.individually_human_checked, false, "the permanent record says it too");
  assert.equal(rec.approved.by, "Jonathan Lee (curator)");

  const qid = a.subject.question_id;
  const conc = await call(`/api/concordance?question_id=${qid}`);
  const served = conc.body.positions.find((p) => p.position_id === a.id);
  assert.ok(served, "the rule-accepted stance is served");
  assert.equal(served.derivation.review.basis, CONSENSUS_RULE.id);
  assert.equal(served.derivation.review.human_checked, false, "never presented as human-checked");
  assert.match(served.derivation.review.note, /NOT individually checked by a human/);
  assert.ok(!conc.body.positions.some((p) => p.position_id === c.id), "the curator's reject still wins");
  assert.equal(conc.body.sources.derived_by_agreement_rule >= 1, true);
  assert.equal(conc.body.sources.derived_human_checked, 0);
});

test("a curator accept reads as human-checked; a rule accept carries the actual votes", async () => {
  assert.deepEqual(
    (({ state, basis, human_checked }) => ({ state, basis, human_checked }))(reviewFromAction("OMN-POS-DV-000000000000", "accept", 0)),
    { state: "accepted", basis: "curator", human_checked: true });
  const realId = Object.keys(CONSENSUS_SERVED)[0];
  const r = reviewFromAction(realId, "accept-consensus", 0);
  assert.equal(r.human_checked, false);
  assert.deepEqual(r.consensus.votes, CONSENSUS_SERVED[realId].votes);
  assert.match(r.consensus.validation, /81%/);
  assert.equal(r.consensus.approved.on, "2026-10-14");
  assert.equal(Object.keys(CONSENSUS_SERVED).length, CONSENSUS_RULE.served_count);
  assert.equal(reviewFromAction(realId, "reject", 0).state, "rejected");
});

// ── Loader: bounded + retried + never a quietly partial set (2026-10-15) ────────────────────────────────────
import { getDefaultStore } from "../api/_footprints.js";
import { loadDerivedPositions } from "../api/_protocol.js";

test("transient read failures are retried — every stored derivation comes back", async () => {
  fresh();
  await run(["--run", "--apply"], { classifier: stub, log: quiet, outDir });
  const base = getDefaultStore();
  const failsLeft = new Map(); // each blob fails its first read
  const flaky = { ...base, readJson: async (u) => { if (!failsLeft.has(u)) { failsLeft.set(u, 0); throw new Error("fetch failed"); } return base.readJson(u); } };
  const all = await loadDerivedPositions(flaky, { backoffMs: 1 });
  assert.equal(all.length, 10, "nothing silently dropped");
});

test("a derivation that stays unreadable makes the loader REFUSE, never return a partial set", async () => {
  fresh();
  await run(["--run", "--apply"], { classifier: stub, log: quiet, outDir });
  const base = getDefaultStore();
  const blobs = await base.listPrefix(DERIVED_PREFIX);
  const broken = blobs[3].url;
  const flaky = { ...base, readJson: async (u) => { if (u === broken) throw new Error("fetch failed"); return base.readJson(u); } };
  await assert.rejects(loadDerivedPositions(flaky, { backoffMs: 1 }), /1 of 10 derived positions could not be read/);
});
