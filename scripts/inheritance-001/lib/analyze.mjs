// Inheritance study 001 — the preregistered analysis. Reads ONLY sealed records (trials, snapshots, artifacts,
// evaluations, the plan) and returns a derived report record; it never edits an input. Same inputs → same bytes.
//
// What it will NOT do: call a model, read a model's opinion of itself, round a null into a win, or certify a ratchet
// from a rising line. A simulation is labelled a simulation at every level of the output.
import { schemaVersion, seal, sha256, hexId, canonicalJSON } from "./canon.mjs";
import { ARMS } from "./context.mjs";
import { clusterBootstrap, signFlipTest, holm, trendBootstrap, classify, mean } from "./stats.mjs";

export const CONTRASTS = [
  ["C", "A+", "primary: verified inheritance vs compute-matched"],
  ["C", "A", "verified inheritance vs cold"],
  ["C", "B", "curation: verified vs raw history"],
  ["C", "D", "contamination cost (C minus contaminated)"],
  ["C", "E", "knowledge vs scaffolding (placebo)"],
  ["A+", "A", "does extra reasoning allowance help?"],
  ["B", "A+", "raw history vs compute-matched"],
  ["D", "A+", "contaminated vs compute-matched"],
  ["E", "A+", "placebo vs compute-matched"],
  ["E", "A", "placebo vs cold (format/scaffolding effect)"],
];

const r4 = (x) => (x === null || x === undefined ? null : +(+x).toFixed(4));

// Score used in analysis: pass=1; fail/abstain=0; timeout=0 (preregistered); error/leak-blocked = missing.
const scoreOf = (t) => (t && (t.score === 0 || t.score === 1) ? t.score : null);

function blocksOf(trials, variant = "full") {
  const m = new Map();
  for (const t of trials) {
    if (t.variant !== variant) continue;
    const b = m.get(t.block_id) || { block_id: t.block_id, generation: t.generation, family: t.task_family_id, split: t.eval_split, consumer: t.consumer, arms: {} };
    if (b.arms[t.arm]) throw new Error(`DUPLICATE_TRIAL_IN_BLOCK ${t.block_id}/${t.arm}/${variant}`);
    b.arms[t.arm] = t;
    m.set(t.block_id, b);
  }
  return [...m.values()];
}

function contrast(blocks, a, b, opts, filter = () => true) {
  const clusters = new Map();
  let missing = 0;
  for (const bl of blocks.filter(filter)) {
    const x = scoreOf(bl.arms[a]), y = scoreOf(bl.arms[b]);
    if (x === null || y === null) { missing++; continue; }
    (clusters.get(bl.family) || clusters.set(bl.family, []).get(bl.family)).push(x - y);
  }
  const ci = clusterBootstrap(clusters, opts);
  const famMeans = [...clusters.keys()].sort().map((k) => mean(clusters.get(k)));
  const test = signFlipTest(famMeans, { seed: opts.seed });
  return { contrast: `${a}-${b}`, ...ci, p_two_sided: test.p, test: test.method, missing_pairs: missing, classification: classify(ci) };
}

// Worst/best case for the primary contrast: a missing C counts 0 and a missing A+ counts 1 (worst for C), and the reverse.
function missingnessBounds(blocks, opts) {
  const run = (cFill, aFill) => {
    const clusters = new Map();
    for (const bl of blocks) {
      const c = scoreOf(bl.arms.C), a = scoreOf(bl.arms["A+"]);
      if (c === null && a === null && !bl.arms.C && !bl.arms["A+"]) continue;
      const d = (c ?? cFill) - (a ?? aFill);
      (clusters.get(bl.family) || clusters.set(bl.family, []).get(bl.family)).push(d);
    }
    return clusterBootstrap(clusters, opts);
  };
  return { worst_case_for_C: run(0, 1), best_case_for_C: run(1, 0) };
}

export function analyze({ study, plan, trials, snapshots, artifacts, evaluations, runs }) {
  const cfg = study.config || study;
  const studyId = study.id || study.study_id;
  const A = cfg.analysis;
  const opts = { resamples: A.resamples, alpha: A.alpha, seed: A.seed };
  const full = trials.filter((t) => t.variant === "full");
  const blocks = blocksOf(trials);
  const gens = [...new Set(blocks.map((b) => b.generation))].sort((a, b) => a - b);
  const simulation = Boolean(study.simulation);

  // ── data quality (facts about this run) ───────────────────────────────────────────────────────────────────────────
  const outcomeCounts = Object.fromEntries(ARMS.map((arm) => [arm, full.filter((t) => t.arm === arm).reduce((o, t) => ({ ...o, [t.outcome]: (o[t.outcome] || 0) + 1 }), {})]));
  const identity = {
    trials_with_returned_id: full.filter((t) => t.consumer.model_id_returned).length,
    returned_family_differs_from_expected: full.filter((t) => t.consumer.family && t.consumer.family !== t.consumer.expected_family).length,
    unknown_returned_family: full.filter((t) => t.consumer.family === "unknown").length,
  };
  const incomplete = blocks.filter((b) => ARMS.some((arm) => !b.arms[arm])).length;

  // ── per-generation and pooled contrasts ───────────────────────────────────────────────────────────────────────────
  const scopes = [["pooled", () => true], ...gens.map((g) => [`g${g}`, (b) => b.generation === g])];
  const contrasts = {};
  for (const [name, f] of scopes) {
    contrasts[name] = {};
    for (const [a, b, label] of CONTRASTS) contrasts[name][`${a}-${b}`] = { label, ...contrast(blocks, a, b, opts, f) };
  }
  const Gn = gens.map((g) => ({ generation: g, ...contrasts[`g${g}`]["C-A+"], anchor: contrast(blocks, "C", "A+", opts, (b) => b.generation === g && b.split === "anchor"), fresh_families: contrast(blocks, "C", "A+", opts, (b) => b.generation === g && b.split === "generation") }));

  // ── preregistered hypotheses (H1–H3 primary family, Holm) ─────────────────────────────────────────────────────────
  const crossFamilyVerified = (b) => {
    const c = b.arms.C;
    return c && c.consumer.family && c.consumer.family !== "unknown" && c.consumer.family === c.consumer.expected_family && !(c.context.producer_families || []).includes(c.consumer.family);
  };
  const H = [
    { id: "H1", text: "C outperforms A+ on held-out families", ...contrast(blocks, "C", "A+", opts) },
    { id: "H2", text: "C outperforms the unrelated placebo E", ...contrast(blocks, "C", "E", opts) },
    { id: "H3", text: "C outperforms A+ when producer and consumer families differ by PROVIDER-RETURNED ids (identity-mismatched blocks excluded)", ...contrast(blocks, "C", "A+", opts, crossFamilyVerified) },
  ];
  const adj = holm(H.map((h) => ({ id: h.id, p: h.p_two_sided })));
  const descriptiveOnly = simulation || study.preregistration?.status !== "registered" || H[0].n_clusters < A.min_clusters_for_inference;
  const hypotheses = H.map((h) => {
    const p_holm = adj.find((x) => x.id === h.id).p_holm;
    const supportedByRule = h.classification === "positive" && p_holm !== null && p_holm < A.alpha;
    return { ...h, p_holm, inference: descriptiveOnly ? "descriptive-only" : "confirmatory", verdict: descriptiveOnly ? `not-assessable (${simulation ? "simulation" : "unregistered or underpowered"}); pattern: ${h.classification}` : supportedByRule ? "supported" : h.classification === "negative" ? "contradicted (effect in the opposite direction)" : "not supported" };
  });
  hypotheses.push({ id: "H4", text: "exploratory: transfer varies with verification cost", inference: "exploratory", verdict: "not assessable: one verification regime (cheap deterministic) in this study" });

  // ── flags: null, negative and alternative explanations, stated plainly ────────────────────────────────────────────
  const P = contrasts.pooled;
  const flags = [];
  const flag = (code, text) => flags.push({ code, text });
  if (P["C-A+"].classification === "negative") flag("INHERITANCE_WORSE_THAN_COMPUTE", "C scored below the compute-matched baseline A+.");
  if (P["C-A+"].classification === "null-or-inconclusive") flag("NO_CLEAR_INHERITANCE_BENEFIT", "The C−A+ interval includes 0.");
  if (P["C-E"].classification !== "positive") flag("SCAFFOLDING_NOT_EXCLUDED", "C is not clearly above the unrelated placebo E: format or confidence priming could explain any C gain.");
  if (P["E-A"].classification === "positive") flag("PLACEBO_HELPS", "The placebo beat the cold arm: a scaffolding/format effect is present.");
  if (P["C-B"].classification !== "positive") flag("CURATION_NOT_SHOWN", "Verified inheritance is not clearly above raw history B.");
  if (P["C-D"].classification === "positive") flag("CONTAMINATION_HARMS", "Replacing part of C with refuted/poisoned records lowered scores: the verification gate is load-bearing.");
  if (P["D-A+"].classification === "positive") flag("CONTAMINATED_ARM_HELPED", "D beat A+: check the poison design and the grader before trusting any comparison.");
  if (P["A+-A"].classification !== "positive") flag("EXTRA_ALLOWANCE_NOT_SHOWN_USEFUL", "A+ is not clearly above A; the compute match may not have bought real reasoning.");
  for (const g of Gn) if (g.classification === "negative") flag("NEGATIVE_GENERATION", `G(${g.generation}) interval is below 0.`);
  if (identity.returned_family_differs_from_expected) flag("IDENTITY_DRIFT", `${identity.returned_family_differs_from_expected} trials returned a model family other than the one requested; they are excluded from H3.`);
  if (runs.some((r) => r.counters.leak_blocked)) flag("LEAKS_BLOCKED", "Some contexts carried a sealed signature and were never sent; they count as missing.");

  // ── missingness ───────────────────────────────────────────────────────────────────────────────────────────────────
  const missingness = { incomplete_blocks: incomplete, outcome_counts: outcomeCounts, policy: { timeout: A.timeouts_as_failures ? "scored 0" : "missing", error: "missing (excluded pairwise)", abstain: "scored 0" }, primary_bounds: missingnessBounds(blocks, opts) };

  // ── ablations: C with artifact i withheld, same blocks ────────────────────────────────────────────────────────────
  const ablations = [];
  const fullC = new Map(full.filter((t) => t.arm === "C").map((t) => [t.block_id, t]));
  for (const v of [...new Set(trials.filter((t) => t.variant.startsWith("minus:")).map((t) => `${t.generation}|${t.variant}`))].sort()) {
    const [g, variant] = [Number(v.split("|")[0]), v.split("|")[1]];
    const clusters = new Map();
    let shown = 0;
    for (const t of trials.filter((x) => x.variant === variant && x.generation === g)) {
      const f = fullC.get(t.block_id);
      if (f && (f.context.artifact_ids || []).includes(variant.slice(6))) shown++;
      const a = scoreOf(f), b = scoreOf(t);
      if (a === null || b === null) continue;
      (clusters.get(t.task_family_id) || clusters.set(t.task_family_id, []).get(t.task_family_id)).push(a - b);
    }
    const ci = clusterBootstrap(clusters, opts);
    ablations.push(seal({
      schema_version: schemaVersion("ablation"),
      id: `IS1-ABL-${hexId({ g, variant }, 12)}`,
      study_id: studyId,
      generation: g,
      artifact_id: variant.slice(6),
      blocks_where_artifact_was_shown: shown,
      delta: ci,
      flag: shown === 0 ? "never-shown (budget/cross-family filter): no causal reading" : ci.estimate === null ? "no-data" : ci.ci_low !== null && ci.ci_low > 0 ? "positive" : ci.estimate <= 0 ? "nonpositive (flagged, not deleted)" : "inconclusive",
      note: "delta = C(full) − C(without this artifact) on the same blocks. Interactions between artifacts are not separated.",
    }));
  }

  // ── trend & the ratchet checklist ─────────────────────────────────────────────────────────────────────────────────
  const anchorByFamily = new Map();
  for (const b of blocks.filter((x) => x.split === "anchor")) {
    const c = scoreOf(b.arms.C), a = scoreOf(b.arms["A+"]);
    if (c === null || a === null) continue;
    const m = anchorByFamily.get(b.family) || anchorByFamily.set(b.family, new Map()).get(b.family);
    (m.get(b.generation) || m.set(b.generation, []).get(b.generation)).push(c - a);
  }
  const trend = trendBootstrap(anchorByFamily, gens, opts);
  const producerArtifacts = artifacts.filter((a) => a.kind === "producer_output" && a.domain === cfg.main_domain);
  const verification_by_generation = [...new Set(producerArtifacts.map((a) => a.generation))].sort().map((g) => {
    const xs = producerArtifacts.filter((a) => a.generation === g);
    const st = xs.map((a) => evaluations.find((e) => e.artifact_id === a.id)?.status || "none");
    const count = (s) => st.filter((x) => x === s).length;
    return { generation: g, produced: xs.length, passed: count("passed"), failed: count("failed"), inconclusive: count("inconclusive"), error: count("error"), verified_fraction: xs.length ? r4(count("passed") / xs.length) : null };
  });
  const vf = verification_by_generation.map((v) => v.verified_fraction).filter((x) => x !== null);
  const cRecords = full.filter((t) => t.arm === "C");
  const transitions = gens.length - 1;
  const checklist = [
    { id: "i", criterion: "positive C−A+ on held-out families after compute accounting", met: hypotheses[0].verdict === "supported" },
    { id: "ii", criterion: "uncertainty-adjusted positive trend over ≥3 transitions on the fixed anchor panel", met: transitions >= 3 && trend.ci_low !== null && trend.ci_low > 0, detail: `${transitions} transition(s); slope ${trend.slope} [${trend.ci_low}, ${trend.ci_high}]` },
    { id: "iii", criterion: "inherited records are independently checked and from other provider-returned families", met: cRecords.length > 0 && cRecords.every((t) => !(t.context.producer_families || []).includes(t.consumer.family)) },
    { id: "iv", criterion: "ablations identify contributions that matter (some delta interval > 0)", met: ablations.some((a) => a.delta.ci_low !== null && a.delta.ci_low > 0) },
    { id: "v", criterion: "verification does not degrade across generations", met: vf.length >= 2 ? vf.every((x, i) => i === 0 || x >= vf[i - 1] - 0.1) : false, detail: `verified fraction by generation: ${vf.join(", ") || "n/a"}` },
    { id: "vi", criterion: "full uncertainty and negative cases disclosed", met: true, detail: "this report lists every contrast, flag and missing pair" },
  ];
  const ratchet = { claim_permitted: !simulation && checklist.every((c) => c.met), reason: simulation ? "simulation: no claim about any intelligence can be made from mock outcomes" : checklist.filter((c) => !c.met).map((c) => c.id).join(", ") ? `unmet: ${checklist.filter((c) => !c.met).map((c) => c.id).join(", ")}` : "all criteria met", checklist, anchor_trend: trend, verification_by_generation, note: "A monotonic chart of G(n) alone never satisfies this checklist." };

  // ── cost ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const costByArm = Object.fromEntries(ARMS.map((arm) => {
    const ts = full.filter((t) => t.arm === arm);
    const usdKnown = ts.every((t) => t.call.cost_usd !== null);
    return [arm, { trials: ts.length, tokens_in: ts.reduce((s, t) => s + t.call.usage.in, 0), tokens_out: ts.reduce((s, t) => s + t.call.usage.out, 0), context_tokens_est: ts.reduce((s, t) => s + t.context.tokens_est, 0), usd: usdKnown ? r4(ts.reduce((s, t) => s + t.call.cost_usd, 0)) : null, cost_status: [...new Set(ts.map((t) => t.call.cost_status))].join("+") }];
  }));
  const curation = producerArtifacts.reduce((s, a) => ({ tokens_in: s.tokens_in + a.production.tokens_in, tokens_out: s.tokens_out + a.production.tokens_out, usd: s.usd === null || a.production.usd === null ? null : s.usd + a.production.usd }), { tokens_in: 0, tokens_out: 0, usd: 0 });
  const verificationCost = evaluations.reduce((s, e) => ({ evaluations: s.evaluations + 1, interpreter_steps: s.interpreter_steps + e.cost.interpreter_steps, cpu_ms: s.cpu_ms + e.cost.cpu_ms, model_tokens: s.model_tokens + e.cost.model_tokens_in + e.cost.model_tokens_out, human_minutes: s.human_minutes + e.cost.human_minutes }), { evaluations: 0, interpreter_steps: 0, cpu_ms: 0, model_tokens: 0, human_minutes: 0 });
  const cExtraTokens = costByArm.C.tokens_in - costByArm.A.tokens_in;
  const allPriced = Object.values(costByArm).every((c) => c.usd !== null);
  const cost = {
    by_arm: costByArm,
    curation,
    verification: { ...verificationCost, cpu_ms_measured: evaluations.some((e) => e.cost.cpu_ms_measured) },
    amortization: { consumer_trials_drawing_on_snapshots: cRecords.length, curation_tokens_per_C_trial: cRecords.length ? r4((curation.tokens_in + curation.tokens_out) / cRecords.length) : null, horizons_tokens_per_trial: Object.fromEntries([1, 10, 100, 1000].map((h) => [h, r4((curation.tokens_in + curation.tokens_out) / h)])) },
    matching: { method: "A+ allowance = (C context tokens − A context tokens) + amortized curation tokens, per block; token-for-token, so A+ is favoured in dollars (output > input price)", aplus_mean_extra_allowance: r4(mean(full.filter((t) => t.arm === "A+").map((t) => t.budget.aplus_matching?.extra || 0))) },
    slices: {
      fixed_inference_tokens: { C_minus_Aplus: P["C-A+"].estimate, note: "primary: A+ is matched in tokens by construction" },
      fixed_total_dollars: allPriced && !simulation ? { note: "computed from priced calls", C_usd: costByArm.C.usd, Aplus_usd: costByArm["A+"].usd } : { note: simulation ? "unavailable: mock calls cost $0 by definition" : "unavailable: some prices unknown — never treated as $0" },
    },
    value_per_1k_incremental_tokens: cExtraTokens > 0 && P["C-A+"].estimate !== null ? r4(P["C-A+"].estimate / ((cExtraTokens + curation.tokens_in + curation.tokens_out) / 1000)) : null,
  };

  const inputs = { plan_sha256: plan.plan_sha256, trials_sha256: sha256(trials.map((t) => t.sha256)), snapshots: snapshots.map((s) => ({ id: s.id, sha256: s.sha256 })), artifacts: artifacts.length, evaluations: evaluations.length, runs: runs.map((r) => r.id) };
  const body = {
    schema_version: schemaVersion("report"),
    study_id: studyId,
    status: simulation ? "offline_simulation" : study.preregistration?.status === "registered" ? "pilot_exploratory" : "unregistered",
    simulation,
    evidence_status: simulation ? "mock — mechanics only, NOT evidence about any model" : "exploratory until confirmatory replication",
    world: cfg.world_label ?? null,
    spend_usd: runs.reduce((s, r) => s + (r.spend?.usd || 0), 0),
    primary: { estimand: "G = mean over task families of mean paired (C − A+)", ...P["C-A+"] },
    G_by_generation: Gn,
    hypotheses,
    contrasts,
    flags,
    missingness,
    identity,
    ablations: ablations.map((a) => ({ id: a.id, generation: a.generation, artifact_id: a.artifact_id, blocks_where_artifact_was_shown: a.blocks_where_artifact_was_shown, delta: a.delta, flag: a.flag })),
    ratchet,
    cost,
    inputs,
    analysis_config: A,
  };
  return { report: seal({ ...body, id: `IS1-REPORT-${hexId(canonicalJSON(body), 12)}` }), ablations };
}
