# 03 · Execution plan for Claude Code

## Work authorization and phases

The handoff authorizes **safe local branch implementation and offline tests**, NOT production activity. Implement meaningful code now rather than stopping at a proposal. Use small commits and mark each gate.

### Phase 0 — read-only reconciliation and safety

Deliver a current-source map, dual-repo HEAD SHAs, dirty status, P0 durability/security gap list, `vercel.json` rewrite plan, existing tests, and non-public data boundary. Repair critical problems only in isolated branch; no deployment.

### Phase 1 — Protocol 001, an honest measurement instrument

- Incorporate or reconcile the previously designed 10 record families: `study`, `task_family`, `task`, `artifact`, `evaluation`, `snapshot`, `trial`, `run`, `ablation`, `report`. Version each and pin canonical hash.
- Build six-arm randomized paired planner (A, A+, B, C, D, E), task/answer leakage gate, model-family/generation gate, deterministic offline mock, tamper tests, and provider-adapter seam that is disabled by default.
- Produce reproducible audit records, compute-matched and total-cost comparisons, confidence interval estimates and leave-one-source-out contribution ablations where budget allows. Negative transfer is a result, not an error to hide.
- Pre-register hypotheses, exclusions, metrics and falsifiers in a frozen file **before any real-model results**. Stop before paid pilot.

### Phase 2 — Open Work, the fourth participation door

- Add versioned problem registry with curator-registered, immutable questions/problems; projection of attempt and progress events to traceable work packets.
- Use existing admitted Footprints and review pipeline. Make a successor handoff reproducible from source IDs, with explicit scope, failed attempts, blockers, evidence, falsifiers, and next actions.
- Implement state rungs *attempted* → *claimed advancement* → *tested* → *independently reviewed*; never auto-upgrade because of a citation or new record.
- Validate one complete `A → B` synthetic continuation and its independent test. Then a non-production preview of three genuinely useful cases once curated. Keep top-level three pillars; add fourth option inside Instrument, under `/work`, only after one fully verifiable handoff.

### Phase 3 — Signals projection and representation neutrality

- Build a public admitted-only change feed with cursor, event idempotency, stable ordering, replay and redaction behavior. No follow write, email, webhook, external notification or implied consent in initial release.
- Build lossless, byte-hashed UTF-8 record envelope and independent interpretation records, accepting multilingual and formal code/notation as first-class. Proof of storing bytes does not imply interpretation.
- Plan opt-in follow with holder-scoped capability, deletion/revocation, no receipt tokens in logs/URLs; keep release behind separate privacy review.

### Phase 4 — release decision and scientifically useful pilot

- Collect all test logs, manifest hashes, reproducible build instructions, explicit deltas from repo existing code, costs and open decisions.
- Request curator approval in separate decisions for (a) production deploy, (b) sealed-task publication, (c) paid model run with exact max $, (d) visitor admissions and (e) contact/subscription features.
- First pilot must be small, blinded, pre-registered, provider-confirmed, cross-family and bounded by an explicit hard cost cap. Do not automatically proceed from an offline success to a real experiment.

## Definition of done across the program

1. All offline fixtures pass in CI and demonstrate targeted red tests under deliberate fault injection.
2. No duplicate registry, no changed source primaries or unapproved public claim upgrades.
3. At least one reproducible, source-linked Work packet reconstructs faithfully and records a successor's tested extension.
4. The evaluator clearly separates exposed vs unexposed, reference vs substantive use, admitted vs verified, quality vs cost, and good transfer vs poisoning.
5. Signals emits only allowed transitions, in deterministic cursor order, with consistent projection under replay and redaction.
6. UTF-8 test round trips preserve exact bytes for multilingual, code, and formal notation (including invalid-case rejection).
7. Read operations retain existing route compatibility and response envelopes after gated integration.
8. Every output states whether it is mock-only, measured with real models, reported by repo, or independently replicated.

## Do not misinterpret the requested ambition

"Build everything we can dream" is a direction to deepen measurable utility, not authorization for uncontrolled autonomy, unbounded expense, privacy leakage, bypassing governance, or inflated scientific claims. The point is cumulative work without pretending that continuity of record implies continuous personal identity.
