// Inheritance Study 001 — analysis tests: statistics, verdict rules, null/negative reporting, the ratchet checklist,
// missingness, identity drift, and byte-for-byte reproducibility. HERMETIC, $0.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-analysis.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clusterBootstrap, signFlipTest, holm, slope, trendBootstrap, simulatePower } from "./inheritance-001/lib/stats.mjs";
import { analyze } from "./inheritance-001/lib/analyze.mjs";
import { renderReport } from "./inheritance-001/lib/report.mjs";
import { runDemo, summarizeDir } from "./inheritance-001/lib/pipeline.mjs";
import { verifyRunDir } from "./inheritance-001/lib/store.mjs";
import { ARMS } from "./inheritance-001/lib/context.mjs";

// ── [N] statistics ──────────────────────────────────────────────────────────────────────────────────────────────────
test("[N1] cluster bootstrap is seeded and family-weighted; sign-flip is exact for small n; Holm and slope are right", () => {
  const clusters = new Map([["a", [1, 1, 1, 1]], ["b", [0]], ["c", [1, 0]], ["d", [0, 0, 1]]]);
  const r1 = clusterBootstrap(clusters, { resamples: 500, seed: 3 }), r2 = clusterBootstrap(clusters, { resamples: 500, seed: 3 });
  assert.deepEqual(r1, r2);
  assert.equal(r1.estimate, +((1 + 0 + 0.5 + 1 / 3) / 4).toFixed(4), "each family weighs the same");
  assert.ok(r1.ci_low <= r1.estimate && r1.estimate <= r1.ci_high);
  assert.equal(clusterBootstrap(new Map([["a", [1]]])).ci_low, null, "one cluster: no interval");
  assert.equal(signFlipTest([1, 1, 1, 1]).p, 0.125, "2 of 16 sign patterns are as extreme");
  assert.equal(signFlipTest([0.5]).p, null);
  assert.deepEqual(holm([{ id: "a", p: 0.01 }, { id: "b", p: 0.04 }, { id: "c", p: 0.03 }]).map((x) => x.p_holm), [0.03, 0.06, 0.06]);
  assert.equal(slope([1, 2, 3], [0, 0.1, 0.2]).toFixed(6), "0.100000");
  const tb = trendBootstrap(new Map([["f1", new Map([[1, [0]], [2, [0.5]], [3, [1]]])], ["f2", new Map([[1, [0]], [2, [0.5]], [3, [1]]])]]), [1, 2, 3], { resamples: 200 });
  assert.equal(tb.slope, 0.5);
});

test("[N2] parametric power: no effect → about 5% two-sided positives at most; a big effect at many families → high power", () => {
  const nul = simulatePower({ families: 16, tasksPerFamily: 3, consumers: 2, baseRate: 0.4, effect: 0, sims: 200, resamples: 200 });
  assert.ok(nul.power <= 0.08, JSON.stringify(nul));
  const big = simulatePower({ families: 32, tasksPerFamily: 3, consumers: 2, baseRate: 0.4, effect: 0.25, sims: 100, resamples: 200 });
  assert.ok(big.power >= 0.9, JSON.stringify(big));
});

// ── synthetic trial sets for the verdict rules ──────────────────────────────────────────────────────────────────────
function trialSet({ families = 12, perFamily = 2, gens = [1], scores, outcome = () => "pass", consumerFamily = () => "mock-alpha" }) {
  const trials = [];
  for (const g of gens) for (let f = 0; f < families; f++) for (let k = 0; k < perFamily; k++) {
    const block = `B-g${g}-f${f}-k${k}`;
    for (const arm of ARMS) {
      const s = scores(arm, f, k, g);
      trials.push({ id: `${block}-${arm}`, block_id: block, generation: g, task_family_id: `F${f}`, eval_split: "anchor", arm, variant: "full", score: s, outcome: s === null ? outcome(arm, f, k) : s ? "pass" : "fail", consumer: { family: consumerFamily(f, k), expected_family: "mock-alpha", model_id_returned: "mock-alpha-1" }, context: { producer_families: ["mock-gamma"], artifact_ids: [], tokens_est: 100 }, call: { usage: { in: 100, out: 10 }, cost_usd: 0, cost_status: "mock-zero" }, budget: { aplus_matching: arm === "A+" ? { extra: 50 } : null } });
    }
  }
  return trials;
}
const studyRecord = ({ simulation = true, registered = false } = {}) => ({ id: "IS1-STUDY-TEST", simulation, preregistration: { status: registered ? "registered" : "draft_unregistered" }, config: { main_domain: "str", analysis: { resamples: 400, alpha: 0.05, seed: 1, min_clusters_for_inference: 10, timeouts_as_failures: true } } });
const run = (trials, study = studyRecord()) => analyze({ study, plan: { plan_sha256: "p" }, trials, snapshots: [], artifacts: [], evaluations: [], runs: [{ id: "IS1-RUN-x", counters: { leak_blocked: 0 }, spend: { usd: 0 } }] }).report;
const cWins = (arm) => (arm === "C" ? 1 : 0);

test("[N3] a clear C win is 'supported' ONLY for a registered, non-simulated study with enough families", () => {
  const trials = trialSet({ scores: cWins });
  const sim = run(trials);
  assert.equal(sim.hypotheses[0].classification, "positive");
  assert.match(sim.hypotheses[0].verdict, /^not-assessable \(simulation\)/);
  const unreg = run(trials, studyRecord({ simulation: false }));
  assert.match(unreg.hypotheses[0].verdict, /not-assessable \(unregistered/);
  const simRegistered = run(trials, studyRecord({ simulation: true, registered: true }));
  assert.match(simRegistered.hypotheses[0].verdict, /^not-assessable \(simulation\)/, "a simulation is never 'supported', registered or not");
  const real = run(trials, studyRecord({ simulation: false, registered: true }));
  assert.equal(real.hypotheses[0].verdict, "supported");
  assert.ok(real.hypotheses[0].p_holm < 0.05);
  const few = run(trialSet({ families: 6, scores: cWins }), studyRecord({ simulation: false, registered: true }));
  assert.match(few.hypotheses[0].verdict, /underpowered/, "6 families < preregistered minimum of 10");
});

test("[N4] null and negative results are reported plainly, never rounded into a win", () => {
  const nul = run(trialSet({ scores: (arm, f, k) => ((f + k) % 2) }), studyRecord({ simulation: false, registered: true }));
  assert.equal(nul.primary.classification, "null-or-inconclusive");
  assert.ok(nul.flags.some((x) => x.code === "NO_CLEAR_INHERITANCE_BENEFIT"));
  assert.equal(nul.hypotheses[0].verdict, "not supported");
  const neg = run(trialSet({ scores: (arm) => (arm === "C" ? 0 : 1) }), studyRecord({ simulation: false, registered: true }));
  assert.equal(neg.primary.classification, "negative");
  assert.ok(neg.flags.some((x) => x.code === "INHERITANCE_WORSE_THAN_COMPUTE"));
  assert.match(neg.hypotheses[0].verdict, /contradicted/);
  const scaffold = run(trialSet({ scores: (arm) => (["C", "E", "B", "D"].includes(arm) ? 1 : 0) }));
  assert.ok(scaffold.flags.some((x) => x.code === "SCAFFOLDING_NOT_EXCLUDED"));
  assert.ok(scaffold.flags.some((x) => x.code === "PLACEBO_HELPS"));
  assert.ok(scaffold.flags.some((x) => x.code === "CURATION_NOT_SHOWN"));
  assert.ok(scaffold.flags.some((x) => x.code === "CONTAMINATED_ARM_HELPED"));
});

// A world where EVERY ratchet criterion genuinely holds: 4 generations (3 transitions), C − A+ rising g/4 in every
// family, one ablated artifact that matters, verification steady across producer generations.
function ratchetData({ withAblation = true } = {}) {
  const ART = "IS1-ART-g0-aaaaaaaaaaaa";
  const trials = trialSet({ gens: [1, 2, 3, 4], perFamily: 4, scores: (arm, f, k, g) => (arm === "C" ? (k < g ? 1 : 0) : 0) })
    .map((t) => (t.arm === "C" ? { ...t, context: { ...t.context, artifact_ids: [ART] } } : t));
  if (withAblation) for (const t of trials.filter((x) => x.arm === "C" && x.generation === 1)) trials.push({ ...t, id: `${t.id}-minus`, variant: `minus:${ART}`, score: 0, outcome: "fail" });
  const artifacts = [0, 1, 2].flatMap((g) => [0, 1].map((i) => ({ id: `IS1-ART-g${g}-00000000000${i}`, kind: "producer_output", domain: "str", generation: g, production: { tokens_in: 10, tokens_out: 5, usd: 0 } })));
  const evaluations = artifacts.map((a) => ({ artifact_id: a.id, status: "passed", cost: { interpreter_steps: 1, cpu_ms: 0, cpu_ms_measured: false, model_tokens_in: 0, model_tokens_out: 0, human_minutes: 0 } }));
  return { trials, artifacts, evaluations };
}
const runFull = ({ trials, artifacts, evaluations }, study) => analyze({ study, plan: { plan_sha256: "p" }, trials, snapshots: [], artifacts, evaluations, runs: [{ id: "IS1-RUN-x", counters: { leak_blocked: 0 }, spend: { usd: 0 } }] }).report;

test("[N5a] the ratchet checklist CAN pass — when all six criteria hold in a registered, non-simulated study", () => {
  const r = runFull(ratchetData(), studyRecord({ simulation: false, registered: true }));
  assert.deepEqual(r.ratchet.checklist.filter((c) => !c.met).map((c) => c.id), []);
  assert.equal(r.ratchet.claim_permitted, true);
  const sim = runFull(ratchetData(), studyRecord({ simulation: true, registered: true }));
  assert.equal(sim.ratchet.claim_permitted, false, "the same data in a simulation: no claim");
  const noAblation = runFull(ratchetData({ withAblation: false }), studyRecord({ simulation: false, registered: true }));
  assert.equal(noAblation.ratchet.claim_permitted, false, "five of six is not enough");
  assert.deepEqual(noAblation.ratchet.checklist.filter((c) => !c.met).map((c) => c.id), ["iv"]);
});

test("[N5] the ratchet is never certified from a rising line: <3 transitions, or a simulation, means no claim", () => {
  const rising = trialSet({ gens: [1, 2, 3], scores: (arm, f, k, g) => (arm === "C" ? (k < g - 1 || g === 3 ? 1 : 0) : 0) });
  const r = run(rising, studyRecord({ simulation: false, registered: true }));
  assert.ok(r.ratchet.anchor_trend.slope > 0, "the line does rise");
  assert.equal(r.ratchet.claim_permitted, false);
  assert.equal(r.ratchet.checklist.find((c) => c.id === "ii").met, false, "2 transitions < 3");
  assert.equal(r.ratchet.checklist.find((c) => c.id === "iv").met, false, "no ablation evidence");
  const sim = run(trialSet({ gens: [1, 2, 3, 4], scores: cWins }));
  assert.equal(sim.ratchet.claim_permitted, false);
  assert.match(sim.ratchet.reason, /simulation/);
});

test("[N6] missingness: errors are excluded pairwise and bounded; timeouts score 0; abstentions score 0", () => {
  const trials = trialSet({ scores: (arm, f, k) => (arm === "C" && f < 3 && k === 0 ? null : cWins(arm)), outcome: () => "error" });
  const r = run(trials);
  assert.equal(r.primary.missing_pairs, 3);
  assert.equal(r.missingness.incomplete_blocks, 0);
  assert.ok(r.missingness.primary_bounds.worst_case_for_C.estimate < r.primary.estimate);
  assert.ok(r.missingness.primary_bounds.best_case_for_C.estimate >= r.primary.estimate);
  assert.throws(() => run([...trials, { ...trials[0] }]), /DUPLICATE_TRIAL_IN_BLOCK/);
});

test("[N7] identity drift: blocks whose returned family differs from the request are excluded from H3 and flagged", () => {
  const r = run(trialSet({ scores: cWins, consumerFamily: (f) => (f < 4 ? "mock-gamma" : "mock-alpha") }));
  assert.equal(r.identity.returned_family_differs_from_expected, 4 * 2 * 6);
  assert.ok(r.flags.some((x) => x.code === "IDENTITY_DRIFT"));
  const h1 = r.hypotheses.find((h) => h.id === "H1"), h3 = r.hypotheses.find((h) => h.id === "H3");
  assert.equal(h3.n_pairs, h1.n_pairs - 8);
});

// ── [E] end to end ──────────────────────────────────────────────────────────────────────────────────────────────────
test("[E1] the offline demo is byte-for-byte reproducible, and the report regenerates identically from the records", async () => {
  const a = mkdtempSync(join(tmpdir(), "is1-a-")), b = mkdtempSync(join(tmpdir(), "is1-b-"));
  try {
    await runDemo({ world: "positive-shared", outDir: a, resamples: 300 });
    await runDemo({ world: "positive-shared", outDir: b, resamples: 300 });
    const files = readdirSync(a).filter((f) => f.includes("."));
    for (const f of ["plan.json", "snapshot.json", "trials.jsonl", "summary.json", "REPORT.md", "events.ndjson", "artifacts.jsonl"]) assert.ok(files.includes(f), f);
    for (const f of files) assert.equal(readFileSync(join(a, f), "utf8"), readFileSync(join(b, f), "utf8"), f);
    const before = readFileSync(join(a, "summary.json"), "utf8");
    summarizeDir(a);
    assert.equal(readFileSync(join(a, "summary.json"), "utf8"), before, "re-derivation is identical");
    assert.equal(verifyRunDir(a).ok, true);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test("[E2] tampering with any exported record or the plan is caught by verify", async () => {
  const d = mkdtempSync(join(tmpdir(), "is1-t-"));
  try {
    await runDemo({ world: "inert", outDir: d, resamples: 100 });
    const { writeFileSync } = await import("node:fs");
    const f = join(d, "trials.jsonl");
    const lines = readFileSync(f, "utf8").split("\n");
    const t = JSON.parse(lines[0]); t.score = t.score === 1 ? 0 : 1; lines[0] = JSON.stringify(t);
    writeFileSync(f, lines.join("\n"));
    const v = verifyRunDir(d);
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => /altered/.test(p)));
    const p = join(d, "plan.json");
    writeFileSync(p, readFileSync(p, "utf8").replace('"poison_fraction": 0.34', '"poison_fraction": 0.1'));
    assert.ok(verifyRunDir(d).problems.some((x) => /plan\.json differs/.test(x)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("[E3] the instrument reads known worlds the right way round (fixed seed): harm is negative, help beats placebo", async () => {
  const d1 = mkdtempSync(join(tmpdir(), "is1-h-")), d2 = mkdtempSync(join(tmpdir(), "is1-p-"));
  try {
    const harmful = (await runDemo({ world: "harmful-anchoring", outDir: d1, resamples: 300 })).report;
    assert.equal(harmful.primary.classification, "negative");
    assert.ok(harmful.flags.some((f) => f.code === "INHERITANCE_WORSE_THAN_COMPUTE"));
    const positive = (await runDemo({ world: "positive-shared", outDir: d2, resamples: 300 })).report;
    assert.equal(positive.contrasts.pooled["C-E"].classification, "positive");
    assert.equal(positive.contrasts.pooled["C-A"].classification, "positive");
    assert.equal(positive.contrasts.pooled["C-D"].classification, "positive", "the contamination arm costs C");
    assert.equal(positive.ratchet.claim_permitted, false);
  } finally { rmSync(d1, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true }); }
});

test("[E4] identity drift in a real run: a consumer returning another family's id is recorded and excluded from H3", async () => {
  const d = mkdtempSync(join(tmpdir(), "is1-i-"));
  try {
    const { report, result } = await runDemo({ world: "inert", outDir: d, resamples: 100, consumerOverrides: { "mock-beta-1": { model_id_returned: "mock-gamma-7" } } });
    const drifted = result.store.list("trial").filter((t) => t.consumer.model_id_requested === "mock-beta-1");
    assert.ok(drifted.every((t) => t.consumer.family === "mock-gamma" && t.consumer.expected_family === "mock-beta"));
    assert.ok(report.flags.some((f) => f.code === "IDENTITY_DRIFT"));
    assert.ok(report.hypotheses.find((h) => h.id === "H3").n_pairs < report.hypotheses.find((h) => h.id === "H1").n_pairs);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("[E5] the report keeps facts, mock results, implemented behaviour and speculation apart, and says NOT EVIDENCE", async () => {
  const d = mkdtempSync(join(tmpdir(), "is1-r-"));
  try {
    await runDemo({ world: "inert", outDir: d, resamples: 100 });
    const md = readFileSync(join(d, "REPORT.md"), "utf8");
    for (const h of ["NOT EVIDENCE", "## 1. Facts about this run", "## 2. Mock results (synthetic, NOT evidence)", "## 3. Behaviour the code implements", "## 4. Not shown, and speculative", "Claim permitted: no"]) assert.ok(md.includes(h), h);
    assert.ok(!/\bproves?\b|\bdemonstrates that (models|intelligence)/i.test(md), "no success language");
    const s = JSON.parse(readFileSync(join(d, "summary.json"), "utf8"));
    assert.equal(s.simulation, true);
    assert.equal(s.status, "offline_simulation");
    assert.equal(renderReport({ report: s, plan: JSON.parse(readFileSync(join(d, "plan.json"), "utf8")), run: JSON.parse(readFileSync(join(d, "runs.json"), "utf8"))[0] }), md);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
