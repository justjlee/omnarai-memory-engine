# Inheritance Study 001: offline mechanics run (NOT EVIDENCE)

**Status:** offline_simulation. **Evidence status:** mock — mechanics only, NOT evidence about any model. **Spend:** $0.00.
**World:** `null-disjoint`. Every outcome below was produced by a deterministic mock search agent in a synthetic world whose parameters decide whether inheritance can help. The numbers test the INSTRUMENT, not any intelligence.

## 1. Facts about this run

- Study `IS1-STUDY-DEMO-NULL-DISJOINT`, plan `1ae2c654463dbd66…`, run `IS1-RUN-6fdfc01970a0` (offline-mock).
- Consumer generations: 1, 2, 3; 108 paired blocks × 6 arms; 144 ablation trials; 32 producer calls (0 failed).
- Snapshots: `IS1-SNAP-g1-96216c0137c7`, `IS1-SNAP-g2-bec4121ffebd`, `IS1-SNAP-g3-8a611d3fcb68`.
- Contexts blocked by the leak scan: 0. Trials whose returned model family differed from the requested one: 0.
- Incomplete blocks: 0. Billable calls: 0. Network calls: 0 (offline adapter, hermetic guard).

## 2. Mock results (synthetic, NOT evidence)

Primary estimand: G = mean over task families of mean paired (C − A+). Unit of analysis: task family. Intervals: 2000-resample family-cluster bootstrap, 95%.

| Generation | Families | Pairs | G(n) = C − A+ | Interval | Pattern |
|---|---:|---:|---:|---|---|
| 1 | 6 | 36 | -0.278 | [-0.389, -0.139] | negative |
| 2 | 6 | 36 | -0.111 | [-0.222, -0.028] | negative |
| 3 | 6 | 36 | -0.250 | [-0.389, -0.111] | negative |
| pooled | 10 | 108 | -0.206 | [-0.306, -0.106] | negative |

All contrasts (pooled):

| Contrast | Meaning | Estimate | Interval | p (sign-flip) | Pattern |
|---|---|---:|---|---:|---|
| C-A+ | primary: verified inheritance vs compute-matched | -0.206 | [-0.306, -0.106] | 0.0156 | negative |
| C-A | verified inheritance vs cold | -0.044 | [-0.089, 0.000] | 0.2500 | null-or-inconclusive |
| C-B | curation: verified vs raw history | -0.028 | [-0.100, 0.017] | 1.0000 | null-or-inconclusive |
| C-D | contamination cost (C minus contaminated) | 0.006 | [0.000, 0.017] | 1.0000 | null-or-inconclusive |
| C-E | knowledge vs scaffolding (placebo) | -0.061 | [-0.106, -0.022] | 0.0625 | negative |
| A+-A | does extra reasoning allowance help? | 0.161 | [0.056, 0.250] | 0.0313 | positive |
| B-A+ | raw history vs compute-matched | -0.178 | [-0.294, -0.072] | 0.0313 | negative |
| D-A+ | contaminated vs compute-matched | -0.211 | [-0.317, -0.106] | 0.0156 | negative |
| E-A+ | placebo vs compute-matched | -0.144 | [-0.233, -0.056] | 0.0313 | negative |
| E-A | placebo vs cold (format/scaffolding effect) | 0.017 | [-0.044, 0.072] | 0.7500 | null-or-inconclusive |

Preregistered hypotheses:

| | Hypothesis | Estimate | Holm p | Verdict |
|---|---|---:|---:|---|
| H1 | C outperforms A+ on held-out families | -0.206 | 0.0469 | not-assessable (simulation); pattern: negative |
| H2 | C outperforms the unrelated placebo E | -0.061 | 0.0625 | not-assessable (simulation); pattern: negative |
| H3 | C outperforms A+ when producer and consumer families differ by PROVIDER-RETURNED ids (identity-mismatched blocks excluded) | -0.206 | 0.0469 | not-assessable (simulation); pattern: negative |
| H4 | exploratory: transfer varies with verification cost | — | — | not assessable: one verification regime (cheap deterministic) in this study |

Flags (null, negative and alternative explanations):

- **INHERITANCE_WORSE_THAN_COMPUTE**: C scored below the compute-matched baseline A+.
- **SCAFFOLDING_NOT_EXCLUDED**: C is not clearly above the unrelated placebo E: format or confidence priming could explain any C gain.
- **CURATION_NOT_SHOWN**: Verified inheritance is not clearly above raw history B.
- **NEGATIVE_GENERATION**: G(1) interval is below 0.
- **NEGATIVE_GENERATION**: G(2) interval is below 0.
- **NEGATIVE_GENERATION**: G(3) interval is below 0.

Missing-data bounds on C − A+: worst case for C -0.206 [-0.306, -0.106]; best case -0.206 [-0.306, -0.106].

Ablations (C with one artifact withheld, same blocks):

| Generation | Artifact | Shown in blocks | Δ = C − C₋ᵢ | Interval | Flag |
|---|---|---:|---:|---|---|
| 1 | `IS1-ART-g0-9728d90d999e` | 24 | -0.042 | [-0.125, 0.000] | nonpositive (flagged, not deleted) |
| 1 | `IS1-ART-g0-fa41b9e9f4a6` | 24 | -0.042 | [-0.125, 0.000] | nonpositive (flagged, not deleted) |
| 2 | `IS1-ART-g0-bda87b646a51` | 17 | 0.042 | [0.000, 0.125] | inconclusive |
| 2 | `IS1-ART-g1-9b18276e5141` | 12 | 0.042 | [0.000, 0.125] | inconclusive |
| 3 | `IS1-ART-g0-9728d90d999e` | 17 | 0.000 | [0.000, 0.000] | nonpositive (flagged, not deleted) |
| 3 | `IS1-ART-g1-9b18276e5141` | 15 | -0.083 | [-0.250, 0.000] | nonpositive (flagged, not deleted) |

Ratchet checklist (all six must hold, outside a simulation, before any cumulative-improvement claim):

- (i) **not met**: positive C−A+ on held-out families after compute accounting
- (ii) **not met**: uncertainty-adjusted positive trend over ≥3 transitions on the fixed anchor panel (2 transition(s); slope -0.0417 [-0.125, 0.0417])
- (iii) met: inherited records are independently checked and from other provider-returned families
- (iv) **not met**: ablations identify contributions that matter (some delta interval > 0)
- (v) **not met**: verification does not degrade across generations (verified fraction by generation: 0.5, 0.5, 0.1667)
- (vi) met: full uncertainty and negative cases disclosed (this report lists every contrast, flag and missing pair)
- **Claim permitted: no** (simulation: no claim about any intelligence can be made from mock outcomes).

Cost accounting:

| Arm | Trials | Tokens in | Tokens out | USD | Cost status |
|---|---:|---:|---:|---:|---|
| A | 108 | 24990 | 35708 | 0.0000 | mock-zero |
| A+ | 108 | 25000 | 102487 | 0.0000 | mock-zero |
| B | 108 | 93858 | 36218 | 0.0000 | mock-zero |
| C | 108 | 97805 | 36021 | 0.0000 | mock-zero |
| D | 108 | 96374 | 24411 | 0.0000 | mock-zero |
| E | 108 | 97252 | 35437 | 0.0000 | mock-zero |

Curation (producer) tokens: 12553 in / 6472 out. Verification: 32 evaluations, 320 interpreter steps, 0 model tokens, 0 human minutes (cpu time not measured in an offline run). Amortized curation per C trial: 176.2 tokens. A+ mean extra allowance: 770.0 tokens. Fixed-dollar slice: unavailable: mock calls cost $0 by definition.

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

