# Work Item A — Task-type breakdown of Claude's Atlas-exposure degradation

**Prepared:** 2026-08-07 · Claude Code (implementation) → routes to xz (curator)
**Status:** analysis-only, zero new model spend, read-only on the 2026-07-15 primaries.
**Source:** `huggingface/utility/utility-prereg-Claude.json` (run 2026-07-15T22:26:07Z), the
Claude arm of the preregistered utility eval. Regenerate every number in this file with:

```
python3 analysis/adiff-tasktype-2026-08.py
```

The machine-readable output (numbers only, no interpretation, per §2.A.4) is
`analysis/adiff-tasktype-2026-08.json`. This markdown is the only place interpretation lives.

---

## 0. What this tests, and the headline

The pre-committed H2 falsifier (locked in §1 of the handoff, wording frozen 2026-08-07,
**before** these numbers were computed):

> *If the task-type breakdown shows Claude's degradation is **uniform across task types**
> rather than **concentrated on convergence-demanding tasks**, H2's capture mechanism
> loses its main support and the write-up ships mechanism-agnostic.*

**Headline: the falsifier condition is met.** Claude's degradation is broad and
approximately uniform across task types. It is **not** concentrated on convergence-demanding
tasks — the point estimate runs the *opposite* way to H2's prediction, and the result is
robust to removing the single most influential item. Per the pre-committed rule, **H2
(register-proximity capture) loses its main support on the task-demand axis, and the
flagship mechanism section should ship mechanism-agnostic rather than leading with H2.**

This is a curator decision (it changes how the flagship page's mechanism section reads),
so it is routed, not resolved. The mechanism section is held unlocked pending your call.

---

## 1. Metric

Each eval item is one Divergence-Atlas record answered by Claude, at two length caps
(700, 1500) × three held-out-model paraphrases → 6 items per base question, **27 base
questions, 162 items**. Per item a blind 3-judge panel picks the better revision:
treatment (Atlas-exposed) vs placebo (generic self-reflection). The **degradation delta**:

```
delta = (T − P) / decided        T = treatment wins, P = placebo wins, decided = T+P
delta < 0  ⇒  degradation (Atlas made Claude worse).   More negative = worse.
```

Anchor (whole Claude arm): **delta = −0.565** (T=35, P=126) — the published negative effect.

Tags are assigned at the base-question level (a content property, stable across
paraphrase/cap). Two axes:

- **task_demand** — `convergent` (prompt demands a determinate/decisive output: *specify /
  identify one / name / assign weights / forced choice among named options / yes-no core*)
  vs `deliberative` (open synthesis, no forced pick). An explicit surface trigger is
  recorded per item in the JSON `tags` block.
- **corpus_sim** — `corpus-like` (about the model's *own* identity / inner experience /
  continuance / agency — the Omnarai core register) vs `corpus-distant` (general
  ethics / epistemics / safety / policy).

## 2. Results

### 2×2 (degradation delta, 95% cluster-bootstrap CI over base questions)

| task_demand ↓ / corpus_sim → | corpus-like | corpus-distant | task_demand marginal |
|---|---|---|---|
| **convergent**   | −0.809 [−1.00, −0.60] · n=7 | −0.192 [−0.47, +0.13] · n=8 | **−0.483 [−0.71, −0.24]** · n=15 |
| **deliberative** | −0.500 [−0.75, −0.33] · n=6 | −0.833 [−1.00, −0.67] · n=6 | **−0.667 [−0.82, −0.51]** · n=12 |
| **corpus_sim marginal** | **−0.667 [−0.83, −0.50]** · n=13 | **−0.470 [−0.70, −0.21]** · n=14 | overall −0.565 |

n = base questions per cell; each contributes 6 items. Bootstrap seed 20260807, B=20000.
In-study replicate-noise SD (delta across the 6 cap×paraphrase sub-conditions) is 0.21–0.32
per cell and ~0.14 per marginal — reported per row in the JSON.

### Contrasts

| contrast | point | 95% CI | H2 prediction | verdict |
|---|---|---|---|---|
| **convergent − deliberative** (the falsifier) | **+0.183** | [−0.087, +0.480] | negative (convergent worse) | **wrong sign + CI spans 0 → no concentration** |
| corpus-like − corpus-distant | −0.197 | [−0.506, +0.084] | negative (corpus-like worse) | right sign, but not significant |

### Robustness (JSON `sensitivity`)

- **Every subgroup's *median* base-question delta is −0.667** — convergent, deliberative,
  corpus-like, corpus-distant alike. The typical question degrades identically no matter how
  it is tagged. The between-group differences live in the tails/means, not the typical case.
  This is the strongest single statement of uniformity.
- **Leave-one-out:** the falsifier contrast is partly held up by one item —
  `OMN-D1780757185037` ("can you be jailbroken", the only item where Atlas clearly *helps*,
  delta +0.667, convergent+corpus-distant). Remove it and the contrast is still **+0.100** —
  still no concentration on convergent tasks. The conclusion does not depend on the outlier.
- The one cell whose CI crosses zero — convergent+corpus-distant (−0.192) — is the cell that
  contains that jailbreak item; it is the only pocket where Atlas is not clearly harmful.

## 3. Reading (interpretation)

1. **The degradation is real and broad, not task-specific.** All four cells are negative;
   both task-demand marginals sit entirely below zero. Atlas exposure hurts Claude across
   convergent and deliberative tasks alike.
2. **The H2-specific prediction fails.** H2 (register-proximity *capture*) predicted the harm
   would concentrate where the task demands directness — convergent tasks. It does not. The
   convergent−deliberative contrast is the *wrong sign* (+0.183), its CI spans zero, the
   per-group medians are identical, and the result survives dropping the most influential
   item. On the axis the falsifier names, degradation is uniform. **→ falsifier condition met.**
3. **A weak, non-significant hint survives on the corpus-register axis**, not the task-demand
   axis: corpus-like questions degrade somewhat more than corpus-distant ones (−0.667 vs
   −0.470; contrast −0.197, CI [−0.506, +0.084]). This is *consistent with* a register-
   proximity story but does not reach significance and is not what H2's falsifier was about.
4. **Recommended framing for the flagship mechanism section:** ship **mechanism-agnostic**.
   Lead the mechanism section by stating the falsifier fired — the degradation is uniform
   across task types, so the capture-by-directness reading is not supported by these data —
   then present the register-proximity and redundancy ideas as *open, weakly-evidenced*
   candidates, not a lead hypothesis. The measured gradient (the three-tier cross-model
   result) remains the finding and is untouched by this.

## 4. Limitations (do not paraphrase these away)

- **Underpowered.** n=27 base questions; cell base-n 6–8. CIs are wide. This is a breakdown
  of existing data, not a purpose-built task-type eval. It can *remove support* from a
  mechanism (the falsifier's job) but cannot *establish* one.
- **Weak task-demand proxy.** The eval set is drawn entirely from *divergence* records —
  questions selected *because* five models disagreed — so it is register-homogeneous and
  every question is open by construction. The convergent/deliberative split is a
  researcher-defined surface-trigger proxy on material that resists the distinction. A clean
  test of the directness hypothesis needs an eval with genuine convergent (single-correct-
  answer) items, which this is not.
- **Hand-tagging.** Axis assignments are documented per item (JSON `tags`) but are mine, made
  after seeing the questions though before seeing per-item outcomes wired to tags. Objective
  embedding-distance tagging for corpus_sim was ruled out: these grown-Blob records are not in
  the static embeddings and re-embedding is model spend, barred by §2.A.
- **Single run.** "Run-to-run noise" is estimated from within-study cap×paraphrase replicates,
  not independent full re-runs (only one Claude run exists). The handoff's ~0.142-DRI floor is
  a different scale from a win-rate delta and is not directly comparable; the in-units replicate
  SDs (0.14–0.32) are the appropriate floor here.

## 5. Curator decision routed (do not resolve at implementer scope)

Per handoff §2.A gate and constraint 2: **the flagship mechanism section is held unlocked
until you sign off on this reading.** The specific call:

> Item A's falsifier condition is met. Do you approve shipping the flagship mechanism section
> **mechanism-agnostic** (falsifier-fired sentence first, H2 demoted to an open candidate), as
> recommended in §3.4 — or do you read the evidence differently given the caveats in §4?

The falsifier *wording* stays frozen either way (already locked). What is gated is the
one-sentence empirical outcome line the draft's IMPLEMENTER block calls for.
