# Omnarai Handoff Package — Atlas Ship + P0 Remediation
**Date:** 2026-07-14 · **Origin:** Claude | xz working session · **Supersedes:** nothing — ADDENDUM to existing HANDOFF.md / verify.sh / divergence-delta.schema.json

## What this package is
Everything needed to run one Claude Code session that (1) fixes the P0 defects, (2) stages the Divergence Atlas as a versioned HuggingFace dataset, (3) commits the trace-delta spec. All facts in these files were verified LIVE against the MCP server on 2026-07-14 — not recalled from prior chats.

## Files
| File | Purpose | Type |
|---|---|---|
| 01-SESSION-BRIEF.md | Doctrine, decisions, live audit findings — read FIRST | orientation |
| 02-ATLAS-SHIP.md | The work order: deliverables, gates, acceptance criteria | spec |
| 03-atlas-dataset-card-DRAFT.md | HuggingFace README draft with real numbers pre-filled | draft artifact |
| 04-export_atlas.py | Export script skeleton — canonical store → validated JSONL | code |
| 05-verify-atlas.sh | V1–V8 verification harness skeleton | code |
| trace_delta/SPEC.md | Blind A/B instrumentation spec (Priority #2, gated) | spec |

## How to start the Claude Code session
```
Read 00-README.md, then 01-SESSION-BRIEF.md, then 02-ATLAS-SHIP.md in this order.
Then read the repo's existing HANDOFF.md and divergence-delta.schema.json.
Reconcile any conflict between this package and repo reality IN FAVOR OF REPO REALITY,
and log every reconciliation to SESSION-LOG.md before writing code.
Execute 02-ATLAS-SHIP.md §3 deliverables in order. Hard gates in §2 are non-negotiable.
STAGE the HuggingFace push; do not publish. Publication is xz's action.
```

## Verified-live facts this package is built on (2026-07-14)
- Corpus: **567 works, 528,077 words** (per omnarai_info)
- Divergence Atlas: **110 records** (per omnarai_divergence browse)
- Record ID formats observed: `OMN-L<13-digit-timestamp>` and `OMN-D<13-digit-timestamp>` — TWO series exist; semantic difference must be determined from code, not assumed
- Record shape observed: question, contributors (typically Claude, GPT-4o, Gemini, Grok, DeepSeek), 5 verbatim answers, 3–4 named tensions, deliberation card
- Data-quality flag observed: `⚠ stale model version` present on browsed records — this is a FIRST-CLASS field for the dataset card
- Duplicate questions exist across the L and D series (e.g., the "decided something" question appears under both) — dedup policy required (§4.7 of 02)
- A HuggingFace dataset ALREADY EXISTS: `TheRealmsOfOmnarai/realms-of-omnarai` — determine whether Atlas ships as (a) a new dataset `omnarai-divergence-atlas` or (b) a config/subset of the existing one. Recommendation in 02 §1: NEW dataset (the Atlas is the instrument; the corpus is context — different artifacts, different audiences). Final call is xz's; stage as new unless overruled.
- `utility-evidence.md` is referenced by the live trace tool as containing "replicated statistical utility evidence" — LOCATE THIS FILE in the repo. If real trace-delta data already exists, Priority #2 may be partially done; reconcile before building anything new.
