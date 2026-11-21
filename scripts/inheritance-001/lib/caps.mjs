// Inheritance study 001 — which models have an output bound the PROVIDER enforces, per the provider's own documentation.
//
// Why this exists (the 2026-11-20 probe): grok-4.7 was sent `max_tokens: 2000` and one call still billed 6,188 reasoning
// tokens; 13 calls ran past the client timeout. A spend cap is only as good as the per-call bound under it. So a model may
// be called live only if its provider documents a request field that bounds ALL billed output, reasoning included, and
// the request sends the reasoning controls recorded here. The live gate (adapters.mjs checkLiveAuthorization) refuses any
// model with no entry, with `cap_enforced: false`, or whose plan records different controls.
//
// Every entry cites the page it rests on and the day it was read (research/inheritance-001/pilot/PROVIDER-CAPS.md has the
// full reading). A doc can change: re-read before any live run, and change an entry only with a dated deviation line.
// Solver-side module: pure data, no imports.
export const CAPS_READ_ON = "2026-11-20";

export const OUTPUT_CAPS = Object.freeze({
  "claude-sonnet-5-5": Object.freeze({
    provider: "anthropic",
    api: "POST /v1/messages (anthropic-version 2026-10-21)",
    cap_field: "max_tokens",
    cap_includes_reasoning: true,
    cap_enforced: true,
    status: "verified-from-docs",
    controls: Object.freeze({ output_config: Object.freeze({ effort: "medium" }) }),
    basis: "max_tokens counts all thinking in the turn and is enforced as a strict limit; effort is soft guidance (default high on Sonnet 5.5).",
    sources: Object.freeze([
      Object.freeze({ url: "https://platform.claude.com/docs/en/build-with-claude/thinking", read_on: CAPS_READ_ON, quote: "includes all thinking Claude generates in the current turn, is enforced as a strict limit" }),
      Object.freeze({ url: "https://platform.claude.com/docs/en/build-with-claude/effort", read_on: CAPS_READ_ON, quote: "Thinking counts toward `max_tokens` even when the thinking content isn't returned." }),
    ]),
  }),
  "gpt-6.1-sol": Object.freeze({
    provider: "openai",
    api: "POST /v1/chat/completions",
    cap_field: "max_completion_tokens",
    cap_includes_reasoning: true,
    cap_enforced: true,
    status: "verified-from-docs",
    controls: Object.freeze({ reasoning_effort: "medium" }),
    basis: "max_completion_tokens bounds visible output plus reasoning tokens; GPT-6.1 Sol supports low…max (not none/minimal), default medium.",
    sources: Object.freeze([
      Object.freeze({ url: "https://developers.openai.com/api/reference/resources/chat", read_on: CAPS_READ_ON, quote: "including visible output tokens and reasoning tokens" }),
      Object.freeze({ url: "https://developers.openai.com/api/docs/guides/reasoning", read_on: CAPS_READ_ON, quote: "does not support `none` or `minimal` and defaults to `medium`" }),
    ]),
  }),
  "deepseek-v4-pro": Object.freeze({
    provider: "deepseek",
    api: "POST /chat/completions",
    cap_field: "max_tokens",
    cap_includes_reasoning: null, // not stated in the docs for thinking mode, so thinking is switched OFF (no reasoning tokens to bound)
    cap_enforced: true,
    status: "verified-from-docs (thinking disabled only)",
    controls: Object.freeze({ thinking: Object.freeze({ type: "disabled" }) }),
    basis: "max_tokens bounds the tokens generated in the completion; thinking {type: disabled} selects non-thinking mode, so no chain of thought is generated. Whether max_tokens bounds chain of thought in thinking mode is NOT documented, so thinking mode is not allowed here.",
    sources: Object.freeze([
      Object.freeze({ url: "https://api-docs.deepseek.com/api/create-chat-completion", read_on: CAPS_READ_ON, quote: "The maximum number of tokens that can be generated in the chat completion." }),
      Object.freeze({ url: "https://api-docs.deepseek.com/guides/thinking_mode", read_on: CAPS_READ_ON, quote: "Thinking mode is enabled by default" }),
    ]),
  }),
  "gemini-4-carbon": Object.freeze({
    provider: "gemini",
    api: "POST /v1beta/interactions",
    cap_field: "generation_config.max_output_tokens",
    cap_includes_reasoning: true,
    cap_enforced: true,
    status: "verified-from-docs (Interactions API only)",
    controls: Object.freeze({ thinking_level: "low" }),
    basis: "On the Interactions API, max_output_tokens includes thought tokens and is a hard cutoff. The generateContent reference does not say maxOutputTokens includes thoughts, so generateContent is not used. Thinking cannot be turned off on Gemini 4 (levels low/medium/high, default medium).",
    sources: Object.freeze([
      Object.freeze({ url: "https://aistudio.google.com/docs/thinking", read_on: CAPS_READ_ON, quote: "the maximum number of tokens a response can generate, including thought tokens" }),
      Object.freeze({ url: "https://aistudio.google.com/api-reference/interactions", read_on: CAPS_READ_ON, quote: "contains incomplete results (e.g. hitting max_tokens)" }),
    ]),
  }),
  "grok-4.7": Object.freeze({
    provider: "xai",
    api: "POST /v1/chat/completions",
    cap_field: "max_completion_tokens",
    cap_includes_reasoning: false,
    cap_enforced: false,
    status: "verified-from-docs (NOT boundable)",
    controls: Object.freeze({ reasoning_effort: "low" }),
    reason: "xAI documents that max_completion_tokens applies only to visible output, not reasoning, and that grok-4.7 reasoning cannot be disabled; reasoning_effort lowers but does not bound it (probe 2026-11-20: 6,188 reasoning tokens under a 2,000 cap)",
    basis: "No request field bounds grok-4.7's billed reasoning tokens.",
    sources: Object.freeze([
      Object.freeze({ url: "https://docs.x.ai/developers/rest-api-reference/inference/chat-completions", read_on: CAPS_READ_ON, quote: "only applies to visible output tokens (i.e. does not apply to tokens used for reasoning" }),
      Object.freeze({ url: "https://docs.x.ai/docs/guides/reasoning", read_on: CAPS_READ_ON, quote: "Reasoning cannot be disabled." }),
    ]),
  }),
});

// A dated snapshot id ("claude-sonnet-5-5-20261101") resolves to its base id, as in prices.mjs.
const baseId = (id) => String(id || "").replace(/^models\//, "").replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "");
export function capFor(modelId) {
  const id = String(modelId || "");
  if (Object.hasOwn(OUTPUT_CAPS, id)) return OUTPUT_CAPS[id];
  return Object.hasOwn(OUTPUT_CAPS, baseId(id)) ? OUTPUT_CAPS[baseId(id)] : null;
}
// The reasoning controls the transport sends for a model (null when it has no entry).
export const controlsFor = (modelId) => capFor(modelId)?.controls ?? null;

// [] when the model may be called live under its documented bound, else the reasons it may not.
export function capProblems({ model_id, provider, controls }) {
  const c = capFor(model_id);
  if (!c) return [`no documented, provider-enforced output bound on file for ${model_id} (lib/caps.mjs)`];
  const out = [];
  if (c.cap_enforced !== true) out.push(`${model_id}: output cap is not provider-enforced (${c.reason || c.basis})`);
  if (!c.sources?.length || c.sources.some((s) => !/^https:\/\//.test(s.url || "") || !/^\d{4}-\d{2}-\d{2}$/.test(s.read_on || ""))) out.push(`${model_id}: cap entry lacks a dated provider source`);
  if (provider !== undefined && provider !== c.provider) out.push(`${model_id}: plan provider ${provider} differs from the documented provider ${c.provider}`);
  if (JSON.stringify(controls ?? null) !== JSON.stringify(c.controls ?? null)) out.push(`${model_id}: the plan's reasoning controls differ from the documented ones the cap relies on`);
  return out;
}
