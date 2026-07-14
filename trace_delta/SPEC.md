# trace_delta/SPEC.md — Blind A/B Corpus-Utility Instrumentation
**Status:** SPEC ONLY. Implementation gated on V4–V6 passing (D1/D3/D4 fixed).
**Priority:** #2 after Atlas staging. **Owner:** next Claude Code session unless budget remains in this one.

## 0. Reconcile first
The live MCP tool description references `utility-evidence.md` as containing "replicated statistical utility evidence." **Locate it.** If real replicated trace data exists, this spec's job changes from BUILD to EXTEND/VALIDATE: audit the existing methodology against §2–§4 below, keep what passes, document deltas in SESSION-LOG.md. Do not build a parallel system beside an existing one.

## 1. Question this answers
Does corpus retrieval measurably improve responses, versus the same model cold? The existing `omnarai_trace` tool is a single-run demonstrator by its own description. This spec upgrades demonstration to measurement.

## 2. Design
- Fixed battery, ≥50 queries, stratified across conceptual / narrative / technical tiers (reuse and extend the audit battery).
- Per query, generate pair: (A) with corpus retrieval, (B) cold. Same model, same version, same params, same date — log all four.
- Randomize A/B presentation order per trial. Judge is blind: separate model instance (or human) that never sees condition labels.
- Metric: **win rate of corpus condition with 95% CI** (binomial). Report per-tier and pooled.
- Replication: ≥3 runs per query minimum; report between-run variance.

## 3. Contamination guards (each is a hard validity requirement)
1. **D3 fixed first.** Retrieval bleed corrupts condition A — the corpus condition must contain only what retrieval should return.
2. **Vocabulary unblinding.** The judge prompt must not reference Omnarai vocabulary; and condition-A responses containing distinctive coined terms (holdform, Lattice Glyphs, etc.) partially unblind the judge. Mitigation: judge rubric scores only task-quality dimensions (accuracy, specificity, consideration coverage, internal consistency) and is instructed that unfamiliar terminology is neither penalized nor rewarded. Report a sensitivity analysis: win rate on the subset of pairs where A contains no coined terms.
3. **Length confound.** Corpus-augmented answers tend longer. Report win rate alongside a length-controlled subset or a judge rubric that explicitly excludes length.
4. **Query selection bias.** The battery must include queries where the corpus is EXPECTED to add nothing (out-of-domain controls, ≥20% of battery). Corpus winning on its home turf but not on controls is the honest expected result; corpus winning on controls indicates judge contamination.

## 4. Non-negativity property
A null result (win rate ≈ 50% on in-domain queries) is publishable and valuable — it honestly bounds the corpus's marginal contribution and directs effort to the Atlas instead. Pre-commit to publishing the number regardless of direction. This pre-commitment goes IN the results file.

## 5. Outputs
- `trace_delta/results-v1.json`: per-trial rows (query, tier, run, conditions hash, judge verdict) + summary block (win rates, CIs, sensitivity analyses, pre-commitment statement).
- One-paragraph findings summary appended to the Atlas card's utility-evidence section, whatever the direction.

---

## §0 RECONCILIATION — completed 2026-07-14 (see SESSION-LOG.md for the full audit)

`utility-evidence.md` LOCATED: `huggingface/utility-evidence.md` (+ raw verdicts in
`huggingface/utility/`). It contains a REPLICATED three-arm controlled study — but of a
**different treatment** than this spec measures:

| | existing study | this spec |
|---|---|---|
| Treatment | showing a consumer model an Atlas RECORD (peer answers + tensions) | corpus RETRIEVAL vs the same model cold |
| Control | placebo revision prompt | cold condition, blind A/B |
| n | 20 questions × 5 consumers | ≥50 queries, ≥3 runs each |
| Judging | 5-judge panel, randomized order, majority, sign test; replicated across same-family AND fully disjoint judge designs | blind judge, win rate + 95% CI |
| Controls | own-influence bias probe | out-of-domain ≥20%, length confound, vocabulary-unblinding sensitivity |

**Verdict: EXTEND, do not build parallel.** The existing harness
(`huggingface/utility/utility-test-disjoint.mjs`) already implements blind judging,
randomization, and significance testing — §2 here is an adaptation of its treatment arm
(swap Atlas-record injection for retrieval-vs-cold via `/api/query` / `mode=retrieve`),
plus the battery/controls this spec adds. Also reconcile scope with the PREREGISTERED
confirmatory study (`docs/utility-eval-preregistration.md`, `scripts/utility-test-prereg.mjs`)
before running anything — do not create a third overlapping instrument.

**Gate status at reconciliation:** V4 PASS, V5 PASS (D1 n/a, D3 clean live). V6 BLOCKED —
`/api/trace` jobs fail server-side: the production Anthropic account is OUT OF CREDITS
(verified 2026-07-14, `TRACE_FAILED` / "credit balance is too low"). Implementation stays
gated until credits are restored and V6 passes.
