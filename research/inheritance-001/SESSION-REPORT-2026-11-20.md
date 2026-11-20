# Inheritance Study 001: session report, 2026-11-20

For xz and Omnai. This report follows the output contract in the handoff (`docs/handoff-2026-11-20-inheritance-001/CLAUDE_CODE_PROMPT.md`).

**Spend: $0.** No model API was called. No production data was read or written beyond four free public GETs (health,
footprints, inheritance, and a refused budget read). Nothing was deployed, pushed, published or registered.

## 1. Source heads, branch, files

- Engine: `origin/main` `ae2e763` (live code `ad05ecc`, 2026.11.18). Work on local branch **`inheritance-001`** in a fresh clone.
- MCP: `origin/main` `a990e73` (v1.12.0), unchanged.
- Local iCloud and `~/dev` checkouts: inspected, all stale, untouched (`BASELINE.md`).
- Added, nothing existing modified except two short pointer entries (`CLAUDE.md`, `ROADMAP.md`):
  - `scripts/inheritance-001/`: 28 modules (`lab.mjs`, `demo.mjs`, `lib/` × 24, `fixtures/` × 2)
  - `scripts/test-inheritance-001{,-analysis,-integration}.mjs`: 49 tests
  - `research/inheritance-001/`: protocol, baseline, draft preregistration, deviations, decisions, 10 schemas, pilot projection, examples
  - `docs/handoff-2026-11-20-inheritance-001/`: the handoff package verbatim (27 files, every manifest sha256 re-verified)

## 2. What was built, reused vs new

| Requirement | Built | Reused from the engine |
|---|---|---|
| Records for study, task_family, task, artifact, evaluation, snapshot, trial, run, ablation, report | sealed, write-once records, 10 JSON schemas, hash-chained event log, write-once Blob adapter namespaced to `research/inheritance-001/` | Footprint canonicalization (`sorted-keys-json/1`), id patterns, secret scan, the schema validator |
| Six-arm planner | held-out split validation (template, sequence and op-set), paired blocks with all six arms, seeded arm and call order, ablation rule fixed in advance, projection of calls/tokens/dollars | none |
| Pawl of verification | data-only interpreter; receipts state their scope; receipts re-executed at every freeze; forged/stale receipts stop the build; curator admission is not a verifier kind | Footprint moderation-folding pattern, applied to evaluations |
| Generation isolation | snapshots of strictly earlier generations; causality audit of exposure and citations; parent links strictly earlier; duplicates fail closed | |
| Leak control | sealed/public task split with salted commitments; canary + answer + program scan of every artifact and every context; the solver-side modules cannot import the oracle (import graph tested) | |
| Hermetic harness | deterministic mock search agent; 5 synthetic worlds with known truth; one-command demo; socket-level network guard | in-memory Blob loader, `invoke.mjs` real handlers |
| Footprint integration | admitted Footprints imported as cited raw-history candidates | `loadPublicFootprints` (the engine's own public read path) |
| Analysis | G(n)=C−A+ per generation and pooled; 10 contrasts; family-cluster bootstrap; exact sign-flip; Holm on H1–H3; flags; missingness bounds; ablations; costs (inference / curation / verification, amortization); six-criterion ratchet checklist | none |
| Real-model adapter (not run) | provider-returned model id, usage, request id, timeouts, explicit retry attempts, redaction, per-call worst-case pre-check, hard caps, kill switch, live gate | `budget-preflight.mjs` (shared $95 ledger), `env-value.mjs` |

## 3. Tests

| Suite | Result |
|---|---|
| New: `test-inheritance-001` (records, task language, split, oracle, verifier, snapshot gates, isolation, arms, leaks, spend gate) | 32 / 32 |
| New: `test-inheritance-001-analysis` (statistics, verdict rules, nulls/negatives, ratchet incl. a passing case, missingness, identity drift, reproducibility, tamper, report) | 13 / 13 |
| New: `test-inheritance-001-integration` (real Footprint handlers, admission ≠ verification, Blob namespace and write-once, no Blob write or network in a run) | 4 / 4 |
| Whole engine hermetic suite after the change | **462 / 462** (was 413 / 413) |
| Deploy gates (9) + dual-native | all green |
| Mutation checks (a guard deliberately broken, the test must fail) | The first round exposed two weak tests (verdicts for a registered simulation; a ratchet case with 5 of 6 criteria met). After they were strengthened, **13 of 14** broken guards are caught. Survivor: removing the explicit "a simulation never permits a ratchet claim" line, which another rule already blocks (a simulated H1 is never "supported") |
| **Not run:** any live model call; `smoke-response-envelope` and `check-surfaces` (no public surface changed); an ajv cross-check of the schemas |

The tests found and fixed three real defects during the build: a program step named `__proto__` or `constructor` crashed the
validator; the adapter could reach the verifier module through a shared helper; dated provider model ids (e.g. `…-20261101`) priced
as "unknown", so the guard would have refused every real call.

## 4. Demonstration

```bash
node scripts/inheritance-001/demo.mjs                 # → research/inheritance-001/examples/demo-positive-shared/
```

`plan.json`, `snapshot.json`, `trials.jsonl` (792 trials), `summary.json`, `REPORT.md`, `events.ndjson`, `artifacts.jsonl`,
`evaluations.jsonl`, and more. Byte-identical on every run (tested). `examples/demo-null-disjoint/` shows the same instrument reporting
a negative result, and `examples/instrument-validation/` runs every world over 20 seeds.

What the offline runs say **about the instrument** (not about any model):

- In the four worlds where inherited content cannot help (no transfer, harmful, scaffolding-only, inert), C never came out above the
  compute-matched A+: 0 of 80 runs. It was flagged worse in 100% of the no-transfer and harmful runs.
- In the world where it can help, C beat the cold arm and the placebo in 100% of seeds, but beat A+ in only 20%. Ten held-out
  families are too few. The demo's default seed is one of the detecting ones.
- With ~10 families the percentile bootstrap is somewhat anti-conservative (4–10% one-sided false alarms vs 2.5% nominal), so verdicts
  use the exact sign-flip p.

## 5. Improvements from the public Omnai / Claude exchange that are implemented

- **Verification as the pawl:** C admits only independently re-executed passes; D measures what a broken pawl costs; receipts scope
  themselves; curator admission is explicitly not verification.
- **A+ compute-matched:** C's extra context and its amortized curation cost become A+'s reasoning allowance, per block, documented.
- **E placebo:** really-verified, label-matched, volume-matched records from an unrelated domain.
- **Sealed held-out categories:** salted commitments, canaries, op-set-level hold-out, families drawn by secret seed.
- **Distinct families by provider-returned id**, generations with frozen snapshots, **leave-one-out ablations**, and the
  **verification-cost** ledger (CPU, model tokens, human minutes, dollars) with amortization horizons.
- **Omnai's correction:** a rising G(n) never certifies a ratchet. The six-criterion checklist is tested to refuse 5 of 6 and to pass when all hold.

## 6. Unproven, and assumptions that need experiment

- Everything about real models: whether any family benefits from another's verified work (H1–H3), at all.
- Whether verification bounds the ratchet (H4). There is one cheap verification regime so far.
- Real base rates and difficulty (ceiling or floor): needs the calibration probe.
- Real token use. The projection assumes 700 output tokens expected and 2000 maximum, and reasoning models may use the whole cap.
- That each provider's returned id names its family. Unknown ids are excluded, and dated ids are handled.
- That program-induction transfer says anything about prose, argument or the Omnarai corpus. It may not.
- That a mock search agent's failure modes resemble a model's. The worlds test the instrument's logic, not model psychology.

## 7. The smallest scientifically useful live pilot (`pilot/PILOT-BUDGET.md`)

- Stage 0: a calibration probe, arm A only, 32 calls on public families, worst case **$0.54**.
- Pilot: one transition. Producers `gpt-6.1-sol`, `deepseek-v4-pro`; consumers `claude-sonnet-5-5`, `grok-4.7`; 8 held-out families;
  **344 calls** (48 paired blocks × 6 arms + 56 producer calls). Expected **$3.20**, worst **$6.82** on first attempts, $13.64 if every
  call needed a retry. **Proposed caps: 720 calls, $10.**
- It yields descriptive estimates of C−A+, C−E, C−B, C−D on real providers, and real costs and base rates. It cannot confirm H1–H3
  (8 < 10 families) and cannot test a ratchet (one transition). Power at 8 families for a true +0.15 effect: about 40%.

### What must be approved before it runs (every one is checked by code)

1. xz's written approval naming the models, the call cap, the dollar cap and the exact plan hash (`approvals/TEMPLATE.json`).
2. A sealed family set drawn outside the repository (`lab.mjs draw-sealed`); xz holds the seed.
3. The filled preregistration committed **alone** and pushed to the public repo; its sha recorded in `registration.json`. That push
   is a publication, so it needs xz's OK.
4. Prices re-read from each provider on the day, and the `$10` reserved on the shared $95 ledger.
5. The command repeating the experiment id and both caps, with `OMNARAI_LAB_LIVE=1`.

Results of a live run stay private (written outside the repository) until reviewed. Nothing is promoted to the claims registry or the
corpus automatically.
