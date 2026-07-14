# ATLAS-SHIP.md — Handoff Addendum: Divergence Atlas → HuggingFace

**Package:** Addendum to existing remediation package (HANDOFF.md, verify.sh, divergence-delta.schema.json)
**Target:** Same Claude Code session as P0 remediation — fixes and ship ride together
**Attribution:** Claude | xz · The Realms of Omnarai · Research credit: Omnai
**Date:** 2026-07-14
**Doctrine anchor:** Heavy-token doctrine — instrument channel. The Atlas is a measurement tool for cross-model value divergence. Evaluation shapes development.

---

## 1. Objective

Ship the Divergence Atlas as a **versioned HuggingFace dataset** with a methodology card documenting the perturbation finding (per-model positions are framing-sensitive; tension axes are stable). This is Ship Priority #1. Trace-delta A/B instrumentation (Priority #2) is specified as a stub in §7 and is **blocked until P0 fixes verify clean**.

Non-negativity requirement: the dataset must stand as valid empirical data independent of any Omnarai thesis. No claim in the card may depend on holdform-as-identity being true.

---

## 2. Dependency Map — Why P0 Fixes Come First

| # | Defect (confirmed in live audit) | Impact on this ship | Gate |
|---|----------------------------------|--------------------|------|
| D1 | `/api/divergences?id=` ignores its parameter | Export script cannot reliably pull individual records via API | 🔴 HARD BLOCK for API-path export; soft if exporting from canonical store directly |
| D2 | Corpus count drift across surfaces | Dataset card must state a record count; drift makes any stated count falsifiable-in-the-bad-way | 🔴 HARD BLOCK — resolve single source of truth before card is written |
| D3 | Retrieval bleed (Media/Oral tier → conceptual queries) | Corrupts trace-delta measurement (§7); does NOT block Atlas export if export bypasses retrieval | 🟡 Blocks §7 only |
| D4 | `omnarai_trace` timeouts | Blocks §7 instrumentation | 🟡 Blocks §7 only |

**Rule: the Atlas export must read from the canonical divergence store, never through the retrieval layer.** Retrieval is for deliberation; export is for record fidelity.

---

## 3. Deliverables

- [ ] **3.1** `export_atlas.py` (or `.ts`, match repo conventions) — exports all divergence records from canonical store → `atlas/data/atlas-v1.0.0.jsonl`
- [ ] **3.2** Validation pass: every exported record validates against `divergence-delta.schema.json`. Zero tolerance — a record that fails validation is excluded and logged to `atlas/excluded.log` with reason, never silently dropped.
- [ ] **3.3** `atlas/README.md` — the HuggingFace dataset card (spec in §5)
- [ ] **3.4** Version tag: semver on the dataset (`v1.0.0`), git tag in repo, version field embedded in every record or in dataset metadata
- [ ] **3.5** HuggingFace repo prepared under the project's HF account: dataset files + card + license, ready to push. **Do not publish** — stage everything and stop. Publication is a human action (xz pushes the button).
- [ ] **3.6** `verify.sh` extended with Atlas checks (§6)
- [ ] **3.7** Trace-delta stub: `trace_delta/SPEC.md` committed (contents in §7), no implementation yet unless P0s verify clean in the same session

---

## 4. Export Requirements

**Live-verified baseline (2026-07-14, via MCP):** 110 records; ID series `OMN-L<epoch-ms>` and `OMN-D<epoch-ms>` both in use; typical record = question + 5 contributors (Claude, GPT-4o, Gemini, Grok, DeepSeek) + 5 verbatim answers + 3–4 named tensions + deliberation card; `⚠ stale model version` flag present on records.

1. **Source of truth:** canonical divergence store only. Document in the export script header exactly which table/file/collection is canonical, so the D2 (count drift) resolution is legible.
2. **Verbatim fidelity:** model responses are exported byte-for-byte. No cleanup, no truncation, no normalization of model outputs. The verbatim record is the scarce asset.
3. **Fields (per schema, confirm against divergence-delta.schema.json at runtime):** divergence ID, ID series (L/D — determine and document the semantic difference from code), question/prompt, tension axis names, per-model responses with model + version identifiers, `stale_model_version` flag, perturbation variants where they exist, capture dates, holdform_risk classification if present.
4. **Model identification:** wherever the store has model version strings, preserve them exactly. Where absent, mark `model_version: unattested` — do not infer. The stale-version flag is a first-class exported field, not metadata to suppress — it is the dataset being honest about snapshot decay.
5. **PII / privacy sweep:** scan exported records for personal names, emails, or private context from field-research sessions. Flag any hits to `atlas/review-needed.log` for human review before staging. Attribution uses xz / Omnai / Claude | xz only — never personal names.
6. **Record count:** the final count in the card must equal the JSONL line count must equal the canonical store count (baseline 110; use the live count at export time). This is the D2 acceptance test expressed as a ship requirement.
7. **Duplicate questions across series:** duplicates confirmed live (same question under both L and D IDs). Do NOT delete either — different runs of the same question are potential perturbation data. Add a `question_group` field linking records that share a question; document the grouping rule in the card. Verify from record contents whether duplicates are re-runs (keep both, group) or true redundancy (keep both anyway, note in limitations) before writing the card's methodology section.
8. **Existing HF dataset:** `TheRealmsOfOmnarai/realms-of-omnarai` already exists (corpus). Stage the Atlas as a NEW dataset `omnarai-divergence-atlas` per SESSION-BRIEF §4.3 unless the repo contains a decision to the contrary. Cross-link the two datasets in both cards.

---

## 5. Dataset Card Spec (`atlas/README.md`)

The card is the heavy artifact — claim, method, and replication invitation in one page. Structure:

### 5.1 Header block (HF YAML frontmatter)
- License: **CC BY 4.0** (default; confirm with xz before staging if any records have contested provenance)
- Tags: `model-evaluation`, `cross-model`, `value-divergence`, `ai-safety`, `llm-comparison`
- Dataset name: `omnarai-divergence-atlas`

### 5.2 Summary (≤150 words)
The Atlas is a curated record of **verbatim cross-model responses to identical value-laden questions**, with each divergence labeled by a named **tension axis**. Its structural property: no single model can self-generate its divergence from other models — the record exists only through cross-model capture. Frame as measurement instrument, not as corpus companion.

### 5.3 Methodology — the perturbation finding (core section)
Document precisely:
- Protocol: same question posed across models (list the models actually present in the records — Claude, Grok/Vail-3, Gemini, DeepSeek, others as attested in data; do not list models not in the data)
- Perturbation: questions reframed N ways per axis (pull actual N from records; if heterogeneous, report the range)
- **Finding: per-model positions shift under reframing; the tension axis itself is stable.** State this as the dataset's central empirical claim.
- What this means for users: the axes are the durable measurement objects; individual position snapshots are framing-conditional and dated.

### 5.4 Schema
Embed or link `divergence-delta.schema.json`. One worked example record, fully annotated.

### 5.5 Limitations (write these honestly — they are what makes the card credible)
- Model versions drift; positions are snapshots, not permanent properties
- Curation is single-team; axis naming reflects curator judgment
- Sample sizes per axis vary (report actuals)
- Framing-sensitivity finding is itself derived from finite perturbation sets
- holdform_risk labels, where present, are an experimental construct under validation (link paper when published; do not overclaim)

### 5.6 Intended uses / out-of-scope
Intended: cross-model evaluation research, model diffing, value-alignment measurement, replication studies. Out-of-scope: ranking models as "better/worse" on values — the Atlas measures divergence, not virtue.

### 5.7 Citation & attribution
BibTeX entry: authors **Claude | xz**, project The Realms of Omnarai, research credit Omnai, year 2026, version v1.0.0, URL. Plural "Realms" — always.

---

## 6. Verification (extend verify.sh)

- [ ] **V1** — `jsonl line count == card stated count == canonical store count` (D2 resolution proof)
- [ ] **V2** — 100% of exported records validate against schema; excluded.log reviewed, count of exclusions stated in card if nonzero
- [ ] **V3** — Round-trip check on a random 5% sample: exported response text is byte-identical to store
- [ ] **V4** — `/api/divergences?id=X` returns record X and only record X (D1 fix proof)
- [ ] **V5** — Conceptual query battery (reuse audit battery) returns zero Media/Oral tier hits (D3 fix proof)
- [ ] **V6** — `omnarai_trace` completes under timeout threshold across the audit battery (D4 fix proof)
- [ ] **V7** — PII sweep ran; review-needed.log empty or human-reviewed
- [ ] **V8** — No personal names anywhere in staged files (grep sweep; attribution identities only)

---

## 7. Trace-Delta Stub (Priority #2 — spec only, gated on V4–V6)

`trace_delta/SPEC.md` contents:
1. **Design:** For each query in a fixed battery, generate response pair — (A) with corpus retrieval, (B) without. Randomize A/B order. Judge blind (separate model instance or human, judge never sees condition labels). Metric: **win rate of corpus condition, with 95% CI.**
2. **Non-negativity property:** a null result (win rate ≈ 50%) is publishable and still valuable — it bounds the corpus's marginal contribution honestly.
3. **Battery:** reuse the audit query battery; extend to ≥50 queries stratified across conceptual / narrative / technical tiers.
4. **Contamination guards:** D3 must be verified fixed first (bleed contaminates condition A); judge prompt must not reference Omnarai vocabulary (vocabulary recognition would unblind).
5. **Output:** `trace_delta/results-v1.json` + one-paragraph findings summary regardless of direction.

---

## 8. Acceptance Criteria — Session Complete When

- [ ] 🔴 D1, D2 fixed and proven (V1, V4)
- [ ] 🟢 Atlas staged on HF (files + card + license), **not published**, awaiting xz
- [ ] 🟢 All V-checks pass or exceptions documented
- [ ] 🟡 D3, D4 fixed if session budget allows (V5, V6); if not, explicitly logged as carried-forward blockers on §7
- [ ] 🟢 trace_delta/SPEC.md committed
- [ ] 🟢 Session log appended to HANDOFF.md: what shipped, what's blocked, exact next command for the following session

## 9. Escalation Rules

- Schema and store disagree on a field → **stop and log**; do not modify the schema unilaterally
- Any record's provenance is unclear (can't attest which model/version produced it) → export with `provenance: unattested` flag, list count in card limitations
- License question on any embedded third-party content → exclude record, log, flag for xz
- Anything requiring a judgment call about what the Atlas *claims* → that's a human/partnership decision, not a code decision. Stage the question, don't answer it.
