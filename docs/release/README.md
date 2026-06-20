# Release kit — research-artifact MVP

Working drafts for the first public release. **Framing (decided 2026-06-20):** lead with the
**Divergence Atlas + measured utility evidence**, audience **AI researchers**, venues
**HuggingFace + arXiv**. Lead claim is narrow + proven, not "we add value to the world."

These are **drafts, not live.** Nothing here is deployed or pushed to HF until the curator says
go — and crucially, the "preregistered / confirmed" wording must not go live until the study runs.

## Contents
| File | What it is | Status |
|---|---|---|
| `divergence-atlas-report.md` | The technical report — the citable anchor for the claim | draft v0.1; §6 result `[PENDING CONFIRMATORY RUN]` |
| `REPRODUCE.md` | "Reproduce in ~5 min" quickstart (Tier 0 = no keys) | ready; references existing harness |
| `value-prop.md` | The one canonical sentence + exact per-surface drop-ins | ready to apply at launch |
| `announcement.md` | HF / X / Reddit drafts around the narrow claim | ready; `[POST-PREREG]` lines swap in after the study |

## Release checklist (critical path = item 1)
1. **[curator] Run the preregistered study** — `scripts/utility-test-prereg.mjs` (~$40–90, ~2 hrs, consumers one at a time). Publish `huggingface/utility-evidence-v2.md`. *Everything "preregistered/confirmed" depends on this.*
2. **[curator] Freeze a citable v1.0 Atlas** (HF DOI).
3. Finalize the technical report (fill §6 from the study; decide arXiv vs HF-report — arXiv is a **parallel** track, do not let the pending cs.CL endorsement gate launch).
4. Apply `value-prop.md` across HF README / llms.txt / landing (deploy + HF push are curator-gated).
5. Confirm the Tier-0 reproduce path works for an **outsider**.
6. Post the announcement to the chosen venue(s).

## Honesty rules (non-negotiable for this release)
- The claim is **differential**: GPT-4o & Gemini yes, Grok & Claude no. Always state the nulls.
- No "preregistered/confirmed" on any live surface until the study has actually run.
- Numbers come from `huggingface/utility-evidence.md` (source of truth) — don't paraphrase them loose.
- The Atlas **shows** divergence; it does not yet **certify** it survives perturbation. Say so.

## What's gated on the curator vs. doable now
- **Gated on you:** running the study (cost), the HF DOI, final venue choice, deploy/HF-push.
- **Already drafted (here):** report, reproduce guide, value-prop, announcements.
