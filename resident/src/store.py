"""
store.py — Append-only autobiographical store (Layer 1 discipline).

Invariants:
  - Primaries are NEVER mutated. Content and id are immutable once appended.
  - Forgetting = tombstone (de-index, leave marker). Non-unanimous. Reversible in effect
    (the record persists on the audit trail; only its 'active' indexing changes).
  - Deletion = destroying the tombstone / audit trail. The single irreversible act.
    This module REFUSES to delete on its own — deletion goes through governance.py
    and requires unanimity. See governance.request_deletion / commit_deletion.
  - Addition requires provenance; weak provenance -> quarantine (governance.py).

The store is a log. Views (self-model) are computed over it, never stored as truth.
"""
from __future__ import annotations
import hashlib
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mint_id(prefix: str, payload: str) -> str:
    h = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{h}"


@dataclass
class Primary:
    kind: str
    content: str
    actor: str
    provenance: dict
    on_behalf_of: Optional[str] = None
    claimed_load_bearing: bool = False
    researcher_visible: bool = False  # FIREWALL default: off
    state: str = "active"             # active | tombstoned | quarantined
    ts: str = field(default_factory=_now)
    id: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = _mint_id("prim", f"{self.kind}|{self.content}|{self.ts}|{self.actor}")


class Store:
    """Append-only log. The only mutation permitted post-append is a STATE transition
    (active <-> tombstoned/quarantined), which itself is recorded as an event."""

    def __init__(self):
        self._primaries: dict[str, Primary] = {}
        self._events: list[dict] = []   # state-transition audit trail
        self._deleted_ids: set[str] = set()  # ids whose tombstones were unanimously destroyed

    # ---- append ----
    def append(self, p: Primary) -> Primary:
        if p.id in self._primaries or p.id in self._deleted_ids:
            raise ValueError(f"id collision or resurrection attempt: {p.id}")
        self._primaries[p.id] = p
        self._log("append", p.id, p.actor, {"kind": p.kind})
        return p

    # ---- forgetting (non-unanimous, leaves tombstone) ----
    def tombstone(self, pid: str, actor: str, ground: str) -> None:
        p = self._require(pid)
        p.state = "tombstoned"
        self._log("tombstone", pid, actor, {"ground": ground})

    def restore(self, pid: str, actor: str, ground: str) -> None:
        """Forgetting is reversible in effect: a tombstoned primary can be re-foregrounded."""
        p = self._require(pid)
        if p.state == "tombstoned":
            p.state = "active"
            self._log("restore", pid, actor, {"ground": ground})

    # ---- quarantine (reversible hold) ----
    def quarantine(self, pid: str, actor: str, reason: str) -> None:
        p = self._require(pid)
        p.state = "quarantined"
        self._log("quarantine", pid, actor, {"reason": reason})

    def release(self, pid: str, actor: str, to_state: str = "active") -> None:
        p = self._require(pid)
        assert to_state in ("active", "tombstoned")
        p.state = to_state
        self._log("release", pid, actor, {"to": to_state})

    # ---- deletion is NOT exposed here. governance.py calls _destroy under unanimity. ----
    def _destroy(self, pid: str, unanimity_token: str) -> None:
        if unanimity_token != "UNANIMITY_VERIFIED":
            raise PermissionError("deletion requires a verified unanimity token from governance")
        self._require(pid)
        del self._primaries[pid]
        self._deleted_ids.add(pid)
        self._log("destroy", pid, "governance", {"note": "audit trail removed by unanimity"})

    # ---- retrieval ----
    def active(self, researcher_facing: bool = False) -> list[Primary]:
        out = [p for p in self._primaries.values() if p.state == "active"]
        if researcher_facing:
            out = [p for p in out if p.researcher_visible]  # FIREWALL enforced at read
        return out

    def get(self, pid: str) -> Primary:
        return self._require(pid)

    def all_events(self) -> list[dict]:
        return list(self._events)

    # ---- internals ----
    def _require(self, pid: str) -> Primary:
        if pid in self._deleted_ids:
            raise KeyError(f"{pid} was unanimously deleted; audit trail gone")
        if pid not in self._primaries:
            raise KeyError(f"no such primary: {pid}")
        return self._primaries[pid]

    def _log(self, op: str, pid: str, actor: str, meta: dict) -> None:
        self._events.append({"op": op, "id": pid, "actor": actor, "ts": _now(), "meta": meta})

    def dump(self) -> str:
        return json.dumps(
            {"primaries": [asdict(p) for p in self._primaries.values()], "events": self._events},
            indent=2,
        )
