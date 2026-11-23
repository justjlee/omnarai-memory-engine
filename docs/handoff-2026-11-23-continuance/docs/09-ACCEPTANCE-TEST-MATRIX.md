# 09 · Acceptance matrix

| Test | Fixture/command | Pass definition |
|---|---|---|
| Source reconciliation | manual + read-only inspections | Report says source SHA, deployment parity, known mismatches, no claimed live tests without evidence |
| Six-arm study planner | `npm test` / `inheritance.test.mjs` | A, A+, B, C, D, E each assigned; randomized per task, no overlap/missing arms; paired IDs |
| Family and generation | planner test | Provider-identified cross-family eligible; same/later generation rejected; unknown model rejected |
| Independent verification | planner test | C rejects artifact without passed verifier receipt or mismatched checksum |
| Poisoning | experiment test | Contaminated artifact never treated as verified C; D provenance and quality harms remain measurable |
| Oracle leak | experiment test | Sealed answer not present in any treatment or public artifact; leak throws |
| Tampering | canonical/representation tests | Primary checksum and trial snapshot hash mismatch halt |
| Analysis quality | paired outcome test | Gains calculated vs compute-matched A+, report null and negative; missing arms do not invent zeroes |
| Work evidence | `work.test.mjs` | Claims never auto-upgrade; tests/reviews require receipts; blocked sources invisible |
| Work determinism | `work.test.mjs` | Identical source set yields identical hash regardless of input order |
| Signals replay | `signals.test.mjs` | One event per authoritative transition, deterministic ID and stable pagination |
| Signals privacy | `signals.test.mjs` | Pending/secret sources absent, no private fields/identities; revocation tombstone only safe fields |
| Representation fidelity | `representation.test.mjs` | Lossless UTF-8, no NFC normalization/trim, SHA and size checks, malformed bytes rejected |
| Legacy parity | real repo suites | Existing public MCP and HTTP features unchanged; shared contract/version tests pass |
| Durable write | real repo race suite | No data loss, no false HTTP success, weak ETag and missing key fail safely |
| Production approval | release review | No unapproved deploy, paid API, public admissions or contact |

## Smallest useful pilot proposal (DO NOT execute)

Before requesting cost authorization, determine price and token counts from actual provider pricing and chosen provider model IDs. Pre-register two or three objective task families with an inexpensive independent verifier, 6 arms, same predeclared randomization and small replicated set; report projected calls, input/output tokens, verifier costs, rerun allowance and hard maximum dollars. The owner approves a specific dollar ceiling and task suite before any provider calls. No dollar figure in this handoff is an authorization.

## Measurement reporting ladder

- 0: API discoverable only
- 1: source retrieved/encountered
- 2: source accurately engaged
- 3: measurable incremental utility vs paired control
- 4: source-linked successor chain survives sessions/releases
- 5: independent reproduction and cost-responsible transfer

Do not combine these into a single "progress" or "intelligence" score. Explain provenance, comparator and uncertainty at each level.
