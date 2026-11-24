# 12 · Explicit decisions (do not infer authorization)

**D-001:** Confirm canonical names for `/api/problems`, `/api/changes`, `omnarai_problems`, and `omnarai_changes` after verifying available routes/namespace collisions. Default: prototype-only, no new live route.

**D-002:** Determine whether `resolves` should be a new versioned Footprint edge, a work-event relationship, or both. Default: do not change old Footprint enum or break stored bodies.

**D-003:** Define which problem registrations become public, who can register, and versioned review event rules. Default: curator registration, private first, explicit admission.

**D-004:** Approve exact task suite, preregistration hash, independent verifier set and proposed paid API ceiling for Protocol 001. Default: no paid calls, no external testing, no sealed task disclosure.

**D-005:** Decide whether any production migration is necessary following DL-0043, including retirement of `PRIVATE_READ_FALLBACK`. Default: leave untouched, report and request approval with recovery plan.

**D-006:** Decide Signals follow/subscription retention, capability issuance, revocation, and consent semantics. Default: public read-only feed only; no follow, email, webhook or push.

**D-007:** Approve additive UTF-8 primary ingest after moderations/threat review; arbitrary binary and active formats require a second explicit safety and privacy decision. Default: fixture-only.

**D-008:** Approve public-facing fourth Instrument action only after independently tested real continuation, separate front-door preview and owner signoff. Default: defer UI.

**D-009:** Handle API-key-shaped literal in the public transcript-fetcher source. Default: inspect privately, rotate/restrict if real and document without revealing literal.

**D-010:** Define legitimate redaction/retraction effects on historical Signals records and immutable primaries with legal/access boundaries. Default: deny access before public projection; no impossible promises of universal erasure across copied caches.
