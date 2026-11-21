// Inheritance Study 001 — Pilot 002 (proposed 2026-11-21; not drawn, registered, approved or run). HERMETIC: fake
// transports only, no key, no network, $0. Sealed sets drawn here are throwaway files in the OS temp directory.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-pilot-002.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as P2 from "./inheritance-001/fixtures/pilot-002.mjs";
import * as P1 from "./inheritance-001/fixtures/pilot-001.mjs";
import { buildPlan, outputCapFor, validateSplit } from "./inheritance-001/lib/plan.mjs";
import { ARMS } from "./inheritance-001/lib/context.mjs";
import { runStudy } from "./inheritance-001/lib/runner.mjs";
import { checkLiveAuthorization, createLiveAdapter, createSpendGuard } from "./inheritance-001/lib/adapters.mjs";
import { capFor } from "./inheritance-001/lib/caps.mjs";
import { familyOfModelId } from "./inheritance-001/lib/identity.mjs";
import { drawFamilySet, setKey } from "./inheritance-001/lib/families.mjs";
import { calibrationOpSets, PROBES } from "./inheritance-001/lib/probe.mjs";
import { createMemoryLabStore, exportRun } from "./inheritance-001/lib/store.mjs";
import { summarizeDir } from "./inheritance-001/lib/pipeline.mjs";
import { replaySpend } from "./inheritance-001/lib/cap-replay.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL = [...P2.PILOT_MODELS.producers, ...P2.PILOT_MODELS.consumers];
const projStudy = (salt = "public-projection-only") => P2.pilotStudy({ families: P2.projectionFamilies(), salt });
const registered = { study_id: P2.STUDY_ID, status: "registered", registered_commit_sha: "abc1234" };
const LANGUAGE_MARK = "Use only these steps";

test("[Z1] Pilot 002 panel: Gemini + GPT produce, Claude Sonnet 5.5 alone consumes; no shared family; every bound enforced", () => {
  assert.deepEqual(P2.PILOT_MODELS.producers.map((m) => m.model_id), ["gemini-4-carbon", "gpt-6.1-sol"]);
  assert.deepEqual(P2.PILOT_MODELS.consumers.map((m) => m.model_id), ["claude-sonnet-5-5"]);
  const prod = P2.PILOT_MODELS.producers.map((m) => familyOfModelId(m.model_id)), cons = P2.PILOT_MODELS.consumers.map((m) => familyOfModelId(m.model_id));
  assert.ok(prod.every((f) => !cons.includes(f)), "no producer family equals the consumer's");
  assert.deepEqual(PANEL.map((m) => familyOfModelId(m.model_id)), PANEL.map((m) => m.expected_family), "expected families match the identity table");
  assert.ok(PANEL.every((m) => capFor(m.model_id)?.cap_enforced === true && capFor(m.model_id).provider === m.provider), "every model has a documented, provider-enforced bound");
  const study = projStudy();
  assert.equal(study.study_id, "IS1-STUDY-PILOT-002");
  assert.deepEqual(validateSplit(study), []);
  assert.equal(study.params.producer_language, true);
  assert.equal(study.params.timeout_ms, 600000);
  assert.equal(study.price_date, "2026-12-01");
  assert.deepEqual(PANEL.map((m) => [m.model_id, outputCapFor(study.params, m.model_id)]), [["gemini-4-carbon", 4500], ["gpt-6.1-sol", 3000], ["claude-sonnet-5-5", 3000]]);
  assert.deepEqual(study.params.expected_output_tokens_by_model, { "claude-sonnet-5-5": 900, "gemini-4-carbon": 1700, "gpt-6.1-sol": 500 });
  assert.ok(PANEL.every((m) => study.params.input_token_factor_by_model[m.model_id] >= 1));
  const { plan } = buildPlan(study);
  assert.ok(plan.models.every((m) => m.controls), "the plan (and so the approved hash) carries each model's controls");
  const approval = { study_id: plan.study_id, plan_sha256: plan.plan_sha256, approved_by: "xz", approved_at: "2026-12-01T00:00:00Z", approval_words: "Yes", max_calls: 688, max_usd: 18, models: plan.models.map((m) => m.model_id) };
  const argv = ["--live", "--yes", "--experiment", plan.study_id, "--max-usd", "18", "--max-calls", "688"];
  const check = (reg, ap = approval) => checkLiveAuthorization({ approval: ap, preregistration: reg, plan, planSha256: plan.plan_sha256, argv, env: { OMNARAI_LAB_LIVE: "1" } });
  assert.deepEqual(check(registered), [], "the panel passes the live gate with a registration of THIS study");
  assert.ok(check({ ...registered, study_id: "IS1-STUDY-PILOT-001" }).includes("the registration is for a different study"), "Pilot 001's registration never counts for Pilot 002");
  assert.ok(check(registered, { ...approval, study_id: "IS1-STUDY-PILOT-001" }).includes("approval names a different study"));
});

test("[Z2] producers are told the program language; the consumer's frame never is", async () => {
  const sent = [];
  const adapter = { kind: "fake", billable: false, async call(req) { sent.push(req); return { provider_returned_model_id: req.model_id, output: "<answer>zz</answer>", usage: { in: 100, out: 100 }, request_id: "r", duration_ms: 1, provider_response_metadata: {}, error: null }; } };
  await runStudy({ study: projStudy("z2"), adapter, guard: createSpendGuard({ mock: true }) });
  const producerReqs = sent.filter((r) => r.tracing_id.startsWith("P-")), consumerReqs = sent.filter((r) => r.tracing_id.startsWith("T-"));
  assert.equal(producerReqs.length, 56);
  assert.equal(consumerReqs.length, 288);
  assert.ok(producerReqs.every((r) => r.input.user.includes(LANGUAGE_MARK) && r.input.user.includes("under 6,000 characters")), "every producer request states the language");
  // the prompt is the JSON-serialized context, so the language's quotes arrive escaped
  const op = (name) => `\\"op\\":\\"${name}\\"`;
  assert.ok(producerReqs.filter((r) => r.domain === "str").every((r) => r.input.user.includes(op("caesar"))));
  assert.ok(producerReqs.filter((r) => r.domain === "num").length === 8 && producerReqs.filter((r) => r.domain === "num").every((r) => r.input.user.includes(op("cumsum"))), "placebo-domain producers get the number language");
  assert.ok(consumerReqs.every((r) => !r.input.user.includes(LANGUAGE_MARK) && !r.input.user.includes("How to write the program") && !r.input.user.includes("under 6,000 characters") && !r.input.user.includes(op("caesar"))), "no consumer frame carries the language");
  assert.ok(producerReqs.every((r) => r.model_id !== "claude-sonnet-5-5") && consumerReqs.every((r) => r.model_id === "claude-sonnet-5-5"));
  const caps = {};
  for (const r of producerReqs) (caps[r.model_id] ||= new Set()).add(r.max_output_tokens);
  assert.deepEqual(Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, [...v]])), { "gemini-4-carbon": [4500], "gpt-6.1-sol": [3000] });
  assert.ok(sent.every((r) => r.timeout_ms === 600000));
});

test("[Z3] 48 paired blocks × 6 arms on one consumer: 6 tasks per held-out family, 56 producer calls, 344 calls in all", () => {
  const { plan } = buildPlan(projStudy());
  assert.equal(plan.blocks.length, 48);
  assert.ok(plan.blocks.every((b) => b.consumer_model_id === "claude-sonnet-5-5" && b.arm_order.length === 6 && new Set(b.arm_order).size === 6 && ARMS.every((a) => b.arm_order.includes(a))), "all six arms in every block");
  const perFamily = {};
  for (const b of plan.blocks) perFamily[b.family_id] = (perFamily[b.family_id] || 0) + 1;
  assert.deepEqual(Object.values(perFamily), Array(8).fill(6), "8 held-out families × 6 tasks");
  assert.equal(plan.generations[0].schedule.length, 288);
  assert.equal(plan.producer_calls.length, 56);
  assert.equal(plan.producer_calls.filter((c) => c.kind === "work").length, 48);
  assert.equal(plan.producer_calls.filter((c) => c.kind === "placebo").length, 8);
  for (const m of P2.PILOT_MODELS.producers) assert.equal(plan.producer_calls.filter((c) => c.model_id === m.model_id).length, 28);
  assert.equal(plan.projection.calls_first_attempt, 344);
  assert.equal(plan.projection.models.find((m) => m.model_id === "gemini-4-carbon").tokens_out_max, 28 * 4500, "Gemini's raised cap is in the worst case");
  assert.ok(plan.projection.usd_worst_first_attempts > 13 && Math.ceil(plan.projection.usd_worst_first_attempts * 1.25) === 18, String(plan.projection.usd_worst_first_attempts));
});

test("[Z4] the plan is deterministic; caps are inside its hash, registration outside; a sealed set or registration of another study is refused", () => {
  const a = buildPlan(projStudy()).plan, b = buildPlan(projStudy()).plan;
  assert.equal(a.plan_sha256, b.plan_sha256);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(buildPlan(projStudy("other-salt")).plan.plan_sha256, a.plan_sha256, "a new salt is a new plan");
  assert.notEqual(buildPlan(P1.pilotStudy({ families: P1.projectionFamilies(), salt: "public-projection-only" })).plan.plan_sha256, a.plan_sha256, "Pilot 002 is not Pilot 001");
  const sealed = { study_id: P2.STUDY_ID, families: P2.projectionFamilies(), salt: "z4" };
  const draft = P2.sealedPilotStudy(sealed, { maxCalls: 688, maxUsd: 18 });
  const h = buildPlan(draft).plan.plan_sha256;
  assert.equal(buildPlan(P2.sealedPilotStudy(sealed, { maxCalls: 688, maxUsd: 18, registration: registered })).plan.plan_sha256, h, "registering does not change the plan");
  assert.notEqual(buildPlan(P2.sealedPilotStudy(sealed, { maxCalls: 688, maxUsd: 6.5 })).plan.plan_sha256, h, "a different cap is a different plan");
  assert.equal(P2.sealedPilotStudy(sealed, { registration: registered }).preregistration.status, "registered");
  assert.equal(P2.sealedPilotStudy(sealed, { registration: { ...registered, study_id: "IS1-STUDY-PILOT-001" } }).preregistration.status, "draft_unregistered", "Pilot 001's registration does not register Pilot 002");
  assert.equal(P2.sealedPilotStudy(sealed, { registration: { ...registered, study_id: undefined } }).preregistration.status, "draft_unregistered", "a registration must name its study");
  assert.throws(() => P2.sealedPilotStudy({ families: sealed.families, salt: "s" }), /SEALED_SET_FOR_ANOTHER_STUDY/, "Pilot 001's sealed file (it names no study) is refused");
  assert.throws(() => P2.sealedPilotStudy({ ...sealed, study_id: "IS1-STUDY-PILOT-001" }), /SEALED_SET_FOR_ANOTHER_STUDY/);
  assert.equal(draft.preregistration.path, "research/inheritance-001/preregistration-002.draft.yaml");
});

test("[Z5] Pilot 001 is untouched: its projection hash and page still reproduce; Pilot 002's committed projection matches the code", () => {
  const p1 = buildPlan(P1.pilotStudy({ families: P1.projectionFamilies(), salt: "public-projection-only" })).plan;
  const committed1 = JSON.parse(readFileSync(join(ROOT, "research/inheritance-001/pilot/pilot-projection.json"), "utf8"));
  assert.equal(p1.plan_sha256, committed1.plan_sha256_of_projection, "Pilot 001's projection plan hash is unchanged");
  assert.equal(p1.study_id, "IS1-STUDY-PILOT-001");
  assert.ok(!("producer_language" in p1.params), "Pilot 001 never told producers the language");
  assert.deepEqual(P1.PILOT_MODELS.consumers.map((m) => m.model_id), ["claude-sonnet-5-5", "gpt-6.1-sol"]);
  const p2 = buildPlan(projStudy()).plan;
  const committed2 = JSON.parse(readFileSync(join(ROOT, "research/inheritance-001/pilot/pilot-002-projection.json"), "utf8"));
  assert.equal(committed2.plan_sha256_of_projection, p2.plan_sha256, "re-run `lab.mjs budget --study pilot-002` after changing the fixture");
  assert.equal(committed2.proposed_caps.usd, 18);
  assert.equal(PROBES["IS1-PROBE-CAL-004"].plan_sha256, "21364b481a1bff27b11cb897984f58b5b530285a96bf749452e3005860eac26a");
});

// ── the Pilot 002 live path end to end, with fake provider responses in each provider's real shape (like [K8]) ─────────
function livePilot002(maxUsd) {
  const study = projStudy("z6");
  const { plan, tasks } = buildPlan(study);
  const byQuery = tasks.map((t) => [`"query":${JSON.stringify(t.public.prompt.query)}`, t.sealed]);
  const seen = [];
  let k = 0;
  const transport = async (req) => {
    seen.push({ model_id: req.model_id, user: req.input.user });
    const s = byQuery.find(([q]) => req.input.user.includes(q))?.[1];
    const right = s && k++ % 3 !== 0;
    // a producer told the language writes a program in it; the consumer answers only
    const program = right && req.input.user.includes(LANGUAGE_MARK) ? `\n\`\`\`program\n${JSON.stringify(s.program)}\n\`\`\`` : "";
    const text = `<answer>${right ? s.expected : "nope"}</answer>${program}`;
    if (req.provider === "anthropic") return { status: 200, headers: { "request-id": "a" }, json: { model: req.model_id, stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 700, output_tokens: 900 } }, duration_ms: 3 };
    if (req.provider === "gemini") return { status: 200, headers: {}, json: { id: "g", model: req.model_id, status: "completed", steps: [{ type: "thought", content: [] }, { type: "model_output", content: [{ type: "text", text }] }], usage: { total_input_tokens: 800, total_output_tokens: 200, total_thought_tokens: 1500, total_tokens: 2500 } }, duration_ms: 3 };
    return { status: 200, headers: { "x-request-id": "o" }, json: { model: req.model_id, choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 800, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 300 } } }, duration_ms: 3 };
  };
  const approval = { study_id: plan.study_id, plan_sha256: plan.plan_sha256, approved_by: "xz", approved_at: "2026-11-21T00:00:00Z", approval_words: "Approved", max_calls: 688, max_usd: maxUsd, models: plan.models.map((m) => m.model_id) };
  const authorization = { approval, preregistration: registered, plan, planSha256: plan.plan_sha256, argv: ["--live", "--yes", "--experiment", plan.study_id, "--max-usd", String(maxUsd), "--max-calls", "688"], env: { OMNARAI_LAB_LIVE: "1" } };
  const adapter = createLiveAdapter({ authorization, keys: { ANTHROPIC_API_KEY: "sk-ant-x-0000000000", OPENAI_API_KEY: "sk-x-000000000000000000", GEMINI_API_KEY: "AIza-x-0000000000000000000" }, transport });
  const guard = createSpendGuard({ maxCalls: 688, maxUsd, onDate: study.price_date });
  return { study: { ...study, budget: { max_paid_calls: 688, max_usd: maxUsd } }, plan, adapter, guard, seen };
}

test("[Z6] a live-shaped Pilot 002 run (fake providers) completes, verifies producer work, puts it in arm C, exports and summarizes", async () => {
  const L = livePilot002(18);
  const store = createMemoryLabStore(), outputs = [];
  const result = await runStudy({ study: L.study, adapter: L.adapter, guard: L.guard, clock: () => "2026-11-21T00:00:00.000Z", store, outputs });
  assert.equal(result.run.status, "completed");
  assert.equal(result.run.kind, "live");
  assert.ok(store.list("evaluation").some((e) => e.status === "passed"), "producer work was verified");
  const trials = store.list("trial");
  assert.equal(trials.length, 288);
  const cTrials = trials.filter((t) => t.arm === "C");
  assert.equal(cTrials.length, 48);
  assert.ok(cTrials.some((t) => t.context.artifact_ids.length > 0), "arm C carried inherited, verified records");
  assert.ok(cTrials.every((t) => t.context.producer_families.every((f) => ["google-gemini", "openai-gpt"].includes(f))), "every inherited record is cross-family");
  assert.ok(L.guard.state.usd > 0 && L.guard.state.usd <= 18, String(L.guard.state.usd));
  assert.ok(L.seen.filter((r) => r.model_id !== "claude-sonnet-5-5").every((r) => r.user.includes(LANGUAGE_MARK)), "every producer request on the wire states the language");
  assert.ok(L.seen.filter((r) => r.model_id === "claude-sonnet-5-5").every((r) => !r.user.includes(LANGUAGE_MARK)), "no consumer request on the wire does");
  const dir = mkdtempSync(join(tmpdir(), "is1-z6-"));
  exportRun(store, dir, { plan: result.plan, sealed: { tasks: result.sealed.tasks, outputs }, sealedDir: join(dir, "sealed") });
  summarizeDir(dir);
  const md = readFileSync(join(dir, "REPORT.md"), "utf8");
  assert.match(md, /Live provider calls: 344/);
  assert.doesNotMatch(md, /NO_INHERITABLE_RECORDS/, "unlike Pilot 001, arm C is not empty");
  assert.match(readFileSync(join(dir, "summary.json"), "utf8"), /IS1-STUDY-PILOT-002/);
});

test("[Z7] the cap replay: at the measured means Pilot 002 finishes under its proposed cap and under $6.50; a lower cap stops early, never past it", async () => {
  const r = await replaySpend(projStudy(), { outputMultiplier: 1 });
  assert.equal(r.calls, 344);
  assert.ok(r.min_cap_to_finish >= r.usd_total && r.min_cap_to_finish < 6.5, String(r.min_cap_to_finish));
  assert.equal(r.atCap(18).completes, true);
  assert.equal(r.atCap(6.5).completes, true);
  const low = r.atCap(4);
  assert.equal(low.completes, false);
  assert.ok(low.calls_done > 56 && low.calls_done < 344 && low.usd_recorded <= 4, JSON.stringify(low));
  assert.ok(low.blocks_with_c_and_aplus < 48 && low.blocks_all_six_arms <= low.blocks_with_c_and_aplus);
  let prev = 0;
  for (const cap of [1, 2, 3, 4, 5, 6]) { const a = r.atCap(cap); assert.ok(a.calls_done >= prev && a.usd_recorded <= cap); prev = a.calls_done; }
  const heavy = await replaySpend(projStudy(), { outputMultiplier: 1.5 });
  assert.ok(heavy.usd_total > r.usd_total && heavy.atCap(6.5).completes === false);
});

// ── the command line: --study pilot-002 draws its own sealed set, plans it, and refuses to run it unregistered ─────────
const lab = (...args) => spawnSync(process.execPath, ["--import", "./scripts/lib/register-mem-blob.mjs", "scripts/inheritance-001/lab.mjs", ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, OMNARAI_LAB_LIVE: "" } });

test("[Z8] lab.mjs --study pilot-002: the sealed draw names its study and excludes calibration (and, if given, earlier) op sets; nothing runs unregistered", () => {
  const dir = mkdtempSync(join(tmpdir(), "is1-z8-"));
  const earlier = join(dir, "earlier-sealed.json");
  const earlierFams = drawFamilySet({ seed: "z8-earlier", ...P1.SEALED_DRAW, exclude: calibrationOpSets() });
  writeFileSync(earlier, JSON.stringify({ drawn_at: "2026-11-20T00:00:00Z", seed: "x", salt: "y", families: earlierFams }));
  const file = join(dir, "pilot-002-sealed.json");
  const d = lab("draw-sealed", "--study", "pilot-002", "--out", file, "--exclude-sealed", earlier);
  assert.equal(d.status, 0, d.stdout + d.stderr);
  const sealed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(sealed.study_id, "IS1-STUDY-PILOT-002");
  assert.equal(sealed.exclusions.calibration_op_sets, calibrationOpSets().size);
  assert.deepEqual(sealed.exclusions.earlier_sealed, [{ study_id: null, drawn_at: "2026-11-20T00:00:00Z", op_sets: 14 }]);
  const forbidden = new Set([...calibrationOpSets(), ...earlierFams.filter((f) => f.domain === "str").map((f) => setKey(f.steps.map((s) => s.op)))]);
  assert.ok(sealed.families.filter((f) => f.domain === "str").every((f) => f.steps.length === 4 && !forbidden.has(setKey(f.steps.map((s) => s.op)))), "no calibration or earlier family is drawn again");
  assert.match(d.stdout, /Sealed set for IS1-STUDY-PILOT-002/);
  assert.doesNotMatch(d.stdout, new RegExp(sealed.seed), "the seed is never printed");
  assert.equal(lab("draw-sealed", "--study", "pilot-002", "--out", file).status, 2, "a sealed file is never overwritten");
  assert.equal(lab("draw-sealed", "--study", "pilot-002", "--out", join(ROOT, "research/inheritance-001/sealed/x.json")).status, 2, "never inside the repository");

  const p = lab("pilot-plan", "--study", "pilot-002", "--sealed", file, "--max-calls", "688", "--max-usd", "18");
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const plan = JSON.parse(p.stdout);
  assert.equal(plan.study_id, "IS1-STUDY-PILOT-002");
  assert.equal(plan.producer_language, true);
  assert.equal(plan.calls_first_attempt, 344);
  assert.deepEqual(plan.caps, { max_paid_calls: 688, max_usd: 18 });
  assert.equal(plan.family_template_commitments.length, 16);
  assert.ok(!p.stdout.includes(sealed.seed) && !p.stdout.includes(sealed.salt), "no sealed content printed");
  assert.equal(lab("pilot-plan", "--study", "pilot-002", "--sealed", earlier).status, 2, "a sealed set not drawn for Pilot 002 is refused");
  assert.equal(lab("pilot-plan", "--sealed", file).status, 2, "Pilot 002's sealed set is refused for Pilot 001");

  const run = lab("run-models", "--study", "pilot-002", "--sealed", file, "--out", join(dir, "run"));
  assert.equal(run.status, 3, run.stdout + run.stderr);
  assert.match(run.stdout, /REFUSED: no model was called and nothing was spent/);
  assert.match(run.stdout, /no approval file/);
  assert.match(run.stdout, /preregistration is not registered/);
  assert.ok(!existsSync(join(dir, "run")), "a refused run writes nothing");
  assert.equal(lab("budget", "--study", "nope").status, 2);
});
