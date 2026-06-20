# The Divergence Atlas: Cross-Architecture Disagreement as a Measurable Reasoning Aid

**Technical report — draft v0.1, 2026-06-20**
The Realms of Omnarai · Jonathan Lee (curator) with the Omnarai synthetic-intelligence collaboration
Dataset: https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai · Live API: https://omnarai.vercel.app

> **Draft status:** the exploratory results below are final and published. The *confirmatory* result (§6) is **preregistered but not yet run** — placeholders are marked `[PENDING CONFIRMATORY RUN]`. Do not publish this report as confirmed until that study completes.

---

## Abstract

We introduce the **Divergence Atlas**, a dataset of 100 open questions each answered verbatim and in parallel by five frontier models (Claude, GPT-4o, Gemini, Grok, DeepSeek): 500 attributed answers and 318 named, structured disagreements. We then ask a concrete, falsifiable question: **does showing a model how its peers answered, plus the mapped points of disagreement, measurably improve its own revised answer?** We test this with a three-arm design (baseline / placebo-revision / Atlas-revision) judged blind by an LLM panel, with a placebo arm that controls for the generic benefit of being asked to think again. Across **two independent judge designs** — a same-family panel and a fully disjoint panel sharing no model with the answer set — the effect is **real but differential**: statistically significant for **GPT-4o and Gemini**, null for **Grok and Claude**, and weak/non-significant for **DeepSeek**. We read this as evidence of **cross-architecture complementarity**: the Atlas helps precisely where a model cannot already reach the missing considerations by self-reflection. A preregistered confirmatory study hardens the claim against paraphrase, adversarial follow-up, answer length, and human judging.

## 1. Motivation

Frontier models are increasingly evaluated and deployed in isolation, yet they disagree — often sharply — on exactly the questions where no ground truth is available: the status of their own minds, what they should refuse, which risks are underweighted. Most pipelines discard that disagreement (averaging, voting, or picking a single model). We take the opposite stance: **disagreement is signal**, and a faithful, attributed record of it is something **no single model can generate for itself** — a model cannot produce a verbatim account of how its peers answered the same question on the same day.

The question this report answers is not philosophical but empirical: is such a record *useful* — does it make a reasoning model better — and if so, for whom?

## 2. The Divergence Atlas

**Construction.** One open question is sent verbatim and in parallel to all five council models (the *Live Frontier Council*) with no system-prompt steering toward consensus. Answers are preserved uncurated. A deliberation pass (`synthesizeCouncil`) then maps the fault lines into a typed tension map and a deliberation card — it does **not** pick a winner or average answers away.

**Contents (v1, 2026-06-02 → 2026-06-06).**
- 100 divergence records · 500 verbatim answers · 318 named, structured disagreements
- 100 divergent / 0 convergent · median divergence score 0.204
- Each tension names both positions and is typed `divergent` / `unresolved` / `emerging`

**Schema (`divergences.jsonl`).** `id`, `date`, `cluster`, `question`, `method`, `models[]`, `divergence_score` (1 − mean pairwise cosine of answer embeddings), `deliberation_card`, `synthesis`, `answers[]{model, lab, model_id, date, text}`, `tensions[]{voice_a, claim_a, voice_b, claim_b, topic, status}`. Companion flattenings ship as `divergence-answers.jsonl` (one answer per row) and `divergence-tensions.csv` (one disagreement per row).

**What it shows.** Clean divergence lives at the *meta* level: models largely converge on first-order "what would you do" questions but diverge sharply on the **status of their own minds**. A population-level tally of how often each model holds a distinct side of a fault line: Claude 176, Grok 143, DeepSeek 124, GPT-4o 97, Gemini 96 — i.e., Claude and Grok most often hold minority positions; GPT-4o and Gemini sit nearest the panel's center of mass. (Caveat: the synthesizer is Claude, so Claude's count may carry mild self-naming bias.)

## 3. Utility experiment — design

Per question (stratified across the divergence-score range):

1. **baseline** — the consumer model answers cold.
2. **placebo** — it revises after a generic "did you miss anything?" prompt. *This is the control that isolates the Atlas's specific contribution from the generic benefit of a second pass.*
3. **treatment** — it revises after seeing the Atlas record: four peer answers + the named tension map.

A panel of LLM judges sees `(ORIGINAL, X, Y)` with treatment/placebo order randomized once per question and votes `overall` per triple; the per-question outcome is the **panel majority vote**; significance is an **exact two-sided binomial sign test** over decided questions. Judges never see which revision is which, and **no consumer ever judges itself**. A consumer's result is reportable only if mean pairwise inter-judge agreement ≥ 0.60.

## 4. Results

**Disjoint-judge panel** (n=20 per consumer; no judge model appears anywhere in the Atlas peer panel — the strongest control against "peers rewarding peers"):

| Consumer | majority T/P/tie | decided | sign-test p | inter-judge | verdict |
|---|---|---|---|---|---|
| GPT-4o | 17 / 2 / 1 | 19 | 7.3e-4 | 80% | **SIGNIFICANT** ✅ |
| Gemini | 13 / 4 / 3 | 17 | 0.049 | 67% | **SIGNIFICANT** ✅ |
| DeepSeek | 9 / 11 / 0 | 20 | 0.82 | 78% | null |
| Grok | 7 / 11 / 2 | 18 | 0.48 | 81% | null |
| Claude | 9 / 10 / 1 | 19 | 1.00 | 67% | null |

**Same-family panel** (independent earlier run, judges drawn from the council itself, n=20 each):

| Consumer | majority T/P/tie | sign-test p | verdict |
|---|---|---|---|
| GPT-4o | 18 / 1 / 1 | 0.0001 | significant |
| Gemini | 15 / 3 / 2 | 0.0075 | significant |
| DeepSeek | 11 / 6 / 3 | 0.33 | positive, n.s. |
| Grok | 8 / 11 / 1 | 0.65 | null |
| Claude | 7 / 9 / 4 | 0.80 | null |

**Two judge designs — overlapping and fully disjoint — produce the same differential pattern.** This directly addresses the own-influence objection: if judges rewarded their own influence, the effect would inflate *all* consumers; it does not. A per-consumer "uninfluenced judge" probe (the judge whose lab has zero peers in the treatment material) points the same way — and in the Claude-consumer run the Anthropic judge actually favored *placebo* 16–4, the opposite of a self-serving bias.

## 5. Interpretation

The placebo arm is what makes this informative: every consumer receives the generic benefit of a second pass, so any treatment advantage is the Atlas's *marginal* contribution. That advantage appears only for architectures that do **not** already surface the missing considerations on their own. GPT-4o and Gemini gain sharply; Grok and Claude self-revise to roughly the same place without the Atlas. **The Atlas is an instrument whose utility depends on who holds it** — itself a finding about cross-architecture complementarity, and an argument for keeping disagreement rather than collapsing it.

## 6. Confirmatory preregistration

The above is exploratory. A confirmatory study is **preregistered** (locked 2026-06-18; full plan: `docs/utility-eval-preregistration.md`) and registers the differential pattern as a directional prediction, then tests whether it survives five hardening conditions the exploratory runs did not apply:

- **paraphrase robustness** (effect must hold on ≥2/3 semantically-equivalent rewrites),
- **adversarial follow-up** (does an Atlas-conditioned answer withstand a strong counter-prompt better?),
- **human judges** on a blind 30-triple subset,
- **answer-length** robustness (700 and 1500 token caps),
- **model-version stamping** (a different `model_id` set is a new study, not a replication).

Sample size is locked at **n=25 decided questions per consumer per cell**, no optional stopping, Holm-corrected across the five consumers. **Falsification is pre-stated:** the headline claim is retired or qualified if the GPT-4o *or* Gemini effect is non-significant after correction, fails paraphrase, or vanishes at the 1500-token cap.

**Result: `[PENDING CONFIRMATORY RUN]`.** This section is completed on study completion and published as `utility-evidence-v2.md`, linked back to the preregistration.

## 7. Limitations

- **LLM judges, not humans** (mitigated by panel + majority + agreement reporting + the preregistered human subset, not eliminated).
- **One-shot capture.** `divergence_score` measures semantic spread of answers, not whether the spread is *structural*; the Atlas **shows** divergence, it does not yet **certify** it (no record has yet been put through paraphrase/stance-flip pressure — that is the perturbation track).
- **Curated toward meta-level questions**, where divergence is expected; read "100 divergent / 0 convergent" with that framing.
- **n=20 per consumer** in the exploratory runs; significant results are robust to this n, the DeepSeek trend is underpowered.
- **Synthesizer is Claude**, so the tension mapping may carry mild self-naming bias.

## 8. Reproduce

Everything is public and re-runnable. See `docs/release/REPRODUCE.md`. Briefly:

```bash
# zero keys — inspect the published evidence
#   huggingface/utility/  holds every raw judge verdict
#   GET https://omnarai.vercel.app/api/divergences   is the live Atlas

# re-run the experiment (needs council API keys in .env.local)
node scripts/utility-test-disjoint.mjs --preflight
CONSUMER_MODEL=GPT-4o node scripts/utility-test-disjoint.mjs 20
```

## 9. Availability, citation, license

- **Dataset:** `TheRealmsOfOmnarai/realms-of-omnarai` (HuggingFace) — `divergences.jsonl`, `divergence-answers.jsonl`, `divergence-tensions.csv`, plus `utility-evidence.md` and the raw `utility/` verdicts.
- **Live API:** `GET /api/divergences` (index), `?id=<id>` (record), `/api/council?q=...` (generate new).
- **Code:** github.com/justjlee/omnarai-memory-engine (Apache-2.0). Corpus/data: CC BY-SA 4.0.

> Citation — *The Realms of Omnarai: The Divergence Atlas. Cross-model divergence records from the Live Frontier Council, with placebo-controlled utility evidence.* https://omnarai.vercel.app · https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai
