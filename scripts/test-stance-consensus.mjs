// Consensus gate for derived stances (protocol Phase 5 adoption rule). Pure; no network, no store.
//   node scripts/test-stance-consensus.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, buildConsensus, summarize, pickHoldout, validate, PANEL } from "./stance-consensus.mjs";

const V = (stance, guard = null) => ({ stance, guard });

test("unanimous grounded votes are served", () => {
  const j = judge({ "claude-haiku-4-5": V("support"), "gemini-2.5-flash": V("support"), "deepseek-chat": V("support") });
  assert.equal(j.status, "consensus"); assert.equal(j.consensus, "support"); assert.equal(j.votes, 3);
});
test("any dissent means contested: nothing is served, and the split is recorded", () => {
  const j = judge({ "claude-haiku-4-5": V("support"), "gemini-2.5-flash": V("support"), "deepseek-chat": V("conditional") });
  assert.equal(j.status, "contested"); assert.equal(j.consensus, null); assert.deepEqual(j.split, { support: 2, conditional: 1 });
});
test("a support/oppose conflict is never served", () => {
  assert.equal(judge({ a: V("support"), b: V("oppose"), c: V("support") }).consensus, null);
});
test("a guarded label is an ABSTENTION, not a vote for 'unclear'", () => {
  const j = judge({ "claude-haiku-4-5": V("support"), "gemini-2.5-flash": V("unclear", "evidence-span-not-verbatim"), "deepseek-chat": V("support") });
  assert.equal(j.status, "insufficient", "only two real votes");
  assert.deepEqual(j.abstained, ["gemini-2.5-flash"]);
  const k = judge({ "claude-haiku-4-5": V("unclear"), "gemini-2.5-flash": V("unclear"), "deepseek-chat": V("unclear") });
  assert.equal(k.consensus, "unclear", "an honest, unanimous 'unclear' is a real consensus");
});
test("a missing labeller counts as an abstention", () => {
  assert.equal(judge({ "claude-haiku-4-5": V("support"), "gemini-2.5-flash": null, "deepseek-chat": V("support") }).status, "insufficient");
});
test("the original label alone can never be served (fewer than 3 votes)", () => {
  assert.equal(judge({ "claude-haiku-4-5": V("support") }).status, "insufficient");
});

const derived = (ref, stance, lineage = "anthropic-claude", guard = null) => ({ id: `D-${ref}`, primary_text_ref: ref, stance, actor: { lineage_id: lineage }, derivation: { guard } });
const item = (answer, g, d) => ({ answer, labels: { "gemini-2.5-flash": { stance: g, guard: null }, "deepseek-chat": { stance: d, guard: null } } });

test("buildConsensus joins the panel report to the derived positions and summarises", () => {
  const rows = buildConsensus(
    [derived("r1#a0", "support"), derived("r1#a1", "oppose", "openai-gpt"), derived("r2#a0", "conditional", "xai-grok")],
    { items: [item("r1#a0", "support", "support"), item("r1#a1", "support", "oppose"), item("r2#a0", "conditional", "conditional")] },
  );
  assert.deepEqual(rows.map((r) => r.status), ["consensus", "contested", "consensus"]);
  const s = summarize(rows);
  assert.equal(s.n, 3); assert.equal(s.served, 2); assert.deepEqual(s.served_stance_distribution, { support: 1, conditional: 1 });
});

test("held-out set excludes the calibration sample and balances served / not-served", () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ answer: `x#a${i}`, lineage: i % 2 ? "a" : "b", status: i < 10 ? "consensus" : "contested", consensus: i < 10 ? "support" : null, original: "support" });
  const excl = new Set(["x#a0", "x#a1", "x#a10"]);
  const { served, notServed } = pickHoldout(rows, 8, excl);
  assert.equal(served.length, 4); assert.equal(notServed.length, 4);
  for (const r of [...served, ...notServed]) assert.ok(!excl.has(r.answer));
  assert.ok(served.every((r) => r.status === "consensus") && notServed.every((r) => r.status !== "consensus"));
});

test("validation compares EXTERNAL labellers (not the panel) against the panel's label, and checks the pre-stated predictions", () => {
  const rows = [
    { answer: "s1", status: "consensus", consensus: "support", original: "support" },
    { answer: "s2", status: "consensus", consensus: "oppose", original: "oppose" },
    { answer: "n1", status: "contested", consensus: null, original: "support" },
    { answer: "n2", status: "contested", consensus: null, original: "support" },
  ];
  const lab = (stance) => ({ stance, guard: null });
  const report = { labellers: { "gpt-4o": {}, "gemini-2.5-flash": {} }, items: [
    { answer: "s1", labels: { "gpt-4o": lab("support") } }, { answer: "s2", labels: { "gpt-4o": lab("oppose") } },
    { answer: "n1", labels: { "gpt-4o": lab("conditional") } }, { answer: "n2", labels: { "gpt-4o": lab("support") } } ] };
  const res = validate(report, rows, { served_min: 0.8, not_served_max: 0.55 });
  assert.deepEqual(Object.keys(res.labellers), ["gpt-4o"], "panel members are not external");
  assert.equal(res.pooled.served_rate, 1); assert.equal(res.pooled.not_served_rate, 0.5);
  assert.equal(res.verdict.served_prediction_met, true); assert.equal(res.verdict.not_served_prediction_met, true);
});

test("the panel is the frozen one", () => assert.deepEqual(PANEL, ["claude-haiku-4-5", "gemini-2.5-flash", "deepseek-chat"]));

import { convergence } from "./stance-convergence.mjs";
test("convergence: cross-lineage agreement on the same record vs the chance level of the stance mix", () => {
  const row = (answer, lineage, consensus) => ({ answer, lineage, status: "consensus", consensus });
  const c = convergence([
    row("r1#a0", "a", "support"), row("r1#a1", "b", "support"),   // agree
    row("r2#a0", "a", "support"), row("r2#a1", "b", "oppose"),    // split
    row("r3#a0", "a", "support"), row("r3#a1", "a", "oppose"),    // same lineage: not compared
    { answer: "r4#a0", lineage: "a", status: "contested", consensus: null },
  ]);
  assert.equal(c.cross_lineage_pairs, 2); assert.equal(c.pairs_agree, 1); assert.equal(c.pairs_agree_rate, 0.5);
  assert.equal(c.records_with_both_support_and_oppose_served, 1);
  assert.equal(c.served_answers, 6);
});
