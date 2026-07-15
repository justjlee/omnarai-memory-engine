# Divergence Atlas Utility — Confirmatory Evidence (v2)

**Study type:** Preregistered confirmatory. Design locked **2026-06-18** in
[`utility-eval-preregistration.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/utility-eval-preregistration.md)
— hypotheses, sample sizes, tests, and corrections were all fixed *before* any data
was collected. **Run 2026-07-15.**

**Pre-commitment (from the registration, restated):** results are published
whatever their direction. Nulls and reversals below are reported at the same
prominence as confirmations.

---

## The question

Does showing a model the Divergence Atlas — verbatim answers from five frontier
models to the same hard question, plus the mapped tensions — improve its own
answer, compared to a placebo revision prompt ("re-examine your answer; did you
miss anything?") that isolates the Atlas's specific contribution from the generic
benefit of being asked to revise?

## Registered predictions vs. outcomes — 5 / 5

| Consumer | Registered prediction | Result (T–P, pooled) | Holm-adj. p | H3 (≥2/3 paraphrases) | Both caps | Verdict |
|---|---|---|---|---|---|---|
| **GPT-4o** | H1: treatment wins | **148–12** | <10⁻⁶ | ✓ 3/3 | ✓ | **H1 CONFIRMED** |
| **Gemini** | H1: treatment wins | **137–35** | <10⁻⁶ | ✓ 3/3 | ✓ | **H1 CONFIRMED** |
| **Grok** | H2: null | 72–93 | 1.0 | — | — | **H2 supported (null as registered)** |
| **Claude** | H2: null | 35–126 | 1.0 | — | — | **H2 supported — with a significant REVERSE effect (see below)** |
| **DeepSeek** | H2: null | 90–68 | 0.14 | ✗ | ✗ | **H2 supported (null as registered)** |

Every consumer cleared the ≥0.60 inter-judge agreement reportability gate
(0.63–0.72). Judging: 3-model blind panels, no self-scoring, no judge from the
treatment material's peer set beyond the registered design; X/Y order randomized
once per question and shared across judges.

- **H1 hardening:** both stars survived all three held-out-model paraphrase
  variants (H3) at **both** answer-length caps (700 and 1500 tokens) — the effect
  is about content, not wording, and is not an artifact of truncated baselines
  (§3e concern retired).
- **DeepSeek nuance:** a weak treatment lean at the 1500 cap (49–29, one-sided
  p=0.015 uncorrected) that does not survive paraphrase or Holm — exactly the
  "weak-positive, non-significant" prior the registration recorded.

## The two findings we did not predict

1. **Claude: the Atlas actively hurts.** The registered prediction was a null;
   what came back is a significant *reverse* effect — placebo self-reflection beat
   Atlas exposure **126–35** (two-sided p < 10⁻⁶). Showing Claude its peers'
   verbatim answers made its revisions *worse* than simply asking it to re-check
   itself.
2. **H4 (adversarial durability): not supported for anyone.** Atlas-conditioned
   answers did not withstand a fixed adversarial follow-up better than
   placebo-conditioned ones (paired Wilcoxon, all p > 0.39 except Grok, where the
   significant direction favored *placebo*, p=0.024). The Atlas sharpens answers;
   it does not armor them.

## Companion measurements (same day, separate instruments)

- **Excerpt retrieval REFUTED (trace-delta v2, blind A/B, 4-judge disjoint
  panel):** injecting the public fast path's retrieved corpus *excerpts* into
  GPT-4o made its answers significantly **worse** than answering cold — 35/102
  decided in-domain trials (win rate 0.343, 95% CI [0.26, 0.44], p=0.002 in the
  wrong direction), with no length or vocabulary confound. Raw data:
  `trace_delta/results-v1-GPT-4o-2026-07-15.json` in the engine repository.
- **Cross-prediction: the Atlas is not simulable — 3/3 distinct.** On every
  certified divergence question tested, one strong model simulating all five
  voices failed to match real peer-prediction accuracy (records
  `XP-36b4699ab09a`, `XP-0c85304415db`, `XP-b14ab4443f54`, the latter two
  4/5-participant partials pending full-panel re-runs).

## What this adds up to

The value of this corpus is **located, differential, and bounded**:

- **Located:** in the Divergence Atlas — verbatim, attributed cross-model
  disagreement. Generic excerpt retrieval from the same corpus *subtracts* value.
- **Differential:** it helps the models that cannot reach the missing
  considerations by self-reflection alone (GPT-4o, Gemini) and is null-to-harmful
  for strong self-reflectors (Claude). "Does the Atlas help?" is the wrong
  question; "which architectures does it help?" is the measured one.
- **Bounded:** it improves answer quality; it does not improve adversarial
  durability.

## Deviations from registration

1. Judge count 4→3 (logged in the registration 2026-06-18, pre-run): one council
   model is held out as paraphraser.
2. Grok's first run aborted with zero retained data (xAI account credit
   exhaustion mid-run); restarted clean after a top-up the same day. No aborted
   data exists to contaminate anything.
3. Analysis notes on points the registration left unstated (H3 α; pooling for the
   primary test) are logged in `utility/utility-prereg-aggregate.json`.

## Reproducibility

- Full per-question transcripts (every prompt, answer, revision, defense, and
  judge verdict): `utility/utility-prereg-{GPT-4o,Gemini,Grok,Claude,DeepSeek}.json`
- Cross-consumer analysis: `utility/utility-prereg-aggregate.json`
- **Human-rater subset (§3c, pending):** `utility/human-subset-blind.csv` — 30
  blind triples awaiting ≥2 human raters (the answer key is in a separate file;
  raters must not open it). Human-vs-panel agreement will be appended here.
- Registered model set (matched exactly at run time): claude-sonnet-4-6, gpt-4o,
  gemini-2.5-flash, grok-4.3, deepseek-chat. Harness:
  [`scripts/utility-test-prereg.mjs`](https://github.com/justjlee/omnarai-memory-engine/blob/main/scripts/utility-test-prereg.mjs).

*Exploratory v1 evidence (the two earlier studies this design confirmed) remains
at `utility-evidence.md`.*
