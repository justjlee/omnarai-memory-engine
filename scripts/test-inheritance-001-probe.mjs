// Inheritance Study 001 — stage-0 calibration probe. HERMETIC: fake transports only, no key, no network, $0.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-probe.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProbe, runProbe, summarizeProbe, renderProbe, PROBE_ID, DECISION_RULE } from "./inheritance-001/lib/probe.mjs";
import { checkLiveAuthorization, createLiveAdapter, createSpendGuard, SpendRefusedError } from "./inheritance-001/lib/adapters.mjs";
import { PILOT_MODELS, pilotStudy, projectionFamilies } from "./inheritance-001/fixtures/pilot-001.mjs";
import { canonicalJSON } from "./inheritance-001/lib/canon.mjs";

const params = pilotStudy({ families: projectionFamilies(), salt: "x" }).params;
const P = buildProbe({ consumers: PILOT_MODELS.consumers, params });
const approval = { study_id: PROBE_ID, plan_sha256: P.plan.plan_sha256, approved_by: "xz", approved_at: "2026-11-20T19:10:00Z", approval_words: "Yes, approve probe", max_calls: 32, max_usd: 0.54, models: ["claude-sonnet-5-5", "grok-4.7"] };
const argv = ["--live", "--yes", "--experiment", PROBE_ID, "--max-usd", "0.54", "--max-calls", "32"];
const auth = (over = {}) => ({ approval, preregistration: null, plan: P.plan, planSha256: P.plan.plan_sha256, argv, env: { OMNARAI_LAB_LIVE: "1" }, requireRegistration: false, ...over });

test("[Q1] the probe plan: 32 arm-A calls on public calibration families, deterministic, inside the approved $0.54, no sealed data", () => {
  assert.equal(P.plan.calls.length, 32);
  assert.equal(P.plan.families.length, 4);
  assert.ok(P.plan.families.every((f) => f.role === "calibration"));
  assert.equal(P.plan.arm, "A");
  assert.ok(P.plan.projection.usd_worst <= 0.54, String(P.plan.projection.usd_worst));
  assert.equal(buildProbe({ consumers: PILOT_MODELS.consumers, params }).plan.plan_sha256, P.plan.plan_sha256);
  const text = JSON.stringify(P.plan);
  for (const t of P.tasks) { assert.ok(!text.includes(t.sealed.canary)); assert.ok(!text.includes(canonicalJSON(t.sealed.program))); }
  for (const ctx of P.contexts.values()) assert.equal(ctx.context.inherited_records.records.length, 0, "arm A: no inherited records");
  assert.equal(P.plan.decision_rule, DECISION_RULE);
});

test("[Q2] the probe gate needs the approval for THIS plan and both caps, but not a registration (calibration only)", () => {
  assert.deepEqual(checkLiveAuthorization(auth()), []);
  assert.ok(checkLiveAuthorization(auth({ requireRegistration: true })).some((m) => /not registered/.test(m)), "the study itself still needs registration");
  assert.ok(checkLiveAuthorization(auth({ approval: { ...approval, plan_sha256: "0".repeat(64) } })).some((m) => /different plan/.test(m)));
  assert.ok(checkLiveAuthorization(auth({ env: {} })).some((m) => /OMNARAI_LAB_LIVE/.test(m)));
  assert.ok(checkLiveAuthorization(auth({ argv: argv.map((a) => (a === "0.54" ? "5" : a)) })).some((m) => /--max-usd/.test(m)));
  assert.throws(() => createLiveAdapter({ authorization: auth({ approval: null }), keys: {} }), SpendRefusedError);
});

function fakeTransport({ answerRight = () => true, capStop = () => false } = {}) {
  const sealed = new Map(P.tasks.map((t) => [t.public.id, t.sealed]));
  const byText = new Map(P.tasks.map((t) => [P.contexts.get(t.public.id).text, sealed.get(t.public.id)]));
  const sent = [];
  return { sent, send: async (req) => {
    sent.push(req);
    const s = byText.get(req.input.user);
    const answer = answerRight(req) ? s.expected : "wrong";
    if (req.provider === "anthropic") return { status: 200, headers: { "request-id": `req_${sent.length}` }, json: { model: "claude-sonnet-5-5", stop_reason: capStop(req) ? "max_tokens" : "end_turn", content: [{ type: "text", text: capStop(req) ? "" : `<answer>${answer}</answer>` }], usage: { input_tokens: 400, output_tokens: capStop(req) ? 2000 : 600 } }, duration_ms: 10 };
    return { status: 200, headers: { "x-request-id": `x_${sent.length}` }, json: { model: "grok-4.7", choices: [{ finish_reason: "stop", message: { content: `<answer>${answer}</answer>` } }], usage: { prompt_tokens: 400, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 200 } } }, duration_ms: 10 };
  } };
}

test("[Q3] a probe run records returned ids, usage, stop reasons and cost; the pre-committed rule picks the branch", async () => {
  const ft = fakeTransport({ answerRight: (req) => req.provider === "xai" || req.tracing_id.charCodeAt(5) % 2 === 0, capStop: (req) => req.provider === "anthropic" && req.tracing_id.endsWith("0") });
  const adapter = createLiveAdapter({ authorization: auth(), keys: { ANTHROPIC_API_KEY: "sk-ant-test-0000000000", XAI_API_KEY: "xai-test-00000000000000" }, transport: ft.send });
  const guard = createSpendGuard({ maxCalls: 32, maxUsd: 0.54, onDate: "2026-11-20" });
  const { records, summary } = await runProbe({ ...P, adapter, guard });
  assert.equal(ft.sent.length, 32);
  assert.equal(records.length, 32);
  const grok = summary.by_model.find((m) => m.model_id === "grok-4.7");
  assert.equal(grok.pass_rate, 1);
  assert.deepEqual(grok.returned_ids, ["grok-4.7"]);
  assert.equal(records.find((r) => r.model_id === "grok-4.7").usage.out, 500, "xAI reasoning tokens are added (conservative)");
  assert.ok(records.every((r) => r.cost_status === "priced" && r.cost_usd > 0));
  assert.ok(summary.spend_usd_recorded <= 0.54);
  assert.equal(summary.decision.difficulty.branch, 3, "consumers disagree → keep 3-step, xz decides");
  const capped = records.filter((r) => r.stopped_at_cap).length;
  assert.equal(summary.decision.output_cap.fired, capped / 32 > 0.1);
  const md = renderProbe(summary, { approvedWords: "Yes, approve probe", ranAt: "2026-11-20T19:20:00Z" });
  assert.match(md, /Not a result about inheritance/);
  assert.match(md, /Yes, approve probe/);
});

test("[Q4] the spend guard stops the probe before a call whose worst case would cross the cap, and learns from real output sizes", async () => {
  const ft = fakeTransport();
  const adapter = createLiveAdapter({ authorization: auth(), keys: { ANTHROPIC_API_KEY: "sk-ant-test-0000000000", XAI_API_KEY: "xai-test-00000000000000" }, transport: ft.send });
  const guard = createSpendGuard({ maxCalls: 32, maxUsd: 0.05, onDate: "2026-11-20" });
  const { records, summary } = await runProbe({ ...P, adapter, guard });
  assert.ok(ft.sent.length < 32, `stopped early (${ft.sent.length} sent)`);
  assert.ok(guard.state.usd <= 0.05);
  assert.equal(records.at(-1).outcome, "not-called");
  assert.ok(summary.calls_made < 32);
  const g = createSpendGuard({ maxCalls: 9, maxUsd: 9, onDate: "2026-11-20" });
  g.record({ provider: "xai", model_id: "grok-4.7", usage: { in: 10, out: 9000 } });
  assert.ok(g.precheck({ provider: "xai", model_id: "grok-4.7", tokensIn: 0, maxOut: 100 }).worst_usd >= (9000 * 6) / 1e6, "worst case uses the largest output seen");
});

test("[Q5] summary arithmetic: ceiling and floor branches fire on the stated thresholds", () => {
  const mk = (rate) => P.plan.calls.map((c, i) => ({ ...c, outcome: "pass", score: i % 16 < rate * 16 ? 1 : 0, usage: { out: 100 }, cost_usd: 0.001, cost_status: "priced" }));
  assert.equal(summarizeProbe(P.plan, mk(0.8)).decision.difficulty.branch, 0);
  assert.equal(summarizeProbe(P.plan, mk(0.0)).decision.difficulty.branch, 1);
  assert.equal(summarizeProbe(P.plan, mk(0.5)).decision.difficulty.branch, 2);
});
