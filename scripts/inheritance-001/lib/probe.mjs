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
import { buildContext, SYSTEM_PROMPT } from "./context.mjs";
import { scoreOutput } from "./oracle.mjs";
import { callWithRetries } from "./adapters.mjs";
import { priceFor } from "./prices.mjs";
import { familyOfModelId } from "./identity.mjs";
import { capFor } from "./caps.mjs";

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
export const PROBES = Object.freeze({ [PROBE_1.id]: PROBE_1, [PROBE_2.id]: PROBE_2 });
export const LATEST_PROBE_ID = PROBE_2.id;

const calibrationSpecs = (probe) => drawFamilySet({ seed: probe.seed, nWork: probe.n_families || 4, nAnchor: 0, nPlacebo: 0, steps: probe.steps, generations: 1 }).map((f, i) => ({ ...f, key: `cal${i}`, role: "calibration" }));
// Every calibration op set any probe uses: the sealed draw must never reuse one.
export function calibrationOpSets() {
  return new Set(Object.values(PROBES).flatMap((p) => calibrationSpecs(p).map((f) => setKey(f.steps.map((s) => s.op)))));
}

export function buildProbe({ probe = PROBES[LATEST_PROBE_ID] } = {}) {
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
