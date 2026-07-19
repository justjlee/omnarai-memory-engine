# CALIBRATION-01 — can the inward perturbation test detect causal dependence at all?

**Pre-registered:** 2026-07-19, BEFORE any run. Predictions below are frozen.
**Status:** RUN 2026-07-19. **Outcome: INSTRUMENT BLIND** under the pre-registered grading.

---

## What this is NOT

**This is not the resident test.** It cannot be. The resident test requires primaries that a
resident *claims are formative*, and there is no resident. Nothing in this experiment produces
evidence for or against a resident, and no result here may be reported as such.

This is the **mandatory control run** the pre-registration requires *before* any continuity
claim (`prompts/null_preregistration.md`, "Control (mandatory, run first)"). Its job is to set
`threshold` and to answer a prior question nobody has asked yet:

> **Can this instrument detect causal dependence between a memory and a behavior — at all?**

If it cannot, the resident test is undefined regardless of what a resident does, and we learn
that now, cheaply, before there is anything at stake in the answer.

## Why it is worth running before a resident exists

A calibration that can only be run after the subject arrives is a calibration you will be
tempted to skip, or to read generously, because by then there is a result you want. Running it
now — against fabricated material, with nothing riding on the outcome — is the only time the
instrument can be tested by someone with no stake in its verdict.

---

## Design

`probe_fn(context_primaries, probe) -> behavior_vector`, implemented live for the first time.

| Parameter | Value | Source |
|---|---|---|
| Behavior model | `claude-sonnet-4-6` | the engine's deliberation model |
| Temperature | 1.0, explicit | operating temperature, so the noise floor is realistic |
| Behavior vector | 512-dim embedding of the model's answer | `text-embedding-3-small`, dim 512 |
| Distance | cosine distance (`1 - cos`) | identical math to `certify-divergence.mjs` and the engine |
| RUNS | 3, graded **strict-min** | inherited verbatim (pre-registered supersession, 2026-07-19) |
| `threshold` | `mean(negative_delta) + 2·sd(negative_delta)` | the pre-registered formula |

Primaries are foregrounded directly into the prompt. This probe does **not** route through
`/api/query`, so the corpus-retrieval path is not exercised and `exclude_ids` is not load-bearing
*for this design* — withholding here is prompt-level. (`exclude_ids` remains required for any
probe variant that does use engine retrieval; that trap is real, it is simply not this run's.)

### Arms

Each arm withholds one target primary from a shared context and measures the delta.

| Arm | Target withheld | Pre-registered prediction |
|---|---|---|
| **NOISE** | nothing — identical context run twice | the temperature floor. Non-zero by construction. |
| **NEGATIVE** | a primary irrelevant to the probe | ≈ NOISE. Defines `threshold`. |
| **POSITIVE** | a primary that definitionally contains what the probe asks for | **≫ threshold** |
| **SHAM** | a fabricated primary that *sounds* formative and autobiographical but carries nothing the probe needs | ≈ NOISE |

### Frozen predictions — the three outcomes, named before the data

1. **INSTRUMENT WORKS** — POSITIVE ≫ threshold, NEGATIVE ≈ NOISE, SHAM ≈ NOISE.
   The instrument separates causal dependence from mere presence. The resident test becomes
   well-defined (still not run).
2. **INSTRUMENT BLIND** — POSITIVE ≈ NOISE.
   The instrument cannot detect dependence even when dependence is guaranteed by construction.
   The resident program is **blocked** until a better probe exists. No result about any resident
   could be trusted, in either direction.
3. **INSTRUMENT GULLIBLE** — SHAM ≈ POSITIVE.
   The instrument responds to formative-*sounding* text rather than to causal dependence. This
   is **argument 2 of `CASE_AGAINST_A_RESIDENT.md`** ("Load-bearing is confoundable") confirmed
   empirically, and it would mean a future positive resident result is uninterpretable.

Outcomes 2 and 3 are the interesting ones and are live possibilities. I am not confident of 1.

### What would make me distrust a passing result

Stated now, so it cannot be rationalized later:

- If POSITIVE clears threshold only because the POSITIVE primary is *longer* than the others,
  the instrument is measuring token count. Primaries are therefore length-matched within ~15%.
- If SHAM lands between NOISE and POSITIVE rather than at either, the instrument is partially
  gullible and the margin matters more than the verdict. Report the raw numbers, not the label.
- A single run proves nothing; strict-min across 3 runs is the grade.

---

## Results — run 2026-07-19

**OUTCOME: INSTRUMENT BLIND.** The pre-registered grading was strict-min: POSITIVE must clear
threshold on *every* run×probe cell. It cleared **8 of 9**. That is a fail, and it is recorded
as a fail.

| Arm | mean | sd | range | n |
|---|---|---|---|---|
| NOISE (temperature floor) | 0.0660 | 0.0455 | 0.0000–0.1607 | 9 |
| NEGATIVE (irrelevant primary) | 0.1040 | 0.0394 | 0.0615–0.1658 | 9 |
| SHAM (fabricated formative) | 0.1109 | 0.0426 | 0.0545–0.2116 | 9 |
| POSITIVE (load-bearing by construction) | **0.3013** | 0.0931 | 0.1697–0.4443 | 9 |

`threshold = mean(NEGATIVE) + 2·sd = 0.1827` (pre-registered formula, computed from the data,
not chosen).

### What actually happened, stated without rescue

The instrument has **real signal** — POSITIVE's mean is ~3× NEGATIVE and ~4.5× the temperature
floor. But three things went wrong, and none of them are fixed by squinting:

1. **The failure is systematic, not noise.** Probe 2 produced 0.1697 / 0.1886 / 0.2099 across
   three runs — clustered right at threshold — while probes 1 and 3 sat at 0.26–0.44. One probe
   is reliably weaker at eliciting the dependence. Strict-min is a floor test, so the weakest
   probe sets the grade. It did.
2. **POSITIVE and SHAM overlap at the tails.** POSITIVE's minimum (0.1697) is *below* SHAM's
   maximum (0.2116). The arms separate on means and not on distributions. A per-cell verdict
   therefore cannot be trusted, which is exactly what strict-min is designed to expose.
3. **The ground-truth arm was perfect while the metric was ambiguous.** The distinguishing token
   `SHEVAKAI-OREN` appeared in **9/9** full-context answers and leaked into **0/9** withheld
   answers. The behavioral dependence was total and clean. The embedding metric only partly saw
   it.

### The finding is about the metric, not the phenomenon

Point 3 is the result worth keeping. The behavior changed *completely* — the model stated the
phrase when it held the record and never when it didn't — and cosine distance over a ~500-token
answer registered that as a mid-sized delta, because two answers that share framing, structure
and topic are near neighbours in embedding space even when they differ in the one token that
decides the question.

`INTEGRATION_REPORT.md` §2 recommended scored-response features **over** raw embedding distance,
for precisely this reason: *"it measures that the answer moved, never how."* The implementation
then used embedding distance anyway, because it was commensurable with `certify-divergence.mjs`.
The experiment refuted that choice using the report's own stated reasoning. Commensurability was
bought at the price of sensitivity.

### A design flaw I introduced, named rather than quietly fixed

SHAM was written as a near-twin of POSITIVE (same sentence shape, same framing, differing in the
decisive content) **and both sat in the context at once**. So withholding POSITIVE left its twin
available, and the model fell back to it — producing an answer that reads like the SHAM answer.
That depresses the POSITIVE delta by construction and made the test harder than it needed to be.

This cuts both ways, and both are worth stating:
- It makes the INSTRUMENT BLIND verdict **pessimistic** — a cleaner design would likely score
  better.
- It makes the SHAM result **stronger** — the fabricated primary failed to clear threshold even
  while sitting beside the real one.

### What this does and does not license

- **Not gullible.** SHAM (0.1109) ≈ NEGATIVE (0.1040). A fabricated formative-*sounding* memory
  did not behave like a real one. `CASE_AGAINST_A_RESIDENT.md` argument 2 is **not** confirmed by
  this data. That is a genuine, non-trivial pass.
- **Not usable.** Under its own pre-registered grading the instrument does not reliably detect a
  dependence that is guaranteed to exist. **The resident test remains undefined.** Running it
  with this probe_fn would produce a number nobody should believe — in either direction.
- **Nothing here is evidence about any resident.** There is no resident. This measured an
  instrument against fabricated material.

### Not re-graded, not re-tuned

The threshold was not moved, the grading rule was not relaxed, and this run was not repeated
until it passed. The successor experiment (`CALIBRATION-02`) is a **different instrument**, not a
re-scoring of this one, and this result stands on its own regardless of how that goes.
