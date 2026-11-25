// Inheritance Study 001 — the program language shown to producers, and producer probe 3. HERMETIC: fake transports only,
// no key, no network, $0.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-producer.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_LANGUAGE, languageText } from "./inheritance-001/lib/language.mjs";
import { DOMAINS, runProgram, parseValue, formatValue, validateProgram, extractProgram } from "./inheritance-001/lib/dsl.mjs";
import { buildProducerContext, buildContext, CONTRIBUTION_REQUEST } from "./inheritance-001/lib/context.mjs";
import { buildProbe, runProbe, summarizeProducerProbe, renderProbe, calibrationOpSets, PROBES, PROBE_1, PROBE_2, PROBE_3, PROBE_4, DECISION_RULE_3, DEFAULT_PROBE_ID } from "./inheritance-001/lib/probe.mjs";
import { checkLiveAuthorization, createLiveAdapter, createSpendGuard } from "./inheritance-001/lib/adapters.mjs";
import { capFor } from "./inheritance-001/lib/caps.mjs";
import { canonicalJSON } from "./inheritance-001/lib/canon.mjs";

test("[K13] the language shown to producers matches the interpreter: every step, every worked example, every range", () => {
  for (const [domain, L] of Object.entries(PROGRAM_LANGUAGE)) {
    assert.deepEqual(L.steps.map((s) => s.step.op).sort(), Object.keys(DOMAINS[domain]).sort(), `${domain}: one entry per op, no extras`);
    for (const s of L.steps) {
      assert.deepEqual(validateProgram([s.step], domain), [], `${domain}/${s.step.op} validates`);
      assert.equal(formatValue(runProgram([s.step], parseValue(s.input, domain), domain), domain), s.output, `${domain}/${s.step.op}: ${s.input} -> ${s.output}`);
      for (const [k, [lo, hi]] of Object.entries(DOMAINS[domain][s.step.op].params)) assert.ok(s.params.includes(`${k.toUpperCase()} from ${lo} to ${hi}`), `${domain}/${s.step.op} states the range of ${k}`);
    }
    assert.deepEqual(validateProgram(L.example_program, domain), []);
    const text = languageText(domain);
    for (const op of Object.keys(DOMAINS[domain])) assert.ok(text.includes(`"op":"${op}"`), `${domain} text names ${op}`);
    const block = /```program\n([\s\S]+?)\n```/.exec(text)[0];
    assert.deepEqual(extractProgram(block, domain).program, L.example_program, "the example block parses exactly as a producer's would");
  }
  assert.throws(() => languageText("nope"), /NO_LANGUAGE_FOR_DOMAIN/);
});

test("[K14] only producers in studies that opt in see the language; consumer frames never do", () => {
  const strTask = { id: "t1", domain: "str", prompt: { examples: [{ input: "abc", output: "cba" }], query: "xyz" } };
  const numTask = { id: "t2", domain: "num", prompt: { examples: [{ input: "1,2", output: "2,4" }], query: "3,4" } };
  const params = { context_budget_tokens: 1500, base_reasoning_tokens: 1024, poison_fraction: 0.34 };
  const prod = (task, p) => buildProducerContext({ task, snapshot: null, artifactsById: new Map(), producerFamily: "x", params: p, seed: "s" }).context.contribution_request;
  assert.equal(prod(strTask, params), CONTRIBUTION_REQUEST, "without the flag (demo worlds, Pilot 001) nothing changes");
  const withLang = prod(strTask, { ...params, producer_language: true });
  assert.ok(withLang.startsWith(CONTRIBUTION_REQUEST) && withLang.includes('"op":"caesar"') && withLang.includes("under 6,000 characters"));
  assert.ok(prod(numTask, { ...params, producer_language: true }).includes('"op":"cumsum"'), "number tasks get the number language");
  const consumer = buildContext({ arm: "A", task: strTask, snapshot: { entries: [] }, artifactsById: new Map(), consumerFamily: "x", params: { ...params, producer_language: true }, seed: "s" });
  assert.ok(!consumer.text.includes('"op":"caesar"') && !consumer.text.includes("How to write the program"), "arm A keeps its frame");
});

const P = buildProbe({ probe: PROBE_3 });
const approval = { study_id: PROBE_3.id, plan_sha256: P.plan.plan_sha256, approved_by: "xz", approved_at: "2026-11-21T00:00:00Z", approval_words: "Yes", max_calls: 20, max_usd: 1.15, models: P.plan.models.map((m) => m.model_id) };
const auth = (over = {}) => ({ approval, preregistration: null, plan: P.plan, planSha256: P.plan.plan_sha256, argv: ["--live", "--yes", "--experiment", PROBE_3.id, "--max-usd", "1.15", "--max-calls", "20"], env: { OMNARAI_LAB_LIVE: "1" }, requireRegistration: false, ...over });

test("[P3a] probe 3 plan: 20 producer calls on NEW public families (4 string, 2 number), the pilot's caps and controls, worst case about $1.10", () => {
  assert.equal(P.plan.plan_sha256, PROBE_3.plan_sha256, "probe 3 ran under this plan: it must keep reproducing");
  assert.equal(P.plan.kind, "producer-probe");
  assert.equal(P.plan.calls.length, 20);
  assert.deepEqual(P.plan.models.map((m) => [m.model_id, m.max_output_tokens]), [["deepseek-v4-pro", 3000], ["gemini-4-carbon", 4500]]);
  for (const m of P.plan.models) assert.deepEqual(m.controls, capFor(m.model_id).controls);
  assert.equal(P.plan.families.filter((f) => f.domain === "str" && f.n_steps === 4).length, 4);
  assert.equal(P.plan.families.filter((f) => f.domain === "num").length, 2);
  assert.equal(P.plan.tasks.filter((t) => t.domain === "num").length, 2);
  assert.equal(P.plan.params.producer_language, true);
  assert.match(P.plan.params.contribution_request_sha256.str, /^[0-9a-f]{64}$/, "the exact request text is inside the approved hash");
  assert.equal(P.plan.params.timeout_ms, 600000);
  assert.ok(P.plan.projection.usd_worst > 1 && P.plan.projection.usd_worst <= 1.15, String(P.plan.projection.usd_worst));
  assert.equal(buildProbe({ probe: PROBE_3 }).plan.plan_sha256, P.plan.plan_sha256, "deterministic");
  assert.equal(buildProbe({ probe: PROBE_1 }).plan.plan_sha256, PROBE_1.plan_sha256, "probe 1 still reproduces");
  assert.equal(buildProbe({ probe: PROBE_2 }).plan.plan_sha256, PROBE_2.plan_sha256, "probe 2 still reproduces");
  const earlier = new Set([PROBE_1, PROBE_2].flatMap((p) => buildProbe({ probe: p }).plan.families.map((f) => f.template_commitment_sha256)));
  assert.ok(P.plan.families.filter((f) => f.domain === "str").every((f) => !earlier.has(f.template_commitment_sha256)));
  assert.equal(calibrationOpSets().size, 12, "probe 3's string op sets join the exclusion list for every future sealed draw");
  const text = JSON.stringify(P.plan);
  for (const t of P.tasks) { assert.ok(!text.includes(t.sealed.canary)); assert.ok(!text.includes(canonicalJSON(t.sealed.program))); }
  assert.deepEqual(checkLiveAuthorization(auth()), []);
  assert.ok(checkLiveAuthorization(auth({ approval: { ...approval, plan_sha256: "0".repeat(64) } })).some((m) => /different plan/.test(m)));
});

// Fake producers: "good" writes the right answer and the task's own program; "invented" writes a made-up op name;
// "none" writes no program; "long" pads past the text limit; "wrong" writes a valid but wrong program.
function fakeTransport(behaviour) {
  const byText = new Map([...P.contexts].map(([id, ctx]) => [ctx.text, P.tasks.find((t) => t.public.id === P.plan.calls.find((c) => c.call_id === id).task_id).sealed]));
  const sent = [];
  return { sent, send: async (req) => {
    sent.push(req);
    const s = byText.get(req.input.user);
    const how = behaviour(req, s);
    const prog = how === "good" || how === "long" ? JSON.stringify(s.program) : how === "invented" ? '[{"op":"caesar_shift","k":1}]' : how === "wrong" ? '[{"op":"reverse"}]' : null;
    const text = `<answer>${s.expected}</answer>\nMethod note: checked against the examples.${prog ? `\n\`\`\`program\n${prog}\n\`\`\`` : ""}${how === "long" ? `\n${"z".repeat(8500)}` : ""}`;
    if (req.provider === "gemini") return { status: 200, headers: {}, json: { id: "g", model: req.model_id, status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text }] }], usage: { total_input_tokens: 800, total_output_tokens: 300, total_thought_tokens: 1200, total_tokens: 2300 } }, duration_ms: 2 };
    return { status: 200, headers: {}, json: { model: req.model_id, choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 800, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 0 } } }, duration_ms: 2 };
  } };
}
const run = async (behaviour, maxUsd = 1.15) => {
  const ft = fakeTransport(behaviour);
  const adapter = createLiveAdapter({ authorization: auth(), keys: { DEEPSEEK_API_KEY: "sk-test-deepseek-000000000", GEMINI_API_KEY: "AIza-test-0000000000000000000" }, transport: ft.send });
  const guard = createSpendGuard({ maxCalls: 20, maxUsd, onDate: PROBE_3.price_date });
  return { ft, guard, ...(await runProbe({ ...P, adapter, guard })) };
};

test("[P3b] a probe-3 run verifies records against their own task's hidden checks and counts why the rest failed", async () => {
  let k = 0;
  const { ft, records, artifacts, evaluations, summary } = await run((req) => (req.model_id === "gemini-4-carbon" ? "good" : ["good", "invented", "none", "long", "wrong"][k++ % 5]));
  assert.equal(ft.sent.length, 20);
  assert.ok(ft.sent.every((r) => r.input.user.includes("How to write the program") && (r.input.user.includes("rotate") || r.input.user.includes("cumsum"))), "every producer prompt states the language");
  const gem = summary.by_model.find((m) => m.model_id === "gemini-4-carbon"), ds = summary.by_model.find((m) => m.model_id === "deepseek-v4-pro");
  assert.equal(gem.verified, 10);
  assert.equal(gem.verified_share, 1);
  assert.deepEqual(gem.verified_by_domain, { str: 8, num: 2 });
  assert.equal(ds.verified, 2, "only the 'good' replies verify");
  assert.equal(ds.set_aside_too_long, 2);
  assert.ok(Object.keys(ds.program_errors).some((e) => /unknown op/.test(e)) && Object.keys(ds.program_errors).some((e) => /NO_PROGRAM_BLOCK/.test(e)));
  assert.ok(records.some((r) => r.verification === "failed"), "a valid but wrong program fails its hidden checks");
  assert.equal(evaluations.length, artifacts.length - 2, "set-aside records are never verified");
  assert.equal(summary.decision.verification.branch, 1, "DeepSeek at 0.2 < 0.25");
  assert.deepEqual(summary.decision.size.models, ["deepseek-v4-pro"]);
  assert.equal(summary.decision.placebo.fired, false);
  for (const k2 of ["output_cap", "cap_enforcement", "latency", "identity"]) assert.equal(summary.decision[k2].fired, false, k2);
  const md = renderProbe(summary, { approvedWords: "Yes", ranAt: "2026-11-21T00:10:00Z" });
  assert.match(md, /Producer probe IS1-PROBE-CAL-003/);
  assert.match(md, /Not a result about inheritance/);
});

test("[P3c] decision branches: both producers verify at half or more → prepare Pilot 002; no number record verifies → placebo fires", async () => {
  const ok = await run(() => "good");
  assert.equal(ok.summary.decision.verification.branch, 0);
  assert.match(ok.summary.decision.verification.then, /Pilot 002/);
  const noNum = await run((req, s) => (s.program.some((st) => ["add", "mul", "diffs", "cumsum", "revnum", "sortnum"].includes(st.op)) ? "none" : "good"));
  assert.equal(noNum.summary.decision.placebo.fired, true);
  assert.match(noNum.summary.decision.placebo.then, /arm E/);
  const mid = summarizeProducerProbe(P.plan, ok.records.map((r, i) => ({ ...r, verification: i % 5 < 2 ? "passed" : "inconclusive" })));
  assert.equal(mid.decision.verification.branch, 2, "between 0.25 and 0.5");
  assert.equal(DECISION_RULE_3.verification.length, 3);
});

test("[P3d] the guard stops probe 3 before its cap; a timed-out call is charged at its worst case", async () => {
  const { ft, guard, summary } = await run(() => "good", 0.3);
  assert.ok(ft.sent.length < 20 && guard.state.usd <= 0.3);
  assert.ok(summary.calls_made < 20);
  const sent = [];
  const adapter = createLiveAdapter({ authorization: auth(), keys: {}, transport: async (req) => { sent.push(req); throw Object.assign(new Error("timeout"), { code: "TIMEOUT" }); } });
  const g = createSpendGuard({ maxCalls: 20, maxUsd: 0.5, onDate: PROBE_3.price_date });
  const r = await runProbe({ ...P, adapter, guard: g });
  assert.ok(r.records.filter((x) => x.outcome === "timeout").every((x) => x.cost_status === "assumed-worst-case" && x.cost_usd > 0));
  assert.ok(g.state.usd <= 0.5 && sent.length < 20);
});

test("[P4a] probe 4: GPT-6.1 Sol alone, on probe 3's identical tasks, same request and rule; probe 3 unchanged", async () => {
  assert.equal(DEFAULT_PROBE_ID, PROBE_4.id);
  const P4 = buildProbe({ probe: PROBE_4 });
  assert.equal(P4.plan.calls.length, 10);
  assert.deepEqual(P4.plan.models.map((m) => [m.model_id, m.provider, m.max_output_tokens]), [["gpt-6.1-sol", "openai", 3000]]);
  assert.deepEqual(P4.plan.models[0].controls, capFor("gpt-6.1-sol").controls);
  assert.deepEqual(P4.plan.tasks, P.plan.tasks, "the same task ids and sealed commitments as probe 3");
  assert.deepEqual(P4.plan.params.contribution_request_sha256, P.plan.params.contribution_request_sha256, "the same request text");
  assert.equal(P4.plan.tasks_from, PROBE_3.id);
  assert.equal(P4.plan.decision_rule, DECISION_RULE_3);
  assert.notEqual(P4.plan.plan_sha256, P.plan.plan_sha256);
  assert.ok(P4.plan.projection.usd_worst > 0.2 && P4.plan.projection.usd_worst <= 0.4, String(P4.plan.projection.usd_worst));
  assert.equal(calibrationOpSets().size, 12, "no new families are consumed");
  const a4 = { study_id: PROBE_4.id, plan_sha256: P4.plan.plan_sha256, approved_by: "xz", approved_at: "2026-11-21T00:00:00Z", approval_words: "Yes", max_calls: 10, max_usd: 0.4, models: ["gpt-6.1-sol"] };
  const auth4 = { approval: a4, preregistration: null, plan: P4.plan, planSha256: P4.plan.plan_sha256, argv: ["--live", "--yes", "--experiment", PROBE_4.id, "--max-usd", "0.4", "--max-calls", "10"], env: { OMNARAI_LAB_LIVE: "1" }, requireRegistration: false };
  assert.deepEqual(checkLiveAuthorization(auth4), []);
  const byText = new Map([...P4.contexts].map(([id, ctx]) => [ctx.text, P4.tasks.find((t) => t.public.id === P4.plan.calls.find((c) => c.call_id === id).task_id).sealed]));
  let k = 0;
  const adapter = createLiveAdapter({ authorization: auth4, keys: { OPENAI_API_KEY: "sk-test-openai-000000000000" }, transport: async (req) => {
    const s = byText.get(req.input.user);
    const text = `<answer>${s.expected}</answer>${k++ % 2 ? `\n\`\`\`program\n${JSON.stringify(s.program)}\n\`\`\`` : ""}`;
    return { status: 200, headers: {}, json: { model: "gpt-6.1-sol", choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 800, completion_tokens: 700, completion_tokens_details: { reasoning_tokens: 500 } } }, duration_ms: 2 };
  } });
  const { summary } = await runProbe({ ...P4, adapter, guard: createSpendGuard({ maxCalls: 10, maxUsd: 0.4, onDate: PROBE_4.price_date }) });
  assert.equal(summary.by_model[0].verified, 5);
  assert.equal(summary.decision.verification.branch, 0, "0.5 counts as enough");
});
