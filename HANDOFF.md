# HANDOFF

(Created 2026-07-14. The session brief of this date referenced an "existing HANDOFF.md" —
none existed; see SESSION-LOG.md R0. This file starts the ledger.)

## Session 2026-07-14 — Atlas staging + P0 triage under a missing handoff package

**The headline reconciliation:** the referenced handoff package (00–05, `trace_delta/SPEC.md`,
`divergence-delta.schema.json`) does not exist anywhere — working tree, all branches, remote,
Spotlight. Full evidence and disposition in `SESSION-LOG.md` (R0). Work that depended only on
repo/live reality proceeded; package-defined acceptance criteria are carried forward.

**Done:**
- Open questions answered from code (SESSION-LOG.md): OMN-D = one-shot Atlas captures,
  OMN-L = longitudinal canon re-asks (same shape, `provenance.longitudinal`, id override at
  `api/council.js:373`); canonical store = grown Blob via `api/_grown.js`; `utility-evidence.md`
  exists with replicated controlled-study (not trace) evidence; perturbation N = 3 paraphrases /
  3 re-rolls / 1 adversarial / 1 stance-flip per model, 1 record C1-reproduced.
- **D1** (`?id=` ignored): NOT REPRODUCIBLE — works live and in HEAD. Likely misread of 404s from
  UNDEPLOYED uncommitted endpoints (`/api/divergences/search`, `/<id>.json`) — see R1.
- **D2** (count drift): real — live index counts 110 (100 OMN-D + 10 OMN-L), published Atlas
  is 100. Fixed at the export layer: `build-divergence-atlas.mjs` is now series-aware
  (OMN-D default, exclusions named, `--out` staging, provenance manifest, certification
  passthrough). Doc counts themselves clean (`sync-doc-counts.py --check` passes).
- **Atlas STAGED, not pushed:** `huggingface/staging/atlas-2026-07-14/` — data delta vs
  published is exactly: certification blocks on 9 records + a card update. Verified by
  `scripts/verify-atlas-staging.sh` (SA-1..SA-7, ALL PASS).
- Pre-existing uncommitted working-tree code (Atlas search / canonical exports / OMN-DD deltas)
  identified as a prior session's partial build of this package's scope — untouched, undeployed.

**Blocked / carried forward:** package V1–V8, `trace_delta/SPEC.md` §0, `{VERIFY:}` card
brackets (all need the missing package); D3, D4; curator questions staged in SESSION-LOG.md.

~~Next command superseded by the second pass below (package arrived).~~

## Session 2026-07-14, second pass — the handoff package ARRIVED; full §3 executed

The curator supplied `omnarai-handoff.zip` after the first pass. Archived at
`docs/handoff-2026-07-14/`. Everything re-reconciled in SESSION-LOG.md (R2): scope became
ALL 110 records both series as a NEW dataset `omnarai-divergence-atlas`; first-pass
100-record staging retained as the separate existing-dataset refresh.

**Shipped (staged, nothing published):**
- `scripts/export_atlas.py` → `atlas/data/atlas-v1.0.0.jsonl` — 110/110 from the canonical
  grown Blob, zero exclusions, zero PII, question-group links cross-validated
- `atlas/divergence-delta.schema.DRAFT.json` (the referenced schema never existed — drafted
  from store shape, flagged for adoption)
- `atlas/README.md` — card with every `{VERIFY:}` resolved from real data; license staged
  cc-by-sa-4.0 (repo reality) vs package's cc-by proposal — xz decides
- `scripts/verify-atlas.sh` — V1–V8 fully implemented: **V1–V5, V7, V8 PASS; V6 blocked**
- `trace_delta/SPEC.md` committed, §0 reconciled: EXTEND the existing replicated utility
  harness (different treatment), don't build parallel; align with the preregistered study
- `atlas/PUSH.md` — exact human publish steps (private-first)

**🔴 Operational alert:** production Anthropic account is OUT OF CREDITS — all
Claude-dependent live features failing; longitudinal cron silently dead since 2026-06-12
(July epoch entirely missing). Details + evidence in SESSION-LOG.md.

**Awaiting xz (staged questions, SESSION-LOG.md):** license · new-dataset-vs-config ·
card's perturbation language (brief's "axes stable" claim not supported by measured data —
staged, not decided) · uncommitted council.js work (R1) · both HF pushes.

**Next session starts with** (after refilling Anthropic credits):

```bash
cd "/Users/jonathanlee/Library/Mobile Documents/com~apple~CloudDocs/CBS Cool Business Stuff/Claude/omnarai-memory-engine" && node scripts/dump-grown.mjs && python3 scripts/export_atlas.py && ./scripts/verify-atlas.sh
```

All eight green ⇒ follow `atlas/PUSH.md` (human). V6 still failing ⇒ D4 is real beyond the
credits outage — investigate `api/query.js` trace mode before anything else.
