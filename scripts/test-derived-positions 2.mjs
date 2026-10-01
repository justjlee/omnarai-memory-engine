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
