// Inheritance Study 001: the diagnostic re-send (lib/resend.mjs) and the refusal metadata the transport now keeps.
// HERMETIC: runs on the committed offline demo run; no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-resend.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseProviderResponse, anthropicStopDetails, callWithRetries, BudgetExhaustedError } from "./inheritance-001/lib/adapters.mjs";
import { loadRun, rebuildConsumerRequest, buildResendPlan, runResend, summarizeResend } from "./inheritance-001/lib/resend.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = join(ROOT, "research/inheritance-001/examples/demo-positive-shared");

// A copy of the demo run with a call log: the first 5 consumer trials (by id) "refused", every arm-B trial "end_turn".
function demoWithCallLog() {
  const dir = mkdtempSync(join(tmpdir(), "is1-resend-"));
  cpSync(DEMO, dir, { recursive: true });
  const run = loadRun(dir);
  const consumer = run.trials.filter((t) => t.call?.tracing_id).sort((a, b) => a.id.localeCompare(b.id));
  const refused = new Set(consumer.slice(0, 5).map((t) => t.call.tracing_id));
  const lines = consumer.map((t, i) => JSON.stringify({ n: i + 1, tracing_id: t.call.tracing_id, stop: refused.has(t.call.tracing_id) ? "refusal" : "end_turn" }));
  writeFileSync(join(dir, "calls.log.jsonl"), lines.join("\n") + "\n");
  return { dir, refused };
}

test("[RS1] Anthropic stop_details are kept on the call record (category and a short explanation only); other providers unchanged", () => {
  const res = { status: 200, headers: {}, json: { model: "claude-sonnet-5-5", stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 3 }, stop_details: { type: "refusal", category: "frontier_llm", explanation: "x".repeat(500), fallback_credit_token: "opaque" } } };
  const r = parseProviderResponse("anthropic", res);
  assert.equal(r.provider_response_metadata.stop_reason, "refusal");
  assert.deepEqual(Object.keys(r.provider_response_metadata.stop_details).sort(), ["category", "explanation", "type"]);
  assert.equal(r.provider_response_metadata.stop_details.category, "frontier_llm");
  assert.equal(r.provider_response_metadata.stop_details.explanation.length, 300, "explanation is capped");
  assert.equal(anthropicStopDetails(null), null);
  assert.equal(anthropicStopDetails({ type: "refusal", category: null }).category, null, "a null category stays null (a valid state)");
  const ok = parseProviderResponse("anthropic", { status: 200, headers: {}, json: { model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "<answer>a</answer>" }], usage: { input_tokens: 1, output_tokens: 1 } } });
  assert.equal(ok.provider_response_metadata.stop_details, null);
  const oa = parseProviderResponse("openai", { status: 200, headers: {}, json: { model: "gpt-6.1-sol", choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } } });
  assert.equal(oa.provider_response_metadata.stop_details, undefined);
});

test("[RS2] every consumer request of a finished run rebuilds byte-identical from the run's own records; a changed record does not", () => {
  const run = loadRun(DEMO);
  assert.ok(run.trials.length > 100);
  for (const t of run.trials) assert.ok(rebuildConsumerRequest(run, t).matches, `trial ${t.id} rebuilt differently`);
  const t = run.trials.find((x) => x.arm === "C" && x.context.artifact_ids.length);
  const id = t.context.artifact_ids[0];
  const a = run.artifactsById.get(id);
  run.artifactsById.set(id, { ...a, content: { ...a.content, text: a.content.text + " " } });
  assert.equal(rebuildConsumerRequest(run, t).matches, false, "one changed character in a shown record breaks the match");
});

test("[RS3] the plan puts every refused call first (in call order) and one control per family last; a mismatch refuses the plan", () => {
  const { dir, refused } = demoWithCallLog();
  const run = loadRun(dir);
  const plan = buildResendPlan(run, { controls: 8, maxUsd: 0.5, maxCalls: 41, priceDate: "2026-12-01", decisionRule: "test" });
  assert.equal(plan.counts.refused_before, 5);
  assert.deepEqual(plan.calls.slice(0, 5).map((c) => c.kind), Array(5).fill("refused-before"));
  assert.ok(plan.calls.slice(5).every((c) => c.kind === "control" && c.arm === "B"), "controls are arm B and come last");
  assert.equal(new Set(plan.calls.filter((c) => c.kind === "control").map((c) => c.family_id)).size, plan.counts.controls, "one control per family");
  assert.ok(plan.calls.slice(0, 5).every((c) => refused.has(c.source_tracing_id)));
  assert.equal(plan.enters_any_analysis, false);
  assert.match(plan.plan_sha256, /^[0-9a-f]{64}$/);
  assert.equal(buildResendPlan(loadRun(dir), { controls: 8, maxUsd: 0.5, maxCalls: 41, priceDate: "2026-12-01", decisionRule: "test" }).plan_sha256, plan.plan_sha256, "the plan hash is stable");
  const tampered = loadRun(dir);
  const t = tampered.trials.find((x) => refused.has(x.call?.tracing_id));
  t.context = { ...t.context, sha256: "0".repeat(64) };
  assert.throws(() => buildResendPlan(tampered, { controls: 0, decisionRule: "test" }), /RESEND_CONTEXT_MISMATCH/);
});

test("[RS4] the run records each refusal's category, stops at the cap without a partial call, and the cap can only cut controls", async () => {
  const { dir } = demoWithCallLog();
  const run = loadRun(dir);
  const plan = buildResendPlan(run, { controls: 8, maxUsd: 0.5, maxCalls: 41, priceDate: "2026-12-01", decisionRule: "test" });
  let n = 0;
  const adapter = { kind: "fake", async call(req) {
    n++;
    const refuse = req.tracing_id.endsWith("-01") || req.tracing_id.endsWith("-02");
    return parseProviderResponse("anthropic", { status: 200, headers: {}, json: { model: "claude-sonnet-5-5", stop_reason: refuse ? "refusal" : "end_turn", content: refuse ? [] : [{ type: "text", text: "<answer>x</answer>" }], usage: { input_tokens: 100, output_tokens: 50 }, ...(refuse ? { stop_details: { type: "refusal", category: n === 1 ? "general_harms" : null } } : {}) } });
  } };
  // A stub guard: the 7th precheck crosses the cap.
  let checks = 0;
  const guard = { state: { usd: 0 }, precheck() { if (++checks > 6) throw new BudgetExhaustedError("cap"); return { worst_usd: 0.01 }; }, record() { return { usd: 0.005, status: "priced" }; }, assume() { return { usd: 0.01, status: "assumed" }; } };
  const { records, outputs, stopped } = await runResend({ plan, run, adapter, guard, callWithRetries, maxAttempts: 1 });
  assert.equal(records.length, 6);
  assert.equal(stopped.at, plan.calls[6].call_id, "stops before the call that would cross the cap");
  assert.ok(records.slice(0, 5).every((r) => r.kind === "refused-before"), "all refused calls ran before any control");
  assert.equal(records[0].stop_details.category, "general_harms");
  assert.equal(records[1].stop_details.category, null);
  assert.equal(records[2].stop_reason, "end_turn");
  assert.equal(records[2].answer_tag_returned, true);
  assert.equal(outputs.length, 4, "text is kept only for calls that returned text");
  const s = summarizeResend(plan, records, stopped);
  assert.equal(s.refused_before.refused_again, 2);
  assert.deepEqual(s.refused_before.categories, { general_harms: 1, null: 1 });
  assert.equal(s.controls.calls, 1);
});

test("[RS5] lab.mjs resend: offline it prints the plan hash and calls nothing; --live without an approval refuses and writes nothing", () => {
  const { dir } = demoWithCallLog();
  const env = { ...process.env, ANTHROPIC_API_KEY: "", OMNARAI_LAB_LIVE: "" };
  const off = spawnSync(process.execPath, [join(ROOT, "scripts/inheritance-001/lab.mjs"), "resend", "--run", dir, "--max-usd", "0.5", "--max-calls", "41", "--plan-out", join(dir, "p.json")], { encoding: "utf8", env });
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.match(off.stdout, /plan_sha256 [0-9a-f]{64}/);
  assert.equal(JSON.parse(readFileSync(join(dir, "p.json"), "utf8")).kind, "diagnostic-resend");
  const out = mkdtempSync(join(tmpdir(), "is1-resend-out-"));
  const live = spawnSync(process.execPath, [join(ROOT, "scripts/inheritance-001/lab.mjs"), "resend", "--run", dir, "--live", "--yes", "--out", join(out, "r"), "--max-usd", "0.5", "--max-calls", "41"], { encoding: "utf8", env });
  assert.equal(live.status, 3, live.stdout + live.stderr);
  assert.match(live.stdout, /REFUSED: no model was called and nothing was spent/);
  assert.ok(!existsSync(join(out, "r")), "a refused re-send writes nothing");
});
