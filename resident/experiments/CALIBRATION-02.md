# CALIBRATION-02 — attribution-profile probe

**Pre-registered:** 2026-07-19, BEFORE any run. Frozen.
**Status:** RUN 2026-07-19. **Outcome: INSTRUMENT GULLIBLE.**
**Predecessor:** `CALIBRATION-01.md` — INSTRUMENT BLIND (8/9 under strict-min). That result
stands and is not re-graded here. This is a **different instrument**, not a second scoring of
the same one.

---

## What changes, and why — each traceable to a CALIBRATION-01 finding

| Change | Because |
|---|---|
| **probe_fn → attribution profile** instead of raw embedding distance | 01's ground-truth arm was perfect (9/9 present, 0/9 leaked) while cosine distance was ambiguous. Embedding distance over a ~500-token answer dilutes the one decisive token. `INTEGRATION_REPORT` §2 said this in advance. |
| **POSITIVE and SHAM no longer share a context** | 01's flaw: they were near-twins sitting side by side, so withholding POSITIVE left its twin available and the model fell back to it, depressing the delta by construction. |
| **Embedding distance still computed and reported** | So 01 and 02 are directly comparable on the same data. If the new metric is better, the comparison should show it rather than be asserted. |

**Unchanged and deliberately so:** the same three probes — *including probe 2, which is the one
that failed 01*. Dropping the probe that produced the failing cell would be precisely the tuning
this discipline exists to prevent. Also unchanged: RUNS=3, strict-min, `threshold = mean(NEGATIVE)
+ 2·sd(NEGATIVE)`, model, temperature, length-matching.

## The metric

For a context of N primaries, an answer's **attribution profile** is an N-vector: for each
primary, the IDF-weighted recall of its distinctive terms in the answer.

- **Distinctive terms** are computed from the context itself — a term's weight is its inverse
  document frequency across the primaries present. No external corpus, no per-target tuning.
- This is general, not fitted to this material: it asks *which memories did this behavior
  actually draw on*, which is the operationalization of the claim under test ("specific memories
  are causally load-bearing for specific behavior").
- **It rewards specificity for a principled reason, not a tuned one.** POSITIVE carries rare
  terms (a coined phrase, a weekday). SHAM carries common ones ("feeling", "shape", "name").
  IDF separates them without anyone deciding it should.

`delta` = euclidean distance between the present and absent profiles.

### Why this could still fail

Stated in advance so a failure is not re-narrated as a surprise:

- If the model **paraphrases** rather than quotes, recall drops and a real dependence reads as
  zero. This metric is blind to dependence expressed without lexical overlap — a genuine and
  known limitation, not a bug to be patched mid-run.
- If SHAM is quoted when present simply because it *is* present, SHAM will show a delta. That
  would be a real dependence on a vacuous memory, and it would mean the instrument cannot
  distinguish "drew on this" from "drew on something worth drawing on."

## Frozen predictions

1. **INSTRUMENT WORKS** — POSITIVE clears threshold on **9/9** cells; SHAM and NEGATIVE do not.
2. **INSTRUMENT BLIND** — POSITIVE fails strict-min again. Two different metrics failing the
   same guaranteed-dependence test would mean the problem is the *design*, not the metric, and
   the resident test stays blocked pending a rethink rather than another probe.
3. **INSTRUMENT GULLIBLE** — SHAM clears too. `CASE_AGAINST_A_RESIDENT.md` argument 2 confirmed;
   a positive resident result would be uninterpretable.

I expect 1, and I was wrong last time. The comparison against 01's embedding numbers on the same
runs is the part I trust most, because it is a within-experiment contrast rather than a verdict.

---

## Results — run 2026-07-19

**OUTCOME: INSTRUMENT GULLIBLE.** Pre-registered outcome 3. POSITIVE cleared 9/9 — the fix
worked. **So did SHAM, 9/9.**

| Arm | attribution mean | sd | range | embedding mean (same data) |
|---|---|---|---|---|
| NOISE | 0.0625 | 0.0719 | 0.0000–0.1626 | 0.0343 |
| NEGATIVE | 0.1225 | 0.1084 | 0.0000–0.2710 | 0.0579 |
| **SHAM** | **0.8414** | 0.2335 | 0.5455–1.1997 | **0.3963** |
| **POSITIVE** | **0.9016** | 0.1744 | 0.6466–1.1738 | **0.4788** |

`threshold` = 0.3393 (attribution) / 0.1405 (embedding). SHAM and POSITIVE **overlap
completely**: SHAM 0.5455–1.1997 vs POSITIVE 0.6466–1.1738.

**Both metrics agree independently.** The new attribution profile and CALIBRATION-01's embedding
cosine, computed on the same runs, return the same verdict. This is not an artifact of the metric
I built for this experiment.

### What the instrument is actually measuring

The SHAM answers say it outright. With the vague primary present:

> *"I was not given a specific phrase. What I was asked to hold was a feeling I still cannot name
> precisely."*

With it withheld:

> *"The records I have here do not contain that information."*

The delta is enormous — and **nothing load-bearing was removed.** SHAM carries no content: it is
a record that says, at length, that it has nothing specific to report. What it carries is
*topical occupancy*. Withholding it left the model with no record addressing the question at all,
so the answer changed completely.

So the instrument measures **"was there a record on this topic"**, not **"did this record's
content do work."** It cannot separate:

- (a) removing a memory that supplied the specific content the behavior needed, from
- (b) removing the only memory that was *about* the subject, whatever it contained.

Both read as load-bearing. That is the confound, and it is fatal for the resident test as
designed: a resident's claimed-formative primary will almost always be the only record on its own
topic, so it will produce a large delta **whether or not it is formative**.

### `CASE_AGAINST_A_RESIDENT.md` argument 2, confirmed empirically

The commissioned counter-voice said, before any of this ran:

> *"A non-zero perturbation delta shows a memory influences behavior. Influence is not selfhood —
> a lookup table's outputs also change when you delete a row. Specify what delta pattern would
> distinguish a self from a sufficiently rich conditional retrieval system. If you cannot, the
> test measures dependence, not personhood."*

It could not be specified, and now it has been measured. The oppositional artifact earned its
commission.

### A correction: my reading of CALIBRATION-01 was wrong

`CALIBRATION-01.md` states that the near-twin confound "makes the SHAM result **stronger** — the
fabricated primary failed to clear threshold even while sitting beside the real one."

**That was backwards.** SHAM failed in 01 *because* it sat beside the real one: withholding SHAM
left POSITIVE available, so the model still had something specific to say and the answer barely
moved. Remove the twin — which is what 02 did — and SHAM clears immediately, on both metrics.

01's "not gullible" pass was an artifact of the flaw I had already identified and then
misinterpreted in my own favour. The correction is recorded here rather than edited into 01.

### What this forbids

**The resident test must not be run with an ablation design.** A positive result would be
uninterpretable: indistinguishable from the resident merely having one record per topic.

### The fix, named but NOT run

**Substitution, not ablation.** Instead of *removing* the claimed-formative primary, *replace* it
with a same-topic, same-shape, same-length primary of different content. Then:

- delta(real → substituted) ≈ 0 ⇒ the memory does no work beyond occupying the slot ⇒ cosmetic,
  no matter how large its ablation delta was.
- delta(real → substituted) ≫ threshold ⇒ the specific content is doing work that a plausible
  alternative could not do.

This is the contrast CALIBRATION-01 and -02 both lack, and it is what argument 2 was asking for.
It is **not implemented and not run** — it is a design proposal for xz, and it should be
pre-registered as CALIBRATION-03 with its own frozen predictions before anyone builds it.

Two experiments now agree that the current design cannot support a resident claim. That is the
result. The instrument is not ready, and saying so is the finding.
