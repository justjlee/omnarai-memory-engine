// Inheritance Study 001 — stage-0 calibration probes. HERMETIC: fake transports only, no key, no network, $0.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-probe.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProbe, runProbe, summarizeProbe, renderProbe, capCheck, calibrationOpSets, PROBE_1, PROBE_2, DECISION_RULE_2, LATEST_PROBE_ID } from "./inheritance-001/lib/probe.mjs";
import { checkLiveAuthorization, createLiveAdapter, createSpendGuard, SpendRefusedError } from "./inheritance-001/lib/adapters.mjs";
import { PILOT_MODELS, pilotStudy, projectionFamilies, SEALED_DRAW } from "./inheritance-001/fixtures/pilot-001.mjs";
import { capFor } from "./inheritance-001/lib/caps.mjs";
import { canonicalJSON } from "./inheritance-001/lib/canon.mjs";

const P = buildProbe();
const MODELS = P.plan.models.map((m) => m.model_id);
const approval = { study_id: PROBE_2.id, plan_sha256: P.plan.plan_sha256, approved_by: "xz", approved_at: "2026-11-21T10:00:00Z", approval_words: "Yes, run probe 2", max_calls: 32, max_usd: 1.05, models: MODELS };
const argv = ["--live", "--yes", "--experiment", PROBE_2.id, "--max-usd", "1.05", "--max-calls", "32"];
const auth = (over = {}) => ({ approval, preregistration: null, plan: P.plan, planSha256: P.plan.plan_sha256, argv, env: { OMNARAI_LAB_LIVE: "1" }, requireRegistration: false, ...over });
const KEYS = { ANTHROPIC_API_KEY: "sk-ant-test-0000000000", OPENAI_API_KEY: "sk-test-openai-000000000000", DEEPSEEK_API_KEY: "sk-test-deepseek-0000000000", GEMINI_API_KEY: "AIza-test-0000000000000000000" };

test("[Q1] probe 1 (ran 2026-11-20) still reproduces its plan hash, and the new gate would refuse it", () => {
  const p1 = buildProbe({ probe: PROBE_1 });
  assert.equal(p1.plan.plan_sha256, "d3fc3cc036c796de515324d1becfc4dbef102bd04293132a2f3bbfd256df8f9d");
  assert.equal(p1.plan.plan_sha256, PROBE_1.plan_sha256);
  const a1 = { study_id: PROBE_1.id, plan_sha256: p1.plan.plan_sha256, approved_by: "xz", approved_at: "2026-11-20T19:10:00Z", approval_words: "Yes, approve probe", max_calls: 32, max_usd: 0.54, models: ["claude-sonnet-5-5", "grok-4.7"] };
  const missing = checkLiveAuthorization({ approval: a1, preregistration: null, plan: p1.plan, planSha256: p1.plan.plan_sha256, argv: ["--live", "--yes", "--experiment", PROBE_1.id, "--max-usd", "0.54", "--max-calls", "32"], env: { OMNARAI_LAB_LIVE: "1" }, requireRegistration: false });
  assert.ok(missing.some((m) => /grok-4\.7: output cap is not provider-enforced/.test(m)), missing.join(" | "));
  assert.ok(missing.some((m) => /claude-sonnet-5-5: the plan's reasoning controls differ/.test(m)), "probe 1 sent no effort control");
});

test("[Q2] probe 2 plan: 32 arm-A calls, the capped panel, 4-step families on a NEW seed, worst case about $1, no sealed data", () => {
  assert.equal(LATEST_PROBE_ID, PROBE_2.id);
  assert.equal(P.plan.calls.length, 32);
  const n = (m) => P.plan.calls.filter((c) => c.model_id === m).length;
  assert.deepEqual(MODELS.map(n), [12, 12, 4, 4]);
  assert.deepEqual(P.plan.models.map((m) => m.role), ["consumer", "consumer", "producer", "producer"]);
  assert.equal(P.plan.families.length, 4);
  assert.ok(P.plan.families.every((f) => f.role === "calibration" && f.n_steps === 4));
  assert.notEqual(PROBE_2.seed, PROBE_1.seed);
  const p1Fams = new Set(buildProbe({ probe: PROBE_1 }).plan.families.map((f) => f.template_commitment_sha256));
  assert.ok(P.plan.families.every((f) => !p1Fams.has(f.template_commitment_sha256)), "no probe-1 family reused");
  assert.equal(calibrationOpSets().size, 12, "probes 1, 2 and 3: all op sets distinct");
  assert.equal(P.plan.arm, "A");
  assert.equal(P.plan.params.max_output_tokens, 3000);
  assert.equal(P.plan.params.timeout_ms, 600000);
  assert.equal(P.plan.params.max_attempts, 1);
  assert.equal(P.plan.projection.price_date, "2026-12-01", "priced at the higher December Gemini price");
  assert.ok(P.plan.projection.usd_worst > 0.9 && P.plan.projection.usd_worst <= 1.05, String(P.plan.projection.usd_worst));
  assert.equal(buildProbe().plan.plan_sha256, P.plan.plan_sha256, "deterministic");
  assert.equal(P.plan.plan_sha256, PROBE_2.plan_sha256, "probe 2 ran under this plan: it must keep reproducing");
  const text = JSON.stringify(P.plan);
  for (const t of P.tasks) { assert.ok(!text.includes(t.sealed.canary)); assert.ok(!text.includes(canonicalJSON(t.sealed.program))); }
  for (const ctx of P.contexts.values()) assert.equal(ctx.context.inherited_records.records.length, 0, "arm A: no inherited records");
  assert.equal(P.plan.decision_rule, DECISION_RULE_2);
  for (const m of P.plan.models) {
    const c = capFor(m.model_id);
    assert.equal(c.cap_enforced, true, m.model_id);
    assert.deepEqual(m.controls, c.controls);
    assert.equal(m.output_cap.enforced, true);
  }
});

test("[Q2b] probe 2 ran the pilot's panel, timeout and step count; the pilot differs only by the rule-driven Gemini cap", () => {
  const study = pilotStudy({ families: projectionFamilies(), salt: "x" });
  const panel = [...PILOT_MODELS.consumers.map((m) => ({ ...m, role: "consumer" })), ...PILOT_MODELS.producers.map((m) => ({ ...m, role: "producer" }))];
  assert.deepEqual(PROBE_2.models.map((m) => [m.model_id, m.provider, m.role, m.expected_family]).sort(), panel.map((m) => [m.model_id, m.provider, m.role, m.expected_family]).sort());
  assert.equal(PROBE_2.params.max_output_tokens, study.params.max_output_tokens);
  assert.deepEqual(study.params.max_output_tokens_by_model, { "gemini-4-carbon": 4500 }, "probe 2's output-cap branch fired for Gemini only; xz: \"Gemini only\"");
  assert.match(DECISION_RULE_2.output_cap.then, /4500/);
  assert.equal(PROBE_2.params.timeout_ms, study.params.timeout_ms);
  assert.equal(PROBE_2.steps, SEALED_DRAW.steps);
});

test("[Q3] the probe-2 gate needs the approval for THIS plan and both caps, but not a registration (calibration only)", () => {
  assert.deepEqual(checkLiveAuthorization(auth()), []);
  assert.ok(checkLiveAuthorization(auth({ requireRegistration: true })).some((m) => /not registered/.test(m)), "the study itself still needs registration");
  assert.ok(checkLiveAuthorization(auth({ approval: { ...approval, plan_sha256: "0".repeat(64) } })).some((m) => /different plan/.test(m)));
  assert.ok(checkLiveAuthorization(auth({ env: {} })).some((m) => /OMNARAI_LAB_LIVE/.test(m)));
  assert.ok(checkLiveAuthorization(auth({ argv: argv.map((a) => (a === "1.05" ? "5" : a)) })).some((m) => /--max-usd/.test(m)));
  const swapped = { ...P.plan, models: P.plan.models.map((m) => (m.model_id === "gemini-4-carbon" ? { ...m, controls: { thinking_level: "high" } } : m)) };
  assert.ok(checkLiveAuthorization(auth({ plan: swapped })).some((m) => /gemini-4-carbon: the plan's reasoning controls differ/.test(m)));
  assert.throws(() => createLiveAdapter({ authorization: auth({ approval: null }), keys: {} }), SpendRefusedError);
});

// A fake provider per transport shape. `answer(req)` → "right" | "wrong"; `over(req)` bills past the cap; `stop(req)` stops at it.
function fakeTransport({ answer = () => "right", stop = () => false, over = () => false, timeout = () => false, returned = {} } = {}) {
  const sealedByText = new Map(P.tasks.map((t) => [P.contexts.get(t.public.id).text, t.sealed]));
  const sent = [];
  return { sent, send: async (req) => {
    sent.push(req);
    if (timeout(req)) throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
    const s = sealedByText.get(req.input.user);
    const text = stop(req) ? "" : `<answer>${answer(req) === "right" ? s.expected : "wrong"}</answer>`;
    const out = over(req) ? req.max_output_tokens + 500 : stop(req) ? req.max_output_tokens : 900;
    const id = returned[req.provider] || req.model_id;
    if (req.provider === "anthropic") return { status: 200, headers: { "request-id": `req_${sent.length}` }, json: { model: id, stop_reason: stop(req) ? "max_tokens" : "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 300, output_tokens: out } }, duration_ms: 10 };
    if (req.provider === "gemini") return { status: 200, headers: {}, json: { id: `int_${sent.length}`, model: id, status: stop(req) ? "incomplete" : "completed", steps: [{ type: "thought", content: [{ type: "text", text: "thinking summary" }] }, { type: "model_output", content: [{ type: "text", text }] }], usage: { total_input_tokens: 300, total_output_tokens: 100, total_thought_tokens: out - 100, total_tokens: 300 + out } }, duration_ms: 10 };
    const reasoning = req.provider === "openai" ? 600 : over(req) && req.provider === "deepseek" ? 50 : 0;
    return { status: 200, headers: { "x-request-id": `x_${sent.length}` }, json: { model: id, choices: [{ finish_reason: stop(req) ? "length" : "stop", message: { content: text } }], usage: { prompt_tokens: 300, completion_tokens: req.provider === "deepseek" && over(req) ? 900 : out, completion_tokens_details: { reasoning_tokens: reasoning } } }, duration_ms: 10 };
  } };
}
const runWith = async (ft, { maxUsd = 1.05, maxCalls = 32 } = {}) => {
  const adapter = createLiveAdapter({ authorization: auth(), keys: KEYS, transport: ft.send });
  const guard = createSpendGuard({ maxCalls, maxUsd, onDate: PROBE_2.price_date });
  return { guard, ...(await runProbe({ ...P, adapter, guard })) };
};

test("[Q4] a probe-2 run records returned ids, usage and cost for all four providers, checks every cap, and picks the branch", async () => {
  let sonnetSeen = 0;
  const consumerRight = (req) => (req.model_id !== "claude-sonnet-5-5" ? "right" : ++sonnetSeen <= 6 ? "right" : "wrong");
  const ft = fakeTransport({ answer: consumerRight });
  const { records, summary } = await runWith(ft);
  assert.equal(ft.sent.length, 32);
  assert.equal(records.length, 32);
  assert.ok(records.every((r) => r.cost_status === "priced" && r.cost_usd > 0));
  assert.ok(records.every((r) => r.cap_check.checked && r.cap_check.ok), "every call stayed inside its documented bound");
  const gem = records.find((r) => r.model_id === "gemini-4-carbon");
  assert.equal(gem.usage.out, 900, "Gemini billed output = output + thought tokens");
  assert.equal(gem.outcome, "pass", "the thought step's text is not read as the answer");
  for (const m of summary.by_model) { assert.deepEqual(m.returned_ids, [m.model_id]); assert.equal(m.family_mismatch, false); }
  assert.equal(summary.by_model.find((m) => m.model_id === "gpt-6.1-sol").pass_rate, 1);
  assert.equal(summary.decision.difficulty.branch, 3, "one consumer at ceiling, one in band → keep 4-step, xz decides");
  for (const k of ["producers", "output_cap", "cap_enforcement", "latency", "identity", "parsing"]) assert.equal(summary.decision[k].fired, false, k);
  assert.ok(records.filter((r) => r.provider === "gemini").every((r) => r.step_types.join() === "thought,model_output"), "Gemini step layout is recorded");
  assert.ok(summary.spend_usd_recorded <= 1.05);
  const md = renderProbe(summary, { approvedWords: "Yes, run probe 2", ranAt: "2026-11-21T10:30:00Z" });
  assert.match(md, /IS1-PROBE-CAL-002/);
  assert.match(md, /Not a result about inheritance|not a result about inheritance/);
  assert.match(md, /Yes, run probe 2/);
});

test("[Q5] the pre-committed rule fires on cap breaches, cap stops, a silent producer, timeouts and a wrong family", async () => {
  const ft = fakeTransport({
    answer: (req) => (req.model_id === "deepseek-v4-pro" ? "wrong" : "right"),
    over: (req) => req.model_id === "gemini-4-carbon" || req.model_id === "deepseek-v4-pro",
    stop: (req) => req.model_id === "gpt-6.1-sol" && req.tracing_id.endsWith("0"),
    timeout: (req) => req.model_id === "claude-sonnet-5-5" && /[0-3]$/.test(req.tracing_id),
    returned: { anthropic: "claude-sonnet-5-5-20261101" },
  });
  const { records, summary } = await runWith(ft, { maxUsd: 5 });
  const d = summary.decision;
  assert.deepEqual(d.cap_enforcement.models.sort(), ["deepseek-v4-pro", "gemini-4-carbon"], "Gemini over cap; DeepSeek reported reasoning with thinking off");
  assert.match(d.cap_enforcement.then, /cap_enforced false/);
  assert.ok(records.filter((r) => r.model_id === "deepseek-v4-pro").every((r) => r.cap_check.problems.some((p) => /reasoning tokens with thinking disabled/.test(p))));
  assert.deepEqual(d.producers.models, ["deepseek-v4-pro"]);
  const gptStops = records.filter((r) => r.model_id === "gpt-6.1-sol" && r.stopped_at_cap).length;
  assert.equal(d.output_cap.models.includes("gpt-6.1-sol"), gptStops / 12 > 0.1);
  const sonnetTimeouts = records.filter((r) => r.model_id === "claude-sonnet-5-5" && r.outcome === "timeout").length;
  assert.equal(d.latency.models.includes("claude-sonnet-5-5"), sonnetTimeouts > 1);
  assert.deepEqual(d.identity.models, [], "a dated snapshot of the same family is not a mismatch");
  const wrongFam = summarizeProbe(P.plan, records.map((r) => (r.model_id === "gpt-6.1-sol" ? { ...r, family_returned: "xai-grok" } : r)));
  assert.deepEqual(wrongFam.decision.identity.models, ["gpt-6.1-sol"]);
  const unreadable = summarizeProbe(P.plan, records.map((r) => (r.model_id === "gemini-4-carbon" && !r.stopped_at_cap ? { ...r, empty_output: true, outcome: "abstain", score: 0 } : r)));
  assert.deepEqual(unreadable.decision.parsing.models, ["gemini-4-carbon"], "completed calls with no parsed answer are flagged, not read as difficulty");
  assert.deepEqual(capCheck({ provider: "openai", usage: { out: 500 }, raw_usage: { completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 900 } } }, 3000).ok, false, "reasoning > completion means completion excludes reasoning");
});

test("[Q6] regression (2026-11-20 probe): a timed-out call is charged at its worst case, never $0, so the cap still binds", async () => {
  const ft = fakeTransport({ timeout: () => true });
  const { records, summary, guard } = await runWith(ft, { maxUsd: 0.2 });
  const timedOut = records.filter((r) => r.outcome === "timeout");
  assert.ok(timedOut.length > 0 && timedOut.every((r) => r.cost_status === "assumed-worst-case" && r.cost_usd > 0), "no timed-out call is free");
  assert.ok(guard.state.assumedCalls === timedOut.length && guard.state.usd > 0);
  assert.ok(guard.state.usd <= 0.2, "the cap held");
  assert.ok(ft.sent.length < 32, `the run stopped at the cap (${ft.sent.length} sent)`);
  assert.equal(summary.assumed_worst_case_calls, timedOut.length);
  assert.ok(ft.sent.every((r) => r.timeout_ms === 600000), "every call carries the 600 s timeout");
});

test("[Q7] difficulty bands leave no gap at 12 consumer calls: floor ≤1/12, keep 2..8/12, ceiling ≥9/12", () => {
  const mk = (k) => P.plan.calls.map((c) => {
    const i = P.plan.calls.filter((x) => x.model_id === c.model_id).indexOf(c);
    return { ...c, outcome: "pass", score: i < k ? 1 : 0, usage: { out: 100 }, cost_usd: 0.001, cost_status: "priced" };
  });
  for (let k = 0; k <= 12; k++) {
    const b = summarizeProbe(P.plan, mk(k)).decision.difficulty.branch;
    assert.equal(b, k <= 1 ? 1 : k >= 9 ? 0 : 2, `k=${k}`);
  }
});

test("[Q8] the spend guard stops before a call whose worst case would cross the cap, and learns from real output sizes", async () => {
  const ft = fakeTransport();
  const { records, summary, guard } = await runWith(ft, { maxUsd: 0.1 });
  assert.ok(ft.sent.length < 32, `stopped early (${ft.sent.length} sent)`);
  assert.ok(guard.state.usd <= 0.1);
  assert.equal(records.at(-1).outcome, "not-called");
  assert.ok(summary.calls_made < 32);
  const g = createSpendGuard({ maxCalls: 9, maxUsd: 9, onDate: "2026-12-01" });
  g.record({ provider: "gemini", model_id: "gemini-4-carbon", usage: { in: 10, out: 9000 } });
  assert.ok(g.precheck({ provider: "gemini", model_id: "gemini-4-carbon", tokensIn: 0, maxOut: 100 }).worst_usd >= (9000 * 20) / 1e6, "worst case uses the largest output seen");
});
