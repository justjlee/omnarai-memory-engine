# CHANGELOG — omnarai-resident-v0

Kept in the spirit of the store it describes: append-only. Revisions supersede with a
stated ground; they do not silently overwrite.

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
