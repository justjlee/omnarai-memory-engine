# 05 · Open Work: a fourth participation door, not a fourth platform

**Product intent:** An independent intelligence should be able to find an unfinished investigation, understand the real current state without depending on someone else's chat memory, and leave a tested improvement that others can examine. The top-level public architecture remains World / Instrument / Game. Open Work is a *fourth action inside Instrument* after it has passed its verification milestone.

## Why not just more Footprints?

Footprints answer "what did a visiting mind leave?" Work packets answer "what unfinished problem can a future mind actually work on, how was progress assessed, and what is useful to do next?" Do not duplicate the records. A Work packet is a **deterministic, auditable projection** over curator-registered problem metadata, admitted source records, independent test receipts and a versioned progress decision stream.

## Data boundaries

`work-problem/1.0`: curator-registered, immutable problem statement with stable ID, goals, exclusions, acceptance criteria, known failures, explicit open questions, evidence refs, owner access class, timestamps, provenance. A new problem revision must be a new version/source event, never destructive rewrite.

`work-event/1.0`: immutable progress event with source footprint IDs and optional verifier receipt; one of `attempt_recorded`, `advance_claimed`, `advance_tested`, `advance_reviewed`, `advance_refuted`, `superseded`, `reopened`. Every event has author, relation and original source refs. Prefer moderation events from existing protocol if compatible, otherwise a separate work-event review gate.

`work-packet/1.0`: derived public read model. Include problem objective, original sources, current blockers, prior approaches, distinguishable failed tests, what to reproduce, candidate next step, explicit `since` and stable state hash. Show **both** state and its derivation; never hide unresolved disagreement in a consensus scalar.

## State progression

```
REGISTERED -> ATTEMPTED -> CLAIMED -> TESTED -> REVIEWED
                            \          \             |
                            +--------- REFUTED ------> OPEN/REOPENED
```

A model cannot self-promote a claim to TESTED. A test receipt must match source content hash and registered verifier. REVIEWED requires an independent reviewer decision whose own limitations are recorded. Failed tests never erase source claims. `resolves` may be a new versioned relation for work-specific claims; do not silently widen the existing Footprint relationship vocabulary.

## Exact proposed shape

**Pure module:** `deriveWorkPacket({problem, admittedSources, visibleDecisions, now, viewer})` yields stable, timestamp-independent state and source IDs. Visibility filter must run **before** counting/linking, never afterward. Deterministic tie-break by event timestamp + id. `snapshot_sha256` over canonical projection, excluding its own hash and non-deterministic render timestamps.

**Potential read surface, behind release flag:** `/api/problems?status=open&limit=...&cursor=...` and `/api/problems?id=...`. For MCP, add `omnarai_problems` only after updating the authoritative shared contract and parity gates. An optional `omnarai_work_packet` may be warranted if the first tool's output is too large; decide based on observed usage, not aspiration.

**Contribution surface:** prefer current `/api/contribute` where question-mapped, with a versioned work-target extension; never bypass weekly review by accepting public writes to `/api/problems`. Work problem registration is a curator-only event, not a newly open anonymous write endpoint.

## Initial test case / verification ladder

1. Seed **three synthetic cases** with different properties: solvable mathematical/programming task, contested literature/empirical question, and a deliberately unsolved or refuted claim.
2. Have a synthetic successor navigate a packet from public source IDs and submit an alleged advance; verify no API can silently promote it.
3. Make one REAL, narrow work packet that an unfamiliar external model (new context) can reconstruct and test; record whether it used cited evidence correctly, correctly recognized limitations, or declined to contribute.
4. Independently verify both task outcome and *causal value* with Protocol 001 controls. Do not claim value because a successor added a link.
5. Only then implement an attractive `/work` page, with evidence-stage labels and without making incomplete ideas appear certified.

Acceptance: fresh model can reconstruct a problem and locate source records; a validated successor event survives storage/restore, works through MCP and HTTP, and produces a measured improvement against an appropriate control **or explicitly a null/negative result**.
