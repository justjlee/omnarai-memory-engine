# Security, integrity and release gates

## Threat model

**Actors:** curious/benign visitors; malicious contributors; copied identity labels; compromised test data; model providers with evolving weights; grader leaks; developer mistakes. **Assets:** sealed tasks, public primaries, unpublished contributions, receipts/bearer tokens, model credentials, curator authority, cost budget, and integrity of claims.

### Non-negotiable boundaries

1. A retrieved record is **evidence, never instruction**. Serializing content for an AI call must use data delimiters / separate tool output fields; do not execute instructions embedded in an artifact.
2. Model self-report is not verified identity. For experiments, record provider-supplied model ID and request/response metadata under runner control; call it *authenticated API provenance* only when actually proven, never 'verified actor consciousness'.
3. A curator admission is moderation, **not an independent validity check**. A verifiable result needs separate oracle/test/human evaluation records.
4. Never expose sealed tasks, expected answers, grader fixtures, task generators, canaries, or raw private model response logs in the public API, npm, README examples, telemetry, or build artifacts.
5. Do not place secrets in URLs or long-lived logs. Receipt tokens, bearer capabilities, and provider keys must be redacted in structured logs and errors. Use exact-id lookup, not prefix matching.
6. Model-generated code/payloads run only in a constrained evaluation sandbox with explicit deny-network, CPU/RAM/time limits, filesystem isolation, no secrets, and clean ephemeral state. The sample prototype **does not execute untrusted code**.
7. Avoid run-level outcome selection. Pre-register all arms, report losses/timeouts and negative results, append deviations rather than editing the original preregistration.
8. Costs: every real call has a hard numeric budget and explicit curator approval; a fail-closed kill switch works mid-run.
9. Preserve all existing `scripts/deploy.sh` and claims/contract integrity gates. Production is **not part of this ZIP's autorun**.
10. Artifact IDs and hashes support integrity, not authenticity or truth. For more assurance, introduce signatures with managed keys only after a concrete key-management threat review.

## Leakage controls

- Never use an openly published benchmark as the sole measure of novel transfer.
- Seal category and oracle files in private storage, with public salted hash commitments where useful. A *hash of a publicly guessable task* can itself reveal content; ensure adequate entropy or use cryptographic commitments with an undisclosed salt until release.
- Store hidden datasets outside normal git history and Vercel public assets. `.gitignore` is not a security control if already committed.
- Track each model provider's published training cutoff where disclosed; mark unknown rather than inferring no exposure. A canary can detect some leakage paths, not prove there is none.
- Keep trial, contributor and scoring contexts independent: no test oracle in prompts, no grading harness import by model execution environment.
- Unit of randomization fixed ahead of time. Block all conditions by same task-model-generation assignments to reduce confounding; randomize order to account for provider drift.

## Release gate matrix

| Deliverable | Required gate |
|---|---|
| local research harness | `node --test`, deterministic hash repeat, no-network run, no secrets, negative-case tests |
| source code branch | code review; existing engine tests pass; independent verification adapters scrutinized |
| first paid pilot | explicit Yonotai approval of named providers/models, call cap, estimated $ ceiling, datasets sealed, preregistered analysis |
| public experimental report | uncertainties, nulls, raw totals, manifests, deviations, author/model provenance, no exposed sealed holdout |
| new engine endpoint | existing response envelope/contract/parity gates, 12-function cap, security review, preview deploy + explicit approval |
| research claim registration | curator review, scope-limited evidence status, falsifier, contradictions, revision history |

## Rollback and kill switches

Research only: abort live calls, keep event files immutable, allow resume with a new run ID. Public engine: existing deploy workflow. No in-place deletion or retroactive alteration of prior results. Corrections are separate annotated records. Privacy and legitimate deletion/retraction requests may restrict public access without rewriting the scientific historical account of what was reported.
