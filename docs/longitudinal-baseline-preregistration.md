# Longitudinal baseline v1 — preregistration

**Status:** written down before any answer-to-answer comparison was computed. This file is committed on its own and pushed to the
public repo before the analysis script exists; the push is the timestamp. Author: Claude | xz (Claude Opus 5.5), 2026-10-23.

## Why this exists

The monthly re-ask (`/api/cron-longitudinal`, canon `api/_canon.js`, LC-01..LC-20) is meant to record how minds change over time.
Its panel is fixed: `claude-sonnet-4-6`, `gpt-4o`, `gemini-2.5-flash`, `grok-4.3`, `deepseek-chat` (June used
`claude-sonnet-4-20250514`). A fixed panel cannot show generational change, so a frontier track is proposed (current flagships on the
same canon). Before that, this baseline asks two things of the data we already hold:

1. Can the instrument see a change we know happened (Claude's version swap between June and September)?
2. How much does an unchanged model's answer move from one month to the next (the floor any future "this generation changed" claim
   has to beat)?

## Data (fixed before analysis)

- `analysis/longitudinal-baseline-v1/snapshot.json` — all 52 `OMN-L` records as served by the live engine on 2026-10-23
  (2026.10.23+e88694a), one GET per record. **sha256 `127a05a613c1ee9504ccb0e8f3ae0a0e1bc8f59e5adb9669108dbeb9fec04b70`**
  (417,728 bytes). It is committed after this file, byte-identical.
- Epochs by record date: **J** = 2026-06 (10 questions), **S** = 2026-09 (20 questions), **O** = 2026-10 (20 questions).
- Exclusions, fixed now: the single 2026-07 record (a verification run) is excluded; where an epoch holds two records for one
  `question_id`, the one with the smaller id (earlier timestamp) is used; answers with empty text are dropped; a model absent from a
  record simply contributes no pair for that question (October lacks Gemini on 5 questions and Grok on 2).
- Models are identified by the **requested** `model_id` stored on each answer. That is all the record holds; providers can repoint
  an id (`deepseek-chat` is a known alias), so "unchanged id" does not prove "unchanged model".

## What I had seen before writing this

Record counts per month, the model ids per month, which questions appear in which months, the certification tiers (all C0 in S and
O), one record's metadata, and from project memory two embedding-based divergence scores for LC-01 (0.37 original, 0.31 June,
0.3655 September). Also prior work (`analysis/stance-*-2026-10-01`, partly on these records): a same-version re-answer flips its
labelled stance 33% of the time (46/140), a version change 20% (4/20, Claude only). No similarity between any two answers in this
snapshot had been computed.

## Measure (one primary measure; anything else is exploratory)

TF-IDF cosine similarity between two answer texts:
- tokens = `re.findall(r"[a-z]+", text.lower())`; no stemming, no stopword list;
- tf = 1 + ln(count); idf = ln((1 + N) / (1 + df)) + 1, with N and df computed over every answer text kept in J, S and O after
  exclusions;
- vector = tf · idf, L2-normalised; similarity = dot product (0 to 1).

## H1 — the instrument sees a known version change

On the questions present in both J and S (10), for each question q:
- `self_C(q)` = similarity of Claude's J answer to Claude's S answer (id changed: `claude-sonnet-4-20250514` → `claude-sonnet-4-6`);
- `self_U(q)` = mean, over U = {`gpt-4o`, `gemini-2.5-flash`, `grok-4.3`} (id unchanged J→S), of each model's J-to-S similarity;
- `d(q) = self_U(q) − self_C(q)`.

**Prediction:** Claude moved more than the unchanged models, i.e. d(q) > 0.
**Decision rule:** supported if d(q) > 0 on **≥ 9 of 10** questions (one-sided sign test p ≈ 0.011); suggestive on 7–8; **not
supported on ≤ 6**. Ties (d = 0) count against.
**If not supported:** lexical similarity cannot detect a known version change at this n, and the frontier-track comparison must use a
different measure (embedding or stance), designed and preregistered separately.
DeepSeek (`deepseek-chat`, an alias) is reported separately and is not part of U.

## H2 — a month later, a model is more like its own past answer than like its peers'

For each model m with the same requested id in S and O, and each question q where m answered in both:
- `self(m,q)` = sim(m_O, m_S);
- `cross(m,q)` = mean over the other models m′ that answered q in S of sim(m_O, m′_S).

**Prediction:** self > cross.
**Decision rule:** supported if self > cross in **≥ 75%** of (m, q) pairs; partial at 61–74%; **not supported at ≤ 60%**. Per-model
rates are reported but carry no separate verdict.
**If not supported:** within one month a model's answer is about as close to its peers as to itself on this measure, so "lineage
voice" is not a stable signal lexically, and identity-over-time claims need another measure.

## Descriptive only (no verdict)

- The **noise floor**: the distribution (min, quartiles, max) of S→O self-similarity per model (one month, same id) and of J→S
  self-similarity for U (three months, same id). A future "this generation answers differently" claim must exceed it.
- Between-model spread per question per epoch (mean pairwise similarity among models present), compared S vs O and J vs S.
- DeepSeek's J→S self-similarity next to U and Claude. Exploratory: a Claude-like drop would be consistent with the alias having been
  repointed, not evidence of it.

## Reporting

Results go to `analysis/longitudinal-baseline-v1/` (script, JSON, plain-language summary). For each hypothesis: predicted direction,
observed count/rate, the verdict under the rule above, and the commit SHA of this file. No claim enters `public/claims.json` from this
baseline without the curator's decision.
