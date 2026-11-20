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
import { createSpendGuard, remainingCaps } from "./inheritance-001/lib/adapters.mjs";
import { drawFamilySet, setKey } from "./inheritance-001/lib/families.mjs";
import { calibrationOpSets } from "./inheritance-001/lib/probe.mjs";
import { PILOT_MODELS, pilotStudy, projectionFamilies, SEALED_DRAW, sealedPilotStudy } from "./inheritance-001/fixtures/pilot-001.mjs";
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

// ── [K8] the pilot's live path end to end, with fake provider responses in each provider's real shape ─────────────────
import { mkdtempSync, existsSync as fileExists, readFileSync as readFile } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { createLiveAdapter } from "./inheritance-001/lib/adapters.mjs";
import { createMemoryLabStore, exportRun } from "./inheritance-001/lib/store.mjs";
import { summarizeDir } from "./inheritance-001/lib/pipeline.mjs";

function livePilot(maxUsd) {
  const study = pilotStudy({ families: projectionFamilies(), salt: "k8" });
  const { plan, tasks } = buildPlan(study);
  const byQuery = tasks.map((t) => [`"query":${JSON.stringify(t.public.prompt.query)}`, t.sealed]);
  let k = 0;
  const transport = async (req) => {
    const s = byQuery.find(([q]) => req.input.user.includes(q))?.[1];
    const right = s && k++ % 3 !== 0;
    const text = `<answer>${right ? s.expected : "nope"}</answer>${s && right ? `\n\`\`\`program\n${JSON.stringify(s.program)}\n\`\`\`` : ""}`;
    if (req.provider === "anthropic") return { status: 200, headers: { "request-id": "a" }, json: { model: req.model_id, stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 400, output_tokens: 800 } }, duration_ms: 3 };
    if (req.provider === "gemini") return { status: 200, headers: {}, json: { id: "g", model: req.model_id, status: "completed", steps: [{ type: "thought", content: [] }, { type: "model_output", content: [{ type: "text", text }] }], usage: { total_input_tokens: 400, total_output_tokens: 100, total_thought_tokens: 900, total_tokens: 1400 } }, duration_ms: 3 };
    return { status: 200, headers: { "x-request-id": "o" }, json: { model: req.model_id, choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 400, completion_tokens: 600, completion_tokens_details: { reasoning_tokens: req.provider === "openai" ? 500 : 0 } } }, duration_ms: 3 };
  };
  const approval = { study_id: plan.study_id, plan_sha256: plan.plan_sha256, approved_by: "xz", approved_at: "2026-11-21T00:00:00Z", approval_words: "Approved", max_calls: 688, max_usd: maxUsd, models: plan.models.map((m) => m.model_id) };
  const authorization = { approval, preregistration: { status: "registered", registered_commit_sha: "abc1234" }, plan, planSha256: plan.plan_sha256, argv: ["--live", "--yes", "--experiment", plan.study_id, "--max-usd", String(maxUsd), "--max-calls", "688"], env: { OMNARAI_LAB_LIVE: "1" } };
  const adapter = createLiveAdapter({ authorization, keys: { ANTHROPIC_API_KEY: "sk-ant-x-0000000000", OPENAI_API_KEY: "sk-x-000000000000000000", DEEPSEEK_API_KEY: "sk-y-000000000000000000", GEMINI_API_KEY: "AIza-x-0000000000000000000" }, transport });
  const guard = createSpendGuard({ maxCalls: 688, maxUsd, onDate: study.price_date });
  return { study: { ...study, budget: { max_paid_calls: 688, max_usd: maxUsd } }, plan, adapter, guard };
}

test("[K8] a live-shaped pilot run (fake providers) completes, verifies producer work, exports and summarizes; a budget stop still exports", async () => {
  const L = livePilot(17);
  const store = createMemoryLabStore(), outputs = [];
  const result = await runStudy({ study: L.study, adapter: L.adapter, guard: L.guard, clock: () => "2026-11-21T00:00:00.000Z", store, outputs });
  assert.equal(result.store, store, "the caller's store is the run's store");
  assert.ok(store.list("artifact").length > 0 && store.list("evaluation").length > 0, "producer work was verified");
  assert.ok(L.guard.state.usd > 0 && L.guard.state.usd <= 17, String(L.guard.state.usd));
  const dir = mkdtempSync(joinPath(tmpdir(), "is1-k8-"));
  exportRun(store, dir, { plan: result.plan, sealed: { tasks: result.sealed.tasks, outputs }, sealedDir: joinPath(dir, "sealed") });
  summarizeDir(dir);
  assert.ok(fileExists(joinPath(dir, "summary.json")) && fileExists(joinPath(dir, "REPORT.md")));

  const S = livePilot(0.5);
  const partial = createMemoryLabStore();
  await assert.rejects(runStudy({ study: S.study, adapter: S.adapter, guard: S.guard, clock: () => "2026-11-21T00:00:00.000Z", store: partial, outputs: [] }), /BUDGET_EXHAUSTED/);
  assert.ok(S.guard.state.usd <= 0.5);
  const pdir = mkdtempSync(joinPath(tmpdir(), "is1-k8p-"));
  exportRun(partial, pdir, { plan: S.plan, sealed: { tasks: [], outputs: [] }, sealedDir: joinPath(pdir, "sealed") });
  assert.ok(partial.list("artifact").length > 0, "what ran before the stop is kept");
  assert.ok(readFile(joinPath(pdir, "events.ndjson"), "utf8").length > 0);
});

test("[K9] the plan a live pilot is approved for is the plan it records: caps inside the hash, registration outside it", async () => {
  const sealed = { families: projectionFamilies(), salt: "k9" };
  const draft = sealedPilotStudy(sealed, { maxCalls: 688, maxUsd: 17 });
  const reg = sealedPilotStudy(sealed, { maxCalls: 688, maxUsd: 17, registration: { status: "registered", registered_commit_sha: "abc1234" } });
  const h = buildPlan(draft).plan.plan_sha256;
  assert.equal(buildPlan(reg).plan.plan_sha256, h, "registering does not change the plan");
  assert.notEqual(buildPlan(sealedPilotStudy(sealed, { maxCalls: 688, maxUsd: 18 })).plan.plan_sha256, h, "a different cap is a different plan");
  assert.equal(reg.preregistration.status, "registered");
  assert.equal(sealedPilotStudy(sealed, { registration: { status: "registered", registered_commit_sha: "not-a-sha" } }).preregistration.status, "draft_unregistered");
  const adapter = { kind: "fake", billable: false, async call(req) { return { provider_returned_model_id: req.model_id, output: "<answer>q</answer>", usage: { in: 1, out: 1 }, request_id: "r", duration_ms: 1, provider_response_metadata: {}, error: null }; } };
  const r = await runStudy({ study: reg, adapter, guard: createSpendGuard({ mock: true }) });
  assert.equal(r.run.plan_sha256, h, "the run records the approved hash");
  assert.equal(r.store.list("study")[0].preregistration.status, "registered", "the analysis sees the registration");
});

test("[K10] regression (Pilot 001, first attempt): an oversize producer output is set aside at admission and the run completes", async () => {
  const L = livePilot(17);
  let first = true;
  const long = { ...L.adapter, async call(req) {
    const r = await L.adapter.call(req);
    if (first && req.tracing_id.startsWith("P-") && !r.error) { first = false; return { ...r, output: `${r.output}\n${"x".repeat(9000)}` }; }
    return r;
  } };
  const store = createMemoryLabStore();
  const result = await runStudy({ study: L.study, adapter: long, guard: L.guard, clock: () => "2026-11-21T00:00:00.000Z", store });
  assert.equal(result.run.status, "completed");
  assert.equal(result.run.counters.producer_inadmissible, 1);
  assert.match(result.run.counters.inadmissible[0].reason, /text longer than 8000/);
  assert.ok(result.run.counters.inadmissible[0].text_chars > 8000);
  assert.ok(store.list("artifact").every((a) => a.content.text.length <= 8000), "nothing oversize entered the pool");
  assert.equal(store.list("trial").length, 288);
});

test("[K11] a re-run under the same approval: earlier recorded spend comes off every cap", () => {
  const prior = [{ calls: 57, usd: 1.020741, byProvider: { deepseek: 0.124893, gemini: 0.895848 } }];
  const c = remainingCaps({ maxCalls: 688, maxUsd: 17, perProviderUsd: { anthropic: 7, openai: 7, gemini: 4, deepseek: 1 } }, prior);
  assert.equal(c.maxCalls, 631);
  assert.equal(c.maxUsd, 15.979259);
  assert.deepEqual(c.perProviderUsd, { anthropic: 7, openai: 7, gemini: 3.104152, deepseek: 0.875107 });
  assert.equal(c.prior.usd, 1.020741);
  assert.deepEqual(remainingCaps({ maxCalls: 5, maxUsd: 1 }, []), { maxCalls: 5, maxUsd: 1, perProviderUsd: {}, prior: { attempts: 0, usd: 0, calls: 0, byProvider: {} } });
  assert.equal(remainingCaps({ maxCalls: 5, maxUsd: 1 }, [{ usd: 3, calls: 9 }]).maxUsd, 0, "never negative");
});
