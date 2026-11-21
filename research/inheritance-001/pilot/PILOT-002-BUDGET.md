# Pilot 002: projected calls and dollars (PROJECTION, nothing has been spent)

**Status: proposed.** Built 2026-11-21 on xz's panel decision ("Yes, Gemini + GPT"). Not drawn, not registered, not approved, never run. Draft preregistration: `research/inheritance-001/preregistration-002.draft.yaml`.

Prices: 2026-11-13 / 2026-11-18 provider pages (re-verify before any live run); priced for a run on 2026-12-01 (Gemini 4 Carbon's higher December price). Output caps: 3000 tokens per call (`gemini-4-carbon`: 4500, raised by probe 2's pre-committed output-cap rule), each a bound its provider documents as covering all billed output, reasoning included. Expected output per call is each model's measured mean, rounded up to 100: `claude-sonnet-5-5` 900 (probe 2, arm A, 4-step), `gemini-4-carbon` 1700 (probe 3) and `gpt-6.1-sol` 500 (probe 4), the producers measured on the contribution request this pilot sends them. Input tokens are estimated at 4 characters per token, then scaled by the largest real/estimated ratio measured on the frame each model will see (`claude-sonnet-5-5` 1.6, `gemini-4-carbon` 1.25, `gpt-6.1-sol` 1.15). Timeouts: 600 s, and a call that times out is charged at its worst case.

## Design

- One transition: generation-0 producers (`gemini-4-carbon`, `gpt-6.1-sol`) → generation-1 consumer (`claude-sonnet-5-5`), the only consumer. No producer family is the consumer's family, so every inherited record is cross-family. Results speak only to Claude Sonnet 5.5 as an inheritor.
- What changed since Pilot 001, and why: Pilot 001 (registered d24005d) ran all 344 calls but could not test inheritance, because producers were never told the program step language: 0 of 51 producer records could be verified and arm C was empty (an instrument finding, not a null). Producers are now told the language (`params.producer_language`, `lib/language.mjs`); consumer frames (arms A to E) are unchanged. Producer probes 3 and 4 checked the fix before this pilot (their shares stay private). `deepseek-v4-pro` left the panel (its records did not verify with thinking off, and its thinking mode has no documented output bound); `gpt-6.1-sol` moved from consumer to producer.
- Task families are 4-step compositions. The sealed set is drawn from a fresh secret seed (`lab.mjs draw-sealed --study pilot-002`) and never reuses an op set from any calibration probe; given Pilot 001's sealed file (`--exclude-sealed`), it also avoids every Pilot 001 family.
- 6 work families × 4 tasks × 2 producers = 48 producer calls, plus 8 placebo-domain producer calls.
- 8 held-out families × 6 tasks × 1 consumer = 48 paired blocks × 6 arms = 288 consumer calls (Pilot 001: 3 tasks × 2 consumers, the same 48 blocks). No ablations.
- Stage 0 (before registration): `IS1-PROBE-CAL-002`: ran 2026-11-20 (results private); `IS1-PROBE-CAL-003`: ran 2026-11-21 (results private); `IS1-PROBE-CAL-004`: ran 2026-11-21 (results private). Each was approved and reserved on its own; none is part of this cap.

## Per-call output bounds (checked by the live gate)

| Model | Bound field | Cap per call | Reasoning controls sent | Documented status |
|---|---|---:|---|---|
| `claude-sonnet-5-5` | `max_tokens` | 3000 | `output_config: {effort:medium}` | verified-from-docs |
| `gemini-4-carbon` | `generation_config.max_output_tokens` | 4500 | `thinking_level: low` | verified-from-docs (Interactions API only) |
| `gpt-6.1-sol` | `max_completion_tokens` | 3000 | `reasoning_effort: medium` | verified-from-docs |

Docs read on 2026-11-20; sources and quotes in `PROVIDER-CAPS.md`.

## Money

| Model | Role | Calls | Tokens in | Out (expected) | Out (cap) | $/M in, out | Expected | Worst (first attempts) | Worst (with retries) |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|
| `claude-sonnet-5-5` | consumer-A, consumer-A+, consumer-BCDE | 288 | 568254 | 331200 | 950400 | 2, 10 | $4.45 | $10.64 | $21.28 |
| `gemini-4-carbon` | producer-work, producer-placebo | 28 | 12366 | 47600 | 126000 | 4, 20 | $1.00 | $2.57 | $5.14 |
| `gpt-6.1-sol` | producer-work, producer-placebo | 28 | 11382 | 14000 | 84000 | 2, 10 | $0.16 | $0.86 | $1.73 |
| **Total** | | **344** (≤ 688 with retries) | | | | | **$5.61** | **$14.07** | **$28.15** |

Proposed hard caps for approval: **688 calls** and **$18** (worst case of first attempts plus 25%; the A+ arm's larger allowance is included). The spend guard stops before any call whose worst case would cross the cap, a timed-out call is charged at its worst case, and the shared $95 ledger must accept a reservation of the whole cap first. Retries happen only on rate limits and server errors, never on timeouts. The cap is part of the plan, so the plan hash xz approves fixes it.

## What a smaller cap would do (offline replay, not a forecast)

The shared ledger holds each run's whole reservation for 30 days, and on 2026-11-21 it had about $6.58 of room (DECISIONS_REQUIRED.md D16). The same ledger pays for the site's Council, queries and longitudinal cron, so a reservation that fills the room pauses those until reservations age out. The spend guard does not stop at the worst case: it stops before any call whose worst case would carry the *recorded* spend past the cap. So a cap well below the worst case can still let the run finish when real outputs stay near the measured means. The table replays this pilot offline through the real spend guard, billing every call a multiple of its model's measured mean output (never past its cap; producers always leave verifiable records, so arm C carries a full context). A run that stops keeps everything it recorded before the stop, but a stopped pilot cannot be resumed: a re-run starts over.

| Outputs vs measured means | Replay total | Smallest cap that finishes | Cap $6.00 | Cap $6.50 | Cap $7.00 | Cap $8.00 | Cap $18.00 |
|---|---:|---:|---|---|---|---|---|
| ×1 | $5.83 | $5.86 | finishes ($5.83) | finishes ($5.83) | finishes ($5.83) | finishes ($5.83) | finishes ($5.83) |
| ×1.25 | $7.01 | $7.04 | stops at 290/344 calls; 31/48 blocks have C and A+ | stops at 318/344 calls; 40/48 blocks have C and A+ | stops at 340/344 calls; 48/48 blocks have C and A+ | finishes ($7.01) | finishes ($7.01) |
| ×1.5 | $8.25 | $8.29 | stops at 243/344 calls; 18/48 blocks have C and A+ | stops at 263/344 calls; 23/48 blocks have C and A+ | stops at 287/344 calls; 30/48 blocks have C and A+ | stops at 331/344 calls; 45/48 blocks have C and A+ | finishes ($8.25) |

For calibration: the same replay predicts $5.58 for Pilot 001's plan; Pilot 001's complete second attempt recorded $3.16 (deviations.ndjson). Pilot 001's arm C was empty, which kept its inputs small, so Pilot 002 need not come in as low.

## What this pilot can and cannot show

- It can show whether producers told the language leave work a consumer can inherit, and give first, descriptive estimates of C−A+, C−E, C−B and C−D for one consumer family.
- It speaks only to Claude Sonnet 5.5 as an inheritor. Every block is cross-family by construction, so H3 (the cross-family subset) is the same set of blocks as H1 here.
- It cannot confirm H1–H3: 8 held-out families is below the preregistered minimum of 10 clusters for inference, so every verdict is descriptive. It cannot test a ratchet at all (one transition).
- Parametric power at 8 families (6 tasks × 1 consumer each, base rate 0.4, an assumption, not a measured rate):

| True effect | Power | Wrong-sign rate |
|---:|---:|---:|
| 0.1 | 0.237 | 0.003 |
| 0.15 | 0.375 | 0.003 |
| 0.2 | 0.588 | 0 |

