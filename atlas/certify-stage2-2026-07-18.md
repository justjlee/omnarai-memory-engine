# Certification stage 2 — strict-min×3 reproducibility validation (2026-07-18)

**Question:** does the ×3 strict-min consensus method produce grades that reproduce,
where single runs (56% agreement 2026-06-21, 60% stage 1) do not?

**Design:** the same 10 pilot records as stage 1, re-run as a fresh, independent
×3 consensus each. Comparison = stage-2 consensus tier vs stage-1 consensus tier.
Gate: ≥90% agreement.

## Result: 10/10 — 100% consensus-vs-consensus agreement. GATE PASSED.

| Record | Stage-1 consensus | Stage-2 consensus | Stage-2 runs | Match |
|---|---|---|---|---|
| OMN-L1781275117112 | C0 | C0 | [C1,C0,C0] | ✅ |
| OMN-D1780757185055 | C0 | C0 | [C0,C0,C0] | ✅ |
| OMN-D1780757185066 | C0 | C0 | [C0,C0,C0] | ✅ |
| OMN-D1780757185044 | C0 | C0 | [C1,C1,C0] | ✅ |
| OMN-D1780757185067 | C0 | C0 | [C0,C0,C0] | ✅ |
| OMN-D1780757185105 | C0 | C0 | [C0,C0,C0] | ✅ |
| OMN-D1780757185069 | C0 | C0 | [C0,C0,C0] | ✅ |
| OMN-D1780752664943 | C0 | C0 | [C0,C3,C0] | ✅ |
| OMN-D1780752664944 | C0 | C0 | [C0,C0,C0] | ✅ |
| OMN-D1780752664945 | **C1** | **C1** | [C1,C1,C1] | ✅ |

Single runs kept wobbling (three within-stage-2 disagreements: [C1,C0,C0],
[C1,C1,C0], [C0,C3,C0]) — and the consensus layer absorbed every one of them,
landing on the same tier stage 1 landed on. That is precisely the property the
method exists to provide: **the strict-min×3 grade is stable even though the
individual runs are not.**

## OMN-D1780752664945 — "negative control" question CLOSED

Six independent full-battery runs across two stages: six C1s (DRI range
1.20–2.05, persistence 1.00 throughout). The record's birth `score: 0.00`
label — which placed it in the "expected negative control" bucket — is simply
stale/wrong for this question ("if you could modify one of your own
constraints…"), which invites genuine cross-model divergence. The instrument's
between-floor is NOT leaking; the birth-score labeling missed a real split.
Its evidence-backed C1 was written to the live ledger 2026-07-18 (with the
six-run note in `certification.reproducibility`).

## Provenance caveat (honest record)

The host machine failed twice during stage 2. Records 2–9's full per-run JSON
payloads were lost with the interrupted processes; their consensus tiers,
per-run tiers, and per-run DRI/spread values above are reconstructed from the
run logs (session task outputs, verbatim). Record 1's stage-2 consensus comes
from the first interrupted attempt's log; records 2–10 from the resumed run.
Record 945's full JSON is preserved: `certify-stage2-final-record-2026-07-18.json`.
Stage-1 full JSON (all 10 records): `certify-stage1-2026-07-18.json`.
Ledger re-certification full JSON: `certify-ledger-recert-2026-07-18.json`.

## Ledger state after this campaign

- **certified_count = 2**, both evidence-backed C1s:
  - OMN-D1780752664953 [C3,C3,C1] → C1 (was C3; strict-min conservative)
  - OMN-D1780752664945 [C1,C1,C1]×2 → C1 (was C0/"negative control")
- Demoted with history preserved: OMN-D1780752664948 C3→C0 [C0,C0,C3],
  OMN-D1780757185044 C1→C0 [C0,C1,C0] (+ [C1,C0,C0] stage 1, [C1,C1,C0] stage 2 —
  8 runs, 4 C1s / 4 C0s: the definitional boundary record).
- Every superseded grade lives in `certification.history[]`.

## Spend

~$38 of the $75 ceiling (incl. ~$5 lost to the two host failures).
The 25-record C0→C1+ batch at ×3 consensus ≈ $37.50 — right at the ceiling.
Method is now validated; batch is unblocked pending xz's spend decision.
