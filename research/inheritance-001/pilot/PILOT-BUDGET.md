# Pilot 001: projected calls and dollars (PROJECTION, nothing has been spent)

Prices: 2026-11-13 / 2026-11-18 provider pages (re-verify before any live run); priced for a run on 2026-12-01 (Gemini 4 Carbon's higher December price). Input tokens are estimated from the real prompt frame at 4 characters per token. Output: the cap is 3000 tokens per call, a bound each provider documents as covering all billed output, reasoning included; the expected figure, 1400, is the measured median of `claude-sonnet-5-5` in calibration probe 1 (1,328 tokens on 3-step tasks), rounded up, and is ASSUMED for the other three models until probe 2 measures them. Timeouts: 600 s, and a call that times out is charged at its worst case.

## Design

- One transition: generation-0 producers (`deepseek-v4-pro`, `gemini-4-carbon`) → generation-1 consumers (`claude-sonnet-5-5`, `gpt-6.1-sol`). No producer family is a consumer family. `grok-4.7` left the panel on 2026-11-20: xAI documents no request field that bounds its reasoning tokens (see PROVIDER-CAPS.md).
- Task families are 4-step compositions (probe 1 found 3-step families too easy for the one fully measured consumer). The sealed draw excludes every calibration family's op set.
- 6 work families × 4 tasks × 2 producers = 48 producer calls, plus 8 placebo-domain producer calls.
- 8 held-out families × 3 tasks × 2 consumers = 48 paired blocks × 6 arms = 288 consumer calls. No ablations in this pilot.
- Stage 0 (before registration): calibration probe `IS1-PROBE-CAL-002`, arm A only, 32 calls on public calibration families with this exact panel and cap, worst case $1.02 (plan `346b0cf3e997…`).

## Per-call output bounds (checked by the live gate)

| Model | Bound field | Reasoning controls sent | Documented status |
|---|---|---|---|
| `claude-sonnet-5-5` | `max_tokens` | `output_config: {effort:medium}` | verified-from-docs |
| `deepseek-v4-pro` | `max_tokens` | `thinking: {type:disabled}` | verified-from-docs (thinking disabled only) |
| `gemini-4-carbon` | `generation_config.max_output_tokens` | `thinking_level: low` | verified-from-docs (Interactions API only) |
| `gpt-6.1-sol` | `max_completion_tokens` | `reasoning_effort: medium` | verified-from-docs |

Docs read on 2026-11-20; sources and quotes in `PROVIDER-CAPS.md`.

## Money

| Model | Role | Calls | Tokens in | Out (expected) | Out (cap) | $/M in, out | Expected | Worst (first attempts) | Worst (with retries) |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|
| `claude-sonnet-5-5` | consumer-A, consumer-A+, consumer-BCDE | 144 | 177636 | 237600 | 475200 | 2, 10 | $2.73 | $5.11 | $10.21 |
| `deepseek-v4-pro` | producer-work, producer-placebo | 28 | 9913 | 39200 | 84000 | 1.32, 3.96 | $0.17 | $0.35 | $0.69 |
| `gemini-4-carbon` | producer-work, producer-placebo | 28 | 9913 | 39200 | 84000 | 4, 20 | $0.82 | $1.72 | $3.44 |
| `gpt-6.1-sol` | consumer-A, consumer-A+, consumer-BCDE | 144 | 177636 | 237600 | 475200 | 2, 10 | $2.73 | $5.11 | $10.21 |
| **Total** | | **344** (≤ 688 with retries) | | | | | **$6.45** | **$12.28** | **$24.56** |

Proposed hard caps for approval (after probe 2): **720 calls** and **$17** (worst case of first attempts plus the probe, plus 25%). The spend guard stops before any call whose worst case would cross the cap, a timed-out call is charged at its worst case, and the shared $95 ledger reserve must also succeed. Retries happen only on rate limits and server errors, never on timeouts.

## What this pilot can and cannot show

- It can show whether the machinery works on real providers (returned ids, usage, refusals, timeouts) and give first, descriptive estimates of C−A+, C−E, C−B and C−D.
- It cannot confirm H1–H3: 8 held-out families is below the preregistered minimum of 10 clusters for inference, so every verdict is descriptive. It cannot test a ratchet at all (one transition).
- Parametric power at 8 families (3 tasks × 2 consumers each, base rate 0.4):

| True effect | Power | Wrong-sign rate |
|---:|---:|---:|
| 0.1 | 0.237 | 0.003 |
| 0.15 | 0.375 | 0.003 |
| 0.2 | 0.588 | 0 |

