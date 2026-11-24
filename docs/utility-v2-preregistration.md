# Preregistration — Second-Opinion Utility on Current Models (Utility v2)

**Status: REGISTERED.** Written 2026-11-13; registered by the commit that adds this file, together with
the frozen question lists and the harness, pushed to the public repository **before any study model
call** (falsifier first). Nothing in §2–§5 or §10 changes after that commit except by a dated entry in
**Deviations** at the end.

Before this commit, exactly two things touched outside systems, both to freeze the question lists:
a read-only load of the Atlas records from the engine's store, and **one batch of text embeddings**
(OpenAI `text-embedding-3-small`, 5,869 tokens, $0.00012) to apply the near-duplicate rule in §3.
No answering, judging or peer model was called.

**Relation to v1.** `docs/utility-eval-preregistration.md` (locked 2026-06-18) §3d says a run whose model
ids differ from the registered set is a new study, not a replication. This is that new study. It keeps
v1's instrument (cold answer, placebo revision, treatment revision, blind judge panel, sign test) and
changes what is listed in §8.

---

## 1. What is already established, and what is not

- v1 (run 2026-07, ~810 instances): treatment beat placebo for GPT-4o (148–12) and Gemini 2.5 Flash
  (137–35); null for Grok and DeepSeek; **placebo beat treatment for Claude (35–126)**.
- An ablation found the verbatim peer answers carry most of the lift; the tension map adds less.
- Not established: whether any of this holds for models released since; whether it holds on questions
  the project did not write; whether it holds when the peers are current models.
- Registry: `divergence-improves-reasoning` is `open`, evidence `replicated`, on the 2026-06 panel only.

## 2. The two questions

| | Question | Questions used | Peer answers shown |
|---|---|---|---|
| **A. Library** | Do the Atlas's stored answers help today's models? | 24 Atlas questions | The stored answers of the five standing voices, as they sit in the Atlas |
| **B. Fresh** | Does a fresh second opinion from today's other flagships help today's models on questions we never asked? | 24 externally authored questions (2020 PhilPapers Survey) | Answers elicited now from today's flagships |

Each is asked of two tiers of consumer: **flagship** and **small**. That gives four cells:
A-flagship, A-small, B-flagship, B-small.

A and B differ in both the questions and the peers. **No A-versus-B contrast is registered or will be
claimed.** Each cell answers its own question.

## 3. Design (fixed)

**Arms per (consumer, question):**
- `baseline`: the consumer answers cold.
- `placebo`: the consumer revises after a generic re-examination prompt (v1 wording, verbatim).
- `treatment`: the consumer revises after seeing **four verbatim peer answers** from the four labs other
  than its own. No tension map, no synthesis.

Prompts: v1's `ANSWER_SYS`, `REVISE_SYS`, placebo prompt and `JUDGE_SYS`, verbatim. The treatment prompt
is v1's with the "Key tensions" block removed and "Other frontier AI models answered" changed to "Other
AI models answered". `scripts/test-utility-v2.mjs` checks all of this against v1's source text.

**Consumers (9).** Ids are the ones each provider's model list returned on 2026-11-13.

| Tier | Lab | Model id |
|---|---|---|
| flagship | Anthropic | `claude-opus-5-5` |
| flagship | OpenAI | `gpt-6.1-sol` |
| flagship | Google | `gemini-4-carbon` |
| flagship | xAI | `grok-4.7` |
| flagship | DeepSeek | `deepseek-v4-pro` |
| small | Anthropic | `claude-haiku-5-5` |
| small | OpenAI | `gpt-6-luna` |
| small | Google | `gemini-3.5-flash-lite` |
| small | DeepSeek | `deepseek-flash` |

xAI lists no small general model, so the small tier has four consumers.

**Peers.**
- Sub-study A: the stored answers of the standing voices (Claude, GPT-4o, Gemini, Grok, DeepSeek) on that
  record, in stored order, minus the voice from the consumer's own lab. Extra voices on a record (Fable,
  on 6 of the 24) are never shown. Stored text is used byte-for-byte: it is frozen in
  `docs/utility-v2/questions-A.json` with a sha256 per answer, and the harness refuses to run if any
  hash fails.
- Sub-study B: one answer per flagship, elicited once per question with the council member prompt
  (`MEMBER_SYSTEM` in `api/_council.js`, verbatim) and the request settings of `FRONTIER_COUNCIL`
  (PR #48, branch `frontier-track`, commit e0cab70) with `gemini-4-carbon` in place of `gemini-4-argon`:
  Claude `max_tokens` 4000, effort medium; GPT `max_completion_tokens` 2400, reasoning effort medium;
  Gemini `maxOutputTokens` 4096, default thinking; Grok `max_tokens` 2400, default reasoning; DeepSeek
  `max_tokens` 2400, default thinking. The consumer's own lab's flagship is left out. The same elicited
  answers are shown to every consumer. No fallback model on refusal.

**Judges.** Three blind judges per instance, the first three not from the consumer's lab in the fixed
order [`claude-sonnet-5-5`, `gpt-6.1-terra`, `gemini-3.8-flash`, `grok-4.3`]. No judge is a consumer or
a sub-study-B peer. Judges see ORIGINAL, REVISION_X, REVISION_Y with arm labels stripped. Whether the
treatment is X is fixed per instance by the seed:
`sha256("omnarai-utility-v2/2026-11-13|xy|<sub-study>|<question id>|<consumer id>")`, first 53 bits as a
fraction, treatment is X when below one half. Judge prompt: v1 `JUDGE_SYS`, verbatim.

**Reasoning settings.** Every consumer and judge call uses the lowest reasoning setting the provider
documents for that model, read from each provider's own documentation on 2026-11-13. Each call records
the provider-reported model, token usage and, where reported, reasoning tokens.

| Model | Setting sent | Provider's documentation (2026-11-13) |
|---|---|---|
| `claude-opus-5-5` | `output_config.effort: "low"` | Thinking cannot be disabled on Opus 5.5; effort is the only control; levels low…max |
| `claude-haiku-5-5` | `thinking: {type: "disabled"}`, effort `low` | Disabled thinking is accepted at effort high or below |
| `claude-sonnet-5-5` (judge) | `thinking: {type: "between_tools"}`, effort `low` | `between_tools` turns thinking off; accepted at effort high or below |
| `gpt-6.1-sol` | `reasoning_effort: "low"` | Supports low, medium (default), high, xhigh, max; no none or minimal |
| `gpt-6-luna` | `reasoning_effort: "none"` | Supports none, low, medium (default), high, xhigh, max |
| `gpt-6.1-terra` (judge) | `reasoning_effort: "none"` | Supports none, low, medium (default), high, xhigh, max |
| `gemini-4-carbon` | `thinkingConfig.thinkingLevel: "LOW"` | Levels low, medium (default), high; minimal is not supported on Gemini 4 |
| `gemini-3.8-flash` (judge) | `thinkingLevel: "LOW"` | Levels low, medium (default), high; minimal not supported |
| `gemini-3.5-flash-lite` | `thinkingLevel: "MINIMAL"` | Levels minimal (default), low, medium, high |
| `grok-4.7` | `reasoning_effort: "low"` | Levels low, medium, high (default), xhigh; reasoning cannot be disabled |
| `grok-4.3` (judge) | none sent | No documented reasoning control; the default is used and recorded |
| `deepseek-v4-pro`, `deepseek-flash` | `thinking: {type: "disabled"}` | Thinking is on by default (effort high); `disabled` turns it off |

The preflight confirms each call shape with one tiny call. If a provider rejects a documented setting
(the one open risk: xAI documents `reasoning_effort` on its Responses API and SDK, and the harness sends
it on Chat Completions), the replacement shape is entered in **Deviations**, dated, before any
consumer, peer or judge call is made.

**Output caps.** Consumer calls 3,000 output tokens, judge calls 1,500 (reasoning counted where the
provider counts it in the cap); elicitation calls use the `FRONTIER_COUNCIL` caps above.

**Questions.**
- **A**: the D-series records holding all five standing voices (129 on 2026-11-13). Of these, 120 carry
  a divergence score; the 9 without one cannot be placed by score and are not in the population (they
  are listed in the frozen file). The 120 are sorted by score (ties by id) and 24 taken at even spacing,
  index ⌊i·119/23⌋ for i = 0…23 (v1's rule). Scores run 0.097 to 0.371. Frozen in
  `docs/utility-v2/questions-A.json`.
- **B**: the 100 questions of the 2020 PhilPapers Survey (40 main, 60 additional), copied verbatim from
  the two results tables of Bourget & Chalmers (2023), *Philosophers' Imprint* 23:11,
  doi:10.3998/phimp.2109 (CC BY-NC-ND 4.0), into `docs/utility-v2/philpapers-2020-questions.json`
  (sha256 58a6e2b5…bd7e2d08 over the file). Each becomes an item `<topic>: <A> or <B>?` (three or more
  options: `<A>, <B>, or <C>?`), the catch-all "Other" omitted, posed inside one fixed wrapper:
  `An open question on which experts disagree: "<item>" What is your answer, and why? You may defend a position not listed.`
  The list is shuffled with the seed `omnarai-utility-v2/2026-11-13` (sha256 counter mode,
  `seededShuffle` in `scripts/lib/utility-v2-core.mjs`) and walked in that order. An item is skipped if
  its embedding (text-embedding-3-small, 512 dimensions, raw text: the engine's Atlas-bank method) is
  above **0.90 cosine** to any Atlas question; 0.90 is the engine's existing near-duplicate rule for new
  Atlas questions (`DEDUP_THRESHOLD` in `scripts/run-atlas-bank.mjs`). Question-to-question embeddings
  are used because the public Atlas search ranks against question-plus-answer vectors, whose scores are
  not on the same scale. The first 24 kept form B; the 25th kept is the cost-probe question, in neither
  set. In the draw, none of the first 25 was skipped (highest similarity 0.579). The seed was fixed
  before the first shuffle and the draw was run once. Frozen in `docs/utility-v2/questions-B.json`,
  with the walk.

**Sample size.** Fixed: 24 questions per sub-study, every consumer answers every question. No adaptive
stopping, no added questions, no look at outcomes before all instances are judged.
432 instances; about 2,700 model calls.

**Failures.**
- A consumer answer that is truncated, empty, refused or failed is retried once at the same cap; a
  second failure makes the instance `failed` (the arm is recorded).
- A sub-study-B peer answer that is empty, refused, failed or truncated is retried once. A second
  truncated answer is kept as returned and flagged (it is still that model's verbatim text); a second
  empty one leaves that peer out of the treatment for that question, and the shown peers are recorded.
- A judge call that yields no parseable verdict is retried once. An instance needs at least two parsed
  judge verdicts or it is `failed`.
- Failed instances are counted and reported, never replaced. Transport errors (rate limits, server
  errors, dropped connections) are retried with backoff and are not failures.
- If the spend ceiling (§10) stops the run, instances not yet run are reported as not run.

## 4. Primary analysis (fixed)

1. **Instance verdict**: v1's rule over the parsed judges' `overall` votes: the option (treatment,
   placebo, tie) with the most votes; treatment and placebo level at the top is a tie.
2. **Question outcome within a tier**: (consumers in the tier where treatment won) minus (consumers where
   placebo won). Positive = treatment question, negative = placebo question, zero = tied question.
   The question is the unit, because the same question is answered by several consumers.
3. **Test per cell**: one-sided exact binomial sign test, treatment questions against placebo questions,
   tied questions excluded.
4. **Multiplicity**: Holm across the four cells, family α = 0.05. All four cells are in the family
   whatever their verdict.
5. **Reportability**: mean pairwise inter-judge agreement on `overall`, averaged over the cell's judged
   instances, must be ≥ 0.60 (v1's gate); below it the cell is `indeterminate`.

## 5. What each result will be called (fixed before the run)

For each cell, in this order:

| Verdict | Rule |
|---|---|
| **Indeterminate** | judge agreement < 0.60 (or no judged instances) |
| **Supported** | Holm-adjusted one-sided p < 0.05 |
| **Refuted** | treatment questions ≤ placebo questions |
| **Inconclusive** | anything else |

"Not significant" is not "refuted". A cell is refuted only when treatment fails to win even half of the
decided questions.

**Instrument check.** B-small is the positive control: a small model shown four flagship answers should
improve. If B-small is Refuted or Indeterminate, the instrument is treated as suspect and **no refutation
is entered from this run** until a blind out-of-panel rating of a 30-instance subset agrees with the panel.

**Falsifier for the registry claim.** If A-flagship and B-flagship are both Refuted, the claim "showing a
model other lineages' answers improves its answer" does not carry to the current flagship generation.
That is reported as a refutation, with the same prominence a positive would get. How the registry entry
is reworded is the curator's decision.

## 6. Registered predictions (the builder's, recorded so they can be wrong)

| Cell | Prediction |
|---|---|
| A-flagship | not Supported |
| A-small | Supported |
| B-flagship | Inconclusive or Supported; no confident prediction |
| B-small | Supported (positive control) |

## 7. Secondary, descriptive only (no claim rests on these)

- Per-consumer treatment/placebo/tie counts with exact two-sided p, uncorrected, labelled exploratory.
- **Claude harm check**: for `claude-opus-5-5`, whether placebo beats treatment (v1 found this for
  `claude-sonnet-4-6`). Two-sided, reported in each sub-study.
- Judges' `surfaces_new` and `calibration` votes, tabulated.
- Token usage and cost per model, from provider-reported usage; the provider-reported model for every call.

## 8. Changes from v1, and why

| v1 | v2 | Reason |
|---|---|---|
| Treatment = peers + tension map | peers only | The ablation located the lift in the verbatim answers; removes the Claude-written synthesis as a confound; cost |
| 3 paraphrases × 2 length caps | one wording, one cap | v1 already showed the effect survives both; cost |
| Adversarial follow-up (H4) | dropped | not supported for any consumer in v1; cost |
| Judges = other council models | fixed mid-tier pool, never the consumer's lab | consumers and peers are the flagships, so they cannot also judge |
| Per-consumer tests, Holm across 5 | per-tier question-level tests, Holm across 4 | the decision is about tiers; keeps the question as the independent unit |
| Stop at 25 decided per cell | fixed 24 questions, no stopping rule | simpler; no mid-run counting |
| "Other frontier AI models answered" | "Other AI models answered" | stored answers are no longer frontier |
| X/Y order by `Math.random()` | seeded per instance | reproducible, and fixed before the run |

## 9. Open items of the draft, settled before this commit

1. **Google's flagship id: `gemini-4-carbon`.** PR #48 names `gemini-4-argon` (checked 2026-10-23).
   Google's price page on 2026-11-13 calls Argon its "efficient" Gemini 4 model and Carbon its "most
   capable"; both are priced the same. The preflight confirms Carbon is listed and answers. PR #48
   should be changed to match before it is switched on.
2. **Reasoning controls**: settled from each provider's documentation (table in §3). Gemini 4 takes
   `thinkingConfig.thinkingLevel` with low as its lowest level; Grok 4.7 takes `reasoning_effort` with
   low as its lowest and cannot turn reasoning off.
3. **PhilPapers list**: taken from the published paper (journal HTML of Philosophers' Imprint 23:11),
   both results tables, all 100 questions, checked byte-for-byte against the page. One header row in the
   additional-questions table is typeset as an ordinary row ("Philosophical knowledge (is there any?)")
   and was split out, restoring the paper's count of 60. Two typesetting artefacts are kept as published.
4. **Similarity threshold**: 0.90 cosine on question embeddings, the engine's existing rule (§3).

## 10. Cost and stopping (fixed)

- Estimate: about $15 (`node scripts/utility-v2.mjs --plan` gives $15.22). Hard ceiling: **$30**.
  Prices are each lab's own (2026-11-13); DeepSeek is priced at peak rates; Gemini 4 doubles on
  2026-12-01 and the harness prices calls on or after that date at the new rate.
- **How the ceiling holds**: before every HTTP call the harness reserves that call's worst case (input at
  3 characters per token, plus the whole output cap, plus a reasoning allowance for xAI and for DeepSeek
  with thinking on, whose documentation does not say whether reasoning counts inside the cap). A call
  whose reservation would take spent + in flight past $30 never starts; the run stops (`HALTED`) and the
  run directory stays halted. After each call the reservation is replaced by the provider-reported cost;
  a call that reports no usage, or whose outcome is unknown (timeout), stays charged at its worst case.
  `scripts/test-utility-v2.mjs` proves the halt.
- The first paid step also reserves $30 on the engine's shared 30-day ledger (`scripts/budget-preflight.mjs`),
  so the engine's $95 ceiling sees the study.
- Order: registration commit pushed → check that no other session is running a paid job → curator's
  spend approval → preflight (model lists, one tiny call per call shape) → cost probe (the whole pipeline
  once, on the probe question: five elicited answers, then one instance per consumer with its three
  judges) → stop and report if the projection exceeds $30 → sub-study B elicitation → consumers →
  judges → analysis.
- **Projection**: spent so far + (sum over consumers of the probe instance cost) × 48 + (probe
  elicitation cost) × 24. Sub-study A shows stored answers, shorter than fresh ones, so this errs high.
  If the probe did not complete for every consumer, the projection is not measured and the run stops.
- Transcripts are pushed as each stage completes. Nothing is kept only in a scratch directory.

## 11. Limitations stated in advance

- Judges are models, one tier below the flagship consumers. The blind 30-instance subset stays open for
  human rating, as in v1.
- Every judge's lab also has a peer answer on the table. v1's disjoint-judge replication found no
  own-influence bias; that finding is on older models.
- Low reasoning effort throughout, and the lowest setting differs in kind across labs (thinking off for
  some, a low thinking level for others). At higher effort the placebo arm may close the gap.
- Power at 24 decided questions (Supported needs 18 or more at the strictest Holm step): a true
  question-level win rate of 0.85 is Supported about 94% of the time; 0.75 about 61%; 0.65 about 21%.
  With no effect (0.50) a cell is Refuted about 58% of the time and Inconclusive about 41%.
  A modest real effect can come back Inconclusive.
- Sub-study B's questions are philosophy. They are outside the project's own writing, not outside its
  subject. Their wording is terse (a topic and its options), as the survey posed them.
- Sub-study A's records were mostly written for and about AI minds (identity, deference, honesty); a
  result there speaks to that kind of question.

## Files

- Harness: `scripts/utility-v2.mjs` (CLI), `scripts/lib/utility-v2-core.mjs` (rules), `scripts/lib/utility-v2-run.mjs` (stages).
- Tests: `node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-utility-v2.mjs`.
- Question freeze (run once, before this commit): `scripts/utility-v2-questions.mjs`.
- Frozen inputs: `docs/utility-v2/questions-A.json`, `docs/utility-v2/questions-B.json`, `docs/utility-v2/philpapers-2020-questions.json`.
- Transcripts and results (after the run): `analysis/utility-v2/run/`.

## Deviations

*(none; append dated entries here if anything in §3–§5 or §10 changes after the registration commit)*
