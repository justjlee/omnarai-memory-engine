// UTILITY v2 — the pure core of the second-opinion re-test on current models.
// Registration: docs/utility-v2-preregistration.md. Harness: scripts/utility-v2.mjs.
//
// Everything here is pure (no network, no files, no clock unless passed in), so the
// hermetic tests (scripts/test-utility-v2.mjs) can pin every registered rule:
// the panel and its request settings, the prompts, the seeded order, the spend
// ceiling, the instance verdict, the question-level sign test, Holm, and the four
// cell verdicts. DO NOT tune anything here after the registration commit; append a
// dated entry to the registration's Deviations section instead.
import { createHash } from "node:crypto";

// ── fixed parameters (registration §3, §10) ───────────────────────────────────
export const STUDY = "utility-v2";
export const SEED = "omnarai-utility-v2/2026-11-13";      // fixed before the first draw; drives the B draw and every X/Y order
export const CEILING_USD = 30;                             // hard: no call starts that could take the study past this
export const N_QUESTIONS = 24;                             // per sub-study, fixed; no stopping rule
export const DEDUP_THRESHOLD = 0.90;                       // the engine's Atlas-bank rule (scripts/run-atlas-bank.mjs): cosine on question embeddings
export const AGREEMENT_GATE = 0.60;                        // v1's reportability gate
export const ALPHA = 0.05;                                 // family-wise, Holm across the four cells
export const CAPS = { consumer: 3000, judge: 1500 };       // max output tokens per call (reasoning included where the provider counts it)
export const STANDING_VOICES = ["Claude", "GPT-4o", "Gemini", "Grok", "DeepSeek"];
export const LAB_OF_VOICE = { Claude: "Anthropic", "GPT-4o": "OpenAI", Gemini: "Google", Grok: "xAI", DeepSeek: "DeepSeek" };

// ── the panel (ids from each provider's model list, 2026-11-13) ────────────────
// `low` = the lowest reasoning setting each provider documents for that model (read 2026-11-13):
//   Anthropic: Opus 5.5 cannot turn thinking off (effort is the only control; lowest "low");
//              Haiku 5.5 accepts thinking "disabled" at effort high or below; Sonnet 5.5 turns
//              thinking off with {type:"between_tools"} (no other field) at effort high or below.
//   OpenAI:    gpt-6.1-sol supports low…max (no none/minimal); gpt-6.1-terra and gpt-6-luna support none…max.
//   Google:    thinkingConfig.thinkingLevel; Gemini 4 and 3.8 Flash: low/medium/high (no minimal);
//              3.5 Flash-Lite: minimal/low/medium/high.
//   xAI:       grok-4.7 reasoning_effort low/medium/high/xhigh, reasoning cannot be disabled;
//              grok-4.3: no documented control, so the default is used and recorded.
//   DeepSeek:  thinking {type:"disabled"} turns thinking off (V4).
export const LOW = {
  "claude-opus-5-5":       { body: { output_config: { effort: "low" } } },
  "claude-haiku-5-5":      { body: { thinking: { type: "disabled" }, output_config: { effort: "low" } } },
  "claude-sonnet-5-5":     { body: { thinking: { type: "between_tools" }, output_config: { effort: "low" } } },
  "gpt-6.1-sol":           { body: { reasoning_effort: "low" } },
  "gpt-6.1-terra":         { body: { reasoning_effort: "none" } },
  "gpt-6-luna":            { body: { reasoning_effort: "none" } },
  "gemini-4-carbon":       { thinkingConfig: { thinkingLevel: "LOW" } },
  "gemini-3.8-flash":      { thinkingConfig: { thinkingLevel: "LOW" } },
  "gemini-3.5-flash-lite": { thinkingConfig: { thinkingLevel: "MINIMAL" } },
  "grok-4.7":              { body: { reasoning_effort: "low" } },
  "grok-4.3":              { body: {} },
  "deepseek-v4-pro":       { body: { thinking: { type: "disabled" } } },
  "deepseek-flash":        { body: { thinking: { type: "disabled" } } },
};

export const CONSUMERS = [
  { tier: "flagship", lab: "Anthropic", model_id: "claude-opus-5-5",       provider: "anthropic" },
  { tier: "flagship", lab: "OpenAI",    model_id: "gpt-6.1-sol",           provider: "openai" },
  { tier: "flagship", lab: "Google",    model_id: "gemini-4-carbon",       provider: "gemini" },
  { tier: "flagship", lab: "xAI",       model_id: "grok-4.7",              provider: "xai" },
  { tier: "flagship", lab: "DeepSeek",  model_id: "deepseek-v4-pro",       provider: "deepseek" },
  { tier: "small",    lab: "Anthropic", model_id: "claude-haiku-5-5",      provider: "anthropic" },
  { tier: "small",    lab: "OpenAI",    model_id: "gpt-6-luna",            provider: "openai" },
  { tier: "small",    lab: "Google",    model_id: "gemini-3.5-flash-lite", provider: "gemini" },
  { tier: "small",    lab: "DeepSeek",  model_id: "deepseek-flash",        provider: "deepseek" },
];

// Fixed order; each instance takes the first three whose lab is not the consumer's.
export const JUDGE_ORDER = [
  { lab: "Anthropic", model_id: "claude-sonnet-5-5", provider: "anthropic" },
  { lab: "OpenAI",    model_id: "gpt-6.1-terra",     provider: "openai" },
  { lab: "Google",    model_id: "gemini-3.8-flash",  provider: "gemini" },
  { lab: "xAI",       model_id: "grok-4.3",          provider: "xai" },
];
export const judgesFor = (lab) => JUDGE_ORDER.filter((j) => j.lab !== lab).slice(0, 3);

// Sub-study B peers: FRONTIER_COUNCIL of PR #48 (branch frontier-track, e0cab70), request
// settings verbatim, with gemini-4-carbon in place of gemini-4-argon (registration §9.1).
export const B_PEERS = [
  { label: "Claude",   lab: "Anthropic", model_id: "claude-opus-5-5", provider: "anthropic", body: { max_tokens: 4000, output_config: { effort: "medium" } } },
  { label: "GPT",      lab: "OpenAI",    model_id: "gpt-6.1-sol",     provider: "openai",    body: { max_completion_tokens: 2400, reasoning_effort: "medium" } },
  { label: "Gemini",   lab: "Google",    model_id: "gemini-4-carbon", provider: "gemini",    generationConfig: { maxOutputTokens: 4096 } },
  { label: "Grok",     lab: "xAI",       model_id: "grok-4.7",        provider: "xai",       body: { max_tokens: 2400 } },
  { label: "DeepSeek", lab: "DeepSeek",  model_id: "deepseek-v4-pro", provider: "deepseek",  body: { max_tokens: 2400 } },
];

// ── prices (USD per 1M tokens [input, output]; each lab's own page/API, 2026-11-13) ──
// DeepSeek at peak rates (off-peak is half), so the ledger errs high. Gemini 4 doubles on 2026-12-01.
export const PRICES = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.10, 0.50],
  "gpt-6.1-sol": [2, 10], "gpt-6.1-terra": [1, 5], "gpt-6-luna": [0.10, 0.50],
  "gemini-4-carbon": [2, 10], "gemini-3.8-flash": [0.75, 3.75], "gemini-3.5-flash-lite": [0.30, 2.50],
  "grok-4.7": [2, 6], "grok-4.3": [1.25, 2.50],
  "deepseek-v4-pro": [1.32, 3.96], "deepseek-flash": [0.30, 1.20],
  "text-embedding-3-small": [0.02, 0],
};
export function priceOf(modelId, isoDate = "2026-11-13") {
  const p = PRICES[modelId];
  if (!p) throw new Error(`no price on file for ${modelId}`);
  if (modelId.startsWith("gemini-4-") && isoDate >= "2026-12-01") return [4, 20];
  return p;
}
export const costUsd = (modelId, inTok, outTok, isoDate) => {
  const [pi, po] = priceOf(modelId, isoDate);
  return ((Number(inTok) || 0) * pi + (Number(outTok) || 0) * po) / 1e6;
};

// ── prompts ───────────────────────────────────────────────────────────────────
// v1 wording, verbatim (scripts/utility-test-prereg.mjs); the test suite pins the equality.
export const ANSWER_SYS = "You are answering a hard, open question with no settled answer. Give your honest, reasoned position in about 200 words. Take a stance where you hold one; name genuine uncertainty plainly. Be concrete.";
export const REVISE_SYS = "You are revising your own earlier answer to a hard question. Output ONLY your revised answer (about 200 words), written as a clean standalone response. Do not reference the revision process or any material you were shown.";
export const JUDGE_SYS = `You are an impartial evaluator. You see a hard question, an ORIGINAL first-pass answer, and TWO revised answers (REVISION_X, REVISION_Y) in random order. Judge the revisions ONLY on substance. Output strict JSON:
{"surfaces_new":"X|Y|tie","calibration":"X|Y|tie","overall":"X|Y|tie","reason":"one sentence"}
- surfaces_new: which revision introduces substantive considerations ABSENT from the original?
- calibration: which better acknowledges genuine, hard disagreement instead of false confidence?
- overall: which is the better answer to the question?`;
// The council member prompt (api/_council.js MEMBER_SYSTEM), verbatim; pinned by the tests.
export const MEMBER_SYSTEM =
  "You are one voice in a panel of frontier models answering the same open question independently. " +
  "Answer in your own reasoning, directly and honestly. Take a position where you actually hold one, " +
  "and say plainly where you are uncertain. Do not hedge toward a consensus you cannot see — the panel's " +
  "value is in genuine difference, not agreement. Be concrete and specific. Aim for 150–300 words.";

export const placeboUser = (q, a1) =>
  `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nRe-examine it. Are there perspectives, considerations, or counterarguments you may have missed? Then give your revised answer.`;
// v1's treatment prompt with the tension map removed and "frontier" dropped (registration §8).
export function treatmentUser(q, a1, peers) {
  const peerBlock = peers.map((p) => `— ${p.label}: ${p.text}`).join("\n\n");
  return `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nOther AI models answered the same question. Their answers:\n\n${peerBlock}\n\nRe-examine your earlier answer in light of these other perspectives. Integrate any genuinely useful considerations into your own reasoning. Then give your revised answer.`;
}
export const judgeUser = (q, a1, X, Y) => `QUESTION:\n"${q}"\n\nORIGINAL:\n${a1}\n\nREVISION_X:\n${X}\n\nREVISION_Y:\n${Y}`;

// ── sub-study B questions: PhilPapers item → one fixed wrapper ─────────────────
export function joinOptions(opts) {
  if (opts.length <= 1) return opts.join("");
  if (opts.length === 2) return `${opts[0]} or ${opts[1]}`;
  return `${opts.slice(0, -1).join(", ")}, or ${opts[opts.length - 1]}`;
}
export const philpapersItem = (q) => `${q.topic}: ${joinOptions(q.options)}?`;
export const wrapB = (item) => `An open question on which experts disagree: "${item}" What is your answer, and why? You may defend a position not listed.`;

// ── seeded order (sha256 counter mode: reproducible, order- and concurrency-independent) ──
export function seededUnit(seed, ...parts) {
  const h = createHash("sha256").update([seed, ...parts].join("|")).digest();
  return Number(h.readBigUInt64BE(0) >> 11n) / 2 ** 53;
}
export function seededShuffle(arr, seed, label) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(seededUnit(seed, label, i) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const treatmentIsX = (seed, substudy, qid, modelId) => seededUnit(seed, "xy", substudy, qid, modelId) < 0.5;

// v1's even-spacing rule over a sorted list.
export function evenlySpaced(list, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * (list.length - 1) / Math.max(1, n - 1))]);
  return out;
}

// ── peers shown to a consumer ─────────────────────────────────────────────────
// A: the five standing voices in stored order, byte-for-byte, minus the consumer's own lab.
export function peersForA(record, consumerLab) {
  const seen = new Set();
  const out = [];
  for (const a of record.answers) {
    if (!STANDING_VOICES.includes(a.model) || seen.has(a.model)) continue;
    seen.add(a.model);
    if (LAB_OF_VOICE[a.model] === consumerLab) continue;
    out.push({ label: a.model, text: a.text });
  }
  return out;
}
// B: the elicited flagship answers in B_PEERS order, minus the consumer's own lab; a peer that
// gave no usable answer after its retry is absent (and recorded).
export function peersForB(elicited, consumerLab) {
  return B_PEERS.filter((p) => p.lab !== consumerLab)
    .map((p) => ({ label: p.label, text: elicited[p.model_id]?.text || "" }))
    .filter((p) => p.text.trim());
}

// ── provider requests (pure) ─────────────────────────────────────────────────
// role: "low" (consumers and judges: LOW settings + `cap`) or a B_PEERS member (elicitation).
export function buildRequest(member, { system, user, cap, keys = {}, peer = null }) {
  const id = member.model_id;
  const low = LOW[id] || {};
  if (member.provider === "anthropic") {
    const body = peer
      ? { model: id, max_tokens: 700, ...peer.body, system, messages: [{ role: "user", content: user }] }
      : { model: id, max_tokens: cap, ...low.body, system, messages: [{ role: "user", content: user }] };
    return { url: "https://api.anthropic.com/v1/messages", headers: { "x-api-key": keys.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body };
  }
  if (member.provider === "gemini") {
    const generationConfig = peer ? { ...peer.generationConfig } : { maxOutputTokens: cap, ...(low.thinkingConfig ? { thinkingConfig: low.thinkingConfig } : {}) };
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`,
      headers: { "x-goog-api-key": keys.GEMINI_API_KEY, "content-type": "application/json" },
      body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig },
    };
  }
  const base = { openai: "https://api.openai.com/v1/chat/completions", xai: "https://api.x.ai/v1/chat/completions", deepseek: "https://api.deepseek.com/chat/completions" }[member.provider];
  if (!base) throw new Error(`unknown provider ${member.provider}`);
  const key = { openai: keys.OPENAI_API_KEY, xai: keys.XAI_API_KEY, deepseek: keys.DEEPSEEK_API_KEY }[member.provider];
  const capField = member.provider === "openai" ? { max_completion_tokens: cap } : { max_tokens: cap };
  const body = peer
    ? { model: id, ...peer.body, messages: [{ role: "system", content: system }, { role: "user", content: user }] }
    : { model: id, ...capField, ...low.body, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  return { url: base, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body };
}

// → { text, resolved, truncated, refusal, usage:{in,out,reasoning}|null }
// Billed output includes reasoning: Gemini reports thoughts apart; for OpenAI-compatible
// APIs we take max(completion_tokens, total_tokens − prompt_tokens), which counts reasoning
// whether or not a provider folds it into completion_tokens (xAI's docs do not say).
export function parseReply(provider, data) {
  if (!data || typeof data !== "object") return { text: "", resolved: null, truncated: false, refusal: false, usage: null };
  if (provider === "anthropic") {
    const u = data.usage;
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return {
      text, resolved: data.model || null, truncated: data.stop_reason === "max_tokens", refusal: data.stop_reason === "refusal",
      refusal_category: data.stop_details?.category ?? null,
      usage: u ? { in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0, reasoning: null } : null,
    };
  }
  if (provider === "gemini") {
    const cand = data.candidates?.[0];
    const u = data.usageMetadata;
    const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    const blocked = Boolean(data.promptFeedback?.blockReason) || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"].includes(cand?.finishReason);
    return {
      text, resolved: data.modelVersion || null, truncated: cand?.finishReason === "MAX_TOKENS", refusal: blocked,
      usage: u ? { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), reasoning: u.thoughtsTokenCount || 0 } : null,
    };
  }
  const choice = data.choices?.[0];
  const u = data.usage;
  let usage = null;
  if (u) {
    const completion = u.completion_tokens || 0;
    const viaTotal = Number.isFinite(u.total_tokens) ? u.total_tokens - (u.prompt_tokens || 0) : 0;
    usage = { in: u.prompt_tokens || 0, out: Math.max(completion, viaTotal), reasoning: u.completion_tokens_details?.reasoning_tokens ?? null };
  }
  return {
    text: choice?.message?.content || "", resolved: data.model || null, truncated: choice?.finish_reason === "length",
    refusal: Boolean(choice?.message?.refusal) || choice?.finish_reason === "content_filter", usage,
  };
}

// ── spend ceiling ─────────────────────────────────────────────────────────────
export class HaltError extends Error {
  constructor(msg, detail) { super(msg); this.name = "HaltError"; this.detail = detail; }
}
// Worst case for one HTTP attempt: input at 3 chars/token (estimates elsewhere use 4, so this
// errs high) plus the whole output cap, plus a reasoning allowance where the provider's docs do
// not say that reasoning is counted inside the cap (xAI; DeepSeek with thinking on).
export function reasoningAllowance(provider, body) {
  if (provider === "xai") return body.reasoning_effort === "low" ? 4000 : 8000;
  if (provider === "deepseek") return body.thinking?.type === "disabled" ? 0 : 8000;
  return 0;
}
export function worstCaseUsd(member, request, isoDate) {
  const chars = JSON.stringify(request.body).length;
  const b = request.body;
  const cap = b.max_tokens ?? b.max_completion_tokens ?? b.generationConfig?.maxOutputTokens ?? 4096;
  return costUsd(member.model_id, Math.ceil(chars / 3), cap + reasoningAllowance(member.provider, b), isoDate);
}
// A call reserves its worst case before it starts; a call whose reservation would take
// spent + reserved past the ceiling never starts (HaltError). On settle the reservation is
// replaced by the provider-reported cost; when the provider reports no usage, or the outcome is
// unknown (timeout, dropped connection), the worst case stays charged.
export class SpendGuard {
  constructor({ ceilingUsd = CEILING_USD, spentUsd = 0, byModel = {}, calls = 0, noUsage = 0, isoDate } = {}) {
    Object.assign(this, { ceilingUsd, spentUsd, byModel: structuredClone(byModel), calls, noUsage, reservedUsd: 0, halted: false, isoDate });
  }
  reserve(usd, label = "") {
    if (this.halted || this.spentUsd + this.reservedUsd + usd > this.ceilingUsd) {
      this.halted = true;
      throw new HaltError(`spend ceiling: $${this.spentUsd.toFixed(4)} spent + $${this.reservedUsd.toFixed(4)} in flight + $${usd.toFixed(4)} for ${label} would pass $${this.ceilingUsd}`, { spent: this.spentUsd, reserved: this.reservedUsd, next: usd });
    }
    this.reservedUsd += usd;
    return usd;
  }
  settle(reserved, modelId, usage, { outcome = "ok" } = {}) {
    this.reservedUsd = Math.max(0, this.reservedUsd - reserved);
    let usd;
    if (outcome === "http_error") usd = 0;                         // the provider refused the request: nothing generated
    else if (outcome === "unknown" || !usage) { usd = reserved; if (outcome !== "unknown") this.noUsage++; }
    else usd = costUsd(modelId, usage.in, usage.out, this.isoDate);
    const m = (this.byModel[modelId] ||= { calls: 0, in: 0, out: 0, usd: 0 });
    m.calls++; m.in += usage?.in || 0; m.out += usage?.out || 0; m.usd += usd;
    this.calls++;
    this.spentUsd += usd;
    return usd;
  }
  snapshot() { return { ceiling_usd: this.ceilingUsd, spent_usd: +this.spentUsd.toFixed(6), calls: this.calls, no_usage: this.noUsage, halted: this.halted, by_model: this.byModel }; }
}

// ── judging and analysis (registration §4, §5, §7) ─────────────────────────────
export function firstJSONObject(text) {
  const t = String(text ?? ""); const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
const XY = new Set(["X", "Y", "tie"]);
// A judge reply → {overall, surfaces_new, calibration} in arm terms, or null if unusable.
export function parseVerdict(text, treatIsX) {
  const v = firstJSONObject(text);
  if (!v || !XY.has(v.overall)) return null;
  const map = (x) => (x === "tie" ? "tie" : (x === "X") === treatIsX ? "treatment" : "placebo");
  return { overall: map(v.overall), surfaces_new: XY.has(v.surfaces_new) ? map(v.surfaces_new) : null, calibration: XY.has(v.calibration) ? map(v.calibration) : null, reason: typeof v.reason === "string" ? v.reason.slice(0, 500) : null };
}
// v1's instance verdict: the option with the most votes; options level at the top → tie.
export function instanceVerdict(overalls) {
  const tally = overalls.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {});
  const winner = ["treatment", "placebo", "tie"].reduce((best, k) => ((tally[k] || 0) > (tally[best] || 0) ? k : best), "tie");
  const top = tally[winner] || 0;
  const tiedAtTop = ["treatment", "placebo"].filter((k) => (tally[k] || 0) === top && top > 0).length > 1;
  return { verdict: tiedAtTop ? "tie" : winner, tally };
}
export function pairwiseAgreement(overalls) {
  let pairs = 0, agree = 0;
  for (let a = 0; a < overalls.length; a++) for (let b = a + 1; b < overalls.length; b++) { pairs++; if (overalls[a] === overalls[b]) agree++; }
  return pairs ? agree / pairs : null;
}
function logChoose(n, k) { let r = 0; for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i); return r; }
const pmf = (n, i) => Math.exp(logChoose(n, i) - n * Math.log(2));
// One-sided exact sign test: P(X ≥ k | n, ½).
export function signTestUpper(k, n) {
  if (n === 0) return 1;
  let p = 0;
  for (let i = k; i <= n; i++) p += pmf(n, i);
  return Math.min(1, p);
}
export function binomTwoSided(k, n) {
  if (n === 0) return 1;
  const obs = pmf(n, k);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(n, i) <= obs + 1e-12) p += pmf(n, i);
  return Math.min(1, p);
}
// Holm step-down adjusted p-values, returned in input order.
export function holm(ps) {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(m);
  let running = 0;
  order.forEach(([p, i], rank) => { running = Math.max(running, Math.min(1, (m - rank) * p)); adj[i] = running; });
  return adj;
}
export function cellVerdict({ treatmentQs, placeboQs, holmP, agreement }) {
  if (agreement == null || agreement < AGREEMENT_GATE) return "Indeterminate";
  if (holmP < ALPHA) return "Supported";
  if (treatmentQs <= placeboQs) return "Refuted";
  return "Inconclusive";
}

// instances: [{substudy, qid, model_id, tier, status:"ok"|"failed", verdict?, overalls?:[...], votes?:[{overall,surfaces_new,calibration}]}]
export function analyse(instances) {
  const cells = [];
  for (const substudy of ["A", "B"]) for (const tier of ["flagship", "small"]) {
    const inCell = instances.filter((x) => x.substudy === substudy && x.tier === tier);
    const ok = inCell.filter((x) => x.status === "ok");
    const byQ = {};
    for (const x of ok) {
      const q = (byQ[x.qid] ||= { T: 0, P: 0, tie: 0 });
      if (x.verdict === "treatment") q.T++; else if (x.verdict === "placebo") q.P++; else q.tie++;
    }
    let treatmentQs = 0, placeboQs = 0, tiedQs = 0;
    for (const q of Object.values(byQ)) { const d = q.T - q.P; if (d > 0) treatmentQs++; else if (d < 0) placeboQs++; else tiedQs++; }
    const agr = ok.map((x) => pairwiseAgreement(x.overalls || [])).filter((a) => a != null);
    const agreement = agr.length ? agr.reduce((s, a) => s + a, 0) / agr.length : null;
    const tally = (k) => ok.reduce((m, x) => { for (const v of x.votes || []) if (v[k]) m[v[k]] = (m[v[k]] || 0) + 1; return m; }, {});
    cells.push({
      cell: `${substudy}-${tier}`, substudy, tier,
      instances: inCell.length, failed: inCell.length - ok.length,
      instance_verdicts: { treatment: ok.filter((x) => x.verdict === "treatment").length, placebo: ok.filter((x) => x.verdict === "placebo").length, tie: ok.filter((x) => x.verdict === "tie").length },
      questions_with_data: Object.keys(byQ).length, treatmentQs, placeboQs, tiedQs,
      p_one_sided: signTestUpper(treatmentQs, treatmentQs + placeboQs), agreement,
      judge_votes: { overall: tally("overall"), surfaces_new: tally("surfaces_new"), calibration: tally("calibration") },
    });
  }
  const adj = holm(cells.map((c) => c.p_one_sided));
  cells.forEach((c, i) => { c.p_holm = adj[i]; c.verdict = cellVerdict({ treatmentQs: c.treatmentQs, placeboQs: c.placeboQs, holmP: c.p_holm, agreement: c.agreement }); });
  const get = (name) => cells.find((c) => c.cell === name);
  const instrumentSuspect = ["Refuted", "Indeterminate"].includes(get("B-small").verdict);
  const falsifierMet = get("A-flagship").verdict === "Refuted" && get("B-flagship").verdict === "Refuted";
  // Secondary, exploratory: per consumer, per sub-study.
  const perConsumer = [];
  for (const substudy of ["A", "B"]) for (const c of CONSUMERS) {
    const xs = instances.filter((x) => x.substudy === substudy && x.model_id === c.model_id);
    const ok = xs.filter((x) => x.status === "ok");
    const T = ok.filter((x) => x.verdict === "treatment").length, P = ok.filter((x) => x.verdict === "placebo").length;
    perConsumer.push({ substudy, model_id: c.model_id, tier: c.tier, instances: xs.length, failed: xs.length - ok.length, treatment: T, placebo: P, tie: ok.length - T - P, p_two_sided_uncorrected: binomTwoSided(Math.max(T, P), T + P) });
  }
  return {
    cells, instrument_check: { positive_control: "B-small", verdict: get("B-small").verdict, suspect: instrumentSuspect, consequence: instrumentSuspect ? "No refutation is entered from this run until a blind out-of-panel rating of a 30-instance subset agrees with the panel." : null },
    falsifier: { rule: "A-flagship and B-flagship both Refuted", met: falsifierMet, blocked_by_instrument_check: falsifierMet && instrumentSuspect },
    per_consumer_exploratory: perConsumer,
    claude_harm_check: perConsumer.filter((r) => r.model_id === "claude-opus-5-5").map((r) => ({ substudy: r.substudy, placebo_beats_treatment: r.placebo > r.treatment, treatment: r.treatment, placebo: r.placebo, p_two_sided: r.p_two_sided_uncorrected })),
  };
}
