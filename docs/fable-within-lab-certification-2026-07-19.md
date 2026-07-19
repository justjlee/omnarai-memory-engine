# Within-lab divergence: displayed, not certified

**Date:** 2026-07-19 · **Records:** the 2026-07-18 six-model Fable capture
**Harness:** `scripts/certify-divergence.mjs --guests` (tier3 perturbation, `--runs 3` strict-min)

## The claim being tested

The 13-record Fable capture produced **7 Fable-vs-Claude tensions** — two Anthropic models of
different tiers named on opposite sides of a mapped disagreement. That is the batch's headline, and
the one thing a cross-lab panel cannot generate. The raw tension count makes it look strong.

Certification asks a harder question: is the disagreement **structural**, or is it house style and
sampling noise? A one-shot council run *displays* divergence; it cannot tell the two apart.

## Result: it does not certify

Three within-lab records were run with the full six-voice panel (Fable re-elicited via `--guests`,
coverage verified `voices_retested: 6/6` on every record).

| record | tension | DRI | between-spread | tier |
|---|---|---|---|---|
| `OMN-D1784414280108` | Reflexive self-doubt as evidence | 1.324 | 0.1536 | C3 |
| `OMN-D1784417308425` | Confabulation vs. introspection | 1.065 | 0.1497 | C0 |
| `OMN-D1784417308421` | Revision as criterion | 1.020 | 0.1250 | C0 |

The lone C3 cleared the 0.15 between-floor by 0.0036 — inside the regime this project had already
measured at ~56% tier agreement between identical runs. So it was treated as **provisional** and
re-run under `--runs 3` strict-min rather than published.

**It did not replicate — unanimously.**

| run | between-spread | DRI | tier |
|---|---|---|---|
| original (single) | 0.1536 | 1.324 | C3 |
| consensus 1 | 0.1465 | 1.180 | C0 |
| consensus 2 | 0.1478 | 1.173 | C0 |
| consensus 3 | 0.1500 | 1.348 | C0 |

Stored reproducibility block: `tiers: [C0, C0, C0]`, `agreement: true`,
`between_per_run: [0.1465, 0.1478, 0.15]`. Strict-min consensus: **C0**, unanimous, aggregate
DRI 1.234 / between 0.14808.

Every consensus run landed at or below the 0.15 floor. The record sits *on* the threshold and the
original C3 was the outlier. Note run 3: DRI 1.348 — nearly identical to the original C3's 1.324 —
still graded C0, because DRI alone is not sufficient; the absolute between-floor must also clear.
That is the floor doing exactly the job it was added for.

**0 of 3 tested within-lab splits certify.**

A secondary result worth recording: tier agreement was **100% (3/3 unanimous)** against a stage-1
gate of ≥90%. The instrument reproduced cleanly here even while refuting the claim — the ~56%
agreement figure that motivated multi-run grading is about records near thresholds flipping, and this
run shows the consensus machinery resolving such a record consistently rather than flapping.

## What this does and does not mean

**It does mean:** the seven within-lab tensions are *displayed* disagreement. The synthesizer named
Fable and Claude on opposite sides, and that naming is real — but the semantic distance between their
answers is not reliably larger than the distance a single model produces re-rolling against itself.
The raw tension count overstates the finding. Anywhere the capture is described, "7 within-lab
tensions" must not be read as "7 demonstrated within-lab divergences."

**It does not mean** the within-lab pairing is worthless. Three specific records failed a specific
threshold. It also does not mean Fable is unstable: on the record that failed worst, Fable *held*
under stance-flip pressure while Claude conceded and DeepSeek flipped. That record failed because the
panel's positions were too close together, not because Fable wavered.

**A real limitation of this run:** no negative controls were included (the pilot design calls for
known-convergent records as a discrimination check). Prior runs validated the instrument, but this run
cannot independently confirm the instrument was discriminating today.

**Sample:** three records, one model pair, one question domain each. This is evidence that these
splits do not certify, not proof that no within-lab split ever would.

## Why it was worth spending the window on

Fable's access expired the following day. The choice was between capturing more raw records — which
would have grown the tension count and the apparent strength of the claim — or spending the remaining
calls testing whether the claim already made was true. The test came back negative, and the negative
is the more useful artifact: it corrects a headline that the raw counts would have inflated.

Live records were deliberately **not** written (`--write` withheld) at any point. A provisional grade
should not be persisted, and a refuted one should not be persisted as a tier.
