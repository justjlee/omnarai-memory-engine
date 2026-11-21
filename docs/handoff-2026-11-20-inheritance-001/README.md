# Omnarai Inheritance Experiment — Protocol 001

**Handoff to Claude Code | prepared 2026-11-20 | author: Omnai (GPT-6, OpenAI) with Yonotai**

## Why this exists

This package turns the Omnarai / Claude public discussion of *cumulative intelligence* into a falsifiable engineering program. The initial deliverable is an **isolated, controlled, reproducible experiment harness**, not a claim that cumulative intelligence exists and **not** a replacement memory system. The core comparison is whether an incoming model benefits from independently evaluated contributions left by earlier, different models on genuinely held-out tasks.

## Start here

1. Read `CLAUDE_CODE_PROMPT.md`, then `docs/01_EVIDENCE_AND_REPO_FIT.md`, `docs/02_PROTOCOL_AND_STATISTICS.md`, `docs/03_INTEGRATION_PLAN.md`, `docs/04_SECURITY_AND_RELEASE_GATES.md`.
2. Open the current local worktrees for `justjlee/omnarai-memory-engine` and `justjlee/omnarai-mcp`; inspect their `CLAUDE.md`, `ROADMAP.md`, `docs/OMNARAI-FOOTPRINT-PROTOCOL.md`, `docs/tool-first-baseline.md`, `api/_protocol.js`, `api/_footprints.js`, `api/_response-envelope.js`, `scripts/local-engine.mjs`, `scripts/lib/register-mem-blob.mjs`, and test suites. **Repository truth outranks this packet.**
3. Run the enclosed **offline demonstration**: `cd prototype && npm test && npm run demo`. No dependencies, network calls, vendor APIs, production data, or secrets needed. Its outcomes are synthetic and do **not** constitute empirical support.
4. Draft a frozen preregistration derived from `protocol/preregistration-template.yaml`, with a commit hash and independent approval, **before** running model experiments.
5. Implement the harness on a feature branch and validate against the engine's in-memory Blob fixtures. Keep external model calls behind a distinct, spend-gated command.

## Included

- `CLAUDE_CODE_PROMPT.md` — paste into Claude Code with ZIP attached.
- `docs/00_DECISION.md` — recommended scope and why.
- `docs/01_EVIDENCE_AND_REPO_FIT.md` — source audit, Claude response, adjacent literature and non-duplication map.
- `docs/02_PROTOCOL_AND_STATISTICS.md` — six arms, generational design, preregistration, causal tests, statistical plan.
- `docs/03_INTEGRATION_PLAN.md` — exact implementation order and repo integration points.
- `docs/04_SECURITY_AND_RELEASE_GATES.md` — sealed data, moderation, cost, contamination, production safety.
- `docs/05_ACCEPTANCE_TESTS.md` — acceptance criteria and Claude Code deliverables.
- `docs/06_RESEARCH_NOTES.md` — research sources and points of disagreement.
- `protocol/preregistration-template.yaml` — hypotheses and experimental design to freeze.
- `schemas/*.schema.json` — proposed draft schemas for records and outputs, not production contracts.
- `prototype/` — executable **offline simulation** demonstrating canonical hashing, conditions, generational isolation, attribution, paired deltas, and tests. It uses a scripted mock, not a real LLM.
- `artifacts/` — generated sample result and file hashes.

## Explicitly out of scope for the first PR

No production deploy, public claims of success, migration of immutable corpus primaries, automatic curation/admission, live model spend, new unrestricted writes, resident autonomous agents, or redefining an existing endpoint. Preserve open disagreement and existing provenance; avoid building a competing Footprint or inheritance subsystem.

## Readiness and limits

The Reddit exchange and the relevant public repository files were inspected 2026-11-20. GitHub files were accessible through the connected GitHub interface. Direct live HTTP reads of `engine.omnarai.org` and `omnarai.org` were not available from the browsing tool. Treat production runtime as **unverified** in this handoff. README/current source state may have changed; confirm branch and commit before implementation. The standalone demo is runnable; the Omnarai integration is a design/implementation handoff, not already merged code.
