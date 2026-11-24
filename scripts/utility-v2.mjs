// UTILITY v2 — second-opinion re-test on current models. Registration: docs/utility-v2-preregistration.md.
// A fork of scripts/utility-test-prereg.mjs (v1): same instrument (cold answer, placebo revision,
// treatment revision, blind judge panel, sign test), with the changes listed in the registration §8.
//
//   node scripts/utility-v2.mjs --plan                                   no calls: cost plan (+ probe projection if run)
//   node scripts/utility-v2.mjs --preflight --yes --env-file <f>         model lists + one tiny call per call shape
//   node scripts/utility-v2.mjs --probe --yes --env-file <f>             the whole pipeline once on the throwaway question
//   node scripts/utility-v2.mjs --stage elicit --yes --env-file <f>      B: fresh flagship answers (24 × 5)
//   node scripts/utility-v2.mjs --stage consumers --substudy A|B --yes --env-file <f>
//   node scripts/utility-v2.mjs --stage judges --substudy A|B --yes --env-file <f>
//   node scripts/utility-v2.mjs --analyse                                registration §4–§5, writes results.{json,md}
//
// Transcripts go to analysis/utility-v2/run/ (override with --run-dir). Every stage resumes where it
// stopped. Spend: every call reserves its worst case before it starts; no call starts that could take
// the study past $30 (exit 3, HALTED, permanent for this run directory). The first paid step also
// reserves $30 on the engine's shared 30-day ledger (scripts/budget-preflight.mjs), once.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { envValue } from "./lib/env-value.mjs";
import {
  CONSUMERS, JUDGE_ORDER, B_PEERS, CAPS, CEILING_USD, N_QUESTIONS, ANSWER_SYS, REVISE_SYS, JUDGE_SYS, MEMBER_SYSTEM,
  placeboUser, treatmentUser, judgesFor, peersForA, peersForB, costUsd, reasoningAllowance, LOW, HaltError,
} from "./lib/utility-v2-core.mjs";
import { createRunner, loadQuestions, analyseRun } from "./lib/utility-v2-run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
if (has("--help") || !argv.length) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 20).join("\n")); process.exit(0); }

const RUN_DIR = path.resolve(val("--run-dir") || path.join(ROOT, "analysis/utility-v2/run"));
const KEYS = {};
const envFile = val("--env-file");
if (envFile) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY", "BLOB_READ_WRITE_TOKEN"].includes(m[1])) KEYS[m[1]] = envValue(m[2]);
  }
}
const Q = loadQuestions(ROOT);
const qText = Object.fromEntries([...Q.A, ...Q.B].map((q) => [q.id, q.question]));
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

// ── --plan (no calls) ─────────────────────────────────────────────────────────
function plan() {
  const tok = (chars, m) => Math.ceil((chars / 4) * m);
  const VIS = 1300, FRESH = 2200;
  const rows = [];
  const add = (scn, id, inTok, outTok) => { const r = (rows[scn] ||= {}); r[id] = (r[id] || 0) + costUsd(id, inTok, outTok); };
  for (const scn of ["expected", "bound"]) {
    const M = scn === "expected" ? 1.15 : 1.35;
    for (const q of Q.B) for (const p of B_PEERS) {
      const cap = p.body?.max_tokens ?? p.body?.max_completion_tokens ?? p.generationConfig?.maxOutputTokens;
      add(scn, p.model_id, tok(MEMBER_SYSTEM.length + q.question.length, M), scn === "expected" ? tok(FRESH, M) + 900 : cap + reasoningAllowance(p.provider, p.body || {}));
    }
    for (const S of ["A", "B"]) for (const q of Q[S]) for (const c of CONSUMERS) {
      const peers = S === "A" ? peersForA(q, c.lab) : B_PEERS.filter((p) => p.lab !== c.lab).map((p) => ({ label: p.label, text: "x".repeat(FRESH) }));
      const a1 = "x".repeat(VIS);
      const inChars = ANSWER_SYS.length + q.question.length + 2 * REVISE_SYS.length + placeboUser(q.question, a1).length + treatmentUser(q.question, a1, peers).length;
      const out = scn === "expected" ? 3 * (tok(VIS, M) + (c.tier === "flagship" ? 450 : 250)) : 3 * (CAPS.consumer + reasoningAllowance(c.provider, LOW[c.model_id].body || {}));
      add(scn, c.model_id, tok(inChars, M), out);
      for (const j of judgesFor(c.lab)) add(scn, j.model_id, tok(JUDGE_SYS.length + q.question.length + 3 * VIS + 60, M), scn === "expected" ? 410 : CAPS.judge + reasoningAllowance(j.provider, LOW[j.model_id].body || {}));
    }
  }
  console.log("cost plan (no calls). expected = brief low-effort reasoning; bound = every call uses its whole cap and allowance");
  const ids = [...new Set([...CONSUMERS, ...JUDGE_ORDER, ...B_PEERS].map((m) => m.model_id))];
  for (const id of ids) console.log(`  ${id.padEnd(24)} expected $${(rows.expected[id] || 0).toFixed(2).padStart(6)}   bound $${(rows.bound[id] || 0).toFixed(2).padStart(6)}`);
  const tot = (s) => Object.values(rows[s]).reduce((a, b) => a + b, 0);
  console.log(`  TOTAL                    expected $${tot("expected").toFixed(2).padStart(6)}   bound $${tot("bound").toFixed(2).padStart(6)}   ceiling $${CEILING_USD} (hard)`);
  console.log(`  model calls: ${2 * N_QUESTIONS * CONSUMERS.length * 6 + N_QUESTIONS * B_PEERS.length} (+ retries), instances ${2 * N_QUESTIONS * CONSUMERS.length}`);
  const pf = path.join(RUN_DIR, "probe.json");
  if (fs.existsSync(pf)) { const p = JSON.parse(fs.readFileSync(pf, "utf8")); console.log(`probe ${p.date}: spent so far $${p.spent_so_far_usd}, projected total $${p.projected_total_usd} → ${p.decision}`); }
}

// ── ledger reservation (once per run directory) ─────────────────────────────────
function reserveLedgerOnce() {
  const f = path.join(RUN_DIR, "ledger.json");
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  if (!KEYS.BLOB_READ_WRITE_TOKEN) { console.error("no BLOB_READ_WRITE_TOKEN in --env-file: cannot reserve on the shared ledger, so nothing is spent."); process.exit(1); }
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(CEILING_USD), "--label", `utility-v2 study (hard ceiling $${CEILING_USD})`], { stdio: "inherit", env: { ...process.env, BLOB_READ_WRITE_TOKEN: KEYS.BLOB_READ_WRITE_TOKEN }, cwd: ROOT });
  if (r.status !== 0) { console.error("shared ledger refused the reservation: nothing spent."); process.exit(1); }
  const rec = { reserved_usd: CEILING_USD, at: new Date().toISOString(), label: "utility-v2 study" };
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(rec, null, 1) + "\n");
  return rec;
}

function resultsMarkdown(res, spend) {
  const L = [];
  L.push("# Utility v2: results", "", `Generated ${new Date().toISOString()} by \`node scripts/utility-v2.mjs --analyse\`. Rules: docs/utility-v2-preregistration.md §4–§5.`, "");
  L.push("## The four cells (primary, registered)", "", "| Cell | Instances (failed) | Treatment Qs | Placebo Qs | Tied Qs | one-sided p | Holm p | Judge agreement | Verdict |", "|---|---|---|---|---|---|---|---|---|");
  for (const c of res.cells) L.push(`| ${c.cell} | ${c.instances} (${c.failed}) | ${c.treatmentQs} | ${c.placeboQs} | ${c.tiedQs} | ${c.p_one_sided.toFixed(4)} | ${c.p_holm.toFixed(4)} | ${c.agreement == null ? "n/a" : c.agreement.toFixed(3)} | **${c.verdict}** |`);
  L.push("", `Instrument check (B-small, the positive control): ${res.instrument_check.verdict}${res.instrument_check.suspect ? ". SUSPECT: " + res.instrument_check.consequence : " (passes)."}`);
  L.push(`Falsifier (A-flagship and B-flagship both Refuted): ${res.falsifier.met ? "MET" : "not met"}${res.falsifier.blocked_by_instrument_check ? ", but held back by the instrument check" : ""}.`, "");
  L.push("## Per consumer (exploratory, uncorrected)", "", "| Sub-study | Model | Tier | Instances (failed) | Treatment | Placebo | Tie | two-sided p |", "|---|---|---|---|---|---|---|---|");
  for (const r of res.per_consumer_exploratory) L.push(`| ${r.substudy} | ${r.model_id} | ${r.tier} | ${r.instances} (${r.failed}) | ${r.treatment} | ${r.placebo} | ${r.tie} | ${r.p_two_sided_uncorrected.toFixed(4)} |`);
  L.push("", "## Claude harm check (claude-opus-5-5, two-sided)", "");
  for (const h of res.claude_harm_check) L.push(`- ${h.substudy}: treatment ${h.treatment}, placebo ${h.placebo}, p = ${h.p_two_sided.toFixed(4)}${h.placebo_beats_treatment ? " (placebo ahead)" : ""}`);
  L.push("", "## Judge votes by criterion (descriptive)", "", "| Cell | overall T/P/tie | surfaces_new T/P/tie | calibration T/P/tie |", "|---|---|---|---|");
  const f = (t) => `${t.treatment || 0}/${t.placebo || 0}/${t.tie || 0}`;
  for (const c of res.cells) L.push(`| ${c.cell} | ${f(c.judge_votes.overall)} | ${f(c.judge_votes.surfaces_new)} | ${f(c.judge_votes.calibration)} |`);
  L.push("", "## Spend (provider-reported usage at list prices)", "", `Total $${spend.spent_usd.toFixed(4)} of the $${spend.ceiling_usd} ceiling over ${spend.calls} HTTP calls (${spend.no_usage} without a usage report, charged at their worst case).`, "", "| Model | Calls | Input tokens | Output tokens | USD |", "|---|---|---|---|---|");
  for (const [id, m] of Object.entries(spend.by_model).sort((a, b) => b[1].usd - a[1].usd)) L.push(`| ${id} | ${m.calls} | ${m.in} | ${m.out} | ${m.usd.toFixed(4)} |`);
  return L.join("\n") + "\n";
}

// ── dispatch ──────────────────────────────────────────────────────────────────
if (has("--plan")) { plan(); process.exit(0); }
if (has("--analyse")) {
  const res = analyseRun(RUN_DIR);
  const spend = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "spend.json"), "utf8"));
  fs.writeFileSync(path.join(RUN_DIR, "results.json"), JSON.stringify({ generated: new Date().toISOString(), ...res, spend }, null, 1) + "\n");
  fs.writeFileSync(path.join(RUN_DIR, "results.md"), resultsMarkdown(res, spend));
  for (const c of res.cells) console.log(`${c.cell.padEnd(11)} T ${c.treatmentQs} / P ${c.placeboQs} / tied ${c.tiedQs}  p=${c.p_one_sided.toFixed(4)} holm=${c.p_holm.toFixed(4)} agree=${c.agreement?.toFixed(3)}  → ${c.verdict}`);
  console.log(`instrument check: ${res.instrument_check.verdict}${res.instrument_check.suspect ? " (SUSPECT)" : ""} · falsifier met: ${res.falsifier.met}`);
  process.exit(0);
}
if (!has("--yes")) { console.error("Paid modes need --yes (consent to spend; the study ceiling is $30)."); process.exit(2); }
if (!envFile) { console.error("Paid modes need --env-file <path> (provider keys)."); process.exit(2); }

const runner = createRunner({ runDir: RUN_DIR, keys: KEYS, log });
const need = (file, test, msg) => { const f = path.join(RUN_DIR, file); if (!fs.existsSync(f) || !test(JSON.parse(fs.readFileSync(f, "utf8")))) { console.error(msg); process.exit(1); } };
try {
  reserveLedgerOnce();
  if (has("--preflight")) {
    const r = await runner.preflight();
    for (const x of r.rows.sort((a, b) => a.role.localeCompare(b.role))) console.log(`${x.pass && x.listed ? "ok  " : "FAIL"} ${x.role.padEnd(36)} ${x.model_id.padEnd(22)} listed=${x.listed} reply=${JSON.stringify(x.reply)} resolved=${x.resolved} usage=${JSON.stringify(x.usage)} ${x.error ? "error=" + x.error : ""}`);
    console.log(`preflight ${r.all_pass ? "PASSED" : "FAILED"}; spent $${r.spend.spent_usd.toFixed(4)}`);
    process.exit(r.all_pass ? 0 : 1);
  }
  need("preflight.json", (p) => p.all_pass, "Run --preflight first (it must pass).");
  if (has("--probe")) {
    const p = await runner.probe(Q.probe);
    console.log(JSON.stringify(p, null, 1));
    process.exit(p.decision === "GO" ? 0 : 1);
  }
  need("probe.json", (p) => p.decision === "GO", "The cost probe must have run and said GO.");
  const stage = val("--stage"), S = val("--substudy");
  if (stage === "elicit") {
    const rows = await runner.elicit(Q.B);
    console.log(`elicitation rows ${rows.length}/${N_QUESTIONS * B_PEERS.length}; absent ${rows.filter((r) => r.absent).length}; truncated ${rows.filter((r) => r.truncated).length}; spent $${runner.guard.spentUsd.toFixed(4)}`);
  } else if (stage === "consumers" && (S === "A" || S === "B")) {
    let peersFor;
    if (S === "A") peersFor = (q, lab) => peersForA(q, lab);
    else {
      const rows = runner.readJsonl(runner.F("elicitation-B.jsonl"));
      if (rows.length < N_QUESTIONS * B_PEERS.length) { console.error("B elicitation is not complete."); process.exit(1); }
      const em = runner.elicitedMap(rows);
      peersFor = (q, lab) => peersForB(em[q.id], lab);
    }
    const rows = await runner.consumers(S, Q[S], peersFor, runner.F(`consumers-${S}.jsonl`));
    console.log(`${S}: ${rows.length}/${N_QUESTIONS * CONSUMERS.length} instances, failed ${rows.filter((r) => r.status !== "ok").length}; spent $${runner.guard.spentUsd.toFixed(4)}`);
  } else if (stage === "judges" && (S === "A" || S === "B")) {
    const inst = runner.readJsonl(runner.F(`consumers-${S}.jsonl`));
    if (inst.length < N_QUESTIONS * CONSUMERS.length) { console.error(`consumers-${S} is not complete.`); process.exit(1); }
    const rows = await runner.judges(S, inst, (qid) => qText[qid], runner.F(`judges-${S}.jsonl`));
    console.log(`${S}: judged ${rows.length}; failed ${rows.filter((r) => r.status !== "ok").length}; spent $${runner.guard.spentUsd.toFixed(4)}`);
  } else { console.error("unknown mode; see --help"); process.exit(2); }
} catch (e) {
  if (e instanceof HaltError) { runner.saveSpend(); console.error(`HALTED: ${e.message}`); process.exit(3); }
  throw e;
}
