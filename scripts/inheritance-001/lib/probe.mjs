// Inheritance study 001 — stage-0 calibration probes. Their ONLY job is to pitch task difficulty, the output cap and the
// per-call bounds before the sealed study is registered. They run arm A (cold) only, on PUBLIC calibration families drawn
// from a public seed, so nothing they touch can leak into the sealed set, and their results never enter the analysis.
//
// Each probe is frozen here as a config with its decision rule, committed before it runs; the probe reports which branch
// fired. A probe that has run is never edited: its config must keep reproducing the plan hash it ran under (tested).
//
//   IS1-PROBE-CAL-001  ran 2026-11-20: claude-sonnet-5-5 + grok-4.7, 3-step families. Its findings (Grok's reasoning is
//                      not bounded by max_tokens; timed-out calls went uncounted) led to probe 2.
//   IS1-PROBE-CAL-002  ran 2026-11-20: the capped pilot panel (two consumers, two producers), 4-step families on a NEW
//                      public seed, a 3000-token cap that each provider documents as bounding all billed output, 600 s.
//                      Its output-cap branch fired for gemini-4-carbon (the pilot raises that model's cap to 4500).
import { schemaVersion, sha256, hexId, rng, shuffled } from "./canon.mjs";
import { familyRecord, generateTasks, publicView } from "./tasks.mjs";
import { drawFamilySet, setKey } from "./families.mjs";
import { buildContext, buildProducerContext, SYSTEM_PROMPT } from "./context.mjs";
import { scoreOutput } from "./oracle.mjs";
import { callWithRetries } from "./adapters.mjs";
import { priceFor } from "./prices.mjs";
import { familyOfModelId } from "./identity.mjs";
import { capFor } from "./caps.mjs";
import { outputCapFor } from "./plan.mjs";
import { makeArtifact, validateArtifactSemantics } from "./artifacts.mjs";
import { verifyArtifact } from "./verify.mjs";

// ── Probe 1 (ran 2026-11-20). Frozen verbatim: changing anything below changes its plan hash d3fc3cc0… ─────────────────
export const DECISION_RULE_1 = {
  difficulty: [
    { when: "every consumer's arm-A pass rate >= 0.75", then: "too easy (ceiling): move the sealed draw to 4-step families and re-probe" },
    { when: "every consumer's arm-A pass rate <= 0.10", then: "too hard (floor): move the sealed draw to 2-step families and re-probe" },
    { when: "every consumer between 0.15 and 0.70", then: "keep 3-step families for the sealed draw" },
    { when: "anything else (consumers disagree, or a rate falls between bands)", then: "keep 3-step; report the asymmetry; xz decides before registration" },
  ],
  output_cap: { when: "more than 10% of calls stop at the output cap", then: "raise max_output_tokens to 4000 and re-project the pilot cost before asking for pilot approval" },
  note: "Probe tasks are public calibration tasks and are never reused in the sealed set. A pass rate here is not a result about inheritance.",
};
export const PROBE_1 = Object.freeze({
  id: "IS1-PROBE-CAL-001",
  seed: "calibration-probe-2026-11-20",
  status: "ran 2026-11-20 (results private)",
  plan_sha256: "d3fc3cc036c796de515324d1becfc4dbef102bd04293132a2f3bbfd256df8f9d",
  steps: 3,
  price_date: "2026-11-20",
  consumers: [
    { provider: "anthropic", model_id: "claude-sonnet-5-5", expected_family: "anthropic-claude" },
    { provider: "xai", model_id: "grok-4.7", expected_family: "xai-grok" },
  ],
  // the pilot params of 2026-11-20, as the probe read them then
  params: { context_budget_tokens: 1500, base_reasoning_tokens: 1024, poison_fraction: 0.34, max_output_tokens: 2000, expected_output_tokens: 700, aplus_amortized_allowance_tokens: 300, timeout_ms: 120000, max_attempts: 2 },
  decision_rule: DECISION_RULE_1,
});

// ── Probe 2 (ran 2026-11-20). Fixed before any call; frozen, it must keep reproducing plan 346b0cf3… ──────────────────────────────────────────────────────
// Bands are chosen so that 12 consumer calls leave no gap: 1/12 ≤ 0.10, 2/12 ≥ 0.15, 8/12 ≤ 0.70, 9/12 ≥ 0.75.
export const DECISION_RULE_2 = {
  difficulty: [
    { when: "every consumer's arm-A pass rate >= 0.75", then: "still too easy (ceiling): do not register; xz chooses 5-step families or 2 examples per task, then re-probe" },
    { when: "every consumer's arm-A pass rate <= 0.10", then: "too hard (floor): do not register; xz chooses 3-step families (near the ceiling in probe 1) or 4-step at higher effort, then re-probe" },
    { when: "every consumer between 0.15 and 0.70", then: "keep 4-step families for the sealed draw" },
    { when: "anything else (consumers disagree)", then: "keep 4-step; report the asymmetry; xz decides before registration" },
  ],
  producers: { when: "a producer passes 0 of its calibration calls", then: "its verified work in the pilot would be thin or empty: xz decides whether to keep it (C would rest on the other producer) or replace it before registration" },
  output_cap: { when: "for any model, more than 10% of its completed calls stop at the output cap", then: "raise max_output_tokens to 4500 for the pilot and re-project its cost before asking for pilot approval" },
  cap_enforcement: { when: "any completed call bills more output than the requested cap, a DeepSeek call reports reasoning tokens, or an OpenAI call reports more reasoning tokens than completion tokens", then: "that model's cap is not enforced as documented: set cap_enforced false in lib/caps.mjs (the live gate then refuses it) and replace it before the pilot" },
  latency: { when: "a model has more than one call time out at 600 s", then: "that model is unsuitable for the pilot as configured: xz decides" },
  identity: { when: "a provider returns a model id whose family differs from the expected family", then: "exclude that model from the pilot until explained" },
  parsing: { when: "a model completes a call without stopping at the cap but no answer text is parsed from it", then: "check the response parser against that provider's response before reading that model's pass rate (Gemini's Interactions API is beta)" },
  note: "Probe tasks are public calibration tasks, drawn from a seed never used before and excluded from the sealed draw. A pass rate here is not a result about inheritance.",
};
export const PROBE_2 = Object.freeze({
  id: "IS1-PROBE-CAL-002",
  seed: "calibration-probe-2-2026-11-20",
  status: "ran 2026-11-20 (results private)",
  plan_sha256: "346b0cf3e99724bc7e0cb5cfad387a79b7fb7c636a03b49f24facfa5cb4e5a3a",
  steps: 4,
  n_families: 4,
  tasks: { consumer_per_family: 3, producer_per_family: 1, examples: 3, checks: 8 },
  // 2026-12-01 prices are the higher ones (Gemini 4 Carbon doubles that day), so the worst case holds on either side of it.
  price_date: "2026-12-01",
  models: [
    { role: "consumer", provider: "anthropic", model_id: "claude-sonnet-5-5", expected_family: "anthropic-claude" },
    { role: "consumer", provider: "openai", model_id: "gpt-6.1-sol", expected_family: "openai-gpt" },
    { role: "producer", provider: "deepseek", model_id: "deepseek-v4-pro", expected_family: "deepseek" },
    { role: "producer", provider: "gemini", model_id: "gemini-4-carbon", expected_family: "google-gemini" },
  ],
  params: { context_budget_tokens: 1500, base_reasoning_tokens: 1024, poison_fraction: 0.34, max_output_tokens: 3000, timeout_ms: 600000 },
  decision_rule: DECISION_RULE_2,
});
// Registry of every probe (frozen ones and the proposed one); calibrationOpSets() reads all of them.
const PROBES_MUTABLE = { [PROBE_1.id]: PROBE_1, [PROBE_2.id]: PROBE_2 };
export const PROBES = PROBES_MUTABLE;
export const LATEST_PROBE_ID = PROBE_2.id;

const calibrationSpecs = (probe) => drawFamilySet({ seed: probe.seed, nWork: probe.n_families || 4, nAnchor: 0, nPlacebo: 0, steps: probe.steps, generations: 1 }).map((f, i) => ({ ...f, key: `cal${i}`, role: "calibration" }));
// Every calibration op set any probe uses: the sealed draw must never reuse one.
export function calibrationOpSets() {
  return new Set(Object.values(PROBES).flatMap((p) => calibrationSpecs(p).map((f) => setKey(f.steps.map((s) => s.op)))));
}

export function buildProbe({ probe = PROBES[LATEST_PROBE_ID] } = {}) {
  if (probe.kind === "producer") return buildProbe3(probe);
  return probe.id === PROBE_1.id ? buildProbe1() : buildProbe2(probe);
}

function buildProbe1() {
  const { consumers, params } = PROBE_1;
  const specs = calibrationSpecs(PROBE_1);
  const families = specs.map((spec) => ({ spec, record: familyRecord(spec, { studyId: PROBE_1.id, salt: "public-calibration" }) }));
  const tasks = families.flatMap(({ spec, record }) => generateTasks(spec, record, { seed: PROBE_1.seed, count: 4, examples: 3, checks: 8 }));
  const calls = shuffled(tasks.flatMap((t) => consumers.map((c) => ({ call_id: `PRB-${hexId({ t: t.public.id, m: c.model_id }, 12)}`, task_id: t.public.id, family_id: t.public.family_id, model_id: c.model_id, provider: c.provider, expected_family: c.expected_family }))), rng(`${PROBE_1.seed}|order`));
  const empty = { entries: [] };
  const ctxOf = new Map(tasks.map((t) => [t.public.id, buildContext({ arm: "A", task: publicView(t), snapshot: empty, artifactsById: new Map(), consumerFamily: "none", params, seed: "probe" })]));
  const projection = consumers.map((c) => {
    const p = priceFor(c.model_id, PROBE_1.price_date);
    const n = calls.filter((x) => x.model_id === c.model_id).length;
    const tin = tasks.reduce((s, t) => s + ctxOf.get(t.public.id).tokens + 40, 0);
    return { model_id: c.model_id, calls: n, price_per_m: p, usd_worst: p ? +((tin * p.in + n * params.max_output_tokens * p.out) / 1e6).toFixed(4) : null };
  });
  const plan = {
    schema_version: schemaVersion("plan"),
    study_id: PROBE_1.id,
    kind: "calibration-probe",
    arm: "A",
    seed: PROBE_1.seed,
    families: families.map((f) => f.record),
    tasks: tasks.map((t) => ({ id: t.public.id, family_id: t.public.family_id, sealed_commitment_sha256: t.public.sealed_commitment_sha256 })),
    models: consumers.map((c) => ({ model_id: c.model_id, provider: c.provider })),
    calls,
    params: { max_output_tokens: params.max_output_tokens, base_reasoning_tokens: params.base_reasoning_tokens, timeout_ms: params.timeout_ms, max_attempts: 1 },
    projection: { calls: calls.length, by_model: projection, usd_worst: projection.every((x) => x.usd_worst !== null) ? +projection.reduce((s, x) => s + x.usd_worst, 0).toFixed(4) : null },
    decision_rule: DECISION_RULE_1,
  };
  return { plan: { ...plan, plan_sha256: sha256(plan) }, tasks, contexts: ctxOf };
}

function buildProbe2(probe) {
  const { models, params, tasks: T } = probe;
  const specs = calibrationSpecs(probe);
  const families = specs.map((spec) => ({ spec, record: familyRecord(spec, { studyId: probe.id, salt: "public-calibration" }) }));
  const byFamily = families.map(({ spec, record }) => generateTasks(spec, record, { seed: probe.seed, count: T.consumer_per_family, examples: T.examples, checks: T.checks }));
  const tasks = byFamily.flat();
  // Consumers see every task; producers see the first `producer_per_family` tasks of each family.
  const tasksFor = (m) => (m.role === "consumer" ? tasks : byFamily.flatMap((ts) => ts.slice(0, T.producer_per_family)));
  const calls = shuffled(models.flatMap((m) => tasksFor(m).map((t) => ({ call_id: `PRB-${hexId({ p: probe.id, t: t.public.id, m: m.model_id }, 12)}`, task_id: t.public.id, family_id: t.public.family_id, model_id: m.model_id, provider: m.provider, role: m.role, expected_family: m.expected_family }))), rng(`${probe.seed}|order`));
  const empty = { entries: [] };
  const ctxOf = new Map(tasks.map((t) => [t.public.id, buildContext({ arm: "A", task: publicView(t), snapshot: empty, artifactsById: new Map(), consumerFamily: "none", params, seed: "probe" })]));
  const projection = models.map((m) => {
    const p = priceFor(m.model_id, probe.price_date);
    const mine = calls.filter((x) => x.model_id === m.model_id);
    const tin = mine.reduce((s, c) => s + ctxOf.get(c.task_id).tokens + 40, 0);
    return { model_id: m.model_id, role: m.role, calls: mine.length, tokens_in_est: tin, max_output_tokens_per_call: params.max_output_tokens, price_per_m: p, usd_worst: p ? +((tin * p.in + mine.length * params.max_output_tokens * p.out) / 1e6).toFixed(4) : null };
  });
  const plan = {
    schema_version: schemaVersion("plan"),
    study_id: probe.id,
    kind: "calibration-probe",
    arm: "A",
    seed: probe.seed,
    steps: probe.steps,
    families: families.map((f) => f.record),
    tasks: tasks.map((t) => ({ id: t.public.id, family_id: t.public.family_id, sealed_commitment_sha256: t.public.sealed_commitment_sha256 })),
    // The controls and the documented bound each call relies on are part of what is approved (the gate re-checks them).
    models: models.map((m) => { const c = capFor(m.model_id); return { model_id: m.model_id, provider: m.provider, role: m.role, controls: c?.controls ?? null, output_cap: c ? { field: c.cap_field, enforced: c.cap_enforced, status: c.status, sources: c.sources.map((s) => s.url) } : null }; }),
    calls,
    params: { max_output_tokens: params.max_output_tokens, base_reasoning_tokens: params.base_reasoning_tokens, timeout_ms: params.timeout_ms, max_attempts: 1, timeouts_charged_at_worst_case: true },
    projection: { price_date: probe.price_date, calls: calls.length, by_model: projection, usd_worst: projection.every((x) => x.usd_worst !== null) ? +projection.reduce((s, x) => s + x.usd_worst, 0).toFixed(4) : null },
    decision_rule: DECISION_RULE_2,
  };
  return { plan: { ...plan, plan_sha256: sha256(plan) }, tasks, contexts: ctxOf };
}

// Gemini's Interactions API marks a cap stop as status "incomplete".
const STOPPED_AT_CAP = new Set(["max_tokens", "length", "MAX_TOKENS", "incomplete"]);
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };

// Did this completed call stay inside the bound its provider documents? usage.out is the parsed billed output, reasoning
// included (adapters.mjs parseProviderResponse); the raw usage catches what the parsed figure cannot.
export function capCheck(rec, cap) {
  if (!rec.usage) return { checked: false };
  const raw = rec.raw_usage || {};
  const problems = [];
  if ((rec.usage.out || 0) > cap) problems.push(`billed output ${rec.usage.out} > cap ${cap}`);
  const reasoning = raw.completion_tokens_details?.reasoning_tokens || 0;
  if (rec.provider === "deepseek" && reasoning > 0) problems.push(`DeepSeek reported ${reasoning} reasoning tokens with thinking disabled`);
  if (rec.provider === "openai" && reasoning > (raw.completion_tokens || 0)) problems.push(`OpenAI reasoning tokens ${reasoning} exceed completion tokens ${raw.completion_tokens || 0} (completion would not include reasoning)`);
  return { checked: true, ok: problems.length === 0, problems };
}

export async function runProbe({ plan, tasks, contexts, adapter, guard, onCall = () => {} }) {
  if (plan.kind === "producer-probe") return runProducerProbe({ plan, tasks, contexts, adapter, guard, onCall });
  const sealed = new Map(tasks.map((t) => [t.public.id, t.sealed]));
  const records = [], outputs = [];
  for (const c of plan.calls) {
    const ctx = contexts.get(c.task_id);
    let result, attempts;
    try {
      ({ result, attempts } = await callWithRetries(adapter, { provider: c.provider, model_id: c.model_id, input: { system: SYSTEM_PROMPT, user: ctx.text }, max_output_tokens: plan.params.max_output_tokens, timeout_ms: plan.params.timeout_ms, tracing_id: c.call_id, tokens_in_est: ctx.tokens + 40 }, { maxAttempts: 1, guard }));
    } catch (e) {
      records.push({ ...c, outcome: "not-called", stop: e.code || String(e.message).slice(0, 80) });
      if (e.code === "BUDGET_EXHAUSTED") break;
      continue;
    }
    const meta = result.provider_response_metadata || {};
    const stop = meta.stop_reason || meta.finish_reason || null;
    const scored = result.error ? null : scoreOutput(sealed.get(c.task_id), result.output);
    const a = attempts.at(-1);
    const rec = {
      ...c,
      model_id_returned: result.provider_returned_model_id ?? null,
      family_returned: result.provider_returned_model_id ? familyOfModelId(result.provider_returned_model_id) : null,
      outcome: result.error ? (result.error.code === "TIMEOUT" ? "timeout" : "error") : scored.outcome,
      score: result.error ? (result.error.code === "TIMEOUT" ? 0 : null) : scored.score,
      error_code: a?.error_code ?? null,
      stop,
      stopped_at_cap: STOPPED_AT_CAP.has(stop),
      usage: a?.usage ?? null,
      raw_usage: meta.raw_usage ?? null,
      cost_usd: a?.cost_usd ?? null,
      cost_status: a?.cost_status ?? null,
      duration_ms: a?.duration_ms ?? null,
      request_id: a?.request_id ?? null,
      output_sha256: result.output != null ? sha256(result.output) : null,
    };
    if (plan.study_id !== PROBE_1.id) {
      rec.cap_check = capCheck(rec, plan.params.max_output_tokens);
      rec.empty_output = !result.error && !String(result.output ?? "").trim();
      if (meta.step_types) rec.step_types = meta.step_types;
    }
    records.push(rec);
    if (result.output != null) outputs.push({ call_id: c.call_id, output: result.output });
    onCall(rec);
  }
  return { records, outputs, summary: summarizeProbe(plan, records) };
}

const rateOf = (xs) => { const s = xs.filter((r) => r.score === 0 || r.score === 1); return s.length ? +(s.filter((r) => r.score === 1).length / s.length).toFixed(3) : null; };

export function summarizeProbe(plan, records) {
  const v2 = plan.study_id !== PROBE_1.id;
  const byModel = plan.models.map(({ model_id, role }) => {
    const xs = records.filter((r) => r.model_id === model_id);
    const scored = xs.filter((r) => r.score === 0 || r.score === 1);
    const outs = xs.map((r) => r.usage?.out).filter((x) => Number.isFinite(x));
    const done = xs.filter((r) => r.usage);
    const row = {
      model_id,
      returned_ids: [...new Set(xs.map((r) => r.model_id_returned).filter(Boolean))],
      calls: xs.length,
      scored: scored.length,
      pass_rate: rateOf(xs),
      outcomes: xs.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] || 0) + 1 }), {}),
      stopped_at_cap: xs.filter((r) => r.stopped_at_cap).length,
      output_tokens: { median: pct(outs, 0.5), p90: pct(outs, 0.9), max: outs.length ? Math.max(...outs) : null },
      usd: xs.every((r) => r.cost_usd !== null && r.cost_usd !== undefined) ? +xs.reduce((s, r) => s + r.cost_usd, 0).toFixed(5) : null,
    };
    if (!v2) return row;
    const expected = plan.calls.find((c) => c.model_id === model_id)?.expected_family;
    return {
      role,
      ...row,
      completed: done.length,
      share_stopped_at_cap: done.length ? +(done.filter((r) => r.stopped_at_cap).length / done.length).toFixed(3) : 0,
      timeouts: xs.filter((r) => r.outcome === "timeout").length,
      cap_violations: xs.filter((r) => r.cap_check?.checked && !r.cap_check.ok).length,
      empty_outputs: xs.filter((r) => r.empty_output && !r.stopped_at_cap).length,
      family_mismatch: xs.some((r) => r.family_returned && expected && r.family_returned !== expected),
    };
  });
  const byFamily = plan.families.map((f) => {
    const xs = records.filter((r) => r.family_id === f.id && (r.score === 0 || r.score === 1));
    return { family_id: f.id, scored: xs.length, pass_rate: xs.length ? +(xs.filter((r) => r.score === 1).length / xs.length).toFixed(3) : null };
  });
  const rule = v2 ? DECISION_RULE_2 : DECISION_RULE_1;
  const consumers = v2 ? byModel.filter((m) => m.role === "consumer") : byModel;
  const rates = consumers.map((m) => m.pass_rate);
  let difficulty;
  if (!rates.every((r) => r !== null)) difficulty = { branch: "incomplete", then: "a consumer has no scored calls: no difficulty decision; xz decides" };
  else if (rates.every((r) => r >= 0.75)) difficulty = { branch: 0, ...rule.difficulty[0] };
  else if (rates.every((r) => r <= 0.10)) difficulty = { branch: 1, ...rule.difficulty[1] };
  else if (rates.every((r) => r >= 0.15 && r <= 0.70)) difficulty = { branch: 2, ...rule.difficulty[2] };
  else difficulty = { branch: 3, ...rule.difficulty[3] };
  const called = records.filter((r) => r.outcome !== "not-called");
  const capShare = called.length ? called.filter((r) => r.stopped_at_cap).length / called.length : 0;
  const totalUsd = records.reduce((s, r) => s + (r.cost_usd || 0), 0);
  let decision;
  if (!v2) decision = { difficulty, output_cap: { share_stopped_at_cap: +capShare.toFixed(3), fired: capShare > 0.10, ...(capShare > 0.10 ? { then: DECISION_RULE_1.output_cap.then } : {}) } };
  else {
    const fired = (list, r) => ({ fired: list.length > 0, models: list, ...(list.length ? { then: r.then } : {}) });
    decision = {
      difficulty,
      producers: fired(byModel.filter((m) => m.role === "producer" && m.scored > 0 && m.pass_rate === 0).map((m) => m.model_id), DECISION_RULE_2.producers),
      output_cap: { share_stopped_at_cap: +capShare.toFixed(3), ...fired(byModel.filter((m) => m.share_stopped_at_cap > 0.10).map((m) => m.model_id), DECISION_RULE_2.output_cap) },
      cap_enforcement: fired(byModel.filter((m) => m.cap_violations > 0).map((m) => m.model_id), DECISION_RULE_2.cap_enforcement),
      latency: fired(byModel.filter((m) => m.timeouts > 1).map((m) => m.model_id), DECISION_RULE_2.latency),
      identity: fired(byModel.filter((m) => m.family_mismatch).map((m) => m.model_id), DECISION_RULE_2.identity),
      parsing: fired(byModel.filter((m) => m.empty_outputs > 0).map((m) => m.model_id), DECISION_RULE_2.parsing),
    };
  }
  return {
    probe: plan.study_id,
    plan_sha256: plan.plan_sha256,
    calls_made: called.length,
    calls_planned: plan.calls.length,
    by_model: byModel,
    by_family: byFamily,
    decision,
    spend_usd_recorded: +totalUsd.toFixed(5),
    unknown_cost_calls: records.filter((r) => r.cost_status === "unknown").length,
    assumed_worst_case_calls: records.filter((r) => r.cost_status === "assumed-worst-case").length,
    note: rule.note,
  };
}

export function renderProbe(summary, { approvedWords, ranAt }) {
  if (summary.kind === "producer-probe") return renderProducerProbe(summary, { approvedWords, ranAt });
  const v2 = summary.probe !== PROBE_1.id;
  const L = [`# Calibration probe ${summary.probe}: results (private until reviewed)`, ""];
  L.push(`Ran ${ranAt}. Approved by xz: "${approvedWords}". Arm A only, public calibration families. **Not a result about inheritance.**`, "");
  L.push(`Calls: ${summary.calls_made} of ${summary.calls_planned}. Recorded spend: **$${summary.spend_usd_recorded.toFixed(4)}** (unknown-cost calls: ${summary.unknown_cost_calls}; charged at worst case because they timed out: ${summary.assumed_worst_case_calls ?? 0}).`, "");
  if (!v2) {
    L.push("| Model (requested) | Returned id | Scored | Pass rate | Outcomes | Stopped at cap | Output tokens median / p90 / max | USD |", "|---|---|---:|---:|---|---:|---|---:|");
    for (const m of summary.by_model) L.push(`| \`${m.model_id}\` | ${m.returned_ids.map((x) => `\`${x}\``).join(", ") || "—"} | ${m.scored} | ${m.pass_rate ?? "—"} | ${Object.entries(m.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")} | ${m.stopped_at_cap} | ${m.output_tokens.median ?? "—"} / ${m.output_tokens.p90 ?? "—"} / ${m.output_tokens.max ?? "—"} | ${m.usd ?? "unknown"} |`);
  } else {
    L.push("| Model (requested) | Role | Returned id | Scored | Pass rate | Outcomes | Stopped at cap | Over cap | Timeouts | Output tokens median / p90 / max | USD |", "|---|---|---|---:|---:|---|---:|---:|---:|---|---:|");
    for (const m of summary.by_model) L.push(`| \`${m.model_id}\` | ${m.role} | ${m.returned_ids.map((x) => `\`${x}\``).join(", ") || "—"} | ${m.scored} | ${m.pass_rate ?? "—"} | ${Object.entries(m.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")} | ${m.stopped_at_cap} | ${m.cap_violations} | ${m.timeouts} | ${m.output_tokens.median ?? "—"} / ${m.output_tokens.p90 ?? "—"} / ${m.output_tokens.max ?? "—"} | ${m.usd ?? "unknown"} |`);
  }
  L.push("", "| Calibration family | Scored | Pass rate |", "|---|---:|---:|");
  for (const f of summary.by_family) L.push(`| \`${f.family_id}\` | ${f.scored} | ${f.pass_rate ?? "—"} |`);
  L.push("", "## What the pre-committed rule says", "");
  const d = summary.decision;
  L.push(`- Difficulty: **${d.difficulty.then}** (branch: ${d.difficulty.when || d.difficulty.branch}).`);
  if (!v2) L.push(`- Output cap: ${(d.output_cap.share_stopped_at_cap * 100).toFixed(1)}% of calls stopped at the cap: ${d.output_cap.fired ? `**${d.output_cap.then}**` : "keep 2000"}.`);
  else for (const k of ["producers", "output_cap", "cap_enforcement", "latency", "identity", "parsing"]) L.push(`- ${k.replace("_", " ")}: ${d[k].fired ? `**fired for ${d[k].models.map((x) => `\`${x}\``).join(", ")}: ${d[k].then}**` : "did not fire"}.`);
  L.push("", summary.note, "");
  return L.join("\n") + "\n";
}

// ── Probe 3: producers only (ran 2026-11-21; frozen, it must keep reproducing plan 36fe2036…) ─────────────────────────────────────────
// Pilot 001 ran but could not test inheritance: no producer record carried a program in the study's language, so nothing
// was verified and arm C was empty. Probe 3 asks the two producers for exactly what a pilot asks them (the contribution
// request, now stating the language) and counts the records that PASS the hidden checks of their own task.
export const DECISION_RULE_3 = {
  verification: [
    { when: "every producer's verified share (records that pass their task's hidden checks, of its completed calls) >= 0.5", then: "producers can leave verifiable work with these instructions: prepare Pilot 002 (fresh sealed draw, new registration, xz's approval)" },
    { when: "any producer's verified share < 0.25", then: "that producer cannot reliably leave verifiable work this way: xz decides (replace it, or change the instructions) before any new pilot" },
    { when: "anything else", then: "proceed only on xz's decision, given the expected number of verified records in a pilot (56 producer calls times the shares)" },
  ],
  placebo: { when: "no number-domain record verifies", then: "arm E (the placebo) would be empty again: fix before any registration" },
  size: { when: "a producer has more than 10% of its completed replies set aside as too long", then: "tighten the length request before any registration" },
  output_cap: { when: "for any producer, more than 10% of its completed calls stop at its output cap", then: "raise that producer's cap by half and re-project before any registration" },
  cap_enforcement: DECISION_RULE_2.cap_enforcement,
  latency: DECISION_RULE_2.latency,
  identity: DECISION_RULE_2.identity,
  note: "Probe tasks are public calibration tasks, drawn from a seed never used before and excluded from every sealed draw. A verified share here is not a result about inheritance.",
};
export const PROBE_3 = Object.freeze({
  id: "IS1-PROBE-CAL-003",
  kind: "producer",
  seed: "calibration-probe-3-2026-11-20",
  status: "ran 2026-11-21 (results private)",
  plan_sha256: "36fe203610e44b620d1cf364fcc434559690951053de6d6bab5bd5ae8bdbf2e4",
  steps: 4,
  n_families: 4,
  tasks: { per_str_family: 2, per_num_family: 1, examples: 3, checks: 8 },
  price_date: "2026-12-01",
  models: [
    { role: "producer", provider: "deepseek", model_id: "deepseek-v4-pro", expected_family: "deepseek" },
    { role: "producer", provider: "gemini", model_id: "gemini-4-carbon", expected_family: "google-gemini" },
  ],
  params: { context_budget_tokens: 1500, base_reasoning_tokens: 1024, poison_fraction: 0.34, producer_language: true, max_output_tokens: 3000, max_output_tokens_by_model: { "gemini-4-carbon": 4500 }, timeout_ms: 600000 },
  decision_rule: DECISION_RULE_3,
});
PROBES_MUTABLE[PROBE_3.id] = PROBE_3;

// ── Probe 4: GPT-6.1 Sol as a producer (ran 2026-11-21; frozen, it must keep reproducing plan 21364b48…) ──────────────────────
// Probe 3: gemini-4-carbon verified 9 of 10; deepseek-v4-pro (thinking off) 0 of 10. xz chose producers Gemini + GPT-6.1 Sol
// with Claude Sonnet 5.5 the only consumer for Pilot 002 ("Yes, Gemini + GPT"). Probe 4 asks GPT-6.1 Sol for exactly what
// probe 3 asked, on probe 3's own tasks (tasks_from), so the two producers are compared on identical work. Same rule.
export const PROBE_4 = Object.freeze({
  id: "IS1-PROBE-CAL-004",
  kind: "producer",
  tasks_from: PROBE_3.id,
  seed: PROBE_3.seed,
  status: "ran 2026-11-21 (results private)",
  plan_sha256: "21364b481a1bff27b11cb897984f58b5b530285a96bf749452e3005860eac26a",
  steps: PROBE_3.steps,
  n_families: PROBE_3.n_families,
  tasks: PROBE_3.tasks,
  price_date: "2026-12-01",
  models: [{ role: "producer", provider: "openai", model_id: "gpt-6.1-sol", expected_family: "openai-gpt" }],
  params: PROBE_3.params,
  decision_rule: DECISION_RULE_3,
});
PROBES_MUTABLE[PROBE_4.id] = PROBE_4;
export const DEFAULT_PROBE_ID = PROBE_4.id;

function buildProbe3(probe) {
  const { models, params, tasks: T } = probe;
  const numSpecs = drawFamilySet({ seed: probe.seed, nWork: 0, nAnchor: 0, nPlacebo: 2, steps: probe.steps, generations: 1 });
  const families = [...calibrationSpecs(probe), ...numSpecs].map((spec) => ({ spec, record: familyRecord(spec, { studyId: probe.tasks_from ?? probe.id, salt: "public-calibration" }) }));
  const tasks = families.flatMap(({ spec, record }) => generateTasks(spec, record, { seed: probe.seed, count: spec.domain === "num" ? T.per_num_family : T.per_str_family, examples: T.examples, checks: T.checks }));
  const byId = new Map(tasks.map((t) => [t.public.id, t]));
  const calls = shuffled(models.flatMap((m) => tasks.map((t) => ({ call_id: `PRB-${hexId({ p: probe.id, t: t.public.id, m: m.model_id }, 12)}`, task_id: t.public.id, family_id: t.public.family_id, domain: t.public.domain, model_id: m.model_id, provider: m.provider, role: m.role, expected_family: m.expected_family }))), rng(`${probe.seed}|order`));
  const contexts = new Map(calls.map((c) => [c.call_id, buildProducerContext({ task: publicView(byId.get(c.task_id)), snapshot: null, artifactsById: new Map(), producerFamily: c.expected_family, params, seed: hexId({ g: 0, t: c.task_id, m: c.model_id }, 16) })]));
  const requestOf = (domain) => contexts.get(calls.find((c) => c.domain === domain).call_id).context.contribution_request;
  const projection = models.map((m) => {
    const p = priceFor(m.model_id, probe.price_date);
    const mine = calls.filter((x) => x.model_id === m.model_id);
    const tin = mine.reduce((s, c) => s + contexts.get(c.call_id).tokens + 40, 0);
    const cap = outputCapFor(params, m.model_id);
    // input counted twice, as the spend guard does before each call, so an approval at this figure lets every call through
    return { model_id: m.model_id, role: m.role, calls: mine.length, tokens_in_est: tin, max_output_tokens_per_call: cap, price_per_m: p, usd_worst: p ? +((2 * tin * p.in + mine.length * cap * p.out) / 1e6).toFixed(4) : null };
  });
  const plan = {
    schema_version: schemaVersion("plan"),
    study_id: probe.id,
    kind: "producer-probe",
    arm: "producer",
    seed: probe.seed,
    ...(probe.tasks_from ? { tasks_from: probe.tasks_from } : {}),
    steps: probe.steps,
    families: families.map((f) => f.record),
    tasks: tasks.map((t) => ({ id: t.public.id, family_id: t.public.family_id, domain: t.public.domain, sealed_commitment_sha256: t.public.sealed_commitment_sha256 })),
    models: models.map((m) => { const c = capFor(m.model_id); return { model_id: m.model_id, provider: m.provider, role: m.role, controls: c?.controls ?? null, max_output_tokens: outputCapFor(params, m.model_id), output_cap: c ? { field: c.cap_field, enforced: c.cap_enforced, status: c.status, sources: c.sources.map((s) => s.url) } : null }; }),
    calls,
    params: { max_output_tokens: params.max_output_tokens, max_output_tokens_by_model: params.max_output_tokens_by_model, base_reasoning_tokens: params.base_reasoning_tokens, timeout_ms: params.timeout_ms, max_attempts: 1, timeouts_charged_at_worst_case: true, producer_language: true, contribution_request_sha256: { str: sha256(requestOf("str")), num: sha256(requestOf("num")) } },
    projection: { price_date: probe.price_date, calls: calls.length, input_counted: "twice the estimate (as the spend guard)", by_model: projection, usd_worst: projection.every((x) => x.usd_worst !== null) ? +projection.reduce((s, x) => s + x.usd_worst, 0).toFixed(4) : null },
    decision_rule: DECISION_RULE_3,
  };
  return { plan: { ...plan, plan_sha256: sha256(plan) }, tasks, contexts };
}

export async function runProducerProbe({ plan, tasks, contexts, adapter, guard, onCall = () => {}, clock = () => new Date().toISOString() }) {
  const sealedIndex = new Map(tasks.map((t) => [t.public.id, t.sealed]));
  const capOf = new Map(plan.models.map((m) => [m.model_id, m.max_output_tokens]));
  const records = [], outputs = [], artifacts = [], evaluations = [];
  for (const c of plan.calls) {
    const ctx = contexts.get(c.call_id);
    let result, attempts;
    try {
      ({ result, attempts } = await callWithRetries(adapter, { provider: c.provider, model_id: c.model_id, input: { system: SYSTEM_PROMPT, user: ctx.text }, max_output_tokens: capOf.get(c.model_id), timeout_ms: plan.params.timeout_ms, tracing_id: c.call_id, domain: c.domain, tokens_in_est: ctx.tokens + 40 }, { maxAttempts: 1, guard }));
    } catch (e) {
      records.push({ ...c, outcome: "not-called", stop: e.code || String(e.message).slice(0, 80) });
      if (e.code === "BUDGET_EXHAUSTED") break;
      continue;
    }
    const meta = result.provider_response_metadata || {};
    const stop = meta.stop_reason || meta.finish_reason || null;
    const a0 = attempts.at(-1);
    const rec = {
      ...c,
      model_id_returned: result.provider_returned_model_id ?? null,
      family_returned: result.provider_returned_model_id ? familyOfModelId(result.provider_returned_model_id) : null,
      outcome: result.error ? (result.error.code === "TIMEOUT" ? "timeout" : "error") : null,
      score: null, stop, stopped_at_cap: STOPPED_AT_CAP.has(stop),
      usage: a0?.usage ?? null, raw_usage: meta.raw_usage ?? null, cost_usd: a0?.cost_usd ?? null, cost_status: a0?.cost_status ?? null,
      duration_ms: a0?.duration_ms ?? null, request_id: a0?.request_id ?? null, error_code: a0?.error_code ?? null,
    };
    if (!result.error) {
      const scored = scoreOutput(sealedIndex.get(c.task_id), result.output, c.domain);
      const a = makeArtifact({
        studyId: plan.study_id, generation: 0, domain: c.domain,
        producer: { provider: c.provider, model_id_requested: c.model_id, model_id_returned: result.provider_returned_model_id },
        source: { task_id: c.task_id, family_id: c.family_id, input_snapshot_id: null, input_snapshot_sha256: null, run_id: plan.study_id, call_id: c.call_id, exposed_artifact_ids: [] },
        text: result.output, relations: { derived_from: [] },
        production: { tokens_in: a0?.usage?.in ?? 0, tokens_out: a0?.usage?.out ?? 0, usd: a0?.cost_usd ?? null, cost_status: a0?.cost_status ?? "unknown" },
        createdAt: clock(),
      });
      const problems = validateArtifactSemantics(a);
      const ev = problems.length ? null : verifyArtifact(a, sealedIndex, { recordedAt: clock() });
      Object.assign(rec, {
        outcome: scored.outcome, score: scored.score, text_chars: result.output.length,
        program_present: Boolean(a.content.program), program_error: a.content.program_parse_error ?? null,
        admitted: problems.length === 0, admission_problem: problems[0] ?? null,
        verification: ev?.status ?? null, verification_detail: ev?.detail ?? null, cases: ev ? { n: ev.cases.n, passed: ev.cases.passed } : null,
        empty_output: !String(result.output ?? "").trim(),
      });
      artifacts.push(a);
      if (ev) evaluations.push(ev);
      outputs.push({ call_id: c.call_id, output: result.output });
    }
    rec.cap_check = capCheck(rec, capOf.get(c.model_id));
    records.push(rec);
    onCall(rec);
  }
  return { records, outputs, artifacts, evaluations, summary: summarizeProducerProbe(plan, records) };
}

export function summarizeProducerProbe(plan, records) {
  const byModel = plan.models.map(({ model_id, role, max_output_tokens }) => {
    const xs = records.filter((r) => r.model_id === model_id);
    const done = xs.filter((r) => r.usage && !r.outcome?.match(/^(timeout|error)$/));
    const outs = xs.map((r) => r.usage?.out).filter((x) => Number.isFinite(x));
    const verified = done.filter((r) => r.verification === "passed");
    const expected = plan.calls.find((c) => c.model_id === model_id)?.expected_family;
    return {
      model_id, role, max_output_tokens,
      returned_ids: [...new Set(xs.map((r) => r.model_id_returned).filter(Boolean))],
      calls: xs.length, completed: done.length,
      answer_pass: done.filter((r) => r.score === 1).length,
      program_present: done.filter((r) => r.program_present).length,
      set_aside: done.filter((r) => r.admitted === false).length,
      set_aside_too_long: done.filter((r) => /text longer than/.test(r.admission_problem || "")).length,
      verified: verified.length,
      verified_share: done.length ? +(verified.length / done.length).toFixed(3) : null,
      verified_by_domain: { str: verified.filter((r) => r.domain === "str").length, num: verified.filter((r) => r.domain === "num").length },
      program_errors: done.filter((r) => r.program_error).reduce((o, r) => { const k = String(r.program_error).replace(/"[^"]*"/g, '"…"').slice(0, 60); return { ...o, [k]: (o[k] || 0) + 1 }; }, {}),
      stopped_at_cap: done.filter((r) => r.stopped_at_cap).length,
      share_stopped_at_cap: done.length ? +(done.filter((r) => r.stopped_at_cap).length / done.length).toFixed(3) : 0,
      timeouts: xs.filter((r) => r.outcome === "timeout").length,
      cap_violations: xs.filter((r) => r.cap_check?.checked && !r.cap_check.ok).length,
      family_mismatch: xs.some((r) => r.family_returned && expected && r.family_returned !== expected),
      output_tokens: { median: pct(outs, 0.5), p90: pct(outs, 0.9), max: outs.length ? Math.max(...outs) : null },
      usd: xs.every((r) => r.cost_usd !== null && r.cost_usd !== undefined) ? +xs.reduce((s, r) => s + r.cost_usd, 0).toFixed(5) : null,
    };
  });
  const R = DECISION_RULE_3;
  const shares = byModel.map((m) => m.verified_share);
  let verification;
  if (!shares.every((x) => x !== null)) verification = { branch: "incomplete", then: "a producer has no completed calls: no decision; xz decides" };
  else if (shares.every((x) => x >= 0.5)) verification = { branch: 0, ...R.verification[0] };
  else if (shares.some((x) => x < 0.25)) verification = { branch: 1, ...R.verification[1] };
  else verification = { branch: 2, ...R.verification[2] };
  const fired = (list, r) => ({ fired: list.length > 0, models: list, ...(list.length ? { then: r.then } : {}) });
  const numDone = records.filter((r) => r.domain === "num" && r.usage && r.admitted !== undefined).length;
  const numVerified = byModel.reduce((s, m) => s + m.verified_by_domain.num, 0);
  const called = records.filter((r) => r.outcome !== "not-called");
  return {
    kind: "producer-probe",
    probe: plan.study_id,
    plan_sha256: plan.plan_sha256,
    calls_made: called.length,
    calls_planned: plan.calls.length,
    by_model: byModel,
    decision: {
      verification,
      placebo: { fired: numDone > 0 && numVerified === 0, num_completed: numDone, num_verified: numVerified, ...(numDone > 0 && numVerified === 0 ? { then: R.placebo.then } : {}) },
      size: fired(byModel.filter((m) => m.completed && m.set_aside_too_long / m.completed > 0.10).map((m) => m.model_id), R.size),
      output_cap: fired(byModel.filter((m) => m.share_stopped_at_cap > 0.10).map((m) => m.model_id), R.output_cap),
      cap_enforcement: fired(byModel.filter((m) => m.cap_violations > 0).map((m) => m.model_id), R.cap_enforcement),
      latency: fired(byModel.filter((m) => m.timeouts > 1).map((m) => m.model_id), R.latency),
      identity: fired(byModel.filter((m) => m.family_mismatch).map((m) => m.model_id), R.identity),
    },
    spend_usd_recorded: +records.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(5),
    unknown_cost_calls: records.filter((r) => r.cost_status === "unknown").length,
    assumed_worst_case_calls: records.filter((r) => r.cost_status === "assumed-worst-case").length,
    note: R.note,
  };
}

export function renderProducerProbe(summary, { approvedWords, ranAt }) {
  const L = [`# Producer probe ${summary.probe}: results (private until reviewed)`, ""];
  L.push(`Ran ${ranAt}. Approved by xz: "${approvedWords}". Producers only, public calibration families. **Not a result about inheritance.**`, "");
  L.push(`Calls: ${summary.calls_made} of ${summary.calls_planned}. Recorded spend: **$${summary.spend_usd_recorded.toFixed(4)}** (unknown-cost calls: ${summary.unknown_cost_calls}; charged at worst case because they timed out: ${summary.assumed_worst_case_calls}).`, "");
  L.push("| Producer | Completed | Verified (share) | Verified str / num | Program present | Set aside (too long) | Answer right | Stopped at cap | Over cap | Timeouts | Output tokens median / p90 / max | USD |", "|---|---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|");
  for (const m of summary.by_model) L.push(`| \`${m.model_id}\` | ${m.completed} | ${m.verified} (${m.verified_share ?? "—"}) | ${m.verified_by_domain.str} / ${m.verified_by_domain.num} | ${m.program_present} | ${m.set_aside} (${m.set_aside_too_long}) | ${m.answer_pass} | ${m.stopped_at_cap} | ${m.cap_violations} | ${m.timeouts} | ${m.output_tokens.median ?? "—"} / ${m.output_tokens.p90 ?? "—"} / ${m.output_tokens.max ?? "—"} | ${m.usd ?? "unknown"} |`);
  L.push("", "Why records failed to verify:", "");
  for (const m of summary.by_model) L.push(`- \`${m.model_id}\`: ${Object.entries(m.program_errors).map(([k, v]) => `${k} ×${v}`).join("; ") || "no program errors"}`);
  L.push("", "## What the pre-committed rule says", "");
  const d = summary.decision;
  L.push(`- Verification: **${d.verification.then}** (branch: ${d.verification.when || d.verification.branch}).`);
  L.push(`- Placebo (number tasks): ${d.placebo.fired ? `**fired: ${d.placebo.then}**` : `did not fire (${d.placebo.num_verified} of ${d.placebo.num_completed} verified)`}.`);
  for (const k of ["size", "output_cap", "cap_enforcement", "latency", "identity"]) L.push(`- ${k.replace("_", " ")}: ${d[k].fired ? `**fired for ${d[k].models.map((x) => `\`${x}\``).join(", ")}: ${d[k].then}**` : "did not fire"}.`);
  L.push("", summary.note, "");
  return L.join("\n") + "\n";
}
