# Signals: design as built (preview, flag-gated off)

**Author:** Claude (Opus 5.5) | xz · 2026-11-23 · from `docs/handoff-2026-11-23-continuance/docs/06-SIGNALS.md`
**Status:** pure module, tests, and a preview read (`council.js?_view=changes`, needs `OMNARAI_SIGNALS=1`). Nothing deployed.

A read-only, replayable feed of meaningful **public** changes. It subscribes nobody, sends nothing, and runs no agent.

## Sources and event kinds

| Kind | Scope | From | Fields beyond the common ones |
|---|---|---|---|
| `admitted` | `footprint` \| `voice` | a Footprint's review log: a transition into admitted | — |
| `withdrawn` | same | a transition out of admitted **after it was public** | `reason_class` (rejected \| retracted \| redacted) |
| `claim_status_changed` | `claim` | `public/claims.json` `status_history` | `from`, `to` |
| `work_problem_published` | `work` | an admitted problem revision | — |
| `work_progress` | `work` | an admitted Open Work event | `problem_id`, `event_kind` |

Common fields: `schema`, `event_id`, `kind`, `scope`, `source_id`, `source_revision`, `occurred_at`. Nothing else is ever
emitted: no bodies, declared identities, reviewers, notes, reason codes, redaction categories or tokens [S3]. Divergence
certifications, Atlas growth and corpus merges are **not** projected yet, and every page says so in `not_covered`.

## Privacy

- A record that was never public produces **nothing**, so its pending time, its rejection and its existence stay invisible [S1, E5].
- Bodies are read only for records that were admitted at least once (`loadAllSignals`). A record whose body now fails its
  integrity check produces nothing (fail closed) [S1].
- A withdrawal is a tombstone: the id that was already public, the time, and the class of the new state [S2].

## Order, replay, cursors

- `event_id = "sig_" + sha256(canonical event)[0:32]`. Total order on `(occurred_at, event_id)`. Replaying the same
  sources gives the same ids in the same order, deduplicated [S4].
- `?since=<cursor>&limit=1..100`. A cursor carries the last consumed event and a **chain hash** over every event id up to it.
  If the history behind the cursor has changed (a late record, a reconcile, a fail-closed drop), the answer is
  `reset_required: true` with a reason and no rows. Rows are never silently inserted or skipped [S5, S6].
- This is the honest guarantee for a projection without a durable event log. A durable, incremental log with a watermark
  is the production step after D-001.

## Consent

No follow, subscription, inbox, email, webhook or push exists. Each page states this. The future opt-in follow
(holder-held capability, revocation, expiry, no tokens in URLs or logs) waits on its own privacy review: **D-006**.
