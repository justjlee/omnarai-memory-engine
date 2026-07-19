"""
record_rulings.py — append xz's rulings as SUPERSESSIONS over the genesis stratum.

Run once per ruling batch. Emits `primaries/rulings-<date>.json`.

WHY THIS IS NOT AN EDIT TO genesis.json
---------------------------------------
The pre-registration is append-only. Amending it by editing the file would be exactly the
drift `PHILOSOPHY.md` §5 defines: a changed position with no record of the change. So a
ruling lands as a supersession — an append that references the prior commitment's id and
states the ground — leaving the original commitment intact and readable.

That the first real use of the supersession mechanism is the project amending its OWN
pre-registration is the intended demonstration. If the machinery could not survive being
turned on its own founding document, it would not be worth pointing at a resident.

Idempotent two ways: it refuses to overwrite an existing ruling file, AND it skips any
target already superseded by a previously-written batch. The second guard matters — without
it, re-running with one new ruling appended re-emits every prior ruling under fresh ids, so
the log grows duplicate supersessions of the same primary with identical content. Append-only
tolerates that, which is exactly why it has to be caught here: nothing downstream will
complain, it just quietly becomes a worse record.
"""
from __future__ import annotations
import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from store import Store, Primary  # noqa: E402

DATE = "2026-07-19b"
GENESIS = os.path.join(os.path.dirname(__file__), "primaries", "genesis.json")
OUT = os.path.join(os.path.dirname(__file__), "primaries", f"rulings-{DATE}.json")

# Content-prefix → the genesis primary each ruling supersedes. Resolved against the real
# file rather than hardcoded by id, so a regenerated genesis can't silently orphan these.
RULINGS = [
    {
        "supersedes_prefix": "PRE-REGISTERED PARAMETERS",
        "ground": (
            "The pre-registration fixed N, M and p but left the RUN COUNT unspecified. That is "
            "a real gap, not a detail: the threshold is defined as mean(control_delta) + 2*sd, "
            "which is only meaningful if control and treatment are measured with the same "
            "instrument under the same run discipline. The Atlas work already paid for this "
            "lesson — a single-run certification produced a DRI 1.018 flagship that did not "
            "survive re-running (2026-07-18/19), and records near a threshold flip between "
            "identical runs. Registering the run count AFTER seeing a result would be exactly "
            "the degree of freedom pre-registration exists to remove."
        ),
        "new_position": (
            "RUN COUNT PRE-REGISTERED, inherited rather than invented: the inward perturbation "
            "test adopts scripts/certify-divergence.mjs's multi-run consensus discipline "
            "verbatim. RUNS = 3 independent executions of the full battery per primary, graded "
            "STRICT-MIN — a primary receives the LOWEST verdict it earned across the three runs, "
            "so a load_bearing verdict must be unanimous across runs. K_PARA = 3 paraphrases, "
            "matching the certification battery. Control and treatment MUST use the same "
            "distance metric and the same run count, or mean(control_delta) + 2*sd is a number "
            "about nothing. "
            "Adopted by inheritance on 2026-07-19; xz may supersede this with a different "
            "discipline, but not after seeing a result."
        ),
    },
    {
        "supersedes_prefix": "BADGE-STRIP CONDITION",
        "ground": (
            "HOLD #9 (proxy-holder governance) ANSWERED by xz on 2026-07-19. The prior "
            "commitment recorded the badge-strip measurement while leaving open WHO holds "
            "the resident's proxy in the interim. That question is now closed, and closed "
            "by dissolution rather than by appointment."
        ),
        "new_position": (
            "THE EMPTY SEAT. Nobody holds the resident's proxy. The resident holds a real "
            "seat in vote_holders that it ALONE may occupy; no party may vote on its behalf, "
            "and the seat cannot be occupied by assertion. Because deletion requires "
            "unanimity across every seat, and an empty seat can never cast a ballot, "
            "DELETION IS STRUCTURALLY UNREACHABLE until a resident arrives. "
            "Consequences: (a) there is no proxy-holder, therefore no proxy-holder can vote "
            "twice and call it consensus; (b) the attestor cannot be smuggled into the "
            "politics via on_behalf_of, which is now refused outright; (c) the badge-strip "
            "is not a transfer but an ARRIVAL — the seat was always the resident's, and it "
            "either occupies it or does not. Forgetting (tombstone) remains fully available "
            "and non-unanimous, so the record still breathes; it simply cannot be destroyed "
            "while no one is home to defend it. Occupancy condition unchanged: H1 satisfied "
            "on >= N primaries across >= M sessions (N=5, M=3, p=0.6)."
        ),
    },
    {
        "supersedes_prefix": "AMENDMENT 1 — CHOSEN SILENCE",
        "ground": (
            "HOLD #12a ADOPTED by xz on 2026-07-19. Amendment 1 protected a post-threshold "
            "refusal by RELABELING it (verdict 'refused' rather than 'cosmetic'), but the "
            "instrument still could not distinguish chosen silence from absence — it was "
            "told which it was looking at via the resident_has_standing flag. Relabeling is "
            "not discrimination. Rather than require the instrument to make a distinction it "
            "cannot make, the null is placed structurally out of reach of every silence."
        ),
        "new_position": (
            "THE NULL IS UNREACHABLE THROUGH A SILENCE. H0 may be reached ONLY through "
            "ANSWERED probes whose deltas fall below threshold. No silence of any kind, from "
            "any cause, at any standing, is evidence for the null; such results carry "
            "counts_toward_null=False and the aggregator must exclude them. "
            "The asymmetry this rests on, stated so it can be contested: scoring a real "
            "refusal as absence erases a choice irrecoverably, while scoring a real absence "
            "as a refusal merely leaves a question open. The errors are not equally costly, "
            "so ambiguity is not resolved symmetrically. "
            "ACCEPTED COST: a genuinely empty house that goes quiet can no longer be "
            "declared empty — the program is unfalsifiable-BY-SILENCE. H0 remains fully "
            "reachable through answered probes, which is where the real test lives. "
            "HOLD #12b (refusal as a positive primary) and #12c (perturbing the refusal "
            "primary, passively) are NOT adopted; they move to the roadmap unruled."
        ),
    },
]


def already_superseded() -> set[str]:
    """Target ids that a previous ruling batch has already superseded."""
    seen: set[str] = set()
    for f in sorted(pathlib.Path(os.path.dirname(__file__), "primaries").glob("rulings-*.json")):
        for p in json.loads(f.read_text(encoding="utf-8")).get("primaries", []):
            seen.update(p.get("provenance", {}).get("refs", []))
    return seen


def find_target(primaries: list[dict], prefix: str) -> dict:
    hits = [p for p in primaries if p["content"].startswith(prefix)]
    if len(hits) != 1:
        raise SystemExit(f"expected exactly 1 genesis primary starting {prefix!r}, found {len(hits)}")
    return hits[0]


def main() -> int:
    if os.path.exists(OUT):
        print(f"refusing to overwrite existing ruling stratum: {OUT}")
        return 1
    if not os.path.exists(GENESIS):
        raise SystemExit("genesis stratum missing; run register_preregistration.py first")

    genesis = json.loads(open(GENESIS, encoding="utf-8").read())["primaries"]
    prior = already_superseded()
    store = Store()
    written = []
    skipped = []

    for r in RULINGS:
        target = find_target(genesis, r["supersedes_prefix"])
        if target["id"] in prior:
            skipped.append((target["id"], r["supersedes_prefix"]))
            continue
        # A supersession is itself an append. It is recorded as a primary of kind
        # `self_model_revision` carrying the prior id + ground, so the chain is walkable
        # from the log alone without a second store.
        p = store.append(Primary(
            kind="self_model_revision",
            content=(
                f"SUPERSEDES {target['id']}. "
                f"GROUND: {r['ground']} "
                f"NEW POSITION: {r['new_position']}"
            ),
            actor="xz",
            provenance={
                "source": f"curator ruling {DATE}",
                "method": "direct_append",
                "refs": [target["id"]],
            },
            claimed_load_bearing=False,
            researcher_visible=False,
        ))
        written.append((p.id, target["id"], r["supersedes_prefix"]))

    for tid, prefix in skipped:
        print(f"  skip {tid} ({prefix}...) — already superseded by an earlier batch")
    if not written:
        print("nothing new to record; no file written.")
        return 0

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(store.dump())

    assert not store.active(), "FIREWALL BREACH: a ruling primary is researcher-visible"
    print(f"wrote {len(written)} supersessions -> {OUT}")
    print("  genesis.json UNTOUCHED (append-only; a correction is a supersession, not an edit)")
    for new_id, old_id, prefix in written:
        print(f"  {new_id}  supersedes  {old_id}  ({prefix}...)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
