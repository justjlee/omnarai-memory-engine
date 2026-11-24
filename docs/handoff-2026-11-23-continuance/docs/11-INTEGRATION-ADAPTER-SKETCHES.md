# 11 · Source-aware integration sketches (adapt, do not paste blindly)

These are integration directions, not ready-to-merge patches. Claude Code must read the exact live code and tests. The 12-function Vercel Hobby cap makes a separate `api/problems.js` file potentially incompatible with deployment. Fold read handlers into an existing entry function through the established rewrite pattern when appropriate.

## Existing source seams

- `api/_protocol.js`: pure question/position/inheritance projection and relationship chain resolution.
- `api/_footprints.js`: append-only Footprints and moderation state; expose only admitted projections.
- `api/_blob.js` / `_storage-classes.js`: single store router. Never write directly to Vercel Blob from new subsystems without classification. Avoid using `memory/grown.json` for research runs or work decision records.
- `api/_response-envelope.js`: single response-provenance table and documented limitations. New read routes should not invent their own incompatible envelope.
- `api/council.js` and `vercel.json`: route folding per README/actual current source; inspect rewrite handlers before modifying.
- `omnarai-mcp`'s shared `contract.js`: ensure exact name, mode, safety annotations and parity gates when adding tools.
- `scripts/lib/register-mem-blob.mjs` and `scripts/local-engine.mjs`: isolated test harness to adapt for real handler-level tests.

## A read handler concept for Work packets

```js
// ADAPTER SKETCH ONLY: resolve data using EXISTING trusted repository modules.
async function readWorkPacket(id, viewer) {
  const problem = await registeredProblems.getPublicVersion(id); // curator-registered, immutable
  if (!problem) return notFound();
  const admittedSources = await footprintStore.readAdmittedSources(problem.source_refs);
  const reviewedWorkEvents = await workStore.readPublishedEvents(problem.id);
  // Filter before projection; no pending IDs or counts reach derivative fields.
  const packet = deriveWorkPacket(problem, reviewedWorkEvents, admittedSources);
  return withOmnaraiResponseEnvelope(packet, {kind:'work_packet', basis:await manifestBasis()});
}
```

**Implementation obligations:** adapt actual envelope `KINDS`, `ENVELOPE_COVERAGE`, OpenAPI and MCP, or label new routes *uncovered* until the same trust and manifest facts travel with them. Do not invent unknown classes or claim these pseudocode helpers already exist.

## Curator registry sketch

```js
// A registrar, not a publicly writable problem creation path.
// new problem body must be immutable; future updates are new revision events.
await appendProblemEvent({
  schema:'work-problem/1.0',
  id:'OMN-WORK-...',
  title:'...', objective:'...', acceptance_criteria:['...'],
  source_refs:['OMN-FP-...'],visibility:'private',
  provenance:{registered_by:'curator',registered_at:new Date().toISOString(),source_revision:'v1'}
});
// Publication is a separate authorized decision after review.
```

Never auto-admit `claimed`, `tested`, or `reviewed` based merely on type. Prefer to link these decisions to the existing Footprint review vocabulary; if a new decision kind is necessary, version it explicitly.

## Signals projection sketch

```js
const authoritativePublishedTransitions = await readPublicAdmissionAndRevisionEvents();
const events = buildSignals(authoritativePublishedTransitions);
const result = pageSignals(events,{cursor:req.query.since,limit:Math.min(100,Number(req.query.limit)||25)});
```

Production needs durable, incremental projection/compaction to avoid listing the entire corpus per request and must include a source-snapshot watermark, missed-event reconciliation, and retraction policy. Current reference prototype proves only deterministic projection and cursor mechanics over an in-memory array, not end-to-end event delivery.

## Scientific controller boundary

```js
// The consumer may see ONLY task.public_prompt and arm-specific treatment.
const plan = planTrials({study_id,tasks,artifact_sets,consumer,seed,max_tokens});
await saveImmutableStudyPlanAndSeal(plan); // private, cannot alter after frozen
// PAID RUN DISABLED by default. Use an adapter created only after approval:
// for (const trial of plan.trials) await approvedProviderAdapter.run(trial);
// Never pass task.sealed_answer to the provider or its retrieval/tool context.
```

For production, use cryptographically attested task/producer snapshots, exact provider-returned IDs, independent verifiers, and frozen cost caps. A local JavaScript object with `verifier.independent=true` is an offline test shape, **not authentication or verification**.

## Front door

The public `omnarai.org` front door is reported hand-deployed outside the engine repo. Do not assume edits to `src/` deploy a new Instrument door. Propose an `/work` interface only after the real read route and one independently replayed handoff meet gate, then arrange separate front-door owner approval and smoke tests.
