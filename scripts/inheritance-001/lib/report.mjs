// Inheritance study 001 — REPORT.md, rendered ONLY from the sealed report record (+ plan and run for counts). No clock,
// no environment: the same summary gives the same bytes. Four kinds of statement are kept apart, as the protocol asks:
// facts about this run, mock (or measured) results, behaviour the code implements, and what remains speculative.
const f = (x, d = 3) => (x === null || x === undefined ? "—" : typeof x === "number" ? x.toFixed(d) : String(x));
const ci = (r) => (r.ci_low === null ? "no interval" : `[${f(r.ci_low)}, ${f(r.ci_high)}]`);

export const IMPLEMENTED = [
  ["Canonical hashing reuses the engine's sorted-keys-json/1; every record is sealed and write-once; the event log is hash-chained", "test-inheritance-001 [R*]"],
  ["Held-out families are validated: no evaluation family shares a template, op sequence or op set with any work family", "[P1]"],
  ["A snapshot holds strictly earlier generations only; same/future-generation work is excluded and listed", "[S1]"],
  ["Arm C needs an independent passing evaluation that is re-executed at freeze; curator admission alone never qualifies", "[S2] [I2]"],
  ["Forged, tampered or stale receipts, duplicate ids, bad parent links and causality violations stop the build", "[S3]–[S6]"],
  ["Contexts are built from public task views only; the context builder, adapters and mock never import the oracle or sealed data", "[X1] [X2]"],
  ["Every context is leak-scanned (canary, expected answer, hidden program) before it is sent; a hit is never sent", "[L1] [L2]"],
  ["All six arms share one frame; A+ gets C's extra context + amortized curation as reasoning allowance", "[C1]–[C4]"],
  ["Cross-family rule uses provider-returned model ids; identity drift is recorded and excluded from H3", "[C5] [N7] [E4]"],
  ["Paid calls refuse without approval file, registered preregistration, matching CLI caps, OMNARAI_LAB_LIVE=1 and known prices", "[M1]–[M4]"],
  ["Analysis: family-clustered bootstrap, sign-flip test, Holm on H1–H3, missingness bounds, ablations, ratchet checklist (which can pass, and refuses 5 of 6)", "test-inheritance-001-analysis [N1]–[N7] [N5a]"],
];

export function renderReport({ report, plan, run }) {
  const L = [];
  const sim = report.simulation;
  L.push(sim ? "# Inheritance Study 001: offline mechanics run (NOT EVIDENCE)" : "# Inheritance Study 001: run report");
  L.push("");
  L.push(`**Status:** ${report.status}. **Evidence status:** ${report.evidence_status}. **Spend:** $${f(report.spend_usd, 2)}.`);
  if (sim) L.push(`**World:** \`${report.world}\`. Every outcome below was produced by a deterministic mock search agent in a synthetic world whose parameters decide whether inheritance can help. The numbers test the INSTRUMENT, not any intelligence.`);
  L.push("");
  L.push("## 1. Facts about this run");
  L.push("");
  L.push(`- Study \`${plan.study_id}\`, plan \`${plan.plan_sha256.slice(0, 16)}…\`, run \`${run.id}\` (${run.kind}).`);
  L.push(`- Consumer generations: ${plan.generations_consumer.join(", ")}; ${plan.blocks.length} paired blocks × 6 arms; ${run.counters.ablation_trials} ablation trials; ${run.counters.producer_calls} producer calls (${run.counters.producer_failures} failed).`);
  L.push(`- Snapshots: ${report.inputs.snapshots.map((s) => `\`${s.id}\``).join(", ")}.`);
  L.push(`- Contexts blocked by the leak scan: ${run.counters.leak_blocked}. Trials whose returned model family differed from the requested one: ${report.identity.returned_family_differs_from_expected}.`);
  L.push(`- Incomplete blocks: ${report.missingness.incomplete_blocks}. Billable calls: ${run.spend.calls_billed}. Network calls: 0 (offline adapter${sim ? ", hermetic guard" : ""}).`);
  L.push("");
  L.push(`## 2. ${sim ? "Mock results (synthetic, NOT evidence)" : "Results"}`);
  L.push("");
  L.push(`Primary estimand: ${report.primary.estimand}. Unit of analysis: task family. Intervals: ${report.analysis_config.resamples}-resample family-cluster bootstrap, ${100 * (1 - report.analysis_config.alpha)}%.`);
  L.push("");
  L.push("| Generation | Families | Pairs | G(n) = C − A+ | Interval | Pattern |");
  L.push("|---|---:|---:|---:|---|---|");
  for (const g of report.G_by_generation) L.push(`| ${g.generation} | ${g.n_clusters} | ${g.n_pairs} | ${f(g.estimate)} | ${ci(g)} | ${g.classification} |`);
  L.push(`| pooled | ${report.primary.n_clusters} | ${report.primary.n_pairs} | ${f(report.primary.estimate)} | ${ci(report.primary)} | ${report.primary.classification} |`);
  L.push("");
  L.push("All contrasts (pooled):");
  L.push("");
  L.push("| Contrast | Meaning | Estimate | Interval | p (sign-flip) | Pattern |");
  L.push("|---|---|---:|---|---:|---|");
  for (const [k, c] of Object.entries(report.contrasts.pooled)) L.push(`| ${k} | ${c.label} | ${f(c.estimate)} | ${ci(c)} | ${f(c.p_two_sided, 4)} | ${c.classification} |`);
  L.push("");
  L.push("Preregistered hypotheses:");
  L.push("");
  L.push("| | Hypothesis | Estimate | Holm p | Verdict |");
  L.push("|---|---|---:|---:|---|");
  for (const h of report.hypotheses) L.push(`| ${h.id} | ${h.text} | ${f(h.estimate)} | ${f(h.p_holm, 4)} | ${h.verdict} |`);
  L.push("");
  L.push("Flags (null, negative and alternative explanations):");
  L.push("");
  if (!report.flags.length) L.push("- none raised");
  for (const x of report.flags) L.push(`- **${x.code}**: ${x.text}`);
  L.push("");
  const b = report.missingness.primary_bounds;
  L.push(`Missing-data bounds on C − A+: worst case for C ${f(b.worst_case_for_C.estimate)} ${ci(b.worst_case_for_C)}; best case ${f(b.best_case_for_C.estimate)} ${ci(b.best_case_for_C)}.`);
  L.push("");
  L.push("Ablations (C with one artifact withheld, same blocks):");
  L.push("");
  L.push("| Generation | Artifact | Shown in blocks | Δ = C − C₋ᵢ | Interval | Flag |");
  L.push("|---|---|---:|---:|---|---|");
  for (const a of report.ablations) L.push(`| ${a.generation} | \`${a.artifact_id}\` | ${a.blocks_where_artifact_was_shown} | ${f(a.delta.estimate)} | ${ci(a.delta)} | ${a.flag} |`);
  if (!report.ablations.length) L.push("| — | none planned | | | | |");
  L.push("");
  L.push("Ratchet checklist (all six must hold, outside a simulation, before any cumulative-improvement claim):");
  L.push("");
  for (const c of report.ratchet.checklist) L.push(`- (${c.id}) ${c.met ? "met" : "**not met**"}: ${c.criterion}${c.detail ? ` (${c.detail})` : ""}`);
  L.push(`- **Claim permitted: ${report.ratchet.claim_permitted ? "yes" : "no"}** (${report.ratchet.reason}).`);
  L.push("");
  const c = report.cost;
  L.push("Cost accounting:");
  L.push("");
  L.push("| Arm | Trials | Tokens in | Tokens out | USD | Cost status |");
  L.push("|---|---:|---:|---:|---:|---|");
  for (const [arm, x] of Object.entries(c.by_arm)) L.push(`| ${arm} | ${x.trials} | ${x.tokens_in} | ${x.tokens_out} | ${f(x.usd, 4)} | ${x.cost_status} |`);
  L.push("");
  L.push(`Curation (producer) tokens: ${c.curation.tokens_in} in / ${c.curation.tokens_out} out. Verification: ${c.verification.evaluations} evaluations, ${c.verification.interpreter_steps} interpreter steps, ${c.verification.model_tokens} model tokens, ${c.verification.human_minutes} human minutes (cpu time ${c.verification.cpu_ms_measured ? "measured" : "not measured in an offline run"}). Amortized curation per C trial: ${f(c.amortization.curation_tokens_per_C_trial, 1)} tokens. A+ mean extra allowance: ${f(c.matching.aplus_mean_extra_allowance, 1)} tokens. Fixed-dollar slice: ${c.slices.fixed_total_dollars.note}.`);
  L.push("");
  L.push("## 3. Behaviour the code implements (checked by tests, not by this run)");
  L.push("");
  for (const [what, where] of IMPLEMENTED) L.push(`- ${what}. (${where})`);
  L.push("");
  L.push("## 4. Not shown, and speculative");
  L.push("");
  L.push("- Whether any real model benefits from another model's verified work: untested. No live call has been made.");
  L.push("- Whether verification bounds the ratchet (the \"pawl\" hypothesis): untested; this study has one, cheap, verification regime.");
  L.push("- Whether program-induction transfer says anything about other domains: unknown; cross-domain scores are not comparable.");
  L.push("- Task difficulty calibration for real models: not done; ceiling or floor effects are possible until a calibration probe runs.");
  L.push("- Provider-returned ids are recorded as the provider sent them; that is API provenance, not proof of what weights ran.");
  L.push("");
  return L.join("\n") + "\n";
}
