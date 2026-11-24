// Diagnostic re-send (IS1-DIAG-REFUSAL-001, added 2026-11-24 after REVIEW-PILOT-002-INSTRUMENT.md).
//
// Pilot 002's consumer declined 33 of 288 calls with stop_reason "refusal", and the transport dropped stop_details, so the
// reason was never recorded. This module re-sends chosen consumer requests of a FINISHED run, byte-identical, so the reason
// can be read. It is a diagnostic, not a study: nothing it records enters any analysis, and it reads no sealed file.
//
// Exactness: each request is rebuilt from the run's own records (plan, frozen snapshot, artifacts, evaluations, public
// tasks) with the same buildContext the runner used, and its sha256 must equal the context hash the trial recorded.
// A request that does not match is refused before any call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildContext, SYSTEM_PROMPT } from "./context.mjs";
import { sha256 } from "./canon.mjs";
import { controlsFor } from "./caps.mjs";

export const RESEND_PLAN_VERSION = "is1-resend/1";

const readJsonl = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const outputCapFor = (p, modelId) => (p.max_output_tokens_by_model && Object.hasOwn(p.max_output_tokens_by_model, modelId) ? p.max_output_tokens_by_model[modelId] : p.max_output_tokens);

// Everything a re-send needs, read from a run directory written by lab.mjs run-models (no sealed/ file is read).
export function loadRun(runDir) {
  const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8"));
  const snapshots = JSON.parse(readFileSync(join(runDir, "snapshot.json"), "utf8"));
  const study = JSON.parse(readFileSync(join(runDir, "study.json"), "utf8"));
  const trials = readJsonl(join(runDir, "trials.jsonl"));
  let calls = [];
  try { calls = readJsonl(join(runDir, "calls.log.jsonl")); } catch { /* an offline run has no call log */ }
  return {
    plan,
    study,
    snapshots: Array.isArray(snapshots) ? snapshots : [snapshots],
    artifactsById: new Map(readJsonl(join(runDir, "artifacts.jsonl")).map((a) => [a.id, a])),
    evaluationsById: new Map(readJsonl(join(runDir, "evaluations.jsonl")).map((e) => [e.id, e])),
    tasksById: new Map(readJsonl(join(runDir, "tasks.public.jsonl")).map((t) => [t.id, t])),
    trials,
    callsByTracing: new Map(calls.map((c) => [c.tracing_id, c])),
  };
}

// Rebuild one consumer request exactly as the runner sent it. → { request, context_sha256, matches }
export function rebuildConsumerRequest(run, trial) {
  const block = run.plan.blocks.find((b) => b.block_id === trial.block_id);
  if (!block) throw new Error(`RESEND_UNKNOWN_BLOCK ${trial.block_id}`);
  const snapshot = run.snapshots.find((s) => s.id === trial.snapshot_id);
  if (!snapshot) throw new Error(`RESEND_UNKNOWN_SNAPSHOT ${trial.snapshot_id}`);
  const task = run.tasksById.get(trial.task_id);
  if (!task) throw new Error(`RESEND_UNKNOWN_TASK ${trial.task_id}`);
  const consumer = (run.study.config?.consumers || run.plan.consumers || []).find((c) => c.model_id === block.consumer_model_id);
  if (!consumer) throw new Error(`RESEND_UNKNOWN_CONSUMER ${block.consumer_model_id}`);
  const params = run.plan.params;
  // Same as the runner: plannedCTrials = the number of blocks in the generation.
  const plannedCTrials = run.plan.blocks.filter((b) => b.generation === block.generation).length;
  const ctx = buildContext({ arm: trial.arm, task, snapshot, artifactsById: run.artifactsById, evaluationsById: run.evaluationsById, consumerFamily: consumer.expected_family, params, seed: block.seed, variant: trial.variant || "full", plannedCTrials });
  const maxOut = outputCapFor(params, block.consumer_model_id) + Math.max(0, ctx.reasoning_allowance_tokens - params.base_reasoning_tokens);
  return {
    request: { provider: block.consumer_provider, model_id: block.consumer_model_id, input: { system: SYSTEM_PROMPT, user: ctx.text }, max_output_tokens: maxOut, timeout_ms: params.timeout_ms, domain: task.domain, tokens_in_est: ctx.tokens + 40 },
    context_sha256: ctx.digest,
    matches: ctx.digest === trial.context?.sha256,
  };
}

// The diagnostic plan: every refused call of the run first, in the run's call order, then up to `controls` answered calls
// (one per held-out family, from arm `controlArm`, the lowest sha256(tracing_id) in each). Controls go LAST so a spend cap
// can only ever cut controls, never refused calls.
export function buildResendPlan(run, { diagnosticId = "IS1-DIAG-REFUSAL-001", controls = 8, controlArm = "B", maxUsd, maxCalls, priceDate, decisionRule }) {
  const order = (t) => run.callsByTracing.get(t.call?.tracing_id)?.n ?? Number.MAX_SAFE_INTEGER;
  const stopOf = (t) => run.callsByTracing.get(t.call?.tracing_id)?.stop ?? null;
  const refused = run.trials.filter((t) => stopOf(t) === "refusal").sort((a, b) => order(a) - order(b));
  const families = [...new Set(run.plan.blocks.map((b) => b.family_id))].sort();
  const controlTrials = [];
  for (const fam of families) {
    if (controlTrials.length >= controls) break;
    const pool = run.trials.filter((t) => t.task_family_id === fam && t.arm === controlArm && stopOf(t) === "end_turn")
      .sort((a, b) => sha256(`${a.call.tracing_id}|control`).localeCompare(sha256(`${b.call.tracing_id}|control`)));
    if (pool.length) controlTrials.push(pool[0]);
  }
  const entry = (t, kind, i) => {
    const r = rebuildConsumerRequest(run, t);
    if (!r.matches) throw new Error(`RESEND_CONTEXT_MISMATCH ${t.call?.tracing_id}: the rebuilt request differs from what the run sent`);
    return { call_id: `${diagnosticId}-${String(i + 1).padStart(2, "0")}`, kind, source_tracing_id: t.call.tracing_id, source_trial_id: t.id, arm: t.arm, family_id: t.task_family_id, block_id: t.block_id, original_stop: stopOf(t), original_outcome: t.outcome, context_sha256: r.context_sha256, max_output_tokens: r.request.max_output_tokens };
  };
  const calls = [...refused.map((t, i) => entry(t, "refused-before", i)), ...controlTrials.map((t, i) => entry(t, "control", refused.length + i))];
  const consumerModel = run.plan.blocks[0].consumer_model_id;
  const provider = run.plan.blocks[0].consumer_provider;
  const plan = {
    plan_version: RESEND_PLAN_VERSION,
    study_id: diagnosticId,
    kind: "diagnostic-resend",
    enters_any_analysis: false,
    source: { study_id: run.plan.study_id, plan_sha256: run.plan.plan_sha256, run_id: run.trials[0]?.run_id ?? null },
    models: [{ model_id: consumerModel, provider, ...(controlsFor(consumerModel) ? { controls: controlsFor(consumerModel) } : {}) }],
    request_rule: "byte-identical to the source run: same system prompt, same user text (sha256 must equal the trial's recorded context hash), same max_tokens and reasoning controls; one attempt plus retries only on rate limits and server errors",
    calls,
    counts: { refused_before: refused.length, controls: controlTrials.length, total: calls.length },
    caps: { max_usd: maxUsd, max_calls: maxCalls },
    price_date: priceDate,
    decision_rule: decisionRule,
    records_kept: "per call: stop_reason, stop_details (type, category, short explanation), usage, cost, whether an <answer> tag was returned; model text is kept only in the private output directory",
  };
  return { ...plan, plan_sha256: sha256(plan) };
}

// Run the plan through the guarded adapter. Each request is rebuilt and re-checked against its hash at call time.
export async function runResend({ plan, run, adapter, guard, callWithRetries, maxAttempts = 2, onCall = () => {} }) {
  const records = [], outputs = [];
  let stopped = null;
  const trialsByTracing = new Map(run.trials.map((t) => [t.call?.tracing_id, t]));
  for (const c of plan.calls) {
    const trial = trialsByTracing.get(c.source_tracing_id);
    const r = rebuildConsumerRequest(run, trial);
    if (r.context_sha256 !== c.context_sha256 || !r.matches) throw new Error(`RESEND_CONTEXT_MISMATCH ${c.call_id}`);
    let result, attempts;
    try {
      ({ result, attempts } = await callWithRetries(adapter, { ...r.request, tracing_id: c.call_id }, { maxAttempts, guard }));
    } catch (e) {
      if (e.code === "BUDGET_EXHAUSTED") { stopped = { at: c.call_id, reason: String(e.message).slice(0, 200) }; break; }
      throw e;
    }
    const meta = result.provider_response_metadata || {};
    const text = result.output || "";
    const rec = {
      call_id: c.call_id, kind: c.kind, source_tracing_id: c.source_tracing_id, arm: c.arm, family_id: c.family_id,
      original_stop: c.original_stop,
      stop_reason: result.error ? null : meta.stop_reason ?? null,
      stop_details: result.error ? null : meta.stop_details ?? null,
      error: result.error?.code ?? null,
      answer_tag_returned: /<answer>[\s\S]*?<\/answer>/.test(text),
      output_chars: text.length,
      usage: attempts.reduce((s, x) => ({ in: s.in + (x.usage?.in || 0), out: s.out + (x.usage?.out || 0) }), { in: 0, out: 0 }),
      cost_usd: attempts.every((x) => x.cost_usd !== null) ? +attempts.reduce((s, x) => s + x.cost_usd, 0).toFixed(6) : null,
      request_id: attempts.at(-1)?.request_id ?? null,
    };
    records.push(rec);
    if (text) outputs.push({ call_id: c.call_id, output: text });
    onCall(rec);
  }
  return { records, outputs, stopped };
}

// What the records say, against the plan's pre-committed rule. Counts only; interpretation is the decision rule's.
export function summarizeResend(plan, records, stopped) {
  const by = (kind) => records.filter((r) => r.kind === kind);
  const tally = (rs) => {
    const t = { calls: rs.length, refused_again: 0, answered: 0, other: 0, categories: {} };
    for (const r of rs) {
      if (r.stop_reason === "refusal") { t.refused_again++; const k = r.stop_details?.category ?? "null"; t.categories[k] = (t.categories[k] || 0) + 1; }
      else if (r.stop_reason) t.answered++;
      else t.other++;
    }
    return t;
  };
  return {
    study_id: plan.study_id, plan_sha256: plan.plan_sha256,
    planned: plan.counts, made: records.length, stopped,
    refused_before: tally(by("refused-before")),
    controls: tally(by("control")),
    spend_usd: +records.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(6),
  };
}
