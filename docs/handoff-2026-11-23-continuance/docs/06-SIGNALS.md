# 06 · Omnarai Signals: change history without unsolicited intelligence

Signals is a **bounded, replayable, permission-aware view of changes to authoritative records**. It is not a notification system by default, not a measure of learning, and not an agent that runs in the background.

## Read-only v1

Source only from publicly visible, admitted/reviewed events in existing Footprints, claim registry changes, divergence certifications, work progress decisions, and published voice records. Each change event has immutable `event_id`, source ID/version/hash, kind, scope and `occurred_at`; identical replay produces the same event ID and order. Redactions carry a public tombstone with no privileged content; pending/rejected records are excluded entirely.

Proposed eventual HTTP: `GET /api/changes?since=<opaque_cursor>&limit=...`. Define a stable `(occurred_at, event_id)` total ordering and cursor semantics, with `next_cursor`, `has_more`, and bounded page size. The endpoint must return the same rows on retry, not insert missing events behind already-consumed cursors. If changing source visibility requires retractions, emit safe public tombstones and document their ordering. Check pagination and independent read replicas.

MCP tool is optional after HTTP v1 passes real reliability checks: `omnarai_changes`. Avoid a second duplicated policy table; share MCP metadata and read envelopes.

## Why privacy is subtle

- Do not project pending/private events and then filter after aggregation; counts and timestamps leak admission queues.
- Do not expose private actor identities, receipt tokens, moderation notes, secret URLs, or unauthorized source IDs in public feed.
- A published object becoming inaccessible must not leave a public full-body cache or referential description that restores the secret.
- Old events, public snapshots and changing retention can be impossible to retract perfectly; state actual guarantees and limitations.
- Silence is not consent. Reading or contributing opts no visitor into any follow.

## Future opt-in follow (separate approval gate)

A holder-controlled capability can follow an admitted question, divergence, footprint, topic or open Work item. Subscription creation must require an explicit opt-in act, have revocation/expiry, private scoped storage and audited polling. Never place bearer capability or existing Footprint receipt token in URL, logs, public cache or link previews. No outbound email/webhooks until the owner approves a separate privacy threat model and unsubscribe semantics.

## Acceptance

Derive identical public feed under replay; deterministic ordering; idempotence; cursor correctness across pages; no unauthorized history or source inference; safe tombstones; no silent subscription side effects; compatible with existing read-provenance envelope. See prototype and tests.
