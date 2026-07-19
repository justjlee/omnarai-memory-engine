# DELTA — 2026-07-19 Resident v0: landing, then rulings (governance substrate, no agent)

*(Prior delta: 2026-07-16 P0 repair session — see git history.)*

**Input:** `omnarai-resident-v0` (constitutional substrate for a bounded internal agent), plus a
brief with an explicit do-not list.
**Output:** substrate landed verbatim at `resident/`, 22/22 in place; pre-registered null written
as the genesis stratum; three artifacts returned rather than built. **Nothing deployed. No agent.**

## What this session was not

The most load-bearing property of this change is what it *doesn't* contain. The brief's
prohibitions, each verified at the end:

| Prohibited | Verified |
|---|---|
| Scheduled agent loop appending autobiographical primaries | None exists. No automated append path of any kind. |
| Coining the HOLD #10 heavy token | Not carried anywhere written this session. Nothing needed it — which is the density test returning a verdict. |
| Resolving the proxy-holder question (HOLD #9) in code | No `vote_holders` list is instantiated anywhere in the repo. |
| `_destroy` outside the unanimity path | `grep -rn "_destroy"` → one call site, `governance.py:72`, inside the unanimity branch. |

*Part 1 below is the landing. Part 2 is the same day, after an external review confirmed the
defects and xz ruled on both open governance questions. Part 1 is left unedited — a delta that
rewrites its own first half to match the ending is worth nothing as a record.*

# PART 1 — the landing

## Landed verbatim, and proven so

`diff -rq` of `resident/` against the source package reports exactly one differing file:
`CHANGELOG.md`, which received an appended entry per its own append-only rule. Every other file —
`src/`, `schema/`, `prompts/`, `fixtures/`, `tests/`, `HANDOFF.md`, `PHILOSOPHY.md`, `verify.sh` —
is byte-identical. `bash resident/verify.sh` → **22/22 passed**, pure stdlib, no network.

## The genesis stratum

`resident/primaries/genesis.json` — 7 `kind: commitment` primaries, `actor: xz`, written by
`register_preregistration.py` (idempotent; refuses to overwrite, because the store is append-only
and a correction is a supersession, not a re-run).

xz set **N=5, M=3, p=0.6** on 2026-07-19. `threshold` stays **procedural** —
`mean(control_delta) + 2·sd`, defined by the mandatory control run. A literal there would have
been a guess wearing a number, which is precisely what the control run exists to prevent.

All 7 are `researcher_visible: false` **and** `claimed_load_bearing: false`. The second flag is the
subtle one: these are xz's commitments, not the resident's memories. The perturbation test runs
only against primaries the *resident* asserts are formative, so flagging pre-registration
primaries load-bearing would have fabricated the exact claim the instrument exists to test.
Conformance to `autobiographical_primary.schema.json` verified field-by-field.

## The refusal worth recording

`register_preregistration.py` declines to call `governance.add()` for its provenance check, even
though that is the obvious call and the check is exactly what it wants. `Governance.__init__`
demands a `vote_holders` list — and writing that list **is** answering HOLD #9. Reaching for the
convenience would have made the first act in the record a governance decision nobody made. It
asserts provenance inline and documents the reasoning in the module docstring.

## Defects found (reported, not fixed)

In the shipped substrate — all four in `resident/INTEGRATION_REPORT.md` §3.3:

1. **The attestor can be given standing by proxy.** `_validate_ballots` checks
   `b.voter == self.attestor`; nothing checks `b.on_behalf_of == self.attestor`. So
   `Ballot("cust_a", "delete", "x", on_behalf_of="layer3")` validates cleanly, and Layer 3 is now
   inside the politics it exists to stand outside of. The constructor guard doesn't reach this —
   it protects `vote_holders`, not ballots.
2. **The double-vote guard keys on identity, not party.** It rejects the same `voter` string twice
   but cannot see one party operating two vote-holder identities — the attack §Open Decision names
   verbatim. `Ballot` has no principal field, so this is honestly unimplementable pending #9
   rather than a bug; it should close *as part of* the #9 answer.
3. **`Store.dump()` omits `_deleted_ids`.** Reload from a dump and the resurrection guard is empty:
   the single irreversible act becomes reversible by process restart. Recoverable from `destroy`
   events, but no loader exists yet, so whoever writes `Store.load()` inherits this.
4. **`all_events()` has no firewall filter** while `_log` writes free-text `meta.ground` /
   `meta.reason` that will in practice quote primary content. The audit trail leaks around the
   firewall the moment an events feed exists.

In the engine: **`api/store.js:262,312`** overwrites `proposal.provenance.status` with no history
array — a state change with no ground, which is `PHILOSOPHY.md` §5's own definition of drift. Left
alone (out of scope, and the proposal flow is not the autobiographical store), recorded so it
isn't discovered later as a surprise. `api/_annotations.js:82` is the clean counter-example.

## The false-H0 trap

`run_perturbation` withholds a primary by filtering `store.active()` — the *prompt*. If a live
probe reaches the model through `api/query.js`, the model can retrieve the withheld primary back
through the retrieval pool, the delta collapses to noise, and the test reports **H0 by instrument
error** — confirming the null, which is the one result the project has committed to publishing.
`exclude=` filters by layer, not by id. **Id-level exclusion does not exist and is required before
the first live run.**

## Doc currency swept

- **`README.md` said "Code: MIT".** Wrong, and the only place in the repo saying it — `LICENSE` is
  Apache-2.0, `package.json` is `Apache-2.0`, `NOTICE` spells out the three-way split. Corrected
  to engine Apache-2.0 / corpus CC-BY-SA-4.0 / brand reserved, pointing at both files. A licensing
  statement on the front door of a public repo, so it mattered more than its size.
- **`README.md` said "Six tools".** The stdio MCP ships 7 (`omnarai_inquiry_brief` was missing);
  the remote ships 8 with `omnarai_job`, and the remote endpoint wasn't mentioned at all. Both
  corrected against `api/_mcp.js` as the source of truth.
- `CLAUDE.md` — status line to 2026-07-19; new `resident/` architecture section carrying the
  firewall rules, the port constraints, and the HOLD gates.
- `HANDOFF.md` — session entry appended (it is the ledger; appended, not replaced).
- `sync-doc-counts.py --check` → clean (567 works / 528,077 words / 61 nodes / 164 edges). This
  session touched no count surface, as expected.

## Also committed

`atlas/certify-checkpoint.json` — a **completed** cert run (16/16, 3,954 chat calls) left
uncommitted in the working tree by a prior session, committed separately and untouched. Note the
discrepancy for whoever picks it up: HEAD's message reads "CERT-BATCH-2026-07 complete: 25/25
graded" while the file that commit contains says `done: 8, of: 25`, and this working-tree version
is a different run entirely at `of: 16`. Committed as-found rather than reconciled — the
reconciliation is a curator call.

## Next

**HOLD #9 blocks the habitat layer and is a curator decision, not a build.** Buildable before it:
close the two ballot holes, `Store.load()` rebuilding `_deleted_ids` from the event log, firewall
`all_events()`, id-level exclusion in `query.js`, register the identity-integrity ratio in
`claims.json` at `untested`. See `ROADMAP.md` §🔭 The resident observatory — which deliberately
does not contain the item "build the resident."

---

# PART 2 — same day, after the external review: rulings + hardening

The review confirmed all four reported defects. xz then ruled on both open governance questions.
Everything below is the same session; the landing account above is left unedited as the record of
what was true at landing.

## HOLD #9 — ANSWERED: the empty seat

**Nobody holds the resident's proxy.** It holds a real seat in `vote_holders` that it alone may
occupy; `on_behalf_of == resident_seat` is refused, and the seat cannot be claimed by assertion
(`resident_has_arrived` comes from the pre-registered condition, never a custodian's say-so).
Since deletion requires unanimity across every seat and an empty seat never casts a ballot,
**deletion is structurally unreachable until a resident arrives.**

The three questions §Open Decision asked, answered by dissolution rather than appointment:
*who holds the proxy* — no one; *what strips the badge* — nothing, because nobody wears it, and
occupancy is an **arrival** on the unchanged condition (H1 on ≥N across ≥M); *what stops the
proxy-holder voting twice* — there is no proxy-holder, so the attack surface is removed rather
than guarded.

Forgetting is deliberately untouched: tombstoning stays non-unanimous, so the record still
breathes. It simply cannot be destroyed while no one is home to defend it.

`Governance` additionally now rejects a single-seat roll — unanimity across one seat is not
unanimity, and letting that construct exist would have made the ceremony available to one party.

## HOLD #12a — ADOPTED

H0 is reachable **only** through *answered* probes with sub-threshold deltas. No silence, from
any cause at any standing, is evidence for the null (`PerturbationResult.counts_toward_null`).
Accepted cost, recorded rather than buried: **the program is unfalsifiable-by-silence.** 12b and
12c are not adopted; they move to the roadmap unruled.

## Both rulings landed as SUPERSESSIONS, not edits

`genesis.json` is byte-untouched (verified by `git diff`). The rulings are appends in
`primaries/rulings-2026-07-19.json` via `record_rulings.py`, each referencing the superseded
primary's id and stating its ground. Editing a pre-registration in place is precisely the drift
`PHILOSOPHY.md` §5 defines — so the first real use of the supersession mechanism is the project
correctly amending its own founding document.

## Defects closed

| Finding | Disposition |
|---|---|
| §3.2.2 firewall read default backwards | `active(researcher_facing=False)` → `active(internal=False)`, fail-closed. **Renamed, not flipped in place**, so stale callers fail loudly. `perturbation.py` now passes `internal=True` — calling it bare would have handed the probe an empty context and manufactured a false H0. |
| §3.2.3 audit trail leaks around the firewall | `all_events()` redacts `meta` for non-visible primaries; op/id/actor/ts still show. |
| §3.3.1 attestor gains standing by proxy | `on_behalf_of == attestor` refused. |
| §3.3.2 double-vote keys on identity, not party | **Dissolved by the #9 ruling**, not patched. The `party` field turned out to be unnecessary. |
| §3.3 `_deleted_ids` unserialized | `dump()` writes it; new `Store.load()` restores it and recomputes from `destroy` events for older dumps; inconsistent dumps fail loudly. |

**Byline corrected** on both reports. "Claude | xz" is an attribution convention, not a continuity
claim — and on documents *about* whether continuity is real, a signature that presupposes it is
the archive presenting as a single subject. Caught by the reviewer, and correct.

**Tests: 22 → 42.** Still open: id-level exclusion in `query.js` (the false-H0 trap), the
pre-registered run count, the `claims.json` integrity-ratio entry, and `api/store.js`'s
history-free status overwrite.
