# Pilot 001: projected calls and dollars (PROJECTION, nothing has been spent)

Prices: 2026-11-13 / 2026-11-18 provider pages (re-verify before any live run); priced for a run on 2026-12-01. Token counts are estimated from the real prompt frame at 4 characters per token; output tokens are assumptions (expected 700, cap 2000).

## Design

- One transition: generation-0 producers (`gpt-6.1-sol`, `deepseek-v4-pro`) → generation-1 consumers (`claude-sonnet-5-5`, `grok-4.7`). No producer family is a consumer family.
- 6 work families × 4 tasks × 2 producers = 48 producer calls, plus 8 placebo-domain producer calls.
- 8 held-out families × 3 tasks × 2 consumers = 48 paired blocks × 6 arms = 288 consumer calls. No ablations in this pilot.
- Stage 0 (before registration): a difficulty probe, arm A only, 32 calls on public calibration families, worst case $0.54.

## Money

| Model | Role | Calls | Tokens in | Out (expected) | Out (cap) | $/M in, out | Expected | Worst (first attempts) | Worst (with retries) |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|
| `claude-sonnet-5-5` | consumer-A, consumer-A+, consumer-BCDE | 144 | 176958 | 136800 | 331200 | 2, 10 | $1.72 | $3.67 | $7.33 |
| `deepseek-v4-pro` | producer-work, producer-placebo | 28 | 9849 | 19600 | 56000 | 1.32, 3.96 | $0.09 | $0.23 | $0.47 |
| `gpt-6.1-sol` | producer-work, producer-placebo | 28 | 9849 | 19600 | 56000 | 2, 10 | $0.22 | $0.58 | $1.16 |
| `grok-4.7` | consumer-A, consumer-A+, consumer-BCDE | 144 | 176958 | 136800 | 331200 | 2, 6 | $1.17 | $2.34 | $4.68 |
| **Total** | | **344** (≤ 688 with retries) | | | | | **$3.20** | **$6.82** | **$13.64** |

Proposed hard caps for approval: **720 calls** and **$10** (worst case of first attempts plus the probe, plus 25%). The spend guard stops before any call whose worst case would cross the cap, and the shared $95 ledger reserve must also succeed.

## What this pilot can and cannot show

- It can show whether the machinery works on real providers (returned ids, usage, refusals, timeouts) and give first, descriptive estimates of C−A+, C−E, C−B and C−D.
- It cannot confirm H1–H3: 8 held-out families is below the preregistered minimum of 10 clusters for inference, so every verdict is descriptive. It cannot test a ratchet at all (one transition).
- Parametric power at 8 families (3 tasks × 2 consumers each, base rate 0.4):

| True effect | Power | Wrong-sign rate |
|---:|---:|---:|
| 0.1 | 0.237 | 0.003 |
| 0.15 | 0.375 | 0.003 |
| 0.2 | 0.588 | 0 |

