# Provider output caps: what each provider documents (read 2026-11-20)

**Why this page exists.** In calibration probe `IS1-PROBE-CAL-001` (2026-11-20), `grok-4.7` was sent `max_tokens: 2000` and one
call still used 6,188 reasoning tokens; 13 of 16 calls ran past the 120 s client timeout and were recorded at $0. A dollar cap is
only as good as the bound under each call. From now on a model may be called live only if its provider's **own documentation**
names a request field that bounds **all billed output, reasoning included**, and the request sends the reasoning controls that
bound relies on. The table in `scripts/inheritance-001/lib/caps.mjs` encodes this page; the live gate
(`checkLiveAuthorization`) refuses any model without an entry, with `cap_enforced: false`, or with different controls in the plan.

Every page below was read on **2026-11-20** from the provider's own site. Each claim is marked **verified-from-docs** (the page
says it) or **unverified** (inferred, or not stated). Quotes are short excerpts; the linked page is the authority. Re-read before
any live run; change an entry only with a dated line in `deviations.ndjson`.

## Summary

| Model | Provider-enforced bound on all billed output? | Field we send | Reasoning control we send | In the pilot panel |
|---|---|---|---|---|
| `claude-sonnet-5-5` | **Yes** (verified) | `max_tokens` | `output_config.effort: "medium"` (adaptive thinking stays on) | consumer |
| `gpt-6.1-sol` | **Yes** (verified) | `max_completion_tokens` | `reasoning_effort: "medium"` | consumer (was producer) |
| `deepseek-v4-pro` | **Yes, with thinking disabled** (verified for non-thinking mode; unverified in thinking mode) | `max_tokens` | `thinking: {type: "disabled"}` | producer |
| `gemini-4-carbon` | **Yes, on the Interactions API only** (verified there; unverified on generateContent) | `generation_config.max_output_tokens` | `thinking_level: "low"` | producer (new) |
| `grok-4.7` | **No** (verified: the docs say the field excludes reasoning, and reasoning cannot be disabled) | — | — | **removed** |

## Anthropic: `claude-sonnet-5-5` (Messages API)

- Sources: <https://platform.claude.com/docs/en/build-with-claude/thinking>,
  <https://platform.claude.com/docs/en/build-with-claude/effort>, <https://platform.claude.com/docs/en/about-claude/pricing>.
- **Bound (verified-from-docs).** `max_tokens` "includes all thinking Claude generates in the current turn, is enforced as a strict
  limit". The Sonnet 5.5 section of the effort page says thinking counts toward `max_tokens` even when the thinking text isn't
  returned. Thinking is billed as output tokens.
- **Lowering reasoning (verified).** `output_config.effort`: `low`, `medium`, `high` (default on Sonnet 5.5), `xhigh`, `max`. Effort
  is soft guidance; `max_tokens` is the hard limit. Thinking cannot be set to `disabled` on Sonnet 5.5 (400); the lowest setting is
  `thinking: {type: "between_tools"}`, accepted only at effort `high` or below. We keep adaptive thinking (the default) and send
  `effort: "medium"`.
- **Usage (verified).** `usage.output_tokens` counts thinking at full length.
- **Request details.** API version header `2026-10-21` (the version the effort page's examples use). That version rejects
  `temperature`, `top_p` and `top_k` on every model, so the transport never sends a sampling field to Anthropic.
- Price re-read 2026-11-20: $2 in / $10 out per million tokens (matches `prices.mjs`).

## OpenAI: `gpt-6.1-sol` (Chat Completions)

- Sources: <https://developers.openai.com/api/reference/resources/chat> (the old `platform.openai.com` reference redirects here),
  <https://developers.openai.com/api/docs/guides/reasoning>, <https://developers.openai.com/api/docs/models/gpt-6.1-sol>.
- **Bound (verified-from-docs).** `max_completion_tokens` is an upper bound on generated tokens "including visible output tokens and
  reasoning tokens". `max_tokens` is deprecated there. When the bound is reached during reasoning the response can be empty and the
  reasoning is still billed (reasoning guide).
- **Lowering reasoning (verified).** `reasoning_effort`; GPT-6.1 Sol supports `low` through `max`, not `none` or `minimal`, and
  defaults to `medium`. We send `medium` explicitly.
- **Usage (unverified).** The reference does not state outright that `completion_tokens` includes `reasoning_tokens`; it implies it
  (another field's note says some tokens, like reasoning tokens, are counted in total completion tokens). Probe 2 checks this on
  every call: a call reporting more reasoning tokens than completion tokens trips the cap-enforcement rule.
- Price re-read 2026-11-20: $2 / $10 (matches). Chat Completions is supported for this model.

## DeepSeek: `deepseek-v4-pro` (Chat Completions)

- Sources: <https://api-docs.deepseek.com/api/create-chat-completion>, <https://api-docs.deepseek.com/guides/thinking_mode>,
  <https://api-docs.deepseek.com/quick_start/pricing>.
- **Bound (verified for non-thinking mode).** `max_tokens` is "the maximum number of tokens that can be generated in the chat
  completion" (1 to 393,216). `thinking: {type: "disabled"}` selects non-thinking mode, so there is no chain of thought to bound.
- **Unverified: thinking mode.** No DeepSeek page says whether `max_tokens` bounds chain-of-thought tokens when thinking is on
  (thinking is on by default, effort `high`). The defaults (8K non-thinking, 64K thinking) suggest it does, but that is an
  inference. So DeepSeek runs with thinking **disabled**; its entry is enforced only under that control, and the gate refuses a plan
  that records any other.
- **Usage.** The reference lists `completion_tokens_details.reasoning_tokens` but does not say whether `completion_tokens` includes
  it. With thinking off it should be 0; probe 2 treats any reported reasoning token as a cap breach.
- Price re-read 2026-11-20: $1.32 in (cache miss) / $3.96 out per million at peak; off-peak is half. `prices.mjs` uses the peak
  price (the worst case). The examples in the thinking guide use `deepseek-flash`; the reference lists `deepseek-v4-pro` as a valid id.

## Google: `gemini-4-carbon` (Interactions API)

- Sources: <https://aistudio.google.com/docs/thinking> (the old `ai.google.dev` pages redirect here),
  <https://aistudio.google.com/api-reference/interactions>, <https://aistudio.google.com/api-reference/generate-content>,
  <https://aistudio.google.com/docs/interactions>, <https://aistudio.google.com/docs/pricing>.
- **Bound (verified on the Interactions API).** The thinking guide, whose examples call `POST /v1beta/interactions`, says
  `max_output_tokens` sets "the maximum number of tokens a response can generate, including thought tokens" and acts as a hard
  cutoff enforced by the infrastructure. When it is hit the interaction's status is `incomplete`, and thought tokens are still billed.
- **Unverified on generateContent.** The generateContent reference describes `maxOutputTokens` only as the maximum tokens in a
  response candidate and does not say it includes thoughts. So the transport no longer uses generateContent for Gemini.
- **Lowering reasoning (verified).** `generation_config.thinking_level`; Gemini 4 Carbon supports `low`, `medium` (default), `high`.
  Thinking cannot be turned off on Gemini 4. We send `low` (earlier Omnarai runs found Gemini thinking used about ten times the tokens
  of its peers; the bound caps the cost either way, `low` reduces cap stops).
- **Usage (verified from the documented example).** `usage.total_input_tokens`, `total_output_tokens`, `total_thought_tokens`,
  `total_tokens`; the reference's example has total = input + output + thought (7 + 23 + 49 = 79), so thought tokens sit outside
  `total_output_tokens`. Billed output is parsed as output + thought.
- **Request details (partly unverified).** `system_instruction` is a string and `input` may be a string (reference types); `store:
  false` is documented. The Interactions API is marked **beta** (`/v1beta/`). The exact response layout (`steps[]` with a
  `model_output` step holding text content) is read from the reference's example, not a stated rule; the parser takes text only
  from `model_output` steps. Probe 2 is the first real test of this path.
- Price re-read 2026-11-20: $2 / $10 through 2026-11-30, **$4 / $20 from 2026-12-01** (output includes thinking). Probe 2 and the
  pilot are priced at the December rate.

## xAI: `grok-4.7` (Chat Completions): cannot be bounded

- Sources: <https://docs.x.ai/developers/rest-api-reference/inference/chat-completions>, <https://docs.x.ai/docs/guides/reasoning>,
  <https://docs.x.ai/developers/models>.
- **No bound (verified-from-docs).** `max_completion_tokens` "only applies to visible output tokens (i.e. does not apply to tokens
  used for reasoning" or function calls); `max_tokens` is deprecated. The Responses API's `max_output_tokens` carries the same
  limitation.
- **Reasoning cannot be disabled (verified)** on the effort-based models; `grok-4.7` supports `reasoning_effort` (default `high`),
  which lowers reasoning but does not bound it. No non-reasoning variant of `grok-4.7` is listed (only the older
  `grok-4.20-0309-non-reasoning`).
- **Usage (consistent with probe 1).** `completion_tokens` excludes `reasoning_tokens` (probe 1 checked against `total_tokens`); the
  parser adds them.
- **Decision:** `grok-4.7` is recorded with `cap_enforced: false`; the live gate refuses it. It leaves the pilot panel.

## The resulting panel

Grok out leaves three boundable families (Anthropic, OpenAI, DeepSeek), and the design needs four (two producer families, two
different consumer families). Gemini is therefore needed, and it is placed as a **producer** (28 pilot calls) rather than a consumer
(144), which keeps the December price doubling to about $1.7 of the pilot's worst case.

- Producers: `deepseek-v4-pro` (thinking off), `gemini-4-carbon` (Interactions API, thinking `low`).
- Consumers: `claude-sonnet-5-5` (effort `medium`), `gpt-6.1-sol` (reasoning effort `medium`).
- Every call: `max_output_tokens` 3000 in the field above, client timeout 600 s, a timed-out call charged at its worst case.
