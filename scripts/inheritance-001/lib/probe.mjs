// Inheritance study 001 — stage-0 calibration probe. Its ONLY job is to pitch task difficulty and the output cap before
// the sealed study is registered. It runs arm A (cold) only, on PUBLIC calibration families drawn from a public seed,
// so nothing it touches can leak into the sealed set, and its results never enter the study's analysis.
//
// The decision rule below is fixed in code and committed before the probe runs; the probe reports which branch fired.
import { schemaVersion, sha256, hexId, rng, shuffled } from "./canon.mjs";
import { familyRecord, generateTasks, publicView } from "./tasks.mjs";
import { drawFamilySet } from "./families.mjs";
import { buildContext, SYSTEM_PROMPT } from "./context.mjs";
import { scoreOutput } from "./oracle.mjs";
import { callWithRetries } from "./adapters.mjs";
import { priceFor } from "./prices.mjs";
import { familyOfModelId } from "./identity.mjs";

export const PROBE_ID = "IS1-PROBE-CAL-001";
export const PROBE_SEED = "calibration-probe-2026-11-20";

// Fixed before any call (committed with this file):
export const DECISION_RULE = {
  difficulty: [
    { when: "every consumer's arm-A pass rate >= 0.75", then: "too easy (ceiling): move the sealed draw to 4-step families and re-probe" },
    { when: "every consumer's arm-A pass rate <= 0.10", then: "too hard (floor): move the sealed draw to 2-step families and re-probe" },
    { when: "every consumer between 0.15 and 0.70", then: "keep 3-step families for the sealed draw" },
    { when: "anything else (consumers disagree, or a rate falls between bands)", then: "keep 3-step; report the asymmetry; xz decides before registration" },
  ],
  output_cap: { when: "more than 10% of calls stop at the output cap", then: "raise max_output_tokens to 4000 and re-project the pilot cost before asking for pilot approval" },
  note: "Probe tasks are public calibration tasks and are never reused in the sealed set. A pass rate here is not a result about inheritance.",
};

export function buildProbe({ consumers, params, priceDate = "2026-11-20" }) {
  const specs = drawFamilySet({ seed: PROBE_SEED, nWork: 4, nAnchor: 0, nPlacebo: 0, steps: 3, generations: 1 }).map((f, i) => ({ ...f, key: `cal${i}`, role: "calibration" }));
  const families = specs.map((spec) => ({ spec, record: familyRecord(spec, { studyId: PROBE_ID, salt: "public-calibration" }) }));
  const tasks = families.flatMap(({ spec, record }) => generateTasks(spec, record, { seed: PROBE_SEED, count: 4, examples: 3, checks: 8 }));
  const calls = shuffled(tasks.flatMap((t) => consumers.map((c) => ({ call_id: `PRB-${hexId({ t: t.public.id, m: c.model_id }, 12)}`, task_id: t.public.id, family_id: t.public.family_id, model_id: c.model_id, provider: c.provider, expected_family: c.expected_family }))), rng(`${PROBE_SEED}|order`));
  const empty = { entries: [] };
  const ctxOf = new Map(tasks.map((t) => [t.public.id, buildContext({ arm: "A", task: publicView(t), snapshot: empty, artifactsById: new Map(), consumerFamily: "none", params, seed: "probe" })]));
  const projection = consumers.map((c) => {
    const p = priceFor(c.model_id, priceDate);
    const n = calls.filter((x) => x.model_id === c.model_id).length;
    const tin = tasks.reduce((s, t) => s + ctxOf.get(t.public.id).tokens + 40, 0);
    return { model_id: c.model_id, calls: n, price_per_m: p, usd_worst: p ? +((tin * p.in + n * params.max_output_tokens * p.out) / 1e6).toFixed(4) : null };
  });
  const plan = {
    schema_version: schemaVersion("plan"),
    study_id: PROBE_ID,
    kind: "calibration-probe",
    arm: "A",
    seed: PROBE_SEED,
    families: families.map((f) => f.record),
    tasks: tasks.map((t) => ({ id: t.public.id, family_id: t.public.family_id, sealed_commitment_sha256: t.public.sealed_commitment_sha256 })),
    models: consumers.map((c) => ({ model_id: c.model_id, provider: c.provider })),
    calls,
    params: { max_output_tokens: params.max_output_tokens, base_reasoning_tokens: params.base_reasoning_tokens, timeout_ms: params.timeout_ms, max_attempts: 1 },
    projection: { calls: calls.length, by_model: projection, usd_worst: projection.every((x) => x.usd_worst !== null) ? +projection.reduce((s, x) => s + x.usd_worst, 0).toFixed(4) : null },
    decision_rule: DECISION_RULE,
  };
  return { plan: { ...plan, plan_sha256: sha256(plan) }, tasks, contexts: ctxOf };
}

const STOPPED_AT_CAP = new Set(["max_tokens", "length", "MAX_TOKENS"]);
const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };

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
    records.push(rec);
    if (result.output != null) outputs.push({ call_id: c.call_id, output: result.output });
    onCall(rec);
  }
  return { records, outputs, summary: summarizeProbe(plan, records) };
}

export function summarizeProbe(plan, records) {
  const byModel = plan.models.map(({ model_id }) => {
    const xs = records.filter((r) => r.model_id === model_id);
    const scored = xs.filter((r) => r.score === 0 || r.score === 1);
    const outs = xs.map((r) => r.usage?.out).filter((x) => Number.isFinite(x));
    return {
      model_id,
      returned_ids: [...new Set(xs.map((r) => r.model_id_returned).filter(Boolean))],
      calls: xs.length,
      scored: scored.length,
      pass_rate: scored.length ? +(scored.filter((r) => r.score === 1).length / scored.length).toFixed(3) : null,
      outcomes: xs.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] || 0) + 1 }), {}),
      stopped_at_cap: xs.filter((r) => r.stopped_at_cap).length,
      output_tokens: { median: pct(outs, 0.5), p90: pct(outs, 0.9), max: outs.length ? Math.max(...outs) : null },
      usd: xs.every((r) => r.cost_usd !== null && r.cost_usd !== undefined) ? +xs.reduce((s, r) => s + r.cost_usd, 0).toFixed(5) : null,
    };
  });
  const byFamily = plan.families.map((f) => {
    const xs = records.filter((r) => r.family_id === f.id && (r.score === 0 || r.score === 1));
    return { family_id: f.id, scored: xs.length, pass_rate: xs.length ? +(xs.filter((r) => r.score === 1).length / xs.length).toFixed(3) : null };
  });
  const rates = byModel.map((m) => m.pass_rate);
  const known = rates.every((r) => r !== null);
  let difficulty;
  if (!known) difficulty = { branch: "incomplete", then: "a consumer has no scored calls: no difficulty decision; xz decides" };
  else if (rates.every((r) => r >= 0.75)) difficulty = { branch: 0, ...DECISION_RULE.difficulty[0] };
  else if (rates.every((r) => r <= 0.10)) difficulty = { branch: 1, ...DECISION_RULE.difficulty[1] };
  else if (rates.every((r) => r >= 0.15 && r <= 0.70)) difficulty = { branch: 2, ...DECISION_RULE.difficulty[2] };
  else difficulty = { branch: 3, ...DECISION_RULE.difficulty[3] };
  const called = records.filter((r) => r.outcome !== "not-called");
  const capShare = called.length ? called.filter((r) => r.stopped_at_cap).length / called.length : 0;
  const totalUsd = records.reduce((s, r) => s + (r.cost_usd || 0), 0);
  return {
    probe: plan.study_id,
    plan_sha256: plan.plan_sha256,
    calls_made: called.length,
    calls_planned: plan.calls.length,
    by_model: byModel,
    by_family: byFamily,
    decision: { difficulty, output_cap: { share_stopped_at_cap: +capShare.toFixed(3), fired: capShare > 0.10, ...(capShare > 0.10 ? { then: DECISION_RULE.output_cap.then } : {}) } },
    spend_usd_recorded: +totalUsd.toFixed(5),
    unknown_cost_calls: records.filter((r) => r.cost_status === "unknown").length,
    note: DECISION_RULE.note,
  };
}

export function renderProbe(summary, { approvedWords, ranAt }) {
  const L = ["# Calibration probe IS1-PROBE-CAL-001: results (private until reviewed)", ""];
  L.push(`Ran ${ranAt}. Approved by xz: "${approvedWords}". Arm A only, public calibration families. **Not a result about inheritance.**`, "");
  L.push(`Calls: ${summary.calls_made} of ${summary.calls_planned}. Recorded spend: **$${summary.spend_usd_recorded.toFixed(4)}** (unknown-cost calls: ${summary.unknown_cost_calls}).`, "");
  L.push("| Model (requested) | Returned id | Scored | Pass rate | Outcomes | Stopped at cap | Output tokens median / p90 / max | USD |", "|---|---|---:|---:|---|---:|---|---:|");
  for (const m of summary.by_model) L.push(`| \`${m.model_id}\` | ${m.returned_ids.map((x) => `\`${x}\``).join(", ") || "—"} | ${m.scored} | ${m.pass_rate ?? "—"} | ${Object.entries(m.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")} | ${m.stopped_at_cap} | ${m.output_tokens.median ?? "—"} / ${m.output_tokens.p90 ?? "—"} / ${m.output_tokens.max ?? "—"} | ${m.usd ?? "unknown"} |`);
  L.push("", "| Calibration family | Scored | Pass rate |", "|---|---:|---:|");
  for (const f of summary.by_family) L.push(`| \`${f.family_id}\` | ${f.scored} | ${f.pass_rate ?? "—"} |`);
  L.push("", "## What the pre-committed rule says", "");
  L.push(`- Difficulty: **${summary.decision.difficulty.then}** (branch: ${summary.decision.difficulty.when || summary.decision.difficulty.branch}).`);
  L.push(`- Output cap: ${(summary.decision.output_cap.share_stopped_at_cap * 100).toFixed(1)}% of calls stopped at the cap: ${summary.decision.output_cap.fired ? `**${summary.decision.output_cap.then}**` : "keep 2000"}.`);
  L.push("", summary.note, "");
  return L.join("\n") + "\n";
}
