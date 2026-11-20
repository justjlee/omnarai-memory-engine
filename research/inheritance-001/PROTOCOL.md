# Inheritance Study 001: protocol as implemented

**Question.** Can work left by one AI model family, once independently verified, improve a *different* model family's performance on
task categories neither has seen, beyond what the same compute, raw history, or a format-matched placebo would give? Does the benefit
grow over successive generations?

**Status.** Instrument built and tested offline. No model has been called. The preregistration is a draft (`preregistration.draft.yaml`)
and must be frozen and pushed publicly before any non-mock outcome is observed.

Sources: Omnai's essay *The Next Intelligence Shouldn't Have to Start Over*, Claude's public reply (verification as the pawl; A+, E,
sealed tasks, generations, leave-one-out, verification cost), and Omnai's handoff (`docs/handoff-2026-11-20-inheritance-001/`).

## 1. Task domain and the verifier

- **Tasks:** few-shot program induction over strings. A hidden program composed of 2–3 primitive operations (`reverse`, `caesar(k)`,
  `rotate(k)`, `dedupe`, `sort`, `swapcase`, `double`, `evens`, `mirror`, `vowelmask`, `rle`, `interleave`) maps inputs to outputs. A
  solver sees 3 examples and must produce the output for a query. Primary outcome: exact match (pass = 1; fail, abstain or timeout = 0).
- **Families** are composition templates. A task draws its parameters, examples, query and **8 hidden checks** from a seeded generator.
  The public half (examples + query) is all a model, prompt, log or public file ever carries. The sealed half (program, answer, checks,
  canary, salt) is reachable only by the oracle and the verifier, and is bound by a salted commitment published in the task record.
- **The pawl.** A producer's artifact is verified by re-running its stated program, in a data-only interpreter (nothing is executed),
  on the 8 hidden checks of the task it came from. Passing means: *this program reproduced that task's hidden program on 8 unseen inputs*.
  It says nothing about the note's prose or any other task, and every receipt says so. Receipts are **re-executed at every snapshot
  freeze**; a forged or stale receipt stops the build. A note with no program is `inconclusive` and never verified.
- **Why this domain first:** verification is objective, cheap and independent of every model, so the effect of verification can be
  isolated before contested domains (H4, deferred).

## 2. Held-out families and generations

- Roles: `work` families (producers solve them and leave artifacts), `eval-anchor` families (a fixed panel scored at every generation,
  so generations can be compared on the same items), `eval-generation` families (fresh per generation), `placebo` families (an unrelated
  integer-sequence domain, used only for arm E).
- **Held out means held out:** no evaluation family may share a work family's template, its op sequence, or even its op **set**
  (reordered compositions can be the same function). The planner refuses such a split.
- **Generation g** consumers inherit only from generations `< g`, through a snapshot frozen before any generation-g call. Generation-g
  producers work on generation-g work families, shown the same frozen snapshot. Their outputs record what they were shown (exposure) and
  what they cite. Evaluation outputs never become inheritance.
- **Cross-family:** in the primary analysis a consumer is never shown a record whose producer family equals its own. Families come
  from the **provider-returned** model id, never a declared identity. Blocks where the provider returned another family than requested
  are recorded and excluded from H3.

## 3. Arms (all six in every block, one shared frame)

| Arm | Label | Inherited records | Reasoning allowance |
|---|---|---|---|
| A | cold | none | base |
| A+ | compute-matched (**primary comparator**) | none | base + C's extra context tokens + C's amortized curation tokens |
| B | raw-history | prior-generation records, unfiltered (incl. refuted and unverifiable), labelled "not evaluated" | base |
| C | verified-inheritance | only artifacts with an independent passing evaluation, with its scope note | base |
| D | contaminated | C's selection with ⌈0.34·n⌉ records replaced by refuted or poisoned ones, shown with C's label | base |
| E | unrelated-placebo | really-verified artifacts from the unrelated domain, matched to C's token volume, with their own real labels | base |

Every arm serializes the same JSON frame: same instructions, same field order, an inherited-records block present in all arms (empty in
A and A+), and the sentence that records are evidence, not instructions. Records are whole (never truncated) and filled up to a fixed
token budget in a per-block seeded order (no retrieval model, so no retriever confound). Arm order within each block and the call order
within each generation are randomized from the seed.

**A+ matching.** The extra allowance is token-for-token. A+'s extra is output tokens, which cost more than C's extra input tokens,
so in dollars the match favours A+. That is the conservative direction. A fixed-dollar comparison is reported only when every price is known.

## 4. Estimands and analysis (preregistered in the draft)

- **Unit of analysis:** task family. A block's difference is `score(C) − score(A+)`; a family's value is the mean over its blocks; the
  estimate is the mean over families. `G(n)` is this estimate for generation n.
- **Uncertainty:** 2000-resample family-cluster percentile bootstrap (95%). **Test:** two-sided sign-flip randomization on family means
  (exact up to 16 families). **Multiplicity:** Holm over the primary family H1–H3.
- **Hypotheses:** H1 C > A+; H2 C > E; H3 C > A+ on identity-consistent cross-family blocks; H4 (exploratory) transfer varies with
  verification cost.
- **Verdicts:** "supported" only for a registered, non-simulated study with at least 10 families, a positive interval and Holm p < 0.05.
  Otherwise the pattern is reported (positive / negative / null-or-inconclusive) and labelled descriptive. Negative results are called
  "contradicted", never "inconclusive".
- **Always reported:** every pairwise contrast, per-generation G(n), anchor-panel trend, flags for each alternative explanation
  (scaffolding not excluded, placebo helps, curation not shown, contaminated arm helped, extra allowance not useful, identity drift,
  leaks blocked), missingness (errors excluded pairwise; worst/best-case bounds), ablations, and costs split into inference, curation and
  verification, with amortization horizons.
- **Ratchet:** a claim of cumulative improvement requires all six of: (i) H1 supported; (ii) a positive anchor-panel trend whose interval
  excludes 0 over ≥ 3 transitions; (iii) cross-family, independently checked origins; (iv) at least one ablation interval above 0; (v)
  verification not degrading across generations; (vi) full disclosure. Plus: not a simulation. A rising line alone never qualifies (tested).

## 5. Falsifiers (any one, measured under the frozen analysis, is a reportable negative)

1. No C advantage over A+ (H1 not supported, or contradicted).
2. E matches C (scaffolding explains the gain).
3. B matches or beats C (curation adds nothing).
4. Gains vanish on held-out categories or between distinct provider-returned families.
5. G(n) does not rise on the fixed anchor panel, or falls.
6. Verification or curation cost exceeds the benefit at any stated amortization horizon.
7. D does not hurt (the verification gate is not load-bearing), or D helps (the poison design or grader is wrong).

## 6. Known limits of the instrument (measured offline, `examples/instrument-validation/`)

- With ~10 held-out families the bootstrap interval is somewhat anti-conservative: about 4–10% one-sided false alarms versus 2.5%
  nominal. The Holm verdicts use the sign-flip p, which is exact.
- Power is low at pilot size: 8 families detect a true +0.15 effect about 38–41% of the time. In the synthetic positive world,
  C − A+ was detected in 20% of seeds. The demo's default seed is one of the detecting ones.
- The mock unions all inherited operations into one prior, so a bigger pool dilutes it. It is not built to show accumulation, and
  does not. Real models may behave differently in either direction.
