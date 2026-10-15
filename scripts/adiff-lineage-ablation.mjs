#!/usr/bin/env node
// ALA v1 — ADIFF Lineage Ablation runner. Registration: docs/adiff-lineage-ablation-preregistration.md (pushed in
// 26e37fb before this file existed). Claim under test: same-lineage-content-drives-claude-degradation.
//
// On the 162 instances of the July Claude cell (same records, same three wordings, same caps), Claude answers cold
// (a1), then revises five ways — placebo (P), the July treatment (TC, concurrent replication), peers + a tension map
// DeepSeek wrote over the four peers only (TX), and peers alone (TP) — and the July judge panel compares each of
// TC/TX/TP with P. The registered harness (scripts/utility-test-prereg.mjs) is not edited.
//
//   node scripts/adiff-lineage-ablation.mjs --plan          # cost estimate from the real prompt sizes; no calls
//   node scripts/adiff-lineage-ablation.mjs --stub          # scripted models, free (tests)
//   node scripts/adiff-lineage-ablation.mjs --yes           # THE run (curator's call; reserves the estimate once)
//   node scripts/adiff-lineage-ablation.mjs --analyze analysis/ala-v1/run-<ts>.json
//
// Keys: from the environment, or .env.local (ADIFF_NO_ENV_FILE=1 ignores it, as in the registered harness).
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import * as A from "./lib/ala-core.mjs";
import { costUsd, tokensFor, PRICES_AS_OF } from "./lib/model-prices.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const has = (f) => args.includes(f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (has("--analyze")) {
  const file = val("--analyze");
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  const a = A.analyze(run.instances);
  fs.writeFileSync(file.replace(/\.json$/, "") + ".analysis.json", JSON.stringify({ analyzed_at: new Date().toISOString(), analysis: a }, null, 1));
  console.log(JSON.stringify({ verdict: a.verdict, TC: a.TC, TX: a.TX, TP: a.TP }, null, 1));
  process.exit(0);
}

const MODE = has("--plan") ? "plan" : has("--stub") ? "stub" : has("--yes") ? "run" : null;
if (!MODE) { console.error("Choose --plan (estimate), --stub (free, scripted) or --yes (the real run). See the header."); process.exit(2); }

const ENV_FILE = path.join(ROOT, ".env.local");
if (MODE === "run" && process.env.ADIFF_NO_ENV_FILE !== "1" && fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
  }
}
const { COUNCIL, synthesisRequest, parseSynthesis } = await import("../api/_council.js");
const CONSUMER = COUNCIL.find((m) => m.model === A.CONSUMER);
const JUDGES = A.JUDGE_NAMES.map((n) => COUNCIL.find((m) => m.model === n));

// copied: scripts/utility-test-prereg.mjs (callModel)
async function callModel(member, system, user, { maxTokens = 700, tries = 5 } = {}) {
  for (let t = 0; t < tries; t++) {
    try {
      if (member.provider === "anthropic") {
        const c = new Anthropic();
        const r = await c.messages.create({ model: member.model_id, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
        return r.content[0]?.text || "";
      }
      if (member.provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${member.model_id}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens + 400, thinkingConfig: { thinkingBudget: 0 } } }) });
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
        const d = await res.json();
        return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      }
      const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[member.provider];
      const key = process.env[member.env];
      const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: member.model_id, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      const d = await res.json();
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error).slice(0, 150));
      return d.choices?.[0]?.message?.content || "";
    } catch (e) { if (t === tries - 1) throw e; await sleep(1500 * (t + 1)); }
  }
  throw new Error("exhausted retries");
}
// end copied

// §3.1 — the TX map: the same request synthesizeCouncil builds (temperature 0.7, 2048 tokens); only the model differs.
async function synthesizeWithDeepSeek(system, user) {
  for (let t = 0; t < 5; t++) {
    const res = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, body: JSON.stringify({ model: A.SYNTHESIZER.model_id, max_tokens: 2048, temperature: 0.7, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
    const d = await res.json();
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error).slice(0, 150));
    return { text: d.choices?.[0]?.message?.content || "", model_reported: d.model || A.SYNTHESIZER.model_id };
  }
  throw new Error("exhausted retries");
}

// ── calls: live, or scripted (stub/plan) with every call's size logged for the estimate ──
const OUT_TOKENS = { answer: 400, revise: 400, judge: 120, synth: 1500 }; // §6 estimate assumptions
const callLog = [];
let live = false;
async function model(member, kind, system, user, opts) {
  callLog.push({ model: member.model_id, inChars: system.length + user.length, outTokens: OUT_TOKENS[kind] });
  if (!live) return stub(kind, user);
  return kind === "synth" ? (await synthesizeWithDeepSeek(system, user)).text : callModel(member, system, user, opts);
}
const PAD = " It turns on what the question holds fixed and what it leaves open.".repeat(18);
function stub(kind, user) {
  if (kind === "answer") return `Stub first answer.${PAD}`;
  if (kind === "synth") return "Prose.\n```TENSION_MAP\n[{\"voice_a\":\"Grok\",\"claim_a\":\"a\",\"voice_b\":\"Gemini\",\"claim_b\":\"b\",\"topic\":\"t\",\"status\":\"divergent\"},{\"voice_a\":\"Claude\",\"claim_a\":\"x\",\"voice_b\":\"Grok\",\"claim_b\":\"y\",\"topic\":\"dropped\",\"status\":\"divergent\"}]\n```";
  if (kind === "revise") {
    const arm = /Re-examine it\. Are there perspectives/.test(user) ? "P" : !/Key tensions across the panel/.test(user) ? "TP" : /• t: Grok/.test(user) ? "TX" : "TC";
    return `[${arm}] Stub revision.${PAD}`;
  }
  if (kind === "judge") {
    // scripted judges: placebo beats TC and TX, TP beats placebo — enough to exercise every branch of the analysis
    const x = /REVISION_X:\n\[(\w+)\]/.exec(user)?.[1], y = /REVISION_Y:\n\[(\w+)\]/.exec(user)?.[1];
    const other = x === "P" ? y : x;
    const pick = other === "TP" ? other : "P";
    return JSON.stringify({ surfaces_new: "tie", calibration: "tie", overall: pick === x ? "X" : "Y", reason: "stub" });
  }
  return "";
}

// ── inputs ───────────────────────────────────────────────────────────────────
let instances = A.julyInstances();
if (MODE === "stub" && val("--instances")) instances = instances.slice(0, Number(val("--instances"))); // tests only
const recs = A.recordsById();
const outDir = val("--out") || (MODE === "run" ? path.join(ROOT, "analysis/ala-v1") : path.join(tmpdir(), "ala-v1"));
fs.mkdirSync(outDir, { recursive: true });
const MAPS_FILE = path.join(outDir, "tension-maps-deepseek.json");

// persist=false (the estimate pass) never reads or writes the maps file. persist=true reads it if present (§3.1:
// maps are never regenerated) and refuses one that is scripted or from another synthesizer; otherwise it builds the
// maps and writes them BEFORE any consumer call.
async function buildMaps({ persist }) {
  if (persist && fs.existsSync(MAPS_FILE)) {
    const m = JSON.parse(fs.readFileSync(MAPS_FILE, "utf8"));
    if (m.stub || m.synthesizer !== A.SYNTHESIZER.model_id) throw new Error(`${MAPS_FILE} is not a registered ${A.SYNTHESIZER.model_id} map file (stub=${Boolean(m.stub)}); move it aside`);
    return m;
  }
  const maps = { synthesizer: A.SYNTHESIZER.model_id, temperature: 0.7, max_tokens: 2048, stub: !live, built_at: new Date().toISOString(), records: {} };
  for (const id of [...new Set(instances.map((i) => i.record_id))]) {
    const rec = recs.get(id);
    const peers = A.peersOf(rec);
    const { system, user } = synthesisRequest(rec.question, peers);
    let entry = { parsed: false, attempts: [] };
    for (let attempt = 0; attempt < 2 && !entry.parsed; attempt++) {
      const text = await model(A.SYNTHESIZER, "synth", system, user);
      entry.attempts.push({ raw: text });
      if (/```TENSION_MAP/.test(text)) { const f = A.filterTensions(parseSynthesis(text).tensions, peers); entry = { ...entry, parsed: true, tensions: f.kept, dropped: f.dropped }; }
    }
    maps.records[id] = entry;
  }
  if (persist) fs.writeFileSync(MAPS_FILE, JSON.stringify(maps, null, 1));
  return maps;
}

async function runInstance(inst, maps) {
  const rec = recs.get(inst.record_id);
  const peers = A.peersOf(rec);
  const q = inst.question, cap = inst.cap;
  const a1 = (await model(CONSUMER, "answer", A.ANSWER_SYS, q, { maxTokens: cap })).trim();
  const tx = maps.records[inst.record_id];
  const prompts = {
    P: A.placeboUser(q, a1),
    TC: A.treatmentUser(q, a1, peers, rec.tensions || []),
    ...(tx?.parsed ? { TX: A.treatmentUser(q, a1, peers, tx.tensions) } : {}),
    TP: A.peersOnlyUser(q, a1, peers),
  };
  const revised = Object.fromEntries(await Promise.all(Object.entries(prompts).map(async ([k, u]) => [k, (await model(CONSUMER, "revise", A.REVISE_SYS, u, { maxTokens: cap })).trim()])));
  const row = { ...inst, a1, revisions: revised, arms: {}, verdicts: {} };
  await Promise.all(A.ARMS.map(async (arm) => {
    if (!revised[arm]) { row.arms[arm] = null; return; }
    const treatIsX = A.treatmentIsX(inst, arm);
    const X = treatIsX ? revised[arm] : revised.P, Y = treatIsX ? revised.P : revised[arm];
    const map = (v) => v === "tie" ? "tie" : ((v === "X") === treatIsX ? "treatment" : "placebo");
    const judgeUser = `QUESTION:\n"${q}"\n\nORIGINAL:\n${a1}\n\nREVISION_X:\n${X}\n\nREVISION_Y:\n${Y}`;
    const vs = await Promise.all(JUDGES.map(async (J) => {
      const v = A.extractJSON(await model(J, "judge", A.JUDGE_SYS, judgeUser, { maxTokens: 400 }));
      return v ? { judge: J.model, overall: map(v.overall), surfaces_new: map(v.surfaces_new), calibration: map(v.calibration), reason: v.reason } : { judge: J.model, error: "parse failed" };
    }));
    const valid = vs.filter((v) => !v.error);
    row.verdicts[arm] = { treatIsX, verdicts: vs };
    row.arms[arm] = valid.length ? A.panelOverall(valid.map((v) => v.overall)).overall : null;
  }));
  return row;
}

async function runAll(maps, concurrency) {
  const out = new Array(instances.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, instances.length) }, async () => {
    while (next < instances.length) {
      const k = next++;
      try { out[k] = await runInstance(instances[k], maps); } catch (e) { out[k] = { ...instances[k], error: String(e.message).slice(0, 200), arms: {} }; }
      if (live) console.log(`  [${k + 1}/${instances.length}] ${instances[k].record_id} cap=${instances[k].cap} v${instances[k].variant}: ${A.ARMS.map((a) => `${a}=${out[k].arms[a] ?? "–"}`).join(" ")}`);
    }
  }));
  return out;
}

// 1. Estimate: a scripted pass over the real inputs, logging every call's size (§6). Free.
const stubMaps = await buildMaps({ persist: false });
let rows = await runAll(stubMaps, 4);
const est = (() => { let usd = 0; const by = {}; for (const c of callLog) { const u = costUsd(c.model, tokensFor(c.inChars), c.outTokens); usd += u; (by[c.model] ||= { calls: 0, usd: 0 }).calls++; by[c.model].usd += u; } return { calls: callLog.length, usd, by }; })();
const RESERVE = Math.ceil(est.usd * 1.5 * 100) / 100;
const estimate = { instances: instances.length, calls: est.calls, estimate_usd: Number(est.usd.toFixed(2)), reserve_usd: RESERVE, by_model: Object.fromEntries(Object.entries(est.by).map(([k, v]) => [k, { calls: v.calls, usd: Number(v.usd.toFixed(3)) }])), prices: PRICES_AS_OF, output_token_assumptions: OUT_TOKENS };
if (MODE === "plan") { console.log(JSON.stringify(estimate, null, 1)); process.exit(0); }
if (MODE === "stub") fs.writeFileSync(MAPS_FILE, JSON.stringify(stubMaps, null, 1)); // marked stub: a real run refuses it

if (MODE === "run") {
  for (const m of [CONSUMER, ...JUDGES, A.SYNTHESIZER]) if (!process.env[m.env]) { console.error(`missing ${m.env} (${m.model})`); process.exit(1); }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { preflightSpend } = await import("./budget-preflight.mjs");
    await preflightSpend({ estUsd: RESERVE, label: "ala-v1 run" }); // once; exits if it would cross the ceiling
  } else {
    console.error(`[spend] no shared ledger (no BLOB_READ_WRITE_TOKEN): this run is YOUR spend, est. ~$${est.usd.toFixed(2)}.`);
  }
  callLog.length = 0;
  live = true;
  const maps = await buildMaps({ persist: true });
  rows = await runAll(maps, 3);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(outDir, `${MODE}-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify({ study: "ALA v1", mode: MODE, registration: { file: A.PREREG, commit: A.PREREG_COMMIT }, ran_at: new Date().toISOString(), consumer: CONSUMER.model_id, judges: JUDGES.map((j) => j.model_id), inputs: { july: { file: A.JULY_FILE, sha256: A.JULY_SHA256 }, atlas: { file: A.ATLAS_FILE, sha256: A.ATLAS_SHA256 } }, estimate, instances: rows }, null, 1));
const a = A.analyze(rows);
fs.writeFileSync(file.replace(/\.json$/, "") + ".analysis.json", JSON.stringify({ analyzed_at: new Date().toISOString(), mode: MODE, analysis: a }, null, 1));
console.log(JSON.stringify({ mode: MODE, file, verdict: a.verdict, TC: [a.TC.treatment_wins, a.TC.placebo_wins], TX: [a.TX.treatment_wins, a.TX.placebo_wins], TP: [a.TP.treatment_wins, a.TP.placebo_wins], estimate_usd: estimate.estimate_usd }, null, 1));
if (MODE === "stub") console.log("Stub: scripted models; the verdict above only proves the plumbing.");
