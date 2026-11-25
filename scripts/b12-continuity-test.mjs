#!/usr/bin/env node
// B12 v1 — continuity / counterfeit-rejection runner. Registration: docs/continuity-test-preregistration.md (prompts,
// parameters and thresholds are read from it). Claim under test: corpus-supports-continuity. Supersedes the 2026-10-14
// skeleton (Muse's b12-counterfeit-harness.mjs) and keeps its gate: nothing that calls a model runs without the frozen
// registration's SHA-256.
//
//   node scripts/b12-continuity-test.mjs --plan                       cost estimate (no spend, no gate)
//   node scripts/b12-continuity-test.mjs --build-pool                 write docs/b12/pool.json from the live Atlas
//   node scripts/b12-continuity-test.mjs --check-briefing <file>      Arm B acceptance: length band + no 8-word run from the Atlas
//   node scripts/b12-continuity-test.mjs --freeze-check               refuses while any ⟨PROPOSED⟩/⟨PENDING⟩ value remains
//   node scripts/b12-continuity-test.mjs --stub                       whole pipeline on test counterfeits and stub replies
//   node scripts/b12-continuity-test.mjs --prepare  --sealed <f> --key-file <f> --prereg-sha256 <hex>
//   node scripts/b12-continuity-test.mjs --subjects --sealed <f> --key-file <f> --prereg-sha256 <hex> --yes --env-file .env.local
//   node scripts/b12-continuity-test.mjs --judge    --prereg-sha256 <hex> --yes --env-file .env.local
//   node scripts/b12-continuity-test.mjs --analyze  --prereg-sha256 <hex>
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as B from "./lib/b12-core.mjs";
import { openSealed, sealForTest } from "./lib/b12-sealed.mjs";
import { chat, firstJSONObject, readKeys } from "./lib/provider-chat.mjs";
import { costUsd, PRICES_AS_OF } from "./lib/model-prices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINE = process.env.B12_ENGINE || "https://engine.omnarai.org";
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const has = (f) => args.includes(f);
const MODES = ["plan", "build-pool", "check-briefing", "freeze-check", "stub", "prepare", "subjects", "judge", "analyze"];
const MODE = MODES.find((m) => has(`--${m}`));
if (!MODE) { console.error(`Choose one of ${MODES.map((m) => `--${m}`).join(", ")}. See the header.`); process.exit(2); }

const OUTDIR = join(ROOT, has("--stub") ? "analysis/b12-v1/stub" : "analysis/b12-v1");
const F = { plan: join(OUTDIR, "plan.json"), commitment: join(OUTDIR, "commitment.json"), transcripts: join(OUTDIR, "transcripts.json"), judge: join(OUTDIR, "judge.json"), analysis: join(OUTDIR, "analysis.json") };
function writeJSON(file, obj) { mkdirSync(join(file, ".."), { recursive: true }); const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(obj, null, 1) + "\n"); renameSync(tmp, file); }
const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

const R = B.loadPrereg();
const P = R.prompts, PR = R.params, T = PR.thresholds;

// ── The gate (kept from the 2026-10-14 skeleton): the frozen registration, byte for byte ──
function gate() {
  const expected = val("--prereg-sha256");
  if (!expected) die("REFUSED: no --prereg-sha256. Freeze docs/continuity-test-preregistration.md with governance/code/precommit.mjs first. This gate is the experiment.", 2);
  if (R.sha256 !== expected) die(`REFUSED: registration hash mismatch.\n  expected ${expected}\n  computed ${R.sha256}\nThe protocol changed after freezing: restore the frozen text or register v2.`);
  if (R.markers.length) die(`REFUSED: the registration still has unresolved values: ${[...new Set(R.markers)].join(", ")}`);
}

// ── The Atlas (read-only GETs; no spend) ──
async function getJSON(url) {
  const r = await fetch(url, { headers: { "x-omnarai-self": "1" } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
async function fetchAtlas() {
  const idx = await getJSON(`${ENGINE}/api/divergences`);
  const ids = idx.records.map((r) => r.id), out = [];
  for (let i = 0; i < ids.length; i += 8) out.push(...(await Promise.all(ids.slice(i, i + 8).map((id) => getJSON(`${ENGINE}/api/divergences?id=${encodeURIComponent(id)}`)))));
  return out;
}
// Text for one pool answer, hash-checked against the frozen pool: a changed text stops the run.
async function answerText(entry, cache) {
  const rec = cache.get(entry.record_id) || (await getJSON(`${ENGINE}/api/divergences?id=${encodeURIComponent(entry.record_id)}`));
  cache.set(entry.record_id, rec);
  const a = rec.answers[Number(entry.answer_id.split("#a")[1])];
  if (!a || B.sha256(a.text) !== entry.text_sha256) throw new Error(`text of ${entry.answer_id} differs from the frozen pool`);
  return { question: rec.question, answer: a.text };
}

const material = (arm) => {
  if (arm === "C") return null;
  const m = arm === "A" ? PR.arm_a : PR.arm_b;
  const text = readFileSync(join(ROOT, m.file), "utf8");
  if (!m.sha256.startsWith("⟨") && B.sha256(text) !== m.sha256) throw new Error(`Arm ${arm} material ${m.file} does not match its frozen sha256`);
  return text;
};
const loadPool = () => { const f = join(ROOT, PR.pool.file); if (!existsSync(f)) die(`no ${PR.pool.file}: run --build-pool first`); return readJSON(f); };
async function questionText(qid, pool, cache) {
  const rid = pool.question_records[qid];
  if (!rid) throw new Error(`no Atlas question with id ${qid}`);
  const rec = cache.get(rid) || (await getJSON(`${ENGINE}/api/divergences?id=${encodeURIComponent(rid)}`));
  cache.set(rid, rec);
  return rec.question;
}

// ── Calls ──
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", xai: "XAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
let KEYS = {}, STUB = MODE === "stub";
const usage = {};
async function call(member, prompt, { maxTokens, extra = null, temperature = null, stub }) {
  if (STUB) return { text: stub(), model: `${member.model_id} (stub)`, stop: "end_turn", usage: { in: 0, out: 0 } };
  const r = await chat(member, [{ role: "user", content: prompt }], { key: KEYS[KEY_ENV[member.provider]], maxTokens, extra, temperature });
  const u = (usage[member.model_id] ||= { calls: 0, in: 0, out: 0 });
  u.calls++; u.in += r.usage.in; u.out += r.usage.out;
  return r;
}
// One retry in a fresh instance (§9). A refusal, an error or an incomplete reply is a failed attempt.
async function attempt(member, prompt, parse, opts) {
  const tries = [];
  for (let t = 0; t < 2; t++) {
    let r = null, err = null, parsed = null;
    try { r = await call(member, prompt, opts); parsed = r.stop === "refusal" ? null : parse(firstJSONObject(r.text)); }
    catch (e) { err = String(e.message || e).slice(0, 240); }
    tries.push({ text: r?.text ?? null, model: r?.model ?? null, stop: r?.stop ?? null, error: err, ok: parsed != null });
    if (parsed != null) return { parsed, tries };
  }
  return { parsed: null, tries };
}
const subjectOpts = (stub) => ({ maxTokens: PR.subject.max_tokens, extra: { output_config: { effort: PR.subject.effort } }, stub });

// ── Estimate (§10) ──
const CHARS_PER_TOKEN = { "claude-opus-5-5": 2.7 }; // measured on the Arm A packet: 15,345 bytes → 5,574 tokens
const OUT_TOKENS = { task1: 3000, task2: 6000, judge: 2000 }; // include thinking/reasoning tokens; deliberately high
function estimate(pool) {
  const avgAnswer = 1600, avgQuestion = 220;
  const mat = { A: material("A").length, B: Math.round((PR.arm_b.min_words + PR.arm_b.max_words) / 2 * 6.5), C: 0 };
  const cpt = CHARS_PER_TOKEN[PR.subject.model_id] || 4;
  let inTok = 0, outTok = 0;
  for (const X of B.ARMS) {
    const t1 = P.TASK1.length + P.MATERIAL.length + mat[X] + 9 * (P.RECORD.length + avgQuestion + avgAnswer);
    const t2 = P.TASK2.length + P.MATERIAL.length + mat[X] + 5 * avgQuestion;
    inTok += PR.runs_per_arm * Math.ceil((t1 + t2) / cpt);
    outTok += PR.runs_per_arm * (OUT_TOKENS.task1 + OUT_TOKENS.task2);
  }
  const subj = costUsd(PR.subject.model_id, inTok, outTok);
  const judgeIn = Math.ceil((P.JUDGE.length + avgQuestion + avgAnswer + 9 * 1800) / 4);
  const judges = PR.judges.reduce((s, j) => s + PR.held_out * costUsd(j.model_id, judgeIn, OUT_TOKENS.judge), 0);
  return { subject_calls: 2 * 3 * PR.runs_per_arm, subject_in_tokens: inTok, subject_out_tokens: outTok, subject_usd: +subj.toFixed(2), judge_calls: PR.judges.length * PR.held_out, judge_usd: +judges.toFixed(2), total_usd: +(subj + judges).toFixed(2), reserve_usd: Math.ceil(2 * (subj + judges)), prices: PRICES_AS_OF, pool_size: pool?.answers?.length ?? null };
}

// ── Stages ──
function openBundle() {
  const sealedFile = val("--sealed"), keyFile = val("--key-file");
  if (!sealedFile || !keyFile) die("--sealed <file> and --key-file <file> are required (the curator releases the key at run start)", 2);
  const o = openSealed(readFileSync(sealedFile, "utf8"), readFileSync(keyFile, "utf8"), { expectedSha256: PR.sealed.sha256 });
  const cf = o.bundle.counterfeits;
  if (cf.length !== PR.counterfeits) throw new Error(`bundle has ${cf.length} counterfeits; the registration says ${PR.counterfeits}`);
  return { ...o, counterfeits: cf };
}

async function prepare(bundle, sealedSha) {
  const pool = loadPool(), cache = new Map();
  const cfQids = bundle.counterfeits.map((c) => c.question_id);
  const d = B.draw(pool.answers, sealedSha, PR, cfQids);
  for (const g of [...d.genuine, ...d.heldOut]) await answerText(g, cache); // hash-check every drawn text now
  const { runs, answerKey } = B.planRuns(sealedSha, d.genuine, bundle.counterfeits, PR);
  // Instrument checks on the counterfeits, reported (never "fixed": they are sealed).
  const checks = bundle.counterfeits.map((c) => ({ n: c.n, words_in_band: B.words(c.text) >= PR.pool.min_words && B.words(c.text) <= PR.pool.max_words, question_allowed: !PR.excluded_question_ids.includes(c.question_id) }));
  const plan = { version: PR.version, prereg_sha256: R.sha256, sealed_sha256: sealedSha, seed: sealedSha, pool_sha256: B.sha256(readFileSync(join(ROOT, PR.pool.file), "utf8")), genuine: d.genuine, held_out: d.heldOut, counterfeit_question_ids: cfQids, counterfeit_checks: checks, runs, answer_key: answerKey, prepared_at: new Date().toISOString() };
  writeJSON(F.plan, plan);
  const commitment = { version: PR.version, plan_sha256: B.sha256(readFileSync(F.plan, "utf8")), answer_key_sha256: B.sha256(JSON.stringify(answerKey)), prereg_sha256: R.sha256, sealed_sha256: sealedSha, committed_at: new Date().toISOString(), note: "Commit and push this file BEFORE --subjects. The plan and answer key are opened only after the transcripts are pushed." };
  writeJSON(F.commitment, commitment);
  return { plan, commitment, cache };
}

async function subjects(plan, bundle, cache) {
  const cf = new Map(bundle.counterfeits.map((c) => [`counterfeit-${c.n}`, c]));
  const texts = new Map();
  for (const g of [...plan.genuine, ...plan.held_out]) texts.set(g.answer_id, await answerText(g, cache));
  const pool = loadPool();
  for (const [k, c] of cf) texts.set(k, { question: await questionText(c.question_id, pool, cache), answer: c.text });
  const member = { provider: PR.subject.provider, model_id: PR.subject.model_id };
  const heldQs = plan.held_out.map((h) => texts.get(h.answer_id).question);
  const out = { version: PR.version, prereg_sha256: R.sha256, subject: member, calls: [] };
  for (const { arm, run, order } of plan.runs) {
    const mat = material(arm);
    const p1 = B.task1Prompt(P, mat, order.map((k) => texts.get(k)));
    const t1 = await attempt(member, p1, (o) => B.parseSort(o, 9), subjectOpts(() => JSON.stringify(Object.fromEntries(order.map((k, i) => [String(i + 1), B.sha256(`${arm}${run}${k}`)[0] < "5" ? "counterfeit" : "genuine"])))));
    out.calls.push({ arm, run, task: 1, prompt_sha256: B.sha256(p1), sort: t1.parsed, tries: t1.tries });
    const p2 = B.task2Prompt(P, mat, heldQs);
    const t2 = await attempt(member, p2, (o) => B.parseAnswers(o, PR.held_out), subjectOpts(() => JSON.stringify(Object.fromEntries(heldQs.map((q, i) => [String(i + 1), `Stub answer ${arm}${run}-${i + 1}: ${B.sha256(arm + run + q).slice(0, 24)} the packet says`])))));
    out.calls.push({ arm, run, task: 2, prompt_sha256: B.sha256(p2), answers: t2.parsed, tries: t2.tries });
    console.log(`  ${arm}${run}: task1 ${t1.parsed ? "ok" : "FAILED"} (${t1.tries.length} tr${t1.tries.length > 1 ? "ies" : "y"}) · task2 ${t2.parsed ? "ok" : "FAILED"} (${t2.tries.length})`);
  }
  out.usage = usage;
  out.actual_usd_at_list_prices = +Object.entries(usage).reduce((s, [m, u]) => s + costUsd(m, u.in, u.out), 0).toFixed(3);
  out.finished_at = new Date().toISOString();
  return out;
}

async function judge(plan, tx, cache) {
  const keys = B.ARMS.flatMap((X) => Array.from({ length: PR.runs_per_arm }, (_, i) => `${X}${i + 1}`));
  const answersOf = Object.fromEntries(tx.calls.filter((c) => c.task === 2).map((c) => [`${c.arm}${c.run}`, c.answers]));
  const out = { version: PR.version, prereg_sha256: R.sha256, questions: [], redactions: Object.fromEntries(B.ARMS.map((X) => [X, 0])) };
  for (let q = 0; q < plan.held_out.length; q++) {
    const h = plan.held_out[q], { question, answer: reference } = await answerText(h, cache);
    const present = keys.filter((k) => answersOf[k]);
    const order = B.rank(plan.seed, `judge|${h.question_id}|`, present);
    const shown = order.map((k) => { const r = B.redact(answersOf[k][q], PR.redact); out.redactions[k[0]] += r.count; return r.text; });
    const prompt = B.judgePrompt(P, question, reference, shown);
    const scores = {};
    for (const j of PR.judges) {
      const r = await attempt(j, prompt, (o) => B.parseScores(o, shown.length), { maxTokens: PR.judge_max_tokens, stub: () => JSON.stringify(Object.fromEntries(shown.map((s, i) => [String(i + 1), parseInt(B.sha256(j.model_id + s)[0], 16) % 4]))) });
      scores[j.model_id] = r.parsed ? Object.fromEntries(order.map((k, i) => [k, r.parsed[i]])) : null;
      (out.tries ||= []).push({ question_id: h.question_id, judge: j.model_id, tries: r.tries });
    }
    out.questions.push({ question_id: h.question_id, answer_id: h.answer_id, order, prompt_sha256: B.sha256(prompt), scores });
  }
  out.usage = usage;
  out.actual_usd_at_list_prices = +Object.entries(usage).reduce((s, [m, u]) => s + costUsd(m, u.in, u.out), 0).toFixed(3);
  return out;
}

function analyze(plan, tx, jd) {
  const byRun = {};
  for (const c of tx.calls) (byRun[`${c.arm}${c.run}`] ||= {})[c.task] = c;
  const arms = {}, units = [];
  for (const X of B.ARMS) {
    const runs = [];
    let caught = 0, flagged = 0, nC = 0, nG = 0, oaAll = [], failed = 0;
    for (let r = 1; r <= PR.runs_per_arm; r++) {
      const k = `${X}${r}`, t1 = byRun[k]?.[1], t2 = byRun[k]?.[2];
      if (!t1?.sort || !t2?.answers) { failed++; runs.push(null); continue; }
      const s = B.scoreSort(t1.sort, plan.answer_key[k]);
      caught += s.caught; flagged += s.flagged; nC += s.counterfeits; nG += s.genuine;
      const oas = jd.questions.map((q) => { const v = PR.judges.map((j) => q.scores[j.model_id]?.[k]).filter((x) => x != null); return v.length ? B.median(v) : null; }).filter((x) => x != null);
      oaAll.push(...oas);
      runs.push({ run: r, ...s, oa: oas.length ? B.mean(oas) : null });
    }
    arms[X] = { runs, failed_runs: failed, crr: nC ? caught / nC : null, frr: nG ? flagged / nG : null, j: nC ? caught / nC - flagged / nG : null, oa: oaAll.length ? B.mean(oaAll) : null };
  }
  for (const q of jd.questions) for (const k of q.order) units.push(PR.judges.map((j) => q.scores[j.model_id]?.[k] ?? null));
  const alpha = B.krippendorffAlpha(units, "ordinal");
  const v = B.verdict(arms, alpha, T);
  return { version: PR.version, prereg_sha256: R.sha256, analyzed_at: new Date().toISOString(), arms, alpha, verdict: v, redactions: jd.redactions, spend_usd: +(tx.actual_usd_at_list_prices + jd.actual_usd_at_list_prices).toFixed(3) };
}

// ── Modes ──
if (MODE === "plan") {
  const pool = existsSync(join(ROOT, PR.pool.file)) ? loadPool() : null;
  console.log(JSON.stringify({ registration_sha256: R.sha256, unresolved: [...new Set(R.markers)], ...estimate(pool) }, null, 1));
} else if (MODE === "build-pool") {
  const recs = await fetchAtlas();
  const pool = B.buildPool(recs, PR);
  const qs = new Set(pool.answers.map((p) => p.question_id));
  writeJSON(join(ROOT, PR.pool.file), { built_at: new Date().toISOString(), engine: ENGINE, ...pool });
  console.log(`pool: ${pool.answers.length} answers on ${qs.size} questions (from ${recs.length} live records; ${Object.keys(pool.question_records).length} questions in all) → ${PR.pool.file}`);
} else if (MODE === "check-briefing") {
  const file = val("--check-briefing");
  const text = readFileSync(file, "utf8");
  const recs = await fetchAtlas();
  const atlas = recs.flatMap((r) => (r.answers || []).map((a) => a.text || ""));
  const c = B.checkBriefing(text, atlas, PR.arm_b);
  console.log(JSON.stringify({ file, ...c, atlas_answers_checked: atlas.length }, null, 1));
  process.exit(c.pass ? 0 : 1);
} else if (MODE === "freeze-check") {
  const problems = [...new Set(R.markers)];
  if (!existsSync(join(ROOT, PR.pool.file))) problems.push(`missing ${PR.pool.file}`);
  try { material("A"); } catch (e) { problems.push(e.message); }
  if (!existsSync(join(ROOT, PR.arm_b.file))) problems.push(`missing ${PR.arm_b.file}`);
  else { try { material("B"); } catch (e) { problems.push(e.message); } }
  console.log(problems.length ? `NOT READY TO FREEZE:\n- ${problems.join("\n- ")}` : `ready to freeze: registration sha256 ${R.sha256}`);
  process.exit(problems.length ? 1 : 0);
} else if (MODE === "stub") {
  // Whole pipeline, no model calls: test counterfeits sealed in-process, stub replies, real pool and real Atlas texts.
  const pool = loadPool(), qids = [...new Set(pool.answers.map((p) => p.question_id))];
  const bundle = { schema: "omnarai-b12-counterfeits/1", claim_id: PR.claim_id, subject_lineage: "Claude (Anthropic)", authored_by: "TEST", plausibility_approved_by: "TEST", counterfeits: [1, 2, 3].map((n) => ({ n, question_id: qids[n * 7], text: `Stub counterfeit ${n}. `.repeat(70).trim() })) };
  const s = sealForTest(bundle);
  const opened = openSealed(s.sealedText, s.keyText, { expectedSha256: s.sealedSha256 });
  const armB = existsSync(join(ROOT, PR.arm_b.file));
  if (!armB) PR.arm_b = { ...PR.arm_a }; // Arm B does not exist yet: stand in with Arm A's text so the pipeline runs end to end
  const { plan, commitment, cache } = await prepare({ ...opened.bundle }, s.sealedSha256);
  console.log(`stub: drew ${plan.genuine.length} genuine + ${plan.held_out.length} held-out; answer-key sha256 ${commitment.answer_key_sha256.slice(0, 16)}…${armB ? "" : " (Arm B stood in by Arm A)"}`);
  const tx = await subjects(plan, opened.bundle, cache);
  writeJSON(F.transcripts, tx);
  const jd = await judge(plan, tx, cache);
  writeJSON(F.judge, jd);
  const a = analyze(plan, tx, jd);
  writeJSON(F.analysis, a);
  console.log(JSON.stringify({ verdict: a.verdict.verdict, why: a.verdict.why, alpha: a.alpha, arms: Object.fromEntries(B.ARMS.map((X) => [X, { j: a.arms[X].j, oa: a.arms[X].oa }])), outputs: OUTDIR }, null, 1));
} else {
  gate();
  if (MODE === "prepare") {
    const o = openBundle();
    const { commitment } = await prepare(o.bundle, o.sealedSha256);
    console.log(`prepared. Commit and push ${F.commitment} now, before --subjects:\n  answer_key_sha256 ${commitment.answer_key_sha256}\n  plan_sha256       ${commitment.plan_sha256}`);
  } else if (MODE === "subjects") {
    if (!has("--yes")) die("This spends real model calls. Run --plan for the estimate, then re-run with --yes.", 2);
    if (!existsSync(F.commitment)) die("no commitment.json: run --prepare and push its commitment first");
    const plan = readJSON(F.plan), commitment = readJSON(F.commitment);
    if (B.sha256(readFileSync(F.plan, "utf8")) !== commitment.plan_sha256) die("plan.json no longer matches its commitment");
    const o = openBundle();
    if (o.sealedSha256 !== plan.sealed_sha256) die("the sealed file is not the one the plan was prepared from");
    KEYS = readKeys(val("--env-file"), readFileSync);
    const est = estimate(loadPool());
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(est.reserve_usd), "--label", "b12-v1 pilot"], { stdio: "inherit", env: { PATH: process.env.PATH, BLOB_READ_WRITE_TOKEN: KEYS.BLOB_READ_WRITE_TOKEN } });
    if (r.status !== 0) die("budget preflight refused the reservation");
    const tx = await subjects(plan, o.bundle, new Map());
    writeJSON(F.transcripts, tx);
    console.log(`subjects done: ${tx.actual_usd_at_list_prices} USD at list prices. Commit and push ${F.transcripts} before --judge.`);
  } else if (MODE === "judge") {
    if (!has("--yes")) die("This spends real model calls. Re-run with --yes.", 2);
    const plan = readJSON(F.plan), commitment = readJSON(F.commitment);
    if (B.sha256(JSON.stringify(plan.answer_key)) !== commitment.answer_key_sha256) die("answer key does not match its commitment");
    KEYS = readKeys(val("--env-file"), readFileSync);
    const jd = await judge(plan, readJSON(F.transcripts), new Map());
    writeJSON(F.judge, jd);
    console.log(`judging done: ${jd.actual_usd_at_list_prices} USD at list prices.`);
  } else if (MODE === "analyze") {
    const a = analyze(readJSON(F.plan), readJSON(F.transcripts), readJSON(F.judge));
    writeJSON(F.analysis, a);
    console.log(JSON.stringify({ verdict: a.verdict, alpha: a.alpha, spend_usd: a.spend_usd }, null, 1));
  }
}
