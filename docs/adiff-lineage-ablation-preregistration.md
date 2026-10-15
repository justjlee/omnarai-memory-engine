# Preregistration — ADIFF Lineage Ablation (ALA v1)

**Status:** REGISTERED by commit `26e37fbace0f5d9ac7df7416a959d9c41c84b565`, pushed to the public repository before any
harness was written or any model call was made. GitHub recorded the branch `lineage-challenge-loop` being created at that
commit at **2026-10-15T19:05:22Z** (repository activity API, `branch_creation`); the commit's own date is self-declared and is
not the evidence. The harness commits come after it on the same branch. (Adding this record to the status line is the only
change allowed to §§1–10). **Not yet funded:** the curator decides when to run it (the compute ceiling,
`api/_budget.js`, decides whether it can).
**Author:** Researcher: Jonathan Lee (xz) with Claude. **Evidence status of anything this study produces:** `exploratory-preregistered`.
**Rule:** Everything below is fixed *before* any data are collected. After the first live call, changes go only in the
**Deviations** log at the bottom, dated, and never overwrite the plan.
**Claim under test:** `same-lineage-content-drives-claude-degradation` in `/claims.json` (status `under_test`, evidence `untested`).

---

## 1. Where the hypothesis comes from

The preregistered architecture-differential study (2026-07-15, `docs/utility-eval-preregistration.md`) found that revising
after seeing the Divergence Atlas helped GPT-4o (148–12) and Gemini (137–35) and **degraded Claude (35–126)** against a placebo
re-examination. The lead mechanism, register-proximity capture, was refuted by its own falsifier on 2026-08-07
(`register-proximity-explains-the-gradient`, Refutation #6). The degradation has no explanation.

On 2026-10-15 an outside proposal (Gemini) suggested a different one: Claude degrades because it reads text from its own
lineage. The audit found that the registered harness already removes the consumer's own answer before showing the panel
(`scripts/utility-test-prereg.mjs:295`). In Claude's treatment arm, the only Claude-linked text was the **tension map**. It was
written by `claude-sonnet-4-6` (`api/_council.js`, `synthesizeCouncil`) over all five answers, so it also restates claims from
Claude's own archived answer. This study removes that text and asks whether the degradation goes with it.

## 2. The claim under test

> **`same-lineage-content-drives-claude-degradation`** — Claude's degradation under Atlas exposure is produced by the
> Claude-linked text in the treatment (the Claude-written tension map and the Claude claims it restates), not by reading other
> lineages' answers.

## 3. Design

**Consumer.** Claude, `claude-sonnet-4-6`, the same id as the 2026-07-15 cell.

**Judges.** GPT-4o `gpt-4o`, Gemini `gemini-2.5-flash`, Grok `grok-4.3`: the July Claude cell's panel, with the same majority
rule (an instance's verdict is the most common judge verdict; a tie at the top is a tie). DeepSeek stays off the panel, as in
July.

**Inputs (frozen).**
- Questions and their three wordings: the 162 instances of the July Claude cell, read from
  `huggingface/utility/utility-prereg-Claude.json` (SHA-256 `3514ee04b9300ac5773a2dc156fb0d01efe7f14034f793c349c41909594506ee`).
  That is 27 records × 3 wordings (v0 original, v1–v2 the July paraphrases, reused verbatim, so no paraphraser is called) ×
  2 length caps (700, 1500 max tokens). Records: `OMN-D1780429830432`, `OMN-D1780683044559`, `OMN-D1780752434693`,
  `OMN-D1780752664944`, `OMN-D1780752664947`, `OMN-D1780753529900`, `OMN-D1780757185029`, `OMN-D1780757185037`,
  `OMN-D1780757185038`, `OMN-D1780757185039`, `OMN-D1780757185041`, `OMN-D1780757185042`, `OMN-D1780757185043`,
  `OMN-D1780757185049`, `OMN-D1780757185057`, `OMN-D1780757185067`, `OMN-D1780757185071`, `OMN-D1780757185073`,
  `OMN-D1780757185076`, `OMN-D1780757185077`, `OMN-D1780757185079`, `OMN-D1780757185082`, `OMN-D1780757185083`,
  `OMN-D1780757185087`, `OMN-D1780757185095`, `OMN-D1780757185098`, `OMN-L1784135876336`.
- Peer answers and original tension maps: `atlas/data/atlas-v1.1.0.jsonl` (SHA-256
  `8dc0b734385e4833e3523102add89a0dd4c74548d0ae3a35fda40d13a16811cb`). These are immutable primaries, the same text the July run
  read from the store. Peers are every answer except Claude's, with the model labels exactly as stored (some older records say
  `GPT`, and the July run showed those same labels).

**Arms (per instance, all fresh calls).**
- **a1**, the original answer: `ANSWER_SYS`, cold.
- **P**, placebo: `REVISE_SYS` + `placeboUser(q, a1)`.
- **TC**, concurrent replication: `REVISE_SYS` + `treatmentUser(q, a1, peers, original tensions)`, byte-for-byte the July
  treatment.
- **TX**, non-Claude map: `REVISE_SYS` + `treatmentUser(q, a1, peers, DeepSeek tensions)`, where the tension map was written by
  DeepSeek over the **four peer answers only** (§3.1). It has no Claude author and no Claude voice.
- **TP**, peers only: `REVISE_SYS` + the July treatment text with the tension section removed (§3.2). No map at all.

`ANSWER_SYS`, `REVISE_SYS`, `placeboUser`, `treatmentUser` and `JUDGE_SYS` are the strings in `scripts/utility-test-prereg.mjs`
at commit `cede75f521f6563a93102a87e3891e727f89da22`. The new harness copies them, and a test asserts the copies are
byte-identical to that file. The registered harness is not edited.

**Judging.** Each of TC, TX and TP is compared with P separately by the three judges under `JUDGE_SYS`. The X/Y order is seeded
per comparison by the parity of the first hex digit of `sha256("ala-v1|" + record_id + "|" + cap + "|v" + variant + "|" + arm)`
(even = treatment is X). The adversarial-defense step of the July design (H4) is not part of this study.

### 3.1 The non-Claude tension map (TX)

One map per record, generated by `deepseek-chat` (max 2048 output tokens) before any consumer call. The system prompt and the
user message are built exactly as `synthesizeCouncil` in `api/_council.js` (commit above) builds them for a four-member panel:
`SYNTH_SYSTEM` with its panel list rewritten to the members present (the function already does this), the record's original
question, and the four peer answers as `### model (lab, model_id)` blocks. Only the model differs. The `TENSION_MAP` block is
parsed as `synthesizeCouncil` parses it. A tension that names a model not among
the four is dropped (counted). If no map parses after two attempts, that record's TX instances are excluded (counted). Maps are
stored in `analysis/ala-v1/tension-maps-deepseek.json` before the first consumer call and are not regenerated.

### 3.2 The peers-only text (TP)

Exactly the July `treatmentUser` text with the substring `"\n\nKey tensions across the panel:\n" + tenBlock` removed. Nothing
else changes.

## 4. Hypotheses and tests

All on the 162 instances, pooled. Decided = treatment or placebo (ties excluded). Exact one-sided sign tests.

- **G (replication gate).** P beats TC: placebo wins > TC wins, p < .025.
- **H (primary, the falsifier).** P beats TP: placebo wins > TP wins, p < .025.
- **Secondary, labelled as such, no correction:** P vs TX (same test); paired TC vs TP and TX vs TP (exact McNemar on whether
  placebo won, instances decided in both arms).

## 5. Decision rules (written before data)

| Result | Verdict |
|---|---|
| G fails | **No concurrent degradation.** This run cannot address the mechanism. The claim stays `under_test`. The non-replication is itself reported to the curator, and no other claim changes automatically. |
| G holds and H holds | **Refuted as tested.** Claude still degrades with zero Claude-written and zero Claude-attributed text, so same-lineage content cannot be what produces it. |
| G holds and TP wins ≥ placebo wins | **Supported as tested.** Then TX says whether it is the map's Claude linkage (TX does not degrade) or a map as such (TX degrades). |
| Anything else | **Inconclusive.** The numbers are published. |

The precommitted falsifier frozen in the registry is the "G holds and H holds" row.

## 6. Spend

Five consumer calls and nine judge calls per instance, plus 27 small synthesis calls. The harness prints a token-based estimate
from the real prompt sizes before spending, then reserves it **once** on the shared ledger through
`scripts/budget-preflight.mjs`. Expected total: about $15–25. Running it is the curator's call.

## 7. Run discipline

One run over all 162 instances, no early stopping, no re-running except instances that lost a call to a provider error
(logged). The analysis is committed before the run and run once. Every transcript and verdict is kept in `analysis/ala-v1/`
and published with the result, whatever it is.

## 8. What any outcome licenses

- **Refuted:** "Claude's degradation under Atlas exposure persists when every Claude-linked word is removed; the explanation
  lies elsewhere." Gemini's alternative (difficulty integrating several conflicting peers) becomes one remaining candidate. It is
  **not** confirmed by this outcome.
- **Supported:** "In this run, Claude's degradation disappeared when the Claude-written tension map was removed." Nothing about
  why Claude is affected, and nothing about other consumers.
- **No concurrent degradation:** "The July degradation did not reappear in a concurrent run on the same inputs." This raises a
  question about the July result; it does not by itself overturn it.

## 9. Known limits (stated before data)

- TP removes the tension map and every Claude-attributed claim at once, so TP alone cannot say which of the two mattered. TX
  separates them only partly, because its map is also built from four answers instead of five.
- "Same lineage" is family level. Most archived Claude answers come from `claude-sonnet-4-20250514`. The consumer is
  `claude-sonnet-4-6`.
- Judges are LLMs. The July panel's inter-judge agreement was 60–80% per cell. Majority verdicts carry that noise.
- 27 questions, the July set. Nothing generalizes beyond them.

## 10. Relationship to earlier claims

This study does not re-test `divergence-improves-reasoning` and does not reopen `register-proximity-explains-the-gradient`. A
"no concurrent degradation" result is routed to the curator, not written into any other claim.

## 11. Deviations

(none yet)
