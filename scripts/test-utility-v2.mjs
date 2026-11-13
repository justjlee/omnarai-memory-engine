// Hermetic tests for the utility v2 harness (no keys, no network, no spend).
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-utility-v2.mjs
//
// What we pin: the prompts are v1's (and the council's) verbatim; the panel, judge draw and request
// settings are the registered ones; replies are read and billed correctly; the seeded order and the
// frozen question lists reproduce; the instance verdict, sign test, Holm and the four cell verdicts
// follow registration §4–§5; and THE SPEND CEILING: no call starts that could take the study past $30,
// a halted run stays halted, and an in-flight overshoot is impossible when usage stays within the
// reserved worst case.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as core from "./lib/utility-v2-core.mjs";
import { createRunner, loadQuestions, analyseRun } from "./lib/utility-v2-run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "uv2-"));
const unescapeTpl = (s) => s.replace(/\\n/g, "\n");   // a template literal's source text → its value (these templates use only \n)

// ── prompts are v1's and the council's, verbatim ─────────────────────────────────
test("system prompts and the placebo prompt are v1's verbatim; the member prompt is the council's", () => {
  const v1 = read("scripts/utility-test-prereg.mjs");
  assert.equal(core.ANSWER_SYS, JSON.parse(v1.match(/const ANSWER_SYS = (".*");/)[1]));
  assert.equal(core.REVISE_SYS, JSON.parse(v1.match(/const REVISE_SYS = (".*");/)[1]));
  assert.equal(core.JUDGE_SYS, v1.match(/const JUDGE_SYS = `([\s\S]*?)`;/)[1]);
  const placeboTpl = unescapeTpl(v1.match(/function placeboUser\(q, a1\) \{\n\s*return `([\s\S]*?)`;/)[1]);
  assert.equal(core.placeboUser("Q?", "A1"), placeboTpl.replace("${q}", "Q?").replace("${a1}", "A1"));
  const council = read("api/_council.js").match(/const MEMBER_SYSTEM =([\s\S]*?);\n/)[1];
  const member = [...council.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)).join("");
  assert.equal(core.MEMBER_SYSTEM, member);
});

test("treatment = v1's treatment prompt minus the tension map and the word 'frontier' (registration §8)", () => {
  const v1 = read("scripts/utility-test-prereg.mjs");
  const tpl = unescapeTpl(v1.match(/function treatmentUser\(q, a1, peers, tensions\) \{[\s\S]*?return `([\s\S]*?)`;\n\}/)[1]);
  const expected = tpl.replace("Other frontier AI models", "Other AI models").replace("Key tensions across the panel:\n${tenBlock}\n\n", "")
    .replace("${q}", "Q?").replace("${a1}", "A1").replace("${peerBlock}", "— Grok: g\n\n— DeepSeek: d");
  assert.equal(core.treatmentUser("Q?", "A1", [{ label: "Grok", text: "g" }, { label: "DeepSeek", text: "d" }]), expected);
  assert.doesNotMatch(core.treatmentUser("Q?", "A1", []), /tension|frontier/i);
});

// ── the panel ─────────────────────────────────────────────────────────────────
test("panel: 5 flagships + 4 small; judges never a consumer or a B peer; three per instance, never the consumer's lab", () => {
  assert.deepEqual(core.CONSUMERS.filter((c) => c.tier === "flagship").map((c) => c.model_id), ["claude-opus-5-5", "gpt-6.1-sol", "gemini-4-carbon", "grok-4.7", "deepseek-v4-pro"]);
  assert.deepEqual(core.CONSUMERS.filter((c) => c.tier === "small").map((c) => c.model_id), ["claude-haiku-5-5", "gpt-6-luna", "gemini-3.5-flash-lite", "deepseek-flash"]);
  const consumerIds = new Set(core.CONSUMERS.map((c) => c.model_id)), peerIds = new Set(core.B_PEERS.map((p) => p.model_id));
  for (const j of core.JUDGE_ORDER) { assert.ok(!consumerIds.has(j.model_id)); assert.ok(!peerIds.has(j.model_id)); }
  assert.deepEqual(core.JUDGE_ORDER.map((j) => j.model_id), ["claude-sonnet-5-5", "gpt-6.1-terra", "gemini-3.8-flash", "grok-4.3"]);
  for (const c of core.CONSUMERS) {
    const js = core.judgesFor(c.lab);
    assert.equal(js.length, 3);
    assert.ok(js.every((j) => j.lab !== c.lab));
  }
  assert.deepEqual(core.judgesFor("DeepSeek").map((j) => j.model_id), ["claude-sonnet-5-5", "gpt-6.1-terra", "gemini-3.8-flash"]);
  assert.deepEqual(core.judgesFor("Anthropic").map((j) => j.model_id), ["gpt-6.1-terra", "gemini-3.8-flash", "grok-4.3"]);
  assert.ok(core.B_PEERS.every((p) => p.model_id !== "gemini-4-argon"));
  for (const m of [...core.CONSUMERS, ...core.JUDGE_ORDER]) assert.ok(core.LOW[m.model_id], `LOW settings for ${m.model_id}`);
  for (const id of new Set([...consumerIds, ...peerIds, ...core.JUDGE_ORDER.map((j) => j.model_id)])) assert.ok(core.PRICES[id], `price for ${id}`);
});

const KEYS = { ANTHROPIC_API_KEY: "ka", OPENAI_API_KEY: "ko", GEMINI_API_KEY: "kg", XAI_API_KEY: "kx", DEEPSEEK_API_KEY: "kd" };
const req = (id, extra = {}) => {
  const m = [...core.CONSUMERS, ...core.JUDGE_ORDER].find((x) => x.model_id === id);
  return core.buildRequest(m, { system: "S", user: "U", cap: 3000, keys: KEYS, ...extra });
};

test("requests carry the lowest documented reasoning setting, the cap, and no sampling parameters", () => {
  const opus = req("claude-opus-5-5").body;
  assert.deepEqual(opus.output_config, { effort: "low" });
  assert.equal(opus.thinking, undefined, "Opus 5.5 rejects any thinking setting other than adaptive; effort is the control");
  assert.equal(opus.max_tokens, 3000);
  assert.deepEqual(req("claude-haiku-5-5").body.thinking, { type: "disabled" });
  assert.deepEqual(req("claude-sonnet-5-5").body.thinking, { type: "between_tools" });
  assert.deepEqual(req("claude-sonnet-5-5").body.output_config, { effort: "low" });
  const sol = req("gpt-6.1-sol").body;
  assert.equal(sol.reasoning_effort, "low"); assert.equal(sol.max_completion_tokens, 3000); assert.equal(sol.max_tokens, undefined);
  assert.equal(req("gpt-6-luna").body.reasoning_effort, "none");
  assert.equal(req("gpt-6.1-terra").body.reasoning_effort, "none");
  assert.deepEqual(req("gemini-4-carbon").body.generationConfig, { maxOutputTokens: 3000, thinkingConfig: { thinkingLevel: "LOW" } });
  assert.deepEqual(req("gemini-3.5-flash-lite").body.generationConfig.thinkingConfig, { thinkingLevel: "MINIMAL" });
  assert.equal(req("grok-4.7").body.reasoning_effort, "low");
  assert.equal(req("grok-4.3").body.reasoning_effort, undefined);
  assert.deepEqual(req("deepseek-v4-pro").body.thinking, { type: "disabled" });
  for (const m of [...core.CONSUMERS, ...core.JUDGE_ORDER]) {
    const r = req(m.model_id);
    const s = JSON.stringify(r.body);
    assert.doesNotMatch(s, /temperature|top_p|top_k|budget_tokens|fallback/, m.model_id);
    assert.doesNotMatch(r.url, /key=/, "keys travel in headers, never in the URL");
  }
});

test("B elicitation uses FRONTIER_COUNCIL's request settings (PR #48) with Carbon", () => {
  const shape = (label) => { const p = core.B_PEERS.find((x) => x.label === label); return core.buildRequest(p, { system: core.MEMBER_SYSTEM, user: "U", keys: KEYS, peer: p }).body; };
  assert.equal(shape("Claude").max_tokens, 4000); assert.deepEqual(shape("Claude").output_config, { effort: "medium" });
  assert.equal(shape("GPT").max_completion_tokens, 2400); assert.equal(shape("GPT").reasoning_effort, "medium");
  assert.deepEqual(shape("Gemini").generationConfig, { maxOutputTokens: 4096 });
  assert.equal(shape("Grok").max_tokens, 2400); assert.equal(shape("DeepSeek").max_tokens, 2400);
  assert.equal(shape("Claude").system, core.MEMBER_SYSTEM);
});

test("replies: text without reasoning blocks; billed output includes reasoning however the provider reports it", () => {
  const a = core.parseReply("anthropic", { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "hi" }], usage: { input_tokens: 10, output_tokens: 90 } });
  assert.equal(a.text, "hi"); assert.deepEqual(a.usage, { in: 10, out: 90, reasoning: null });
  assert.equal(core.parseReply("anthropic", { stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } }).refusal, true);
  const g = core.parseReply("gemini", { modelVersion: "gemini-4-carbon", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "t", thought: true }, { text: "answer" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, thoughtsTokenCount: 30 } });
  assert.equal(g.text, "answer"); assert.equal(g.usage.out, 37);
  const x = core.parseReply("xai", { model: "grok-4.7", choices: [{ finish_reason: "stop", message: { content: "y" } }], usage: { prompt_tokens: 32, completion_tokens: 9, total_tokens: 151, completion_tokens_details: { reasoning_tokens: 110 } } });
  assert.equal(x.usage.out, 119, "reasoning outside completion_tokens is still billed");
  const o = core.parseReply("openai", { model: "gpt-6.1-sol", choices: [{ finish_reason: "length", message: { content: "z" } }], usage: { prompt_tokens: 3, completion_tokens: 50, total_tokens: 53 } });
  assert.equal(o.usage.out, 50); assert.equal(o.truncated, true);
});

// ── seeded order and the frozen lists ─────────────────────────────────────────────
test("seeded shuffle is a reproducible permutation; X/Y order is per instance and about balanced", () => {
  const xs = Array.from({ length: 100 }, (_, i) => i);
  const a = core.seededShuffle(xs, core.SEED, "philpapers-draw");
  assert.deepEqual(a, core.seededShuffle(xs, core.SEED, "philpapers-draw"));
  assert.deepEqual([...a].sort((p, q) => p - q), xs);
  assert.notDeepEqual(a, core.seededShuffle(xs, "another seed", "philpapers-draw"));
  const Q = loadQuestions(ROOT);
  let x = 0, n = 0;
  for (const S of ["A", "B"]) for (const q of Q[S]) for (const c of core.CONSUMERS) { n++; if (core.treatmentIsX(core.SEED, S, q.id, c.model_id)) x++; }
  assert.equal(n, 432);
  assert.ok(x > 432 * 0.4 && x < 432 * 0.6, `treatment shown as X in ${x}/432`);
});

test("frozen B list reproduces from the source list, the seed and the recorded near-duplicate walk", () => {
  const B = JSON.parse(read("docs/utility-v2/questions-B.json"));
  const srcText = read(B.source);
  assert.equal(createHash("sha256").update(srcText).digest("hex"), B.source_sha256);
  const src = JSON.parse(srcText);
  assert.equal(src.questions.length, 100);
  assert.equal(src.questions.filter((q) => q.table === "main").length, 40);
  const items = src.questions.map((q, i) => ({ id: `PP20-${String(i + 1).padStart(3, "0")}`, item: core.philpapersItem(q) }));
  const order = core.seededShuffle(items, B.seed, "philpapers-draw");
  assert.deepEqual(B.walk.map((w) => w.id), order.slice(0, B.walk.length).map((o) => o.id));
  for (const w of B.walk) assert.equal(w.skipped, w.max_cosine > core.DEDUP_THRESHOLD);
  const kept = order.filter((o) => B.walk.find((w) => w.id === o.id && !w.skipped));
  assert.deepEqual(B.questions.map((q) => q.id), kept.slice(0, 24).map((k) => k.id));
  assert.equal(B.probe_question.id, kept[24].id);
  for (const q of B.questions) assert.equal(q.question, core.wrapB(q.item));
  assert.ok(!B.questions.some((q) => q.id === B.probe_question.id));
});

test("frozen A list: 24 distinct records by even spacing over score; hashes verify; peers = four standing voices", () => {
  const A = JSON.parse(read("docs/utility-v2/questions-A.json"));
  loadQuestions(ROOT);   // throws on any hash mismatch
  assert.equal(new Set(A.questions.map((q) => q.id)).size, 24);
  const scores = A.questions.map((q) => q.score);
  assert.deepEqual(scores, [...scores].sort((p, q) => p - q));
  for (const q of A.questions) {
    assert.deepEqual([...q.answers.map((a) => a.model)].sort(), [...core.STANDING_VOICES].sort());
    for (const c of core.CONSUMERS) {
      const peers = core.peersForA(q, c.lab);
      assert.equal(peers.length, 4);
      assert.ok(!peers.some((p) => core.LAB_OF_VOICE[p.label] === c.lab));
    }
  }
  const withFable = { answers: [{ model: "Claude", text: "c" }, { model: "Fable", text: "f" }, { model: "GPT-4o", text: "g" }, { model: "Gemini", text: "m" }, { model: "Grok", text: "x" }, { model: "DeepSeek", text: "d" }] };
  assert.deepEqual(core.peersForA(withFable, "OpenAI").map((p) => p.label), ["Claude", "Gemini", "Grok", "DeepSeek"]);
});

test("B peers: the consumer's own lab is never shown; an absent peer is dropped", () => {
  const em = { "claude-opus-5-5": { text: "c" }, "gpt-6.1-sol": { text: "g" }, "gemini-4-carbon": { text: "" }, "grok-4.7": { text: "x" }, "deepseek-v4-pro": { text: "d" } };
  assert.deepEqual(core.peersForB(em, "Anthropic").map((p) => p.label), ["GPT", "Grok", "DeepSeek"]);
  assert.deepEqual(core.peersForB(em, "xAI").map((p) => p.label), ["Claude", "GPT", "DeepSeek"]);
});

// ── verdicts and statistics ───────────────────────────────────────────────────────
test("instance verdict is v1's; agreement is mean pairwise", () => {
  assert.equal(core.instanceVerdict(["treatment", "treatment", "placebo"]).verdict, "treatment");
  assert.equal(core.instanceVerdict(["treatment", "placebo", "tie"]).verdict, "tie");
  assert.equal(core.instanceVerdict(["treatment", "placebo"]).verdict, "tie");
  assert.equal(core.instanceVerdict(["tie", "tie", "placebo"]).verdict, "tie");
  assert.equal(core.instanceVerdict(["placebo", "placebo"]).verdict, "placebo");
  assert.equal(core.pairwiseAgreement(["treatment", "treatment", "placebo"]), 1 / 3);
  assert.equal(core.parseVerdict('{"overall":"X","surfaces_new":"Y","calibration":"tie"}', true).overall, "treatment");
  assert.equal(core.parseVerdict('{"overall":"X"}', false).overall, "placebo");
  assert.equal(core.parseVerdict('{"overall":"maybe"}', true), null);
});

test("sign test and Holm: 18 of 24 clears the strictest Holm step, 17 does not (registration §11)", () => {
  assert.ok(core.signTestUpper(18, 24) < 0.05 / 4);
  assert.ok(core.signTestUpper(17, 24) > 0.05 / 4);
  assert.equal(core.signTestUpper(0, 0), 1);
  const adj = core.holm([0.01, 0.04, 0.03, 0.5]);
  assert.deepEqual(adj.map((p) => +p.toFixed(4)), [0.04, 0.09, 0.09, 0.5]);   // 0.01×4; 0.03×3; max(0.09, 0.04×2); 0.5
});

function synthetic(spec) {
  // spec: { cell: [treatmentQs, placeboQs, tiedQs, agreeAll] } → instances (all consumers in the tier agree on each question)
  const out = [];
  for (const [cell, [t, p, z, agree]] of Object.entries(spec)) {
    const [S, tier] = cell.split("-");
    const cons = core.CONSUMERS.filter((c) => c.tier === tier);
    const verdicts = [...Array(t).fill("treatment"), ...Array(p).fill("placebo"), ...Array(z).fill("tie")];
    verdicts.forEach((v, i) => cons.forEach((c) => out.push({ substudy: S, qid: `q${i}`, model_id: c.model_id, tier, status: "ok", verdict: v, overalls: agree ? [v, v, v] : ["treatment", "placebo", "tie"], votes: [] })));
  }
  return out;
}

test("cell verdicts: Supported / Refuted / Inconclusive / Indeterminate; instrument check; falsifier", () => {
  let r = core.analyse(synthetic({ "A-flagship": [20, 4, 0, true], "A-small": [8, 14, 2, true], "B-flagship": [13, 11, 0, true], "B-small": [12, 12, 0, false] }));
  const v = Object.fromEntries(r.cells.map((c) => [c.cell, c.verdict]));
  assert.deepEqual(v, { "A-flagship": "Supported", "A-small": "Refuted", "B-flagship": "Inconclusive", "B-small": "Indeterminate" });
  assert.equal(r.instrument_check.suspect, true);
  r = core.analyse(synthetic({ "A-flagship": [5, 19, 0, true], "A-small": [12, 12, 0, true], "B-flagship": [12, 12, 0, true], "B-small": [22, 2, 0, true] }));
  assert.equal(r.falsifier.met, true, "A-flagship and B-flagship both Refuted (12–12 is treatment ≤ placebo)");
  assert.equal(r.instrument_check.suspect, false);
  assert.equal(r.falsifier.blocked_by_instrument_check, false);
  assert.equal(r.cells.find((c) => c.cell === "B-small").verdict, "Supported");
  // failed instances are counted, never replaced, and a question with no data carries no weight
  const inst = synthetic({ "A-flagship": [18, 0, 0, true], "A-small": [0, 0, 0, true], "B-flagship": [0, 0, 0, true], "B-small": [0, 0, 0, true] });
  inst.push({ substudy: "A", qid: "qX", model_id: "claude-opus-5-5", tier: "flagship", status: "failed" });
  r = core.analyse(inst);
  const af = r.cells.find((c) => c.cell === "A-flagship");
  assert.equal(af.failed, 1); assert.equal(af.treatmentQs, 18); assert.equal(af.questions_with_data, 18);
  assert.equal(r.cells.find((c) => c.cell === "A-small").verdict, "Indeterminate", "no data → no agreement → indeterminate, never refuted");
});

// ── the spend ceiling ─────────────────────────────────────────────────────────────
test("SpendGuard: a reservation past the ceiling never starts; settle swaps reservation for actual; unknown keeps the worst case", () => {
  const g = new core.SpendGuard({ ceilingUsd: 1 });
  const r1 = g.reserve(0.6, "a");
  assert.throws(() => g.reserve(0.5, "b"), core.HaltError);
  assert.equal(g.halted, true);
  assert.throws(() => g.reserve(0.0001, "c"), core.HaltError, "once halted, always halted");
  g.settle(r1, "claude-opus-5-5", { in: 1000, out: 1000 });
  assert.equal(+g.spentUsd.toFixed(6), +(1000 * 4 / 1e6 + 1000 * 20 / 1e6).toFixed(6));
  const g2 = new core.SpendGuard({ ceilingUsd: 1 });
  g2.settle(g2.reserve(0.3), "gpt-6.1-sol", null, { outcome: "unknown" });
  g2.settle(g2.reserve(0.3), "gpt-6.1-sol", null, { outcome: "http_error" });
  g2.settle(g2.reserve(0.3), "gpt-6.1-sol", null);
  assert.equal(+g2.spentUsd.toFixed(6), 0.6); assert.equal(g2.noUsage, 1);
});

// A fake provider: answers every request in its provider's shape. Usage is set at (but never above)
// the worst case the guard reserved, the harshest case the ceiling must survive.
function fakeTransport({ onCall = () => {}, judgeText = '{"surfaces_new":"X","calibration":"X","overall":"X","reason":"r"}', mode = () => "ok" } = {}) {
  let calls = 0;
  const fn = async ({ url, body }) => {
    calls++; onCall({ url, body });
    const chars = JSON.stringify(body).length;
    const inTok = Math.ceil(chars / 3);
    const cap = body.max_tokens ?? body.max_completion_tokens ?? body.generationConfig?.maxOutputTokens ?? 1000;
    const system = body.system ?? body.messages?.[0]?.content ?? body.systemInstruction?.parts?.[0]?.text ?? "";
    const isJudge = system === core.JUDGE_SYS;
    const m = mode({ url, body, isJudge });
    const text = m === "empty" ? "" : isJudge ? (m === "garbage" ? "no json here" : judgeText) : "An answer of about two hundred words.";
    const truncated = m === "truncated";
    if (url.includes("anthropic")) return { status: 200, json: { model: body.model, stop_reason: truncated ? "max_tokens" : "end_turn", content: [{ type: "text", text }], usage: { input_tokens: inTok, output_tokens: cap } } };
    if (url.includes("googleapis")) return { status: 200, json: { modelVersion: url.split("/models/")[1].split(":")[0], candidates: [{ finishReason: truncated ? "MAX_TOKENS" : "STOP", content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: cap, thoughtsTokenCount: 0 } } };
    return { status: 200, json: { model: body.model, choices: [{ finish_reason: truncated ? "length" : "stop", message: { content: text } }], usage: { prompt_tokens: inTok, completion_tokens: cap, total_tokens: inTok + cap } } };
  };
  fn.count = () => calls;
  return fn;
}

test("THE $30 HALT: the run stops before any call that could pass $30, never overshoots, and stays halted", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "spend.json"), JSON.stringify({ spent_usd: 28.5, calls: 0, no_usage: 0, by_model: {} }));
  const Q = loadQuestions(ROOT);
  const t = fakeTransport();
  const runner = createRunner({ runDir: dir, keys: KEYS, transport: t, backoffMs: 0, perProviderConcurrency: 4 });
  await assert.rejects(runner.consumers("A", Q.A, (q, lab) => core.peersForA(q, lab), path.join(dir, "consumers-A.jsonl")), core.HaltError);
  const spend = JSON.parse(fs.readFileSync(path.join(dir, "spend.json"), "utf8"));
  assert.equal(spend.halted, true);
  assert.ok(spend.spent_usd <= 30, `spent ${spend.spent_usd} must not pass $30`);
  assert.ok(spend.spent_usd > 28.5, "some calls ran before the halt");
  const rows = runner.readJsonl(path.join(dir, "consumers-A.jsonl"));
  assert.ok(rows.length < 24 * 9, "the stage did not complete");
  assert.ok(rows.every((r) => r.status === "ok"), "an instance cut by the halt is left unrun, never written as failed");
  const callsAtHalt = t.count();
  const again = createRunner({ runDir: dir, keys: KEYS, transport: t, backoffMs: 0 });
  await assert.rejects(again.consumers("A", Q.A, (q, lab) => core.peersForA(q, lab), path.join(dir, "consumers-A.jsonl")), core.HaltError);
  assert.equal(t.count(), callsAtHalt, "a halted run directory makes no further calls");
});

test("from zero, a full-cap fake run halts at the ceiling instead of finishing (the bound exceeds $30)", async () => {
  const dir = tmp();
  const Q = loadQuestions(ROOT);
  const runner = createRunner({ runDir: dir, keys: KEYS, transport: fakeTransport(), backoffMs: 0, perProviderConcurrency: 8 });
  const both = async () => {
    await runner.consumers("A", Q.A, (q, lab) => core.peersForA(q, lab), path.join(dir, "consumers-A.jsonl"));
    const inst = runner.readJsonl(path.join(dir, "consumers-A.jsonl"));
    await runner.judges("A", inst, (qid) => Q.A.find((q) => q.id === qid).question, path.join(dir, "judges-A.jsonl"));
    await runner.consumers("B", Q.B, () => [{ label: "GPT", text: "x".repeat(2200) }], path.join(dir, "consumers-B.jsonl"));
  };
  await assert.rejects(both(), core.HaltError);
  assert.ok(runner.guard.spentUsd <= 30 && runner.guard.spentUsd > 25, `spent ${runner.guard.spentUsd}`);
});

// ── retries and failures (registration §3) ────────────────────────────────────────
test("a truncated answer is retried once; truncated twice fails the instance; a garbled judge is retried once", async () => {
  const dir = tmp();
  const Q = loadQuestions(ROOT);
  const seen = new Map();
  const t = fakeTransport({ mode: ({ body, isJudge }) => {
    if (isJudge) { const k = "judge" + JSON.stringify(body).length + (body.model || ""); const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n === 1 ? "garbage" : "ok"; }
    const id = body.model || "gemini";
    if (id === "claude-haiku-5-5") return "truncated";                  // always truncated → failed
    const k = JSON.stringify(body); const n = (seen.get(k) || 0) + 1; seen.set(k, n);
    return n === 1 ? "truncated" : "ok";                                  // first attempt truncated, retry fine
  } });
  const runner = createRunner({ runDir: dir, keys: KEYS, transport: t, backoffMs: 0 });
  const q = Q.A.slice(0, 1);
  const rows = await runner.consumers("A", q, (qq, lab) => core.peersForA(qq, lab), path.join(dir, "consumers-A.jsonl"));
  const haiku = rows.find((r) => r.model_id === "claude-haiku-5-5");
  assert.equal(haiku.status, "failed"); assert.equal(haiku.failed_arm, "baseline"); assert.equal(haiku.calls.baseline.length, 2);
  const opus = rows.find((r) => r.model_id === "claude-opus-5-5");
  assert.equal(opus.status, "ok"); assert.equal(opus.calls.baseline.length, 2); assert.equal(opus.calls.baseline[0].truncated, true);
  const jr = await runner.judges("A", rows, () => q[0].question, path.join(dir, "judges-A.jsonl"));
  const jo = jr.find((r) => r.model_id === "claude-opus-5-5");
  assert.equal(jo.status, "ok"); assert.ok(jo.judges.every((j) => j.attempts.length === 2 && j.parsed));
  assert.equal(jo.verdict, core.treatmentIsX(core.SEED, "A", q[0].id, "claude-opus-5-5") ? "treatment" : "placebo");
  assert.equal(jr.length, 8, "the failed instance is not judged");
});

test("elicitation: empty twice → peer absent; truncated twice → kept and flagged; stages resume without repeating calls", async () => {
  const dir = tmp();
  const Q = loadQuestions(ROOT);
  const t = fakeTransport({ mode: ({ body }) => (body.model === "grok-4.7" ? "empty" : body.model === "deepseek-v4-pro" ? "truncated" : "ok") });
  const runner = createRunner({ runDir: dir, keys: KEYS, transport: t, backoffMs: 0 });
  const rows = await runner.elicit(Q.B.slice(0, 2));
  assert.equal(rows.length, 10);
  const grok = rows.find((r) => r.model_id === "grok-4.7"), ds = rows.find((r) => r.model_id === "deepseek-v4-pro");
  assert.equal(grok.absent, true); assert.equal(grok.attempts.length, 2);
  assert.equal(ds.absent, false); assert.equal(ds.truncated, true);
  const em = runner.elicitedMap(rows);
  assert.deepEqual(core.peersForB(em[Q.B[0].id], "Anthropic").map((p) => p.label), ["GPT", "Gemini", "DeepSeek"]);
  const n = t.count();
  await runner.elicit(Q.B.slice(0, 2));
  assert.equal(t.count(), n, "a finished stage makes no new calls");
});

test("probe: projects the whole study from one measured instance per consumer, and says STOP above $30", async () => {
  const Q = loadQuestions(ROOT);
  const cheap = createRunner({ runDir: tmp(), keys: KEYS, transport: fakeTransport(), backoffMs: 0 });
  const p = await cheap.probe(Q.probe);
  assert.equal(p.per_consumer.length, 9); assert.deepEqual(p.incomplete, []);
  const perInst = p.per_consumer.reduce((s, r) => s + r.instance_usd, 0);
  assert.ok(Math.abs(p.projected_remaining_usd - (perInst * 48 + p.elicitation_usd * 24)) < 0.01);
  assert.equal(p.decision, p.projected_total_usd > 30 ? "STOP: projection exceeds the ceiling" : "GO");
  assert.equal(p.decision.startsWith("STOP"), true, "full-cap usage on every call projects past $30");
});

test("analyse over a finished (fake) run writes all four cells", async () => {
  const dir = tmp();
  const Q = loadQuestions(ROOT);
  const runner = createRunner({ runDir: dir, keys: KEYS, transport: fakeTransport(), backoffMs: 0 });
  runner.guard.ceilingUsd = 1e6;   // lift the ceiling for this bookkeeping-only test
  for (const S of ["A", "B"]) {
    const qs = Q[S].slice(0, 3);
    const inst = await runner.consumers(S, qs, (q, lab) => (S === "A" ? core.peersForA(q, lab) : [{ label: "GPT", text: "x" }]), path.join(dir, `consumers-${S}.jsonl`));
    await runner.judges(S, inst, (qid) => qs.find((q) => q.id === qid).question, path.join(dir, `judges-${S}.jsonl`));
  }
  const res = analyseRun(dir);
  assert.equal(res.cells.length, 4); assert.equal(res.instances_total, 54);
  assert.ok(res.cells.every((c) => c.agreement === 1));
});
