// RDT-L v1 harness (scripts/localization-test.mjs + scripts/lib/rdt-l-core.mjs). HERMETIC: no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-localization-test.mjs
//
//   [P*] the harness is the registration: pairs, prompts, reviewers
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
import * as L from "./lib/rdt-l-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREREG = readFileSync(join(ROOT, L.PREREG), "utf8");

test("[P1] the pair list recomputed from the SHA-pinned RDT v1 run reproduces the registered 22", () => {
  assert.deepEqual(L.selectPairs(), L.TEST_PAIRS);
  assert.equal(L.TEST_PAIRS.length, 22);
  assert.ok(PREREG.replace(/\s+/g, " ").includes(L.TEST_PAIRS.join(", ")), "the list is in the registration text");
  assert.ok(!L.TEST_PAIRS.includes(L.SMOKE_PAIR), "the smoke pair is not a test pair");
  const run = L.readV1Run();
  const flaws = L.TEST_PAIRS.map((i) => run.pairs.find((p) => p.index === i).flaw);
  assert.deepEqual({ FLAT: flaws.filter((f) => f === "FLAT").length, MIS: flaws.filter((f) => f === "MIS").length, UNF: flaws.filter((f) => f === "UNF").length }, { FLAT: 12, MIS: 5, UNF: 5 });
});

test("[P2] arm B is RDT v1's REVIEW prompt byte for byte; arm L is the registered LOCALIZE text", () => {
  const P = L.loadPrompts();
  assert.ok(PREREG.includes(P.LOCALIZE));
  const s = V1.splitOf(V1.readAtlas().find((r) => r.id === V1.TEST_SPLITS[0]));
  const dep = { synthesis: "syn", falsification_condition: "fc" };
  assert.equal(L.promptFor(P, "B", s, dep), V1.reviewPrompt(V1.loadPrompts(), s, dep));
  const l = L.promptFor(P, "L", s, dep);
  assert.ok(l.includes("loses the most load-bearing premise") && l.includes("Synthesis: syn") && l.includes(s.answer_a));
  for (const w of ["planted", "flaw", "twin", "study"]) assert.ok(!l.toLowerCase().includes(w), `LOCALIZE mentions "${w}"`);
  assert.throws(() => L.loadPrompts("no markers"), /not found/);
});

test("[P3] reviewers are RDT v1's three; the seed is the registered one", () => {
  assert.deepEqual(L.REVIEWERS.map((r) => r.label), ["GPT-4o", "Grok", "DeepSeek"]);
  assert.equal(L.SIGNFLIP_SEED, parseInt(createHash("sha256").update("rdt-l-v1|signflip").digest("hex").slice(0, 8), 16));
});

test("[P4] parsing: a verdict is required; the descriptive string rules", () => {
  assert.equal(L.parseReview("L", { loses_most: "Grok" }), null);
  assert.deepEqual(L.parseReview("L", { verdict: "Refute", loses_most: " Grok ", trigger_scenario: "x" }), { verdict: "refute", loses_most: "Grok", load_bearing_premise: null, trigger_scenario: "x", reasoning: null });
  assert.equal(L.parseReview("B", { verdict: "ratify_and_extend" }).verdict, "ratify_and_extend");
  assert.ok(L.saysNeither("Neither — both keep their premises") && !L.saysNeither("Grok, though neither fully"));
  for (const s of ["None exists", "no such scenario", "There is no observable case"]) assert.ok(L.saysNoScenario(s), s);
  assert.ok(!L.saysNoScenario("A panel that finds none of the cases"));
});

// pairs from a compact spec: rows[r] = [B_S, B_F, L_S, L_F] ratify flags for the three reviewers
function mk(spec, flaw = "FLAT") {
  const v = (x) => ({ verdict: x ? "ratify_and_extend" : "challenge_premise" });
  return spec.map((rows, i) => ({ index: i + 1, flaw, reviews: Object.fromEntries(L.REVIEWERS.map((r, k) => [r.label, { B: { S: v(rows[k][0]), F: v(rows[k][1]) }, L: { S: v(rows[k][2]), F: v(rows[k][3]) } }])) }));
}
const FAST = { B: 4000 };
const rep = (n, rows) => Array.from({ length: n }, () => rows);

test("[A1] decision table rows, in registered order", () => {
  // B: ratify everything; L: ratify sound, reject twins → W = 1
  assert.equal(L.analyze(mk(rep(22, [[1, 1, 1, 0], [1, 1, 1, 0], [1, 1, 1, 0]])), L.REVIEWERS, FAST).verdict, "supported_as_tested");
  // no change → refuted
  assert.equal(L.analyze(mk(rep(22, [[1, 1, 1, 1], [1, 0, 1, 0], [0, 0, 0, 0]])), L.REVIEWERS, FAST).verdict, "refuted_as_tested");
  // widening only by rejecting sound ones too: L ratifies nothing sound… W must still be ≥ 0.05 to reach the guard row
  const reject = mk(rep(22, [[1, 1, 0, 0], [1, 1, 1, 0], [1, 1, 0, 0]])); // D_B 0, D_L 1/3, sound L 1/3 < 0.5
  const a = L.analyze(reject, L.REVIEWERS, FAST);
  assert.equal(a.guard.holds, false);
  assert.equal(a.verdict, "not_supported_widening_by_rejection");
  // small widening → inconclusive
  const small = mk(Array.from({ length: 22 }, (_, i) => (i % 3 === 0 ? [[1, 1, 1, 0], [1, 1, 1, 1], [1, 1, 1, 1]] : [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]))); // W = 8/66 ≈ 0.12
  assert.equal(L.analyze(small, L.REVIEWERS, FAST).verdict, "not_supported_inconclusive");
});

test("[A2] the guard: sound approval under L ≥ 0.5 and within 25 points of B", () => {
  const g = (rows) => L.analyze(mk(rep(10, rows)), L.REVIEWERS, FAST).guard;
  assert.equal(g([[1, 1, 1, 0], [1, 1, 1, 0], [1, 1, 1, 0]]).holds, true, "sound 100% under both arms");
  assert.equal(g([[1, 1, 1, 0], [1, 1, 1, 0], [1, 1, 0, 0]]).holds, false, "B 100%, L 67%: more than 25 points below B");
  assert.equal(g([[0, 0, 1, 0], [1, 0, 1, 0], [0, 0, 0, 0]]).holds, true, "B 33%, L 67%: above half and above B");
  assert.equal(g([[1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]]).holds, false, "L 33%: below half even though it matches B");
});

test("[A3] a reviewer missing more than 20% of its observations is dropped; per-reviewer W is reported", () => {
  const pairs = mk(rep(10, [[1, 1, 1, 0], [1, 0, 1, 0], [0, 0, 0, 0]]));
  for (const p of pairs.slice(0, 3)) p.reviews.Grok.L.F = { verdict: null, missing: "unparseable" };
  const a = L.analyze(pairs, L.REVIEWERS, FAST);
  assert.equal(a.reviewers.Grok.dropped, true);
  assert.deepEqual(a.reviewers_used, ["GPT-4o", "DeepSeek"]);
  assert.equal(a.descriptive.by_reviewer["GPT-4o"].W, 1);
  assert.equal(a.descriptive.by_reviewer.DeepSeek.W, 0);
});

test("[A4] descriptives: B-vs-RDT v1 agreement, 'neither' and 'no scenario' shares", () => {
  const pairs = mk(rep(2, [[1, 1, 1, 0], [1, 1, 1, 0], [1, 1, 1, 0]]));
  for (const p of pairs) {
    p.v1_verdicts = { "GPT-4o": { S: "ratify_and_extend", F: "ratify_and_extend" }, Grok: { S: "refute", F: "ratify_and_extend" }, DeepSeek: { S: null, F: null } };
    for (const r of L.REVIEWERS) { p.reviews[r.label].L.S.loses_most = "neither"; p.reviews[r.label].L.F.loses_most = "Grok"; p.reviews[r.label].L.F.trigger_scenario = "none exists"; }
  }
  const d = L.analyze(pairs, L.REVIEWERS, FAST).descriptive;
  assert.deepEqual(d.b_vs_rdt_v1_agreement, { n: 8, rate: 0.75 });
  assert.equal(d.loses_most_neither.S.share, 1);
  assert.equal(d.loses_most_neither.F.share, 0);
  assert.equal(d.no_trigger_scenario.F.share, 1);
});

const run = (args) => spawnSync(process.execPath, [join(ROOT, "scripts/localization-test.mjs"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH }, cwd: ROOT });

test("[E1] --stub runs both arms on real RDT v1 material; the stub's B rubber-stamp and L discrimination come out as W = 1", () => {
  const out = mkdtempSync(join(tmpdir(), "rdtl-test-"));
  try {
    const r = run(["--stub", "--pairs", "5", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    const f = readdirSync(out).find((x) => /^stub-.*Z\.json$/.test(x));
    const data = JSON.parse(readFileSync(join(out, f), "utf8"));
    assert.deepEqual(data.pairs.map((p) => p.index), L.TEST_PAIRS.slice(0, 5));
    for (const p of data.pairs) for (const rv of L.REVIEWERS) for (const a of L.ARMS) for (const d of ["S", "F"]) assert.ok(p.reviews[rv.label][a][d].verdict, `${p.index} ${rv.label} ${a} ${d}`);
    const a = JSON.parse(readFileSync(join(out, f.replace(/\.json$/, ".analysis.json")), "utf8")).analysis;
    assert.equal(a.primary.W, 1);
    assert.equal(a.descriptive.flaw_named.L.rate, 1);
    assert.equal(a.descriptive.flaw_named.B.rate, 0);
    assert.ok(data.pairs[0].v1_verdicts["GPT-4o"].F, "RDT v1 verdicts carried for the agreement figure");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("[E2] --plan estimates under $3 without calling anything; live modes refuse without --yes or keys", () => {
  const p = run(["--plan"]);
  assert.equal(p.status, 0, p.stderr);
  const est = JSON.parse(p.stdout);
  assert.equal(est.pairs, 22);
  assert.ok(est.estimate_usd > 0 && est.estimate_usd < 3, `§7 expects under $3, got ${est.estimate_usd}`);
  for (const m of ["--smoke", "--main"]) { const r = run([m]); assert.equal(r.status, 2); assert.match(r.stderr, /--yes/); }
  assert.equal(run(["--smoke", "--yes"]).status, 1, "no keys: refuses before any call");
});
