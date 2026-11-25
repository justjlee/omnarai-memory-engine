import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS, sha256, snapshotFor, buildContext, solveMock, gradeToy, pairedReport } from './core.mjs';
import { contributions, tasksFor, consumers, poison } from './fixtures.mjs';

const out = fileURLToPath(new URL('../out/', import.meta.url));
await mkdir(out, { recursive: true });
const trials = [], snapshots=[];
for (const generation of [1,2]) {
  const snapshot = snapshotFor(contributions, generation);
  snapshots.push(snapshot);
  for (const task of tasksFor(generation)) for (const consumer of consumers) for (const arm of ARMS) {
    const {context,digest,context_token_estimate} = buildContext({arm,task,generation,artifacts:contributions,snapshot,poison});
    const output = solveMock(context);
    const score = gradeToy(task,output);
    trials.push({schema_version:'omnarai.inheritance-trial/0.1-draft', study_id:'TOY-DEMO-NOT-SCIENCE',
      trial_id:`TOY-${sha256([generation,task.id,consumer.model_id,arm]).slice(0,16)}`,
      generation,task_id:task.id,task_family:task.family,consumer,arm,snapshot_sha256:snapshot.sha256,
      context_sha256:digest,outcome:score?'pass':'fail',score,simulation:true,
      usage:{estimated_context_tokens:context_token_estimate,billable_model_calls:0,estimated_usd:0},
      provenance:{solver:'scripted-toy-mock-v0',oracle:'deterministic-toy-oracle-v0'} });
  }
}
const report={ protocol:'omnarai.inheritance-study/0.1-draft', study_id:'TOY-DEMO-NOT-SCIENCE',
  status:'offline_simulation',simulation:true, comparisons:pairedReport(trials),
  arm_means:Object.fromEntries(ARMS.map(a=>[a, trials.filter(t=>t.arm===a).reduce((s,t)=>s+t.score,0)/trials.filter(t=>t.arm===a).length])),
  trials:trials.length,
  limitations:[
    'All participants, contributions, and outcomes are scripted fixtures, not actual AI systems.',
    'No causal claims, genuine held-out categories, calibrated generation difficulty, or verified model identities.',
    'No real compute-matched A+ treatment; measured cost is mock $0.',
    'Confidence intervals treat task instances as exchangeable and are illustrative only; real study must cluster by task family.',
    'Any positive difference is intentionally created by the mock fixture, never experimental evidence.'
  ]};
const plan={ study_id:report.study_id, arms:ARMS, generations:[1,2], consumers,
  randomized_assignment:false, paid_calls_enabled:false, task_fixture_kind:'public_toystore',
  note:'This file is a scripted mechanics demonstration, NOT a pre-registered model experiment.'};
await writeFile(join(out,'plan.json'),JSON.stringify(plan,null,2)+'\n');
await writeFile(join(out,'snapshot.json'),JSON.stringify(snapshots,null,2)+'\n');
await writeFile(join(out,'trials.jsonl'),trials.map(t=>JSON.stringify(t)).join('\n')+'\n');
await writeFile(join(out,'summary.json'),JSON.stringify(report,null,2)+'\n');
const table=report.comparisons.map(r=>`| ${r.generation} | ${r.n_pairs} | ${r.mean_C_minus_A_plus?.toFixed(3)} | [${r.ci_low?.toFixed(3)}, ${r.ci_high?.toFixed(3)}] |`).join('\n');
await writeFile(join(out,'REPORT.md'),`# Mock mechanics demonstration — NOT SCIENTIFIC EVIDENCE\n\n**Status:** offline_simulation. **Spend:** $0. **Total scripted trials:** ${trials.length}.\n\n| Generation | Scripted task/model pairs | Mean C−A+ (scripted) | Toy CI (not valid for research) |\n|---|---:|---:|---|\n${table}\n\nThe toy solver has been deliberately coded to recognize selected inherited strategy strings. Positive or negative deltas are artifacts of our fixture design. Do not publish these values as evidence. The real study requires preregistration, true provider models, held-out task-family oracles, cost matching, and cluster-level uncertainty.\n`);
console.log(`Generated ${trials.length} zero-cost scripted trials. All outputs in ${out}. NOT SCIENTIFIC EVIDENCE.`);
