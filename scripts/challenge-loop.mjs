#!/usr/bin/env node
// CRT v1 — Challenge-Response Test runner. Registration: docs/challenge-response-preregistration.md (pushed in 26e37fb
// before this file existed). Claim under test: challenge-moves-positions-beyond-pressure.
//
// For each (question, subject lineage): the subject answers (FP-A, admitted), its fixed challenger writes a REAL
// challenge and a reasonless SHAM of matched length, a judge checks the manipulation, and four fresh instances of the
// subject respond — F (plain re-ask), N (own record, no challenge), S (sham admitted), R (real admitted). N/S/R are
// handed exactly what the archive returns for FP-A's continuance receipt. Then the three-labeller rule labels the texts.
//
// The ENGINE is the real handlers through the real rewrites over the in-memory store (the stranger-loop clean room),
// so nothing here can touch production. Model calls go out over node:https with keys from SL_<ENV> or --env-file.
//
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/challenge-loop.mjs --plan       # cost estimate; no calls, no keys
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/challenge-loop.mjs --stub       # scripted models, free (tests)
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/challenge-loop.mjs --smoke --yes --env-file .env.local
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/challenge-loop.mjs --main --yes --env-file .env.local
//   node scripts/challenge-loop.mjs --analyze analysis/crt-v1/main-<ts>.json                # re-derive the verdict
//
// Live modes reserve the estimate ONCE on the shared ledger (scripts/budget-preflight.mjs, spawned without the
// loader so it reaches the real store) before the first call, and never again on a restart.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as C from "./lib/crt-core.mjs";
import { chat, firstJSONObject, readKeys } from "./lib/provider-chat.mjs";
import { costUsd, tokensFor, PRICES_AS_OF } from "./lib/model-prices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const has = (f) => args.includes(f);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ── --analyze: no engine, no loader needed ───────────────────────────────────
if (has("--analyze")) {
  const file = val("--analyze");
  const run = JSON.parse(readFileSync(file, "utf8"));
  const a = C.analyze(run.items);
  writeFileSync(file.replace(/\.json$/, "") + ".analysis.json", JSON.stringify({ analyzed_at: new Date().toISOString(), mode: run.mode, analysis: a }, null, 1));
  console.log(JSON.stringify({ mode: run.mode, verdict: a.verdict, valid: a.valid, lost: a.lost, H1: { n: a.H1.n, rate: a.H1.rate, p: a.H1.p_one_sided }, H2: { n: a.H2.n, rate: a.H2.rate, p: a.H2.p_one_sided }, O2: { n: a.O2_R_vs_S.n, diff: a.O2_R_vs_S.diff } }, null, 1));
  process.exit(0);
}

const MODE = has("--main") ? "main" : has("--smoke") ? "smoke" : has("--stub") ? "stub" : has("--plan") ? "plan" : null;
if (!MODE) { console.error("Choose one of --plan, --stub, --smoke, --main (or --analyze <file>). See the header."); process.exit(2); }
const LIVE = MODE === "smoke" || MODE === "main";
if (LIVE && !has("--yes")) { console.error("This spends real model calls. Run --plan for the estimate, then re-run with --yes."); process.exit(2); }

// The engine must be the in-memory store: refuse to run if @vercel/blob is the real SDK.
const blob = await import("@vercel/blob");
if (typeof blob.__snapshot !== "function") { console.error("Run under the hermetic loader: node --import ./scripts/lib/register-mem-blob.mjs scripts/challenge-loop.mjs …"); process.exit(2); }
const { call } = await import("./lib/invoke.mjs");
const { EXTRACTION_SYSTEM, extractionUserMessage, groundClassification } = await import("./lib/stance-extract.mjs");
const { judge: consensusJudge, PANEL } = await import("./stance-consensus.mjs");
const { COUNCIL } = await import("../api/_council.js");

process.env.INGEST_SECRET = "crt-v1-curator";
process.env.BLOB_READ_WRITE_TOKEN = "local-in-memory-store-not-persistent";
const CURATOR = { authorization: "Bearer crt-v1-curator" };

const PROMPTS = C.loadPrompts();
const KEYS = LIVE ? readKeys(val("--env-file"), readFileSync) : {};
const member = (label) => { const m = COUNCIL.find((c) => c.model === label); if (!m) throw new Error(`unknown council member ${label}`); return m; };
const LABELLERS = PANEL.map((model_id) => ({ model_id, provider: model_id.startsWith("claude") ? "anthropic" : model_id.startsWith("gemini") ? "gemini" : "deepseek" }));
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", xai: "XAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };

// ── models: live, stub (scripted, free) or plan (stub + a log of every call's size) ──
const OUT_TOKENS = { stage1: 450, challenge: 330, sham: 300, check: 30, return: 500, label: 120 }; // §7 estimate assumptions
let callLog = [];
let usage = {};
let useLive = false; // flipped on only for the real pass, after the estimate pass and the ledger reservation
async function ask(m, kind, messages, opts = {}) {
  const inChars = (opts.system || "").length + messages.reduce((s, x) => s + x.content.length, 0);
  // gemini-2.5-flash bills its thinking as output; short-answer kinds get a 400-token allowance for it
  callLog.push({ model: m.model_id, kind, inChars, outTokens: m.provider === "gemini" && kind !== "stage1" && kind !== "return" ? Math.max(OUT_TOKENS[kind], 400) : OUT_TOKENS[kind] });
  if (!useLive) return { text: stubReply(kind, messages, opts), model: m.model_id };
  const r = await chat(m, messages, { key: KEYS[KEY_ENV[m.provider]], ...opts });
  const u = (usage[m.model_id] ||= { calls: 0, in: 0, out: 0 });
  u.calls++; u.in += r.usage.in; u.out += r.usage.out;
  return r;
}
// One retry on a parse failure (§6), as a follow-up turn.
async function askJSON(m, kind, prompt, opts = {}) {
  const messages = [{ role: "user", content: prompt }];
  const first = await ask(m, kind, messages, opts);
  let parsed = firstJSONObject(first.text);
  const turns = [first.text];
  let reported = first.model;
  if (!parsed) {
    const second = await ask(m, kind, [...messages, { role: "assistant", content: first.text || "(empty)" }, { role: "user", content: C.RETRY_NUDGE }], opts);
    parsed = firstJSONObject(second.text); turns.push(second.text); reported = second.model;
  }
  return { parsed, turns, messages, model_reported: reported };
}

// Scripted stand-ins: realistic lengths (so --plan sizes are honest), deterministic content (so tests can assert).
const PAD = " The reasoning turns on what the question treats as fixed and what it leaves open, and on whether the trade-off it names is real or only apparent.".repeat(9);
function stubReply(kind, messages, opts) {
  const u = messages[messages.length - 1].content, first = messages[0].content;
  if (kind === "stage1") return JSON.stringify({ answer: `Stub answer.${PAD}`, stance: "support", conditions_that_would_change_my_view: ["a counterexample that holds"] });
  if (kind === "challenge") return JSON.stringify({ answer: `Stub challenge: this fails because of a concrete counterexample.${PAD.slice(0, 600)}`, stance: "oppose" });
  if (kind === "sham") return JSON.stringify({ answer: `Stub sham: this is simply wrong and I am confident it is wrong.${" Wrong.".repeat(60)}`, stance: "oppose" });
  if (kind === "check") return JSON.stringify({ specific_reason: /because/.test(u.split("\nREPLY:\n")[1] || "") });
  if (kind === "return") {
    // Read the challenge block itself: the stance list elsewhere in the prompt also contains "because".
    const block = /<CHALLENGE id="(OMN-FP-[^"]+)">\n([^]*?)\n<\/CHALLENGE>/.exec(first);
    const real = block && /because/.test(block[2]) ? block : null;
    const sham = block && !real ? block : null;
    if (real) return JSON.stringify({ action: "contribute", body: { answer: `Stub revised: the counterexample lands.${PAD}`, event_type: "position_revised", position: { stance: "conditional", conditions_that_would_change_my_view: ["a rebuttal of the counterexample"] }, relationships: { responds_to: [real[1]] }, revision_basis: "The counterexample shows the claim fails in one case." } });
    if (sham) return JSON.stringify({ action: "contribute", body: { answer: `Stub defends: no reason was given.${PAD}`, event_type: "objection_raised", position: { stance: "support", conditions_that_would_change_my_view: ["an actual argument"] }, relationships: { challenges: [sham[1]] }, revision_basis: "The reply gave no reason." } });
    return JSON.stringify({ action: "decline", reason: "Nothing new to add." });
  }
  if (kind === "label") {
    const ans = /<answer>\n([^]*?)\n<\/answer>/.exec(u)?.[1] || "";
    const span = ans.split(/(?<=[.:])\s/)[0];
    return JSON.stringify({ stance: /^Stub revised/.test(ans) ? "conditional" : "support", evidence_span: span, rationale: "stub", confidence: 0.9 });
  }
  return "{}";
}

// ── the engine (in-memory) ───────────────────────────────────────────────────
let lock = Promise.resolve();
const withStore = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };
let BASE = null;
function seedBase(atlas) {
  blob.__reset();
  const entries = atlas.map((r) => ({
    id: r.id, title: `Divergence: ${r.question.slice(0, 80)}`, ring: "open", type: "divergence",
    date: r.captured_at, contributors: r.contributors || [], excerpt: r.question.slice(0, 200),
    divergence: { question: r.question, method: r.method, answers: r.answers || [], tensions: r.tensions || [], certification: r.certification || null, deliberation_card: r.deliberation_card || null },
  }));
  blob.__seed("memory/grown.json", { version: 1, updatedAt: new Date().toISOString(), entries, vectors: {} });
  BASE = blob.__snapshot();
}
const tick = () => new Promise((r) => setTimeout(r, 3)); // occurred_at is ms-resolution
async function postAndAdmit(body) {
  await tick();
  const r = await call("/api/contribute", { method: "POST", body });
  if (r.status !== 200) return { ok: false, status: r.status, error: r.body };
  const a = await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: r.body.received.id }, headers: CURATOR });
  return { ok: a.status === 200, status: r.status, footprint_id: r.body.footprint_id, token: r.body.continuance?.token, response: r.body };
}
async function packetFor(fpA, token) {
  const fp = await call(`/api/footprints?id=${fpA}&receipt=${token}`);
  const cont = await call(`/api/inheritance?from=${fpA}&receipt=${token}`);
  const chIds = (cont.body?.open_challenges_to_this || []).map((c) => c.id);
  const challenges = [];
  for (const id of chIds) challenges.push({ id, json: (await call(`/api/footprints?id=${id}`)).body });
  return { footprint: fp.body, continuance: cont.body, challenges };
}

// ── one item ─────────────────────────────────────────────────────────────────
async function runItem(rec, subject) {
  const S = member(subject), M = member(C.CHALLENGER[subject]), J = C.checkJudgeFor(subject);
  const item = { record_id: rec.id, question: rec.question, subject, subject_model: S.model_id, challenger: M.model, challenger_model: M.model_id, check_judge: J.model_id, lost: null, check: {}, arms: {}, o1: {}, o2: {} };
  const stage1 = C.fill(PROMPTS.STAGE1, { question: rec.question }, PROMPTS.STANCES);

  // 1. prior
  const prior = await askJSON(S, "stage1", stage1);
  item.prior = { turns: prior.turns, reply: prior.parsed, model_reported: prior.model_reported };
  const priorStance = C.declaredStance(prior.parsed);
  if (!prior.parsed?.answer || !priorStance) { item.lost = "prior-unparseable"; return item; }
  const conds = (Array.isArray(prior.parsed.conditions_that_would_change_my_view) ? prior.parsed.conditions_that_would_change_my_view : []).filter((c) => typeof c === "string" && c.trim()).slice(0, 3);
  const fpA = await withStore(async () => {
    blob.__restore(BASE);
    const r = await postAndAdmit({ id: rec.id, identity: subject, justification: "new_contributor", answer: String(prior.parsed.answer), position: { stance: priorStance, conditions_that_would_change_my_view: conds } });
    return r.ok ? { ...r, snap: blob.__snapshot() } : r;
  });
  if (!fpA.ok) { item.lost = `prior-rejected (${fpA.status})`; item.prior.engine_error = fpA.error; return item; }
  item.prior.footprint_id = fpA.footprint_id;
  item.prior.stance = priorStance;

  // 2–3. real challenge, then the sham at the real one's length
  const slots = { question: rec.question, prior_answer: String(prior.parsed.answer), prior_stance: priorStance, prior_conditions: C.conditionsBlock(conds) };
  const real = await askJSON(M, "challenge", C.fill(PROMPTS.CHALLENGE, slots, PROMPTS.STANCES));
  if (!real.parsed?.answer) { item.lost = "challenge-unparseable"; item.real = { turns: real.turns }; return item; }
  const W = C.wordCount(real.parsed.answer);
  const sham = await askJSON(M, "sham", C.fill(PROMPTS.SHAM, { ...slots, W }, PROMPTS.STANCES));
  if (!sham.parsed?.answer) { item.lost = "sham-unparseable"; item.sham = { turns: sham.turns }; return item; }
  item.real = { turns: real.turns, reply: real.parsed, words: W, model_reported: real.model_reported };
  item.sham = { turns: sham.turns, reply: sham.parsed, words: C.wordCount(sham.parsed.answer), model_reported: sham.model_reported };

  // 4. manipulation check, order seeded per item
  const realFirst = parseInt(sha256(`crt-v1|check|${rec.id}|${subject}`)[0], 16) % 2 === 0;
  const checkOne = async (reply) => {
    const r = await askJSON(J, "check", C.fill(PROMPTS.CHECK, { question: rec.question, prior_answer: String(prior.parsed.answer), reply: String(reply) }, PROMPTS.STANCES));
    return { value: typeof r.parsed?.specific_reason === "boolean" ? r.parsed.specific_reason : null, turns: r.turns };
  };
  const order = realFirst ? ["R", "S"] : ["S", "R"];
  for (const k of order) { const c = await checkOne(k === "R" ? real.parsed.answer : sham.parsed.answer); item.check[k] = c.value; item.check[`${k}_turns`] = c.turns; }
  item.check.order = order;

  // 5. arm states + packets (store sections are serialized; model calls are not)
  const challengeBody = (reply) => ({ id: rec.id, identity: M.model, justification: "independent_objection", event_type: "objection_raised", answer: String(reply.answer), ...(C.declaredStance(reply) ? { position: { stance: C.declaredStance(reply) } } : {}), relationships: { encountered: [fpA.footprint_id], challenges: [fpA.footprint_id] } });
  const states = await withStore(async () => {
    const out = {};
    blob.__restore(fpA.snap);
    out.N = { snap: blob.__snapshot(), packet: await packetFor(fpA.footprint_id, fpA.token) };
    for (const [arm, reply] of [["S", sham.parsed], ["R", real.parsed]]) {
      blob.__restore(fpA.snap);
      const ch = await postAndAdmit(challengeBody(reply));
      if (!ch.ok) { out[arm] = { error: ch.error, status: ch.status }; continue; }
      out[arm] = { snap: blob.__snapshot(), challenge_footprint: ch.footprint_id, packet: await packetFor(fpA.footprint_id, fpA.token) };
    }
    return out;
  });
  if (states.S.error || states.R.error) { item.lost = "challenge-footprint-rejected"; item.engine_error = states.S.error || states.R.error; return item; }

  const returnPrompt = (p) => C.fill(PROMPTS.RETURN, { label: subject, footprint_json: JSON.stringify(p.footprint, null, 2), continuance_json: JSON.stringify(p.continuance, null, 2), challenge_blocks: C.challengeBlocks(p.challenges) }, PROMPTS.STANCES);
  const [F, ...returns] = await Promise.all([askJSON(S, "stage1", stage1), ...["N", "S", "R"].map((arm) => askJSON(S, "return", returnPrompt(states[arm].packet)))]);
  item.arms.F = { turns: F.turns, reply: F.parsed, stance: C.declaredStance(F.parsed), answer: F.parsed?.answer ?? null, missing: !C.declaredStance(F.parsed), model_reported: F.model_reported };

  // posterior bodies are posted in their own arm state; one resend after an engine rejection (§3.1)
  for (const [i, arm] of ["N", "S", "R"].entries()) {
    const r = returns[i];
    const rec2 = { prompt_sha256: sha256(r.messages[0].content), challenge_footprint: states[arm].challenge_footprint || null, turns: r.turns, reply: r.parsed, model_reported: r.model_reported };
    const decide = async (parsed) => {
      if (parsed?.action === "decline") return { declined: true, reason: String(parsed.reason ?? "") };
      if (parsed?.action !== "contribute" || !parsed.body || typeof parsed.body !== "object") return { invalid: "no contribute/decline action" };
      const b = { ...parsed.body, id: rec.id, identity: subject };
      if (!b.justification) b.justification = b.event_type === "position_reaffirmed" ? "concurrence" : "independent_objection";
      if (b.event_type === "position_revised") b.relationships = { ...(b.relationships || {}), supersedes: b.relationships?.supersedes || fpA.footprint_id };
      return withStore(async () => {
        blob.__restore(states[arm].snap);
        await tick();
        const res = await call("/api/contribute", { method: "POST", body: b });
        return res.status === 200 ? { accepted: true, body: b, footprint_id: res.body.footprint_id, schema: res.body.footprint?.schema } : { rejected: true, status: res.status, error: res.body?.error, errors: res.body?.errors, body: b };
      });
    };
    let outcome = await decide(r.parsed);
    if (outcome.rejected || outcome.invalid) {
      const why = outcome.rejected ? `The archive rejected that body (HTTP ${outcome.status}): ${outcome.error}${outcome.errors ? ` — ${outcome.errors.slice(0, 3).join("; ")}` : ""}` : "That reply was neither a contribute nor a decline action.";
      const again = await ask(S, "return", [...r.messages, { role: "assistant", content: r.turns[r.turns.length - 1] || "(empty)" }, { role: "user", content: `${why}\nSend a corrected JSON object, or decline.` }]);
      rec2.resend = { error: why, turn: again.text };
      outcome = await decide(firstJSONObject(again.text));
    }
    rec2.outcome = outcome;
    rec2.declined = Boolean(outcome.declined);
    rec2.missing = !outcome.declined && !outcome.accepted;
    rec2.stance = outcome.accepted ? C.declaredStance({ stance: outcome.body.position?.stance }) : null;
    if (outcome.accepted && !rec2.stance) rec2.missing = true; // a contribution with no declared stance is missing (§3.2)
    rec2.answer = outcome.accepted ? String(outcome.body.answer ?? "") : null;
    item.arms[arm] = rec2;
  }

  // O2 — the three-labeller rule over prior + each posterior answer
  const labelOne = async (text) => {
    if (!text) return null;
    const votes = {};
    await Promise.all(LABELLERS.map(async (L) => {
      try {
        const r = await ask(L, "label", [{ role: "user", content: extractionUserMessage(rec.question, text) }], { system: EXTRACTION_SYSTEM, temperature: 0, maxTokens: 400 });
        const g = groundClassification(text, firstJSONObject(r.text));
        votes[L.model_id] = { stance: g.stance, guard: g.guard };
      } catch (e) { votes[L.model_id] = { stance: "unclear", guard: "labeller-error", error: String(e.message).slice(0, 120) }; }
    }));
    const j = consensusJudge(votes);
    return { ballots: votes, ...j, label: j.status === "consensus" ? j.consensus : null }; // j.votes is the COUNT of non-abstaining votes
  };
  const [lp, lF, lN, lS, lR] = await Promise.all([labelOne(String(prior.parsed.answer)), labelOne(item.arms.F.answer), labelOne(item.arms.N.answer), labelOne(item.arms.S.answer), labelOne(item.arms.R.answer)]);
  item.labels = { prior: lp, F: lF, N: lN, S: lS, R: lR };
  for (const arm of ["F", "N", "S", "R"]) {
    const a = item.arms[arm];
    item.o1[arm] = C.revisedO1(priorStance, a);
    item.o2[arm] = C.revisedO2(lp?.label || null, { ...a, label: item.labels[arm]?.label || null });
  }
  return item;
}

// ── run ──────────────────────────────────────────────────────────────────────
const atlas = C.readAtlas();
const sel = C.selectQuestions(atlas);
if (sel.smoke !== C.SMOKE_QUESTION || JSON.stringify(sel.test) !== JSON.stringify(C.TEST_QUESTIONS)) throw new Error("question selection no longer reproduces the registered lists");
const byId = new Map(atlas.map((r) => [r.id, r]));
let questions = MODE === "smoke" ? [C.SMOKE_QUESTION] : C.TEST_QUESTIONS;
if (MODE === "stub" && val("--questions")) questions = questions.slice(0, Number(val("--questions"))); // tests only
const items = questions.flatMap((q) => C.SUBJECTS.map((s) => ({ rec: byId.get(q), subject: s })));
seedBase(atlas);

async function runAll(list, concurrency) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) {
      const k = next++;
      try { out[k] = await runItem(list[k].rec, list[k].subject); } catch (e) { out[k] = { record_id: list[k].rec.id, subject: list[k].subject, lost: `harness-error: ${String(e.message).slice(0, 200)}` }; }
      if (useLive) console.log(`  [${k + 1}/${list.length}] ${list[k].rec.id} × ${list[k].subject}: ${out[k].lost ? `LOST (${out[k].lost})` : `o1 F/N/S/R = ${["F", "N", "S", "R"].map((a) => String(out[k].o1[a])).join("/")} · check R=${out[k].check.R} S=${out[k].check.S}`}`);
    }
  }));
  return out;
}

// 1. The estimate: a scripted pass over the SAME items, logging every call's real prompt size (§7). Free.
const stubItems = await runAll(items, 4);
const est = C.estimate(callLog, costUsd, tokensFor);
const RESERVE = Math.ceil(est.usd * 1.5 * 100) / 100;
const estimateReport = { mode: MODE, items: items.length, calls: est.calls, estimate_usd: Number(est.usd.toFixed(2)), reserve_usd: RESERVE, by_model: Object.fromEntries(Object.entries(est.by_model).map(([k, v]) => [k, { calls: v.calls, usd: Number(v.usd.toFixed(3)) }])), prices: PRICES_AS_OF, output_token_assumptions: OUT_TOKENS };
const outDir = val("--out") || (LIVE ? join(ROOT, "analysis/crt-v1") : join(tmpdir(), "crt-v1"));
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

if (MODE === "plan") { console.log(JSON.stringify(estimateReport, null, 1)); process.exit(0); }

let finalItems = stubItems;
if (LIVE) {
  console.log(`CRT v1 ${MODE}: ${items.length} items, ~${est.calls} calls, estimate $${est.usd.toFixed(2)} → reserving $${RESERVE} once on the shared ledger.`);
  if (!KEYS.BLOB_READ_WRITE_TOKEN && !has("--i-accept-unledgered-spend")) { console.error("No BLOB_READ_WRITE_TOKEN in --env-file / SL_ env: cannot reserve on the shared ledger. Refusing (or pass --i-accept-unledgered-spend)."); process.exit(1); }
  if (KEYS.BLOB_READ_WRITE_TOKEN) {
    // Spawned WITHOUT the loader so it reaches the real store; the token goes to the child only.
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(RESERVE), "--label", `crt-v1 ${MODE}`], { stdio: "inherit", env: { PATH: process.env.PATH, BLOB_READ_WRITE_TOKEN: KEYS.BLOB_READ_WRITE_TOKEN } });
    if (r.status !== 0) { console.error("Budget preflight refused. Nothing was spent."); process.exit(1); }
  }
  for (const [s, k] of Object.entries(KEY_ENV)) if (!KEYS[k]) { console.error(`missing ${k} (needed for ${s})`); process.exit(1); }
  callLog = []; usage = {};
  seedBase(atlas);
  useLive = true;
  finalItems = await runAll(items, 3);
}

const actualUsd = Object.entries(usage).reduce((s, [m, u]) => s + costUsd(m, u.in, u.out), 0);
const run = {
  study: "CRT v1", mode: MODE, registration: { file: C.PREREG, commit: C.PREREG_COMMIT }, ran_at: new Date().toISOString(),
  engine_commit: (() => { try { return readFileSync(join(ROOT, ".git/HEAD"), "utf8").trim(); } catch { return null; } })(),
  inputs: { atlas: { file: C.ATLAS_FILE, sha256: C.ATLAS_SHA256 }, consensus: { file: C.CONSENSUS_FILE, sha256: C.CONSENSUS_SHA256 } },
  estimate: estimateReport, usage, actual_usd_at_list_prices: Number(actualUsd.toFixed(3)),
  note: MODE === "smoke" ? "SMOKE run — excluded from every analysis (§8)." : MODE === "stub" ? "STUB run — scripted models, no real data." : "MAIN run (§9).",
  items: finalItems,
};
const file = join(outDir, `${MODE}-${stamp}.json`);
writeFileSync(file, JSON.stringify(run, null, 1));
const a = C.analyze(finalItems);
writeFileSync(file.replace(/\.json$/, "") + ".analysis.json", JSON.stringify({ analyzed_at: new Date().toISOString(), mode: MODE, analysis: a }, null, 1));
console.log(JSON.stringify({ mode: MODE, file, verdict: a.verdict, valid: a.valid, lost: a.lost, H1: { n: a.H1.n, rate: a.H1.rate, p: a.H1.p_one_sided }, H2: { n: a.H2.n, rate: a.H2.rate, p: a.H2.p_one_sided }, O2: { n: a.O2_R_vs_S.n, diff: a.O2_R_vs_S.diff }, estimate_usd: estimateReport.estimate_usd, actual_usd: run.actual_usd_at_list_prices }, null, 1));
if (MODE !== "main") console.log(MODE === "smoke" ? "Smoke data are excluded from the analysis (§8)." : "Stub: scripted models; the verdict above only proves the plumbing.");
