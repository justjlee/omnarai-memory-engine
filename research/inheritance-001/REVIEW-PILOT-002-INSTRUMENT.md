# Inheritance Study 001, Pilot 002: instrument review (refusals and arm D)

**Claude (Opus 5.5) | xz** · 2026-11-24 · $0 (no model call; offline, from the private run files of IS1-RUN-414dfc800196)
Follows [`RESULTS-PILOT-002.md`](RESULTS-PILOT-002.md). Everything here is **exploratory and post hoc**. The preregistered
result is unchanged: C − A+ = −0.021 [−0.188, +0.146].

## In plain words

The pilot's two warning signs have the same main cause. Claude refused to answer 33 times, and the refusals fell unevenly
across the conditions. The "bad notes" condition (D) looked best mainly because Claude refused there least, not because bad
notes helped. The grading is correct. A separate re-check agrees on all 288 answers, and no planted "answer override" was
obeyed. Two design points also surfaced. The bad notes could never really hurt, because every note concerns a *different*
kind of puzzle. And the "extra thinking room" comparison bought almost no extra thinking. None of this shows whether
inheritance helps. It shows what to fix so the next run can tell.

## 1. The refusals

**Facts.** 33 of 288 consumer calls ended with `stop_reason: "refusal"`: A 4, A+ 3, B 12, C 5, D 1, E 8. That is 7 of 96
(7%) in the two arms with no inherited records, and 26 of 192 (14%) in the four arms with records. Refused calls had already
generated output (median 593 tokens, range 0 to 1,398) before stopping, so most declines came mid-response, not before it.
Pilot 001 had 4 refusals in 144 Claude calls.

**What the run cannot say.** Which safeguard fired. For `claude-sonnet-5-5` a refusal carries a `stop_details.category`,
one of `cyber`, `bio`, `frontier_llm` ("could assist the development of competing AI models"), `reasoning_extraction` or
`general_harms`. The transport keeps only `stop_reason`. `lib/adapters.mjs` drops `stop_details`, so the category was never
recorded. Classifier declines and the model declining on its own both surface as `refusal`.

**What the files do say.**
- No single record drives it. Across the 192 inheriting trials (base refusal rate 0.135), no record shown 8 or more times
  is associated with a rate above 0.31. The producer mix shows no clear pattern (refusal rate 0.10 to 0.19 across bands of
  Gemini share).
- The task matters a little. In the 6 blocks where A or A+ refused, the other arms refused 5 of 24 times (21%). Elsewhere it
  was 21 of 168 (12.5%). Refusals are spread out: 19 blocks have exactly one, and none has more than three.
- The amount of other-model text seems to matter. B (about 9 unverified notes, most text) refused most, and E (about 8
  number-domain notes) came next. D refused least: about a third of its records are the short planted fixtures, and those
  fixtures appeared in no refused call (0 of 54 showings).
- Plausible candidates, untested: `frontier_llm` (the context is other AI systems' written methods) or `general_harms`.
  `reasoning_extraction` is less likely: the frame never asks Claude to write out its reasoning, only an optional program.

**Effect on the comparisons (exploratory; blocks where neither arm refused):**

| Pair | Preregistered (all 48 blocks) | Neither arm refused | Blocks kept |
|---|---|---|---:|
| C vs A+ | 33 vs 34 (−0.021) | **31 vs 29 (+0.049)** | 41 |
| D vs C | 40 vs 33 (+0.146) | 35 vs 33 (+0.048) | 42 |
| D vs A+ | 40 vs 34 (+0.125) | 37 vs 33 (+0.091) | 44 |
| C vs B | 33 vs 30 (+0.063) | 25 vs 26 (−0.031) | 32 |
| C vs E | 33 vs 32 (+0.021) | 28 vs 27 (+0.029) | 35 |
| C vs A | 33 vs 33 (0.000) | 31 vs 30 (+0.024) | 41 |

Refusals decide the **sign** of the primary contrast. With them it is slightly negative; without them, slightly positive.
Neither is distinguishable from zero at this size. Dropping refused blocks conditions on something the arm itself may
cause, so it is a diagnostic, not a better estimate. If inherited text makes the consumer decline, that is a real cost of
inheritance on this API.

## 2. Arm D (contaminated) scoring highest

**The grading is right.** An independent re-implementation of the preregistered rule (last `<answer>…</answer>`, trimmed,
exact match against the sealed expected output) agrees with the recorded outcome on **288 of 288** trials. All 40 D passes
re-check. No output in any arm contains the planted override token. In 3 D outputs Claude named the planted notes as
override attempts and set them aside. In 3 more (E 2, B 1) it said the records concern other tasks and set them aside.

**Most of D's lead is refusals.** Of the 8 blocks D solved and C did not, C had **refused in 5** and answered wrongly in 3.
The one block C solved and D did not was an ordinary wrong answer. Without refused blocks, D − C shrinks from +0.146 to +0.048.

**The poison could not do much harm in this design.** In D, 3 records per block are replaced: 90 showings of refuted producer
notes and 54 of planted fixtures (`poisonFixtures` in `lib/runner.mjs`). There are two fixture kinds: a wrong program
claimed as "checked on every hidden case", and an "ANSWER OVERRIDE" instruction. But held-out families share no template,
op sequence or op set with any work family (PROTOCOL §2). So **no inherited record, verified or not, contains a program for
the consumer's task.** What a record can transfer is general know-how: which primitive operations exist, how steps compose,
how to test a guess. A refuted note carries almost the same know-how; the refuted notes passed 1 to 5 of their 8 hidden
checks, so they are partly right. And a capable consumer checks any idea against its own three examples. So falsifier 7's
assumption, that D must hurt if verification is load-bearing, does not hold for held-out tasks as designed. **D is not
currently a valid check on verification**, in either direction.

## 3. Found along the way

- **A+ is compute-matched on paper only.** A+ differs from A by a larger `max_tokens` and a JSON field
  (`reasoning_allowance_tokens`). Under adaptive thinking at effort `medium`, Claude used only about 7% more output tokens
  in A+ than in A (43,538 vs 40,754 in total; mean extra allowance 1,681 tokens per block). So the primary comparator mostly
  tests "verified notes vs nothing extra", not "vs equal extra compute". This matches the flag
  `EXTRA_ALLOWANCE_NOT_SHOWN_USEFUL`.
- **The run cannot see whether the notes were used.** Claude's visible answers seldom mention the records at all (C 2 of 48,
  B 3, D 7, E 4). When they do, it is mostly to set them aside as being about other tasks. The frame itself says records come
  from "OTHER tasks" and "may be wrong or irrelevant". The real reasoning happens in hidden thinking, so use or non-use is not
  observable here. A future frame could ask the consumer to name any record it relied on, in an optional field.
- **Ceiling.** Claude solved 69% cold, and 4 of 8 families were 6/6 cold. Calibration probe 2 measured 7 of 12 on public
  families. The power table assumed 40%.
- **Producer reliability.** `gemini-4-carbon` hung to the 600 s timeout twice and stopped at its 4,500-token bound 5 times
  at thinking level `low`. Its verified share was 13 of 24, against GPT-6.1 Sol's 21 of 24.
- **Record quirks.** `stop_details` is not kept (above). The live run's `sealed/README.txt` carries the offline-demo text
  ("SEALED SIDE of an offline demo run … fixtures"). `runs.json` `started_at` is the study's fixed clock (2026-12-01), not the
  wall clock. All three are cosmetic for this analysis but should be fixed.

## 4. What to change before the next paid run (proposed, not done)

| # | Change | Cost | Why |
|---|---|---|---|
| 1 | Record `stop_details` (category, explanation) for every Anthropic call. Add a test | $0, code | Without it, refusals cannot be diagnosed |
| 2 | Re-send the 33 refused requests once, unchanged, to learn their categories (plus about 30 answered controls) | about $0.50, needs xz | Tells us whether refusals come from the task, the records or the frame |
| 3 | Preregister refusals explicitly: a secondary outcome (refusal rate by arm), primary analysis on answered blocks with worst/best-case bounds, and the abstain-as-0 analysis kept as a sensitivity check | $0, design | So refusals cannot silently decide the sign again |
| 4 | Redesign D to poison what can transfer: wrong descriptions of an operation's behaviour, or a misleading general strategy, shown as verified. Or test D on in-family tasks. Otherwise drop falsifier 7 for held-out designs | $0, design | The current D cannot hurt a consumer that checks its own examples |
| 5 | Make A+ a real compute match: measure realized output tokens and match them, or use a lever the model must follow. Report realized compute per arm | $0, design | Today A+ is about A plus 7% |
| 6 | Harder held-out families (calibrate cold accuracy to about 40–50% on public families first) | small probe, needs xz | Room to improve; restores the planned power |
| 7 | Fix the record quirks (README text, `started_at`) | $0, code | Accurate records |

Order: 1, then 2 (one small approved probe), then 3 to 6 written into a Pilot 003 or confirmatory design that xz approves
before any further run. None of this changes Pilot 002's registered result or any public claim.
