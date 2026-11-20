// Inheritance Study 001 — documented output bounds, the enforced-cap gate, and the request bodies the transport sends.
// HERMETIC: an injected `post` captures each request; nothing is sent, no key is real, $0.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-caps.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTPUT_CAPS, capFor, controlsFor, capProblems, CAPS_READ_ON } from "./inheritance-001/lib/caps.mjs";
import { checkLiveAuthorization, createHttpsTransport, parseProviderResponse } from "./inheritance-001/lib/adapters.mjs";
import { priceFor } from "./inheritance-001/lib/prices.mjs";
import { buildPlan, outputCapFor } from "./inheritance-001/lib/plan.mjs";
import { runStudy } from "./inheritance-001/lib/runner.mjs";
import { createSpendGuard } from "./inheritance-001/lib/adapters.mjs";
import { drawFamilySet, setKey } from "./inheritance-001/lib/families.mjs";
import { calibrationOpSets } from "./inheritance-001/lib/probe.mjs";
import { PILOT_MODELS, pilotStudy, projectionFamilies, SEALED_DRAW } from "./inheritance-001/fixtures/pilot-001.mjs";
import { familyOfModelId } from "./inheritance-001/lib/identity.mjs";

const PANEL = [...PILOT_MODELS.producers, ...PILOT_MODELS.consumers];

test("[K1] every cap entry cites a dated provider page; grok-4.7 is on file as NOT boundable", () => {
  for (const [id, c] of Object.entries(OUTPUT_CAPS)) {
    assert.ok(["anthropic", "openai", "deepseek", "gemini", "xai"].includes(c.provider), id);
    assert.ok(c.cap_field && c.status && c.basis, id);
    assert.ok(c.sources.length >= 1 && c.sources.every((s) => /^https:\/\//.test(s.url) && s.read_on === CAPS_READ_ON && s.quote.split(/\s+/).length <= 15), id);
    if (c.cap_enforced) assert.ok(c.controls && Object.keys(c.controls).length, `${id}: an enforced bound names its reasoning controls`);
    assert.ok(priceFor(id), `${id} is priced`);
  }
  assert.equal(capFor("grok-4.7").cap_enforced, false);
  assert.match(capFor("grok-4.7").reason, /visible output/);
  assert.equal(capFor("claude-sonnet-5-5-20261101"), capFor("claude-sonnet-5-5"), "a dated snapshot resolves to its base id");
  assert.equal(capFor("claude-opus-5-5"), null, "priced but never read: no entry");
  assert.deepEqual(controlsFor("deepseek-v4-pro"), { thinking: { type: "disabled" } });
});

test("[K2] the live gate refuses a model without a documented, enforced bound, or with different controls", () => {
  const study = pilotStudy({ families: projectionFamilies(), salt: "x" });
  const { plan } = buildPlan(study);
  const approval = { study_id: plan.study_id, plan_sha256: plan.plan_sha256, approved_by: "xz", approved_at: "2026-12-01T00:00:00Z", approval_words: "Yes", max_calls: 720, max_usd: 17, models: plan.models.map((m) => m.model_id) };
  const argv = ["--live", "--yes", "--experiment", plan.study_id, "--max-usd", "17", "--max-calls", "720"];
  const check = (p) => checkLiveAuthorization({ approval, preregistration: { status: "registered", registered_commit_sha: "abc1234" }, plan: p, planSha256: plan.plan_sha256, argv, env: { OMNARAI_LAB_LIVE: "1" } });
  assert.deepEqual(check(plan), [], "the pilot panel passes with its documented controls");
  assert.deepEqual(plan.models.map((m) => m.model_id).sort(), PANEL.map((m) => m.model_id).sort());
  assert.ok(plan.models.every((m) => m.controls), "the plan (and so the approved hash) carries each model's controls");
  const withGrok = { ...plan, models: [...plan.models, { model_id: "grok-4.7", provider: "xai", controls: controlsFor("grok-4.7") }] };
  assert.ok(check(withGrok).some((m) => /grok-4\.7: output cap is not provider-enforced/.test(m)));
  const withOpus = { ...plan, models: [...plan.models, { model_id: "claude-opus-5-5", provider: "anthropic" }] };
  assert.ok(check(withOpus).some((m) => /no documented, provider-enforced output bound on file for claude-opus-5-5/.test(m)));
  const thinkingOn = { ...plan, models: plan.models.map((m) => (m.model_id === "deepseek-v4-pro" ? { ...m, controls: { thinking: { type: "enabled" } } } : m)) };
  assert.ok(check(thinkingOn).some((m) => /deepseek-v4-pro: the plan's reasoning controls differ/.test(m)));
  const noControls = { ...plan, models: plan.models.map(({ controls, ...m }) => m) };
  assert.equal(check(noControls).filter((m) => /controls differ/.test(m)).length, 4);
  assert.ok(capProblems({ model_id: "gpt-6.1-sol", provider: "xai", controls: controlsFor("gpt-6.1-sol") }).some((m) => /differs from the documented provider/.test(m)));
});

test("[K3] the transport sends each provider's documented bound and reasoning controls, keys only in headers", async () => {
  const sent = [];
  const post = async (url, headers, body, timeout) => { sent.push({ url, headers, body: JSON.parse(body), timeout }); return { status: 200, headers: {}, json: {}, text: "{}", duration_ms: 1 }; };
  const keys = { ANTHROPIC_API_KEY: "sk-ant-K", OPENAI_API_KEY: "sk-O", DEEPSEEK_API_KEY: "sk-D", GEMINI_API_KEY: "AIza-G", XAI_API_KEY: "xai-X" };
  const send = createHttpsTransport(keys, { post });
  const input = { system: "SYS", user: "USER" };
  for (const m of [...PANEL, { provider: "xai", model_id: "grok-4.7" }]) await send({ provider: m.provider, model_id: m.model_id, input, max_output_tokens: 3000, timeout_ms: 600000, temperature: 0.3 });
  const [deepseek, gemini, claude, gpt, grok] = sent;
  assert.equal(claude.url, "https://api.anthropic.com/v1/messages");
  assert.equal(claude.headers["anthropic-version"], "2026-10-21");
  assert.deepEqual(claude.body, { model: "claude-sonnet-5-5", max_tokens: 3000, output_config: { effort: "medium" }, system: "SYS", messages: [{ role: "user", content: "USER" }] }, "no thinking override, no temperature");
  assert.equal(gpt.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(gpt.body.max_completion_tokens, 3000);
  assert.equal(gpt.body.reasoning_effort, "medium");
  assert.ok(!("max_tokens" in gpt.body));
  assert.equal(deepseek.url, "https://api.deepseek.com/chat/completions");
  assert.equal(deepseek.body.max_tokens, 3000);
  assert.deepEqual(deepseek.body.thinking, { type: "disabled" });
  assert.equal(gemini.url, "https://generativelanguage.googleapis.com/v1beta/interactions", "the endpoint whose cap includes thought tokens");
  assert.equal(gemini.headers["x-goog-api-key"], "AIza-G");
  assert.ok(!gemini.url.includes("AIza"), "no key in a URL");
  assert.deepEqual(gemini.body.generation_config.max_output_tokens, 3000);
  assert.equal(gemini.body.generation_config.thinking_level, "low");
  assert.equal(gemini.body.system_instruction, "SYS");
  assert.equal(gemini.body.input, "USER");
  assert.equal(gemini.body.store, false);
  assert.equal(grok.body.max_completion_tokens, 3000, "xAI: the non-deprecated field (still not a bound on reasoning)");
  assert.ok(sent.every((r) => r.timeout === 600000));
  for (const r of sent) for (const k of Object.values(keys)) assert.ok(!JSON.stringify(r.body).includes(k), "no key in a body");
});

test("[K4] Gemini Interactions responses: answer text from model_output steps only; billed output = output + thought", () => {
  const res = { status: 200, headers: {}, duration_ms: 5, json: { id: "int_1", model: "gemini-4-carbon", status: "completed", steps: [{ type: "thought", content: [{ type: "text", text: "<answer>decoy</answer>" }] }, { type: "model_output", content: [{ type: "text", text: "<answer>abc</answer>" }] }], usage: { total_input_tokens: 7, total_output_tokens: 23, total_thought_tokens: 49, total_tokens: 79 } } };
  const r = parseProviderResponse("gemini", res);
  assert.equal(r.output, "<answer>abc</answer>");
  assert.deepEqual(r.usage, { in: 7, out: 72 }, "the documented example: 7 + 23 + 49 = 79, so thought tokens are outside total_output_tokens");
  assert.equal(r.provider_returned_model_id, "gemini-4-carbon");
  assert.equal(r.request_id, "int_1");
  assert.equal(parseProviderResponse("gemini", { ...res, json: { ...res.json, status: "incomplete" } }).provider_response_metadata.finish_reason, "incomplete");
  const legacy = parseProviderResponse("gemini", { status: 200, headers: {}, json: { modelVersion: "gemini-x", candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 5 } } });
  assert.deepEqual(legacy.usage, { in: 3, out: 9 }, "the older generateContent shape still parses");
  assert.equal(familyOfModelId("gemini-4-carbon"), "google-gemini");
});

test("[K5] the sealed draw never reuses a calibration family's op set; an empty exclusion changes nothing", () => {
  const plain = drawFamilySet({ seed: "s-1", ...SEALED_DRAW });
  assert.deepEqual(drawFamilySet({ seed: "s-1", ...SEALED_DRAW, exclude: new Set() }), plain, "existing draws are unchanged");
  const cal = calibrationOpSets();
  const forced = new Set([setKey(plain[0].steps.map((s) => s.op))]);
  const redrawn = drawFamilySet({ seed: "s-1", ...SEALED_DRAW, exclude: forced });
  assert.ok(redrawn.every((f) => !forced.has(setKey(f.steps.map((s) => s.op)))), "an excluded op set is never drawn");
  for (let i = 0; i < 40; i++) {
    const fams = drawFamilySet({ seed: `sealed-sim-${i}`, ...SEALED_DRAW, exclude: cal });
    const str = fams.filter((f) => f.domain === "str");
    assert.ok(str.every((f) => f.steps.length === 4 && !cal.has(setKey(f.steps.map((s) => s.op)))));
  }
});

test("[K6] the pilot panel: four families, no overlap between producers and consumers, every bound enforced, 600 s timeout", () => {
  const fam = (ms) => ms.map((m) => familyOfModelId(m.model_id));
  const prod = fam(PILOT_MODELS.producers), cons = fam(PILOT_MODELS.consumers);
  assert.equal(new Set([...prod, ...cons]).size, 4);
  assert.ok(prod.every((f) => !cons.includes(f)));
  assert.ok(PANEL.every((m) => capFor(m.model_id)?.cap_enforced === true && capFor(m.model_id).provider === m.provider));
  assert.ok(!PANEL.some((m) => m.provider === "xai"), "grok-4.7 is out: its reasoning cannot be bounded");
  const study = pilotStudy({ families: projectionFamilies(), salt: "x" });
  assert.equal(study.params.timeout_ms, 600000);
  assert.equal(study.params.max_output_tokens, 3000);
  assert.deepEqual(PANEL.map((m) => [m.model_id, outputCapFor(study.params, m.model_id)]), [["deepseek-v4-pro", 3000], ["gemini-4-carbon", 4500], ["claude-sonnet-5-5", 3000], ["gpt-6.1-sol", 3000]]);
  assert.ok(PANEL.every((m) => study.params.expected_output_tokens_by_model[m.model_id] > 0 && study.params.input_token_factor_by_model[m.model_id] >= 1), "every panel model has probe-2 measurements");
  assert.ok(study.families.filter((f) => f.domain === "str").every((f) => f.steps.length === 4));
  const { plan } = buildPlan(study);
  assert.equal(plan.projection.calls_first_attempt, 344);
  const gem = plan.projection.models.find((m) => m.model_id === "gemini-4-carbon");
  assert.equal(gem.tokens_out_max, 28 * 4500, "Gemini's raised cap is in the worst case");
  assert.ok(plan.projection.usd_worst_first_attempts < 14 && Math.ceil(plan.projection.usd_worst_first_attempts * 1.25) <= 17, String(plan.projection.usd_worst_first_attempts));
});

test("[K7] the runner sends each model's own cap (Gemini 4500, the rest 3000), and the guard pads the input estimate", async () => {
  const sent = [];
  const adapter = { kind: "fake", billable: false, async call(req) { sent.push(req); return { provider_returned_model_id: req.model_id, output: "<answer>zz</answer>", usage: { in: 100, out: 100 }, request_id: "r", duration_ms: 1, provider_response_metadata: {}, error: null }; } };
  const study = pilotStudy({ families: projectionFamilies(), salt: "k7" });
  await runStudy({ study: { ...study, budget: { max_paid_calls: 0, max_usd: 0 } }, adapter, guard: createSpendGuard({ mock: true }) });
  const caps = {};
  for (const r of sent) (caps[r.model_id] ||= new Set()).add(r.max_output_tokens);
  assert.deepEqual(Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, [...v]])), { "deepseek-v4-pro": [3000], "gemini-4-carbon": [4500], "claude-sonnet-5-5": [3000], "gpt-6.1-sol": [3000] });
  assert.ok(sent.every((r) => r.timeout_ms === 600000));
  const g = createSpendGuard({ maxCalls: 5, maxUsd: 5, onDate: "2026-12-01" });
  assert.equal(g.precheck({ provider: "anthropic", model_id: "claude-sonnet-5-5", tokensIn: 1000, maxOut: 0 }).worst_usd, (1000 * 2 * 2) / 1e6, "input counted at twice the estimate");
});
