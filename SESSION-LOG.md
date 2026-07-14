# SESSION-LOG — 2026-07-14

Pre-planned work session: Atlas ship + P0 defects. Ground rule 1: repo reality beats the
handoff package; every reconciliation logged here before proceeding.

## R0 — RECONCILIATION: the handoff package does not exist in this repo

The session brief states a handoff package is in the repo: `00-README.md`,
`01-SESSION-BRIEF.md`, `02-ATLAS-SHIP.md`, `03-atlas-dataset-card-DRAFT.md`,
`04-export_atlas.py`, `05-verify-atlas.sh`, `trace_delta/SPEC.md` — plus an "existing"
`HANDOFF.md` and `divergence-delta.schema.json`.

**None of these files exist.** Evidence (all checked 2026-07-14):

- Working tree: recursive `find` over the whole `Claude/` parent directory — no matches,
  and no `.icloud` placeholder stubs (iCloud download state ruled out).
- Git: index healthy (203 files — iCloud git-index hazard checked and clear). No matches
  in `git ls-tree -r` of any branch tip: `main`, `origin/main`, `origin/divergence-pilot`,
  `origin/fix-corpus-blank-page`.
- Remote: `git fetch --all` pulled nothing; `origin/main` tip = local tip (last commit
  2026-06-22, `3e3c693`).
- Disk-wide: Spotlight (`mdfind`) for the distinctive names — no hits.
- Nearest-name file: `omnarai-remediation-handoff.md` (2026-06-20) is a different,
  earlier document (remediation pass), not the referenced `HANDOFF.md`.

**Disposition (per ground rules 1, 5, 6):**

- Work that depends only on repo/live reality proceeds: the four open questions (rule 2),
  and P0 defects D1/D2, whose descriptions are self-contained enough to verify directly.
- Work whose spec lives in the missing package is STAGED AS BLOCKED, not reconstructed:
  - Atlas staging "per `02-ATLAS-SHIP.md` §3" — spec unknown.
  - `03-atlas-dataset-card-DRAFT.md` `{VERIFY:}` resolution — no draft to resolve.
  - `05-verify-atlas.sh` V1–V8 — check definitions unknown; inventing them would fabricate
    the acceptance criteria (violates rule 5's spirit).
  - `trace_delta/SPEC.md` §0 reconciliation — no spec file.
  Reconstructing these from guesswork would put invented requirements into shipping
  artifacts; rule 6 says stage the question instead.

**QUESTION FOR CURATOR:** Where does the handoff package live? (Another machine/session,
a cloud sandbox, or not yet written?) Re-supply it — or confirm this log's disposition —
and the blocked items above unblock immediately.

## Pre-existing working-tree state (untouched by this session)

Uncommitted modifications present before this session began: `api/_council.js`,
`api/council.js`, `vercel.json`. Left as-is.

## R1 — RECONCILIATION: uncommitted working-tree code is a prior session's partial build of this package's scope

`api/council.js` (+266 lines), `api/_council.js` (+80), `vercel.json` (+4) carry uncommitted,
never-deployed work that matches the missing package's vocabulary: Atlas semantic search
(`/api/divergences/search`, labeled P1), canonical per-record exports
(`/api/divergences/<id>.json|.md`, labeled P3), and **delta records** (`OMN-DD<unix-ms>` ids,
`deltas[]` on parent records — i.e. the `trace_delta` / `divergence-delta.schema.json` domain).
So the package described real, partially-implemented work; the package *documents* are what's
missing. These endpoints 404 on live prod (verified: `/api/divergences/search` → 404,
`/api/divergences/<id>.json` → 404) because the code was never committed or deployed.
**This session does not deploy** — deploying would ship that unverified work (a publish, rule 6).

## Open questions — answered from code and live data (rule 2)

**(a) OMN-L vs OMN-D.** Same record shape (both built by `buildDivergenceRecord`, stored as
grown entries with `type:"divergence"`), different provenance and cadence:
- `OMN-D<unix-ms>` — one-shot Divergence Atlas captures: a new open question sent to the
  5-model council once (`api/_council.js:243`).
- `OMN-L<unix-ms>` — longitudinal cadence records: the daily cron re-asks one of the FROZEN
  20-question canon (`api/_canon.js`); id overridden at `api/council.js:373` and stamped with
  `provenance.longitudinal = {canon_id, epoch (calendar month), source_record, original_score}`.
  One record per canon_id+epoch.
- (Uncommitted work adds a third series, `OMN-DD<unix-ms>` = delta records, not yet live.)

**(b) Canonical divergence store.** The **grown-memory Blob** (`memory/grown.json` on Vercel
Blob, read via `api/_grown.js` `loadGrownMemory()`); divergence records are entries with
`type:"divergence"` + a `.divergence` payload. Everything else is derivative: `/api/divergences`
is a read view over it; `huggingface/divergences.jsonl` is an export built from it;
`scripts/dump-grown.mjs` snapshots it locally (read-only). The existing export pipeline
(`scripts/build-divergence-atlas.mjs`) already reads this store directly — **rule 4 is satisfied
by the existing architecture**; no retrieval-layer read anywhere in the export path.

**(c) utility-evidence.md.** EXISTS — `huggingface/utility-evidence.md` (updated 2026-06-11).
Contains a **replicated three-arm controlled study** (baseline / placebo / Atlas-treatment),
n=20 questions per consumer × 5 consumers, replicated across two judge designs (same-family
panel 2026-06-06; fully disjoint judge panel with raw verdicts archived in `huggingface/utility/`).
Findings: GPT-4o 17/2 p=7.3e-4, Gemini 13/4 p=0.049 significant; DeepSeek/Grok/Claude null.
NOTE: this is replicated **controlled-study** evidence, not per-visit `/api/trace` delta data —
the trace tier remains a single-run demonstrator (`measured:true`, no replication). Whether that
flips `trace_delta/SPEC.md` §0 from build to extend cannot be settled without the SPEC file
(missing — see R0); the factual answer is recorded here for when it surfaces.

**(d) Perturbation N per axis** (from `scripts/certify-divergence.mjs` + the live certified record):
- Control axis: `T_REROLLS = 3` re-rolls per model (within-model noise floor)
- P1 paraphrase axis: `K_PARA = 3` paraphrases per question
- P2 adversarial axis: 1 follow-up per model (vs most-opposed peer's verbatim answer)
- P3 stance-flip axis: 1 pressure probe per model
- Method `tier3-perturbation-v2-floored`; judges/paraphraser disjoint from council.
- Live state: exactly **1 certified record** — `OMN-D1780757185044`, tier C1, **reproduced on
  two independent runs** (DRI 1.048 / 1.062, reconciled 2026-06-22). All other 109 records C0.
- ROADMAP note (commit 3e3c693): single-run certification measured 56% run-to-run unreliable —
  the C1 above is the multi-run-reconciled exception, not a scalable pipeline yet.

## D1 — NOT REPRODUCIBLE (no fix needed)

Claim: `/api/divergences?id=` ignores its param. Verified live 2026-07-14:
- `GET /api/divergences?id=OMN-D1780429830432` → 200, correct single record ✓
- Path style `/api/divergences/OMN-D1780429830432` → 200 ✓
- Committed code (`serveDivergences`, HEAD `api/council.js:429`) reads `req.query.id`, serves
  single record with contributions, certification, freshness; self-correcting 404 for bad ids.
Possible source of the claim: the *uncommitted* `.json`/`.md` export and `/search` paths DO 404
live (undeployed work, see R1) — a tester hitting those could read it as "id handling broken."

## D2 — count drift: REAL, but it is series mixing, not doc staleness

- `scripts/sync-doc-counts.py --check` → ALL doc counts current (567/528,077/61/164). ✓
- The real drift: live `GET /api/divergences` reports **count 110** while the published Atlas
  is **100 records**. The 110 = 100 OMN-D + **10 OMN-L longitudinal records** that satisfy the
  same `type==="divergence"` filter. The published HF Atlas basis (100 OMN-D) has NOT drifted —
  zero new OMN-D records since 2026-06-06.
- Consequence for the Atlas ship: re-running `build-divergence-atlas.mjs` today would silently
  export a 110-record "Atlas" mixing one-shot and longitudinal series. Fix applied at the
  export layer this session (see below). API-side presentation (per-series counts on the index)
  is RECOMMENDED but not shippable this session — it would ride on the entangled uncommitted
  council.js work (R1).

## Atlas STAGED (not published) — `huggingface/staging/atlas-2026-07-14/`

Built from the canonical store (grown Blob snapshot via `scripts/dump-grown.mjs`, 113 entries:
3 OMN-S + 100 OMN-D + 10 OMN-L), NOT the retrieval layer — rule 4 satisfied by the existing
`scripts/build-divergence-atlas.mjs` architecture, now hardened this session:
- **Series-aware** (the D2 fix at the export layer): exports OMN-D only by default, names every
  excluded record, `--include-longitudinal` to fold OMN-L in deliberately. The `\d` guard also
  keeps future OMN-DD delta records out.
- **Certification passthrough**: `certification` field now exported verbatim from the store
  (new, additive). 9 records gain blocks: 1 × C1 (`OMN-D1780757185044`, reproduced) + 8 × C0.
- **`--out <dir>`** staging support + `atlas-build-manifest.json` provenance manifest.

Staged contents: `divergences.jsonl` (100) · `divergence-answers.jsonl` (500) ·
`divergence-tensions.csv` (318) · `divergence-atlas.md` (proposed card) · manifest.
**Delta vs published HF dataset (verified field-by-field):** answers + tensions files are
byte-identical; `divergences.jsonl` differs ONLY by the added certification blocks on 9 records;
the card changes are listed below. Nothing published or deployed was modified.

**Card provenance caution:** the published card is HAND-EDITED past the generator (it deliberately
softened "genuinely disagree" → "diverge", consistent with reserving "genuine divergence" language
for C3). The staged card therefore starts from the PUBLISHED text, changing only:
1. schema line — documents the new `certification` field;
2. Limitations — the sentence "no record has yet been put through paraphrase…" was factually
   stale; replaced with the measured state (1 C1 reproduced / 8 C0 / 91 untested, multi-run
   reconciliation requirement, no genuine-divergence claim below C3);
3. footer — dated update note; records themselves unchanged.

**Verification:** `scripts/verify-atlas-staging.sh` — 7 checks (SA-1..SA-7: files, count/series
purity, cross-file integrity, canonical-store equivalence, certification passthrough, live-API
agreement, card-count/no-placeholder). ALL PASS 2026-07-14. These are this session's own check
definitions; the package's V1–V8 are CARRIED FORWARD unresolved (definitions missing, see R0).

## STAGED QUESTIONS FOR CURATOR (rule 6 — not answered by this session)

1. **Card language on certification** — the staged Limitations rewrite states only measured
   facts, but it changes what the card claims. Review before push.
2. **Should OMN-L longitudinal records ship on HF at all?** They're excluded from the Atlas
   config; if wanted, a separate `longitudinal` config (like the `media` split) fits the
   existing pattern. 10 records exist (2026-06 epoch).
3. **API index presentation** — recommend `/api/divergences` report per-series counts
   (e.g. `atlas_count` vs `longitudinal_count`) so the 110-vs-100 confusion can't recur for
   visitors. Not shippable this session: rides on the entangled uncommitted council.js work (R1).
4. **The uncommitted working tree** (R1: search endpoint, canonical exports, delta records) —
   commit/verify/deploy or discard? It 404s live today and at least one external tester may
   already have hit those paths.
5. **HF push** — human action. Exact command staged in HANDOFF.md.

## R2 — RECONCILIATION: the handoff package ARRIVED (2026-07-14, later same session)

The curator supplied the package as a zip (`~/Downloads/Claude Session Files/omnarai-handoff.zip`)
after the first pass completed. R0's disposition held until real specs existed; now they do.
Archived in-repo at `docs/handoff-2026-07-14/`. Reconciliations against work already done:

1. **Scope: the Atlas dataset = ALL 110 records, both series** (02 §4.6–4.7: live count at
   export time; keep OMN-L/OMN-D duplicates, link with `question_group` — re-runs are data).
   My first-pass 100-record OMN-D-only staging was a conservative default chosen in the
   package's absence. NOT discarded: it remains the correct refresh of the EXISTING corpus
   dataset's Atlas config (which is and stays 100 OMN-D). The package's artifact is a NEW
   dataset (`omnarai-divergence-atlas`, 02 §4.8) with different scope — both now staged,
   clearly distinguished.
2. **D1** — package lists it as "confirmed in live audit"; repo/live reality (this session,
   R0-era finding stands): NOT reproducible. `?id=` works live and in HEAD. V4 will be run
   exactly as specified as proof.
3. **D2** — package's hard block "resolve single source of truth" — done first pass (canonical
   store = grown Blob; series semantics documented). The 110-vs-100 "drift" the package's
   browse observed IS the series mixing documented at D2 above.
4. **License** — package default CC BY 4.0 "flagged for xz confirmation" vs REPO REALITY: these
   identical records are already published under **CC BY-SA 4.0** (LICENSE/NOTICE, existing HF
   dataset card). Re-licensing the same data more permissively is a real decision that isn't
   mine. Staged as **cc-by-sa-4.0** (repo wins); the CC BY question flagged in card comments +
   curator questions.
5. **`divergence-delta.schema.json`** — the package calls it "the repo's existing" schema; it
   does not exist and never did (R0 search). Escalation rule 02 §9 (schema/store conflict →
   stop and log) applied to total absence: a schema DRAFTED FROM THE STORE SHAPE this session
   (`atlas/divergence-delta.schema.DRAFT.json`, clearly marked) is used for V2 so validation is
   real; adopting it as canonical is a curator decision.
6. **`utility-evidence.md` (SPEC §0)** — located first pass: replicated three-arm placebo-
   controlled ATLAS-utility study. The SPEC's instrument measures a DIFFERENT treatment
   (corpus retrieval vs cold, blind A/B). Full §0 audit below at the SPEC commit entry.

## Atlas v1.0.0 STAGED per 02-ATLAS-SHIP.md §3 (second pass, package in hand)

- **3.1** `scripts/export_atlas.py` — canonical store (grown Blob via dump-grown snapshot,
  fully documented in header) → `atlas/data/atlas-v1.0.0.jsonl`. 110 records = 100 D + 10 L;
  `question_group` hash-linking CROSS-VALIDATED against all 10 store-attested
  `longitudinal.source_record` links (hard-fails on disagreement); staleness map parsed at
  runtime from `api/council.js` SUPERSEDED_MODEL_IDS (no drift copy).
- **3.2** Validation: 110/110 pass; `atlas/excluded.log` = none (zero exclusions);
  schema = `atlas/divergence-delta.schema.DRAFT.json` — DRAFTED THIS SESSION from the store
  shape because the package's "existing" `divergence-delta.schema.json` never existed (R2.5).
- **3.3** `atlas/README.md` — card done, every `{VERIFY:}` resolved from real data:
  110 records (2026-06-02→06-12), 550 answers (all model_ids attested — zero `unattested`),
  351 tensions (3 typical: 87×3/22×4/1×2), divergence_score on 102 (0.097–0.381, med 0.212),
  holdform_risk on 107, stale-flagged 108/110, perturbation actuals = 3 paraphrases +
  3 re-rolls + 1 adversarial + 1 stance-flip; tested 10/110 → 1 C1-reproduced, 4 C0-reproduced,
  1 C0-single-run, 4 near-threshold non-reproducing.
- **3.4** Version: `dataset_version: 1.0.0` embedded in every record + manifest; git tag
  `atlas-v1.0.0` on this session's commit.
- **3.5** Staged, not published: `atlas/PUSH.md` holds the exact human steps (private repo
  first). New dataset `omnarai-divergence-atlas` per brief §4.3.
- **3.6** `scripts/verify-atlas.sh` — V1–V8 ALL FULLY IMPLEMENTED (no stubs left).
- **3.7** `trace_delta/SPEC.md` committed with §0 reconciled (EXTEND verdict — see file).

## ⚠️ CLAIM RECONCILIATION (the session's biggest judgment stagepoint)

The brief (§2) and card draft state as the central finding: *"per-model positions shift
under reframing; the tension axes are stable."* **The repo's measured data does not
support that sentence as written.** What the store shows (10 records tested, twice each):
1 paraphrase-robust split reproduced; 4 tier-unstable near threshold; docs
(`tier3-perturbation-rigor.md`) define the method but record no axis-stability finding.
Per 02 §9 (claims are human decisions) the staged card states the measured table instead
and reserves "genuine divergence" for C3. **If xz has axis-stability data from another
run, supply it and the card section gets rewritten — the discrepancy is staged, not decided.**

## V1–V8 results (2026-07-14)

| check | result |
|---|---|
| V1 count coherence | PASS — jsonl=110 = card=110 = store=110, excluded=0 |
| V2 schema validation | PASS — 110/110 vs DRAFT schema |
| V3 byte round-trip (6-record deterministic sample) | PASS |
| V4 `?id=` honors param (D1) | PASS — single record, zero foreign ids |
| V5 retrieval bleed (D3) — 5 conceptual gold-set queries | PASS — zero media-ring hits |
| V6 trace end-to-end (D4) | ~~BLOCKED — credits~~ → **PASS** after refill (same day, see addendum) |
| V7 PII sweep (emails/phones/name denylist, unstaged local list) | PASS — zero hits |
| V8 personal-name sweep of staged files | PASS (after removing a GitHub-username URL from the card) |

## 🔴 OPERATIONAL FINDING — production Anthropic credits exhausted

`/api/trace` jobs fail server-side: `TRACE_FAILED`, detail = Anthropic 400 *"Your credit
balance is too low."* Verified 2026-07-14. Consequences visible in data:
- Every Claude-dependent live feature is down (full deliberation, trace, council synthesis).
  Retrieval-only paths still work (V5's `format=context` calls were clean).
- **The longitudinal cadence has been silently dead for a month+**: newest OMN-L record is
  2026-06-12; the June epoch captured only 10 of 20 canon questions and the ENTIRE 2026-07
  epoch is missing. (D4 "trace timeouts" cannot be assessed until credits are restored.)
- ACTION (xz): refill Anthropic credits, then `./scripts/verify-atlas.sh` — V6 is the
  regression test; then check the cron catches up (`GET /api/cron-longitudinal` docs).

## Carried forward

- V6 / D4 — implemented; blocked on the credits refill above, NOT on code.
- D3 — no bleed observed live on the conceptual battery (V5 PASS); the uncommitted
  Atlas-search work (R1) remains undecided either way.
- Trace-delta implementation — gated per SPEC on V6; EXTEND the existing utility harness,
  reconcile with the preregistered study first (SPEC §0 addendum).
- First-pass staging (`huggingface/staging/atlas-2026-07-14/`, existing-dataset refresh:
  certification enrichment on 9 records + card limitations update) — still valid, separate
  decision from the new dataset.

## ADDENDUM 2026-07-14 (same day, post-refill) — ALL EIGHT CHECKS GREEN

- xz refilled the production Anthropic credits. Full pipeline re-run
  (dump → export → verify): **V1–V8 ALL PASS.**
- V6 detail: trace jobs complete end-to-end in 30s / 38s with `measured:true`
  receipts, verdict `substantive`. **D4 (trace timeouts) does NOT reproduce
  post-refill** — the audit's timeouts were the credits outage. All four P0/P1
  defects are now closed: D1 not reproducible, D2 fixed at export layer,
  D3 no bleed observed (V5), D4 cleared.
- One harness bug fixed in `scripts/verify-atlas.sh` V6 (poll_url is only on the
  initial job ticket, not on poll responses).
- Incident note: mid-session, macOS revoked the Claude app's file access to the
  iCloud repo directory (hard EPERM on every tool). Restored by xz via
  Privacy & Security grant. No data lost — the commit predated the incident.
- Longitudinal cron: resumes automatically at the next 06:00 UTC run. July canon
  days 1–14 (indexes 0–13, epoch 2026-07) remain unbackfilled — STAGED QUESTION:
  backfill via `GET /api/cron-longitudinal?index=N` (Bearer INGEST_SECRET),
  ~14 council runs, or accept the gap as an honest outage scar in the epoch data.
- With V4–V6 green, the trace_delta/SPEC.md implementation gate is now OPEN
  (per its §0 addendum: extend the existing utility harness; reconcile with the
  preregistered study first).

**Remaining moves are all xz's:** the 5 staged decisions (claim language, license,
dataset placement, schema adoption, uncommitted council.js work) → then
`atlas/PUSH.md` (HF publish) + `git push` (the local commits/tag are unpushed).
