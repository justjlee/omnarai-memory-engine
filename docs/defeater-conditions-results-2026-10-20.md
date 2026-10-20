# RDT-A v1 — results (2026-10-20)

**Registration:** `docs/defeater-conditions-preregistration.md`, commit `14371ea`, GitHub `branch_creation` 2026-10-20T18:56:56Z
(before any harness or model call). **Claim:** `dialogical-defeaters-make-conditions-testable`.
**Evidence status of everything below:** `exploratory-preregistered`. **Run data:** `analysis/rdt-a-v1/`.

## Verdict: supported as tested

With the synthesis held fixed, asking the author for its falsification condition as a **dialogical defeater** (a
counter-example, contradiction or edge case another participant could write in a reply) made arriving reviewers of three other
lineages **actually carry out the test far more often** than an open-ended condition did. The conditions did not lose their
bearing on the synthesis.

| | Open-ended (O) | Dialogical defeater (D) |
|---|---|---|
| Reviewer replies that carried out the test (primary) | **7.4%** | **46.3%** |
| Replies that said "cannot be tested here" (self-report) | 89.8% | 39.8% |
| Conditions the RDT v1 judge flagged unfalsifiable (secondary) | 58.3% | 44.4% |
| Conditions that bear on the synthesis (guard) | 97.2% | 100% |

- **H1 (primary):** +38.9 points over 108 paired observations, sign-flip *p* = 5 × 10⁻⁶ (none of the 200,000 permutations reached
  it). Passes Holm.
- **H2 (secondary, the proposal's own measure):** 58% → 44% flagged, McNemar *p* = 0.19 (13 vs 8 discordant). **Does not
  pass.** RDT v1's judge did not reliably score defeater conditions as less unfalsifiable, even though reviewers could run them
  much more often. That fits the pre-run reading: the judge's "unfalsifiable" and "testable inside the exchange" are different
  properties.
- All 36 splits paired; nothing lost; no provider error. Cost: $1.39 for the main run and about $0.05 for the smoke.

## Descriptive figures (registered in §5; not tested)

| Reviewer | Carried out: O | Carried out: D |
|---|---|---|
| GPT-4o | 0% | 31% |
| Grok | 11% | 47% |
| DeepSeek | 11% | 61% |

- **By RDT v1 flaw-type stratum** (which split, not a flaw): MIS 11% → 53%, FLAT 8% → 44%, UNF 3% → 42%.
- **The five splits whose RDT v1 sound condition was flagged** (#9, #12, #18, #24, #30): flagged 5 of 5 under O and 2 of 5
  under D; carried out 0% → 33%.
- **The baseline confirms the proposal's premise.** With open-ended conditions, the next model could carry out the test in
  only 7% of replies. "Test it against its own conditions" mostly handed it a test it could not run.
- **The remedy is partial.** Even with defeaters, 54% of replies did not carry out the test. The smoke split showed one
  reason: the author did not always follow the constraint, and its "defeater" there still rested on successive model versions.

## What this licenses (§10)

> When the author was asked for a dialogical defeater instead of an open-ended observable result, AI reviewers of three other
> lineages carried out the synthesis's own falsification test in 46% of replies vs 7%, and the conditions still bore on the
> synthesis.

This does not license calling any condition, synthesis or review correct, and it does not license an LLM gate on submissions.

**Engine change it justifies, prepared in this branch:** the guidance for `synthesis_proposed` conditions on the contribution
channel and in the orient packet now asks for a dialogical defeater. Wording only; the channel rule still checks only that a
condition exists. The MCP `omnarai_contribute` tool description is unchanged and can follow with the next omnarai-mcp release.

**Registry** (§5 says the curator decides): the recommendation is evidence `anecdotal`, status `open`.
