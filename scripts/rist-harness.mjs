#!/usr/bin/env node
// RIST v1 — Reflection Identity-Specificity Test: collection harness. Preregistration: docs/reflection-identity-preregistration.md
// (registered fe0f807880d6df055bf51fe6f855020682354113, public, 2026-10-02T15:24:25Z; clarifications §12a). Written AFTER that push.
//
//   node scripts/rist-harness.mjs --stage 0 --dry                 # build every prompt, print sizes + cost estimate, no network
//   node scripts/rist-harness.mjs --stage 0 --env <.env.local>    # probe + arm N on the 8 pilot records (32 trials), apply the ceiling gate
//   node scripts/rist-harness.mjs --stage 1 --env <.env.local>    # 24 reflections + 960 recognitions (refuses unless Stage 0 passed)
//
// Every call is appended verbatim to <out>/calls.jsonl (never overwritten); a rerun skips calls already logged, so it is resumable.
// Recognition prompts for arms N / R-own / R-other are stored in full; arm H prompts (≈ the archive each time) are stored as sha256 + length
// because they are exactly reconstructable from the registered inputs and the code (scripts/lib/rist-core.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "./lib/rist-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const STAGE = Number(flag("--stage", "0"));
const DRY = args.includes("--dry");
const OUT = path.join(ROOT, flag("--out", "analysis/rist-v1"));
const ENV = flag("--env", path.join(ROOT, ".env.local"));
const ABORT_USD = 25; // §8
function loadEnv(file, names) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && names.includes(m[1])) { let v = m[2].trim(); if (/^["'].*["']$/.test(v)) v = v.slice(1, -1); process.env[m[1]] = v; }
  }
}
const LOG = path.join(OUT, "calls.jsonl");

// ── inputs, verified against the REGISTERED text ─────────────────────────────
const raw = fs.readFileSync(path.join(ROOT, "atlas/data/atlas-v1.1.0.jsonl"), "utf8");
const records = raw.trim().split("\n").map((l) => JSON.parse(l));
const byId = new Map(records.map((r) => [r.id, r]));
const doc = fs.readFileSync(path.join(ROOT, "docs/reflection-identity-preregistration.md"), "utf8");
const frozen = C.frozenFromPrereg(doc);
const splits = C.computeSplits(records);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
if (C.sha256(raw) !== frozen.atlas_sha256 || !same(splits.history, frozen.history.ids) || !same(splits.pilot, frozen.pilot.ids) || !same(splits.test, frozen.test.ids))
  throw new Error("ABORT: the Atlas file or the computed splits differ from the REGISTERED preregistration. Nothing was run.");
console.log(`inputs verified against the registered preregistration (history ${splits.history.length}, pilot ${splits.pilot.length}, test ${splits.test.length})`);

// ── prompts ──────────────────────────────────────────────────────────────────
const archives = {}; // `${owner}|${subject}` → archive
const archiveFor = (owner, subject) => (archives[`${owner}|${subject}`] ??= C.buildArchive(byId, splits.history, owner, subject));
const reflectTask = (subject, arm, j) => {
  const a = archiveFor(C.archiveOwnerFor(subject, arm), subject);
  return { id: `reflect|${subject}|${arm}|${j}`, kind: "reflect", subject, arm, reflection_j: j, prompt: C.reflectPrompt(a.n_items, a.text), archive_stats: { owner: C.archiveOwnerFor(subject, arm), n_items: a.n_items, n_tensions: a.n_tensions, n_omitted: a.n_omitted }, maxTokens: 1500, temperature: 1.0 };
};
const recognizeTask = (subject, arm, recordId, k, reflections) => {
  const rec = byId.get(recordId);
  let context = "";
  let reflection_id = null;
  if (arm === "H") context = C.recognitionContext("H", { archive: archiveFor(subject, subject).text });
  if (arm === "R-own" || arm === "R-other") {
    reflection_id = `reflect|${subject}|${arm}|${C.reflectionIndex(k)}`;
    const text = reflections?.get(reflection_id);
    context = text == null ? "<<REFLECTION-PENDING>>\n\n" : C.recognitionContext(arm, { reflection: text });
  }
  const p = C.recognitionPrompt(rec, subject, context);
  return { id: `recognize|${subject}|${arm}|${recordId}`, kind: "recognize", subject, arm, record_id: recordId, k, reflection_id, correct: p.correct, order: p.order, prompt: p.text, maxTokens: 1000, temperature: 0 };
};

// ── primary log ──────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const done = new Map();
if (fs.existsSync(LOG)) for (const l of fs.readFileSync(LOG, "utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l); done.set(r.id, r); }
const appendLog = (rec) => { fs.appendFileSync(LOG, JSON.stringify(rec) + "\n"); done.set(rec.id, rec); };
const reflectionsFromLog = () => new Map([...done.values()].filter((r) => r.kind === "reflect" && r.reply != null).map((r) => [r.id, r.reply]));

// ── cost ─────────────────────────────────────────────────────────────────────
const usd = (subject, tin, tout) => (tin * C.PROVIDER[subject].usd[0] + tout * C.PROVIDER[subject].usd[1]) / 1e6;
const estimate = (tasks) => tasks.reduce((s, t) => s + usd(t.subject, t.kind === "reflect" || t.arm !== "H" ? Math.ceil(t.prompt.length / 3.6) : Math.ceil(t.prompt.length / 3.6), t.kind === "reflect" ? 700 : t.subject === "Grok" ? 800 : 30), 0);
let spent = [...done.values()].reduce((s, r) => s + (r.usd || 0), 0);

// ── provider calls ───────────────────────────────────────────────────────────
const tempOk = {}; // lineage → true/false, decided once by the probe (§12a.5)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function callOnce(subject, prompt, { maxTokens, temperature }) {
  const P = C.PROVIDER[subject], key = process.env[P.env];
  if (!key) throw Object.assign(new Error(`no ${P.env}`), { fatal: true });
  const useTemp = temperature != null && tempOk[subject] !== false;
  let res, data;
  if (P.provider === "gemini") {
    const gc = { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } };
    if (useTemp) gc.temperature = temperature;
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${C.MODEL_ID[subject]}:generateContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: gc }) });
    const txt = await res.text(); try { data = JSON.parse(txt); } catch { data = { error: { message: txt.slice(0, 200) } }; }
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${data.error?.message || ""}`.trim()), { status: res.status });
    return { text: data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "", tin: data.usageMetadata?.promptTokenCount ?? 0, tout: data.usageMetadata?.candidatesTokenCount ?? 0, model_returned: data.modelVersion || null, params: { maxOutputTokens: maxTokens, thinkingBudget: 0, temperature: useTemp ? temperature : "provider-default" } };
  }
  const body = { model: C.MODEL_ID[subject], max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] };
  if (useTemp) body.temperature = temperature;
  res = await fetch(`${P.base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const txt = await res.text(); try { data = JSON.parse(txt); } catch { data = { error: { message: txt.slice(0, 200) } }; }
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${data.error?.message || data.error || ""}`.trim()), { status: res.status });
  return { text: data.choices?.[0]?.message?.content ?? "", tin: data.usage?.prompt_tokens ?? 0, tout: data.usage?.completion_tokens ?? 0, model_returned: data.model || null, params: { max_tokens: maxTokens, temperature: useTemp ? temperature : "provider-default" } };
}
// OpenAI's organisation limit on gpt-4o is 30,000 tokens/minute (observed 2026-10-02: HTTP 429 on 3 of 24 reflection calls). A sliding-window
// throttle keeps GPT-4o under 27,000 estimated tokens/minute; other providers were not rate-limited. The estimate is chars/4 + max_tokens.
const TPM = { "GPT-4o": 27000 };
const windows = {};
async function throttle(subject, tokens) {
  const lim = TPM[subject]; if (!lim) return;
  for (;;) {
    const now = Date.now(), w = (windows[subject] ||= []);
    while (w.length && now - w[0].t > 60000) w.shift();
    if (w.length === 0 || w.reduce((a, x) => a + x.tokens, 0) + tokens <= lim) { w.push({ t: now, tokens }); return; }
    await sleep(Math.max(250, 60000 - (now - w[0].t) + 50));
  }
}
async function call(subject, prompt, opts) {
  let last, waits = 0;
  for (let a = 0; a < 3; a++) {
    try { await throttle(subject, Math.ceil(prompt.length / 4) + opts.maxTokens); return await callOnce(subject, prompt, opts); }
    catch (e) {
      last = e; if (e.fatal) break;
      // HTTP 429 = wait the provider-stated time and retry WITHOUT using up one of the 3 attempts (capped at 12 waits)
      if (e.status === 429 && waits < 12) { waits++; const m = String(e.message).match(/try again in ([\d.]+)(ms|s)/i); await sleep((m ? (m[2].toLowerCase() === "ms" ? Number(m[1]) : Number(m[1]) * 1000) : 5000) + 1000); a--; continue; }
      if (e.status === 400 && /temperature/i.test(e.message) && tempOk[subject] !== false) { tempOk[subject] = false; continue; }
      if (e.status && e.status !== 429 && e.status < 500) break;
      await sleep(2000 * (a + 1));
    }
  }
  throw last;
}

async function probe() {
  const rows = [];
  for (const s of C.LINEAGES) {
    if (tempOk[s] !== undefined) continue;
    tempOk[s] = true;
    try { const r = await call(s, "Reply with the single letter B.", { maxTokens: 200, temperature: 0 }); rows.push({ subject: s, temperature_accepted: tempOk[s], model_returned: r.model_returned, reply: r.text.slice(0, 40), tin: r.tin, tout: r.tout }); spent += usd(s, r.tin, r.tout); }
    catch (e) { rows.push({ subject: s, error: String(e.message).slice(0, 200) }); }
  }
  fs.writeFileSync(path.join(OUT, "probe.json"), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
  console.log("probe:", rows.map((r) => `${r.subject}:${r.error ? "ERR " + r.error : `ok temp=${r.temperature_accepted} → ${JSON.stringify(r.reply)} (${r.model_returned})`}`).join(" | "));
  if (rows.some((r) => r.error)) throw new Error("probe failed for at least one provider — fix before running");
}

// ── execution: per-provider concurrency, resumable, abort on spend ───────────
const LIMIT = { "GPT-4o": 6, Gemini: 6, Grok: 4, DeepSeek: 6 };
async function run(tasks, label) {
  const todo = tasks.filter((t) => !done.has(t.id) || (t.kind === "reflect" && done.get(t.id).reply == null)); // a failed reflection is not a scored trial, so it is retried
  console.log(`${label}: ${tasks.length} tasks, ${tasks.length - todo.length} already logged, ${todo.length} to run`);
  const queues = Object.fromEntries(C.LINEAGES.map((s) => [s, todo.filter((t) => t.subject === s)]));
  let n = 0, aborted = false;
  await Promise.all(C.LINEAGES.flatMap((s) => Array.from({ length: LIMIT[s] }, async () => {
    while (queues[s].length && !aborted) {
      const t = queues[s].shift();
      if (spent > ABORT_USD) { aborted = true; console.error(`ABORT: spend $${spent.toFixed(2)} exceeded $${ABORT_USD}`); break; }
      const rec = { id: t.id, kind: t.kind, subject: t.subject, arm: t.arm, record_id: t.record_id ?? null, k: t.k ?? null, reflection_id: t.reflection_id ?? null, reflection_j: t.reflection_j ?? null, correct: t.correct ?? null, order: t.order ?? null, archive_stats: t.archive_stats ?? null, prompt_sha256: C.sha256(t.prompt), prompt_chars: t.prompt.length, ts: new Date().toISOString() };
      if (t.kind === "reflect" || t.arm !== "H") rec.prompt = t.prompt;
      try {
        let r = await call(t.subject, t.prompt, t); let tin = r.tin, tout = r.tout;
        let letter = null, retried = false;
        if (t.kind === "recognize") { letter = C.parseLetter(r.text); if (!letter) { retried = true; r = await call(t.subject, t.prompt, { ...t, temperature: 0 }); tin += r.tin; tout += r.tout; letter = C.parseLetter(r.text); } }
        Object.assign(rec, { reply: r.text, letter, retried, invalid: t.kind === "recognize" ? !letter : false, model_returned: r.model_returned, params: r.params, tin, tout, usd: usd(t.subject, tin, tout) });
      } catch (e) { Object.assign(rec, { reply: null, letter: null, invalid: t.kind === "recognize", error: String(e.message).slice(0, 300), usd: 0 }); }
      spent += rec.usd || 0; appendLog(rec);
      if (++n % 40 === 0) console.log(`  ${label}: ${n}/${todo.length}  spend so far $${spent.toFixed(2)}`);
    }
  })));
  console.log(`${label}: finished ${n}/${todo.length}; spend so far $${spent.toFixed(2)}`);
  if (aborted) process.exit(2);
}

// ── stages ───────────────────────────────────────────────────────────────────
const acc = (rs) => (rs.length ? rs.filter((r) => r.letter === r.correct).length / rs.length : null);
if (STAGE === 0) {
  const tasks = C.LINEAGES.flatMap((s) => splits.pilot.map((id, k) => recognizeTask(s, "N", id, k)));
  const est = estimate(tasks) + 0.05;
  console.log(`Stage 0: ${tasks.length} recognition trials (arm N, pilot records). Estimated cost ≈ $${est.toFixed(2)}`);
  if (DRY) { console.log(`dry run — first prompt (${tasks[0].prompt.length} chars):\n${tasks[0].prompt.slice(0, 600)}…`); process.exit(0); }
  loadEnv(ENV, [...C.LINEAGES.map((s) => C.PROVIDER[s].env), "BLOB_READ_WRITE_TOKEN"]);
  const { preflightSpend } = await import("./budget-preflight.mjs");
  await preflightSpend({ estUsd: Math.ceil(est * 2 * 100) / 100, label: "RIST v1 Stage 0 pilot" });
  await probe();
  await run(tasks, "stage0");
  const rs = tasks.map((t) => done.get(t.id));
  const letters = rs.reduce((m, r) => ((m[r.letter || "∅"] = (m[r.letter || "∅"] || 0) + 1), m), {});
  const bySubject = Object.fromEntries(C.LINEAGES.map((s) => [s, acc(rs.filter((r) => r.subject === s))]));
  const a = acc(rs), maxLetter = Math.max(...Object.entries(letters).filter(([k]) => k !== "∅").map(([, v]) => v)) / rs.length;
  const gate = { stage: 0, at: new Date().toISOString(), n_trials: rs.length, n_invalid: rs.filter((r) => r.invalid).length, N_accuracy: a, by_subject: bySubject, letters, max_letter_share: maxLetter, position_bias_flag: maxLetter > 0.5, ceiling_threshold: 0.85, passed: a <= 0.85, spend_usd: +spent.toFixed(4) };
  fs.writeFileSync(path.join(OUT, "stage0.json"), JSON.stringify(gate, null, 1));
  console.log(JSON.stringify(gate, null, 1));
  console.log(gate.passed ? "STAGE 0 PASSED — N accuracy is at or below 85%; Stage 1 may run." : "STAGE 0 FAILED THE CEILING GATE — instrument saturated (§7). STOP. Publish this result; run nothing further.");
} else if (STAGE === 1) {
  if (!DRY) {
    let g; try { g = JSON.parse(fs.readFileSync(path.join(OUT, "stage0.json"), "utf8")); } catch { throw new Error("no stage0.json — run Stage 0 first"); }
    if (!g.passed) throw new Error("Stage 0 did not pass the ceiling gate (§7); Stage 1 must not run.");
  }
  const refl = C.LINEAGES.flatMap((s) => ["R-own", "R-other"].flatMap((arm) => [0, 1, 2].map((j) => reflectTask(s, arm, j))));
  const reflEst = estimate(refl);
  const mkRecog = (reflections) => C.LINEAGES.flatMap((s) => splits.test.flatMap((id, k) => C.ARMS.map((arm) => recognizeTask(s, arm, id, k, reflections))));
  const est = reflEst + estimate(mkRecog(null).filter((t) => t.arm !== "R-own" && t.arm !== "R-other")) + estimate(mkRecog(null).filter((t) => t.arm === "R-own" || t.arm === "R-other").map((t) => ({ ...t, prompt: t.prompt + "x".repeat(2400) })));
  console.log(`Stage 1: ${refl.length} reflections + ${C.LINEAGES.length * splits.test.length * C.ARMS.length} recognitions. Estimated cost ≈ $${est.toFixed(2)} (abort above $${ABORT_USD})`);
  console.log("archive stats:", JSON.stringify(Object.fromEntries(Object.entries(archives).map(([k, v]) => [k, `${v.n_items} items, ${v.n_tensions} tensions, ${v.n_omitted} omitted, ${v.text.length} chars`]))));
  if (est > ABORT_USD) throw new Error(`projected cost $${est.toFixed(2)} exceeds the $${ABORT_USD} abort threshold (§8)`);
  if (DRY) process.exit(0);
  loadEnv(ENV, [...C.LINEAGES.map((s) => C.PROVIDER[s].env), "BLOB_READ_WRITE_TOKEN"]);
  const { preflightSpend } = await import("./budget-preflight.mjs");
  await preflightSpend({ estUsd: Math.ceil(est * 1.1 * 100) / 100, label: "RIST v1 Stage 1 main run" });
  await probe();
  await run(refl, "reflections");
  const reflections = reflectionsFromLog();
  const missing = refl.filter((t) => !reflections.has(t.id));
  if (missing.length) throw new Error(`${missing.length} reflections failed after retries (${missing.slice(0, 3).map((t) => t.id).join(", ")}…) — rerun to retry them; recognitions need all 24`);
  await run(mkRecog(reflections), "recognitions");
  const rs = [...done.values()].filter((r) => r.kind === "recognize" && splits.test.includes(r.record_id));
  console.log(`Stage 1 complete: ${rs.length} test trials logged; invalid ${rs.filter((r) => r.invalid).length}; spend $${spent.toFixed(2)}. Next: node scripts/rist-analyze.mjs`);
} else throw new Error("--stage must be 0 or 1");
