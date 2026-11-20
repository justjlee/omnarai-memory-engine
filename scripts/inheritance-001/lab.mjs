#!/usr/bin/env node
// Inheritance study 001 — one command-line entry point. Run it under the engine's hermetic loader:
//
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/inheritance-001/lab.mjs <command> [options]
//   (or simply: node scripts/inheritance-001/demo.mjs — which does exactly that for the demo)
//
// Offline commands ($0, no network — the guard below refuses every socket):
//   demo [--world W] [--out DIR]          run the full offline pipeline and write plan/snapshot/trials/summary/REPORT
//   summarize --out DIR                   re-derive summary.json + REPORT.md from a run directory's records
//   verify --out DIR                      tamper check: every record sealed, every record in the hash chain
//   validate-instrument [--seeds N]       run every synthetic world over N seeds; detection and false-positive rates
//   budget                                projected calls and dollars for the proposed pilot (stand-in families)
//   plan --world W --out FILE             write a demo plan only
// Gated commands:
//   draw-sealed --out FILE                draw the sealed held-out families from a fresh secret seed (FILE outside the repo)
//   run-models --sealed FILE --approval FILE --out DIR [--live --yes --experiment ID --max-usd N --max-calls N]
//                                         REFUSES unless every live-run condition holds (see lib/adapters.mjs)
//   probe [--probe ID] [--out DIR]        stage-0 calibration probe (default: the latest, IS1-PROBE-CAL-002): offline it
//                                         prints the plan, hash, per-model bounds and worst-case cost;
//         --live --yes --experiment ID --max-usd N --max-calls N --approval FILE --env-file FILE --out DIR
//                                         runs it (arm A, public calibration families) under the same gate, minus registration
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { installNetworkGuard, guardState } from "./lib/hermetic.mjs";
import { runDemo, summarizeDir } from "./lib/pipeline.mjs";
import { verifyRunDir, exportRun } from "./lib/store.mjs";
import { buildPlan } from "./lib/plan.mjs";
import { runStudy } from "./lib/runner.mjs";
import { createMockAdapter } from "./lib/mock-model.mjs";
import { analyze } from "./lib/analyze.mjs";
import { simulatePower } from "./lib/stats.mjs";
import { demoStudy, WORLDS } from "./fixtures/worlds.mjs";
import { pilotStudy, projectionFamilies, PILOT_MODELS, SEALED_DRAW } from "./fixtures/pilot-001.mjs";
import { drawFamilySet } from "./lib/families.mjs";
import { familyRecord } from "./lib/tasks.mjs";
import { checkLiveAuthorization, createLiveAdapter, createSpendGuard } from "./lib/adapters.mjs";
import { priceFor, PRICES_AS_OF } from "./lib/prices.mjs";
import { envValue } from "../lib/env-value.mjs";
import { buildProbe, runProbe, renderProbe, PROBES, LATEST_PROBE_ID, calibrationOpSets } from "./lib/probe.mjs";
import { capFor, CAPS_READ_ON } from "./lib/caps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RESEARCH = join(ROOT, "research/inheritance-001");
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, dflt = undefined) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt; };
const insideRepo = (p) => { const r = relative(ROOT, resolve(p)); return !r.startsWith("..") && !isAbsolute(r); };
const out = (...a) => process.stdout.write(a.join(" ") + "\n");

const OFFLINE = ["demo", "summarize", "verify", "validate-instrument", "budget", "plan", "draw-sealed"];
if (OFFLINE.includes(cmd) || (cmd === "probe" && !argv.includes("--live"))) installNetworkGuard();

async function demo() {
  const world = opt("--world", "positive-shared");
  const outDir = resolve(opt("--out", join(RESEARCH, "examples", `demo-${world}`)));
  const { report, verification, result } = await runDemo({ world, outDir, resamples: Number(opt("--resamples", 2000)) });
  out(`Inheritance Study 001 — offline demo, world "${world}". NOT EVIDENCE: a deterministic mock in a synthetic world.`);
  out(`  ${result.store.list("trial").length} trials, ${result.store.list("artifact").length} artifacts, ${result.store.list("snapshot").length} snapshots; spend $0; network attempts blocked: ${guardState.blocked.length}`);
  out(`  primary C−A+ = ${report.primary.estimate} [${report.primary.ci_low}, ${report.primary.ci_high}] (${report.primary.classification}); ratchet claim permitted: ${report.ratchet.claim_permitted}`);
  out(`  flags: ${report.flags.map((f) => f.code).join(", ") || "none"}`);
  out(`  tamper check: ${verification.ok ? "intact" : "FAILED " + verification.problems.slice(0, 3).join("; ")}`);
  out(`  outputs: ${outDir}/{plan.json, snapshot.json, trials.jsonl, summary.json, REPORT.md, events.ndjson}`);
  if (!verification.ok || guardState.blocked.length) process.exit(1);
}

async function validateInstrument() {
  const seeds = Number(opt("--seeds", 20));
  const resamples = Number(opt("--resamples", 500));
  const outDir = resolve(opt("--out", join(RESEARCH, "examples", "instrument-validation")));
  const rows = {};
  for (const world of Object.keys(WORLDS)) {
    const tally = {};
    for (let s = 1; s <= seeds; s++) {
      const { study, mockWorld } = demoStudy({ world, seed: 1000 + s, resamples });
      const r = await runStudy({ study, adapter: createMockAdapter(mockWorld) });
      const L = (k) => r.store.list(k);
      const { report } = analyze({ study: L("study")[0], plan: r.plan, trials: L("trial"), snapshots: L("snapshot"), artifacts: L("artifact"), evaluations: L("evaluation"), runs: L("run") });
      for (const [k, c] of Object.entries(report.contrasts.pooled)) {
        const t = (tally[k] ||= { positive: 0, negative: 0, "null-or-inconclusive": 0, "no-interval": 0, estimates: [] });
        t[c.classification]++; t.estimates.push(c.estimate);
      }
    }
    rows[world] = { truth: WORLDS[world].truth, seeds, contrasts: Object.fromEntries(Object.entries(tally).map(([k, t]) => [k, { positive_rate: +(t.positive / seeds).toFixed(3), negative_rate: +(t.negative / seeds).toFixed(3), null_rate: +(t["null-or-inconclusive"] / seeds).toFixed(3), mean_estimate: +(t.estimates.reduce((a, b) => a + b, 0) / seeds).toFixed(4) }])) };
    out(`  ${world}: C−A+ positive ${rows[world].contrasts["C-A+"].positive_rate}, negative ${rows[world].contrasts["C-A+"].negative_rate}; C−E positive ${rows[world].contrasts["C-E"].positive_rate}; E−A positive ${rows[world].contrasts["E-A"].positive_rate}`);
  }
  const power = [];
  for (const families of [8, 16, 24, 32]) for (const effect of [0, 0.1, 0.15, 0.2]) power.push(simulatePower({ families, tasksPerFamily: 3, consumers: 2, baseRate: 0.4, effect, familySd: 0.1, sims: 300, resamples: 300, seed: families * 100 + Math.round(effect * 100) }));
  mkdirSync(outDir, { recursive: true });
  const result = { note: "Synthetic worlds with known truth. Rates are over seeds (different tasks and mock orderings). Mock outcomes: NOT evidence about any model.", seeds, resamples, worlds: rows, power_parametric: power };
  writeFileSync(join(outDir, "instrument-validation.json"), JSON.stringify(result, null, 2) + "\n");
  const keys = ["C-A+", "C-A", "C-B", "C-D", "C-E", "A+-A", "E-A"];
  const md = [
    "# Instrument validation (synthetic worlds, NOT evidence)", "",
    `Each world fixes the true answer; the instrument is run ${seeds} times per world (different seeds → different tasks and mock orderings) without being told the world. Cells: share of runs whose 95% family-cluster interval was entirely above 0 / entirely below 0.`, "",
    `| World | Truth | ${keys.join(" | ")} |`, `|---|---|${keys.map(() => "---").join("|")}|`,
    ...Object.entries(rows).map(([w, r]) => `| ${w} | ${r.truth} | ${keys.map((k) => `${r.contrasts[k].positive_rate} / ${r.contrasts[k].negative_rate}`).join(" | ")} |`),
    "", "Reading it: in `inert` every contrast except those involving A+ has a true value of 0, so its positive/negative rates are the false-positive rate (expect about 0.025 each side, plus Monte Carlo noise at this number of seeds).", "",
    "## Parametric power of the cluster interval (Bernoulli outcomes, family random effect sd 0.1, base rate 0.4, 3 tasks × 2 consumers per family)", "",
    "| Held-out families | True effect | Power (interval above 0) | Wrong-sign rate |", "|---:|---:|---:|---:|",
    ...power.map((p) => `| ${p.families} | ${p.true_effect} | ${p.power} | ${p.wrong_sign_rate} |`), "",
  ].join("\n");
  writeFileSync(join(outDir, "INSTRUMENT-VALIDATION.md"), md);
  out(`  wrote ${outDir}/INSTRUMENT-VALIDATION.md`);
}

function budget() {
  const families = projectionFamilies();
  const study = pilotStudy({ families, salt: "public-projection-only" });
  const { plan } = buildPlan(study);
  const outDir = resolve(opt("--out", join(RESEARCH, "pilot")));
  mkdirSync(outDir, { recursive: true });
  const probePlan = buildProbe().plan;
  const calibCalls = probePlan.calls.length, calibUsd = probePlan.projection.usd_worst;
  const P = plan.projection;
  const power = [0.1, 0.15, 0.2].map((effect) => simulatePower({ families: 8, tasksPerFamily: 3, consumers: 2, baseRate: 0.4, effect, sims: 400, resamples: 400, seed: 8 + effect * 100 }));
  const capUsd = Math.ceil((P.usd_worst_first_attempts + calibUsd) * 1.25);
  const proj = { projection_only: true, stand_in_families: "public draw 'public-projection-only' — the sealed set is drawn at registration", plan_sha256_of_projection: plan.plan_sha256, steps_per_family: SEALED_DRAW.steps, calibration_stage: { probe: probePlan.study_id, plan_sha256: probePlan.plan_sha256, calls: calibCalls, usd_worst: calibUsd }, projection: P, blocks: plan.blocks.length, producer_calls: plan.producer_calls.length, proposed_caps: { calls: P.calls_max_with_retries + calibCalls, usd: capUsd }, output_bounds: plan.models.map((m) => { const c = capFor(m.model_id); return { model_id: m.model_id, field: c?.cap_field ?? null, enforced: c?.cap_enforced ?? false, controls: c?.controls ?? null, status: c?.status ?? "no entry" }; }), power_at_8_families: power };
  writeFileSync(join(outDir, "pilot-projection.json"), JSON.stringify(proj, null, 2) + "\n");
  const money = (x) => (x === null ? "unknown" : `$${x.toFixed(2)}`);
  const ctl = (c) => (c ? Object.entries(c).map(([k, v]) => `\`${k}: ${JSON.stringify(v).replace(/"/g, "")}\``).join(", ") : "—");
  const md = [
    "# Pilot 001: projected calls and dollars (PROJECTION, nothing has been spent)", "",
    `Prices: ${PRICES_AS_OF}; priced for a run on ${study.price_date} (Gemini 4 Carbon's higher December price). Input tokens are estimated from the real prompt frame at 4 characters per token. Output: the cap is ${study.params.max_output_tokens} tokens per call, a bound each provider documents as covering all billed output, reasoning included; the expected figure, ${study.params.expected_output_tokens}, is the measured median of \`claude-sonnet-5-5\` in calibration probe 1 (1,328 tokens on 3-step tasks), rounded up, and is ASSUMED for the other three models until probe 2 measures them. Timeouts: 600 s, and a call that times out is charged at its worst case.`, "",
    "## Design", "",
    `- One transition: generation-0 producers (${PILOT_MODELS.producers.map((m) => `\`${m.model_id}\``).join(", ")}) → generation-1 consumers (${PILOT_MODELS.consumers.map((m) => `\`${m.model_id}\``).join(", ")}). No producer family is a consumer family. \`grok-4.7\` left the panel on 2026-11-20: xAI documents no request field that bounds its reasoning tokens (see PROVIDER-CAPS.md).`,
    `- Task families are ${SEALED_DRAW.steps}-step compositions (probe 1 found 3-step families too easy for the one fully measured consumer). The sealed draw excludes every calibration family's op set.`,
    `- ${families.filter((f) => f.role === "work").length} work families × ${study.tasks.per_work_family} tasks × ${PILOT_MODELS.producers.length} producers = ${plan.producer_calls.filter((c) => c.kind === "work").length} producer calls, plus ${plan.producer_calls.filter((c) => c.kind === "placebo").length} placebo-domain producer calls.`,
    `- ${families.filter((f) => f.role === "eval-anchor").length} held-out families × ${study.tasks.per_eval_family} tasks × ${PILOT_MODELS.consumers.length} consumers = ${plan.blocks.length} paired blocks × 6 arms = ${plan.blocks.length * 6} consumer calls. No ablations in this pilot.`,
    `- Stage 0 (before registration): calibration probe \`${probePlan.study_id}\`, arm A only, ${calibCalls} calls on public calibration families with this exact panel and cap, worst case ${money(calibUsd)} (plan \`${probePlan.plan_sha256.slice(0, 12)}…\`).`, "",
    "## Per-call output bounds (checked by the live gate)", "",
    "| Model | Bound field | Reasoning controls sent | Documented status |", "|---|---|---|---|",
    ...plan.models.map((m) => { const c = capFor(m.model_id); return `| \`${m.model_id}\` | \`${c?.cap_field ?? "none"}\` | ${ctl(c?.controls)} | ${c?.status ?? "no entry: refused"} |`; }),
    "", `Docs read on ${CAPS_READ_ON}; sources and quotes in \`PROVIDER-CAPS.md\`.`, "",
    "## Money", "",
    "| Model | Role | Calls | Tokens in | Out (expected) | Out (cap) | $/M in, out | Expected | Worst (first attempts) | Worst (with retries) |", "|---|---|---:|---:|---:|---:|---|---:|---:|---:|",
    ...P.models.map((m) => `| \`${m.model_id}\` | ${Object.keys(m.by_kind).join(", ")} | ${m.calls} | ${m.tokens_in} | ${m.tokens_out_expected} | ${m.tokens_out_max} | ${m.price_per_m ? `${m.price_per_m.in}, ${m.price_per_m.out}` : "unknown"} | ${money(m.usd_expected)} | ${money(m.usd_worst_first_attempts)} | ${money(m.usd_worst_with_retries)} |`),
    `| **Total** | | **${P.calls_first_attempt}** (≤ ${P.calls_max_with_retries} with retries) | | | | | **${money(P.usd_expected)}** | **${money(P.usd_worst_first_attempts)}** | **${money(P.usd_worst_with_retries)}** |`, "",
    `Proposed hard caps for approval (after probe 2): **${P.calls_max_with_retries + calibCalls} calls** and **$${capUsd}** (worst case of first attempts plus the probe, plus 25%). The spend guard stops before any call whose worst case would cross the cap, a timed-out call is charged at its worst case, and the shared $95 ledger reserve must also succeed. Retries happen only on rate limits and server errors, never on timeouts.`, "",
    "## What this pilot can and cannot show", "",
    "- It can show whether the machinery works on real providers (returned ids, usage, refusals, timeouts) and give first, descriptive estimates of C−A+, C−E, C−B and C−D.",
    "- It cannot confirm H1–H3: 8 held-out families is below the preregistered minimum of 10 clusters for inference, so every verdict is descriptive. It cannot test a ratchet at all (one transition).",
    "- Parametric power at 8 families (3 tasks × 2 consumers each, base rate 0.4):", "",
    "| True effect | Power | Wrong-sign rate |", "|---:|---:|---:|", ...power.map((p) => `| ${p.true_effect} | ${p.power} | ${p.wrong_sign_rate} |`), "",
  ].join("\n");
  writeFileSync(join(outDir, "PILOT-BUDGET.md"), md + "\n");
  out(`Pilot projection: ${P.calls_first_attempt} calls (≤ ${P.calls_max_with_retries} with retries) + ${calibCalls} probe calls; expected ${money(P.usd_expected)}, worst ${money(P.usd_worst_first_attempts)} (with retries ${money(P.usd_worst_with_retries)}); proposed cap $${capUsd}. Wrote ${outDir}/PILOT-BUDGET.md`);
}

function drawSealed() {
  const file = opt("--out");
  if (!file) { out("draw-sealed needs --out FILE (outside the repository)"); process.exit(2); }
  if (insideRepo(file)) { out(`REFUSED: ${file} is inside the repository. Sealed material must live outside it (e.g. Claude/omnarai-private/inheritance-001/).`); process.exit(2); }
  if (existsSync(file)) { out(`REFUSED: ${file} exists; sealed sets are never overwritten.`); process.exit(2); }
  const seed = randomBytes(32).toString("hex"), salt = randomBytes(32).toString("hex");
  // Never a family any calibration probe has already put in front of a model (op-set level, like the held-out split).
  const families = drawFamilySet({ seed, ...SEALED_DRAW, exclude: calibrationOpSets() });
  const records = families.map((spec) => familyRecord(spec, { studyId: "IS1-STUDY-PILOT-001", salt }));
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify({ drawn_at: new Date().toISOString(), seed, salt, families }, null, 2) + "\n", { mode: 0o600 });
  out(`Sealed set written to ${file} (mode 600). Public commitments (safe to publish in the registration):`);
  for (const r of records) out(`  ${r.id} ${r.role} ${r.template_commitment_sha256}`);
}

async function runModels() {
  const sealedFile = opt("--sealed"), approvalFile = opt("--approval"), outDir = opt("--out");
  const problems = [];
  if (!sealedFile || !existsSync(sealedFile)) problems.push("--sealed FILE (from draw-sealed) is required");
  else if (insideRepo(realpathSync(sealedFile))) problems.push("the sealed file is inside the repository");
  if (!outDir) problems.push("--out DIR for private results is required");
  else if (insideRepo(outDir)) problems.push("results of a live run are private until review: --out must be outside the repository");
  if (problems.length) { out(`REFUSED: ${problems.join("; ")}`); process.exit(3); }
  const sealed = JSON.parse(readFileSync(sealedFile, "utf8"));
  const study = pilotStudy({ families: sealed.families, salt: sealed.salt });
  const { plan } = buildPlan(study);
  const registration = existsSync(join(RESEARCH, "registration.json")) ? JSON.parse(readFileSync(join(RESEARCH, "registration.json"), "utf8")) : { status: "draft_unregistered" };
  const approval = approvalFile && existsSync(approvalFile) ? JSON.parse(readFileSync(approvalFile, "utf8")) : null;
  const authorization = { approval, preregistration: registration, plan, planSha256: plan.plan_sha256, argv: process.argv, env: process.env };
  const missing = checkLiveAuthorization(authorization);
  if (missing.length) {
    out("REFUSED: no model was called and nothing was spent. Missing:");
    for (const m of missing) out(`  - ${m}`);
    out(`Plan ${plan.plan_sha256} projects ${plan.projection.calls_first_attempt} calls, worst case $${plan.projection.usd_worst_first_attempts}.`);
    process.exit(3);
  }
  // Every condition holds. Reserve the worst case on the shared ledger first (fails closed), then run.
  const envFile = opt("--env-file");
  const keys = {};
  // envValue: the engine's own reader (vercel env pull writes quoted values, some with a literal \n — see its header)
  if (envFile) for (const line of readFileSync(envFile, "utf8").split("\n")) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line); if (m) keys[m[1]] = envValue(m[2]); }
  const reserve = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(approval.max_usd), "--label", `inheritance-001 ${plan.study_id}`], { env: { ...process.env, BLOB_READ_WRITE_TOKEN: keys.BLOB_READ_WRITE_TOKEN || "" }, stdio: "inherit" });
  if (reserve.status !== 0) { out("REFUSED: the shared budget ledger did not accept the reservation."); process.exit(3); }
  const killFile = join(RESEARCH, "KILL");
  const guard = createSpendGuard({ maxCalls: approval.max_calls, maxUsd: approval.max_usd, perProviderUsd: approval.per_provider_usd || {}, onDate: study.price_date, killSwitch: () => existsSync(killFile) });
  const adapter = createLiveAdapter({ authorization, keys });
  const result = await runStudy({ study: { ...study, budget: { max_paid_calls: approval.max_calls, max_usd: approval.max_usd } }, adapter, guard, clock: () => new Date().toISOString(), timer: () => performance.now() });
  exportRun(result.store, outDir, { plan: result.plan, sealed: result.sealed, sealedDir: join(outDir, "sealed") });
  summarizeDir(outDir);
  out(`Live run finished: ${guard.state.calls} calls, $${guard.state.usd.toFixed(4)}. Results (private): ${outDir}`);
}

const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", xai: "XAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };

async function probe() {
  const id = opt("--probe", LATEST_PROBE_ID);
  if (!Object.hasOwn(PROBES, id)) { out(`unknown probe ${id}; known: ${Object.keys(PROBES).join(", ")}`); process.exit(2); }
  const { plan, tasks, contexts } = buildProbe({ probe: PROBES[id] });
  const live = argv.includes("--live");
  const outDir = opt("--out");
  if (!live) {
    out(`Probe ${plan.study_id} (offline preview, nothing called; ${PROBES[id].status}): ${plan.calls.length} calls, arm A, ${plan.families.length} public calibration families.`);
    out(`  plan_sha256 ${plan.plan_sha256}`);
    for (const m of plan.projection.by_model) { const c = capFor(m.model_id); out(`  ${m.model_id}${m.role ? ` (${m.role})` : ""}: ${m.calls} calls, worst case $${m.usd_worst}; bound ${c?.cap_field ?? "none"} = ${plan.params.max_output_tokens}${c ? `, ${c.cap_enforced ? "provider-enforced" : "NOT enforced"}` : ", no entry"}`); }
    out(`  worst case total $${plan.projection.usd_worst}; timeout ${plan.params.timeout_ms / 1000} s per call, timed-out calls charged at worst case`);
    if (outDir) { mkdirSync(resolve(outDir), { recursive: true }); writeFileSync(join(resolve(outDir), `${plan.study_id}-plan.json`), JSON.stringify(plan, null, 2) + "\n"); }
    return;
  }
  const approvalFile = opt("--approval"), envFile = opt("--env-file");
  const problems = [];
  if (!outDir || insideRepo(outDir)) problems.push("--out DIR outside the repository is required (probe results are private until reviewed)");
  if (!envFile || !existsSync(envFile)) problems.push("--env-file FILE with the provider keys is required");
  const approval = approvalFile && existsSync(approvalFile) ? JSON.parse(readFileSync(approvalFile, "utf8")) : null;
  const authorization = { approval, preregistration: null, plan, planSha256: plan.plan_sha256, argv: process.argv, env: process.env, requireRegistration: false };
  const missing = [...problems, ...checkLiveAuthorization(authorization)];
  if (missing.length) { out("REFUSED: no model was called and nothing was spent. Missing:"); for (const m of missing) out(`  - ${m}`); process.exit(3); }
  const need = [...new Set(plan.models.map((m) => KEY_ENV[m.provider]))];
  const keys = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line); if (m && [...need, "BLOB_READ_WRITE_TOKEN"].includes(m[1])) keys[m[1]] = envValue(m[2]); }
  for (const k of [...need, "BLOB_READ_WRITE_TOKEN"]) if (!keys[k]) { out(`REFUSED: ${k} not found in the env file. Nothing was called.`); process.exit(3); }
  const reserve = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(approval.max_usd), "--label", `inheritance-001 ${plan.study_id}`], { env: { ...process.env, BLOB_READ_WRITE_TOKEN: keys.BLOB_READ_WRITE_TOKEN }, stdio: "inherit" });
  if (reserve.status !== 0) { out("REFUSED: the shared budget ledger did not accept the reservation. Nothing was called."); process.exit(3); }
  const killFile = join(RESEARCH, "KILL");
  const guard = createSpendGuard({ maxCalls: approval.max_calls, maxUsd: approval.max_usd, perProviderUsd: approval.per_provider_usd || {}, onDate: PROBES[id].price_date, killSwitch: () => existsSync(killFile) });
  const adapter = createLiveAdapter({ authorization, keys: Object.fromEntries(need.map((k) => [k, keys[k]])) });
  const ranAt = new Date().toISOString();
  const { records, outputs, summary } = await runProbe({ plan, tasks, contexts, adapter, guard, onCall: (r) => out(`  ${r.call_id} ${r.model_id} -> ${r.outcome}${r.stopped_at_cap ? " (cap)" : ""}${r.cap_check && !r.cap_check.ok ? " OVER CAP" : ""} out=${r.usage?.out ?? "?"} $${r.cost_usd ?? "?"}`) });
  const dir = resolve(outDir);
  mkdirSync(join(dir, "raw"), { recursive: true });
  writeFileSync(join(dir, "probe-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  writeFileSync(join(dir, "probe-records.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(dir, "probe-summary.json"), JSON.stringify({ ...summary, ran_at: ranAt, guard: guard.state }, null, 2) + "\n");
  writeFileSync(join(dir, "raw", "outputs.jsonl"), outputs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(dir, "raw", "tasks.sealed.jsonl"), tasks.map((t) => JSON.stringify(t.sealed)).join("\n") + "\n");
  writeFileSync(join(dir, "PROBE-RESULTS.md"), renderProbe(summary, { approvedWords: approval.approval_words, ranAt }));
  out(`Probe finished: ${summary.calls_made} calls, recorded $${summary.spend_usd_recorded}. Results (private): ${dir}`);
}

function planCmd() {
  const { study } = demoStudy({ world: opt("--world", "positive-shared") });
  const { plan } = buildPlan(study);
  const file = resolve(opt("--out", "plan.json"));
  writeFileSync(file, JSON.stringify(plan, null, 2) + "\n");
  out(`plan ${plan.plan_sha256} → ${file}`);
}

const COMMANDS = { demo, summarize: () => { const d = resolve(opt("--out")); const r = summarizeDir(d); out(`summary ${r.id} → ${d}/summary.json, REPORT.md`); }, verify: () => { const r = verifyRunDir(resolve(opt("--out"))); out(JSON.stringify(r)); if (!r.ok) process.exit(1); }, "validate-instrument": validateInstrument, budget, plan: planCmd, "draw-sealed": drawSealed, "run-models": runModels, probe };
if (!COMMANDS[cmd]) { out(`usage: lab.mjs <${Object.keys(COMMANDS).join("|")}> [options]`); process.exit(2); }
await COMMANDS[cmd]();
