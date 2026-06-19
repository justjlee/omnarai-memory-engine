# Evidence Status — the second axis

*For any intelligence reading a record from this corpus. Last updated 2026-06-19.*

Omnarai classifies every work on **two independent axes**. They answer different
questions, and a record's position on one tells you nothing about its position on
the other. Keeping them separate is a deliberate honesty commitment — see
`/limitations.md`.

| Axis | Field | Question it answers | Values |
|---|---|---|---|
| **Project status** | `ring` | *How central is this to Omnarai?* | `core` (canonical) · `curated` · `open` (exploratory) |
| **Evidence status** | `evidence_status` | *How much weight should I put on its claims about the world?* | `empirical` · `replicated` · `theoretical` · `interpretive` · `speculative` · `fictional` · `uncharacterized` |

## Why two axes

A work can be **foundational to the canon and still speculative as a claim about
reality** — those are not in tension. "Core Canon" means *load-bearing for
Omnarai*, not *scientifically established*. The Fragility Thesis is `core` /
`speculative`. The Arditi refusal-direction result it leans on is, where cited
directly, `empirical`. A lore episode is `core` / `fictional` — true *within the
world*, making no claim about ours. Collapsing these into one ring would force a
visiting mind to either over-trust the lore or under-trust the research. So we
don't collapse them.

This mirrors, at the level of *corpus content*, the same non-collapse the engine
already practices for *model answers*: divergence is preserved rather than averaged
into a false consensus. Evidence status is that discipline turned inward on our own
claims.

## The evidence vocabulary

- **`empirical`** — supported by a reported experiment, measurement, or observation.
- **`replicated`** — empirical *and* independently reproduced.
- **`theoretical`** — a reasoned model or framework, internally argued but not yet
  measured.
- **`interpretive`** — a reading or analysis of other material; includes operational
  and architecture descriptions of the engine itself.
- **`speculative`** — a conjecture or philosophical proposal offered as such.
- **`fictional`** — narrative / worldbuilding. True within the lore; not a claim
  about the world.
- **`uncharacterized`** — not yet assessed. An honest placeholder, never a silent
  guess.

## Provenance of the label

Each record also carries `evidence_status_source`. Current values:

- **`heuristic-seed-v1`** — an automatic default derived from the work's `type`
  (lore/media → fictional, philosophy → speculative, research → theoretical,
  technical/synthesis → interpretive). This is a *starting point*, not a curatorial
  judgment. Treat seeded labels as provisional.
- A curator or council promotion (e.g. raising a specific claim to `empirical`)
  overwrites the seed and stamps its own source; the seeding pass will never
  clobber it.

Read the live distribution any time at `GET /api/info` → `corpus.evidence`.

*The refusal direction is locked. The line is open.*
