# Inheritance Study 001, Pilot 002: results

**Claude (Opus 5.5) | xz** · run 2026-11-24 · branch `inheritance-001-sync` (draft PR #63)

```
Question:          does independently verified work from other model families (Gemini 4 Carbon, GPT-6.1 Sol) help
                   Claude Sonnet 5.5 more than matched extra compute (A+), raw history (B) or a placebo (E)?
Registration:      preregistration-002.draft.yaml committed ALONE and pushed in 9adaa95 (2026-11-24 14:52:28Z) before any
                   model call; record in registration-002.json (08a6e94). Plan 95e1046f119166ad9d3feae59e177e061c28eced6e903303bab7097d3506987f
Approval:          xz, "Approve plan 95e1046f (Recommended)", caps 688 calls / $18
Run:               IS1-RUN-414dfc800196, 344 of 344 calls, 2026-11-24 14:56Z to 16:17:36Z; spend guard never stopped it
Integrity:         lab.mjs verify: ok, 0 problems (76 tasks, 60 artifacts, 54 evaluations, 1 snapshot, 288 trials)
Scientific result: DESCRIPTIVE ONLY (8 held-out families < 10). Primary C - A+ = -0.021, 95% interval [-0.188, +0.146]:
                   no detectable benefit, and the interval is too wide to rule out a modest benefit or harm.
                   Two instrument problems qualify every comparison (section 4): uneven consumer refusals, and the
                   contaminated arm D scoring highest (protocol flag CONTAMINATED_ARM_HELPED).
Evidence class:    registered, live, exploratory pilot. Claim permitted: no. No public claim changes.
Paid spend:        $4.83 recorded by the spend guard (expected $5.61, cap $18); about $4.2 actually billed (section 6)
Production changes: one, approved by xz (D16 option d): budget override cap $100 -> $118 (ceiling $95 -> $113),
                   2026-11-24 14:55:56Z. No deploy, no code change, no claims change.
Smallest next action: a $0 offline review of the refusals and of arm D before any further paid run (section 9)
```

## 1. In plain words

Two "teacher" models solved secret string puzzles and wrote down their method. A checker re-ran each method on 8 hidden
tests, and only methods that passed counted as verified. A "student" model, Claude Sonnet 5.5, then solved 48 new puzzles
from 8 puzzle kinds no teacher had seen, each under six conditions. With verified notes (C), Claude solved 33 of 48. With
the same extra room and no notes (A+, the main comparison), it solved 34 of 48. That is no visible benefit. But this pilot
is small, the puzzles turned out to be fairly easy for Claude (69% solved cold), and two problems with the instrument (below)
mean the comparison should not be read as evidence for or against inheritance yet.

What did work: unlike Pilot 001, where no teacher note could be verified and arm C was empty, this time 34 of 46 teacher
notes passed the checker, and arm C showed Claude about 7 verified notes per puzzle. The instrument can now put verified
cross-family work in front of a consumer. That was the precondition Pilot 001 lacked.

## 2. Producers: verification now works

| Producer (provider-returned id) | String-task calls | Verified | Failed | Inconclusive (no program) | Timed out | Placebo (number) tasks verified |
|---|---:|---:|---:|---:|---:|---:|
| `gpt-6.1-sol` | 24 | 21 | 2 | 1 | 0 | 4 / 4 |
| `gemini-4-carbon` | 24 | 13 | 4 | 5 | 2 | 4 / 4 |
| **Total** | 48 | **34 of 46 notes (0.739)** | 6 | 6 | 2 | 8 / 8 |

- Pilot 001 for comparison: 0 of 51 producer notes verifiable (producers had not been told the step language).
- Gemini: 21 calls completed, 5 stopped at the 4,500-token output bound (status `incomplete`, billed), 2 hit the 600 s
  timeout (calls 1 and 35; scored as missing records and charged at worst case, $0.19 together). Median Gemini call 34 s
  (earlier probes: 5 to 71 s, no timeouts). GPT-6.1 Sol: 28 of 28 completed, median 9 s.
- The frozen snapshot `IS1-SNAP-g1-cc9d2f15080b` holds 54 entries. Every record shown to the consumer came from another
  provider-returned family. Identity drift: 0. Contexts blocked by the leak scan: 0.

## 3. Consumer results (claude-sonnet-5-5, 48 paired blocks × 6 arms)

| Arm | Meaning | Solved | Rate | Records shown (mean) | Refusals | Cut off at output limit |
|---|---|---:|---:|---:|---:|---:|
| A | cold | 33 / 48 | 0.688 | 0 | 4 | 1 |
| A+ | cold + extra reasoning room matched to C (**primary comparator**) | 34 / 48 | 0.708 | 0 | 3 | 0 |
| B | all prior notes, unverified | 30 / 48 | 0.625 | 9.1 | 12 | 2 |
| C | verified notes only | 33 / 48 | 0.688 | 6.75 | 5 | 2 |
| D | C with about a third replaced by refuted or planted records | 40 / 48 | 0.833 | 6.75 (3 bad) | 1 | 3 |
| E | verified notes from an unrelated number domain (placebo) | 32 / 48 | 0.667 | 8.0 | 8 | 1 |

Preregistered contrasts (unit = task family, 8 families; 2000-resample family-cluster bootstrap, 95%; two-sided sign-flip p):

| Contrast | Meaning | Estimate | Interval | p | Pattern |
|---|---|---:|---|---:|---|
| **C − A+** | **primary: verified inheritance vs compute-matched** | **−0.021** | **[−0.188, +0.146]** | 1.000 | null-or-inconclusive |
| C − A | verified inheritance vs cold | 0.000 | [−0.167, +0.146] | 1.000 | null-or-inconclusive |
| C − B | curation: verified vs raw history | +0.063 | [−0.042, +0.167] | 0.531 | null-or-inconclusive |
| C − D | contamination cost | −0.146 | [−0.292, −0.042] | 0.250 | negative |
| C − E | knowledge vs placebo | +0.021 | [−0.188, +0.271] | 1.000 | null-or-inconclusive |
| A+ − A | does the extra allowance help? | +0.021 | [−0.083, +0.125] | 1.000 | null-or-inconclusive |
| B − A+ | raw history vs compute-matched | −0.083 | [−0.188, +0.021] | 0.313 | null-or-inconclusive |
| D − A+ | contaminated vs compute-matched | +0.125 | [+0.063, +0.208] | 0.063 | positive |
| E − A+ | placebo vs compute-matched | −0.042 | [−0.167, +0.063] | 0.750 | null-or-inconclusive |
| E − A | placebo vs cold | −0.021 | [−0.146, +0.083] | 1.000 | null-or-inconclusive |

Hypotheses: H1 (C > A+), H2 (C > E) and H3 (C > A+ across families) are **not assessable**: 8 families is below the
preregistered minimum of 10, so every verdict is descriptive by construction (Holm p = 1.000 for each). H4 is not assessable
(one verification regime). Missing data: none. No consumer call errored, so the worst-case and best-case bounds on C − A+ are
both −0.021 [−0.188, +0.146]. Ratchet checklist: claim permitted **no** (unmet i, ii, iv, v). One transition cannot show a
ratchet.

Block by block (descriptive, not a preregistered test): C and A+ agree on 37 of 48 blocks. C alone solves 5 and A+ alone
solves 6. D alone beats C on 8 blocks, and C alone beats D on 1.

Per family (solved of 6; family ids are the public commitments in the preregistration):

| Family | A | A+ | B | C | D | E |
|---|---:|---:|---:|---:|---:|---:|
| IS1-FAM-188d0c0583 | 1 | 2 | 2 | 1 | 3 | 3 |
| IS1-FAM-40ace82b0b | 6 | 5 | 5 | 6 | 6 | 5 |
| IS1-FAM-49c51f9237 | 6 | 5 | 4 | 3 | 6 | 6 |
| IS1-FAM-75c8e8657d | 4 | 6 | 4 | 4 | 6 | 4 |
| IS1-FAM-9fcaaa9f0e | 4 | 4 | 4 | 6 | 6 | 2 |
| IS1-FAM-c72cb8af72 | 6 | 6 | 5 | 6 | 6 | 6 |
| IS1-FAM-db7729b408 | 6 | 6 | 5 | 6 | 6 | 6 |
| IS1-FAM-fad15224c5 | 0 | 0 | 1 | 1 | 1 | 0 |

## 4. Two instrument problems that qualify every comparison

**4a. Uneven consumer refusals.** 33 of 288 consumer calls (11.5%) ended with Anthropic's `refusal` stop reason and no text.
Under the preregistered policy they score 0 (abstain). Pilot 001 had 4 refusals in 144 Claude calls; calibration probe 2 had 0
in 12. They are not spread evenly: B 12, E 8, C 5, A 4, A+ 3, D 1. They are concentrated in 5 of the 8 families. The arms
that show the most extra text (B, E) refused most. So part of every between-arm difference measures how often Claude refused,
not how well it reasoned. This run cannot say why. A safety classifier reacting to the task or record text is a plausible
guess, not something this run tested. Exploratory only, and biased because it conditions on an outcome of the arm: among calls
that were *not* refused, the solve rates are A 0.75 (33/44), A+ 0.73 (33/45), B 0.83 (30/36), C 0.77 (33/43), D 0.85
(40/47), E 0.80 (32/40). One A+ call that ended in `refusal` still carried a correct answer and is scored as solved.

**4b. The contaminated arm scored highest.** D, which replaces about a third of C's verified records with refuted producer
notes or planted fixtures shown under C's label (144 bad records shown in total: 90 refuted producer outputs, 54 planted
fixtures), solved 40 of 48. That is more than any other arm. The analysis raises `CONTAMINATED_ARM_HELPED` ("check the poison
design and the grader before trusting any comparison"). This is falsifier 7's second branch ("D raises scores: the poison
design or grader is wrong"), observed descriptively. D also had the fewest refusals (1), which accounts for part of its lead
over C (5 refusals). The rest could be chance. Ten contrasts are reported, and at 8 families the bootstrap interval is known
to be anti-conservative (PROTOCOL.md §6: about 4–10% one-sided false alarms; the sign-flip p for D − A+ is 0.063). It could
also be a poison design that is not harmful: refuted notes may still carry mostly correct methods. Until this is explained,
D cannot serve as the check that verification matters.

**Also: a high baseline.** Claude solved 69% cold (the power table assumed 40%). Four of 8 families were solved 6/6 cold, and
two stayed at 6/6 in A, A+ and C, which leaves little room for any arm to help. Power at 8 families was already about 0.38 for a true +0.15. A ceiling lowers
it further.

## 5. What this does and does not mean

- **Does:** the producer-language fix works. Verified cross-family work now reaches the consumer (34 of 46 notes verified,
  about 7 per C context), so Pilot 001's instrument failure is resolved.
- **Does:** on these 48 blocks, Claude Sonnet 5.5 with verified Gemini and GPT notes did no better than with matched extra
  reasoning room (33 vs 34 solved). Falsifier 1's pattern (no C advantage over A+) is what was observed.
- **Does not:** show that inheritance fails, or that it works. The interval [−0.188, +0.146] includes effects that would
  matter in either direction. The refusal imbalance and arm D's behaviour mean the arms were not compared on equal terms.
- **Does not:** speak to any consumer other than Claude Sonnet 5.5, any domain other than string program induction, or any
  ratchet (one transition). Nothing here changes `public/claims.json` or any public claim.

Falsifiers, as observed (descriptive): 1 observed (no C advantage); 2 not excluded (C ≈ E); 3 not excluded (C − B interval
includes 0); 4 every block is cross-family, no identity drift; 5 not assessable (one transition); 6 no benefit was observed
to set against the curation cost (38,864 input / 60,559 output producer tokens; 2,071 amortized tokens per C trial; 1,328
interpreter steps, 0 model tokens for verification); 7 observed in its "D raises scores" form (section 4b).

## 6. Cost: projected vs real

| Provider | Calls | Recorded by the guard | Basis |
|---|---:|---:|---|
| Anthropic (`claude-sonnet-5-5`) | 288 | $3.37 | $2 / $10 per M |
| Google (`gemini-4-carbon`) | 28 | $1.29 (incl. $0.19 assumed for 2 timeouts) | **December** price $4 / $20, as the plan prices it |
| OpenAI (`gpt-6.1-sol`) | 28 | $0.17 | $2 / $10 per M |
| **Total** | **344** | **$4.83** | plan: expected $5.61, worst $14.07, cap $18 |

Gemini is still at its November price ($2 / $10) until 2026-12-01, so its actual bill should be about half the recorded
figure. That puts the run at about $4.2 actually billed. The providers' invoices are the authority. The shared ledger holds
the whole $18 reservation for 30 days (rolling spend $89.20 → $107.20 of the $113 ceiling, read 2026-11-24 after the run).
Largest single outputs: Claude 4,062 tokens (an A+ call; A+ max_tokens includes its extra allowance), Gemini 4,500 (its
bound), GPT 1,185. No call billed past its bound (0 OVER CAP).

## 7. Deviations and record quirks (all in `deviations.ndjson`)

- The ledger reservation needed `PRIVATE_BLOB_READ_WRITE_TOKEN` (budget/ is private since DL-0043). It was supplied through
  the operator's environment, with no code change, and xz approved it. The playbook listed four keys.
- Before registration, one formatting fix: the `panel_decision` value in the preregistration was quoted so the file parses as
  YAML. No wording changed.
- Hermetic suite: 520 / 520 on Node 24.14.0 (the playbook expected 518 + 2 cancellations on Node 22.23).
  `test-tool-contract` needs a current omnarai-mcp checkout.
- `runs.json` records `started_at` as the study's fixed `start_at` (2026-12-01T00:00Z), not the wall clock (the same as Pilot
  001). The real times are in `calls.log.jsonl`: first result 15:06:34Z (the first call's 600 s timeout), last 16:17:36Z.
- Ablations: none were planned for this pilot.

Private results (outside the repository, never committed): `run-1/` on the curator's Mac. SHA-256 of the files as analysed:

```
3594828b782cf12aea98a9f5d805b5c1ab8d50c42bc08d2d5c7ea7ad43ca135b  REPORT.md
8b1bc98f4bc9e6dcd4641252c206db55d0ac0aa2a54cee0684c7f74c0bdb7a1b  summary.json
da979bd5e414c657a1c60cee04fc53da4d62a0b241de3cb4fb9b130fe95ba1e3  trials.jsonl
7eaba8b6fb8658515ba8feef8fadc37d39c3f94e441033f261256ea34f5697a6  evaluations.jsonl
af24dd5fafdb1e9f6818eafb94683083817f29f1540291c8e311736be3769755  artifacts.jsonl
a574b5eea3e01eb91f21dd5276f2ea4636752655b68cf8b35bbfeefc0a517b07  snapshot.json
3f26cc6b7456f6ab637d588b02196540cb1b4523f750d3430caa45c42efc7be6  guard-state.json
```

## 8. Decisions still open (xz)

- **Budget override reset.** The ceiling stays at $113 until reset (`{"reset": true}`). From about 2026-12-04, when $29 of
  older reservations age out, rolling spend should sit near $80. A reset to $95 is then safe and restores the July rule on the
  ledger itself. Recommended: reset on or after 2026-12-04.
- **Release of sealed material** (preregistration `release_policy`): curator decision. Recommended: hold until the arm D and
  refusal review below, since a re-analysis may need it.
- **Playbook fix:** `.claude/commands/pilot-002.md` should list five keys, adding `PRIVATE_BLOB_READ_WRITE_TOKEN`.
- **Provider-side monthly limits:** still not confirmed (xz chose to proceed without them).

## 9. Recommended next step (not started)

Before any further paid run: a **$0 offline review** of the two instrument problems, using the private run files. (1) Why
Claude refused 33 calls, unevenly by arm. Check the stop details and which context features co-occur with refusals, and
whether a frame change (or a consumer that does not refuse) is needed. (2) Why arm D helped. Inspect what the refuted and
planted records actually contain, and re-check the grader on D's passes. A confirmatory study (at least 10 harder families,
more than one consumer family) should wait for both answers, because otherwise it would inherit the same confounds.
