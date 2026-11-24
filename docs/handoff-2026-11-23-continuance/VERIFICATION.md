# Packaging verification · 2026-11-23

**Scope:** This records only tests executed against the **offline demonstration code in this ZIP**. It does not independently validate production deployment or real-model research claims.

- Runtime: Node.js v22.16.0 (package supports Node >=20).
- `npm test`: **60/60 passing**, 0 failures. Node's built-in test runner; no npm install required.
- `npm run demo`: executed, generated 6 illustrative outputs in `artifacts/demo/`; no provider requests, no network calls, no charge.
- `jsonschema` Draft 2020-12 local validation: demo problems (2), demo work events (3), packet (1), primary (1), interpretation (1), Signals page (1), Signals events (2), inheritance plan (1), trials (6) validated against the proposed schemas, including embedded local references. This validation was run during packaging using an installed Python validator; the Node prototype has no such dependency.
- ZIP manifest: `SHA256SUMS.txt` contains relative-path SHA-256 hashes for each content file other than the manifest itself.

**Synthetic demonstration scores are hand-assigned for illustrating reporting only. They are not evidence of improved intelligence or inheritance effects.** The `inheritance-plan.json` is mock data and cannot serve as a real preregistered study.

## Methodological limitations of the offline reference

- The `independent:true` field in fixture verifier records is a declared test field, not a cryptographic attestation. Real controls require a trusted verifier registry, independent execution and immutable receipts.
- Baseline vs compute-matched reference uses token ceilings, not observed equivalent compute. A real provider adapter must match actual cost/time/token budget and expose model metadata.
- Oracle leakage control in the example uses literal substring screening. A real experiment needs semantic leaks, prompt/tool/log metadata and hidden-task contamination audits.
- Pseudorandom assignment is deterministic and documented but not cryptographically unpredictable; production studies may require an externally committed seed and restricted access until task allocation.
- Simple paired-bootstrap helper is illustrative; unit, cluster structure, repeated measures and statistical procedure must be preregistered before real observations.
- Public Signals code handles an in-memory set, not a real distributed, incremental, fault-tolerant event log; storage transitions, replay watermark and retroactive redactions need additional work.
- `work.mjs` demonstrates source-linked state folding, not authenticated review authority. Real adapter must verify signed or permissioned moderation state, source version and verifier receipts.
- `stableJson` uses sorted-key deterministic JSON for fixtures, not a full standard JSON Canonicalization Scheme; a formal, interoperable canonicalization contract is needed before external hash attestations.
