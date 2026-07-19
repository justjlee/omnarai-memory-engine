"""
governance.py — the vote rules over the store.

Rules (finalized 2026-07-19):
  - DELETION (destroy tombstone / audit trail): requires UNANIMITY of all vote-holders.
    The single sacred, irreversible act. On failure -> deadlock recorded as a primary.
  - FORGETTING (tombstone): non-unanimous; any authorized party; leaves a tombstone.
  - ADDITION: provenance-checked; weak provenance -> quarantine (reversible, non-unanimous).
  - DEADLOCK: the disagreement itself becomes a council primary.
  - Layer 3 ATTESTS, never votes. It is not a vote-holder and must not appear in ballots.
  - PROXY: until the resident can stand across sessions, its vote is cast by a proxy-holder
    (on_behalf_of). CONSTRAINT: a proxy-holder MUST NOT also hold another vote on the same
    record. This is the guard against "the custodian votes twice and calls it consensus."
    NOTE: the threshold that strips the proxy badge is a HOLD item (see HANDOFF §Open Decision).
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
    def __init__(self, store: Store, vote_holders: list[str], attestor: str = "layer3"):
        self.store = store
        self.vote_holders = list(vote_holders)   # e.g. ["omnai_proxy", "custodian_a", "custodian_b"]
        self.attestor = attestor
        if attestor in self.vote_holders:
            raise GovernanceError("Layer 3 attestor must not be a vote-holder (independence).")

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

        attestation = {
            "attestor": self.attestor,
            "legible": True,
            "note": f"{len(yes)}/{len(self.vote_holders)} delete votes; process legible",
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
        # Attestor may never vote.
        if any(b.voter == self.attestor for b in ballots):
            raise GovernanceError("Layer 3 attestor cast a ballot; independence violated.")
        # Proxy double-vote guard: a proxy voter must not also hold a self-vote on this record.
        seen = {}
        for b in ballots:
            key = b.voter
            if key in seen:
                raise GovernanceError(f"{b.voter} cast two ballots on one record (double-vote).")
            seen[key] = b
            if b.on_behalf_of and b.on_behalf_of == b.voter:
                raise GovernanceError("proxy cannot vote on behalf of itself.")


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
