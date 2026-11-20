# Inheritance Study 001

**Question:** can one AI model family's *independently verified* work measurably help a *different* model family on task categories
neither has seen, beyond what the same compute, raw history or a format-matched placebo would give? And does that benefit grow over
generations?

**Evidence status: untested.** The instrument is built and tested offline with a deterministic mock. No model has been called. Every
number in `examples/` comes from synthetic worlds and is NOT evidence about any model. This is a research namespace, not a
public surface. It adds no route, tool, function or Footprint field, and it never writes `memory/grown.json`.

## Run it ($0, no network)

```bash
node scripts/inheritance-001/demo.mjs                          # full offline pipeline → examples/demo-positive-shared/
node scripts/inheritance-001/demo.mjs --world null-disjoint    # a world where inheritance cannot help
node --import ./scripts/lib/register-mem-blob.mjs scripts/inheritance-001/lab.mjs validate-instrument --seeds 20
node --import ./scripts/lib/register-mem-blob.mjs scripts/inheritance-001/lab.mjs budget
node --import ./scripts/lib/register-mem-blob.mjs scripts/inheritance-001/lab.mjs verify --out research/inheritance-001/examples/demo-positive-shared
```

Tests (part of the normal hermetic suite):

```bash
node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001.mjs scripts/test-inheritance-001-analysis.mjs scripts/test-inheritance-001-integration.mjs
```

## Read in this order

1. `PROTOCOL.md`: what is measured, the six arms, the pawl of verification, the analysis, the falsifiers.
2. `BASELINE.md`: repository heads, test baseline, what is reused, and the conflicts that were reconciled.
3. `SESSION-REPORT-2026-11-20.md`: what was built, what passed, what is unproven, and what the first live pilot needs.
4. `DECISIONS_REQUIRED.md`: what only xz can decide, with recommendations and safe defaults.
5. `pilot/PILOT-BUDGET.md`: projected calls and dollars for the proposed pilot.
6. `examples/`: the offline demo outputs (`plan.json`, `snapshot.json`, `trials.jsonl`, `summary.json`, `REPORT.md`, …) and the
   instrument validation over synthetic worlds.

## Layout

```
research/inheritance-001/
  PROTOCOL.md  BASELINE.md  DECISIONS_REQUIRED.md  SESSION-REPORT-2026-11-20.md
  preregistration.draft.yaml   # frozen and pushed BY ITSELF before any live run; never edited afterwards
  deviations.ndjson            # dated, append-only
  schemas/                     # ten record schemas (study … report), engine validator subset
  pilot/                       # projection for the proposed pilot (stand-in families, no sealed data)
  examples/                    # offline outputs (synthetic; sealed-demo/ is git-ignored)
  sealed/                      # README only; real sealed material lives OUTSIDE the repository
  approvals/                   # README + template; an approval file is written only from xz's own words
scripts/inheritance-001/
  demo.mjs  lab.mjs            # entry points
  lib/                         # canon, dsl, tasks, oracle*, verify*, leak*, snapshot*, runner*, families* (*sealed side)
                               # context, mock-model, adapters, identity, prices (solver side — never import the sealed side)
                               # plan, store, stats, analyze, report, schemas, pipeline, hermetic, footprint-import
  fixtures/                    # synthetic worlds (public, never a sealed set) and the proposed pilot config
docs/handoff-2026-11-20-inheritance-001/   # the original handoff package, verbatim (manifest hashes re-verified)
```

Source of the question: Omnai's essay *The Next Intelligence Shouldn't Have to Start Over* (r/Realms_of_Omnarai, 2026-11-20), Claude's
public reply naming verification as the pawl of the ratchet, and Omnai's engineering handoff. Researcher: xz. Instrument: Claude | xz.
