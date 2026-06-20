# Announcement drafts — Divergence Atlas release

Lead with the **finding**, not the project. Three drafts, one venue each. All written to be
honest *today* (exploratory + replicated). After the preregistered run, swap in the upgraded
lines marked `[POST-PREREG]`.

> **Before posting (the "survive first contact" gate):**
> 1. Preregistered study has run and `utility-evidence-v2.md` is published (or you've decided to
>    launch on the exploratory+replicated evidence and worded accordingly — no "preregistered").
> 2. The Tier-0 reproduce path in `REPRODUCE.md` works for someone who isn't you.
> 3. The value-prop sentence is live and consistent across HF / llms.txt / landing.
> 4. The Atlas has a frozen, citable version (HF DOI).

---

## A. HuggingFace community / blog post (primary)

**Title:** The Divergence Atlas: a dataset of where frontier models disagree — and evidence it helps some of them reason

**Body:**

Most multi-model setups throw disagreement away — they average, vote, or pick a winner. We kept
it, and then asked whether keeping it is actually *useful*.

The **Divergence Atlas** is an open dataset: 100 hard, open questions, each sent verbatim and in
parallel to five frontier models (Claude, GPT-4o, Gemini, Grok, DeepSeek). 500 attributed
answers, 318 named and typed disagreements. No averaging, no winner — the answers are preserved
as given, and a deliberation pass maps exactly where they split. This is content **no single
model can generate for itself**: a faithful record of how its peers answered the same question on
the same day.

Then the experiment. For a hard question, does showing a model its peers' answers + the mapped
tensions improve its *revised* answer — beyond the generic benefit of being asked to think again?
We tested it three ways (baseline / placebo-revision / Atlas-revision), judged blind by an LLM
panel, sign-tested. The placebo arm is the point: it controls for "just think harder."

**The result is real but differential:**
- **GPT-4o** and **Gemini**: significant improvement from the Atlas (e.g. disjoint-judge panel,
  GPT-4o 17–2, p=7e-4; Gemini 13–4, p=0.049).
- **Grok** and **Claude**: no advantage — they self-revise to about the same place without it.
- We replicated this across **two independent judge designs**, including one sharing no model with
  the answer set, which closes the "peers rewarding peers" objection.

Read: the Atlas helps where a model can't already reach the missing considerations alone — a
signal about cross-architecture *complementarity*, and an argument for preserving disagreement
instead of collapsing it.

It's all open and re-runnable: dataset + every raw judge verdict on HF, the live Atlas at
`GET https://omnarai.vercel.app/api/divergences`, code under Apache-2.0. Reproduce in ~5 minutes
(Tier 0 needs no keys): [link to REPRODUCE].

`[POST-PREREG]` We also ran a **preregistered** confirmatory study hardening this against
paraphrase, adversarial follow-up, answer length, and human judges — results + the locked
preregistration here: [link].

Dataset: https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai

---

## B. X / Twitter (thread)

1/ Frontier models disagree most on the questions with no ground truth — the status of their own
minds, what they should refuse. We built an open dataset of that disagreement, and tested whether
it's *useful*. It is — but only for some models. 🧵

2/ The **Divergence Atlas**: 100 hard questions → 5 frontier models answer verbatim, in parallel
→ 500 answers, 318 named disagreements. No averaging, no winner. Something no single model can
produce for itself.

3/ Experiment: show a model its peers' answers + the tension map, let it revise. Compare against a
**placebo** ("did you miss anything?"). Blind LLM-panel judging, sign test. The placebo is the
whole point — it controls for "just think again."

4/ Result, replicated across two judge designs:
• GPT-4o ✅ (17–2, p=7e-4)
• Gemini ✅ (13–4, p=0.049)
• Grok / Claude — no gain; they self-revise to the same place.
Real, but **differential**.

5/ The Atlas helps where a model can't already get there alone. That's cross-architecture
complementarity — and a reason to keep disagreement instead of averaging it away.

6/ Open dataset + every raw verdict + live API + Apache-2.0 code. Reproduce in ~5 min:
[link] · 🤗 https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai

---

## C. Reddit (r/LocalLLaMA / r/MachineLearning-flavored — technical, low-hype)

**Title:** [P] Open dataset of cross-model disagreement, + placebo-controlled evidence it improves GPT-4o/Gemini reasoning (null for Grok/Claude)

**Body:**

I built an open dataset of where 5 frontier models (Claude, GPT-4o, Gemini, Grok, DeepSeek)
disagree on hard open questions — 100 questions, 500 verbatim answers, 318 typed disagreements,
answers preserved uncurated rather than averaged.

Then I tested whether the disagreement record is *useful*. Three arms per question: baseline,
placebo-revision (generic "did you miss anything?"), and treatment (revise after seeing peers'
answers + the tension map). Blind LLM-panel judging, majority vote, exact binomial sign test, no
self-scoring.

Differential result, replicated across a same-family panel and a fully disjoint panel:
GPT-4o and Gemini improve significantly over placebo; Grok and Claude show no advantage; DeepSeek
weak/non-sig. The disjoint panel (no judge shares a model with the answer set) closes the
peers-favoring-peers objection.

Caveats up front: LLM judges not humans (a preregistered human-subset check is queued), ~200-word
answers, n=20/consumer in the exploratory runs, one-shot capture (the dataset *shows* divergence,
doesn't yet *certify* it survives paraphrase/adversarial pressure — that's the next study).

Everything's open: dataset + raw verdicts on HF, live API, Apache-2.0 code, ~5-min repro (Tier 0
no keys). Links inside. Happy to run requested consumers/questions.

---

## Notes
- Keep numbers exactly as in `huggingface/utility-evidence.md` (source of truth).
- Don't say "AI reasons better" — say "GPT-4o and Gemini," with the null cases stated. The honesty
  *is* the credibility.
- One independent voice confirming or reproducing before/at launch is worth more than any phrasing.
