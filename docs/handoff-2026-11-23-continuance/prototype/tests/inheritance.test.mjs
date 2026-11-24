import test from 'node:test';import assert from 'node:assert/strict';
import {planTrials,summarizePairedScores,ARMS} from '../inheritance.mjs';
import {sha256Bytes} from '../canonical.mjs';
const hash=s=>sha256Bytes(Buffer.from(s));
const task={id:'T-1',family:'programming',public_prompt:'Find the bug, without assuming any predecessor is correct.',sealed_answer:'needle_answer_829'};
const consumer={provider_model_id:'provider:familyB:model9',provider_family:'B',generation:9,model_released_at:'2026-10-01T00:00:00Z',trial_started_at:'2026-11-23T00:00:00Z'};
function art(kind,extra={}){const content=`Synthetic ${kind} insight; may be useful or useless.`;return {task_id:task.id,content,sha256:hash(content),provider_model_id:'provider:familyA:model8',provider_family:'A',generation:8,model_released_at:'2026-08-01T00:00:00Z',produced_at:'2026-09-01T00:00:00Z',...extra};}
function inputs(){const verified=art('verified');verified.verifier={result:'pass',independent:true,source_sha256:verified.sha256,verifier_id:'objective-checker'};return {study_id:'001',tasks:[task],artifact_sets:{'T-1':{verified,raw:art('raw'),contaminated:art('poison'),placebo:art('placebo')}},consumer:{...consumer},seed:12};}
test('six arms generated exactly once for one task',()=>{const p=planTrials(inputs());assert.equal(p.trials.length,6);assert.deepEqual(p.trials.map(t=>t.arm).sort(),[...ARMS].sort());});
test('same seed gives identical plan, different seed changes order',()=>{const p=planTrials(inputs());assert.deepEqual(p,planTrials(inputs()));assert.notDeepEqual(p.trials.map(x=>x.arm),planTrials({...inputs(),seed:3}).trials.map(x=>x.arm))});
test('snapshot not leaked into any consumer trial',()=>{const p=planTrials(inputs());assert.doesNotMatch(JSON.stringify(p),/needle_answer_829/)});
test('provider family cannot equal consumer',()=>{const p=inputs();p.artifact_sets['T-1'].verified.provider_family='B';assert.throws(()=>planTrials(p),/Same-family/)});
test('prior generation is mandatory',()=>{const p=inputs();p.artifact_sets['T-1'].raw.generation=9;assert.throws(()=>planTrials(p),/prior generation/)});
test('unknown real provider identity cannot be guessed',()=>{const p=inputs();delete p.consumer.provider_model_id;assert.throws(()=>planTrials(p),/Provider identity/)});
test('unverified C artifact cannot pass',()=>{const p=inputs();p.artifact_sets['T-1'].verified.verifier.independent=false;assert.throws(()=>planTrials(p),/Unverified C/)});
test('verification receipt must match exact hash',()=>{const p=inputs();p.artifact_sets['T-1'].verified.verifier.source_sha256='f'.repeat(64);assert.throws(()=>planTrials(p),/Unverified C/)});
test('tampering with any treatment is rejected',()=>{const p=inputs();p.artifact_sets['T-1'].raw.content+=' mutate';assert.throws(()=>planTrials(p),/tamper/)});
test('literal oracle leakage is blocked',()=>{const p=inputs();const x=p.artifact_sets['T-1'].raw;x.content+=` ${task.sealed_answer}`;x.sha256=hash(x.content);assert.throws(()=>planTrials(p),/oracle leaked/)});
test('outcome quality reported relative to A+ not A',()=>{const p=planTrials(inputs());const scores={A:.3,'A+':.6,B:.4,C:.8,D:.1,E:.6};const r=summarizePairedScores(p,p.trials.map(t=>({trial_id:t.trial_id,score:scores[t.arm]})));assert.equal(r.average_c_minus_a_plus,.2);assert.equal(r.negative_transfer_tasks,0);assert.equal(r.rows[0].placebo_vs_compute_matched,0)});
test('negative transfer is not hidden',()=>{const p=planTrials(inputs());const scores={A:.3,'A+':.8,B:.4,C:.5,D:.1,E:.6};const r=summarizePairedScores(p,p.trials.map(t=>({trial_id:t.trial_id,score:scores[t.arm]})));assert.equal(r.average_c_minus_a_plus,-.3);assert.equal(r.negative_transfer_tasks,1)});
test('missing arm yields null, not fake zero',()=>{const p=planTrials(inputs());const r=summarizePairedScores(p,p.trials.filter(t=>t.arm==='C').map(t=>({trial_id:t.trial_id,score:1})));assert.equal(r.average_c_minus_a_plus,null);assert.equal(r.rows[0].complete,false)});
test('duplicate outcome fails',()=>{const p=planTrials(inputs());const id=p.trials[0].trial_id;assert.throws(()=>summarizePairedScores(p,[{trial_id:id,score:1},{trial_id:id,score:0}]),/Duplicate/)});
test('no paid provider operation exists in reference planner',()=>{const p=planTrials(inputs());assert.equal(p.trials.every(t=>t.status==='planned'),true)});

test('release chronology must precede consumer regardless of cohort label',()=>{const p=inputs();p.artifact_sets['T-1'].raw.model_released_at='2026-12-01T00:00:00Z';assert.throws(()=>planTrials(p),/temporal precedence/)});
test('artifact must exist before consumer starts',()=>{const p=inputs();p.artifact_sets['T-1'].raw.produced_at='2026-12-01T00:00:00Z';assert.throws(()=>planTrials(p),/temporal precedence/)});
test('A baseline gets fewer tokens than compute-matched A+ and C',()=>{const p=planTrials(inputs());const a=p.trials.find(x=>x.arm==='A'),ap=p.trials.find(x=>x.arm==='A+'),c=p.trials.find(x=>x.arm==='C');assert.ok(a.max_tokens<ap.max_tokens);assert.equal(ap.max_tokens,c.max_tokens)});
import {bootstrapPairedGain,compareSourceAblation} from '../inheritance.mjs';
test('paired bootstrap is deterministic for predeclared clusters',()=>{const a=bootstrapPairedGain([.1,.2,-.1,.3],{seed:42,repetitions:1000});assert.deepEqual(a,bootstrapPairedGain([.1,.2,-.1,.3],{seed:42,repetitions:1000}));assert.equal(a.interval.length,2)});
test('bootstrap does not invent interval for single task',()=>{assert.equal(bootstrapPairedGain([.1]).interval,null)});
test('source ablation reports negative or positive marginal value',()=>{const r=compareSourceAblation({source_id:'src-1',full:[{task_id:'a',score:.9},{task_id:'b',score:.2}],without_source:[{task_id:'a',score:.6},{task_id:'b',score:.4}]});assert.equal(r.rows[0].full_minus_ablation,.3);assert.equal(r.rows[1].full_minus_ablation,-.2)});
