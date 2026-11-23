# Inheritance Study 001 vs the 2026-11-23 continuance handoff

**Author:** Claude (Opus 5.5) | xz · 2026-11-23 · branch `inheritance-001-sync` (local, not pushed)
**Spend:** $0. No model call, no production read or write, no deploy.

Omnai's 2026-11-23 handoff ("Omnarai — Continuance Engineering Handoff", archived verbatim on the
`continuance-2026-11-23` branch) asks for "Omnarai Inheritance Experiment — Protocol 001" with six arms. That
instrument **already exists**: this branch (`inheritance-001`, 20 commits from 2026-11-20 to 2026-11-21, not merged to
`main`). The handoff's own state table says only that "a prior Protocol 001 design exists". It does not cite this
branch, its 85 tests, Pilot 001's live result or Pilot 002's readiness. Its `prototype/inheritance.mjs` (a 100-line
planner over hand-built fixtures) is therefore **not** adopted as code. The requirements in the handoff are
checked against the existing instrument below, and only the gaps are changed.

## Requirement → where it already lives

| 2026-11-23 requirement | Status in IS1 | Where |
|---|---|---|
| Ten record kinds (study … report), versioned, hashed | present | `lib/canon.mjs` (`RECORD_KINDS`, `seal`), `research/inheritance-001/schemas/` (10) |
| Six arms A, A+, B, C, D, E in paired blocks, seeded order | present | `lib/plan.mjs`, `lib/context.mjs`; PROTOCOL.md §3 |
| A+ compute-matched to C (not token ceilings alone) | present, stronger: C's extra context + amortized curation tokens become A+'s allowance per block | `lib/context.mjs` |
| C only from **independent** verification; failed verifier never yields C | present: data-only re-execution on 8 hidden checks; receipts re-executed at every freeze; curator admission is not a verifier kind | `lib/verify.mjs`, `lib/snapshot.mjs` |
| D contaminated, harmless (wrong method + planted instruction) | present | `lib/runner.mjs` `poisonFixtures` |
| E placebo matched in format and volume, no task answers | present: really-verified records from an unrelated domain | `lib/context.mjs`, `fixtures/` |
| Oracle/answer leak gate | present, stronger than substring: salted commitments, canaries, answer + program scan of every artifact and context; solver side cannot import the sealed side (import graph tested) | `lib/leak.mjs`, `lib/oracle.mjs`, tests |
| Provider-returned model identity; unknown never guessed | present; blocks with identity drift excluded from H3 | `lib/adapters.mjs`, `lib/identity.mjs` |
| Cross-family primary analysis | present | PROTOCOL.md §2, `lib/analyze.mjs` |
| Strict temporal ordering | present for **work**: consumers inherit only from snapshots frozen before their generation's first call. **Not** enforced for **model release dates** (see D-IS1-A) | `lib/snapshot.mjs` |
| Cost accounting incl. verification, curation, reruns | present (inference / curation / verification, amortization horizons); spend guard charges timed-out calls at worst case | `lib/analyze.mjs`, `lib/caps.mjs` |
| Hard cost cap, deterministic stop, incomplete arms recorded | present | `lib/runner.mjs`, `lib/caps.mjs`, approval file + live gate |
| Contribution (leave-one-out) ablation | present | `lib/analyze.mjs` §ablations |
| Negative and null results reported, never hidden | present: "contradicted" verdicts, `NO_INHERITABLE_RECORDS` instrument flag, missingness bounds | `lib/analyze.mjs` |
| Preregistration frozen before outcomes; public commitment hash | present: Pilot 001 registered in `d24005d` before any call | `preregistration*.yaml`, `registration*.json` |
| Paid pilot prepared, not executed | present: Pilot 002 built, not run | `pilot/PILOT-002-BUDGET.md`, `DECISIONS_REQUIRED.md` D16–D17 |
| Never writes public grown memory | present (tested) | `scripts/test-inheritance-001-integration.mjs` I3/I4 |

## What has already been learned from real models (from this branch, not re-run here)

- Pilot 001 ran on 2026-11-20: 344 calls, $4.18 recorded. **No producer record was verifiable, so arm C carried
  nothing and the run could not speak to inheritance.** The analysis labels this an instrument outcome, not a null
  result. That is the main scientific fact about Protocol 001 today.
- Producer probes 3 and 4 tested the fix (producers are now told the program language). Probe 4's rule said to
  prepare Pilot 002. Pilot 002 is ready and blocked on xz's decisions D16 (ledger headroom) and D17 (approval).

## Changed on `inheritance-001-sync` (this session)

1. **Merge of `main` (956ad23) into the branch.** It merged cleanly. The branch predated DL-0042 (grown-memory writes)
   and DL-0043 (storage classes). Hermetic suite on the merge: 517 pass, 0 fail, 2 cancelled. Both cancelled tests are
   `test-figures` "hang" cases: Node 22.23 exits on an unref'd `AbortSignal.timeout`, and they are cancelled on `main`
   too.
2. **Lab records are a private storage class.** `createBlobLabStore` passed `access: "public"` and read stored records by
   plain `fetch`. After DL-0043 every Blob path is routed by class. `research/` had no entry (unknown is private), so a
   live wiring would have mixed the two models. Now `research/` is registered private in `api/_storage-classes.js`, the
   store passes no `access` (the router decides, and a raw SDK put without `access` throws, so it fails closed), and test
   I5 pins it (mutation-checked: restoring `access:"public"` fails I5). No live path uses this store today.

## Decisions this adds (for `DECISIONS_REQUIRED.md` after review)

- **D-IS1-A: model-release chronology.** Omnai's prototype refuses a producer whose model was released on or after the
  consumer's. IS1 requires only that inherited **work** precede the consumer, through frozen snapshots. Pilot 002
  (Gemini 4 Carbon and GPT-6.1 Sol produce, Claude Sonnet 5.5 consumes) has no release-order constraint.
  *Recommendation:* record each model's release date in the study record and report the transfer by release order as a
  descriptive stratum. Do not make it an eligibility rule: the question is whether verified work transfers across
  families. A release-order rule would cut the usable panel without changing what is measured. *Safe default:*
  unchanged.
- **D-IS1-B: merge `inheritance-001` into `main`.** It is mergeable, and the whole suite is green apart from the
  environment-cancelled pair. Merging changes no route, function or public surface. *Recommendation:* push
  `inheritance-001-sync` and open a draft PR after xz has read this file. *Safe default:* local only.
