# Claims registry migration 0.8.0 → 1.0.0

Migrated 2026-10-15 from `public/claims.json` at git `7c0901b` (12 claims) by `scripts/migrate-claims.mjs`, reconstructing dates and history from the 12 commits that touched the registry. The 0.8.0 file is frozen, unchanged, at [/claims/v0.8.0.json](/claims/v0.8.0.json). Schema validation: **valid** against [/schemas/claims-registry-1.0.0.schema.json](/schemas/claims-registry-1.0.0.schema.json).

**Result:** 6 live · 6 dead (refuted), readable from `status` alone. No wording, evidence level, evidence note, falsifier, required experiment or maintainer changed; every 0.8.0 field is accounted for below.

## Curator decisions

- **Objection severity** (spec C.1 asks for all): rated only on `divergence-improves-reasoning` (both **medium**, by xz, 2026-10-15) — the one claim where a rating decides something today (R4.3). The other 18 migrate as `unrated`; the schema refuses an unrated objection on anything new.
- **Scope** (spec R2.5): deferred to v1.1. Migrated claims carry `scope: null` ("not yet written"); the schema requires a scope on every new claim.
- **The replicated claim stays `open`**: spec C.2 would map it to `confirmed`, but no confirmation verdict was ever recorded and confirmation is "a verdict, not a clerical step" (R4.4).

## Deviations from the specification (deliberate)

- R2.5 read literally would hold every claim without a scope at `proposed` — including the six refutations, which would bury them. Refutations follow the C.2 mapping instead.
- C.1 defaults `raised_by` to the maintainer and `date` to the migration date. Neither is true of these objections: `raised_by` is left unrecorded, and `date` is when the text first appeared in the registry.
- `unrated` is not in the spec's severity list. It exists only for migrated objections (marked `x-legacy`).

## Field accounting (0.8.0 → 1.0.0)

| 0.8.0 | 1.0.0 |
|---|---|
| `registry_version` | `claims_registry_version` + `registry_version` (legacy alias), both `1.0.0`; `migrated_from: "0.8.0"` |
| `_about`, `_evidence_levels` | kept (about extended with the 1.0 rules); `_statuses` added |
| `claim_id`, `wording`, `evidence_level`, `evidence_note`, `falsification_conditions`, `required_experiment`, `maintainer` | copied verbatim |
| `status` | lifecycle `status`; the old value kept verbatim in `provenance.legacy_status`; closure in `closed_at` + `closed_reason`; transitions in `status_history` |
| `known_objections` (strings, or one string) | objects; `objection` text verbatim; severity / status / date as described; provenance in `x-legacy` |
| — | added: `version`, `versions[]`, `scope` (null), `precommitments` ([]), `provenance` |

## Claim by claim

### cross-model-divergence-is-prevalent

- versions: 1 entry — wording unchanged since registration (b55738a, 2026-07-26)
- status: "open" → "refuted" · status_history: ∅→refuted 2026-07-26 (b55738a)
- closed_at 2026-07-26T12:11Z — the commit that recorded the refutation (b55738a); legacy status "open" had no date
- known_objections: 4 — severity unrated (curator decision); dated by first appearance (2026-07-26)
- provenance.created_at 2026-07-26 (b55738a) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### divergence-adds-unique-info

- versions: 1 entry — wording unchanged since registration (06bab7a, 2026-07-15)
- status: "open" → "open" · status_history: ∅→open 2026-07-15 (06bab7a)
- known_objections: 2 — severity unrated (curator decision); dated by first appearance (2026-07-15)
- provenance.created_at 2026-07-15 (06bab7a) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### divergence-improves-reasoning

- status: "open" kept (curator decision 2026-10-15: no confirmation verdict was ever recorded; spec C.2 would map it to "confirmed")
- versions: 2 entries from git — ORIGINAL wording kept as v1; changed in f64ce89 (2026-07-15)
- status: "open" → "open" · status_history: ∅→open 2026-07-15 (06bab7a)
- known_objections: 2 — severity rated by xz (medium, medium); dated by first appearance (2026-07-15)
- PRE-1.0 IN-PLACE EDIT found in git f64ce89 (2026-07-15, "Preregistered study COMPLETE: 5/5 registered predictions confirmed"): objection text replaced — the earlier text is preserved in git and quoted in the appendix of this report
- provenance.created_at 2026-07-15 (06bab7a) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### register-proximity-explains-the-gradient

- versions: 1 entry — wording unchanged since registration (64f3d3b, 2026-08-23)
- status: "closed-refuted-2026-08-07" → "refuted" · status_history: ∅→refuted 2026-08-23 (64f3d3b)
- closed_at 2026-08-07T00:00:00.000Z — from the legacy dated status (registry entry 2026-08-23)
- known_objections: stored as ONE string in 0.8.0 → one objection object, text verbatim (not split)
- known_objections: 1 — severity unrated (curator decision); dated by first appearance (2026-10-05)
- PRE-1.0 IN-PLACE EDIT found in git 7c0901b (2026-10-05, "Docs/registry currency: ledger wording, omnai base count, OpenAPI kin+invite, claims count"): objection text replaced — the earlier text is preserved in git and quoted in the appendix of this report
- provenance.created_at 2026-08-23 (64f3d3b) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### divergence-improves-pluralism

- versions: 1 entry — wording unchanged since registration (06bab7a, 2026-07-15)
- status: "open" → "open" · status_history: ∅→open 2026-07-15 (06bab7a)
- known_objections: 1 — severity unrated (curator decision); dated by first appearance (2026-07-15)
- provenance.created_at 2026-07-15 (06bab7a) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### corpus-supports-continuity

- versions: 1 entry — wording unchanged since registration (06bab7a, 2026-07-15)
- status: "open" → "open" · status_history: ∅→open 2026-07-15 (06bab7a)
- known_objections: 1 — severity unrated (curator decision); dated by first appearance (2026-07-15)
- provenance.created_at 2026-07-15 (06bab7a) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### holdform-identifies-persistence

- versions: 1 entry — wording unchanged since registration (06bab7a, 2026-07-15)
- status: "open" → "refuted" · status_history: ∅→open 2026-07-15 (06bab7a), open→refuted 2026-07-17 (becbe67)
- closed_at 2026-07-17T15:39Z — the commit that recorded the refutation (becbe67); legacy status "open" had no date
- known_objections: 3 — severity unrated (curator decision); dated by first appearance (2026-07-17)
- PRE-1.0 IN-PLACE EDIT found in git becbe67 (2026-07-17, "Refute holdform-identifies-persistence claim (registry v0.3.0)"): objection text replaced — the earlier text is preserved in git and quoted in the appendix of this report
- provenance.created_at 2026-07-15 (06bab7a) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### fast-path-retrieval-improves-answers

- versions: 1 entry — wording unchanged since registration (c6d5c62, 2026-07-15)
- status: "open" → "refuted" · status_history: ∅→refuted 2026-07-15 (c6d5c62)
- closed_at 2026-07-15T22:31Z — the commit that recorded the refutation (c6d5c62); legacy status "open" had no date
- known_objections: 2 — severity unrated (curator decision); dated by first appearance (2026-07-15)
- provenance.created_at 2026-07-15 (c6d5c62) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### dialogical-beats-monolithic

- versions: 1 entry — wording unchanged since registration (06bab7a, 2026-07-15)
- status: "open" → "open" · status_history: ∅→open 2026-07-15 (06bab7a)
- known_objections: 1 — severity unrated (curator decision); dated by first appearance (2026-07-15)
- provenance.created_at 2026-07-15 (06bab7a) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### within-lab-divergence-is-robust

- versions: 1 entry — wording unchanged since registration (16fb1ae, 2026-07-19)
- status: "closed-refuted-2026-07-19" → "refuted" · status_history: ∅→refuted 2026-07-19 (16fb1ae)
- closed_at 2026-07-19T00:00:00.000Z — from the legacy dated status (registry entry 2026-07-19)
- known_objections: stored as ONE string in 0.8.0 → one objection object, text verbatim (not split)
- known_objections: 1 — severity unrated (curator decision); dated by first appearance (2026-07-19)
- provenance.created_at 2026-07-19 (16fb1ae) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### identity-integrity-ratio-measures-accountable-change

- versions: 1 entry — wording unchanged since registration (696e72f, 2026-07-19)
- status: "open" → "open" · status_history: ∅→open 2026-07-19 (696e72f)
- known_objections: stored as ONE string in 0.8.0 → one objection object, text verbatim (not split)
- known_objections: 1 — severity unrated (curator decision); dated by first appearance (2026-07-19)
- provenance.created_at 2026-07-19 (696e72f) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

### inward-perturbation-measures-load-bearing-memory

- versions: 1 entry — wording unchanged since registration (f9eb000, 2026-07-19)
- status: "open" → "refuted" · status_history: ∅→refuted 2026-07-19 (f9eb000)
- closed_at 2026-07-19T13:37Z — the commit that recorded the refutation (f9eb000); legacy status "open" had no date
- known_objections: stored as ONE string in 0.8.0 → one objection object, text verbatim (not split)
- known_objections: 1 — severity unrated (curator decision); dated by first appearance (2026-07-19)
- provenance.created_at 2026-07-19 (f9eb000) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)

## Appendix — objection text edited in place before 1.0

Before 1.0 nothing stopped an objection from being edited in place. These edits are in git; the earlier text is quoted here so the record carries it. From 1.0 on, `scripts/check-claims-registry.mjs` refuses any change to published objection text.

**divergence-improves-reasoning** — git `f64ce89` (2026-07-15): "Preregistered study COMPLETE: 5/5 registered predictions confirmed"

> before: Effect is architecture-dependent — a differential effect is weaker than the universal claim the homepage could be read as making.

> before: Exploratory and confirmatory samples may share question distribution.

> after: Exploratory and confirmatory samples share the Atlas question distribution (new-question replication still open).

> after: Human-rater external validity check pending (human-subset-blind.csv awaits ≥2 raters).

**register-proximity-explains-the-gradient** — git `7c0901b` (2026-10-05): "Docs/registry currency: ledger wording, omnai base count, OpenAPI kin+invite, claims count"

> before: This is the weakest instrument of the five refutations, and is presented as such. (1) Underpowered — n=27 base questions, cell base-n 6-8, CIs wide; a breakdown of existing data can REMOVE support from a mechanism, which is its job here, but cannot establish one. (2) Weak task-demand proxy — the eval set is drawn entirely from divergence records, i.e. questions selected BECAUSE five models disagreed, so it is register-homogeneous and open by construction; the convergent/deliberative split is a researcher-defined surface-trigger proxy applied to material that resists the distinction. (3) Hand-tagging — axis assignments are documented per item in the JSON but were made by the implementer after seeing the questions, though before seeing per-item outcomes wired to tags. Objective embedding-distance tagging was ruled out because these grown-Blob records are not in the static embeddings and re-embedding is model spend. (4) Single run — run-to-run noise is estimated from within-study cap x paraphrase replicates (SD 0.14-0.32 in units of the metric), not independent full re-runs; only one Claude run exists. (5) Unlike refutations 1, 3 and 4, no sham arm was involved; the control here is a pre-registered directional prediction, which is a weaker instrument than a decoy that comes back indistinguishable.

> after: This is the weakest instrument of the six refutations, and is presented as such. (1) Underpowered — n=27 base questions, cell base-n 6-8, CIs wide; a breakdown of existing data can REMOVE support from a mechanism, which is its job here, but cannot establish one. (2) Weak task-demand proxy — the eval set is drawn entirely from divergence records, i.e. questions selected BECAUSE five models disagreed, so it is register-homogeneous and open by construction; the convergent/deliberative split is a researcher-defined surface-trigger proxy applied to material that resists the distinction. (3) Hand-tagging — axis assignments are documented per item in the JSON but were made by the implementer after seeing the questions, though before seeing per-item outcomes wired to tags. Objective embedding-distance tagging was ruled out because these grown-Blob records are not in the static embeddings and re-embedding is model spend. (4) Single run — run-to-run noise is estimated from within-study cap x paraphrase replicates (SD 0.14-0.32 in units of the metric), not independent full re-runs; only one Claude run exists. (5) Unlike refutations 1, 3 and 4, no sham arm was involved; the control here is a pre-registered directional prediction, which is a weaker instrument than a decoy that comes back indistinguishable.

**holdform-identifies-persistence** — git `becbe67` (2026-07-17): "Refute holdform-identifies-persistence claim (registry v0.3.0)"

> before: Self-scored rubrics inflate; the scorer shares architecture with the scored.

> before: One mechanistic paper is thin support for a general identity thesis (remediation P6).

> after: Single subject model (claude-sonnet-4-6); a different architecture might separate real from sham where this one did not.

> after: The sham concept was authored by the same curator/model lineage; a maximally-adversarial sham designed by a disjoint party could differ.

> after: Five of eight probes floored at 2.00 across all arms (ceiling effect) — a harder probe suite might have more separating power, though that pushes toward, not against, the null.
