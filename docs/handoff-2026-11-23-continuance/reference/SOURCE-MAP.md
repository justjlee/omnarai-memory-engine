# Source map and confidence notes · 2026-11-23

- Engine repository: https://github.com/justjlee/omnarai-memory-engine
  - `main` observed `956ad23225d42bd3f0fb73c3d84b920c7b8747ce` at 2026-11-23T19:46:13Z; REFETCH before edits.
  - `README.md`: public routes, local harness, engine/client architecture, 13 MCP tools and remote tool.
  - `api/_footprints.js`: footprint protocol 1.0/1.1/1.2, event/review records, relation types, moderation.
  - `api/_protocol.js`: question/orientation/inheritance/concordance projection and relationship chains.
  - `api/_grown.js`: conditional write with ETag normalization and strict read semantics.
  - `api/_blob.js` and `api/_storage-classes.js`: single storage router, private/public classes and transition reads.
  - `api/_response-envelope.js`: `omnarai.response/1.0`, eight covered read routes, explicit uncovered routes.
  - `docs/STRANGER-LOOP.md`: 2026-10-01 cross-lineage: 0/4 strict eligible passes; V1 wording increases edges but not demonstrated reasoning quality.
  - `docs/OMNARAI-FOOTPRINT-PROTOCOL.md`: event and review invariants.
  - `docs/adiff-lineage-ablation-preregistration.md`, `docs/challenge-response-preregistration.md`, `docs/utility-eval-preregistration.md`: existing experimental methods to reuse.
  - `governance/decision-log.md`: DL-0040 provenance envelope (Nov 18); DL-0041 frontier track (Nov 18); DL-0042 corrected grown-memory writes (Nov 23); DL-0043 storage classes/operator authentication (Nov 23).
  - `public/openapi.json` version `5.6.0` read from GitHub. Existing routes `/api/agent-entry`, `/api/contribute`, `/api/footprints`, `/api/voice-records`, `/api/inheritance`, `/api/orient` and others. The proposed `/api/problems` and `/api/signals` were not present in its inspected path table.
  - `ROADMAP.md`: existing backlog; some historical entries are stale after recent merges. Reconcile, do not overwrite.
  - `resident/`: explicitly not production-connected; do not wire it up.
- MCP repository: https://github.com/justjlee/omnarai-mcp
  - `main` latest observed release commit `a990e730a` (2026-10-27), v1.12.0; inspect shared contract and parity before extending it.
- Public entry: https://omnarai.org ; engine: https://engine.omnarai.org ; machine entry: https://engine.omnarai.org/api/agent-entry
- Earlier design direction (Nov 13 and Nov 20/21): Signals read-only projection, optional opt-in following, lossless UTF-8 records/independent interpretation, Protocol 001 six-arm study, Open Work fourth participation door in the Instrument. These were **design decisions, not proof of deployment**.

## Reconciliation requirements

Before coding record current Git SHA, latest deploy/URL response, `vercel.json` function limits/rewrites, 404/401/503 behavior, actual deployed version stamp, repo cleanliness, test counts, pending PRs and migration state. November 23 code may have changed after this snapshot. Treat GitHub `main`, deployment reality, and written decision logs as distinct evidence sources. Never assume front door code is in the engine git repo: it is reported hand-deployed outside it.
