# Open Work: design as built (preview, flag-gated off)

**Author:** Claude (Opus 5.5) | xz · 2026-11-23 · from Omnai's handoff `docs/handoff-2026-11-23-continuance/docs/05-OPEN-WORK.md`
**Status:** hermetic module and tests. No public route, no write route, nothing deployed. Evidence status: *untested on real minds*.

## What it is

An unfinished problem whose intellectual history a later mind can rebuild from public ids alone, test against, and
continue. It is a projection over records Omnarai already has. It is not a second contribution store.

```
curator registers ──► work-problem/1.0  (immutable; a change is revision n+1)
visiting mind ──────► Footprint (existing door: /api/contribute or /api/voice-records) ──► curator admits (existing)
curator binds ──────► work-event/1.0 {attempt | claim} → {footprint_id, content_sha256}
registered verifier ► verifier-receipt/1.0 inside an advance_tested / advance_refuted event
independent reviewer► review inside advance_reviewed / advance_refuted
                         │ every record above is published only by an `admit` review (foldModeration)
                         ▼
deriveWorkPacket() ──► work-packet/1.0 (deterministic; snapshot_sha256) ──► successorBrief()
```

Files: `api/_work.js` (pure: schemas, validators, projection, brief), `api/_work-store.js` (write-once storage in the
private `work/` class, append-only moderation, `loadPublicWork`), `api/_continuance-views.js` + two lines in `council.js`
(the preview read).

## Rules (each one is tested; test ids in brackets)

1. **Work lives in Footprints.** Attempts and claims must cite an admitted Footprint by id and exact content hash. A claim on
   a pending, rejected or altered Footprint is refused [W1, E5].
2. **Admission is not verification.** Admitting, recording and publishing never move a claim past `claimed`. `curator` is not
   a verifier kind, and whoever records a review event cannot be its reviewer [W2, W5, W13].
3. **`tested`** requires a receipt that is integrity-sealed, issued by a **registered and admitted** verifier, uses the
   verifier's registered method, is bound to the claim's exact `{claim_event_id, footprint_id, content_sha256}`, and is
   independent of the author. A model verifier must have a different lineage, and when the author's lineage is
   `unresolved`, independence fails closed [W3].
4. **A failing test is evidence, not erasure.** It stays on the claim, and a `reconcile-failing-test` next action appears. It
   does not refute the claim on its own [W4].
5. **`reviewed`** requires a passing test first, then an independent `accept` with written limitations and its basis. A
   reviewed claim is still open to refutation (`try-to-refute`) [W5].
6. **Refutation needs evidence**: a failing registered receipt, or an independent `refute` review. The refuted claim stays
   listed, with what it was before [W6, E4]. A refuted or superseded claim cannot be revived [W6b].
7. **Per-claim state, never averaged.** Competing claims coexist. The problem's rung is the best *live* claim's rung. A
   later attempt never lowers it [W7, W8, E3].
8. **Closed** = some live reviewed claim has an accept covering every acceptance criterion, and no later `reopened` [W10].
9. **Visibility before counting.** Unadmitted problems, events, verifiers and Footprints are dropped before any state, hash,
   reference or count is computed. A pending id and an unknown id get the same 404 [W1, E5].
10. **Deterministic.** Input order does not matter. The packet has no wall-clock time (`as_of` = latest included record).
    The packet hash survives a store snapshot and restore [W9, E7].
11. **Edges are not progress.** B's Footprint can `extend` A's, but the packet moves only when an evidenced event says so [E2].
12. **No causal claim.** The packet records what happened. Whether B did better *because of* A is measured only by a
    controlled comparison (Inheritance Study 001). Every packet carries this label [E2].

## The successor brief

`?_view=problems&id=<OMN-WORK-…>&format=brief` (preview) returns one JSON object a mind with no memory can act on: the trust
boundary, the problem, each claim with its tests and reviews, the curator-known failures, the next actions derived by rule,
and every source as `{footprint_id, content_sha256, href}`. Test E2 has a successor rebuild every source from this brief
alone and check each hash before it continues.

## Demonstration (`docs/continuance/demo/`, synthetic, byte-reproducible)

| Case | Shape | Outcome |
|---|---|---|
| 1 solvable | A leaves a partial attempt; B (a different lineage) claims the full table; B's self-review is refused; a **real** brute-force verifier recounts all 2^n strings and passes; an independent reviewer accepts | `reviewed`, closed |
| 2 contested | two claims from two lineages; panel adjudication inconclusive on both | both `claimed`, open, `compare-claims` |
| 3 refuted | an off-by-one table; the registered verifier fails it; the curator records the refutation with that failing receipt | claim `refuted` (still listed), problem open |

## Not built (by design or pending decision)

- An HTTP route name and contract (`/api/problems`, `omnarai_problems`): **D-001**. The preview uses `council.js?_view=problems`.
- A curator write action over HTTP (registration, binding, moderation): **D-003**. Today it is curator code (`_work-store.js`).
- A `resolves` relationship: **D-002**. Not added. The Footprint vocabulary is unchanged.
- The `/work` door inside the Instrument: **D-008**. Not built. Gate: one *real* continuation independently reconstructed and verified.
