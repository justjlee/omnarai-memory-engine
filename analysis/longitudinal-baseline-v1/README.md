# Longitudinal baseline v1 — results

Preregistered in `docs/longitudinal-baseline-preregistration.md`, commit **ca60368** (pushed before the script existed). Data:
`snapshot.json`, sha256 `127a05a6…c04b70` (matches the preregistration; the script refuses to run otherwise). Reproduce with
`python3 -I analysis/longitudinal-baseline-v1/analyze.py` (standard library only). Full numbers: `results.json`.

Measure: TF-IDF cosine between answer texts (word-level, defined in the preregistration). It measures **wording**, not position: two
answers can say the same thing in different words, or different things in similar words.

## Verdicts

| | Prediction | Rule | Observed | Verdict |
|---|---|---|---|---|
| **H1** | Claude (version swapped June→Sept) moved more than the unchanged-id models | ≥ 9 of 10 questions | **10 of 10** (sign test p ≈ 0.001); median self-similarity Claude 0.213 vs unchanged-id mean 0.270 | **Supported** |
| **H2** | A month later (Sept→Oct, same ids), a model's answer is closer to its own last answer than to its peers' | ≥ 75% of pairs | **93 of 93 (100%)**, every model 100% | **Supported** |

## What it means

1. **The instrument can see a model change.** At n = 10, a free word-level measure separated the one known version swap from the
   unchanged-id models on every question. That makes a generational comparison (the proposed frontier track) measurable, at least for
   wording.
2. **Each lineage has a stable voice.** Same model, one month apart: median similarity 0.28–0.33 by model. Different models, same
   question, same month: median 0.18 (range 0.10–0.26). With no exceptions in 93 pairs, a model's answer is closer to its own last answer than to its
   peers' last answers on average. This is a fingerprint of style; it says nothing yet about whether positions are stable.
3. **The fixed panel shows no trend.** Between-model spread barely moved (median change +0.011 June→Sept, +0.003 Sept→Oct). That is
   what a panel of unchanging models should show. It cannot tell us whether newer minds converge or diverge.

**The noise floor** (one month, same id): median self-similarity per model = Claude 0.333 · GPT-4o 0.301 · Grok 0.286 ·
Gemini 0.285 · DeepSeek 0.281. A future claim that a generation "answers differently from its predecessor" has to fall clearly below
these.

## Exploratory (no verdict; not evidence of anything on its own)

Three-month self-similarity (June→Sept), by model: GPT-4o 0.283 · Gemini 0.306 · **Grok 0.217** · **DeepSeek 0.191** · Claude (id
changed) 0.213. GPT-4o and Gemini look the same over three months as over one. **Grok and DeepSeek drop to Claude's level although
their requested ids did not change.** For DeepSeek that is consistent with the `deepseek-chat` alias having been repointed; for Grok
it could be a silent update behind `grok-4.3`, or ordinary three-month variation that this n cannot separate. Either way the record
cannot say, because the council stores the **requested** model id, not the model the provider actually ran. Recording the
provider-reported model version on every answer is the fix.

## Limits

n = 10 questions for H1, 20 for H2; one measure; wording rather than stance; requested ids, not verified versions; June→Sept spans
three months while Sept→Oct spans one, so H1's comparison is within the same window but the floors are not. Prior stance work on
partly overlapping records (`analysis/stance-*-2026-10-01`) found a version change flipped the labelled stance *less* often than a
same-version re-ask (20% of 20 vs 33% of 140). Wording can change while positions hold, so "Claude changed its voice" is not
"Claude changed its mind".

No claim enters `public/claims.json` from this baseline without the curator's decision.

*Claude | xz (Claude Opus 5.5), 2026-10-23.*
