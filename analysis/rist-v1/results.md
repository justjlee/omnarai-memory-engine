# RIST v1 — results (registered analysis)

Registered: `fe0f807880d6df055bf51fe6f855020682354113` (public, branch creation 2026-10-02T15:24:25Z). Analysis: `scripts/lib/rist-analysis.mjs`. Spend ≈ $6.28.

## Outcome: **H1 supported, H1b not**

**Licensed sentence (§10):** The self-model is archive-specific, but the effect is harm from a mismatch, not benefit from ownership.
**Never licensed:** benefit; continuity

## Accuracy per arm (60 test records × 4 subjects = 240 trials; chance 25%)

| Arm | Overall (95% cluster-bootstrap CI) | GPT-4o | Gemini | Grok | DeepSeek | Invalid |
|---|---|---|---|---|---|---|
| N | 31.3% (27.1%–35.4%) | 10.0% | 1.7% | 80.0% | 33.3% | 0/240 |
| H | 47.5% (41.7%–53.3%) | 11.7% | 38.3% | 83.3% | 56.7% | 0/240 |
| R-own | 35.0% (30.0%–40.0%) | 5.0% | 18.3% | 83.3% | 33.3% | 0/240 |
| R-other | 25.4% (21.3%–29.6%) | 5.0% | 1.7% | 68.3% | 26.7% | 0/240 |

## Hypotheses (one-sided; cluster = test record; Holm over the three)

| | Contrast | Mean paired diff (95% CI) | p (perm) | Holm p | McNemar p | Subjects positive | Supported |
|---|---|---|---|---|---|---|---|
| H1 | R-own − R-other (primary, load-bearing) | +9.6 pp (+4.6 pp to +15.0 pp) | 0.0004 | 0.0011 | 0.0002 (32/9) | 3/4 | **yes** |
| H1b | R-own − N | +3.8 pp (-2.1 pp to +9.6 pp) | 0.1382 | 0.2764 | 0.1358 (31/22) | 2/4 | **no** |
| H2 | R-own − H | -12.5 pp (-18.8 pp to -6.3 pp) | 0.9999 | 0.9999 | 1.0000 (11/41) | 0/4 | **no** |

Per-subject mean paired difference:

| | GPT-4o | Gemini | Grok | DeepSeek |
|---|---|---|---|---|
| H1 | +0.0 pp | +16.7 pp | +15.0 pp | +6.7 pp |
| H1b | -5.0 pp | +16.7 pp | +3.3 pp | +0.0 pp |
| H2 | -6.7 pp | -20.0 pp | +0.0 pp | -23.3 pp |

## Sensitivity (declared in §6)

- Any arm >5% invalid: **false**
- Excluding invalid trials: H1 +9.6 pp (p 0.0004, n=240); H1b +3.8 pp (p 0.1382, n=240); H2 -12.5 pp (p 0.9999, n=240)
- Leave-one-subject-out, H1: without GPT-4o: +12.8 pp (p 0.0002); without Gemini: +7.2 pp (p 0.0171); without Grok: +7.8 pp (p 0.0058); without DeepSeek: +10.6 pp (p 0.0003)

## Chosen-letter distribution

- N: {"A":92,"D":45,"B":64,"C":39}
- H: {"A":64,"C":57,"B":71,"D":48}
- R-own: {"A":75,"B":53,"D":44,"C":68}
- R-other: {"A":70,"D":51,"B":62,"C":57}

## Provenance

- Stage 0 (ceiling pilot): N accuracy 28.1% on 32 trials; passed = true
- Model ids returned by the APIs: Gemini: gemini-2.5-flash; DeepSeek: deepseek-flash; GPT-4o: gpt-4o-2024-08-06; Grok: grok-4.3
- Tensions shown per archive (§4.3, logged): Gemini/R-own: 31 shown, 0 omitted; DeepSeek/R-other: 23 shown, 5 omitted; DeepSeek/R-own: 37 shown, 0 omitted; Grok/R-own: 45 shown, 0 omitted; Gemini/R-other: 39 shown, 6 omitted; GPT-4o/R-other: 27 shown, 4 omitted; Grok/R-other: 26 shown, 11 omitted; GPT-4o/R-own: 28 shown, 0 omitted
