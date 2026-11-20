// Inheritance study 001 — model adapters, the spend guard, and the live-run gate.
//
// Interface (every adapter):
//   call({provider, model_id, input:{system, user}, temperature, max_output_tokens, timeout_ms, tracing_id, attempt})
//     → {provider_returned_model_id, output, usage:{in,out}, request_id, duration_ms, provider_response_metadata, error}
// The RUNNER owns retries: every attempt is its own record with its own id (callWithRetries), never a silent overwrite.
// A seed is never claimed to make a provider deterministic; model ids are pinned and the RETURNED id is what counts.
//
// LIVE CALLS ARE OFF. createLiveAdapter() refuses unless every one of these holds — and in the 2026-11-20 build session
// none of them does, by design:
//   1. a written approval file for THIS study and THIS plan hash (plan_sha256), naming the approver, providers, models,
//      a finite call cap and a USD cap (overall and per provider);
//   2. the preregistration is registered: status "registered" + the commit sha of its public push;
//   3. the command line repeats the experiment id, --max-usd and --max-calls, matching the approval, plus --live --yes;
//   4. OMNARAI_LAB_LIVE=1 in the environment;
//   5. every model in the plan has a price on file (an unknown price cannot be bounded);
//   6. the shared $95 ledger reserve succeeded (scripts/budget-preflight.mjs, run by run-models before the first call);
//   7. every model has a DOCUMENTED, provider-enforced bound on all billed output, reasoning included, and the plan records
//      the reasoning controls that bound relies on (lib/caps.mjs; added after the 2026-11-20 probe, where grok-4.7 billed
//      reasoning far past its max_tokens).
// The transport (node:https, keys in headers only — never in a URL) is constructed only after all of that.
import https from "node:https";
import { sha256 } from "./canon.mjs";
import { costOf, priceFor } from "./prices.mjs";
import { familyOfModelId } from "./identity.mjs";
import { capProblems, controlsFor } from "./caps.mjs";

export class SpendRefusedError extends Error {
  constructor(missing) { super(`SPEND_REFUSED: ${missing.join("; ")}`); this.code = "SPEND_REFUSED"; this.missing = missing; }
}
export class BudgetExhaustedError extends Error {
  constructor(detail) { super(`BUDGET_EXHAUSTED ${detail}`); this.code = "BUDGET_EXHAUSTED"; }
}

// ── Redaction ────────────────────────────────────────────────────────────────────────────────────────────────────────
const SECRET_RES = [/sk-ant-[A-Za-z0-9_-]{10,}/g, /sk-[A-Za-z0-9_-]{16,}/g, /AIza[0-9A-Za-z_-]{20,}/g, /xai-[A-Za-z0-9]{16,}/g, /Bearer\s+[A-Za-z0-9._-]{12,}/g, /([?&]key=)[^&\s]+/g, /vercel_blob_rw_[A-Za-z0-9]{8,}/g];
export function redact(s, extraSecrets = []) {
  let t = String(s ?? "");
  for (const sec of extraSecrets) if (sec && sec.length >= 8) t = t.split(sec).join("[redacted]");
  for (const re of SECRET_RES) t = t.replace(re, (m, p1) => (p1 && m.startsWith(p1) ? `${p1}[redacted]` : "[redacted]"));
  return t;
}

// ── Spend guard: hard numeric caps, worst-case pre-check, kill switch ────────────────────────────────────────────────
// inputFactor: the pre-call worst case multiplies the input estimate (4 characters per token) by this factor, because probe 2
// (2026-11-20) measured real input up to 1.55x that estimate for Claude; the recorded cost always uses the provider's usage.
export function createSpendGuard({ maxCalls, maxUsd, perProviderUsd = {}, onDate, killSwitch = () => false, mock = false, inputFactor = 2 }) {
  if (!mock && (!Number.isInteger(maxCalls) || maxCalls < 0 || !Number.isFinite(maxUsd) || maxUsd < 0)) throw new Error("SPEND_GUARD_NEEDS_FINITE_CAPS");
  const state = { calls: 0, usd: 0, byProvider: {}, unknownCostCalls: 0, maxOutSeen: {}, assumedUsd: 0, assumedCalls: 0 };
  return {
    state,
    // Before a call: worst case = full input + the whole output cap at list price. Refuse if it could cross a cap.
    precheck({ provider, model_id, tokensIn, maxOut }) {
      if (killSwitch()) throw new BudgetExhaustedError("kill switch engaged");
      if (mock) { state.calls++; return { worst_usd: 0 }; }
      if (state.calls + 1 > maxCalls) throw new BudgetExhaustedError(`call cap ${maxCalls} reached`);
      const p = priceFor(model_id, onDate);
      if (!p) throw new BudgetExhaustedError(`no price on file for ${model_id}; cannot bound the spend`);
      // A provider may bill more output than the cap asked for (reasoning tokens): the worst case is the larger of the
      // cap and the largest output this model has actually returned in this run.
      const worst = (tokensIn * inputFactor * p.in + Math.max(maxOut, state.maxOutSeen[model_id] || 0) * p.out) / 1e6;
      if (state.usd + worst > maxUsd) throw new BudgetExhaustedError(`worst case $${(state.usd + worst).toFixed(4)} would cross the $${maxUsd} cap`);
      const cap = perProviderUsd[provider];
      if (cap !== undefined && (state.byProvider[provider] || 0) + worst > cap) throw new BudgetExhaustedError(`${provider} cap $${cap}`);
      state.calls++;
      return { worst_usd: +worst.toFixed(6) };
    },
    // A call that timed out or lost its connection returns no usage, but the provider may still bill it (the 2026-11-20
    // probe: 13 of 16 grok-4.7 calls ran past 120 s and came back with nothing to count). Such a call is charged at its
    // pre-call worst case, never $0, and the charge is marked as assumed.
    assume({ provider, worst_usd }) {
      if (mock) return { usd: 0, status: "mock-zero" };
      state.usd += worst_usd; state.assumedUsd += worst_usd; state.assumedCalls++;
      state.byProvider[provider] = (state.byProvider[provider] || 0) + worst_usd;
      return { usd: +worst_usd.toFixed(6), status: "assumed-worst-case", price_basis: null };
    },
    // Priced by the RETURNED id when the table knows it (a dated snapshot resolves to its base id), else by the requested
    // id; the basis is recorded so a reader can tell which.
    record({ provider, model_id, returned_model_id = null, usage }) {
      if (mock) return { usd: 0, status: "mock-zero" };
      const basis = returned_model_id && priceFor(returned_model_id, onDate) ? returned_model_id : model_id;
      state.maxOutSeen[model_id] = Math.max(state.maxOutSeen[model_id] || 0, usage?.out || 0);
      const c = { ...costOf(basis, usage?.in || 0, usage?.out || 0, { onDate }), price_basis: basis };
      if (c.usd === null) state.unknownCostCalls++;
      else { state.usd += c.usd; state.byProvider[provider] = (state.byProvider[provider] || 0) + c.usd; }
      return c;
    },
  };
}

// ── Retries as explicit attempts ─────────────────────────────────────────────────────────────────────────────────────
export async function callWithRetries(adapter, request, { maxAttempts = 3, guard, onAttempt = () => {} }) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attempt_id = `${request.tracing_id}-a${attempt}`;
    const pre = guard.precheck({ provider: request.provider, model_id: request.model_id, tokensIn: request.tokens_in_est, maxOut: request.max_output_tokens });
    const r = await adapter.call({ ...request, attempt });
    const unseen = r.error && !r.usage && ["TIMEOUT", "TRANSPORT_ERROR"].includes(r.error.code);
    const cost = unseen ? guard.assume({ provider: request.provider, worst_usd: pre.worst_usd }) : guard.record({ provider: request.provider, model_id: request.model_id, returned_model_id: r.provider_returned_model_id, usage: r.usage });
    const rec = {
      attempt_id,
      status: r.error ? (r.error.code === "TIMEOUT" ? "timeout" : "error") : "ok",
      error_code: r.error ? redact(r.error.code) : null,
      error_detail: r.error?.detail ? redact(r.error.detail).slice(0, 200) : null,
      request_id: r.request_id ?? null,
      provider_returned_model_id: r.provider_returned_model_id ?? null,
      duration_ms: r.duration_ms ?? null,
      usage: r.usage ?? null,
      cost_usd: cost.usd,
      cost_status: cost.status,
      price_basis: cost.price_basis ?? null,
      worst_case_usd: pre.worst_usd,
    };
    attempts.push(rec);
    onAttempt(rec);
    if (!r.error) return { result: r, attempts };
    if (!r.error.retryable) return { result: r, attempts };
  }
  return { result: { error: { code: "RETRIES_EXHAUSTED" } }, attempts };
}

// ── The live gate ────────────────────────────────────────────────────────────────────────────────────────────────────
// requireRegistration=false is ONLY for a calibration probe whose results never enter the study (public calibration
// families, arm A only); everything else about the gate is identical.
export function checkLiveAuthorization({ approval, preregistration, plan, planSha256, argv = [], env = {}, requireRegistration = true }) {
  const missing = [];
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  if (!approval) missing.push("no approval file (research/inheritance-001/approvals/<study>.json, written from xz's words)");
  else {
    if (approval.study_id !== plan?.study_id) missing.push("approval names a different study");
    if (approval.plan_sha256 !== planSha256) missing.push("approval was given for a different plan (plan_sha256 mismatch)");
    if (!approval.approved_by || !approval.approved_at || !approval.approval_words) missing.push("approval lacks approver, time or the approver's own words");
    if (!Number.isInteger(approval.max_calls) || approval.max_calls <= 0) missing.push("approval lacks a finite call cap");
    if (!Number.isFinite(approval.max_usd) || approval.max_usd <= 0) missing.push("approval lacks a USD cap");
    for (const m of plan?.models || []) if (!(approval.models || []).includes(m.model_id)) missing.push(`approval does not list model ${m.model_id}`);
  }
  if (requireRegistration && (preregistration?.status !== "registered" || !/^[0-9a-f]{7,40}$/.test(preregistration?.registered_commit_sha || ""))) missing.push("preregistration is not registered with a pushed commit sha");
  if (!argv.includes("--live") || !argv.includes("--yes")) missing.push("--live --yes not given");
  if (flag("--experiment") !== plan?.study_id) missing.push("--experiment <study id> not given or wrong");
  if (approval && Number(flag("--max-usd")) !== approval.max_usd) missing.push("--max-usd must repeat the approved cap");
  if (approval && Number(flag("--max-calls")) !== approval.max_calls) missing.push("--max-calls must repeat the approved call cap");
  if (env.OMNARAI_LAB_LIVE !== "1") missing.push("OMNARAI_LAB_LIVE=1 not set");
  for (const m of plan?.models || []) if (!priceFor(m.model_id)) missing.push(`no price on file for ${m.model_id}`);
  for (const m of plan?.models || []) missing.push(...capProblems(m));
  return missing;
}

function postJSON(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const t0 = Date.now();
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text, duration_ms: Date.now() - t0 });
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    req.write(body);
    req.end();
  });
}

// One request per provider. Keys travel in headers (Gemini: x-goog-api-key), never in a URL or a log line.
// Every request carries the model's documented reasoning controls (lib/caps.mjs) next to the output field the provider
// documents as bounding ALL billed output. Gemini goes through the Interactions API, the endpoint whose max_output_tokens
// is documented to include thought tokens; generateContent's maxOutputTokens is not, so it is not used.
export function createHttpsTransport(keys, { post = postJSON } = {}) {
  return async function send({ provider, model_id, input, temperature, max_output_tokens, timeout_ms }) {
    const msgs = [{ role: "user", content: input.user }];
    const controls = controlsFor(model_id) || {};
    if (provider === "anthropic") {
      // API version 2026-10-21, the one the effort docs' examples use. It rejects temperature/top_p/top_k on every model
      // (Sonnet 5.5 already rejects non-default values), so no sampling field is ever sent here.
      return post("https://api.anthropic.com/v1/messages", { "x-api-key": keys.ANTHROPIC_API_KEY, "anthropic-version": "2026-10-21", "content-type": "application/json" },
        JSON.stringify({ model: model_id, max_tokens: max_output_tokens, ...(controls.output_config ? { output_config: controls.output_config } : {}), ...(input.system ? { system: input.system } : {}), messages: msgs }), timeout_ms);
    }
    if (provider === "gemini") {
      return post("https://generativelanguage.googleapis.com/v1beta/interactions", { "x-goog-api-key": keys.GEMINI_API_KEY, "content-type": "application/json" },
        JSON.stringify({ model: model_id, input: input.user, ...(input.system ? { system_instruction: input.system } : {}), generation_config: { max_output_tokens, ...(controls.thinking_level ? { thinking_level: controls.thinking_level } : {}), ...(temperature != null ? { temperature } : {}) }, store: false }), timeout_ms);
    }
    const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[provider];
    const key = { openai: keys.OPENAI_API_KEY, xai: keys.XAI_API_KEY, deepseek: keys.DEEPSEEK_API_KEY }[provider];
    if (!base) throw new Error(`UNKNOWN_PROVIDER ${provider}`);
    // OpenAI and xAI document max_completion_tokens (max_tokens is deprecated there); DeepSeek documents max_tokens.
    const capField = provider === "deepseek" ? "max_tokens" : "max_completion_tokens";
    const extra = { ...(controls.reasoning_effort ? { reasoning_effort: controls.reasoning_effort } : {}), ...(controls.thinking ? { thinking: controls.thinking } : {}) };
    return post(`${base}/chat/completions`, { authorization: `Bearer ${key}`, "content-type": "application/json" },
      JSON.stringify({ model: model_id, [capField]: max_output_tokens, ...extra, ...(temperature != null ? { temperature } : {}), messages: [...(input.system ? [{ role: "system", content: input.system }] : []), ...msgs] }), timeout_ms);
  };
}

// Parse a provider response into the honest call record.
export function parseProviderResponse(provider, res) {
  const d = res.json || {};
  const reqId = res.headers?.["request-id"] || res.headers?.["x-request-id"] || d.id || d.responseId || null;
  if (res.status === 429 || res.status >= 500) return { error: { code: `HTTP_${res.status}`, retryable: true }, request_id: reqId, duration_ms: res.duration_ms, usage: null };
  if (res.status >= 400 || d.error) return { error: { code: `HTTP_${res.status}`, detail: d.error?.message || res.text?.slice(0, 200), retryable: false }, request_id: reqId, duration_ms: res.duration_ms, usage: null };
  if (provider === "anthropic") return { provider_returned_model_id: d.model || null, output: (d.content || []).map((c) => c.text || "").join(""), usage: { in: d.usage?.input_tokens || 0, out: d.usage?.output_tokens || 0 }, request_id: reqId, duration_ms: res.duration_ms, provider_response_metadata: { stop_reason: d.stop_reason || null, raw_usage: d.usage || null }, error: null };
  if (provider === "gemini" && (Array.isArray(d.steps) || d.usage?.total_input_tokens !== undefined)) {
    // Interactions API. Its documented example has total_tokens = input + output + thought, so the thought tokens are NOT
    // inside total_output_tokens: billed output = output + thought (the documented cap covers both).
    const steps = (d.steps || []).filter((st) => !st.type || st.type === "model_output");
    const text = steps.flatMap((st) => (Array.isArray(st.content) ? st.content : [])).filter((c) => c && (c.type === "text" || c.type === undefined) && typeof c.text === "string").map((c) => c.text).join("");
    const u = d.usage || {};
    return { provider_returned_model_id: d.model || null, output: text, usage: { in: u.total_input_tokens || 0, out: (u.total_output_tokens || 0) + (u.total_thought_tokens || 0) }, request_id: reqId, duration_ms: res.duration_ms, provider_response_metadata: { finish_reason: d.status || null, raw_usage: d.usage || null, step_types: (d.steps || []).map((st) => st?.type ?? null) }, error: null };
  }
  if (provider === "gemini") return { provider_returned_model_id: d.modelVersion || null, output: d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "", usage: { in: d.usageMetadata?.promptTokenCount || 0, out: (d.usageMetadata?.candidatesTokenCount || 0) + (d.usageMetadata?.thoughtsTokenCount || 0) }, request_id: reqId, duration_ms: res.duration_ms, provider_response_metadata: { finish_reason: d.candidates?.[0]?.finishReason || null }, error: null };
  // xAI reports reasoning tokens in completion_tokens_details; whether completion_tokens already includes them is not
  // verified here, so they are ADDED (a possible over-count — the safe direction for a spend cap) and both raw figures kept.
  const reasoning = d.usage?.completion_tokens_details?.reasoning_tokens || 0;
  const out = (d.usage?.completion_tokens || 0) + (provider === "xai" ? reasoning : 0);
  return { provider_returned_model_id: d.model || null, output: d.choices?.[0]?.message?.content || "", usage: { in: d.usage?.prompt_tokens || 0, out }, request_id: reqId, duration_ms: res.duration_ms, provider_response_metadata: { finish_reason: d.choices?.[0]?.finish_reason || null, raw_usage: d.usage || null, reasoning_tokens_added: provider === "xai" ? reasoning : 0 }, error: null };
}

export function createLiveAdapter({ authorization, keys, transport = null }) {
  const missing = checkLiveAuthorization(authorization);
  if (missing.length) throw new SpendRefusedError(missing);
  const send = transport || createHttpsTransport(keys);
  const secrets = Object.values(keys || {});
  return {
    kind: "live",
    billable: true,
    async call(req) {
      try {
        const res = await send(req);
        const r = parseProviderResponse(req.provider, res);
        if (r.error?.detail) r.error.detail = redact(r.error.detail, secrets);
        return r;
      } catch (e) {
        return { error: { code: e.code === "TIMEOUT" ? "TIMEOUT" : "TRANSPORT_ERROR", detail: redact(e.message, secrets), retryable: e.code !== "TIMEOUT" }, provider_returned_model_id: null, usage: null };
      }
    },
  };
}

// Same-family check on what the PROVIDER said it ran.
export const returnedFamily = (r) => familyOfModelId(r?.provider_returned_model_id);
export const approvalDigest = (approval) => sha256(approval);
