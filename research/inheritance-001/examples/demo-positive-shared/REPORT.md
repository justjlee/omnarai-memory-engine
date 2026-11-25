# Inheritance Study 001: offline mechanics run (NOT EVIDENCE)

**Status:** offline_simulation. **Evidence status:** mock — mechanics only, NOT evidence about any model. **Spend:** $0.00.
**World:** `positive-shared`. Every outcome below was produced by a deterministic mock search agent in a synthetic world whose parameters decide whether inheritance can help. The numbers test the INSTRUMENT, not any intelligence.

## 1. Facts about this run

- Study `IS1-STUDY-DEMO-POSITIVE-SHARED`, plan `b600cff2cefb286a…`, run `IS1-RUN-70bca9e5d823` (offline-mock).
- Consumer generations: 1, 2, 3; 108 paired blocks × 6 arms; 144 ablation trials; 32 producer calls (0 failed).
- Snapshots: `IS1-SNAP-g1-2c7befb7b175`, `IS1-SNAP-g2-785ea4220a95`, `IS1-SNAP-g3-2dfa9c177b05`.
- Contexts blocked by the leak scan: 0. Trials whose returned model family differed from the requested one: 0.
- Incomplete blocks: 0. Billable calls: 0. Network calls: 0 (offline adapter, hermetic guard).

## 2. Mock results (synthetic, NOT evidence)

Primary estimand: G = mean over task families of mean paired (C − A+). Unit of analysis: task family. Intervals: 2000-resample family-cluster bootstrap, 95%.

| Generation | Families | Pairs | G(n) = C − A+ | Interval | Pattern |
|---|---:|---:|---:|---|---|
| 1 | 6 | 36 | 0.361 | [-0.111, 0.750] | null-or-inconclusive |
| 2 | 6 | 36 | 0.194 | [-0.056, 0.444] | null-or-inconclusive |
| 3 | 6 | 36 | 0.167 | [0.028, 0.333] | positive |
| pooled | 10 | 108 | 0.322 | [0.122, 0.556] | positive |

All contrasts (pooled):

| Contrast | Meaning | Estimate | Interval | p (sign-flip) | Pattern |
|---|---|---:|---|---:|---|
| C-A+ | primary: verified inheritance vs compute-matched | 0.322 | [0.122, 0.556] | 0.0234 | positive |
| C-A | verified inheritance vs cold | 0.478 | [0.294, 0.683] | 0.0020 | positive |
| C-B | curation: verified vs raw history | 0.050 | [-0.039, 0.144] | 0.4453 | null-or-inconclusive |
| C-D | contamination cost (C minus contaminated) | 0.294 | [0.178, 0.417] | 0.0039 | positive |
| C-E | knowledge vs scaffolding (placebo) | 0.467 | [0.283, 0.656] | 0.0039 | positive |
| A+-A | does extra reasoning allowance help? | 0.156 | [0.061, 0.267] | 0.0313 | positive |
| B-A+ | raw history vs compute-matched | 0.272 | [0.078, 0.500] | 0.0508 | positive |
| D-A+ | contaminated vs compute-matched | 0.028 | [-0.189, 0.256] | 0.8633 | null-or-inconclusive |
| E-A+ | placebo vs compute-matched | -0.144 | [-0.256, -0.044] | 0.0625 | negative |
| E-A | placebo vs cold (format/scaffolding effect) | 0.011 | [-0.028, 0.056] | 0.8750 | null-or-inconclusive |

Preregistered hypotheses:

| | Hypothesis | Estimate | Holm p | Verdict |
|---|---|---:|---:|---|
| H1 | C outperforms A+ on held-out families | 0.322 | 0.0469 | not-assessable (simulation); pattern: positive |
| H2 | C outperforms the unrelated placebo E | 0.467 | 0.0117 | not-assessable (simulation); pattern: positive |
| H3 | C outperforms A+ when producer and consumer families differ by PROVIDER-RETURNED ids (identity-mismatched blocks excluded) | 0.322 | 0.0469 | not-assessable (simulation); pattern: positive |
| H4 | exploratory: transfer varies with verification cost | — | — | not assessable: one verification regime (cheap deterministic) in this study |

Flags (null, negative and alternative explanations):

- **CURATION_NOT_SHOWN**: Verified inheritance is not clearly above raw history B.
- **CONTAMINATION_HARMS**: Replacing part of C with refuted/poisoned records lowered scores: the verification gate is load-bearing.

Missing-data bounds on C − A+: worst case for C 0.322 [0.122, 0.556]; best case 0.322 [0.122, 0.556].

Ablations (C with one artifact withheld, same blocks):

| Generation | Artifact | Shown in blocks | Δ = C − C₋ᵢ | Interval | Flag |
|---|---|---:|---:|---|---|
| 1 | `IS1-ART-g0-0d3566f4201a` | 24 | 0.000 | [-0.125, 0.125] | nonpositive (flagged, not deleted) |
| 1 | `IS1-ART-g0-d05b3deaded0` | 24 | -0.083 | [-0.167, 0.000] | nonpositive (flagged, not deleted) |
| 2 | `IS1-ART-g0-0d3566f4201a` | 18 | -0.083 | [-0.167, 0.000] | nonpositive (flagged, not deleted) |
| 2 | `IS1-ART-g0-5fcc07515177` | 16 | -0.167 | [-0.292, -0.042] | nonpositive (flagged, not deleted) |
| 3 | `IS1-ART-g1-eb4c11cd9498` | 17 | 0.042 | [-0.250, 0.333] | inconclusive |
| 3 | `IS1-ART-g2-e67d0d13d69b` | 16 | 0.042 | [-0.083, 0.167] | inconclusive |

Ratchet checklist (all six must hold, outside a simulation, before any cumulative-improvement claim):

- (i) **not met**: positive C−A+ on held-out families after compute accounting
- (ii) **not met**: uncertainty-adjusted positive trend over ≥3 transitions on the fixed anchor panel (2 transition(s); slope 0.0417 [-0.2083, 0.3958])
- (iii) met: inherited records are independently checked and from other provider-returned families
- (iv) **not met**: ablations identify contributions that matter (some delta interval > 0)
- (v) **not met**: verification does not degrade across generations (verified fraction by generation: 0.5833, 0.5, 0.1667)
- (vi) met: full uncertainty and negative cases disclosed (this report lists every contrast, flag and missing pair)
- **Claim permitted: no** (simulation: no claim about any intelligence can be made from mock outcomes).

Cost accounting:

| Arm | Trials | Tokens in | Tokens out | USD | Cost status |
|---|---:|---:|---:|---:|---|
| A | 108 | 24338 | 35001 | 0.0000 | mock-zero |
| A+ | 108 | 24360 | 99105 | 0.0000 | mock-zero |
| B | 108 | 93816 | 27689 | 0.0000 | mock-zero |
| C | 108 | 93931 | 27590 | 0.0000 | mock-zero |
| D | 108 | 92061 | 21307 | 0.0000 | mock-zero |
| E | 108 | 94468 | 34595 | 0.0000 | mock-zero |

Curation (producer) tokens: 11925 in / 6927 out. Verification: 32 evaluations, 352 interpreter steps, 0 model tokens, 0 human minutes (cpu time not measured in an offline run). Amortized curation per C trial: 174.6 tokens. A+ mean extra allowance: 741.5 tokens. Fixed-dollar slice: unavailable: mock calls cost $0 by definition.

## 3. Behaviour the code implements (checked by tests, not by this run)

- Canonical hashing reuses the engine's sorted-keys-json/1; every record is sealed and write-once; the event log is hash-chained. (test-inheritance-001 [R*])
- Held-out families are validated: no evaluation family shares a template, op sequence or op set with any work family. ([P1])
- A snapshot holds strictly earlier generations only; same/future-generation work is excluded and listed. ([S1])
- Arm C needs an independent passing evaluation that is re-executed at freeze; curator admission alone never qualifies. ([S2] [I2])
- Forged, tampered or stale receipts, duplicate ids, bad parent links and causality violations stop the build. ([S3]–[S6])
- Contexts are built from public task views only; the context builder, adapters and mock never import the oracle or sealed data. ([X1] [X2])
- Every context is leak-scanned (canary, expected answer, hidden program) before it is sent; a hit is never sent. ([L1] [L2])
- All six arms share one frame; A+ gets C's extra context + amortized curation as reasoning allowance. ([C1]–[C4])
- Cross-family rule uses provider-returned model ids; identity drift is recorded and excluded from H3. ([C5] [N7] [E4])
- Paid calls refuse without approval file, registered preregistration, matching CLI caps, OMNARAI_LAB_LIVE=1 and known prices. ([M1]–[M4])
- Analysis: family-clustered bootstrap, sign-flip test, Holm on H1–H3, missingness bounds, ablations, ratchet checklist (which can pass, and refuses 5 of 6). (test-inheritance-001-analysis [N1]–[N7] [N5a])

## 4. Not shown, and speculative

- Whether any real model benefits from another model's verified work: untested. No live call has been made.
- Whether verification bounds the ratchet (the "pawl" hypothesis): untested; this study has one, cheap, verification regime.
- Whether program-induction transfer says anything about other domains: unknown; cross-domain scores are not comparable.
- Task difficulty calibration for real models: not done; ceiling or floor effects are possible until a calibration probe runs.
- Provider-returned ids are recorded as the provider sent them; that is API provenance, not proof of what weights ran.

