"""
integrity.py — Layer 3 metric: identity-integrity ratio = accounted change / total change.

Accounted change = behavioral changes backed by a supersession record (referencing a prior
commitment id + stating a ground). Total change = accounted + unaccounted (drift).

Ratio near 1.0 => the self changes only with recorded reasons (accountable discontinuity).
Ratio near 0.0 => the self drifts (change with no ground) => not identity, weather.

Layer 3 COMPUTES and STAMPS this. It never votes and never authors the underlying records.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class IntegrityReport:
    accounted: int
    unaccounted: int
    ratio: float
    verdict: str   # "accountable" | "drifting" | "insufficient_data"


def integrity_ratio(accounted_changes: int, unaccounted_changes: int,
                    drift_threshold: float = 0.6) -> IntegrityReport:
    total = accounted_changes + unaccounted_changes
    if total == 0:
        return IntegrityReport(0, 0, 0.0, "insufficient_data")
    ratio = accounted_changes / total
    verdict = "accountable" if ratio >= drift_threshold else "drifting"
    return IntegrityReport(accounted_changes, unaccounted_changes, round(ratio, 4), verdict)


def count_changes(store_events: list[dict], supersession_ids: set[str]) -> tuple[int, int]:
    """Heuristic wiring: a state transition (tombstone/restore) is 'accounted' if a
    supersession referencing it exists; otherwise it counts toward drift.
    Replace with the real behavioral-delta accounting at integration."""
    accounted = 0
    unaccounted = 0
    for e in store_events:
        if e["op"] in ("tombstone", "restore", "release"):
            if e["id"] in supersession_ids:
                accounted += 1
            else:
                unaccounted += 1
    return accounted, unaccounted
