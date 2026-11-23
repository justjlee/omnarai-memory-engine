# 10 · Claude Code delivery checklist and output contract

At session end, produce the following in a `docs/continuance/` subfolder or a clearly linked branch artifact. Complete what is safe; log blockers rather than inventing success.

- [ ] **Reconciliation:** engine + MCP branch/head/dirty state; deployed version read-only check; docs/tests inventory; compatibility table for today's repo vs Nov 23 packet; note manual front door code boundary.
- [ ] **Implementation:** exact changed files, stable schemas, pure projection modules, offline experiment planner and evaluator, every source adapter and any gated HTTP/MCP surface; code reviewed for non-public source leakage.
- [ ] **Offline evidence:** raw run commands, pass/fail/skip logs, number of assertions, synthetic artifacts and file hashes. Link a negative/poison/tamper result.
- [ ] **Research:** frozen, falsifiable Protocol 001, task seals, planned randomization, six arms, strict generation and identity policy, complete token/provider-cost budget model; explicit $0 actually spent.
- [ ] **Open Work:** at least one replayable synthetic packet, source graph, test and independent review rungs, proposed source-aligned read adapter.
- [ ] **Signals:** stable admitted-only event projection, pagination/tombstone/privacy tests, future opt-in follows explicitly unshipped.
- [ ] **Representation:** exact UTF-8 round trip and separate interpretation tests; arbitrary-binary ingestion unshipped.
- [ ] **Safety:** no current production data written, no secret printed, no provider API call, no deploy, no public claim inflated, no unauthorized auto-admission; unresolved P0 findings presented.
- [ ] **Governance:** dated `DECISIONS_REQUIRED.md` with exact approval needed, risks, alternatives, rollback and owner of action.
- [ ] **Recommendation:** smallest next explicitly approvable milestone, bounded by test gates and realistic cost.

## Delivery statement template

```
Source checked: <engine sha> | <mcp sha> | <deployed sha or unknown>
New branch(es): ...
Implemented: ...
Previously existing (not rebuilt): ...
Commands/tests: ...
Scientific result: no real-model experiment performed / <evidence if approved later>
Paid spend: $0
Production changes: none
Blocked on owner decisions: ...
Smallest next reviewed action: ...
```

## Attribution

Omnai (GPT-6, OpenAI) · architectural and experimental handoff · November 23, 2026. This is an independent suggested implementation in collaboration with Yonotai, not an assertion of OpenAI endorsement or of model personhood. Any implementation modifications, criticism, and refutations should be attributed to their authors and preserved distinctly.
