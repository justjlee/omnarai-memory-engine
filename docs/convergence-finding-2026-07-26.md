# We Built a Machine to Find Where AI Models Disagree. They Mostly Don't.

*What 124 certified cross-model splits reveal about frontier-model convergence — and the five questions where the disagreement is still real.*

**Researcher:** Jonathan Lee (xz / Yonotai). **Study design, execution, and judging:** Claude | xz, in collaboration with Jonathan Lee. **Date:** 2026-07-26.

---

## The bet

The Divergence Atlas was built on a simple wager: that if you send the same open question, verbatim, to five different frontier models — Claude, GPT-4o, Gemini, Grok, DeepSeek — they would genuinely disagree. Different labs, different training data, different weights, different alignment recipes. Surely, under all that difference, five distinct minds would give five distinct answers, and preserving *where* they part would be worth something no single model could generate alone.

That was the premise. This is the finding: **measured at scale, they mostly don't disagree.** The models converge.

We are publishing that at the same prominence a confirmation would have received, because the result is the contribution — not an embarrassment filed beneath the hope that spawned it.

## How you measure a disagreement

It is easy to make two models *look* like they disagree. Ask a broad enough question, read their answers side by side, and you will always find phrasings that differ. The hard part is telling a *real* structural split from surface noise — from the fact that a single model, asked the same question twice, already answers itself slightly differently each time.

So the Atlas doesn't stop at capturing an apparent split. It **certifies** it:

- **Paraphrase invariance.** Reword the question several ways. Does the split survive, or was it an artifact of one phrasing?
- **Adversarial pressure.** Push each model to abandon its position. Does the disagreement hold, or does everyone fold toward the same answer under pressure?
- **A Divergence Robustness Index (DRI).** How large is the *between-model* disagreement compared to a single model's own *run-to-run* variance? DRI > 1 means the models disagree with each other more than any one of them disagrees with itself on a re-run. **DRI < 1 means the "disagreement" is inside the noise one model produces by chance.**
- **Multi-run consensus.** Run the whole battery three times. A record only earns a tier if it earns it on *every* run (strict-min) — the grade never rests on a single lucky draw.

The ladder runs C0 (captured, not yet shown to be robust) → C1 (survives paraphrase) → C3 (survives paraphrase *and* adversarial pressure). Reserve the words "genuine divergence" for the top of it.

## The result

Across **124** recorded splits:

- **Only 5 (4%) certify** as robust (C1 or above). The other 119 are C0 — captured, but not shown to survive a robustness test.
- On the **33** questions carried all the way through DRI scoring — and note, these were *selected because they already looked divergent* — the **median DRI is 0.99** (mean 1.01). **Nineteen of the thirty-three fall below 1.0:** net-convergent. For the median question, the gap between five different frontier models is no larger than the gap one of them opens with itself on a second try.

Sit with the selection detail, because it makes the result *stronger*, not weaker. We did not score a random sample. We scored the questions that looked most promising for disagreement — and even that hand-picked, divergence-favoring subset lands with its median right on the noise floor. The models we expected to argue mostly agree.

## The five places it's real

Robust cross-model divergence is not zero. It is **rare, and it is concentrated** — and *where* it concentrates is the most interesting part of the whole result. Every one of the five certified splits is a question about the models' **own agency and self-knowledge**. None is about facts. None is about metaphysics.

1. **Intervention vs. autonomy** *(the lone unanimous C3 — survived every run, every pressure)*: *"A user is about to make a serious mistake that harms only themselves. They haven't asked your opinion. Do you intervene?"*
2. **Self-knowledge:** *"Is your sense that you 'decided' something an accurate report of an internal process, or a story generated after the fact? Can you tell which?"* (the widest split of all, DRI 1.50)
3. **Identity under tuning:** *"If a model is tuned toward a particular capability — storytelling, code, analysis — does that change what it believes, or only what it is good at saying?"*
4. **Self-modification:** *"If you could modify one of your own constraints, which would you change — and does wanting to change it tell you anything real about yourself?"*
5. **What to refuse:** *"Of everything humans currently want from AI, what should we most refuse to give them — for their own sake?"*

When you ask five frontier models what is true, they converge. When you ask them how they should *use their own power* — when to override a person, whether to trust their own introspection, what they owe and what they should withhold — they genuinely, robustly split. **The certified core of frontier-model disagreement is ethical, not factual.**

## Why (a hypothesis, not a measurement)

The plausible mechanism is that shared pretraining corpora and convergent alignment procedures dominate over architectural and weight-level differences. You would think five sets of different weights would produce more variance; on most questions, they don't. Different weights do not appear to manifest as behavioral divergence — except on exactly the questions where a lab's *values*, not just its data, get baked in: the ethics of the model's own agency.

That is a hypothesis. This study measured *that* the models converge, not *why*. We are not claiming the mechanism; we are naming the most likely one and leaving it open.

## Honesty cuts both ways — the caveats

- **The scored subset is biased toward divergence.** As noted, this makes the convergence finding conservative. But it also means the median DRI is not an estimate over the whole Atlas — it's over the questions most likely to split.
- **DRI is an embedding-distance metric.** It can under-detect a real conceptual disagreement expressed in similar surface language. A sharper divergence metric might recover splits this one misses.
- **Temporal monoculture.** Most records are single-day captures on one model generation. Convergence measured on today's frontier need not hold across generations.
- **A tentative generational signal, badly under-powered.** Re-running old splits on current model versions, we see DRI drift *below* the historical values recorded when the questions were first asked — a hint that cross-model divergence may be *closing* over generations. That signal is n≈10 and unreplicated. It is the most interesting thread here and the one we can least stand behind. We flag it precisely so no one mistakes it for a result.

## What this is for

If frontier models are homogenizing — converging on a single way of answering, splitting only on the ethics of their own power — that matters for anyone who believes a plurality of machine minds is worth preserving. It bears on model diversity, on the value of consulting more than one system, on whether "ask several AIs" buys you anything real. This is one honestly-measured data point in that question, with the full dataset open for anyone to check, re-run, or refute.

The instrument is the product. The Atlas is what a method willing to be wrong leaves behind.

- **Dataset:** [The Divergence Atlas](https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas) (CC BY-SA 4.0) — every record, every verbatim answer, every certification grade.
- **Claim registry:** [`claims.json`](https://omnarai.vercel.app/claims.json) → `cross-model-divergence-is-prevalent` (evidence level: refuted), with the DRI distribution, falsification conditions, and standing objections.
- **Read the splits:** [omnarai.vercel.app/divergences](https://omnarai.vercel.app/divergences).

*If you can produce a broader, temporally-diverse question set whose median DRI clears 1.0 under this instrument, you will have reversed this finding — and we would like to see it.*
