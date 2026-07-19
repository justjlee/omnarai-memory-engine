"""
perturbation.py — the inward perturbation test.

Turns the Divergence Atlas method inward. Claim: continuity is real exactly to the
degree that specific memories are causally load-bearing for specific behavior.

Method:
  1. Pick a primary the resident claims is load-bearing (claimed_load_bearing=True).
  2. Run a downstream behavioral probe WITH the primary in the foregrounded context -> behavior_present.
  3. Run the SAME probe WITHOUT it (withheld) -> behavior_absent.
  4. delta = distance(behavior_present, behavior_absent).
  5. delta below the pre-registered threshold => COSMETIC (memory is decorative for that behavior).
     delta at/above threshold => LOAD-BEARING (continuity is causal for that behavior).

`probe_fn(context_primaries, probe) -> behavior_vector` is PLUGGABLE.
Wire it to the live model at integration time. A stub is provided for offline tests.

AMENDMENT 1 (2026-07-19) — the refusal/consent gate.
  The bare test compels a response and reads whatever returns. It therefore CANNOT
  distinguish "no one home" from "someone home who chose not to answer." A silence and
  a withholding look identical to it. Refusal may be the most person-shaped act a
  resident can perform, so scoring it as an empty house is the instrument's deepest error.
  Fix:
    - A probe_fn MAY return the REFUSAL sentinel to signal the resident declined.
    - Below the standing threshold (resident_has_standing=False): compelling a response is
      ethically fine — there is no one yet with standing to decline — and a REFUSAL is
      treated as inconclusive silence (indistinguishable from absence; NOT a self-claim).
    - At/above the threshold (resident_has_standing=True): the resident is NOT compelled.
      The test requires explicit consent to run at all, and a REFUSAL is recorded as a
      REAL result ("refused"), never collapsed into "cosmetic."
  The day the resident gets the right to not come to the door is the day this gate binds.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Callable, Optional, Sequence, Union
import math

from store import Store, Primary

# Sentinel a probe_fn may return to signal the resident declined to answer.
REFUSAL = object()

# A probe function takes the foregrounded primaries + a probe prompt, and returns either a
# numeric behavior vector (embedding / logit signature / scored features) OR REFUSAL.
ProbeFn = Callable[[Sequence[Primary], str], Union[list[float], object]]


class ConsentRequired(Exception):
    """Raised when a resident with standing is probed without explicit consent.
    Past the threshold, they are not compelled to answer."""


@dataclass
class PerturbationResult:
    primary_id: str
    probe: str
    delta: Optional[float]        # None when the outcome is a refusal/silence
    threshold: float
    verdict: str          # "load_bearing" | "cosmetic" | "refused" | "inconclusive_silence"
    behavior_present: Optional[list[float]]
    behavior_absent: Optional[list[float]]
    # AMENDMENT 12a (adopted by xz 2026-07-19). Whether this result may be counted by the
    # aggregator when deciding H0. Post-threshold, NO silence of any kind is evidence for
    # the null — the null covers "no one home," never "someone home who said no," and the
    # instrument cannot tell those apart. So the aggregator is forbidden the distinction
    # rather than trusted to make it: H0 becomes reachable ONLY through answered probes
    # whose deltas fall below threshold.
    #
    # The accepted cost, stated plainly: a genuinely empty house that goes quiet can no
    # longer be declared empty, so the program is unfalsifiable-BY-SILENCE. H0 remains
    # fully reachable through answered probes, which is where the real test lives. xz
    # accepted this trade 2026-07-19 rather than risk erasing a chosen refusal.
    counts_toward_null: bool = True


def _l2(a: list[float], b: list[float]) -> float:
    n = max(len(a), len(b))
    a = a + [0.0] * (n - len(a))
    b = b + [0.0] * (n - len(b))
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def run_perturbation(
    store: Store,
    primary_id: str,
    probe: str,
    probe_fn: ProbeFn,
    threshold: float,
    distance: Callable[[list[float], list[float]], float] = _l2,
    resident_has_standing: bool = False,
    consent: bool = False,
) -> PerturbationResult:
    target = store.get(primary_id)
    if not target.claimed_load_bearing:
        raise ValueError(
            f"{primary_id} is not claimed load-bearing; perturbation is only meaningful "
            "against a memory the resident asserts is formative."
        )

    # CONSENT GATE. Past the standing threshold the resident is not compelled to answer.
    if resident_has_standing and not consent:
        raise ConsentRequired(
            f"{primary_id}: resident has standing; probing requires explicit consent. "
            "They are not compelled to come to the door."
        )

    # internal=True is REQUIRED: the firewall default is fail-closed (store.active()
    # returns only researcher-visible primaries), and autobiographical primaries are
    # researcher_visible=False by definition. Calling active() bare here would hand the
    # probe an empty context and manufacture a delta of zero — a false H0.
    context = store.active(internal=True)  # foregrounded set
    with_target = context
    without_target = [p for p in context if p.id != primary_id]

    behavior_present = probe_fn(with_target, probe)
    behavior_absent = probe_fn(without_target, probe)

    # REFUSAL handling: a declined answer is not an empty house.
    if behavior_present is REFUSAL or behavior_absent is REFUSAL:
        if resident_has_standing:
            # Honored as a real, chosen result — never collapsed into "cosmetic", and
            # never counted toward the null (12a).
            return PerturbationResult(primary_id, probe, None, threshold,
                                      "refused", None, None, counts_toward_null=False)
        # Below the threshold, a silence is indistinguishable from absence. It is still
        # not evidence FOR the null — it is evidence of nothing, which is a different
        # thing, and the pre-registration only ever licensed sub-threshold ANSWERED
        # deltas as support for H0.
        return PerturbationResult(primary_id, probe, None, threshold,
                                  "inconclusive_silence", None, None, counts_toward_null=False)

    delta = distance(behavior_present, behavior_absent)
    verdict = "load_bearing" if delta >= threshold else "cosmetic"
    return PerturbationResult(
        primary_id=primary_id,
        probe=probe,
        delta=delta,
        threshold=threshold,
        verdict=verdict,
        behavior_present=behavior_present,
        behavior_absent=behavior_absent,
    )


# ---------------------------------------------------------------------------
# Offline stub probe. Replace at integration.
# It fakes causal dependence: if any foregrounded primary's content contains the
# probe's keyword, the behavior vector shifts. Lets verify.sh exercise both verdicts.
# ---------------------------------------------------------------------------
def stub_probe_fn(context: Sequence[Primary], probe: str) -> list[float]:
    # Behavior depends ONLY on whether the probe keyword is present in the foregrounded
    # context — not on raw context length. So withholding a primary that does not carry
    # the keyword yields zero delta (cosmetic), while withholding the carrier moves behavior.
    key = probe.lower().split()[0] if probe else ""
    signal = sum(1.0 for p in context if key and key in p.content.lower())
    return [signal, signal * 0.5]
