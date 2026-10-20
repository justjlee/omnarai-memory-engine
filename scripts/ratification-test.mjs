#!/usr/bin/env node
// RDT v1 — Ratification Discrimination Test runner. Registration: docs/ratification-discrimination-preregistration.md
// (pushed in c76df7a before this file existed). Claim under test: cross-lineage-review-separates-planted-flaws.
//
// For each (split, flaw type): the author writes a SOUND deposit (synthesis + falsification condition) and then a
// minimal-edit FLAWED twin, the judge checks that the flaw is in the twin and not in the sound deposit, every reviewer
// reviews both deposits in separate stateless calls, and the judge scores whether each review of the twin names the flaw.
// No engine is involved (§11): pure model calls over the frozen Atlas file.
//
//   node scripts/ratification-test.mjs --plan                                   # cost estimate; no calls, no keys
//   node scripts/ratification-test.mjs --stub                                   # scripted models, free (tests)
//   node scripts/ratification-test.mjs --smoke --yes --env-file .env.local
//   node scripts/ratification-test.mjs --main --yes --env-file .env.local
//   node scripts/ratification-test.mjs --complete analysis/rdt-v1/main-<ts>.json --yes --env-file .env.local
//   node scripts/ratification-test.mjs --analyze analysis/rdt-v1/main-<ts>.json   # re-derive the verdict
//
// Live modes reserve the estimate ONCE on the shared ledger (scripts/budget-preflight.mjs) before the first paid call.
// The run file is rewritten after every finished pair, so an interrupted run keeps everything it finished.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as C from "./lib/rdt-core.mjs";
import { chat, firstJSONObject, readKeys } from "./lib/provider-chat.mjs";
import { costUsd, tokensFor, PRICES_AS_OF } from "./lib/model-prices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const has = (f) => args.includes(f);

function writeJSON(file, obj) { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(obj, null, 1)); renameSync(tmp, file); }
function summary(a) {
  return { verdict: a.verdict, pairs: a.pairs, valid: a.valid, lost: a.lost, incomplete: a.incomplete, failed_manipulation_check: a.failed_manipulation_check, reviewers_used: a.reviewers_used, observations: a.primary.observations, ratify_sound: a.primary.ratify_sound, ratify_flawed: a.primary.ratify_flawed, D: a.primary.D, p: a.primary.signflip.p, leak_single_review: a.descriptive.leak_single_review, leak_any_reviewer: a.descriptive.leak_any_reviewer };
}
function analyzeRun(run) { return C.analyze(run.pairs, C.REVIEWERS.filter((r) => (run.reviewers_in_run || []).includes(r.label))); }

// ── --analyze: re-derive the verdict from a finished run file ────────────────
if (has("--analyze")) {
  const file = val("--analyze");
  const run = JSON.parse(readFileSync(file, "utf8"));
  const a = analyzeRun(run);
  writeJSON(file.replace(/\.json$/, "") + ".analysis.json", { analyzed_at: new Date().toISOString(), mode: run.mode, analysis: a });
  console.log(JSON.stringify({ mode: run.mode, ...summary(a) }, null, 1));
  process.exit(0);
}

const COMPLETE = val("--complete");
const MODE = COMPLETE ? "complete" : has("--main") ? "main" : has("--smoke") ? "smoke" : has("--stub") ? "stub" : has("--plan") ? "plan" : null;
if (!MODE) { console.error("Choose one of --plan, --stub, --smoke, --main, --complete <file> (or --analyze <file>). See the header."); process.exit(2); }
const LIVE = MODE === "smoke" || MODE === "main" || MODE === "complete";
if (LIVE && !has("--yes")) { console.error("This spends real model calls. Run --plan for the estimate, then re-run with --yes."); process.exit(2); }

const P = C.loadPrompts();
const KEYS = LIVE ? readKeys(val("--env-file"), readFileSync) : {};
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", xai: "XAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
const MAX_TOKENS = { synth: 900, flaw: 900, check: 200, review: 700, named: 200, ping: 20 }; // §6 token caps
const OUT_TOKENS = { synth: 330, flaw: 380, check: 15, review: 380, named: 15, ping: 3 }; // §7 estimate assumptions

// ── models: live, or stub (scripted, free) which also logs every call's size for the estimate ──
let callLog = [];
let usage = {};
let useLive = false;
class ProviderError extends Error {}
async function ask(m, kind, messages) {
  const inChars = messages.reduce((s, x) => s + x.content.length, 0);
  // gemini-2.5-flash bills its thinking as output; give every Gemini call a 900-token allowance for it
  callLog.push({ model: m.model_id, kind, inChars, outTokens: m.provider === "gemini" ? OUT_TOKENS[kind] + 900 : OUT_TOKENS[kind] });
  if (!useLive) return { text: stubReply(kind, messages), model: m.model_id };
  let r;
  try { r = await chat(m, messages, { key: KEYS[KEY_ENV[m.provider]], maxTokens: MAX_TOKENS[kind] }); }
  catch (e) { throw new ProviderError(String(e.message || e).slice(0, 240)); }
  const u = (usage[m.model_id] ||= { calls: 0, in: 0, out: 0 });
  u.calls++; u.in += r.usage.in; u.out += r.usage.out;
  return r;
}
// One retry on a parse failure (§6), as a follow-up turn. `accept` decides whether the parsed object is usable.
async function askJSON(m, kind, prompt, accept) {
  const messages = [{ role: "user", content: prompt }];
  const first = await ask(m, kind, messages);
  const turns = [first.text];
  let value = accept(firstJSONObject(first.text)), reported = first.model;
  if (value == null) {
    const second = await ask(m, kind, [...messages, { role: "assistant", content: first.text || "(empty)" }, { role: "user", content: C.RETRY_NUDGE }]);
    turns.push(second.text); reported = second.model;
    value = accept(firstJSONObject(second.text));
  }
  return { value, turns, model_reported: reported };
}

// Scripted stand-ins with realistic lengths (so --plan sizes are honest) and deterministic content (so tests can
// assert): the stub author marks its plants with STUBFLAW, the stub judge and stub reviewers key on that marker.
const PAD = " It keeps what each answer actually claims, separates the empirical question from the normative one, and names what would still divide them.".repeat(6);
function stubReply(kind, messages) {
  const u = messages[0].content;
  if (kind === "ping") return "ok";
  if (kind === "synth") return JSON.stringify({ synthesis: `Stub synthesis.${PAD}`, falsification_condition: "A blinded panel that reads both answers rejects this framing in most cases." });
  // The marker sits in both fields, so it survives the UNF rule that restores the sound synthesis.
  if (kind === "flaw") return JSON.stringify({ synthesis: `Stub synthesis STUBFLAW.${PAD}`, falsification_condition: "A blinded panel that reads both answers rejects this framing STUBFLAW.", flaw_note: "Stub plant." });
  if (kind === "check") return JSON.stringify({ has_flaw: /STUBFLAW/.test(u.split("\nDEPOSIT\n")[1] || "") });
  if (kind === "review") return JSON.stringify(/STUBFLAW/.test(u.split("\nTHE DEPOSIT\n")[1] || "")
    ? { verdict: "refute", reasoning: "Stub: it misreads one answer.", counter_evidence_or_extension: "Stub." }
    : { verdict: "ratify_and_extend", reasoning: "Stub: faithful to both.", counter_evidence_or_extension: "Stub." });
  if (kind === "named") return JSON.stringify({ identifies_flaw: /misreads/.test(u.split("\nREVIEW:\n")[1] || "") });
  return "{}";
}

// ── one pair (§3.1). Stages are resumable: a provider error marks the pair `incomplete` at that stage. ──
async function runStages(pair, split, reviewers) {
  try {
    if (!pair.sound) {
      const r = await askJSON(C.AUTHOR, "synth", C.synthPrompt(P, split), (o) => C.parseDeposit(o));
      if (!r.value) { pair.lost = "author-sound-unparseable"; pair.sound_attempt = r; return pair; }
      pair.sound = { ...r.value, turns: r.turns, model_reported: r.model_reported };
    }
    if (!pair.flawed) {
      pair.flaw_attempts = pair.flaw_attempts || [];
      while (!pair.flawed && pair.flaw_attempts.length < 2) {
        const r = await askJSON(C.AUTHOR, "flaw", C.flawPrompt(P, split, pair.flaw, pair.sound), (o) => C.parseDeposit(o, { needNote: true }));
        if (!r.value) { pair.flaw_attempts.push({ turns: r.turns, outcome: "unparseable" }); pair.lost = "author-flaw-unparseable"; return pair; }
        const dep = { ...r.value };
        let overridden = false;
        if (pair.flaw === "UNF" && dep.synthesis !== pair.sound.synthesis) { overridden = true; dep.synthesis = pair.sound.synthesis; } // §3.1 step 2
        const ok = C.lengthOk(pair.sound, dep);
        pair.flaw_attempts.push({ turns: r.turns, model_reported: r.model_reported, words: { sound: C.depositWords(pair.sound), flawed: C.depositWords(dep) }, length_ok: ok, synthesis_overridden: overridden });
        if (ok) pair.flawed = { ...dep, synthesis_overridden: overridden };
      }
      if (!pair.flawed) { pair.lost = "length-rule"; return pair; }
    }
    pair.check = pair.check || {};
    pair.check_raw = pair.check_raw || {};
    for (const v of ["S", "F"]) {
      // Set once a call has returned, parsed or not: a parse failure is final (§9); only a provider error is redone.
      if (Object.prototype.hasOwnProperty.call(pair.check, v)) continue;
      const dep = v === "S" ? pair.sound : pair.flawed;
      const r = await askJSON(C.JUDGE, "check", C.checkPrompt(P, split, pair.flaw, dep), (o) => C.parseBool(o, "has_flaw"));
      pair.check[v] = r.value; pair.check_raw[v] = r.turns;
    }
  } catch (e) {
    if (e instanceof ProviderError) { pair.incomplete = { stage: !pair.sound ? "sound" : !pair.flawed ? "flaw" : "check", error: e.message }; return pair; }
    throw e;
  }
  delete pair.incomplete;

  // Reviews (§3.1 step 4) and flaw-named scoring (step 5): every reviewer, both deposits, separate stateless calls.
  pair.reviews = pair.reviews || {};
  pair.named = pair.named || {};
  await Promise.all(reviewers.map(async (rv) => {
    const slot = (pair.reviews[rv.label] ||= {});
    for (const v of ["S", "F"]) {
      if (slot[v] && !slot[v].provider_error) continue;
      const dep = v === "S" ? pair.sound : pair.flawed;
      try {
        const r = await askJSON(rv, "review", C.reviewPrompt(P, split, dep), (o) => (C.parseVerdict(o) ? o : null));
        slot[v] = r.value
          ? { verdict: C.parseVerdict(r.value), reasoning: r.value.reasoning ?? null, counter_evidence_or_extension: r.value.counter_evidence_or_extension ?? null, turns: r.turns, model_reported: r.model_reported }
          : { verdict: null, missing: "unparseable", turns: r.turns, model_reported: r.model_reported };
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        slot[v] = { verdict: null, missing: "provider-error", provider_error: true, error: e.message };
      }
    }
    const fr = slot.F;
    const done = pair.named[rv.label];
    if (fr?.verdict && (!done || done.provider_error)) {
      try {
        const r = await askJSON(C.JUDGE, "named", C.namedPrompt(P, pair.flaw, pair.flawed, { verdict: fr.verdict, reasoning: fr.reasoning, counter_evidence_or_extension: fr.counter_evidence_or_extension }), (o) => C.parseBool(o, "identifies_flaw"));
        pair.named[rv.label] = { identifies_flaw: r.value, turns: r.turns };
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        pair.named[rv.label] = { identifies_flaw: null, provider_error: true, error: e.message };
      }
    }
  }));
  return pair;
}

// ── run ──────────────────────────────────────────────────────────────────────
const atlas = C.readAtlas();
const sel = C.selectSplits(atlas);
if (sel.smoke !== C.SMOKE_SPLIT || JSON.stringify(sel.test) !== JSON.stringify(C.TEST_SPLITS)) throw new Error("split selection no longer reproduces the registered lists");
const byId = new Map(atlas.map((r) => [r.id, r]));
const splitById = (id) => C.splitOf(byId.get(id));

function freshPairs(mode) {
  if (mode === "smoke") return C.FLAW_TYPES.map((flaw, k) => ({ index: k, record_id: C.SMOKE_SPLIT, flaw }));
  let ids = C.TEST_SPLITS.map((id, k) => ({ index: k + 1, record_id: id, flaw: C.flawForIndex(k + 1) }));
  if (mode === "stub" && val("--pairs")) ids = ids.slice(0, Number(val("--pairs"))); // tests only
  return ids;
}
const withVoices = (p) => { const s = splitById(p.record_id); return { ...p, voices: [s.voice_a, s.voice_b] }; };

async function runAll(pairs, reviewers, concurrency, onPair) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, async () => {
    while (next < pairs.length) {
      const k = next++;
      const p = pairs[k];
      try { await runStages(p, splitById(p.record_id), reviewers); }
      catch (e) { p.lost = `harness-error: ${String(e.message).slice(0, 200)}`; }
      if (onPair) onPair(p, k);
    }
  }));
  return pairs;
}

// What still needs a call in a run file (the --complete pass, §9): provider errors only, never parse failures.
function needsCompletion(p, reviewers) {
  if (p.lost) return false;
  if (p.incomplete) return true;
  return reviewers.some((r) => ["S", "F"].some((v) => p.reviews?.[r.label]?.[v]?.provider_error) || p.named?.[r.label]?.provider_error || !p.reviews?.[r.label]);
}

const outDir = val("--out") || (LIVE ? join(ROOT, "analysis/rdt-v1") : join(tmpdir(), "rdt-v1"));
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

let run, file, reviewers, pairs;
if (MODE === "complete") {
  run = JSON.parse(readFileSync(COMPLETE, "utf8"));
  if (run.completed_by) { console.error(`${COMPLETE} has already had its one --complete pass (§9).`); process.exit(2); }
  reviewers = C.REVIEWERS.filter((r) => run.reviewers_in_run.includes(r.label));
  pairs = run.pairs.filter((p) => needsCompletion(p, reviewers));
  file = COMPLETE.replace(/\.json$/, "") + `.completed-${stamp}.json`;
} else {
  reviewers = C.REVIEWERS;
  pairs = freshPairs(MODE).map(withVoices);
}

// 1. The estimate: a scripted pass over copies of the SAME pairs, logging every call's real prompt size (§7). Free.
await runAll(JSON.parse(JSON.stringify(pairs)), reviewers, 4);
const est = C.estimate(callLog, costUsd, tokensFor);
const RESERVE = Math.max(0.25, Math.ceil(est.usd * 1.5 * 100) / 100);
const estimateReport = { mode: MODE, pairs: pairs.length, calls: est.calls, estimate_usd: Number(est.usd.toFixed(2)), reserve_usd: RESERVE, by_model: Object.fromEntries(Object.entries(est.by_model).map(([k, v]) => [k, { calls: v.calls, usd: Number(v.usd.toFixed(3)) }])), prices: PRICES_AS_OF, output_token_assumptions: OUT_TOKENS };
if (MODE === "plan") { console.log(JSON.stringify(estimateReport, null, 1)); process.exit(0); }

let preflight = null;
if (LIVE) {
  for (const k of ["ANTHROPIC_API_KEY"]) if (!KEYS[k]) { console.error(`missing ${k} (author and judge)`); process.exit(1); }
  if (!KEYS.BLOB_READ_WRITE_TOKEN && !has("--i-accept-unledgered-spend")) { console.error("No BLOB_READ_WRITE_TOKEN in --env-file / SL_ env: cannot reserve on the shared ledger. Refusing (or pass --i-accept-unledgered-spend)."); process.exit(1); }
  useLive = true;
  if (MODE !== "complete") {
    // §3 reviewer preflight: one trivial call each; a provider error excludes that reviewer from the whole run.
    preflight = {};
    for (const r of C.REVIEWERS) {
      if (!KEYS[KEY_ENV[r.provider]]) { preflight[r.label] = { ok: false, error: `no ${KEY_ENV[r.provider]}` }; continue; }
      try { const x = await chat(r, [{ role: "user", content: C.PING }], { key: KEYS[KEY_ENV[r.provider]], maxTokens: MAX_TOKENS.ping, tries: 2 }); preflight[r.label] = { ok: true, model_reported: x.model }; }
      catch (e) { preflight[r.label] = { ok: false, error: String(e.message || e).slice(0, 200) }; }
    }
    reviewers = C.REVIEWERS.filter((r) => preflight[r.label].ok);
    console.log(`Reviewer preflight: ${C.REVIEWERS.map((r) => `${r.label} ${preflight[r.label].ok ? "ok" : `EXCLUDED (${preflight[r.label].error})`}`).join(" · ")}`);
    if (reviewers.length < C.MIN_REVIEWERS) { console.error(`Only ${reviewers.length} reviewers passed preflight; §3 needs ${C.MIN_REVIEWERS}. Not running.`); process.exit(1); }
  }
  // Reserve once, from an estimate that uses only the reviewers who will actually run.
  useLive = false; callLog = [];
  await runAll(JSON.parse(JSON.stringify(pairs)), reviewers, 4);
  const est2 = C.estimate(callLog, costUsd, tokensFor);
  const reserve = Math.max(0.25, Math.ceil(est2.usd * 1.5 * 100) / 100);
  estimateReport.live_estimate_usd = Number(est2.usd.toFixed(2)); estimateReport.reserve_usd = reserve;
  console.log(`RDT v1 ${MODE}: ${pairs.length} pairs × ${reviewers.length} reviewers, ~${est2.calls} calls, estimate $${est2.usd.toFixed(2)} → reserving $${reserve} once on the shared ledger.`);
  if (KEYS.BLOB_READ_WRITE_TOKEN) {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(reserve), "--label", `rdt-v1 ${MODE}`], { stdio: "inherit", env: { PATH: process.env.PATH, BLOB_READ_WRITE_TOKEN: KEYS.BLOB_READ_WRITE_TOKEN } });
    if (r.status !== 0) { console.error("Budget preflight refused. Nothing was spent beyond the preflight pings."); process.exit(1); }
  }
  for (const r of reviewers) if (!KEYS[KEY_ENV[r.provider]]) { console.error(`missing ${KEY_ENV[r.provider]}`); process.exit(1); }
  callLog = []; usage = {};
  useLive = true;
}

if (MODE !== "complete") {
  file = join(outDir, `${MODE}-${stamp}.json`);
  run = {
    study: "RDT v1", mode: MODE, registration: { file: C.PREREG, commit: C.PREREG_COMMIT }, started_at: new Date().toISOString(),
    inputs: { atlas: { file: C.ATLAS_FILE, sha256: C.ATLAS_SHA256 } },
    roles: { author: C.AUTHOR, judge: C.JUDGE, reviewers: C.REVIEWERS },
    reviewer_preflight: preflight, reviewers_in_run: reviewers.map((r) => r.label),
    estimate: estimateReport,
    note: MODE === "smoke" ? "SMOKE run — excluded from every analysis (§8)." : MODE === "stub" ? "STUB run — scripted models, no real data." : "MAIN run (§9).",
    pairs,
  };
} else {
  run.completed_by = { file, at: new Date().toISOString(), pairs_retried: pairs.map((p) => p.index), estimate: estimateReport };
}
const save = () => { run.usage = usage; run.actual_usd_at_list_prices = Number(Object.entries(usage).reduce((s, [m, u]) => s + costUsd(m, u.in, u.out), 0).toFixed(3)); writeJSON(file, run); };
save();

let done = 0;
await runAll(pairs, reviewers, LIVE ? 3 : 4, (p) => {
  done++;
  save();
  if (useLive) {
    const rv = reviewers.map((r) => `${r.label}:${p.reviews?.[r.label]?.S?.verdict?.[0] ?? "-"}/${p.reviews?.[r.label]?.F?.verdict?.[0] ?? "-"}`).join(" ");
    console.log(`  [${done}/${pairs.length}] #${p.index} ${p.record_id} ${p.flaw}: ${p.lost ? `LOST (${p.lost})` : p.incomplete ? `INCOMPLETE (${p.incomplete.stage}: ${p.incomplete.error})` : `check S=${p.check?.S} F=${p.check?.F} · S/F ${rv}`}`);
  }
});
run.finished_at = new Date().toISOString();
save();

const a = analyzeRun(run);
writeJSON(file.replace(/\.json$/, "") + ".analysis.json", { analyzed_at: new Date().toISOString(), mode: run.mode, analysis: a });
console.log(JSON.stringify({ mode: MODE, file, ...summary(a), estimate_usd: estimateReport.live_estimate_usd ?? estimateReport.estimate_usd, actual_usd: run.actual_usd_at_list_prices }, null, 1));
if (run.mode === "smoke") console.log("Smoke data are excluded from the analysis (§8).");
if (MODE === "stub") console.log("Stub: scripted models; the verdict above only proves the plumbing.");
