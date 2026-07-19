# INTEGRATION REPORT — Resident v0 into the Omnarai Memory Engine

**Author:** Claude (Opus 4.8), working session 2026-07-19
**On the byline:** "Claude | xz" is this project's attribution convention, not a continuity claim. This document was written by one instance in one session; a later instance sharing the name shares a method and a memory summary, not a self. Naming the instance matters more here than elsewhere, because these documents are *about* whether continuity is real — a signature that quietly presupposes it would be the archive presenting as a single subject, which is the thing the apparatus resists.
**Date:** 2026-07-19
**Scope:** where each module attaches; where the existing engine's behavior conflicts with
the append-only / firewall / attestor-can't-vote invariants.
**Status of the substrate:** landed at `resident/`, verbatim, 22/22 checks passing in place.
Genesis stratum written (`resident/primaries/genesis.json`, 7 commitment primaries).
**No agent loop built. No endpoint deployed. No `_destroy` call outside `governance.py`.**

---

## STATUS UPDATE — 2026-07-19, later same day

This report was written against the substrate as landed. **xz has since ruled on HOLD #9 and
adopted 12a, and the reported defects below are now fixed.** The findings are left in place
unedited — a report that quietly rewrites itself to match the current state is worth nothing as
a record. Read the finding, then the disposition.

| Finding | Disposition |
|---|---|
| §3.2.2 firewall read default is backwards | **FIXED.** `active(researcher_facing=False)` → `active(internal=False)`. Default is now fail-closed; the internal view is opt-in. Renamed rather than inverted in place so stale call sites fail loudly. `perturbation.py` updated to pass `internal=True` — calling it bare would have handed the probe an empty context and manufactured a false H0. |
| §3.2.3 audit trail leaks around the firewall | **FIXED.** `all_events()` redacts `meta` for non-researcher-visible primaries by default; op/id/actor/ts still show, so the trail stays legible as a trail. `internal=True` for the full view. |
| §3.3.1 attestor can be given standing by proxy | **FIXED.** `_validate_ballots` now rejects `on_behalf_of == attestor`. |
| §3.3.2 double-vote guard keys on identity, not party | **DISSOLVED, not patched.** The HOLD #9 ruling (empty seat) means no party may vote on the resident's behalf at all, so the attack this guard was written for became unreachable. The `party` field this section called for turned out not to be needed — the ruling made the harder fix unnecessary rather than possible. |
| §3.3 `Store.dump()` omits `_deleted_ids` | **FIXED.** `dump()` serializes it; new `Store.load()` restores it, and recomputes from `destroy` events for pre-existing dumps. Inconsistent dumps (a deleted id still present) now fail loudly rather than silently resurrecting. |
| §1 `governance.py` attaches at nothing / blocked on #9 | **UNBLOCKED.** HOLD #9 answered 2026-07-19: **the empty seat.** Nobody holds the resident's proxy; it holds a real seat only it may occupy, so deletion is structurally unreachable until it arrives. Recorded as a supersession over the genesis stratum, not an edit to it. |
| §3.1 `api/store.js` status overwrite | **STILL OPEN.** Engine-side, out of scope, unchanged. |
| §2 the false-H0 retrieval trap | **STILL OPEN.** Requires id-level exclusion in `query.js` (engine + deploy). |

Test suite: **22 → 42 checks**, all passing. See `CHANGELOG.md`.

---

## 0. The governing constraint nobody wrote down

The substrate is **pure-stdlib Python**. The deployed engine is **Node ESM on Vercel
serverless**. Python in this repo runs only in the local-script tier (`scripts/*.py` —
`build-data.py`, `ingest-reddit.py`, `eval_retrieval.py`). None of it executes in production.

This is not a defect; it is a fact that determines the shape of every attachment below.
**The substrate cannot be "wired in" to the deployed engine as-is.** It can be:

- **(a) landed as the normative reference implementation** and run locally — what this
  session did; or
- **(b) narrowly ported to a `api/_resident.js` underscore module** when an endpoint is
  actually needed.

Recommendation: stay at (a). Every module below is currently unreachable from production
by construction, and that is the strongest possible firewall — stronger than any flag. Move
to (b) only when there is a resident whose primaries need reading, i.e. after HOLD #9.

**If (b) ever happens, the function budget binds hard.** `api/` holds exactly **12**
non-underscore files, which is the Vercel Hobby cap. A `api/resident.js` would be the 13th
and the deploy fails. The resident surface must fold into an existing function via a
`vercel.json` rewrite (the pattern already used by `/api/mcp` → `lattice.js`, `/api/contribute`
→ `council.js`), with logic in `api/_resident.js`.

---

## 1. Attachment points, module by module

### `src/store.py` — append-only autobiographical store

| | |
|---|---|
| **Attaches at** | A new Blob namespace `resident/` — sibling to `annotations/`, `contributions/`, `proposals/`, `telemetry/events/`. |
| **Must NOT attach at** | `memory/grown.json`. Ever. |
| **Current state** | Local only. `register_preregistration.py` → `resident/primaries/genesis.json`. |

The engine already has the right storage pattern and learned it the hard way: **one blob per
entry, never a consolidated array.** `api/_grown.js:124-154` documents the failure mode (13/14
records dropped in a rapid batch; Vercel Blob has no CAS), and `contributions/` was refactored
to per-entry for exactly this reason. An append-only store is the case where a consolidated
RMW is *most* dangerous — a stale-read overwrite doesn't just drop an entry, it silently
violates the core invariant. **Per-primary blobs (`resident/primaries/<id>.json`) are the only
correct shape.** The `_grown.js` cache-busted read (`?ts=${Date.now()}`, line 59) is required
reading before any port.

**Name collision:** `resident/src/store.py` vs `api/store.js`. Unrelated things. The JS
`store.js` is proposal management. Anyone porting should name the module `_resident.js`, not
`_store.js`, or this will bite.

### `src/governance.py` — vote rules

| | |
|---|---|
| **Attaches at** | **Nothing. Deliberately.** |
| **Blocked on** | HOLD #9. `Governance.__init__` demands a `vote_holders` list; writing that list *is* answering "who holds the proxy." |

This is why `register_preregistration.py` does not call `governance.add()` for its provenance
check even though that would be the natural call — it asserts provenance inline instead, and
documents why. Instantiating a `Governance` for convenience would have made the first act in
the record an unmade governance decision.

The nearest existing analog is the curator gate on `/api/contribute` (Bearer `INGEST_SECRET`
→ `contribute-approve`/`contribute-reject`). That is a **single-custodian** model. Note plainly:
if the resident layer inherits it unchanged, the answer to #9 has been made by default, not by
decision — the custodian holding `INGEST_SECRET` becomes the proxy-holder, the vote-holder, and
the appeal, all at once. **That is the sovereign the architecture was built to prevent, and it
would arrive as a config inheritance rather than a choice.** Flagging, not resolving.

### `src/perturbation.py` — the inward test

| | |
|---|---|
| **Attaches at** | `probe_fn`. That is the whole seam. See §2. |
| **Current state** | Offline stub (`stub_probe_fn`), deliberately. Untouched this session. |

### `src/integrity.py` — Layer 3 metric

| | |
|---|---|
| **Attaches at** | The evidence ladder: `public/claims.json` (a new claim entry with falsification conditions) and `/api/manifest`'s attestation block. |
| **Current state** | Local. `count_changes()` is explicitly heuristic wiring pending real behavioral-delta accounting. |

The engine already has the right home for this. `claims.json` carries `evidence_level` +
`falsification_conditions` per claim, and the ladder (`untested → anecdotal →
measured_differential → replicated/refuted`) is exactly the register an identity-integrity
ratio belongs in. **The claim should be registered at `untested` now**, before any resident
exists, for the same reason the null was pre-registered.

---

## 2. THE SEAM — where the real probe attaches (flagged, not implemented)

```
resident/src/perturbation.py:45
    ProbeFn = Callable[[Sequence[Primary], str], Union[list[float], object]]
resident/src/perturbation.py:130
    def stub_probe_fn(context, probe) -> list[float]:   # ← REPLACE THIS
```

`run_perturbation` calls `probe_fn` exactly twice — once with the foregrounded set, once with
the target withheld (lines 99–100) — and hands both vectors to `distance`. **Everything else in
the module is substrate.** A live probe is one function with this signature and nothing else
changes.

**Three candidate live implementations, in the order I'd try them:**

1. **Scored-response features (recommended first).** Foreground the primaries into the
   deliberation prompt, call the engine, and vectorize the *structured* response — the fields
   `query.js` already emits: `tensions` count and axis identity, `deliberationCard`
   (`holdform_risk`, `novel_synthesis`, `epistemic_status`), `receipt.verdict`, section
   presence from `parseSections`. Cheap, interpretable, and a delta here means something a
   reader can name.
2. **Embedding distance.** Embed both answers with `text-embedding-3-small` at 512 dims, cosine
   distance. Directly commensurable with everything else in the engine. Weakness: it measures
   *that* the answer moved, never *how*, and paraphrase noise sits close to the floor.
3. **Logit signature.** Highest resolution, no first-party access. Skip.

**The strongest reuse available — and I'd treat this as the actual recommendation:**
`scripts/certify-divergence.mjs` is already a tier-3 **perturbation certification** harness. The
engine has an *outward* perturbation instrument in production, with a checkpoint/resume path
(`scripts/persist-checkpoint.mjs`), a strict-min unanimity rule across `--runs`, and hard-won
knowledge about its own failure modes (`--runs 3` strict-min; silent-empty-read bug; whitelists
dropping panel metadata — see the 2026-07-19 within-lab refutation).

**The inward probe should reuse that harness's distance metric and run discipline verbatim.**
Two reasons, one of them load-bearing:

- The control run mandated by the pre-registration only defines a noise floor if control and
  treatment are measured with the *same* instrument. Two different distance metrics make
  `mean(control_delta) + 2·sd` a number about nothing.
- The Atlas work has already established, at cost, that a single run is not a result
  (`project_three_handoff_arbitration`: "single-run, DRI 1.018 flagship" — right goal, blocked
  method). The inward test will reproduce that mistake unless it inherits the multi-run
  strict-min rule from day one. **Pre-register the run count alongside N/M/p.**

**One trap specific to the inward direction.** `run_perturbation` withholds the target by
filtering `store.active()`. If the live probe reaches the model through `api/query.js`, the
model can retrieve the "withheld" primary back through the retrieval pool and the delta
collapses to noise — a **false H0**, the worst possible failure, because it confirms the null
by instrument error and the null is the result we've committed to publishing. The withheld set
must be enforced at the retrieval layer, not just the prompt. `query.js`'s `exclude=` filter
(line 1191ff) is the closest existing lever, but it filters by *layer*, not by id. **A live
probe needs id-level exclusion that does not exist yet.** Build it before the first real run.

---

## 3. Conflicts with the invariants

### 3.1 Append-only — TWO real conflicts, one clean

| Site | Verdict |
|---|---|
| `api/_annotations.js:82` | ✅ **Clean.** `existing.annotations.push(annotation)` — push-only, per-record blobs. This is the model to copy. |
| `api/_grown.js:171-191` `patchGrownCertifications` | ⚠️ **Supersession-by-mutation.** Overwrites `e.divergence.certification`, but carries the prior block into `history[]` (added 2026-07-18 for exactly this reason). Lineage survives; the *record* is still mutated in place. Under the engine's own discipline: accepted and documented. Under Layer 1: a violation. Do not let the resident layer reuse this shape. |
| `api/store.js:262, 312` | ❌ **Genuine conflict.** `proposal.provenance.status = "approved"` / `"rejected"` overwrites in place with **no history array**. A proposal rejected and later approved leaves no trace of the flip — a state change with no ground, which is `PHILOSOPHY.md` §5's definition of **drift**. If the identity-integrity ratio is ever computed over proposal history, this path is invisible to it and silently inflates the numerator. |

Not fixing `store.js` this session — it is outside the ask and the proposal flow is not the
autobiographical store. Recorded so it is not discovered later as a surprise.

### 3.2 Firewall — holds today, by luck as much as design

`api/query.js` builds its retrieval pool from `public/data/corpus.json` (line 34) merged with
`loadGrownMemory()` (line 60). **Neither can contain autobiographical primaries today**, because
primaries live only in `resident/primaries/` on local disk. The firewall currently holds by
non-existence, which is the strongest form.

Three ways it breaks later, in order of likelihood:

1. **`scripts/patch-proposals.js:145`** does `writeFileSync(corpusPath, ...)` — it bakes grown
   entries permanently into the seed. If a primary ever reaches `memory/grown.json`, this script
   promotes it into the *committed, public, CC-BY-SA, HuggingFace-mirrored* seed corpus. That is
   a one-way door. **Primaries must never enter `memory/grown.json`**, and the reason is this
   script, not the blob.
2. **`researcher_visible` is opt-IN to the firewall, not opt-out.**
   `store.py:102` — `active(researcher_facing=False)` returns *everything* by default; the
   caller must remember to pass the flag. Every JS port must **invert this default**: exclude
   unless the caller explicitly asks for the internal view. A firewall you have to remember to
   raise is a firewall that will be down the one time it matters. The schema default
   (`researcher_visible: false`) is correct; the *read API* default is backwards.
3. **The audit trail leaks around the firewall.** `store.py:122` `_log()` writes `meta.ground`
   and `meta.reason` — free text supplied at tombstone/quarantine time, which will in practice
   quote or summarize primary content. `all_events()` has no `researcher_facing` filter at all.
   If an events feed is ever exposed (a natural "show me the governance trail" endpoint), the
   firewall is bypassed through the metadata. **`all_events()` needs the same filter `active()`
   has** before anything reads it over HTTP.

Also note: `layers=` / `exclude=` in `query.js` is a **relevance filter, not a security
boundary**. It shapes the candidate pool for retrieval quality. It must never be the thing
standing between a primary and a researcher.

### 3.3 Attestor-can't-vote — two holes in the shipped code, one in the engine

**In `governance.py`:**

1. **The attestor can be given standing by proxy.** `_validate_ballots` (line 87) checks
   `b.voter == self.attestor` only. Nothing checks `b.on_behalf_of == self.attestor`. So
   `Ballot("cust_a", "delete", "x", on_behalf_of="layer3")` passes validation, and Layer 3 has
   just been represented in the politics it exists to stand outside of. Constructor-time
   protection (line 39) doesn't help — that guards `vote_holders`, not ballots.
2. **The double-vote guard keys on identity, not on party.** Line 91-94 rejects the same
   `voter` string twice. It cannot detect one *party* operating two vote-holder identities —
   which is precisely the attack HANDOFF §Open Decision names ("what stops the proxy-holder from
   voting twice and calling it consensus?"). `Ballot` has no principal/party field, so the check
   is unimplementable as written. This is the code being honestly incomplete pending #9, not a
   bug — but it should be closed *as part of* answering #9, not after.

**Persistence hole, adjacent:** `Store.dump()` (line 125) serializes `primaries` and `events`
but **not `_deleted_ids`**. Reload from a dump and the resurrection guard at line 61 is empty —
a unanimously deleted primary can be re-appended. The single irreversible act becomes reversible
by process restart. Recoverable from the `destroy` events, but no loader exists yet, so whoever
writes `Store.load()` must reconstruct `_deleted_ids` from the event log or the unanimity rule
is decorative.

**In the engine:** `AUTO_ADMIT_CONTRIBUTIONS` (`council.js`, `scoreContributionRisk`) is a Haiku
gate that both **scores** a contribution and **admits** it. An evaluator that acts is an
attestor casting a ballot. It is **OFF by choice** today, and should stay off for anything
touching the resident layer — but note the shape, because it will look like the obvious way to
automate primary admission later. The same question hangs, more mildly, over
`certify-divergence.mjs`: models grading records that models produced.

---

## 4. What was NOT done, per instruction

- No scheduled agent loop. No autobiographical primaries appended by any automated path.
- HOLD #10's candidate term is not coined or carried anywhere in what I wrote. Nothing in this
  session needed it, which is itself the density test returning a verdict.
- HOLD #9 is not resolved in code. `governance.py` has no instantiated `vote_holders` anywhere
  in this repo, and `register_preregistration.py` documents why it declined the convenient call.
- `_destroy` is called from exactly one place: `governance.py:72`, inside the unanimity branch.
  Verified by grep across the repo.
- The live probe is not implemented. `stub_probe_fn` is untouched.

---

## 5. Open items handed back

| # | Item | Owner | Status |
|---|---|---|---|
| A | HOLD #9 — proxy-holder. | xz | ✅ **ANSWERED 2026-07-19 — the empty seat.** |
| B | Close the `on_behalf_of == attestor` hole; add a party field to `Ballot`. | — | ✅ Hole closed; party field **not needed** (dissolved by A). |
| C | `Store.load()` must rebuild `_deleted_ids` from events. | — | ✅ Done. |
| D | `all_events()` needs a firewall filter before any events feed exists. | — | ✅ Done. |
| E | Id-level retrieval exclusion in `query.js` — required for a valid inward probe (§2). | engine + deploy | ⚪ **OPEN.** Still required before the first live run. |
| F | Pre-register the **run count** alongside N/M/p; inherit strict-min from `certify-divergence.mjs`. | xz | ⚪ **OPEN.** Needed before the first run, not before the next build. |
| G | HOLD #12 — post-threshold chosen silence. | xz | ✅ **12a ADOPTED 2026-07-19.** 12b/12c roadmapped, unruled. |
| H | Register the identity-integrity ratio in `claims.json` at `untested`. | engine + deploy | ⚪ **OPEN.** |
| I | `api/store.js` overwrites proposal status with no history (§3.1). | engine | ⚪ **OPEN**, deliberately out of scope. |

**What now gates the agent loop:** with #9 answered, the remaining bar is no longer governance —
it is measurement. E and F must land before the first live perturbation run, and the run itself
(control arm first) is what decides whether there is a resident. Still not a milestone.
