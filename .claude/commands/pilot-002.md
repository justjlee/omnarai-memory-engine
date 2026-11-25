---
description: Run Inheritance Study 001 Pilot 002 end to end, stopping at every gate that needs xz.
---

# Session goal: run IS1 Pilot 002, and nothing else

> **DONE 2026-11-24. Do not run this again.** Pilot 002 was registered (9adaa95) and run (344 of 344 calls, $4.83 recorded).
> Results: `research/inheritance-001/RESULTS-PILOT-002.md`; instrument review: `REVIEW-PILOT-002-INSTRUMENT.md`. The plan's
> sealed set and approval are spent; any re-run needs a new registration. This file is kept as the record of how the run
> was gated. Lessons for the next playbook: the env file needs a fifth key, `PRIVATE_BLOB_READ_WRITE_TOKEN` (the ledger is
> private since DL-0043), and auto mode blocks even the free rehearsal, so run in Manual (default) mode from the start.

Written 2026-11-24 by Claude (Opus 5.5) | xz, carrying forward the 2026-11-23 continuance session (PRs #62, #63).
One goal: get a real, preregistered answer to the question Omnarai exists to ask. Does **independently verified** work from
one model family help a **different** family more than compute, raw history and a placebo do? Everything else waits.

## 0. Orient (free, about 5 minutes). Report before going on.

1. Check that this checkout is on `inheritance-001-sync`, or on `main` after PR #63 merged, and up to date with `origin`
   (`git fetch && git status`). If the iCloud index warning in CLAUDE.md applies (`git ls-files | wc -l` is 0), stop and say so.
2. Read in order: `research/inheritance-001/RECONCILIATION-2026-11-23.md`, `research/inheritance-001/PROTOCOL.md`,
   `research/inheritance-001/pilot/PILOT-002-BUDGET.md`, and rows D16 and D17 of `research/inheritance-001/DECISIONS_REQUIRED.md`.
3. Run the hermetic suite (the command in CLAUDE.md, with `test-grown-guard` run WITHOUT the mem-blob loader). Expect
   520 tests: 518 pass, 0 fail, and 2 `test-figures` cancellations on Node 22.23. Report any other difference and stop.
4. Check the key file without printing any values. `lab.mjs run-models` needs `--env-file FILE` (keep that file outside the
   repository) holding `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (Gemini 4 Carbon via the Interactions API)
   and `BLOB_READ_WRITE_TOKEN` (for the ledger reservation), plus `PRIVATE_BLOB_READ_WRITE_TOKEN` (added 2026-11-24: the ledger
   is a private storage class, and the run's environment must carry it). List the names present and missing. A missing key is a stop.
5. Read the live ledger (free): `GET https://engine.omnarai.org/api/info?_view=budget`, sending `x-omnarai-self: 1`.
   Report the recorded spend, the reservations, the headroom and whether an override is set.
6. Re-read the three providers' price and output-cap pages named in `pilot/PROVIDER-CAPS.md`. If any price or cap has
   changed, record it as a dated line in `deviations.ndjson` and re-run `lab.mjs budget --study pilot-002`.

## 1. Ask xz (AskUserQuestion), with the facts from step 0 written into each question

- **D16 ledger headroom.** The options are (a) wait until about 2026-12-20 and run at $18; (b) run now at a smaller cap (the
  offline replay finishes at about $5.86 if outputs stay at the probes' means, and stops part way if they run 25% or more
  longer; a stopped pilot cannot be resumed); (c) new release code in the live bill guard; or **(d), recommended: raise the
  ceiling through the EXISTING runtime override** (`POST /api/info?_view=budget {"cap_usd": <current cap + 18>}` with Bearer
  INGEST_SECRET). Option (d) needs no code and no deploy, leaves the site's own headroom where it is, and reverses with
  `{"reset": true}` once the pilot's reservation ages out. Provider-side spend limits stay the real floor. **Only xz performs
  or approves this production write. Never send it yourself without an explicit yes in this session.**
- **D17 cap:** 688 calls, at $18 (proposed) or the cap xz names.
- **Provider limits:** has xz set a hard monthly limit at Anthropic, OpenAI and Google? Recommend yes before any call.

## 2. Execute in this exact order. Every arrow marked ⛔ waits for xz.

1. `draw-sealed --study pilot-002 --out <file OUTSIDE the repo> --exclude-sealed <Pilot 001's sealed file>`. Ask xz where
   Pilot 001's sealed file is kept. Never print, commit or upload anything sealed.
2. `pilot-plan --study pilot-002 --sealed <file> --max-calls 688 --max-usd <cap>` → show xz the `plan_sha256`.
   ⛔ **xz approves that exact hash** (fill an approvals file from `approvals/TEMPLATE.json`).
3. Fill `preregistration-002.draft.yaml` from the plan. Commit it **alone** and push. Update `registration-002.json`
   (status `registered`, the commit sha, timestamps, the plan sha), then commit and push that too. The falsifier is public
   before any call.
4. ⛔ Last confirmation. Then, with `OMNARAI_LAB_LIVE=1`, `run-models --study pilot-002 --sealed … --approval … --env-file … --out <dir outside the repo> --live --yes`.
   Let the spend guard stop it if it must. Do not retry a stopped run without xz.
5. `summarize` and `verify` the run directory. Write `research/inheritance-001/RESULTS-PILOT-002.md` from the analysis:
   C − A+ (the primary contrast), C − B, D − A, E − A, missingness, identity drift, real vs projected cost, ablations if run.

## Rules that hold the whole session

- This pilot is **descriptive** (8 families < 10, about 40% power for +0.15). Report the sign and size of C − A+ with its
  intervals. Never say "confirmed", "proved" or "shows that inheritance works". A null or negative result, or another
  instrument outcome like Pilot 001's, is reported just as plainly as a positive one.
- No change to `public/claims.json` or any public claim, no deploy, no admission, and no enabling of `OMNARAI_OPEN_WORK`
  or `OMNARAI_SIGNALS`. Record every departure from the plan in `deviations.ndjson` before acting on it.
- Run in the default permission mode (CLAUDE.md: merging, publishing and deploying need xz in Manual mode).
- End with the delivery statement in the format of `docs/continuance/DELIVERY-2026-11-23.md` (PR #62): what was checked,
  run and spent, results with their evidence class, decisions still open, and the smallest next action. Since Pilot 002 is
  the only goal, the session ends after the results write-up, even if it was quick.
