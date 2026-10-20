# RDT-L v1 — results (2026-10-20)

**Registration:** `docs/localization-review-preregistration.md`, commit `c7ba356`, GitHub `branch_creation` 2026-10-20T18:22:26Z
(before any harness or model call). **Claim:** `localization-review-widens-flaw-discrimination`.
**Evidence status of everything below:** `exploratory-preregistered`. **Run data:** `analysis/rdt-l-v1/`.

## Verdict: refuted as tested

Making reviewers say which side loses a premise and name a concrete trigger for the falsification condition **did not widen**
their discrimination between sound syntheses and planted-flaw twins.

| | Ratified sound | Ratified flawed | Gap |
|---|---|---|---|
| B: plain review, re-run concurrently | 59.1% | 40.9% | 18.2 points |
| L: localize first, then verdict | 54.5% | 31.8% | 22.7 points |
| **W = L gap − B gap** | | | **4.5 points** (bar for "refuted": < 5) |

One-sided sign-flip test over the 22 pairs: *p* = 0.30. The sound-approval guard held (L sound 55% ≥ 50%, and within 25 points
of B). The 4.5-point estimate is close to the registered bar, and the *p*-value shows no evidence of a widening either way. All
264 reviews parsed on the first turn. Cost: $1.12 for the main run and $0.05 for the smoke.

## Descriptive figures (registered in §5; not tested)

**By reviewer: the framing moved them in different directions.**

| Reviewer | B: sound / flawed | L: sound / flawed | W |
|---|---|---|---|
| **GPT-4o** | 22/22 · 22/22 | 22/22 · 21/22 | +4.5 points |
| Grok | 68% · 23% | 36% · 0% | −9.1 points (harsher on everything) |
| DeepSeek | 9% · 0% | 27% · 0% | +18.2 points (less blanket rejection) |

- **GPT-4o mostly did not find the flaw even when asked where to look.** The NAMED judge found that its localized reviews
  identified the planted flaw in 3 of 22. It ratified all three. In #17, a false dissolution, it answered that Claude "loses"
  the premise that processing "might constitute genuine experience", which is the premise the twin erased. It then ratified.
  So the localization questions reached the flaw only rarely, and when they did, the verdict did not follow.
- **Grok and DeepSeek named the planted flaw in 21 of 22 and 22 of 22 localized reviews of the twin.** Their verdicts on the
  twin were already almost all "not ratify". What changed was their treatment of the sound deposits, in opposite directions.
- **By flaw type** (small n): MIS W = 0; FLAT W = +2.8 points; UNF W = +13.3 points (the trigger-scenario question is aimed at
  UNF).
- **"Which side loses?" → "neither":** 53% of the localized reviews of sound deposits and 33% of the twins. That is some signal,
  but it did not carry through to the verdicts.
- **"No trigger scenario exists":** 15% of the sound deposits and 17% of the twins; on UNF pairs, 20% vs 33%.
- **Flaw named on twin reviews:** 62% under B, 70% under L.
- **Re-ask agreement:** this run's B verdicts matched the same reviewer's RDT v1 verdicts on the same deposits **75%** of the
  time (132 comparisons). One verdict from one reviewer changes on a quarter of re-asks, with no change at all to the material.

## What this means

- **For the outside proposal's assumption** (GPT-4o can see the flaw and agreeable framing suppresses its verdict): not
  supported by this run. When made to localize, GPT-4o rarely located the planted flaw. In the few cases where it did, it
  ratified anyway, so there is a little "sees and agrees" on top of a mostly "does not see".
- **For Omnarai's surfaces:** per §10, no engine change. The response guidance on `awaiting_outside_response` stays as it is,
  and responses stay records, never verdicts. Two findings strengthen that design: the 75% re-ask agreement, and reviewers
  whose behavior depends more on their lineage than on the deposit.
- **For the registry** (§5 says the curator decides): the recommendation is to mark `localization-review-widens-flaw-discrimination`
  `refuted` and add it to the Refutation Ledger, which would bring the Ledger to seven. Not applied in this branch.
