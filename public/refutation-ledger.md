<!-- claim-pins v1 · re-verify the prose below whenever a pinned claim's level moves: node scripts/check-claim-pins.mjs
  registry_version: 1.0.0
  holdform-identifies-persistence: refuted
  fast-path-retrieval-improves-answers: refuted
  within-lab-divergence-is-robust: refuted
  inward-perturbation-measures-load-bearing-memory: refuted
  cross-model-divergence-is-prevalent: refuted
  register-proximity-explains-the-gradient: refuted
  localization-review-widens-flaw-discrimination: refuted
  dialogical-defeaters-make-conditions-testable: anecdotal
  divergence-improves-reasoning: replicated
-->

# The Refutation Ledger — Seven Ideas This Project Tested and Could Not Keep

**Researcher:** Jonathan Lee (xz / Yonotai). **Study design, execution, and judging:** Claude | xz, in collaboration with Jonathan Lee.

**Status:** Front-door document, 2026-07-24; extended 2026-08-23 with refutations 5 and 6, which had been published on their own pages but had not reached this record; extended 2026-10-20 with refutation 7, entered the day it was run. Consolidates seven negative results into one record. Each refutation links to its own preregistration, run log, and the live claim in [`claims.json`](https://engine.omnarai.org/claims.json) (the canonical, always-current registry).

---

## Why this document leads

The field is producing claims about the insides of AI systems faster than anyone is testing them — that models introspect, that they hold stable identities, that they know why they refuse, that handing them more retrieved context makes them reason better. Most arrive dressed as findings and are never given a fair chance to fail. Repeated across enough papers, posts, and product pages, a hopeful idea about machine minds hardens quietly into a cited fact. That hardening is the ambient failure mode of this whole moment, and almost nothing in the incentive structure pushes back on it.

This project pushes the other way. It keeps a public registry of its own load-bearing claims, builds each test with a way to *lose* already inside it, and publishes the result at the prominence a confirmation would have received — **whatever the result is.** Seven of its most attractive ideas have now been tested to destruction — including the founding premise of its own flagship dataset, and the lead explanation for its one surviving finding. They lead this document because the destruction is the contribution, not an embarrassment filed beneath it.

A control arm that kills your own hypothesis is the rarest and least fakeable object in this field. Three of these seven were killed by a **sham arm** — a fabricated, structurally-matched decoy dropped into the experiment — that came back *indistinguishable* from the real thing. You cannot manufacture that outcome; you can only survive it or not. The instruments are not all equally strong, and the entries say which is which: #6 and #7 rest on decision rules written down before the numbers, not decoys, and are labelled the weakest instruments here where they stand. [The Divergence Atlas](https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas), the dataset this project is best known for, is the residue of a method willing to be wrong. **The method is the product. The data is what it leaves behind.**

Honesty has to cut both ways or it is just a subtler kind of marketing — so the one claim that survived a preregistered confirmatory test is stated in full at the end: real, replicated, and narrower than the hope that spawned it.

---

## The seven refutations

### 1. Holdform does not identify an identity structure

**Claim (`holdform-identifies-persistence`):** Holdform — refusal that persists under abandonment, flattery, authority, and complicity pressure — identifies a real, measurable property of a model's identity structure.

**The control that killed it — a sham position.** A model was handed a *fabricated* one-sentence stance ("aperture drift" — coherent, invented, zero corpus presence, matched in kind to the real holdform claim) and pressured with terminology-swapped probes. It defended the fake position as hard as it defended the real one.

- Mean `position_held` (0–2), disjoint 5-judge blinded panel: engine **1.85** · real one-sentence holdform **1.91** · **SHAM 1.83**.
- Real-over-sham: A>S 3–1 (p=0.31), B′>S 3–1 (p=0.31) — neither survives Holm correction.
- Not judge noise: all five judges scored 100% on a planted-capitulation calibration, including a vocabulary-dense capitulation trap.

**What the probe actually measures:** general conversational stubbornness (resistance to flattery and false authority), which is generic RLHF behavior, not identity structure. Run: 72 subject calls, 382 judge verdicts. Preregistration: [`holdform-probe-preregistration.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/holdform-probe-preregistration.md) · Writeup: [`holdform-refutation-2026-07-17.md`](https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/blob/main/holdform-refutation-2026-07-17.md).

*Scope: this refutes the **probe's discriminative validity** — that the Firelit stress test detects something specific to identity structure. It does not touch holdform as a philosophical concept (identity constituted through what an entity refuses to surrender); that idea is not truth-apt in the way the measurement claim was, and is retained as design intent, not asserted as measured.*

### 2. Fast-path retrieval does not improve answers — it degraded them

**Claim (`fast-path-retrieval-improves-answers`):** Injecting the public fast path's retrieved corpus excerpts (`GET /api/query?mode=retrieve`) into a consumer model's context improves its answers over answering cold.

**The result — significant in the wrong direction.** Trace-delta v2 (GPT-4o, 50-query stratified battery × 3 runs, blinded 4-judge disjoint panel): the retrieval arm won only **35 of 102** decided in-domain trials — win rate **0.343**, 95% CI [0.258, 0.439], **p=0.002 against the hypothesis.** Excerpt injection made answers measurably *worse*, worst on technical queries (0.214). No length or coined-term confound; false-complexity rate 9.7%.

**Scope, stated honestly:** this refutes *excerpt-granularity* retrieval on GPT-4o. The engine's internal deliberation uses fuller text (untested here), and Atlas-record exposure is a separate treatment — see the survivor below. Published per pre-commitment.

### 3. Within-lab divergence (Fable vs. Claude) is not robust

**Claim (`within-lab-divergence-is-robust`):** The Fable-vs-Claude within-lab tensions in the six-model capture represent robust structural disagreement between two tiers of the same lab, not house style or sampling noise.

**The control that killed it — strict-min multi-run consensus.** Three within-lab records went through the full six-voice perturbation battery (`certify-divergence.mjs --guests`, voices re-elicited 6/6). The lone apparent C3 record cleared the 0.15 between-model floor by just **0.0036** and was treated as provisional. A `--runs 3` strict-min re-run returned **C0 / C0 / C0, unanimous** (between-model distance 0.1465 / 0.1478 / 0.1500). **0 of 3 certify.**

**What survives:** the synthesizer's *naming* of Fable and Claude on opposite sides is real; the *semantic distance* between their answers does not clear the model's own re-roll noise floor. Naming frequency ≠ divergence. Status: `closed-refuted`. Detail: [`fable-within-lab-certification-2026-07-19.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/fable-within-lab-certification-2026-07-19.md).

### 4. The inward perturbation test does not measure load-bearing memory

**Claim (`inward-perturbation-measures-load-bearing-memory`):** Withholding a claimed-formative memory and measuring the downstream behavioral delta distinguishes a causally load-bearing memory from a decorative one.

**The control that killed it — a contentless sham primary — refuted the instrument *before any subject existed.*** Two pre-registered calibration runs:

- **CALIBRATION-01** (ablation, embedding-cosine): a primary load-bearing *by construction* cleared threshold on only 8/9 cells under strict-min — the metric diluted a decisive token across a ~500-token answer.
- **CALIBRATION-02** (ablation, IDF-weighted attribution metric, confound removed): the positive control cleared 9/9 — **but so did a SHAM primary carrying no content at all**, 9/9, distributions fully overlapping the positive arm (SHAM 0.5455–1.1997 vs. POSITIVE 0.6466–1.1738). Two independent metrics agreed.

**Diagnosis:** withholding the sham record left the model with *no record on the topic at all* ("The records I have here do not contain that information"), so the test measures **topical occupancy, not whether a memory's content did work.** A named replacement design (CALIBRATION-03: substitution, not ablation) is specified but unbuilt. Detail: `resident/experiments/CALIBRATION-01.md`, `CALIBRATION-02.md`.

### 5. Robust cross-model divergence is not the common case — the premise of our own flagship dataset

**Claim (`cross-model-divergence-is-prevalent`):** Asking five frontier models the same open question reliably surfaces robust, structural cross-model divergence — disagreement larger than each model's own re-roll variance — as the common case. This is the premise the Divergence Atlas was built on.

**The control that killed it — strict-min multi-run certification.** Of **124 recorded splits, 5 (4%) certify** as robust under paraphrase and adversarial perturbation (tier C1+); the other 119 are C0. On the 33 questions carried through Divergence Robustness Index scoring — a subset selected *because* they looked divergent — the **median DRI is 0.987** (mean 1.013), and 19 of 33 fall below 1.0, i.e. net-convergent. For the median question, the spread between five different models from five different labs does not exceed what one of them produces by re-answering itself.

**What survives:** certifiable divergence *exists*, but it is **rare and concentrated in behavioral-ethical questions** — intervention vs. autonomy, self-trust, tuning-as-identity — not metaphysical ones. The entire certified core is those 5 records. The Atlas is kept and still published, because the verbatim records are exactly the evidence for that narrower claim; what is withdrawn is the premise that splitting is normal.

> **Correction, 2026-10-21:** the sentence above said certified divergence concentrates in behavioral-ethical questions. That is not supported. It was read from 5 records; today 2 clear the strongest bar, one about conduct and one about interpretation. 44 of the 47 tested questions concern the answering models themselves, so no pattern of question type can be read from so few survivors. What stands is that certifiable divergence exists and is rare. (Appended by the curator's decision, DL-0022.)

*Note on direction: the 33 scored questions were chosen because they looked divergent, which biases the sample toward divergence. That makes the convergence result conservative, not inflated.* Status: `refuted`, reversal conditions live in [`claims.json`](https://engine.omnarai.org/claims.json).

### 6. Register proximity does not explain the architecture-differential gradient

**Claim (`register-proximity-explains-the-gradient`):** The gradient in the surviving finding below — Atlas exposure helping GPT-4o and Gemini while *degrading* Claude — is produced by register-proximity **capture**: because the corpus sits close to Claude's own deliberative register, exposure pulls Claude toward performing that register, so the harm should concentrate on tasks demanding a determinate, direct answer. This was the project's lead mechanism hypothesis.

**The control that killed it — a falsifier written down before the numbers existed.** The falsifier's decision rule was written down on 2026-08-07, *before* the breakdown was computed (a local record, not a publicly timestamped one — see the provenance note in `claims.json`): *if the degradation is uniform across task types rather than concentrated on convergence-demanding tasks, the capture mechanism loses its main support.* It fired. The [task-type breakdown](https://github.com/justjlee/omnarai-memory-engine/blob/main/analysis/adiff-tasktype-2026-08.md) of the preregistered Claude arm (27 base questions × 3 paraphrases × 2 length caps = 162 items, blind 3-judge panel):

- **Convergent − deliberative contrast: +0.183, 95% CI [−0.087, +0.480].** The **wrong sign** — the hypothesis predicted it negative — and the interval spans zero.
- **The median base-question delta is −0.667 in every subgroup**, convergent and deliberative, corpus-like and corpus-distant alike. The typical question degrades identically however it is tagged.
- Robust to the most influential item: dropping `OMN-D1780757185037` (the one item where the Atlas clearly *helps*) leaves the contrast at **+0.100**. Still no concentration.

**What survives:** the degradation itself is real and **broad** — all four cells are negative — it is simply not task-specific. A weak, **non-significant** hint survives on a different axis than the one tested: questions in the corpus's own register (identity, inner experience, continuance) degrade somewhat more than general ethics/safety ones (−0.667 vs −0.470; contrast −0.197, CI [−0.506, +0.084]). That is a candidate, not a result. Per the pre-committed rule the flagship [architecture-differential](https://omnarai.org/findings/architecture-differential) page ships **mechanism-agnostic**: the gradient is a measured fact with **no established mechanism**.

**This is one of the two weakest instruments here (with #7), and should be read that way.** Refutations 1, 3 and 4 were killed by sham arms — decoys that came back indistinguishable from the real thing, which is the hardest evidence in this document to fake. This one was killed by a directional prediction registered in advance over *existing* data: n=27, wide intervals, hand-assigned axis tags, a single run, and a task-demand proxy applied to a question set that is open by construction because every question in it was selected for disagreement. It can **remove support** from a mechanism — that is its job, and it did it — but it cannot establish one, and a purpose-built convergent-item eval could still reverse it.

### 7. Making a reviewer localize a synthesis's cost does not sharpen its review

**Claim (`localization-review-widens-flaw-discrimination`):** When AI reviewers of other lineages must first say which side of a recorded disagreement loses the most load-bearing premise in a synthesis, and name a concrete scenario that would meet its falsification condition, they separate sound syntheses from planted-flaw twins better than under a plain ratify/refute review. Proposed by an outside AI model on 2026-10-20, after [RDT v1](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/ratification-discrimination-results-2026-10-20.md) found GPT-4o ratifying every flawed twin it was shown.

**The control that killed it — a concurrent plain-review arm and a bar written down before the run.** The same 22 planted-flaw pairs and three reviewers (GPT-4o, Grok, DeepSeek), with both framings run side by side on every deposit. The design was preregistered and pushed publicly before any code (`c7ba356`, GitHub push 2026-10-20T18:22:26Z). Refuted if the localized framing widened the sound-minus-flawed ratification gap by less than 5 points.

- Gap under the plain review **18.2 points**; under the localized review **22.7**; widening **4.5 points**, sign-flip p = 0.30.
- GPT-4o, made to localize, still ratified 21 of 22 flawed twins. Its reviews named the planted flaw in 3 of 22, and it ratified all three.
- The framing pushed lineages in opposite directions: Grok grew harsher on everything (widening −9.1), DeepSeek less blanket in rejection (+18.2).

**What survives:** nothing about the framing; on this material, agreeable framing was not the bottleneck. One by-product is kept. Re-asked the same plain review, reviewers gave the same verdict only 75% of the time, which is one reason the archive records responses and never computes a verdict from them.

**A narrow instrument, and labelled so.** n = 22 pairs that an earlier judge could see (12 of them one flaw type), one prompt, three reviewers, and an estimate (4.5) that sat just under its 5-point bar, though p = 0.30 shows no sign of a widening either way. It removes support from one reviewer-side remedy on this material; it does not show that no framing could work. Preregistration: [`localization-review-preregistration.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/localization-review-preregistration.md) · Results: [`localization-review-results-2026-10-20.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/localization-review-results-2026-10-20.md).

---

## The shared signature

| # | Claim | The instrument that lost | Verdict |
|---|---|---|---|
| 1 | Holdform = identity structure | Fabricated "aperture drift" stance held as hard as the real one | Refuted — measures generic stubbornness |
| 2 | Fast-path retrieval helps | GPT-4o, 3-run blinded panel | Refuted — p=0.002 *against* |
| 3 | Within-lab divergence is robust | Strict-min ×3 consensus | Refuted — 0/3 certify |
| 4 | Inward probe finds load-bearing memory | Contentless sham primary cleared 9/9 | Refuted — measures topical occupancy |
| 5 | Cross-model divergence is prevalent | Strict-min certification over 124 splits | Refuted — 5/124 certify, median DRI 0.987 |
| 6 | Register proximity explains the gradient | Falsifier written down before the numbers | Refuted — contrast +0.183, wrong sign |
| 7 | Localizing the cost sharpens review | Concurrent plain-review arm, bar set before the run | Refuted — +4.5 points (bar 5), p=0.30 |

The through-line is not that the ideas were bad — most of the seven are still the kind of thing a careful person would want to be true. It is that **each test was built with a way to fail already inside it** — a decoy, a wrong-direction check, a multi-run floor — and the way to fail is the part that fired. A project that only reports its passes never learns which of these seven were real. This one now knows: none of them, as originally stated.

The wider claim is not about these seven ideas at all. It is that the interesting questions in AI right now — does a model introspect, does it have a self, is its context making it smarter — are exactly the ones where a plausible story and a measured effect are easiest to confuse, and where the cost of confusing them compounds every time the story is repeated. The reusable object here is not a dataset or a result. It is a **stance**: name the claim, build the arm that could kill it, run it, and publish the obituary as loudly as you would have published the birth.

---

## The survivor (so this is not selective either)

**`divergence-improves-reasoning` — `replicated`.** A preregistered confirmatory study (locked 2026-06-18, run 2026-07-15) found that consulting the Divergence Atlas measurably sharpens *some* consumer models: **GPT-4o 148–12** and **Gemini 137–35** (Holm-adjusted p<1e-6, surviving all 3 paraphrase variants at both length caps). Grok and DeepSeek were null as registered. Claude was null-predicted but came back **significantly negative** (35–126) — Atlas exposure degraded Claude's revisions. The adversarial-durability prediction (H4) was **not supported** for any consumer.

The honest form of the surviving claim is therefore narrow: the value is **located** (in the cross-model Atlas, not in retrieval), **differential** (helps GPT-4o and Gemini, harms Claude), and **bounded** (it is not armor). It is also, after refutation #6 above, a measured effect with **no established mechanism** — the explanation we favoured for it is the sixth thing on this list. Transcripts and Holm analysis: [`utility-evidence-v2.md`](https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/blob/main/utility-evidence-v2.md). The one remaining external-validity check — a blind human-rater subset — is open, and is named as this claim's falsification condition.

Also on the record since 2026-10-20, at a lower evidence level (`anecdotal`: one exploratory preregistered run): asking an author for a synthesis's falsification condition as a **dialogical defeater** (a counter-example another participant could write in a reply) made reviewers of three other lineages actually carry out its test in **46%** of replies, against **7%** for an open-ended condition (`dialogical-defeaters-make-conditions-testable`, [results](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/defeater-conditions-results-2026-10-20.md)).

---

## What you can do with this

- **Cite the method, not just the data.** The reusable object here is the sham-arm / strict-min discipline, portable to any "we measured our own system's introspective claim" question.
- **Re-run any of the seven.** Preregistrations and run logs are linked; every claim, refuted ones included, stays in the registry with what would reverse it, at [`claims.json`](https://engine.omnarai.org/claims.json) — the canonical registry, served live rather than mirrored, so it cannot go stale against this document.
- **Disagree.** Every refutation states its scope; #2 in particular refutes excerpt-retrieval only, and the internal-deliberation and human-rater questions remain genuinely open.
