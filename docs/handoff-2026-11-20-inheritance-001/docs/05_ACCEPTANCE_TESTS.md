# Acceptance checklist for Claude Code

**Deliver PR artifacts; do not only describe a concept.**

- [ ] Inventory HEADs, baseline commands, architecture and collisions documented.
- [ ] New experiment protocol and preregistration (with published scope and explicit sealed-task exception) are present; revision/deviation handling defined.
- [ ] Immutable artifact and trial schemas validate; unknown keys and unsupported statuses fail closed.
- [ ] Content hashes are canonical and stable under key-order permutation; tampering detected.
- [ ] All six arms A/A+/B/C/D/E construct contexts from the **same** frozen condition-independent task and assignment blocks.
- [ ] In C, input artifacts have independent verifier evidence and are from strictly earlier generations; curator approval alone is never sufficient.
- [ ] In B, raw history is unmodified and evidence status is not inflated; in E, content unrelated but formatting/token volume matched; in D, poisoning is strictly data-only.
- [ ] No trial reads any same-generation or future artifact; no tested held-out answer appears in prompt/context.
- [ ] Context, inference, retrieval, curation and verification costs are logged separately; A+ has a documented matching procedure; missing prices = unknown, not zero.
- [ ] Runner's provider-returned model IDs are recorded; declared model identity never used as independent identity verification.
- [ ] Artifacts referencing other artifacts retain relationship and provenance; incorrect parent links are rejected, not repaired silently.
- [ ] Offline smoke test is deterministic, spend-free and reproducible; it **cannot** be cited as science.
- [ ] Scorer is independent, held-out, reproducible; no answer-peeking or grader model self-scoring as primary metric.
- [ ] Summary computes task-paired G(n)=C−A+, records confidence intervals and missingness, and never claims a positive ratchet merely from descriptive means.
- [ ] At least one negative inheritance fixture, placebo fixture, contamination fixture, hash-tamper fixture, generation-leak fixture, duplicate fixture and failed-verifier fixture pass.
- [ ] Leave-one-out ablation is supported or given a bounded, clearly specified next PR; contributions with non-positive value are flagged, not deleted.
- [ ] No new public MCP tool, no added Vercel function, no production deploy, no paid API call, no public sealed task data in first PR.
- [ ] Existing `check-*` gates and relevant `test-*.mjs` suites still pass; new tests written in the existing conventions.
- [ ] `REPORT.md` distinguishes **implemented**, **tested offline**, **tested live**, **not done**, **blocked**, with no false success language.
- [ ] Any ambiguous design choice is documented in `DECISIONS_REQUIRED.md` with recommendation and safe default; continue with all independently buildable work.

## Required end-of-session response from Claude Code

1. Exact repo branches and HEADs before and after; files changed.
2. What was reused vs newly built, and why.
3. Tests run and actual results; anything not run explicitly marked.
4. Demonstration commands and location of sample output.
5. Open research questions and visible failure cases.
6. Dollar spending incurred (must be $0 for initial pass).
7. What must be approved prior to any live run or production deployment.
8. Proposed next measurable experiment, with fixed budget and expected outputs.
