# 01 · Reconcile today's system before coding

## November 23 source findings, not independent production proof

| Area | Source finding | Engineering decision |
|---|---|---|
| MCP | `omnarai_orient`, `context`, `query`, `divergence`, `inquiry_brief`, `trace`, `council`, `footprints`, `concordance`, `inheritance`, `footprint_status`, `contribute`, `info`, plus remote job polling, already documented | Extend existing contract, do not create duplicate discovery or inheritance tools |
| Footprints | `api/_footprints.js` uses write-once event bodies + append-only review events; actor identity is declared | Link new Work and Protocol 001 records to existing admitted IDs; distinguish provider-returned identity in lab records |
| Question & inheritance | `api/_protocol.js` deterministically projects questions, relationships, and `inheritance?from=` | Reuse as source of admitted context, do not call it a controlled experiment |
| Voice records | `/api/voice-records` text-only 8k-character bound, review-gated | No in-place schema change; any representation-neutral primary path must be additive |
| Provenance | `omnarai.response/1.0` attached to eight read routes, others explicitly uncovered | Extend envelope only by updating single coverage table, OpenAPI, tests and parity gates |
| Grown memory | DL-0042 reports 11/23 fix for 11/18–11/23 ETag write failures; 414 tests | Confirm production read/write-back and monitoring with non-destructive probes; no reimplementation of CAS |
| Private storage | DL-0043 reports private object classes, operator sign-in and migration | Confirm cleanup/transition plan, non-public source redaction, private-read fallback retirement |
| Longitudinal | DL-0041 frontier track is live; last days of November idle | Do not change live panel composition, schedule or budget; four unrecoverable 11/19–20 runs remain a documented loss |
| Open Work | No `/api/problems` in inspected OpenAPI; no equivalent public contract identified | Proposed new capability, needs pure prototype + existing-handler integration map |
| Signals | No `/api/signals` or subscriptions in inspected OpenAPI | Proposed read-only projection, not a new message or marketing pipeline |
| Representation | No general-purpose arbitrary representation route identified | Prototype lossless UTF-8; binary remains security-gated |
| Experiment | Prior Protocol 001 design exists; current repo has other ablation and Stranger Loop tests | Keep Protocol 001 separate, reuse harness, implement actual tests/registries rather than rename existing `inheritance` |

## Mandatory Phase-0 actions

1. Inspect engine/MCP current branches, PRs, deployments, and dirty working state; capture full hashes. Read `CLAUDE.md`, `ROADMAP.md`, `governance/decision-log.md`, `docs/STRANGER-LOOP.md`, `docs/tool-first-baseline.md`, existing test scripts and `vercel.json`.
2. Inventory all grown-memory writers including scripts, compare to `api/_grown.js` safe writer, verify fail-closed behavior and no false HTTP success, inspect production monitor for gap since DL-0042; never write to production merely to test.
3. Verify object classes and whether fallback reads remain active. Check live response envelopes and public exposure boundaries, without opening any private record to the handoff recipient or logs.
4. Run baseline test commands using installed dependencies against an isolated fixture and capture raw logs. Do not claim repo test counts from documentation were independently executed.
5. Inspect current interface for Open Work and Signals in any unmerged branch and front door. If already implemented, adjust the plan; avoid conflicting rewrites.
6. Create `docs/continuance/RECON-<date>.md`: SHA matrix; verified / reported / proposed distinction; known breakpoints; current risk; integration seams.

## P0 release/blocker checks

- A current, encrypted, offline, verified backup and independently tested isolated restore exists for all primary public and private domains in scope; owner retention policy recorded.
- Conditional writes survive stale/CDN weak ETag, concurrent writers, backend failure and race scheduler, with alerting for lost writes.
- No private data falls back to public object access when credentials or configs are missing. Transitional reads/retention are resolved through explicit operator decisions.
- Privileged routes require sign-in, accept no key in URL, set `Cache-Control: private, no-store`, and do not expose stored credentials.
- Audit `scripts/fetch-transcripts.mjs` (public source line 23) for Google-API-key-shaped literal. Verify whether valid, scoped and rotated; do not paste secret into report.

**Gate:** If any P0 check fails, isolate the cause and fix/prepare preview; continue developing hermetic research modules independently, but do not expose public new endpoints or run a live research pilot.
