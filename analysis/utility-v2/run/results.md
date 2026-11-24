# Utility v2: results

Generated 2026-11-13T18:43:33.043Z by `node scripts/utility-v2.mjs --analyse`. Rules: docs/utility-v2-preregistration.md §4–§5.

## The four cells (primary, registered)

| Cell | Instances (failed) | Treatment Qs | Placebo Qs | Tied Qs | one-sided p | Holm p | Judge agreement | Verdict |
|---|---|---|---|---|---|---|---|---|
| A-flagship | 120 (0) | 2 | 22 | 0 | 1.0000 | 1.0000 | 0.722 | **Refuted** |
| A-small | 96 (0) | 4 | 11 | 9 | 0.9824 | 1.0000 | 0.694 | **Refuted** |
| B-flagship | 120 (0) | 19 | 5 | 0 | 0.0033 | 0.0099 | 0.817 | **Supported** |
| B-small | 96 (0) | 22 | 0 | 2 | 0.0000 | 0.0000 | 0.722 | **Supported** |

Instrument check (B-small, the positive control): Supported (passes).
Falsifier (A-flagship and B-flagship both Refuted): not met.

## Per consumer (exploratory, uncorrected)

| Sub-study | Model | Tier | Instances (failed) | Treatment | Placebo | Tie | two-sided p |
|---|---|---|---|---|---|---|---|
| A | claude-opus-5-5 | flagship | 24 (0) | 2 | 22 | 0 | 0.0000 |
| A | gpt-6.1-sol | flagship | 24 (0) | 6 | 18 | 0 | 0.0227 |
| A | gemini-4-carbon | flagship | 24 (0) | 7 | 17 | 0 | 0.0639 |
| A | grok-4.7 | flagship | 24 (0) | 7 | 17 | 0 | 0.0639 |
| A | deepseek-v4-pro | flagship | 24 (0) | 6 | 18 | 0 | 0.0227 |
| A | claude-haiku-5-5 | small | 24 (0) | 13 | 11 | 0 | 0.8388 |
| A | gpt-6-luna | small | 24 (0) | 13 | 11 | 0 | 0.8388 |
| A | gemini-3.5-flash-lite | small | 24 (0) | 9 | 15 | 0 | 0.3075 |
| A | deepseek-flash | small | 24 (0) | 3 | 21 | 0 | 0.0003 |
| B | claude-opus-5-5 | flagship | 24 (0) | 2 | 22 | 0 | 0.0000 |
| B | gpt-6.1-sol | flagship | 24 (0) | 8 | 16 | 0 | 0.1516 |
| B | gemini-4-carbon | flagship | 24 (0) | 18 | 6 | 0 | 0.0227 |
| B | grok-4.7 | flagship | 24 (0) | 23 | 1 | 0 | 0.0000 |
| B | deepseek-v4-pro | flagship | 24 (0) | 21 | 3 | 0 | 0.0003 |
| B | claude-haiku-5-5 | small | 24 (0) | 19 | 5 | 0 | 0.0066 |
| B | gpt-6-luna | small | 24 (0) | 22 | 2 | 0 | 0.0000 |
| B | gemini-3.5-flash-lite | small | 24 (0) | 22 | 2 | 0 | 0.0000 |
| B | deepseek-flash | small | 24 (0) | 20 | 4 | 0 | 0.0015 |

## Claude harm check (claude-opus-5-5, two-sided)

- A: treatment 2, placebo 22, p = 0.0000 (placebo ahead)
- B: treatment 2, placebo 22, p = 0.0000 (placebo ahead)

## Judge votes by criterion (descriptive)

| Cell | overall T/P/tie | surfaces_new T/P/tie | calibration T/P/tie |
|---|---|---|---|
| A-flagship | 96/264/0 | 74/268/18 | 93/218/49 |
| A-small | 122/165/0 | 131/150/6 | 82/167/38 |
| B-flagship | 214/144/1 | 201/144/14 | 166/156/37 |
| B-small | 227/60/1 | 231/50/7 | 136/99/53 |

## Spend (provider-reported usage at list prices)

Total $10.4765 of the $30 ceiling over 2802 HTTP calls (0 without a usage report, charged at their worst case).

| Model | Calls | Input tokens | Output tokens | USD |
|---|---|---|---|---|
| claude-opus-5-5 | 174 | 171750 | 114073 | 2.9685 |
| claude-sonnet-5-5 | 355 | 597046 | 55363 | 1.7477 |
| grok-4.7 | 174 | 321506 | 123396 | 1.3834 |
| gemini-4-carbon | 175 | 112734 | 83811 | 1.0937 |
| grok-4.3 | 295 | 357395 | 211937 | 0.9766 |
| gpt-6.1-sol | 174 | 107314 | 52323 | 0.7379 |
| gpt-6.1-terra | 344 | 367136 | 19210 | 0.4632 |
| deepseek-v4-pro | 175 | 112368 | 73394 | 0.4390 |
| gemini-3.8-flash | 344 | 372952 | 25246 | 0.3744 |
| gemini-3.5-flash-lite | 148 | 101216 | 36752 | 0.1222 |
| deepseek-flash | 148 | 103980 | 41945 | 0.0815 |
| claude-haiku-5-5 | 148 | 167530 | 80919 | 0.0572 |
| gpt-6-luna | 148 | 104897 | 41505 | 0.0312 |
