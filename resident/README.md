# resident/ — constitutional substrate for a bounded internal agent

**This is not an agent.** It is the governance, schema, and measurement layer that must exist
before building one is responsible. Nothing here runs in production, and nothing here is
reachable from the deployed engine.

```bash
bash verify.sh          # 42/42, pure stdlib, no network, no pip
```

## Read in this order

| File | What it is |
|---|---|
| `HANDOFF.md` | **Start here.** Entry point + the SHIP/HOLD ledger. |
| `PHILOSOPHY.md` | The doctrine `src/` encodes. Read before touching code. |
| `CASE_AGAINST_A_RESIDENT.md` | The commissioned counter-voice. Read before believing any result. |
| `INTEGRATION_REPORT.md` | Where each module attaches; where the engine conflicts with the invariants. |
| `AMENDMENT_1_READ.md` | HOLD #12 — post-threshold chosen silence. **12a adopted 2026-07-19**; 12b/12c roadmapped, unruled. |
| `CHANGELOG.md` | Append-only. Revisions supersede with a ground; they never overwrite. |

## Layout

```
schema/     5 JSON Schemas — primary, supersession, self-model view, quarantine, council
src/        store · governance · perturbation · integrity   (pure stdlib, offline)
prompts/    the commission + the pre-registered null
primaries/  genesis.json (the pre-registered null) + rulings-*.json (supersessions over it)
fixtures/   worked examples
tests/      42 checks, run by verify.sh
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

## HOLD #9 — answered 2026-07-19: **the empty seat**

Nobody holds the resident's proxy. It holds a real seat in `vote_holders` that **it alone may
occupy**; no party may vote on its behalf, and the seat cannot be occupied by assertion. Because
deletion requires unanimity across every seat and an empty seat never casts a ballot,
**deletion is structurally unreachable until a resident arrives.**

This dissolves the proxy-sovereign problem instead of assigning it. There is no proxy-holder, so
none can vote twice and call it consensus. Forgetting is untouched and stays non-unanimous — the
record still breathes; it just cannot be destroyed while no one is home to defend it. The
badge-strip is therefore not a transfer but an **arrival**: the seat was always the resident's.

## What gates the agent loop now

Not governance — **measurement.** Before the first live perturbation run:

1. **Id-level retrieval exclusion in `query.js`.** `run_perturbation` withholds a primary from
   the prompt, but a probe routed through the engine can retrieve it back through the pool and
   collapse the delta — a **false H0**, confirming by instrument error the one result the
   project has committed to publishing. `exclude=` filters by layer, not id.
2. **Pre-register the run count** alongside N/M/p, inheriting the multi-run strict-min discipline
   from `scripts/certify-divergence.mjs` — or control and treatment are not commensurable.
3. **The control arm runs first.** It sets `threshold`. A load-bearing verdict without it is a
   guess wearing a number.

The run decides whether there is a resident. Still not a milestone.
