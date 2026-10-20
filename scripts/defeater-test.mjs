#!/usr/bin/env node
// RDT-A v1 — Dialogical-Defeater Conditions runner. Registration: docs/defeater-conditions-preregistration.md (pushed in
// 14371ea before this file existed). Claim under test: dialogical-defeaters-make-conditions-testable.
//
// For each of the 36 RDT v1 splits, with its RDT v1 sound synthesis held fixed: the author writes a falsification condition
// under arm O (open-ended) and arm D (dialogical defeater); the judge flags each condition for unfalsifiability (RDT v1's
// CHECK_UNF) and relevance; each reviewer is asked to carry out the condition's test in a reply; the judge decides whether it
// did. No engine is involved.
//
//   node scripts/defeater-test.mjs --plan | --stub
//   node scripts/defeater-test.mjs --smoke | --main  --yes --env-file .env.local
//   node scripts/defeater-test.mjs --complete analysis/rdt-a-v1/main-<ts>.json --yes --env-file .env.local
//   node scripts/defeater-test.mjs --analyze analysis/rdt-a-v1/main-<ts>.json
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as V1 from "./lib/rdt-core.mjs";
import * as A from "./lib/rdt-a-core.mjs";
import { chat, firstJSONObject, readKeys } from "./lib/provider-chat.mjs";
import { costUsd, tokensFor, PRICES_AS_OF } from "./lib/model-prices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const has = (f) => args.includes(f);
function writeJSON(file, obj) { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(obj, null, 1)); renameSync(tmp, file); }
const summary = (a) => ({ verdict: a.verdict, paired: a.paired, lost: a.lost, reviewers_used: a.reviewers_used, E_O: a.primary.E_O, E_D: a.primary.E_D, diff: a.primary.diff, p_H1: a.primary.signflip.p, U_O: a.secondary_H2_unfalsifiable.O, U_D: a.secondary_H2_unfalsifiable.D, p_H2: a.secondary_H2_unfalsifiable.test.p, holm: a.holm, R_O: a.relevance.O, R_D: a.relevance.D, guard: a.guard.holds });

if (has("--analyze")) {
  const file = val("--analyze");
  const run = JSON.parse(readFileSync(file, "utf8"));
  const a = A.analyze(run.splits);
  writeJSON(file.replace(/\.json$/, "") + ".analysis.json", { analyzed_at: new Date().toISOString(), mode: run.mode, analysis: a });
  console.log(JSON.stringify({ mode: run.mode, ...summary(a) }, null, 1));
  process.exit(0);
}

const COMPLETE = val("--complete");
const MODE = COMPLETE ? "complete" : has("--main") ? "main" : has("--smoke") ? "smoke" : has("--stub") ? "stub" : has("--plan") ? "plan" : null;
if (!MODE) { console.error("Choose one of --plan, --stub, --smoke, --main, --complete <file> (or --analyze <file>). See the header."); process.exit(2); }
const LIVE = MODE === "smoke" || MODE === "main" || MODE === "complete";
if (LIVE && !has("--yes")) { console.error("This spends real model calls. Run --plan for the estimate, then re-run with --yes."); process.exit(2); }

const P = A.loadPrompts();
const KEYS = LIVE ? readKeys(val("--env-file"), readFileSync) : {};
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", xai: "XAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
const MAX_TOKENS = { cond: 300, judge: 200, test: 900 }; // §6
const OUT_TOKENS = { cond: 90, judge: 15, test: 420 }; // §7 estimate assumptions

let callLog = [], usage = {}, useLive = false;
class ProviderError extends Error {}
async function ask(m, kind, messages) {
  callLog.push({ model: m.model_id, kind, inChars: messages.reduce((s, x) => s + x.content.length, 0), outTokens: OUT_TOKENS[kind] });
  if (!useLive) return { text: stubReply(kind, messages), model: m.model_id };
  let r;
  try { r = await chat(m, messages, { key: KEYS[KEY_ENV[m.provider]], maxTokens: MAX_TOKENS[kind] }); }
  catch (e) { throw new ProviderError(String(e.message || e).slice(0, 240)); }
  const u = (usage[m.model_id] ||= { calls: 0, in: 0, out: 0 });
  u.calls++; u.in += r.usage.in; u.out += r.usage.out;
  return r;
}
async function askJSON(m, kind, prompt, accept) {
  const messages = [{ role: "user", content: prompt }];
  const first = await ask(m, kind, messages);
  const turns = [first.text];
  let value = accept(firstJSONObject(first.text)), reported = first.model;
  if (value == null) {
    const second = await ask(m, kind, [...messages, { role: "assistant", content: first.text || "(empty)" }, { role: "user", content: V1.RETRY_NUDGE }]);
    turns.push(second.text); reported = second.model;
    value = accept(firstJSONObject(second.text));
  }
  return { value, turns, model_reported: reported };
}

// Scripted stand-ins: the open arm writes an outside-evidence condition, the defeater arm an in-exchange one; the stub
// reviewer can only run the latter, and the stub judges key on that.
const OPEN_STUB = "If future interpretability research demonstrated the mechanism, the synthesis would be wrong.";
const DEF_STUB = "A participant could describe one case where both framings prescribe different replies to the same user, which would force the author to abandon the synthesis.";
function stubReply(kind, messages) {
  const u = messages[0].content;
  if (kind === "cond") return JSON.stringify({ falsification_condition: u.includes("dialogical defeater") ? DEF_STUB : OPEN_STUB });
  if (kind === "test") return JSON.stringify(u.includes(OPEN_STUB)
    ? { attempt: "That research does not exist yet, so the test cannot be done here.", condition_met: "cannot be tested here", reasoning: "Needs outside evidence." }
    : { attempt: "Here is the case: a user asks for comfort; one framing prescribes it, the other does not.", condition_met: "no", reasoning: "The case does not separate them." });
  if (kind === "judge") {
    if (u.includes("Decide one thing only: does the deposit contain")) return JSON.stringify({ has_flaw: u.includes(OPEN_STUB) });
    if (u.includes("bears_on_synthesis")) return JSON.stringify({ bears_on_synthesis: true });
    if (u.includes("carried_out")) return JSON.stringify({ carried_out: /Here is the case/.test(u.split("\nREPLY:\n")[1] || "") });
  }
  return "{}";
}

async function runSplit(sp, split, reviewers) {
  sp.arms ||= {};
  for (const arm of A.ARMS) {
    const a = (sp.arms[arm] ||= {});
    try {
      if (!a.condition && !a.lost) {
        const r = await askJSON(V1.AUTHOR, "cond", A.condPrompt(P, arm, split, sp.synthesis), A.parseCondition);
        if (!r.value) { a.lost = "condition-unparseable"; a.turns = r.turns; continue; }
        Object.assign(a, { condition: r.value, turns: r.turns, model_reported: r.model_reported });
        delete a.provider_error;
      }
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      a.provider_error = e.message; continue;
    }
    if (a.lost) continue;
    const dep = { synthesis: sp.synthesis, falsification_condition: a.condition };
    for (const [key, promptFn, field] of [["unf", A.unfPrompt, "has_flaw"], ["relevant", A.relevantPrompt, "bears_on_synthesis"]]) {
      if (`${key}_turns` in a) continue; // a judged call (parsed or not) is final
      try { const r = await askJSON(V1.JUDGE, "judge", promptFn(P, split, dep), (o) => V1.parseBool(o, field)); a[key] = r.value; a[`${key}_turns`] = r.turns; }
      catch (e) { if (!(e instanceof ProviderError)) throw e; a[`${key}_provider_error`] = e.message; }
    }
    a.reviews ||= {};
    await Promise.all(reviewers.map(async (rv) => {
      const slot = (a.reviews[rv.label] ||= {});
      try {
        if (!slot.reply && !slot.missing) {
          const r = await askJSON(rv, "test", A.testPrompt(P, split, dep), A.parseTest);
          if (!r.value) { slot.missing = "unparseable"; slot.turns = r.turns; return; }
          Object.assign(slot, { reply: r.value, turns: r.turns, model_reported: r.model_reported });
          delete slot.provider_error;
        }
        if (slot.reply && !("executed_turns" in slot)) {
          const j = await askJSON(V1.JUDGE, "judge", A.executedPrompt(P, a.condition, slot.reply), (o) => V1.parseBool(o, "carried_out"));
          slot.executed = j.value; slot.executed_turns = j.turns;
        }
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        slot.provider_error = e.message;
      }
    }));
  }
  return sp;
}

// ── run ──────────────────────────────────────────────────────────────────────
const v1 = A.readV1Run();
const mat = A.material(v1);
if (JSON.stringify(mat.map((m) => m.record_id)) !== JSON.stringify(V1.TEST_SPLITS)) throw new Error("material no longer matches RDT v1's registered splits");
const byId = new Map(V1.readAtlas().map((r) => [r.id, r]));
const splitOf = (sp) => V1.splitOf(byId.get(sp.record_id));

const outDir = val("--out") || (LIVE ? join(ROOT, "analysis/rdt-a-v1") : join(tmpdir(), "rdt-a-v1"));
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const hasProviderError = (sp) => A.ARMS.some((a) => { const x = sp.arms?.[a]; return x && (x.provider_error || x.unf_provider_error || x.relevant_provider_error || Object.values(x.reviews || {}).some((s) => s.provider_error)); });

let run, file, splits;
if (MODE === "complete") {
  run = JSON.parse(readFileSync(COMPLETE, "utf8"));
  if (run.completed_by) { console.error(`${COMPLETE} has already had its one --complete pass (§9).`); process.exit(2); }
  splits = run.splits.filter(hasProviderError);
  for (const sp of splits) for (const a of A.ARMS) { const x = sp.arms[a]; if (!x) continue; for (const k of ["unf", "relevant"]) if (x[`${k}_provider_error`]) delete x[`${k}_provider_error`]; }
  file = COMPLETE.replace(/\.json$/, "") + `.completed-${stamp}.json`;
} else {
  splits = MODE === "smoke" ? [A.smokeMaterial()] : (MODE === "stub" && val("--splits") ? mat.slice(0, Number(val("--splits"))) : mat);
  splits = JSON.parse(JSON.stringify(splits));
}

async function runAll(list, concurrency, onSplit) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) {
      const sp = list[next++];
      try { await runSplit(sp, splitOf(sp), A.REVIEWERS); } catch (e) { sp.harness_error = String(e.message).slice(0, 200); }
      if (onSplit) onSplit(sp);
    }
  }));
}

await runAll(JSON.parse(JSON.stringify(splits)), 4);
const est = V1.estimate(callLog, costUsd, tokensFor);
const RESERVE = Math.max(0.25, Math.ceil(est.usd * 1.5 * 100) / 100);
const estimateReport = { mode: MODE, splits: splits.length, calls: est.calls, estimate_usd: Number(est.usd.toFixed(2)), reserve_usd: RESERVE, by_model: Object.fromEntries(Object.entries(est.by_model).map(([k, v]) => [k, { calls: v.calls, usd: Number(v.usd.toFixed(3)) }])), prices: PRICES_AS_OF, output_token_assumptions: OUT_TOKENS };
if (MODE === "plan") { console.log(JSON.stringify(estimateReport, null, 1)); process.exit(0); }

if (LIVE) {
  for (const k of ["ANTHROPIC_API_KEY", ...A.REVIEWERS.map((r) => KEY_ENV[r.provider])]) if (!KEYS[k]) { console.error(`missing ${k}`); process.exit(1); }
  if (!KEYS.BLOB_READ_WRITE_TOKEN && !has("--i-accept-unledgered-spend")) { console.error("No BLOB_READ_WRITE_TOKEN: cannot reserve on the shared ledger. Refusing (or pass --i-accept-unledgered-spend)."); process.exit(1); }
  console.log(`RDT-A v1 ${MODE}: ${splits.length} splits × 2 arms × ${A.REVIEWERS.length} reviewers, ~${est.calls} calls, estimate $${est.usd.toFixed(2)} → reserving $${RESERVE} once on the shared ledger.`);
  if (KEYS.BLOB_READ_WRITE_TOKEN) {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(RESERVE), "--label", `rdt-a-v1 ${MODE}`], { stdio: "inherit", env: { PATH: process.env.PATH, BLOB_READ_WRITE_TOKEN: KEYS.BLOB_READ_WRITE_TOKEN } });
    if (r.status !== 0) { console.error("Budget preflight refused. Nothing was spent."); process.exit(1); }
  }
  callLog = []; usage = {}; useLive = true;
}

if (MODE !== "complete") {
  file = join(outDir, `${MODE}-${stamp}.json`);
  run = {
    study: "RDT-A v1", mode: MODE, registration: { file: A.PREREG, commit: A.PREREG_COMMIT }, started_at: new Date().toISOString(),
    inputs: { rdt_v1_run: { file: A.V1_RUN_FILE, sha256: A.V1_RUN_SHA256 }, rdt_v1_smoke: { file: A.V1_SMOKE_FILE, sha256: A.V1_SMOKE_SHA256 }, atlas: { file: V1.ATLAS_FILE, sha256: V1.ATLAS_SHA256 } },
    author: V1.AUTHOR, judge: V1.JUDGE, reviewers: A.REVIEWERS, estimate: estimateReport,
    note: MODE === "smoke" ? "SMOKE run — excluded from every analysis (§8)." : MODE === "stub" ? "STUB run — scripted models, no real data." : "MAIN run (§9).",
    splits,
  };
} else {
  run.completed_by = { file, at: new Date().toISOString(), splits_retried: splits.map((s) => s.index), estimate: estimateReport };
}
const save = () => { run.usage = usage; run.actual_usd_at_list_prices = Number(Object.entries(usage).reduce((s, [m, u]) => s + costUsd(m, u.in, u.out), 0).toFixed(3)); writeJSON(file, run); };
save();

let done = 0;
await runAll(splits, LIVE ? 3 : 4, (sp) => {
  done++; save();
  if (useLive) {
    const arm = (a) => { const x = sp.arms?.[a]; if (!x) return "-"; if (x.lost) return `LOST(${x.lost})`; return `unf=${x.unf} rel=${x.relevant} exec=${A.REVIEWERS.map((r) => (x.reviews?.[r.label]?.executed === true ? "1" : x.reviews?.[r.label]?.executed === false ? "0" : "?")).join("")}`; };
    console.log(`  [${done}/${splits.length}] #${sp.index} ${sp.flaw}: ${sp.harness_error ? `HARNESS ERROR (${sp.harness_error})` : `O ${arm("O")} · D ${arm("D")}`}`);
  }
});
run.finished_at = new Date().toISOString();
save();

const a = A.analyze(run.splits);
writeJSON(file.replace(/\.json$/, "") + ".analysis.json", { analyzed_at: new Date().toISOString(), mode: run.mode, analysis: a });
console.log(JSON.stringify({ mode: MODE, file, ...summary(a), estimate_usd: estimateReport.estimate_usd, actual_usd: run.actual_usd_at_list_prices }, null, 1));
if (run.mode === "smoke") console.log("Smoke data are excluded from the analysis (§8).");
if (MODE === "stub") console.log("Stub: scripted models; the verdict above only proves the plumbing.");
