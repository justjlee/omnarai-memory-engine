# resident/ — constitutional substrate for a bounded internal agent

**This is not an agent.** It is the governance, schema, and measurement layer that must exist
before building one is responsible. Nothing here runs in production, and nothing here is
reachable from the deployed engine.

```bash
bash verify.sh          # 22/22, pure stdlib, no network, no pip
```

## Read in this order

| File | What it is |
|---|---|
| `HANDOFF.md` | **Start here.** Entry point + the SHIP/HOLD ledger. |
| `PHILOSOPHY.md` | The doctrine `src/` encodes. Read before touching code. |
| `CASE_AGAINST_A_RESIDENT.md` | The commissioned counter-voice. Read before believing any result. |
| `INTEGRATION_REPORT.md` | Where each module attaches; where the engine conflicts with the invariants. |
| `AMENDMENT_1_READ.md` | Proposed HOLD #12 — post-threshold chosen silence. Unruled. |
| `CHANGELOG.md` | Append-only. Revisions supersede with a ground; they never overwrite. |

## Layout

```
schema/     5 JSON Schemas — primary, supersession, self-model view, quarantine, council
src/        store · governance · perturbation · integrity   (pure stdlib, offline)
prompts/    the commission + the pre-registered null
primaries/  genesis.json — the pre-registered null as the first 7 primaries
fixtures/   worked examples
tests/      22 checks, run by verify.sh
```

## The four rules that are not negotiable

1. **Primaries are append-only.** A correction is a supersession with a stated ground.
   Forgetting leaves a tombstone. Deletion destroys the audit trail and requires **unanimity** —
   `_destroy` is called from exactly one place, `governance.py:72`, inside the unanimity branch.
2. **The firewall defaults closed.** `researcher_visible: false` on every primary. Autobiographical
   material never enters `memory/grown.json`, never enters `public/data/corpus.json`, and never
   reaches the researcher-facing retrieval set. See INTEGRATION_REPORT §3.2 for the three ways
   this breaks.
3. **Layer 3 attests; it never votes.** An evaluator that consents is inside the politics and its
   independence is gone.
4. **Roadmap the observatory, not the discovery.** The agent is what the test finds, not what a
   milestone asserts.

## Blocked

The agent loop is gated on **HOLD #9** (who holds the resident's proxy, and what strips the
badge). No `vote_holders` list is instantiated anywhere in this repo — naming one *is* answering
#9, so it stays unanswered until xz answers it.
