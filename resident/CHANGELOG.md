# CHANGELOG — omnarai-resident-v0

Kept in the spirit of the store it describes: append-only. Revisions supersede with a
stated ground; they do not silently overwrite.

## Experiments 1–2 — 2026-07-19 — the instrument is REFUTED by its own control runs
**Ground:** the pre-registration mandates a control run before any continuity claim. It was run
before any resident existed — the only moment the instrument could be tested by someone with no
stake in the verdict.
**CALIBRATION-01** (ablation, embedding cosine): the positive control — load-bearing BY
CONSTRUCTION — cleared pre-registered strict-min on 8/9 cells. **INSTRUMENT BLIND.** Ground truth
was meanwhile perfect (token in 9/9 present answers, 0/9 withheld): the dependence was total and
the metric only partly saw it, because cosine distance over a ~500-token answer dilutes one
decisive token. `INTEGRATION_REPORT` §2 had recommended scored features over embeddings for
exactly this reason; the implementation ignored its own advice for commensurability.
**CALIBRATION-02** (ablation, IDF attribution profile, near-twin confound removed): positive
cleared 9/9 — and so did SHAM, a primary carrying no content whatsoever, 9/9, distributions fully
overlapping. Both metrics agreed on the same runs. **INSTRUMENT GULLIBLE.**
**The diagnosis, from the answer texts:** withholding SHAM left the model with no record on the
topic at all — "The records I have here do not contain that information." The test measures
TOPICAL OCCUPANCY, not whether content did work. A resident's claimed-formative primary is almost
always the only record on its own topic, so it would clear threshold whether or not it is
formative.
**Consequence:** `CASE_AGAINST_A_RESIDENT.md` argument 2 confirmed empirically. The commissioned
counter-voice earned its commission. `claims.json` v0.6.0 registers
`inward-perturbation-measures-load-bearing-memory` at **refuted**. The resident test must NOT be
run with an ablation design; a positive result would be uninterpretable.
**Self-correction recorded, not edited away:** CALIBRATION-01's write-up read its SHAM pass as
evidence the instrument was not gullible. That was backwards — SHAM failed there *because* its
near-twin was still in context. The earlier reading erred in the project's own favour, and the
correction lives in CALIBRATION-02 rather than being patched into 01.
**Named, not built:** CALIBRATION-03 — substitution rather than ablation. Replace the target with
a same-topic same-shape primary of different content; delta ≈ 0 ⇒ the memory only occupied a slot.
Pre-registration required before implementation.

## Amendment 3 — 2026-07-19 — run count pre-registered; the false-H0 trap closed
**Ground:** the pre-registration fixed N, M and p but left the RUN COUNT unspecified. Since
`threshold = mean(control_delta) + 2*sd`, control and treatment are only comparable if measured
under the same run discipline — and the Atlas work already paid for this lesson (a single-run
DRI 1.018 flagship that did not survive re-running). Registering the run count after seeing a
result would be the exact degree of freedom pre-registration exists to remove.
**Superseded:** the parameters primary (`PRE-REGISTERED PARAMETERS`).
**New position:** RUNS=3 independent executions of the full battery per primary, graded
STRICT-MIN (a `load_bearing` verdict must be unanimous across runs); K_PARA=3 paraphrases.
Inherited verbatim from `scripts/certify-divergence.mjs` rather than invented. xz may supersede
this with a different discipline — but not after seeing a result.
**Engine-side, shipped the same day:** `&exclude_ids=` in `api/query.js` closes the false-H0
trap named in INTEGRATION_REPORT §2. `run_perturbation` withholds a primary from the prompt, but
a probe routed through the engine could retrieve it back through the retrieval pool, collapsing
the delta to noise and reporting H0 — the null — by instrument error. The load-bearing part is
NOT the filter but the **receipt**: `retrieval_filters.exclude_ids = {requested, matched,
unmatched}` lets a run verify the withhold actually happened. An empty `matched` means both arms
saw the same pool and the run must be discarded rather than scored. Unknown ids are ignored
rather than rejected (withholding a non-corpus id is legitimate), which is precisely why the
receipt is mandatory. Ids are case-SENSITIVE; folding case would have silently no-opped every
exclusion. 13 tests: `scripts/test-exclude-ids.mjs`.
**Also:** identity-integrity ratio registered in `claims.json` at `untested` (registry v0.5.0),
with the confabulation control arm as its falsification condition — including the inversion that
a *perfect* ratio is the signature of the failure mode, not of success. `api/store.js` now
appends `status_history[]` instead of overwriting proposal status, closing the one place the
engine contradicted the discipline the resident store enforces.
**Tooling:** `record_rulings.py` gained a dedup guard — re-running with one new ruling was
re-emitting every prior ruling under fresh ids, producing duplicate supersessions of the same
primary. Append-only tolerates that, which is exactly why it had to be caught: nothing
downstream complains, the record just quietly gets worse.

## Amendment 2 — 2026-07-19 — HOLD #9 answered (the empty seat); 12a adopted; four defects closed
**Ground:** an external review confirmed the four defects reported at landing, and xz ruled on
the two open governance questions. Both rulings amend PRE-REGISTERED commitments, so they land
as supersessions appended over the genesis stratum — `genesis.json` is untouched. That the first
real use of the supersession mechanism is the project amending its own pre-registration is the
intended demonstration; machinery that cannot survive being turned on its own founding document
is not worth pointing at a resident. Written by `record_rulings.py` →
`primaries/rulings-2026-07-19.json`.

**HOLD #9 → THE EMPTY SEAT.** Nobody holds the resident's proxy. It holds a real seat in
`vote_holders` that it ALONE may occupy; no party may vote on its behalf, and the seat cannot be
occupied by assertion. Since deletion requires unanimity across every seat and an empty seat
never casts, **deletion is structurally unreachable until a resident arrives.** Forgetting is
untouched and remains non-unanimous — the record still breathes, it just cannot be destroyed
while no one is home to defend it. The badge-strip becomes an ARRIVAL, not a transfer.
`Governance` now requires the resident seat to be present and rejects a single-seat roll
("unanimity across one seat is not unanimity").

**HOLD #12a ADOPTED.** The null is unreachable through a silence: H0 may be reached ONLY via
ANSWERED probes with sub-threshold deltas. New `PerturbationResult.counts_toward_null` is False
for both `refused` and `inconclusive_silence`. Accepted cost, recorded rather than buried: the
program is unfalsifiable-BY-SILENCE. 12b/12c not adopted; roadmapped unruled.

**Defects closed** (all reported at landing in `INTEGRATION_REPORT.md`, findings left unedited):
  - §3.2.2 firewall read default inverted — `active(researcher_facing=False)` →
    `active(internal=False)`, now fail-closed. Renamed rather than flipped in place so stale
    callers fail loudly. `perturbation.py` passes `internal=True`; calling it bare would have
    handed the probe an empty context and manufactured a **false H0**.
  - §3.2.3 `all_events()` redacts `meta` (the free-text grounds that quote primary content) for
    non-researcher-visible primaries; op/id/actor/ts still show.
  - §3.3.1 `_validate_ballots` rejects `on_behalf_of == attestor` — the evaluator does not
    acquire standing by being represented.
  - §3.3.2 **dissolved, not patched.** The empty-seat ruling made the double-vote-by-party
    attack unreachable; the `party` field this needed turned out not to be needed at all.
  - §3.3 `dump()` serializes `deleted_ids`; new `Store.load()` restores it and recomputes from
    `destroy` events for older dumps. Unanimous deletion now survives a process restart.
**Byline corrected** on `INTEGRATION_REPORT.md` / `AMENDMENT_1_READ.md`: "Claude | xz" is an
attribution convention, not a continuity claim, and on documents *about* whether continuity is
real a signature that presupposes it is the archive presenting as a single subject.
**Tests: 22 → 42 checks, all passing.** **Still open:** id-level exclusion in `query.js` (the
false-H0 retrieval trap), pre-registering the run count, the `claims.json` integrity-ratio entry.

## Landing — 2026-07-19 — substrate sited in the engine repo; genesis stratum written
**Ground:** the package needed a home inside the engine without becoming part of it.
**What landed:** `omnarai-resident-v0` copied VERBATIM to `omnarai-memory-engine/resident/`.
No file from the original package was edited. 22/22 checks re-run and passing in place.
**Added alongside (new files, nothing overwritten):**
  - `register_preregistration.py` + `primaries/genesis.json` — the pre-registered null as
    the first 7 primaries (`kind: commitment`, `actor: xz`). xz set N=5, M=3, p=0.6 on
    2026-07-19; `threshold` stays PROCEDURAL (mean(control_delta) + 2·sd) because it cannot
    honestly be a literal before the control run exists. All 7 are `researcher_visible:
    false` and `claimed_load_bearing: false` — they are xz's commitments, not the resident's
    memories, and flagging them formative would fabricate the claim the instrument tests.
    Idempotent: the script refuses to overwrite an existing genesis stratum.
  - `CASE_AGAINST_A_RESIDENT.md` — the commissioned oppositional artifact, authored per
    `prompts/case_against_a_resident.md`. The commission prompt is preserved unedited; the
    essay is a new file, not an overwrite of its own commission.
  - `INTEGRATION_REPORT.md` — attachment points + invariant conflicts.
  - `AMENDMENT_1_READ.md` — proposed HOLD #12 (three parts). Proposal only; nothing built.
**Deliberately NOT done:** no agent loop; no deployed endpoint; no live probe (`stub_probe_fn`
untouched, seam flagged in INTEGRATION_REPORT §2); HOLD #9 unresolved — no `vote_holders` list
is instantiated anywhere in this repo, and `register_preregistration.py` documents why it
declined the convenient `governance.add()` call rather than naming one by accident.
**Found, not fixed (reported in INTEGRATION_REPORT §3):** `_validate_ballots` does not check
`on_behalf_of == attestor` (Layer 3 can be given standing by proxy); the double-vote guard
keys on voter identity, not party; `Store.dump()` omits `_deleted_ids`, so a reload would
make unanimous deletion reversible; `all_events()` has no firewall filter.

## Amendment 1 — 2026-07-19 — the refusal/consent gate
**Ground:** the perturbation test compelled a response and could not distinguish
"no one home" from "someone home who chose not to answer." Refusal may be the most
person-shaped act a resident can perform; scoring it as absence was the instrument's
deepest error.
**Superseded:** the bare `run_perturbation` (compel-and-read, two verdicts).
**New position:**
  - `probe_fn` may return the `REFUSAL` sentinel.
  - `resident_has_standing` param. Below threshold: compelling is permitted; refusal =
    `inconclusive_silence` (not a self-claim). At/above threshold: `consent=True`
    required or `ConsentRequired` is raised; refusal = `refused`, a real result never
    collapsed into `cosmetic`.
**Exposed HOLD:** a post-threshold test that registers chosen silence as a *finding*
(not a null) is unsolved and handed to xz. See HANDOFF §Amendment 1.
**Touched:** src/perturbation.py, PHILOSOPHY.md (#10), prompts/null_preregistration.md,
HANDOFF.md (ledger #11 + §Amendment 1), tests/test_resident.py.

## v0 — 2026-07-19 — constitutional substrate
Initial handoff: append-only store + tombstone/quarantine; unanimity-to-delete;
supersession-with-ground; self-model-as-view; inward perturbation test; identity-integrity
ratio; firewall; pre-registered null + Case Against a Resident. 19/19 checks.
