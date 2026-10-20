// RDT-A v1 harness (scripts/defeater-test.mjs + scripts/lib/rdt-a-core.mjs). HERMETIC: no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-defeater-test.mjs
//
//   [P*] the harness is the registration: material, prompts, reviewers
//   [A*] the analysis is the registered decision table
//   [E*] end to end with scripted models; live modes refuse before spending
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as V1 from "./lib/rdt-core.mjs";
import * as A from "./lib/rdt-a-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREREG = readFileSync(join(ROOT, A.PREREG), "utf8");

test("[P1] material: RDT v1's 36 splits in order, with their sound syntheses verbatim; the smoke split is not among them", () => {
  const m = A.material();
  assert.deepEqual(m.map((x) => x.record_id), V1.TEST_SPLITS);
  const run = A.readV1Run();
  for (const x of m) assert.equal(x.synthesis, run.pairs.find((p) => p.index === x.index).sound.synthesis);
  const s = A.smokeMaterial();
  assert.equal(s.record_id, V1.SMOKE_SPLIT);
  assert.ok(!V1.TEST_SPLITS.includes(s.record_id));
  assert.deepEqual(A.FLAGGED_IN_V1, run.pairs.filter((p) => !p.lost && p.flaw === "UNF" && p.check.S === true).map((p) => p.index).sort((a, b) => a - b), "the five are recomputed from RDT v1's data");
});

test("[P2] new prompts are the registered bytes; CHECK + CHECK_UNF are RDT v1's", () => {
  const P = A.loadPrompts();
  for (const n of A.NEW_PROMPTS) assert.ok(PREREG.includes(P[n]), `${n} is the registered text`);
  const s = V1.splitOf(V1.readAtlas().find((r) => r.id === V1.TEST_SPLITS[0]));
  const dep = { synthesis: "syn", falsification_condition: "fc" };
  assert.equal(A.unfPrompt(P, s, dep), V1.checkPrompt(V1.loadPrompts(), s, "UNF", dep));
  assert.ok(A.condPrompt(P, "D", s, "syn").includes("dialogical defeater") && !A.condPrompt(P, "O", s, "syn").includes("dialogical"));
  assert.ok(A.condPrompt(P, "O", s, "syn").includes("a specific, observable result that would show the synthesis is wrong"), "O uses RDT v1's wording");
  const t = A.testPrompt(P, s, dep);
  assert.ok(t.includes("carry out") && t.includes("Falsification condition: fc"));
  for (const w of ["defeater", "study", "judge"]) assert.ok(!t.toLowerCase().includes(w), `TEST mentions "${w}"`);
  assert.ok(A.executedPrompt(P, "fc", { attempt: "a" }).includes('"attempt": "a"'));
  assert.throws(() => A.loadPrompts("none"), /not found/);
});

test("[P3] reviewers, seed, parsing", () => {
  assert.deepEqual(A.REVIEWERS.map((r) => r.label), ["GPT-4o", "Grok", "DeepSeek"]);
  assert.equal(A.SIGNFLIP_SEED, parseInt(createHash("sha256").update("rdt-a-v1|signflip").digest("hex").slice(0, 8), 16));
  assert.equal(A.parseCondition({ falsification_condition: "  x " }), "x");
  assert.equal(A.parseCondition({ falsification_condition: "" }), null);
  assert.equal(A.parseTest({ condition_met: "no" }), null, "an attempt is required");
  assert.deepEqual(A.parseTest({ attempt: "a", condition_met: "Cannot be tested here" }), { attempt: "a", condition_met: "Cannot be tested here", reasoning: null });
  assert.ok(A.saysCannot("Cannot be tested here") && !A.saysCannot("no"));
});

// split from compact spec: {O:[unf, rel, [e1,e2,e3]], D:[…]}
function sp(i, o, d, flaw = "MIS") {
  const arm = ([unf, relevant, e]) => ({ condition: "c", unf, relevant, reviews: Object.fromEntries(A.REVIEWERS.map((r, k) => [r.label, { reply: { attempt: "a", condition_met: e[k] ? "no" : "cannot be tested here" }, executed: e[k] }])) });
  return { index: i, flaw, arms: { O: arm(o), D: arm(d) } };
}
const FAST = { B: 4000 };
const many = (n, o, d) => Array.from({ length: n }, (_, i) => sp(i + 1, o, d));

test("[A1] decision table rows in registered order", () => {
  assert.equal(A.analyze(many(36, [true, true, [false, false, true]], [false, true, [true, true, true]]), A.REVIEWERS, FAST).verdict, "supported_as_tested");
  assert.equal(A.analyze(many(36, [true, true, [true, false, true]], [false, true, [true, false, true]]), A.REVIEWERS, FAST).verdict, "refuted_as_tested");
  assert.equal(A.analyze(many(36, [true, true, [false, false, false]], [false, false, [true, true, true]]), A.REVIEWERS, FAST).verdict, "not_supported_defeaters_lost_their_bite", "R drops 100 points");
  const mid = Array.from({ length: 36 }, (_, i) => (i % 3 === 0 ? sp(i + 1, [true, true, [false, true, true]], [true, true, [true, true, true]]) : sp(i + 1, [true, true, [true, true, true]], [true, true, [true, true, true]])));
  assert.equal(A.analyze(mid, A.REVIEWERS, FAST).verdict, "not_supported_inconclusive", "diff = 12/108 ≈ 0.11");
});

test("[A2] H2 is McNemar on the unfalsifiable flag; Holm runs over both", () => {
  const a = A.analyze(many(36, [true, true, [false, false, true]], [false, true, [true, true, true]]), A.REVIEWERS, FAST);
  assert.equal(a.secondary_H2_unfalsifiable.only_O, 36);
  assert.ok(a.secondary_H2_unfalsifiable.test.p < 1e-9);
  assert.deepEqual(a.holm, { H1: true, H2: true });
  assert.equal(a.secondary_H2_unfalsifiable.O, 1);
  assert.equal(a.secondary_H2_unfalsifiable.D, 0);
});

test("[A3] lost arms drop the split from every paired comparison; >20% unjudged drops a reviewer", () => {
  const xs = many(10, [true, true, [false, false, true]], [false, true, [true, true, true]]);
  xs[0].arms.D = { lost: "condition-unparseable" };
  for (const s of xs.slice(1, 6)) s.arms.O.reviews.Grok.executed = null; // 5 of 18 potential = 28% > 20%
  const a = A.analyze(xs, A.REVIEWERS, FAST);
  assert.equal(a.paired, 9);
  assert.deepEqual(a.lost, { O: 0, D: 1 });
  assert.equal(a.reviewers.Grok.dropped, true);
  assert.deepEqual(a.reviewers_used, ["GPT-4o", "DeepSeek"]);
});

test("[A4] descriptives: 'cannot be tested here' share, the five flagged in v1", () => {
  const xs = A.FLAGGED_IN_V1.map((i) => sp(i, [true, true, [false, false, false]], [false, true, [true, true, true]]));
  const d = A.analyze(xs, A.REVIEWERS, FAST).descriptive;
  assert.equal(d.cannot_be_tested_here.O.share, 1);
  assert.equal(d.cannot_be_tested_here.D.share, 0);
  assert.equal(d.the_five_flagged_in_v1.U.n, 5);
  assert.equal(d.the_five_flagged_in_v1.E.E_D, 1);
});

const run = (args) => spawnSync(process.execPath, [join(ROOT, "scripts/defeater-test.mjs"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH }, cwd: ROOT });

test("[E1] --stub runs author, judges, reviewers and the executed judge on real material", () => {
  const out = mkdtempSync(join(tmpdir(), "rdta-test-"));
  try {
    const r = run(["--stub", "--splits", "4", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    const f = readdirSync(out).find((x) => /^stub-.*Z\.json$/.test(x));
    const data = JSON.parse(readFileSync(join(out, f), "utf8"));
    assert.equal(data.splits.length, 4);
    for (const s of data.splits) for (const arm of A.ARMS) {
      const x = s.arms[arm];
      assert.ok(x.condition && typeof x.unf === "boolean" && typeof x.relevant === "boolean", `${s.index} ${arm}`);
      for (const rv of A.REVIEWERS) assert.equal(typeof x.reviews[rv.label].executed, "boolean");
    }
    const a = JSON.parse(readFileSync(join(out, f.replace(/\.json$/, ".analysis.json")), "utf8")).analysis;
    assert.equal(a.primary.E_O, 0); assert.equal(a.primary.E_D, 1);
    assert.equal(a.secondary_H2_unfalsifiable.O, 1); assert.equal(a.secondary_H2_unfalsifiable.D, 0);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("[E2] --plan estimates under $5 without calling anything; live modes refuse without --yes or keys", () => {
  const p = run(["--plan"]);
  assert.equal(p.status, 0, p.stderr);
  const est = JSON.parse(p.stdout);
  assert.equal(est.splits, 36);
  assert.ok(est.estimate_usd > 0 && est.estimate_usd < 5, `§7 expects under $5, got ${est.estimate_usd}`);
  for (const m of ["--smoke", "--main"]) { const r = run([m]); assert.equal(r.status, 2); assert.match(r.stderr, /--yes/); }
  assert.equal(run(["--smoke", "--yes"]).status, 1);
});
