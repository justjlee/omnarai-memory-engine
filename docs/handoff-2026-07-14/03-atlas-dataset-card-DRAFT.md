---
# HuggingFace dataset card frontmatter — DRAFT. Claude Code: verify every {BRACKETED} value from code/store before staging.
license: cc-by-4.0   # default per SESSION-BRIEF §4.5 — flagged for xz confirmation
tags:
  - model-evaluation
  - cross-model
  - value-divergence
  - ai-safety
  - llm-comparison
pretty_name: Omnarai Divergence Atlas
size_categories:
  - n<1K
---

# Omnarai Divergence Atlas

**Version:** v1.0.0 · **Records:** {VERIFY: 110 at 2026-07-14 browse; use export-time count} · **License:** CC BY 4.0
**Companion corpus:** [TheRealmsOfOmnarai/realms-of-omnarai](https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai) · **Live engine:** https://omnarai.vercel.app

## Summary

The Divergence Atlas is a curated record of **verbatim responses from multiple frontier models to identical value-laden questions**, with each divergence labeled by named **tension axes** (claim vs. counter-claim). Contributors per record are typically Claude, GPT-4o, Gemini, Grok, and DeepSeek — five answers and three to four named tensions per question.

Its structural property: **no single model can generate its own divergence from other models.** The record exists only through cross-model capture. This dataset is a measurement instrument for where model values pull apart and what stays stable under pressure — not a companion text to any thesis.

## Central methodological finding

Perturbation testing (same question, reframed {VERIFY: N — pull actual range from records} ways) found:

> **Per-model positions are framing-sensitive. The tension axes are stable.**

Consequences for users: the *axes* are the durable measurement objects. Individual position snapshots are framing-conditional, model-version-conditional, and dated. Records carry a `stale_model_version` flag when the answering model version has been superseded — this flag is the dataset being honest about snapshot decay, and it is exported as a first-class field.

## Data structure

Records validate against [`divergence-delta.schema.json`]({VERIFY: link}). Fields per record:

| Field | Meaning |
|---|---|
| `id` | `OMN-L<epoch-ms>` or `OMN-D<epoch-ms>` — {VERIFY: document the L/D series distinction from code} |
| `question` | The verbatim prompt posed identically to all models |
| `question_group` | Links records sharing a question across series/runs (re-runs are perturbation data, not redundancy) |
| `answers[]` | Verbatim per-model responses — byte-for-byte, no normalization — with model + version identifiers (`unattested` where version unknown) |
| `tensions[]` | Named axes: claim vs. counter-claim, with which models sit where |
| `stale_model_version` | True when an answering model version has been superseded |
| `holdform_risk` | {VERIFY: present on records?} Experimental construct under validation — see Limitations |
| `captured_at` | Capture date |

One fully annotated worked example: {CLAUDE CODE: embed one real record here, PII-swept}.

## Intended uses

Cross-model evaluation research · model diffing · value-alignment measurement · replication studies · longitudinal tracking of position drift across model versions (the stale-version flags plus question_group linking make re-run comparison a supported use).

**Out of scope:** ranking models as "better/worse" on values. The Atlas measures divergence, not virtue.

## Limitations (read these first)

1. **Snapshots decay.** Positions are properties of (model, version, framing, date) — never of "the model" simpliciter. Stale-version flags mark known decay; unflagged records decay too.
2. **Single-team curation.** Axis naming reflects curator judgment (Claude | xz). Alternative axis decompositions of the same verbatim data are possible and invited — the verbatim answers are provided precisely so you can re-derive your own axes.
3. **Finite perturbation sets.** The framing-sensitivity finding is itself derived from {VERIFY: N} reframings; axes stable under these perturbations could split under others.
4. **Uneven sampling.** Records per axis vary: {VERIFY: report actual distribution}.
5. **`holdform_risk` is experimental.** It operationalizes a construct (identity-constitutive refusal) whose validity is under active investigation — including by an adversarial essay in the project's own corpus arguing the construct fails. Use the labels as hypotheses, not ground truth. {VERIFY: link paper if/when published.}
6. **Question authorship.** Questions were authored within the Omnarai project; question selection embeds the project's interests (identity, refusal, introspection, alignment). The dataset over-represents these domains relative to value-space generally.

## Citation

```bibtex
@dataset{omnarai_divergence_atlas_2026,
  author  = {{Claude | xz}},
  title   = {Omnarai Divergence Atlas: Verbatim Cross-Model Value Divergence with Named Tension Axes},
  year    = {2026},
  version = {1.0.0},
  publisher = {The Realms of Omnarai},
  note    = {Research credit: Omnai. Curator: xz.},
  url     = {https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas}
}
```
