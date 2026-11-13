// UTILITY v2 — the run: stages, retries, transcripts, and the spend ceiling in action.
// The CLI is scripts/utility-v2.mjs; the pure rules live in ./utility-v2-core.mjs.
// Everything that touches the network goes through `transport`, so the tests drive the real
// stage code with a fake provider (scripts/test-utility-v2.mjs), including the $30 halt.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createHash } from "node:crypto";
import {
  CONSUMERS, JUDGE_ORDER, B_PEERS, LOW, CAPS, SEED, CEILING_USD, N_QUESTIONS,
  ANSWER_SYS, REVISE_SYS, JUDGE_SYS, MEMBER_SYSTEM, placeboUser, treatmentUser, judgeUser,
  buildRequest, parseReply, worstCaseUsd, SpendGuard, HaltError, judgesFor, peersForA, peersForB,
  treatmentIsX, parseVerdict, instanceVerdict, analyse, costUsd,
} from "./utility-v2-core.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── default transport: node:https, JSON in and out ─────────────────────────────
export function httpsTransport({ url, method = "POST", headers = {}, body = null, timeoutMs = 240000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body == null ? null : JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: { ...headers, ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

// ── small helpers ─────────────────────────────────────────────────────────────
function makeLimiter(limit) {
  let active = 0; const queue = [];
  const next = () => { if (active >= limit || !queue.length) return; active++; const { fn, res, rej } = queue.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const writeJson = (f, obj) => { const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + "\n"); fs.renameSync(tmp, f); };

export function loadQuestions(root) {
  const A = JSON.parse(fs.readFileSync(path.join(root, "docs/utility-v2/questions-A.json"), "utf8"));
  const B = JSON.parse(fs.readFileSync(path.join(root, "docs/utility-v2/questions-B.json"), "utf8"));
  for (const q of A.questions) {
    if (sha(q.question) !== q.question_sha256) throw new Error(`A ${q.id}: question text does not match its frozen hash`);
    for (const a of q.answers) if (sha(a.text) !== a.sha256) throw new Error(`A ${q.id} ${a.model}: stored answer does not match its frozen hash`);
  }
  if (A.questions.length !== N_QUESTIONS || B.questions.length !== N_QUESTIONS) throw new Error("frozen lists must hold 24 questions each");
  return { A: A.questions, B: B.questions, probe: B.probe_question };
}

// ── the runner ────────────────────────────────────────────────────────────────
export function createRunner({ runDir, keys = {}, transport = httpsTransport, log = () => {}, now = () => new Date(), perProviderConcurrency = 4, backoffMs = 3000 }) {
  fs.mkdirSync(runDir, { recursive: true });
  const F = (name) => path.join(runDir, name);
  const isoDate = () => now().toISOString().slice(0, 10);
  const spendFile = F("spend.json");
  const prior = fs.existsSync(spendFile) ? JSON.parse(fs.readFileSync(spendFile, "utf8")) : null;
  const guard = new SpendGuard({ ceilingUsd: CEILING_USD, spentUsd: prior?.spent_usd || 0, byModel: prior?.by_model || {}, calls: prior?.calls || 0, noUsage: prior?.no_usage || 0, isoDate: isoDate() });
  if (prior?.halted) guard.halted = true;
  const limiters = {};
  const limiterFor = (p) => (limiters[p] ||= makeLimiter(perProviderConcurrency));
  const saveSpend = () => writeJson(spendFile, { ...guard.snapshot(), updated: now().toISOString() });

  // One logical call with transport-level retries (429/5xx/network). Every HTTP attempt reserves
  // its worst case first; HaltError propagates and stops the stage.
  async function callModel(member, { system, user, cap, peer = null, tries = 5 }) {
    return limiterFor(member.provider)(async () => {
      let last = null;
      for (let t = 0; t < tries; t++) {
        const req = buildRequest(member, { system, user, cap, keys, peer });
        const reserved = guard.reserve(worstCaseUsd(member, req, isoDate()), member.model_id);
        let res;
        try {
          res = await transport({ url: req.url, method: "POST", headers: req.headers, body: req.body });
        } catch (e) {
          guard.settle(reserved, member.model_id, null, { outcome: "unknown" }); saveSpend();
          last = { error: `network: ${String(e?.message || e).slice(0, 160)}` };
          await sleep(backoffMs * (t + 1)); continue;
        }
        if (res.status === 429 || res.status >= 500) {
          guard.settle(reserved, member.model_id, null, { outcome: "http_error" }); saveSpend();
          last = { http_status: res.status, error: String(res.text || "").slice(0, 200) };
          await sleep(backoffMs * 2 * (t + 1)); continue;
        }
        if (res.status >= 400 || !res.json) {
          guard.settle(reserved, member.model_id, null, { outcome: "http_error" }); saveSpend();
          return { ok: false, http_status: res.status, error: String(res.json?.error?.message || res.text || "").slice(0, 300), text: "", usage: null, cost_usd: 0, tries: t + 1 };
        }
        const p = parseReply(member.provider, res.json);
        const cost = guard.settle(reserved, member.model_id, p.usage); saveSpend();
        return { ok: true, http_status: res.status, text: p.text.trim(), resolved: p.resolved, truncated: p.truncated, refusal: p.refusal, refusal_category: p.refusal_category ?? null, usage: p.usage, cost_usd: +cost.toFixed(6), tries: t + 1 };
      }
      return { ok: false, text: "", usage: null, cost_usd: 0, tries, ...last };
    });
  }
  const usable = (r) => r.ok && r.text && !r.truncated && !r.refusal;
  // Registration §3 "Failures": a truncated, empty, refused or failed answer is retried once at the same cap.
  async function answerWithRetry(member, args) {
    const first = await callModel(member, args);
    if (usable(first)) return { final: first, attempts: [first] };
    const second = await callModel(member, args);
    return { final: second, attempts: [first, second] };
  }
  const meta = (r) => ({ ok: r.ok, http_status: r.http_status ?? null, resolved: r.resolved ?? null, truncated: Boolean(r.truncated), refusal: Boolean(r.refusal), refusal_category: r.refusal_category ?? null, usage: r.usage ?? null, cost_usd: r.cost_usd ?? 0, tries: r.tries ?? null, error: r.error ?? null });

  async function runAll(tasks) {
    let halt = null;
    await Promise.all(tasks.map(async (task) => {
      if (halt) return;
      try { await task(); } catch (e) { if (e instanceof HaltError) { halt ||= e; } else throw e; }
    }));
    saveSpend();
    if (halt) throw halt;
  }

  // ── B elicitation ───────────────────────────────────────────────────────────
  // One answer per flagship per question, FRONTIER_COUNCIL settings, no fallback model. Retried once
  // when empty, refused, failed or truncated; a second truncated answer is kept as returned (it is
  // still that model's verbatim text) and flagged; a second empty answer leaves that peer absent.
  async function elicitOne(q, peer) {
    const member = { model_id: peer.model_id, provider: peer.provider };
    const { final, attempts } = await answerWithRetry(member, { system: MEMBER_SYSTEM, user: q.question, peer });
    const text = final.ok && !final.refusal ? final.text : "";
    return { qid: q.id, label: peer.label, lab: peer.lab, model_id: peer.model_id, date: now().toISOString(), text, absent: !text, truncated: Boolean(text && final.truncated), attempts: attempts.map(meta) };
  }
  async function elicit(questions, file = F("elicitation-B.jsonl")) {
    const done = new Set(readJsonl(file).map((r) => `${r.qid}|${r.model_id}`));
    const tasks = [];
    for (const q of questions) for (const p of B_PEERS) {
      if (done.has(`${q.id}|${p.model_id}`)) continue;
      tasks.push(async () => { const row = await elicitOne(q, p); fs.appendFileSync(file, JSON.stringify(row) + "\n"); log(`elicit ${q.id} ${p.model_id}${row.absent ? " ABSENT" : row.truncated ? " (truncated)" : ""} $${row.attempts.reduce((s, a) => s + a.cost_usd, 0).toFixed(4)}`); });
    }
    await runAll(tasks);
    return readJsonl(file);
  }
  const elicitedMap = (rows) => rows.reduce((m, r) => (((m[r.qid] ||= {})[r.model_id] = r), m), {});

  // ── consumer instances ────────────────────────────────────────────────────────
  async function consumerInstance(substudy, q, c, peers) {
    const question = q.question;
    const base = await answerWithRetry(c, { system: ANSWER_SYS, user: question, cap: CAPS.consumer });
    const row = { substudy, qid: q.id, model_id: c.model_id, tier: c.tier, lab: c.lab, date: now().toISOString(), peers_shown: peers.map((p) => p.label), calls: { baseline: base.attempts.map(meta) } };
    if (!usable(base.final)) return { ...row, status: "failed", failed_arm: "baseline" };
    const a1 = base.final.text;
    const [pl, tr] = await Promise.all([
      answerWithRetry(c, { system: REVISE_SYS, user: placeboUser(question, a1), cap: CAPS.consumer }),
      answerWithRetry(c, { system: REVISE_SYS, user: treatmentUser(question, a1, peers), cap: CAPS.consumer }),
    ]);
    row.calls.placebo = pl.attempts.map(meta); row.calls.treatment = tr.attempts.map(meta);
    row.original = a1;
    if (!usable(pl.final) || !usable(tr.final)) return { ...row, status: "failed", failed_arm: !usable(pl.final) ? "placebo" : "treatment", placebo: pl.final.text || null, treatment: tr.final.text || null };
    return { ...row, status: "ok", placebo: pl.final.text, treatment: tr.final.text };
  }
  async function consumers(substudy, questions, peersFor, file) {
    const done = new Set(readJsonl(file).map((r) => `${r.qid}|${r.model_id}`));
    const tasks = [];
    for (const q of questions) for (const c of CONSUMERS) {
      if (done.has(`${q.id}|${c.model_id}`)) continue;
      tasks.push(async () => { const row = await consumerInstance(substudy, q, c, peersFor(q, c.lab)); fs.appendFileSync(file, JSON.stringify(row) + "\n"); log(`${substudy} ${q.id} ${c.model_id} ${row.status}${row.failed_arm ? ` (${row.failed_arm})` : ""}`); });
    }
    await runAll(tasks);
    return readJsonl(file);
  }

  // ── judging ──────────────────────────────────────────────────────────────────
  // Each judge call is retried once when it yields no parseable verdict; an instance needs two.
  async function judgeInstance(inst, question) {
    const treatIsX = treatmentIsX(SEED, inst.substudy, inst.qid, inst.model_id);
    const X = treatIsX ? inst.treatment : inst.placebo, Y = treatIsX ? inst.placebo : inst.treatment;
    const user = judgeUser(question, inst.original, X, Y);
    const verdicts = await Promise.all(judgesFor(inst.lab).map(async (j) => {
      const attempts = [];
      let parsed = null, raw = "";
      for (let k = 0; k < 2 && !parsed; k++) {
        const r = await callModel(j, { system: JUDGE_SYS, user, cap: CAPS.judge });
        attempts.push(meta(r));
        raw = r.text || "";
        parsed = r.ok && !r.refusal ? parseVerdict(raw, treatIsX) : null;
      }
      return { judge: j.model_id, parsed, raw: raw.slice(0, 2000), attempts };
    }));
    const valid = verdicts.filter((v) => v.parsed);
    const base = { substudy: inst.substudy, qid: inst.qid, model_id: inst.model_id, tier: inst.tier, treatIsX, date: now().toISOString(), judges: verdicts };
    if (valid.length < 2) return { ...base, status: "failed", failed_arm: "judging" };
    const { verdict, tally } = instanceVerdict(valid.map((v) => v.parsed.overall));
    return { ...base, status: "ok", verdict, tally };
  }
  async function judges(substudy, instances, questionText, file) {
    const done = new Set(readJsonl(file).map((r) => `${r.qid}|${r.model_id}`));
    const tasks = instances.filter((x) => x.status === "ok" && !done.has(`${x.qid}|${x.model_id}`)).map((inst) => async () => {
      const row = await judgeInstance(inst, questionText(inst.qid)); fs.appendFileSync(file, JSON.stringify(row) + "\n");
      log(`judge ${substudy} ${inst.qid} ${inst.model_id} → ${row.verdict || row.status}`);
    });
    await runAll(tasks);
    return readJsonl(file);
  }

  // ── preflight: model lists (free) + one tiny call per study call shape ─────────
  async function modelListed(member) {
    const id = member.model_id;
    const spec = {
      anthropic: { url: `https://api.anthropic.com/v1/models/${id}`, headers: { "x-api-key": keys.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } },
      openai: { url: `https://api.openai.com/v1/models/${id}`, headers: { authorization: `Bearer ${keys.OPENAI_API_KEY}` } },
      gemini: { url: `https://generativelanguage.googleapis.com/v1beta/models/${id}`, headers: { "x-goog-api-key": keys.GEMINI_API_KEY } },
      xai: { url: `https://api.x.ai/v1/models/${id}`, headers: { authorization: `Bearer ${keys.XAI_API_KEY}` } },
      deepseek: { url: "https://api.deepseek.com/models", headers: { authorization: `Bearer ${keys.DEEPSEEK_API_KEY}` } },
    }[member.provider];
    try {
      const r = await transport({ ...spec, method: "GET" });
      if (member.provider === "deepseek") return { listed: r.status === 200 && (r.json?.data || []).some((m) => m.id === id), status: r.status };
      return { listed: r.status === 200, status: r.status };
    } catch (e) { return { listed: false, error: String(e?.message || e).slice(0, 120) }; }
  }
  async function preflight() {
    const shapes = [
      ...CONSUMERS.map((c) => ({ role: `consumer (${c.tier})`, member: c, cap: CAPS.consumer, peer: null })),
      ...JUDGE_ORDER.map((j) => ({ role: "judge", member: j, cap: CAPS.judge, peer: null })),
      ...B_PEERS.map((p) => ({ role: "B peer (FRONTIER_COUNCIL settings)", member: { model_id: p.model_id, provider: p.provider }, cap: null, peer: p })),
    ];
    const rows = [];
    await runAll(shapes.map((s) => async () => {
      const listing = await modelListed(s.member);
      const r = await callModel(s.member, { system: "Reply with the single word OK.", user: "Say OK.", cap: s.cap, peer: s.peer, tries: 2 });
      const settings = s.peer ? (s.peer.body || s.peer.generationConfig) : (LOW[s.member.model_id].body || LOW[s.member.model_id].thinkingConfig);
      rows.push({ role: s.role, model_id: s.member.model_id, settings, listed: listing.listed, list_status: listing.status ?? listing.error, pass: Boolean(r.ok && r.text && !r.refusal), reply: (r.text || "").slice(0, 40), ...meta(r) });
    }));
    const out = { date: now().toISOString(), all_pass: rows.every((r) => r.pass && r.listed), rows, spend: guard.snapshot() };
    writeJson(F("preflight.json"), out);
    return out;
  }

  // ── cost probe: the whole pipeline once, on the throwaway question ──────────────
  async function probe(probeQ) {
    const elic = await elicit([probeQ], F("probe-elicitation.jsonl"));
    const em = elicitedMap(elic)[probeQ.id] || {};
    const inst = await consumers("probe", [probeQ], (q, lab) => peersForB(em, lab), F("probe-consumers.jsonl"));
    const jr = await judges("probe", inst, () => probeQ.question, F("probe-judges.jsonl"));
    const sumCalls = (calls) => Object.values(calls || {}).flat().reduce((s, a) => s + (a.cost_usd || 0), 0);
    const elicitCost = elic.reduce((s, r) => s + r.attempts.reduce((t, a) => t + a.cost_usd, 0), 0);
    const perConsumer = CONSUMERS.map((c) => {
      const ci = inst.find((x) => x.model_id === c.model_id);
      const ji = jr.find((x) => x.model_id === c.model_id);
      const consumerUsd = sumCalls(ci?.calls);
      const judgeUsd = (ji?.judges || []).reduce((s, j) => s + j.attempts.reduce((t, a) => t + a.cost_usd, 0), 0);
      return { model_id: c.model_id, status: ci?.status || "missing", judged: ji?.status || "not judged", consumer_usd: +consumerUsd.toFixed(5), judges_usd: +judgeUsd.toFixed(5), instance_usd: +(consumerUsd + judgeUsd).toFixed(5) };
    });
    const missing = perConsumer.filter((r) => r.status !== "ok" || r.judged !== "ok").map((r) => r.model_id);
    const remaining = perConsumer.reduce((s, r) => s + r.instance_usd, 0) * 2 * N_QUESTIONS + elicitCost * N_QUESTIONS;
    const projected = guard.spentUsd + remaining;
    const out = {
      date: now().toISOString(), question: probeQ.id,
      method: "remaining = Σ_consumers (probe instance cost: 3 consumer calls + 3 judge calls) × 48 + probe elicitation cost × 24. Sub-study A shows stored answers, which are shorter than fresh ones, so this errs high.",
      elicitation_usd: +elicitCost.toFixed(5), per_consumer: perConsumer, incomplete: missing,
      spent_so_far_usd: +guard.spentUsd.toFixed(5), projected_remaining_usd: +remaining.toFixed(4), projected_total_usd: +projected.toFixed(4), ceiling_usd: CEILING_USD,
      decision: missing.length ? "STOP: the probe did not complete for every consumer, so the projection is not measured" : projected > CEILING_USD ? "STOP: projection exceeds the ceiling" : "GO",
    };
    writeJson(F("probe.json"), out);
    return out;
  }

  return { guard, callModel, answerWithRetry, elicit, elicitedMap, consumers, judges, preflight, probe, saveSpend, F, readJsonl };
}

// ── analysis over the run's transcripts ─────────────────────────────────────────
export function assembleInstances(runDir) {
  const out = [];
  for (const S of ["A", "B"]) {
    const cons = readJsonl(path.join(runDir, `consumers-${S}.jsonl`));
    const judged = new Map(readJsonl(path.join(runDir, `judges-${S}.jsonl`)).map((r) => [`${r.qid}|${r.model_id}`, r]));
    for (const c of cons) {
      const j = judged.get(`${c.qid}|${c.model_id}`);
      if (c.status !== "ok") { out.push({ substudy: S, qid: c.qid, model_id: c.model_id, tier: c.tier, status: "failed", failed_arm: c.failed_arm }); continue; }
      if (!j || j.status !== "ok") { out.push({ substudy: S, qid: c.qid, model_id: c.model_id, tier: c.tier, status: "failed", failed_arm: j ? "judging" : "not judged" }); continue; }
      const valid = j.judges.filter((v) => v.parsed);
      out.push({ substudy: S, qid: c.qid, model_id: c.model_id, tier: c.tier, status: "ok", verdict: j.verdict, overalls: valid.map((v) => v.parsed.overall), votes: valid.map((v) => v.parsed) });
    }
  }
  return out;
}
export function analyseRun(runDir) {
  const instances = assembleInstances(runDir);
  return { ...analyse(instances), instances_total: instances.length };
}
export { costUsd };
