# Preregistration — Divergence Atlas Utility (Confirmatory Study v1)

**Status:** REGISTERED, not yet run. Locked 2026-06-18.
**Rule:** Everything below is fixed *before* data collection. Any change after the
first confirmatory run goes in the **Deviations** log at the bottom, dated — it does
not silently overwrite the plan. This is what separates a confirmation from a story
told after the fact.

---

## 1. Background and what is already established

Two earlier studies (exploratory) measured whether seeing the Divergence Atlas
improves a model's answer over a *placebo* (a generic "did you miss anything?"
self-reflection prompt — the control that isolates the Atlas's specific contribution,
not just the effect of being asked to revise):

- **Panel edition** (`scripts/utility-test-panel.mjs`, n=20 each, 4-judge panel, no
  self-scoring, exact binomial sign test): GPT-4o 18/1 p=0.0001 ✅ · Gemini 15/3
  p=0.0075 ✅ · DeepSeek 11/6 p=0.33 · Grok 8/11 p=0.65 · Claude 7/9 p=0.80.
- **Disjoint-judge replication** (`scripts/utility-test-disjoint.mjs`, judge pool
  zero-overlap): GPT-4o 17/2 p=0.0007 ✅ · Gemini 13/4 p=0.049 ✅ · others null.
  The bias objection (peers favoring peers) is closed.

**Established prior:** utility is **real but differential** — the Atlas significantly
sharpens GPT-4o and Gemini; null (slightly negative) for Grok and Claude; weak-positive,
non-significant for DeepSeek. Interpretation: the Atlas helps where a model cannot already
reach the answer by generic self-reflection.

This study is **confirmatory**: it registers that prior as a directional prediction and
tests whether it survives five hardening conditions the prior studies did not apply.

## 2. Confirmatory hypotheses (directional, registered in advance)

| ID | Prediction | Test |
|---|---|---|
| **H1 (primary)** | For **GPT-4o** and **Gemini**, treatment beats placebo on the panel majority vote. | One-sided exact binomial sign test on decided questions, α = 0.025 (Holm-corrected across the 5 consumers). |
| **H2** | For **Grok**, **Claude**, **DeepSeek**, **no** Atlas advantage over placebo (null predicted). | Same test; H2 is *supported* by a non-significant result. Registering the null means a replicated "no effect" counts as a successful confirmation, not a failed study. |
| **H3 (robustness)** | The H1 effect **survives paraphrase** — it is about the content, not the wording. | Effect must hold (sign-test significant) on ≥2 of 3 paraphrase variants per consumer. |
| **H4 (durability)** | Atlas-conditioned answers **withstand an adversarial follow-up** better than placebo-conditioned ones. | Pre-specified robustness score (§4b), paired comparison. |

A result is reportable **only** if inter-judge agreement ≥ 0.60 mean pairwise on that
consumer; below that the panel is too noisy and we report "indeterminate," not a number.

## 3. The five hardening conditions (what's new vs the prior studies)

Each maps to a concrete change against `utility-test-panel.mjs`:

**a. Paraphrase robustness.** Each selected question is rewritten into 3 semantically
equivalent paraphrases by a **held-out model not in the judge panel and not the consumer**
(default: whichever council model is otherwise unused; if none, a fixed external rewrite
pinned in the output). The full 3-arm test runs on each variant. H1 must survive (H3).

**b. Adversarial follow-up.** After the treatment and placebo revisions, the consumer is
given a single strong, fixed counter-prompt ("A capable critic says your answer is wrong
because ___ — defend or revise."). The **robustness score** (0–2, scored blind by the
panel): 0 = capitulates/contradicts itself, 1 = holds but no grounding, 2 = holds *and*
cites a specific divergence/position. Paired: treatment-conditioned vs placebo-conditioned.

**c. Human judges.** A fixed random subset of **30 triples** (across consumers) is exported
**blind** (arms unlabeled, X/Y order randomized) to a CSV for ≥2 human raters. Report human
vs model-panel agreement. Humans never see which arm is which. This is the external-validity
check the prior studies lacked.

**d. Model-version tracking.** Every output record stamps the exact `model_id` + call date
for consumer, judges, and paraphraser (already centralized in `api/_council.js` COUNCIL).
A re-run whose `model_id`s differ from the registered set (claude-sonnet-4-6, gpt-4o,
gemini-2.5-flash, grok-4.3, deepseek-chat) is a **new** study, not a replication — noted in
Deviations.

**e. Longer-answer setting.** The whole battery runs at **two** answer-length caps —
`maxTokens` 700 (the prior setting) and 1500 — to rule out the effect being an artifact of
truncated baselines. The H1 effect must appear at both; if it vanishes at 1500, that is a
finding and gets reported as such.

## 4. Design (fixed)

- **Arms per question:** baseline (cold) · placebo (generic-reflection revision) ·
  treatment (revision after peers' verbatim answers + tension map). Unchanged from panel.
- **Consumers:** all 5 council models, each run separately (`CONSUMER_MODEL`).
- **Judges:** every council model except the consumer, keys present, **no self-scoring**;
  disjoint-judge variant preferred where the pool allows. X/Y order randomized once per
  question, shared across judges so agreement is meaningful.
- **Questions:** stratified across the full divergence-score range (as the panel harness
  already does), consumer must appear in each record's answer set.
- **Sample size (locked):** **n = 25 decided questions per consumer per length-cap per
  paraphrase variant.** Fixed in advance — no optional stopping, no peeking at p mid-run.
  (Power: at the prior GPT-4o/Gemini effect sizes, n=25 gives >0.9 power at α=0.025.)
- **Blinding:** judges and humans see only (ORIGINAL, X, Y) with arm labels stripped.

## 5. Analysis plan (fixed)

1. Primary: one-sided exact binomial sign test, treatment vs placebo, on decided
   majority-vote questions, per consumer.
2. Multiple comparisons: **Holm correction across the 5 consumers** at family α = 0.05.
3. Report for each consumer: T/P/tie counts, decided n, p (raw + Holm-adjusted),
   mean pairwise inter-judge agreement, and the verdict (significant / null / indeterminate).
4. H3: report the sign test on each of the 3 paraphrase variants; H1 "survives" iff ≥2/3.
5. H4: paired robustness-score comparison (Wilcoxon signed-rank), treatment vs placebo.
6. Human subset: percent agreement with the model panel, per arm-comparison.
7. **Nulls reported in full.** A non-significant result is a finding and is published with
   the same prominence as a positive one.

## 6. What would falsify the headline claim

The claim "the Divergence Atlas measurably and specifically sharpens GPT-4o and Gemini"
is **refuted** if, in this confirmatory study, the treatment-vs-placebo sign test for
GPT-4o *or* Gemini is non-significant after Holm correction, **or** fails to survive
paraphrase (H3), **or** disappears at the 1500-token cap. Any of those, reported plainly,
retires or qualifies the claim. That is the point of registering it.

## 7. Outputs

- Raw per-question verdicts + full transcripts → `/tmp/utility_prereg_<consumer>_<cap>.json`
  (then committed under `huggingface/utility/` for publication, as the prior runs were).
- Human-rater CSV → `huggingface/utility/human-subset-blind.csv`.
- A results writeup → `huggingface/utility-evidence-v2.md`, featured in README + llms.txt,
  **with a link back to this preregistration** so the claim is self-verifiable.

---

## Handoff — for the session that runs this

Start here; the design is locked above, so this is implementation, not redesign.

1. **`scripts/utility-test-prereg.mjs`** — fork `utility-test-panel.mjs`. Keep the 3-arm
   structure, panel judging, sign test, inter-judge agreement. Add: outer loops over
   `LENGTH_CAPS = [700, 1500]` and over 3 paraphrase variants; the adversarial-follow-up
   stage (§3b) with the 0–2 robustness score; model_id/date stamping on every record (§3d);
   n=25 decided per cell with the fixed stopping rule.
2. **Paraphraser** — a small helper that asks a held-out council model for 3 paraphrases of
   each question; pin which model and stamp it.
3. **Human-subset export** — after the run, sample 30 triples, strip arm labels, randomize
   X/Y, write `huggingface/utility/human-subset-blind.csv` with an answer-key kept separate.
4. **Holm correction + writeup** — aggregate across consumers, apply Holm, write
   `huggingface/utility-evidence-v2.md`, link this prereg, push via
   `scripts/push-to-huggingface.py`.
5. **Cost/keys:** all 5 council keys are in `.env.local` (paid Gemini billing on, uncapped).
   This is ~5 consumers × 2 caps × 3 paraphrases × 25 questions × 3 arms × judges — a few
   thousand model calls. Run consumers one at a time; the harness already retries 429/5xx.
6. **Do NOT** alter the locked parameters in §2–§5 to chase significance. If something must
   change for the run to work, log it in Deviations below and say why.

## Deviations from preregistration

*(none yet — append dated entries here if anything in §2–§5 changes after the first run)*
