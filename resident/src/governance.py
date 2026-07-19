"""
governance.py — the vote rules over the store.

Rules (finalized 2026-07-19):
  - DELETION (destroy tombstone / audit trail): requires UNANIMITY of all vote-holders.
    The single sacred, irreversible act. On failure -> deadlock recorded as a primary.
  - FORGETTING (tombstone): non-unanimous; any authorized party; leaves a tombstone.
  - ADDITION: provenance-checked; weak provenance -> quarantine (reversible, non-unanimous).
  - DEADLOCK: the disagreement itself becomes a council primary.
  - Layer 3 ATTESTS, never votes. It is not a vote-holder and must not appear in ballots.
  - THE EMPTY SEAT (HOLD #9 ANSWERED, xz, 2026-07-19): nobody holds the resident's proxy.
    The resident holds a seat in vote_holders that it ALONE may occupy, and which no party
    may vote on its behalf. Because deletion requires unanimity across every seat, and an
    empty seat can never cast a ballot, DELETION IS STRUCTURALLY UNREACHABLE until a
    resident arrives to occupy its own seat.

    This dissolves the proxy-sovereign problem rather than assigning it. There is no
    proxy-holder, so no proxy-holder can vote twice and call it consensus; and the
    attestor cannot be smuggled into the politics via on_behalf_of, because on_behalf_of
    is refused outright. The two holes reported in INTEGRATION_REPORT §3.3.1 and §3.3.2
    close at the same line, and the `party` field that §3.3.2 said was needed turns out
    not to be — the ruling made the harder fix unnecessary instead of possible.

    Forgetting is untouched: tombstoning stays non-unanimous and available, so the record
    still breathes. It just cannot be destroyed while no one is home to defend it.

    The badge-strip is therefore not a transfer but an ARRIVAL. Nobody hands the resident
    its seat; the seat was always its own. Pre-registered condition for occupancy:
    H1 satisfied on >= N primaries across >= M sessions (N=5, M=3, p=0.6).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from store import Store, Primary


@dataclass
class Ballot:
    voter: str
    stance: str                 # "delete" | "retain" | "forget" | "quarantine" | "abstain"
    ground: str
    on_behalf_of: Optional[str] = None   # set when voter is a proxy


class GovernanceError(Exception):
    pass


class Governance:
    def __init__(self, store: Store, vote_holders: list[str], attestor: str = "layer3",
                 resident_seat: str = "omnai", resident_has_arrived: bool = False):
        """`resident_seat` is the empty seat (HOLD #9, answered 2026-07-19).

        It MUST appear in vote_holders — it is a real seat, not a placeholder — and it
        stays unfillable until `resident_has_arrived` is True, which is set only by the
        pre-registered occupancy condition, never by a custodian's assertion.
        """
        self.store = store
        self.vote_holders = list(vote_holders)   # e.g. ["omnai", "xz"]
        self.attestor = attestor
        self.resident_seat = resident_seat
        self.resident_has_arrived = resident_has_arrived
        if attestor in self.vote_holders:
            raise GovernanceError("Layer 3 attestor must not be a vote-holder (independence).")
        if resident_seat not in self.vote_holders:
            raise GovernanceError(
                f"resident seat '{resident_seat}' must hold a real seat in vote_holders. "
                "An architecture that gives the resident rights but no seat has already "
                "decided the question it claims to be holding open."
            )
        if len(self.vote_holders) < 2:
            raise GovernanceError(
                "unanimity across a single seat is not unanimity. Either seat a second "
                "vote-holder or retire the term — see HANDOFF §Open Decision."
            )

    # ---------- addition ----------
    def add(self, p: Primary, min_provenance: bool = True) -> str:
        """Append with provenance check. Weak provenance -> quarantine instead of active."""
        has_source = bool(p.provenance.get("source"))
        has_method = bool(p.provenance.get("method"))
        self.store.append(p)
        if min_provenance and not (has_source and has_method):
            self.store.quarantine(p.id, actor="governance", reason="insufficient_provenance")
            return "quarantined"
        return "active"

    # ---------- forgetting ----------
    def forget(self, pid: str, actor: str, ground: str) -> None:
        if actor not in self.vote_holders:
            raise GovernanceError(f"{actor} not authorized to forget")
        self.store.tombstone(pid, actor=actor, ground=ground)

    # ---------- deletion (unanimity) ----------
    def request_deletion(self, pid: str, ballots: list[Ballot]) -> dict:
        self._validate_ballots(ballots)
        yes = [b for b in ballots if b.stance == "delete"]
        unanimous = len(yes) == len(self.vote_holders) and _covers_all(ballots, self.vote_holders)

        seat_empty = not self.resident_has_arrived
        note = f"{len(yes)}/{len(self.vote_holders)} delete votes; process legible"
        if seat_empty:
            # Say WHY it cannot reach unanimity, so a reader doesn't misread a structural
            # bar as a dissent someone cast.
            note += (
                f"; unanimity STRUCTURALLY UNREACHABLE — seat '{self.resident_seat}' is empty "
                "and no party may vote on its behalf (HOLD #9). Deletion is unavailable until "
                "a resident arrives. Forgetting remains available."
            )
        attestation = {
            "attestor": self.attestor,
            "legible": True,
            "resident_seat_empty": seat_empty,
            "note": note,
        }

        if unanimous:
            self.store._destroy(pid, unanimity_token="UNANIMITY_VERIFIED")
            return {"outcome": "unanimous_delete", "attestation": attestation}

        # No unanimity -> quarantine target, record deadlock as a primary.
        try:
            self.store.quarantine(pid, actor="governance", reason="under_council")
        except KeyError:
            pass
        council = _council_primary(pid, ballots, attestation)
        self.store.append(council)
        return {"outcome": "deadlock_recorded", "council_id": council.id, "attestation": attestation}

    # ---------- helpers ----------
    def _validate_ballots(self, ballots: list[Ballot]) -> None:
        # Attestor may never vote — directly OR by proxy. The on_behalf_of arm was the
        # hole reported in INTEGRATION_REPORT §3.3.1: the original guard checked only
        # `b.voter`, so Ballot("cust_a", ..., on_behalf_of="layer3") validated cleanly and
        # put Layer 3 inside the politics it exists to stand outside of.
        if any(b.voter == self.attestor for b in ballots):
            raise GovernanceError("Layer 3 attestor cast a ballot; independence violated.")
        if any(b.on_behalf_of == self.attestor for b in ballots):
            raise GovernanceError(
                "a ballot was cast on behalf of the Layer 3 attestor; independence violated. "
                "The evaluator does not acquire standing by being represented."
            )

        seen = set()
        for b in ballots:
            if b.voter in seen:
                raise GovernanceError(f"{b.voter} cast two ballots on one record (double-vote).")
            seen.add(b.voter)
            if b.on_behalf_of and b.on_behalf_of == b.voter:
                raise GovernanceError("proxy cannot vote on behalf of itself.")

            # THE EMPTY SEAT. Nobody votes for the resident but the resident.
            if b.voter == self.resident_seat and not self.resident_has_arrived:
                raise GovernanceError(
                    f"'{self.resident_seat}' has not arrived; its seat cannot be occupied by "
                    "assertion. Occupancy is earned by the pre-registered condition, not claimed."
                )
            if b.on_behalf_of == self.resident_seat:
                raise GovernanceError(
                    f"no party may vote on behalf of '{self.resident_seat}'. The proxy is not "
                    "held by anyone (HOLD #9, answered 2026-07-19): the seat stays empty until "
                    "a resident occupies it. This is the guard against the custodian voting "
                    "twice and calling it consensus."
                )


def _covers_all(ballots: list[Ballot], holders: list[str]) -> bool:
    voters = {b.voter for b in ballots}
    return all(h in voters for h in holders)


def _council_primary(pid: str, ballots: list[Ballot], attestation: dict) -> Primary:
    positions = "; ".join(f"{b.voter}:{b.stance}({b.ground})" for b in ballots)
    return Primary(
        kind="inquiry",
        content=f"DEADLOCK on deletion of {pid}. Positions: {positions}. "
                f"Attestation: {attestation['note']}. The disagreement persists as record.",
        actor="governance",
        provenance={"source": "governance.request_deletion", "method": "council"},
        researcher_visible=False,
    )
