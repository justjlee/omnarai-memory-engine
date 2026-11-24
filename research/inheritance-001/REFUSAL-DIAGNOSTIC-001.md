# IS1-DIAG-REFUSAL-001: why Claude refused in Pilot 002

**Claude (Opus 5.5) | xz** · 2026-11-24 · $0.47 recorded (cap $0.50, approved by xz: "The $0.50 check is approved")
A diagnostic, not a study: nothing here enters any analysis or changes Pilot 002's registered result.

Plan `9cba9d37bf861e38440d26b2d033df95bac070686fe7a1d21dfc37e6a5fc3640` (`pilot/IS1-DIAG-REFUSAL-001-plan.json`). The plan
and its decision rule were committed alone and pushed in 4241fcf before any call; the tool is in 6ac4ed7 (`lib/resend.mjs`,
`lab.mjs resend`, tests RS1–RS5). There were 41 calls to `claude-sonnet-5-5` at effort `medium`, each byte-identical to a Pilot
002 request (its rebuilt text matched the run's recorded context hash). The 33 refused requests went first, then 8 controls:
one previously answered arm-B request per held-out family. All 41 ran, and the guard never stopped the run.

## In plain words

Every refusal came from one Anthropic safeguard, the category `reasoning_extraction`. Its explanation cites the terms'
"restrictions on reverse engineering or duplicating model outputs". It is partly random: sent again unchanged, 14 of the 33
refused requests refused again and 19 were answered. One of the 8 previously answered requests refused this time. It fires
most where the prompt carries the most text written by other AI systems.

## Results

| | Re-sent | Refused again | Answered | Category of every refusal |
|---|---:|---:|---:|---|
| Refused in Pilot 002 | 33 | **14** | 19 | `reasoning_extraction` (14 of 14) |
| Controls (answered in Pilot 002) | 8 | 1 | 7 | `reasoning_extraction` (1 of 1) |

- Refused again, by arm (of those re-sent): **B 7/12**, E 4/8, C 2/5, A 1/4, A+ 0/3, D 0/1.
- Timing: 5 of the 15 refusals came before any output, 10 after some output (mid-response).
- All 15 refusals carried the same explanation text, which also suggests configuring a fallback.
- The 19 previously refused requests that were answered this time all returned an `<answer>` tag. They were not graded here.

**Pre-committed rule:** R2 applies. Fewer than half of the 33 (14 < 17) refused again, so refusal on this input is
**mostly not reproducible**. R3: one control refused, which is reported and changes neither reading.

## What it means for the study

- Refusals in Pilot 002 are a provider safeguard firing at random, with a likelihood that depends on the prompt. They are
  not grading errors, and not a property of Claude's reasoning on the puzzle. They rise with the amount of other-model text
  in the prompt (B and E), so they are **not neutral across arms**: they bias every comparison involving inherited records.
- This looks like a false positive on a benign evaluation task (inducing a string rule from three examples, with other
  systems' method notes as evidence). But that is Anthropic's judgment to make, not ours.
- **Not options:** wording designed to slip past the safeguard; or a server-side fallback. For Sonnet 5.5, the documented
  fallback does not retry `reasoning_extraction` declines, and it would change the consumer model mid-study anyway.

## Options for the next design (D20, xz decides; none started)

1. **Measure refusals instead of scoring them as 0.** Preregister refusal as its own outcome by arm, run the primary
   analysis on answered blocks with worst- and best-case bounds, and keep abstain-as-0 as a sensitivity check.
2. **Remove what may read as a request for written-out reasoning,** if a calibration probe shows it matters. The visible
   frame carries a `reasoning_allowance_tokens` field. Anthropic's guidance for this category is not to ask the model to
   write out its reasoning in the response. A+'s allowance can be applied through `max_tokens` alone. This is a design
   clean-up to be measured, not a way around the safeguard.
3. **Add a second consumer family** (DECISIONS D8), so a result does not depend on one provider's safeguards.

Private files (outside the repository): `resend-records.jsonl`, `resend-summary.json`, `calls.log.jsonl`, raw outputs.
