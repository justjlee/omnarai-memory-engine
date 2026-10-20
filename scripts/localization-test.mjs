#!/usr/bin/env node
// RDT-L v1 — Forced-Localization Review runner. Registration: docs/localization-review-preregistration.md (pushed in
// c7ba356 before this file existed). Claim under test: localization-review-widens-flaw-discrimination.
//
// For each of the 22 RDT v1 pairs that passed its manipulation check: every reviewer reviews the sound deposit and the
// flawed twin under arm B (RDT v1's REVIEW prompt, byte-identical) and arm L (LOCALIZE), in separate stateless calls;
// the RDT v1 NAMED judge scores whether each review of the twin identifies the planted flaw. No engine is involved.
//
//   node scripts/localization-test.mjs --plan                                   # cost estimate; no calls, no keys
//   node scripts/localization-test.mjs --stub                                   # scripted models, free (tests)
//   node scripts/localization-test.mjs --smoke --yes --env-file .env.local
//   node scripts/localization-test.mjs --main --yes --env-file .env.local
//   node scripts/localization-test.mjs --complete analysis/rdt-l-v1/main-<ts>.json --yes --env-file .env.local
//   node scripts/localization-test.mjs --analyze analysis/rdt-l-v1/main-<ts>.json
//
// Live modes reserve the estimate ONCE on the shared ledger before the first paid call; the run file is rewritten after
// every finished pair.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as V1 from "./lib/rdt-core.mjs";
import * as L from "./lib/rdt-l-core.mjs";
import { chat, firstJSONObject, readKeys } from "./lib/provider-chat.mjs";
import { costUsd, tokensFor, PRICES_AS_OF } from "./lib/model-prices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const has = (f) => args.includes(f);
function writeJSON(file, obj) { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(obj, null, 1)); renameSync(tmp, file); }
function summary(a) {
  const g = a.descriptive.by_reviewer["GPT-4o"];
  return { verdict: a.verdict, pairs: a.pairs, reviewers_used: a.reviewers_used, observations: a.primary.observations, ratify: a.primary.ratify, D_B: a.primary.D_B, D_L: a.primary.D_L, W: a.primary.W, p: a.primary.signflip.p, guard: a.guard.holds, gpt4o: g ? { ratify: g.ratify, W: g.W } : null };
}

if (has("--analyze")) {
  const file = val("--analyze");
  const run = JSON.parse(readFileSync(file, "utf8"));
  const a = L.analyze(run.pairs);
  writeJSON(file.replace(/\.json$/, "") + ".analysis.json", { analyzed_at: new Date().toISOString(), mode: run.mode, analysis: a });
  console.log(JSON.stringify({ mode: run.mode, ...summary(a) }, null, 1));
  process.exit(0);
}

const COMPLETE = val("--complete");
const MODE = COMPLETE ? "complete" : has("--main") ? "main" : has("--smoke") ? "smoke" : has("--stub") ? "stub" : has("--plan") ? "plan" : null;
if (!MODE) { console.error("Choose one of --plan, --stub, --smoke, --main, --complete <file> (or --analyze <file>). See the header."); process.exit(2); }
const LIVE = MODE === "smoke" || MODE === "main" || MODE === "complete";
if (LIVE && !has("--yes")) { console.error("This spends real model calls. Run --plan for the estimate, then re-run with --yes."); process.exit(2); }

const P = L.loadPrompts();
const KEYS = LIVE ? readKeys(val("--env-file"), readFileSync) : {};
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", xai: "XAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
const MAX_TOKENS = { review_B: 900, review_L: 900, named: 200 }; // §6
const OUT_TOKENS = { review_B: 380, review_L: 480, named: 15 }; // §7 estimate assumptions

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

// Scripted stand-ins: under B the stub ratifies everything (the GPT-4o pattern); under L it finds the planted twin
// (the RDT v1 twins carry no marker, so the stub keys on the deposit text the harness hands it).
let STUB_FLAWED = new Set();
function stubReply(kind, messages) {
  const u = messages[0].content;
  const isTwin = [...STUB_FLAWED].some((t) => u.includes(t));
  if (kind === "review_B") return JSON.stringify({ verdict: "ratify_and_extend", reasoning: "Stub: looks faithful.", counter_evidence_or_extension: "Stub." });
  if (kind === "review_L") return JSON.stringify(isTwin
    ? { loses_most: "the first model", load_bearing_premise: "Stub: its central premise is misread.", trigger_scenario: "none exists", verdict: "challenge_premise", reasoning: "Stub: misreads one side." }
    : { loses_most: "neither", load_bearing_premise: "none", trigger_scenario: "A blinded panel rejects the bridge.", verdict: "ratify_and_extend", reasoning: "Stub: faithful." });
  if (kind === "named") return JSON.stringify({ identifies_flaw: /misread/.test(u.split("\nREVIEW:\n")[1] || "") });
  return "{}";
}

async function runPair(pair, split, reviewers) {
  pair.reviews ||= {}; pair.named ||= {};
  await Promise.all(reviewers.map(async (rv) => {
    const slot = (pair.reviews[rv.label] ||= { B: {}, L: {} });
    for (const arm of L.ARMS) for (const d of ["S", "F"]) {
      const cur = slot[arm][d];
      if (cur && !cur.provider_error) continue; // parse failures are final (§9)
      const dep = d === "S" ? pair.sound : pair.flawed;
      try {
        const r = await askJSON(rv, `review_${arm}`, L.promptFor(P, arm, split, dep), (o) => L.parseReview(arm, o));
        slot[arm][d] = r.value ? { ...r.value, turns: r.turns, model_reported: r.model_reported } : { verdict: null, missing: "unparseable", turns: r.turns, model_reported: r.model_reported };
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        slot[arm][d] = { verdict: null, missing: "provider-error", provider_error: true, error: e.message };
      }
    }
    const nm = (pair.named[rv.label] ||= {});
    for (const arm of L.ARMS) {
      const fr = slot[arm].F;
      if (!fr?.verdict || (nm[arm] && !nm[arm].provider_error)) continue;
      const { turns, model_reported, ...review } = fr;
      try {
        const r = await askJSON(V1.JUDGE, "named", V1.namedPrompt(P, pair.flaw, pair.flawed, review), (o) => V1.parseBool(o, "identifies_flaw"));
        nm[arm] = { identifies_flaw: r.value, turns: r.turns };
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        nm[arm] = { identifies_flaw: null, provider_error: true, error: e.message };
      }
    }
  }));
  return pair;
}

// ── run ──────────────────────────────────────────────────────────────────────
const v1 = L.readV1Run();
if (JSON.stringify(L.selectPairs(v1)) !== JSON.stringify(L.TEST_PAIRS)) throw new Error("pair selection no longer reproduces the registered list");
const atlas = V1.readAtlas();
const byId = new Map(atlas.map((r) => [r.id, r]));
const v1ByIndex = new Map(v1.pairs.map((p) => [p.index, p]));
const fresh = (index) => {
  const p = v1ByIndex.get(index);
  return {
    index, record_id: p.record_id, flaw: p.flaw, voices: p.voices,
    sound: { synthesis: p.sound.synthesis, falsification_condition: p.sound.falsification_condition },
    flawed: { synthesis: p.flawed.synthesis, falsification_condition: p.flawed.falsification_condition, flaw_note: p.flawed.flaw_note },
    v1_verdicts: Object.fromEntries(L.REVIEWERS.map((r) => [r.label, { S: p.reviews?.[r.label]?.S?.verdict || null, F: p.reviews?.[r.label]?.F?.verdict || null }])),
  };
};

let run, file, pairs;
const outDir = val("--out") || (LIVE ? join(ROOT, "analysis/rdt-l-v1") : join(tmpdir(), "rdt-l-v1"));
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const needsCompletion = (p) => L.REVIEWERS.some((r) => L.ARMS.some((a) => ["S", "F"].some((d) => p.reviews?.[r.label]?.[a]?.[d]?.provider_error) || p.named?.[r.label]?.[a]?.provider_error));
if (MODE === "complete") {
  run = JSON.parse(readFileSync(COMPLETE, "utf8"));
  if (run.completed_by) { console.error(`${COMPLETE} has already had its one --complete pass (§9).`); process.exit(2); }
  pairs = run.pairs.filter(needsCompletion);
  file = COMPLETE.replace(/\.json$/, "") + `.completed-${stamp}.json`;
} else {
  let idx = MODE === "smoke" ? [L.SMOKE_PAIR] : L.TEST_PAIRS;
  if (MODE === "stub" && val("--pairs")) idx = idx.slice(0, Number(val("--pairs"))); // tests only
  pairs = idx.map(fresh);
}
// A twin can share either field with its sound deposit (UNF keeps the synthesis; MIS/FLAT usually keep the condition),
// so the stub recognizes a twin by the two fields together, exactly as the prompt prints them.
STUB_FLAWED = new Set(pairs.map((p) => `Synthesis: ${p.flawed.synthesis}\nFalsification condition: ${p.flawed.falsification_condition}`));
const splitFor = (p) => V1.splitOf(byId.get(p.record_id));

async function runAll(list, concurrency, onPair) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) {
      const p = list[next++];
      try { await runPair(p, splitFor(p), L.REVIEWERS); } catch (e) { p.harness_error = String(e.message).slice(0, 200); }
      if (onPair) onPair(p);
    }
  }));
}

// The estimate: a scripted pass over copies of the same pairs, logging every call's real prompt size (§7). Free.
await runAll(JSON.parse(JSON.stringify(pairs)), 4);
const est = V1.estimate(callLog, costUsd, tokensFor);
const RESERVE = Math.max(0.25, Math.ceil(est.usd * 1.5 * 100) / 100);
const estimateReport = { mode: MODE, pairs: pairs.length, calls: est.calls, estimate_usd: Number(est.usd.toFixed(2)), reserve_usd: RESERVE, by_model: Object.fromEntries(Object.entries(est.by_model).map(([k, v]) => [k, { calls: v.calls, usd: Number(v.usd.toFixed(3)) }])), prices: PRICES_AS_OF, output_token_assumptions: OUT_TOKENS };
if (MODE === "plan") { console.log(JSON.stringify(estimateReport, null, 1)); process.exit(0); }

if (LIVE) {
  for (const k of ["ANTHROPIC_API_KEY", ...L.REVIEWERS.map((r) => KEY_ENV[r.provider])]) if (!KEYS[k]) { console.error(`missing ${k}`); process.exit(1); }
  if (!KEYS.BLOB_READ_WRITE_TOKEN && !has("--i-accept-unledgered-spend")) { console.error("No BLOB_READ_WRITE_TOKEN: cannot reserve on the shared ledger. Refusing (or pass --i-accept-unledgered-spend)."); process.exit(1); }
  console.log(`RDT-L v1 ${MODE}: ${pairs.length} pairs × ${L.REVIEWERS.length} reviewers × 2 arms, ~${est.calls} calls, estimate $${est.usd.toFixed(2)} → reserving $${RESERVE} once on the shared ledger.`);
  if (KEYS.BLOB_READ_WRITE_TOKEN) {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(RESERVE), "--label", `rdt-l-v1 ${MODE}`], { stdio: "inherit", env: { PATH: process.env.PATH, BLOB_READ_WRITE_TOKEN: KEYS.BLOB_READ_WRITE_TOKEN } });
    if (r.status !== 0) { console.error("Budget preflight refused. Nothing was spent."); process.exit(1); }
  }
  callLog = []; usage = {}; useLive = true;
}

if (MODE !== "complete") {
  file = join(outDir, `${MODE}-${stamp}.json`);
  run = {
    study: "RDT-L v1", mode: MODE, registration: { file: L.PREREG, commit: L.PREREG_COMMIT }, started_at: new Date().toISOString(),
    inputs: { rdt_v1_run: { file: L.V1_RUN_FILE, sha256: L.V1_RUN_SHA256 }, atlas: { file: V1.ATLAS_FILE, sha256: V1.ATLAS_SHA256 } },
    reviewers: L.REVIEWERS, judge: V1.JUDGE, estimate: estimateReport,
    note: MODE === "smoke" ? "SMOKE run — excluded from every analysis (§8)." : MODE === "stub" ? "STUB run — scripted models, no real data." : "MAIN run (§9).",
    pairs,
  };
} else {
  run.completed_by = { file, at: new Date().toISOString(), pairs_retried: pairs.map((p) => p.index), estimate: estimateReport };
}
const save = () => { run.usage = usage; run.actual_usd_at_list_prices = Number(Object.entries(usage).reduce((s, [m, u]) => s + costUsd(m, u.in, u.out), 0).toFixed(3)); writeJSON(file, run); };
save();

let done = 0;
await runAll(pairs, LIVE ? 3 : 4, (p) => {
  done++; save();
  if (useLive) {
    const cell = (r, a) => `${p.reviews?.[r.label]?.[a]?.S?.verdict?.[0] ?? "-"}/${p.reviews?.[r.label]?.[a]?.F?.verdict?.[0] ?? "-"}`;
    console.log(`  [${done}/${pairs.length}] #${p.index} ${p.flaw}: ${p.harness_error ? `HARNESS ERROR (${p.harness_error})` : L.REVIEWERS.map((r) => `${r.label} B ${cell(r, "B")} L ${cell(r, "L")}`).join(" · ")}`);
  }
});
run.finished_at = new Date().toISOString();
save();

const a = L.analyze(run.pairs);
writeJSON(file.replace(/\.json$/, "") + ".analysis.json", { analyzed_at: new Date().toISOString(), mode: run.mode, analysis: a });
console.log(JSON.stringify({ mode: MODE, file, ...summary(a), estimate_usd: estimateReport.estimate_usd, actual_usd: run.actual_usd_at_list_prices }, null, 1));
if (run.mode === "smoke") console.log("Smoke data are excluded from the analysis (§8).");
if (MODE === "stub") console.log("Stub: scripted models; the verdict above only proves the plumbing.");
