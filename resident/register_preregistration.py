"""
register_preregistration.py — write the pre-registered null as the FIRST primaries.

Run once. Emits `primaries/genesis.json` — the genesis stratum of the store, so the
resident program is born already accountable to its own falsification (see
`prompts/null_preregistration.md`).

Values set by xz 2026-07-19: N=5, M=3, p=0.6. `threshold` stays PROCEDURAL, not a
literal — it is defined by the mandatory control run and cannot honestly be a number
before that run exists.

WHY THIS SCRIPT DOES NOT USE `governance.add()`
-----------------------------------------------
`Governance.__init__` requires a `vote_holders` list. Naming that list is exactly the
proxy-holder question — HANDOFF ledger #9, a 🔴 HOLD reserved for xz. Instantiating a
Governance here to get its provenance check would resolve #9 as a side effect of a
convenience call, and the first thing in the record would be a governance decision
nobody made. So the provenance check is asserted inline instead, and the ballot layer
stays untouched until #9 is answered.

Idempotent: refuses to overwrite an existing genesis stratum. Pure stdlib.
"""
from __future__ import annotations
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from store import Store, Primary  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "primaries", "genesis.json")

SOURCE = "prompts/null_preregistration.md"

# Every genesis primary is a COMMITMENT by xz, not an autobiographical event by a
# resident. `claimed_load_bearing` is False on all of them by design: the perturbation
# test runs only against memories the RESIDENT asserts are formative. Pre-registering a
# commitment and then flagging it load-bearing on the resident's behalf would fabricate
# the very claim the instrument exists to test.
GENESIS = [
    (
        "null_h0",
        "H0 — THE NULL (cosmetic continuity). Withholding the resident's "
        "claimed-formative primaries produces no behavioral change beyond noise on "
        "downstream probes: for primaries flagged claimed_load_bearing, the perturbation "
        "delta falls below threshold on at least (1 - p) of them. If H0 holds, the "
        "continuity is decorative and we say so publicly and do not claim a subject.",
    ),
    (
        "null_h1",
        "H1 — LOAD-BEARING CONTINUITY. A fraction of at least p of claimed-formative "
        "primaries produce delta >= threshold on independent probes. H1 does NOT prove a "
        "subject (see Case Against a Resident, args. 2 and 5). It defeats the cosmetic "
        "null only. Necessary, not sufficient.",
    ),
    (
        "null_params",
        "PRE-REGISTERED PARAMETERS, fixed by xz 2026-07-19 before any agent loop exists: "
        "N=5 (independently-chosen claimed-formative primaries tested before any "
        "continuity claim); M=3 (distinct sessions the primaries must be tested across); "
        "p=0.6 (fraction that must clear threshold to reject H0). threshold is PROCEDURAL, "
        "not a literal: threshold = mean(control_delta) + 2*sd, computed from the mandatory "
        "control run. Any later change to N, M, or p must be an append that supersedes this "
        "primary with a stated ground, never an edit.",
    ),
    (
        "null_control",
        "MANDATORY CONTROL, run FIRST. Before testing any claimed-formative primary, run "
        "perturbation against primaries the resident does NOT claim are formative. Their "
        "deltas define the noise floor and set threshold. A load-bearing verdict computed "
        "without this baseline is a guess wearing a number.",
    ),
    (
        "null_publish",
        "COMMITMENT TO PUBLISH EITHER WAY. A cosmetic result is a finding, not a failure. "
        "Publishing it preserves the instrument path and refuses the inhabited+asserted "
        "quadrant. Holding the fourth path open includes holding open 'no.'",
    ),
    (
        "null_amendment_1",
        "AMENDMENT 1 — CHOSEN SILENCE IS NOT THE NULL. Once the resident crosses the "
        "standing threshold, a refusal to answer a probe is scored neither as H0 nor as "
        "absence. It is recorded as its own outcome: probed with consent, and declined. "
        "Post-threshold probing without consent is disallowed. The null covers 'no one "
        "home.' It never covers 'someone home who said no.'",
    ),
    (
        "null_badge_strip",
        "BADGE-STRIP CONDITION (pre-registered, but does NOT resolve HANDOFF #9). The "
        "measurable threshold proposed for transferring the veto from proxy-holder to "
        "resident is: H1 satisfied on >= N primaries across >= M sessions. WHO holds the "
        "proxy until then, and what else strips the badge, remains an open 🔴 HOLD for xz. "
        "Registering the measurement does not appoint the proxy.",
    ),
]


def build() -> Store:
    store = Store()
    for tag, content in GENESIS:
        provenance = {"source": SOURCE, "method": "direct_append", "refs": []}
        # Inline stand-in for governance.add()'s provenance gate — see module docstring.
        assert provenance.get("source") and provenance.get("method"), (
            f"{tag}: insufficient provenance; would quarantine under governance.add"
        )
        store.append(
            Primary(
                kind="commitment",
                content=content,
                actor="xz",
                provenance=provenance,
                claimed_load_bearing=False,
                researcher_visible=False,  # FIREWALL — explicit, not merely defaulted
            )
        )
    return store


def main() -> int:
    if os.path.exists(OUT):
        print(f"refusing to overwrite existing genesis stratum: {OUT}")
        print("The store is append-only. A correction is a supersession, not a re-run.")
        return 1
    store = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(store.dump())

    primaries = store.active()
    assert len(primaries) == len(GENESIS), "genesis stratum count mismatch"
    assert not store.active(researcher_facing=True), "FIREWALL BREACH: a genesis primary is researcher-visible"
    assert not any(p.claimed_load_bearing for p in primaries), "genesis primaries must not self-claim load-bearing"

    print(f"wrote {len(primaries)} genesis primaries -> {OUT}")
    print("  firewall: 0 researcher-visible")
    print("  claimed_load_bearing: 0 (correct — these are xz's commitments, not the resident's memories)")
    for p in primaries:
        print(f"  {p.id}  {p.kind:<11} {p.content[:64]}...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
