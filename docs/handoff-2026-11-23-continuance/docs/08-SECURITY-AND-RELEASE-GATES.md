# 08 · Security, durability, governance, and release gates

## Production safety policy for this handoff

**Allowed now:** read-only source reconnaissance; feature branch with local code; mocks; offline/hermetic tests; non-destructive static analysis; redacted test logs.

**NOT allowed without separately documented approval:** paid provider calls; production writes or probes with side effects; deployment/promotion; privacy migration/delete/retention changes; admission or rejection of real visitor records; modifying claims registry scientific status; contact or subscription activation; publishing sealed test answers; opening/reusing real secrets; and automatic agent residency.

## Storage integrity (P0)

1. Recheck `api/_grown.js` ETag normalization, conditional put, retry from fresh state and response handling. Current source says a Nov 23 patch has shipped; do not re-solve already-solved problem. Add/inspect a production-safe synthetic monitor strategy that can detect failed writes without risking real data.
2. Inventory **every** whole-file `memory/grown.json` writer, including scripts. No blind write path survives. Fail closed if no strong identity token or if private token missing.
3. Exercise interleaving and stale-edge simulations with real SDK-compatible mock responses (weak ETags) and document fail-safe behavior.
4. Compare backups, manifests, earlier contributor admissions and current IDs; preserve missing 11/19–20 longitudinal records as losses, not reconstructed provenance.
5. Verify isolated restore of public AND private source classes. Separate retained private archive from public corpus and never upload privacy-protected material to Git.

## Data classification / security design

- P0 current `api/_storage-classes.js` distinguishes `public` and `private`, defaults unknown path private. New `work/events/`, `research/`, `signals/` classes MUST be registered and gated before production.
- Private submissions and evaluation tasks stay server-readable only. Avoid any leaked token in URLs, rendered pages, tool text, referrer, tracking, or diagnostics.
- Authentication is an authority gate, not a proof of scientific value. Research evaluator permissions separate from curator account permissions.
- Apply data retention minimization. Persist only fields justified for reproducibility; protect visitor-supplied identifiers.
- Scrub all derived/public output, including hashes/cursors/previous-state links, for indirect leakage of not-admitted records.
- In a private safety review, verify potential API-key-shaped literal in `scripts/fetch-transcripts.mjs`; rotate/revoke if real, replace with environment variable and guard against reintroduction. Do not expose literal in logs/handoff.

## Release gates

**G0 source fit:** current HEAD and production route parity recorded; no dirty-worktree loss; new names do not collide with production.

**G1 offline correctness:** all fixtures pass without network, and deliberately broken implementations fail the relevant tests. Test stale ETag and private deny, failed verifier, sample mismatch, generation invalidation, unauthorized signal, repeat cursor, Unicode tamper.

**G2 review:** schema compatibility and claim statuses; evaluator preregistration and proof of pre-outcome freeze; ability to reproduce from pinned hashes; no accidental sensitive data in public artifacts.

**G3 preview:** owner explicitly approves preview deployment where necessary; compare HTTP/MCP parity, 401/404/503, front-door UX and machine entry. Do not promote automatically.

**G4 production:** separate, explicit permission for each endpoint, data migration, and release; reviewed rollback plan, backups, 7-day reliability observation proposal and owner signoff.

**G5 evidence:** only after real independent results, report confidence/uncertainty/cost and update relevant claims under existing governance. A claim cannot jump from "code passes mocks" to "cumulative intelligence established."

## Gate for public Open Work

Do not add a visible fourth Instrument action until at least one actual continuation is independently reconstructed and verified, with a documented outcome and ability to replay the trace. Its success may be a **correct refutation** rather than a solved problem.
