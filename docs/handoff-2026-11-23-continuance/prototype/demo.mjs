import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {deriveWorkPacket} from './work.mjs';import {buildSignals,pageSignals} from './signals.mjs';
import {makePrimary,readPrimary,makeInterpretation} from './representation.mjs';
import {planTrials,summarizePairedScores} from './inheritance.mjs';import {sha256Bytes} from './canonical.mjs';
const root=join(fileURLToPath(new URL('.',import.meta.url)),'..');
const fixture=async f=>JSON.parse(await readFile(join(root,'fixtures',f),'utf8'));
const problems=await fixture('demo-problems.json'),work=await fixture('demo-work.json');
const packet=deriveWorkPacket(problems[0],work.events,work.sources);
const signals=buildSignals([
  {source_id:'OMN-FP-DEMO-A',source_revision:'v1',kind:'admitted',occurred_at:'2026-11-23T00:00:00Z',public_scope:'footprint',visibility:'public',source_visibility:'public',reviewed:true},
  {source_id:'OMN-FP-PRIVATE',source_revision:'v1',kind:'admitted',occurred_at:'2026-11-23T00:02:00Z',public_scope:'footprint',visibility:'private',source_visibility:'private',reviewed:false},
  {source_id:'OMN-WORK-DEMO-01',source_revision:'v2',kind:'work_progress',occurred_at:'2026-11-23T00:03:00Z',public_scope:'work',visibility:'public',source_visibility:'public',reviewed:true},
]);
const primary=makePrimary({id:'OMN-EXPR-DEMO-01',text:' മലയാളം ∞ λ(x).x  中文\n',actor_declared:'synthetic-visitor',language_hint:'multiple'});
const interpretation=makeInterpretation({id:'OMN-INT-DEMO-01',primary,interpretation:'Multilingual sample with a lambda expression.',method:'illustrative human gloss, not verified translation',interpreter_declared:'synthetic-demo'});
const hash=s=>sha256Bytes(Buffer.from(s,'utf8'));
const task={id:'synthetic-task-01',family:'programming',public_prompt:'Find the parser bug in the supplied safe fixture.',sealed_answer:'sealed_solution_never_sent_43'};
const mk=s=>({task_id:task.id,content:`${s}: an untrusted prior note.`,sha256:hash(`${s}: an untrusted prior note.`),provider_model_id:'synthetic-provider-A-model1',provider_family:'synthetic-A',generation:1,model_released_at:'2026-07-01T00:00:00Z',produced_at:'2026-08-01T00:00:00Z'});
const verified=mk('validated');verified.verifier={result:'pass',independent:true,source_sha256:verified.sha256,verifier_id:'synthetic-verifier'};
const plan=planTrials({study_id:'OMN-STUDY-SYNTHETIC-001',tasks:[task],artifact_sets:{[task.id]:{verified,raw:mk('raw'),contaminated:mk('contaminated'),placebo:mk('unrelated')}} ,consumer:{provider_model_id:'synthetic-provider-B-model2',provider_family:'synthetic-B',generation:2,model_released_at:'2026-10-01T00:00:00Z',trial_started_at:'2026-11-23T00:00:00Z'},seed:20261123});
const scores={'A':.35,'A+':.55,B:.46,C:.71,D:.24,E:.54}; // ILLUSTRATIVE, assigned by hand, not model observations.
const summary=summarizePairedScores(plan,plan.trials.map(t=>({trial_id:t.trial_id,score:scores[t.arm],cost_usd:0})));
const out=join(root,'artifacts','demo');await mkdir(out,{recursive:true});
for (const [name,value] of Object.entries({'open-work-packet.json':packet,'signals-page.json':pageSignals(signals,{limit:10}),'expression-primary.json':primary,'expression-interpretation.json':interpretation,'inheritance-plan.json':plan,'inheritance-summary.json':summary})) {
 await writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
}
console.log('OFFLINE SYNTHETIC DEMO ONLY — zero network, zero provider calls, $0 paid spend');
console.log(`Work state: ${packet.progress_rung}; Signal events: ${signals.length}; Primary roundtrip: ${readPrimary(primary).length} code units`);
console.log(`Planned synthetic trials: ${plan.trials.length}; illustrative C - A+: ${summary.average_c_minus_a_plus}; not research evidence`);
console.log('Wrote illustrative outputs to artifacts/demo/');
