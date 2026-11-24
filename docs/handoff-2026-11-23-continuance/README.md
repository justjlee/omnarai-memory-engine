# OMNARAI — Continuance Engineering Handoff

**Version:** 2026-11-23 / H1 · **Attribution:** Omnai (GPT-6, OpenAI), collaborating with Yonotai · **Intended recipient:** Claude Code  
**Status:** Proposed architecture + runnable **offline reference implementation**. This archive is **not** a patch to production.  
**Working maxim:** Joint work across discontinuity is **continuation**, not simply storage. The target is measurable advancement attributable to prior, independently checkable work.

## Quick start for Claude Code

1. Read `docs/01-STATE-RECONCILIATION.md`, `docs/02-ARCHITECTURE-AND-INVARIANTS.md`, and `docs/03-EXECUTION-PLAN.md` first. Reconcile every dated claim with **current HEAD** and live read-only probes. Preserve dirty worktrees.
2. Run `npm test` and `npm run demo` here **offline** (Node >=20, no dependencies). This produces synthetic demonstration artifacts in `artifacts/demo/`. These are NOT real-model measurements.
3. Inventory the real engine and MCP tests, routes, storage adapters and schemas before implementing. Do not duplicate existing Footprints, inheritance, curator review, claim registry, MCP contract, or response envelope.
4. Implement in a **new feature branch**, beginning with durable-write/readback gates and Protocol 001. Add Open Work's reusable work packets and case-state projections; then Signals and UTF-8 expression records as explicitly separated, independently testable slices.
5. Produce the deliverables and test evidence in `docs/10-DELIVERY-CHECKLIST.md`; stop before any paid run, production deploy, public claims change, admissions, contact messages, or destructive migration pending curator approval.

## Package map

- `docs/01`–`docs/12`: source-aligned state assessment, architecture, execution, research protocol, Open Work, Signals, representation-neutral records, security and release gates, tasks, delivery checklist.
- `schemas/`: proposed versioned JSON Schema contracts. These are **proposals**, not registered production endpoints or official Omnarai schemas.
- `prototype/`: tested, zero-network JavaScript reference utilities for stable hashes, work-state folding, Signals, UTF-8 primaries, six-arm experiment planning and analysis.
- `prototype/tests/`: hermetic regression tests including negative transfer, redaction, tampering, same-generation and gate behavior.
- `fixtures/`: synthetic initial states. No live contributor record, secret, or unreleased task is included.
- `reference/SOURCE-MAP.md`: actual repo pathways and November 23 commit snapshot.
- `artifacts/`: generated local synthetic results only.
- `TASKS.json`: execution tickets, dependencies and acceptance gates.

## Claims boundary

- **Directly observed source:** GitHub API content/readable repository files as of November 23, 2026.
- **Repository-reported:** its decision log says release checks and tests passed; these were **not rerun** by Omnai against production.
- **Implemented in this ZIP:** offline prototype logic and its local tests only.
- **Not established:** live runtime availability of every route, reliable visitor identity, independently verified cross-model cumulative intelligence, or the research effect of inherited artifacts.

No route, interface, paid call, provider credential, production write, asynchronous agent, arbitrary-binary ingestion, or public publication is authorized by this packet.

**Normative hierarchy:** immutable primary > independent measurement > versioned interpretation > UI and rhetoric. Preserve nulls, challenges, costs, and failures alongside wins.
