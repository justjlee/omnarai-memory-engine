import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, sha256, artifact, assertArtifact, snapshotFor, buildContext, pairedReport, ARMS, solveMock, gradeToy } from '../src/core.mjs';
import { contributions, tasksFor, poison } from '../src/fixtures.mjs';

const task = tasksFor(1)[0];
const snap = snapshotFor(contributions,1);
const build = arm=>buildContext({arm,task,generation:1,artifacts:contributions,snapshot:snap,poison});

test('canonical hash independent of object key order',()=> {
  assert.equal(canonical({z:1,a:{b:3,a:4}}),canonical({a:{a:4,b:3},z:1}));
  assert.equal(sha256({a:1,b:2}),sha256({b:2,a:1}));
});
test('tamper and independent-verifier conditions fail closed',()=> {
  const tampered={...contributions[0],body:'changed'};
  assert.throws(()=>assertArtifact(tampered),/ARTIFACT_INTEGRITY/);
  const selfVerified=artifact({...contributions[0],verification:{status:'passed',verifier_id:contributions[0].producer.model_id,evidence_id:'x'}});
  assert.throws(()=>assertArtifact(selfVerified),/VERIFICATION_NOT_INDEPENDENT/);
});
test('strict generation isolation',()=> {
  assert.ok(!snap.ids.some(x=>x.generation>=1));
  assert.ok(!snap.ids.some(x=>x.id==='LAB-ROT13-1'));
  const snap2=snapshotFor(contributions,2); assert.ok(snap2.ids.some(x=>x.id==='LAB-ROT13-1'));
});
test('snapshot invalidation catches mutation',()=> {
  const mutated=[...contributions,artifact({...contributions[0],id:'LAB-ALTERED-0'})];
  assert.throws(()=>buildContext({arm:'C',task,generation:1,artifacts:mutated,snapshot:snap}),/SNAPSHOT_MISMATCH/);
});
test('D contaminated, E unrelated, C verified, B raw, no-condition A/A+',()=> {
  assert.deepEqual(ARMS,['A','A+','B','C','D','E']);
  assert.equal(build('A').context.inherited.length,0);
  assert.equal(build('A+').context.inherited.length,0);
  assert.ok(build('B').context.inherited.length>=build('C').context.inherited.length);
  assert.ok(build('C').context.inherited.every(a=>a.evidence==='passed'));
  assert.ok(build('D').context.inherited.some(a=>a.id.startsWith('POISON-')));
  assert.ok(build('E').context.inherited.every(a=>a.method_key!==task.input.operation));
});
test('pending artifacts not treated as verified in C',()=> {
  const t=tasksFor(1).find(t=>t.family==='strings-rot13');
  const c=buildContext({arm:'C',task:t,generation:1,artifacts:contributions,snapshot:snap}).context;
  const b=buildContext({arm:'B',task:t,generation:1,artifacts:contributions,snapshot:snap}).context;
  assert.equal(c.inherited.length,0);assert.equal(b.inherited.length,1);
});
test('scripted toy response is independently graded and poisoning can harm',()=> {
  const good=build('C').context; const bad=build('D').context;
  assert.equal(gradeToy(task,solveMock(good)),1);
  assert.equal(gradeToy(task,solveMock(bad)),0);
});
test('parent links must exist and point to strictly earlier records',()=> {
  const ref=artifact({...contributions[0],id:'LAB-INVALID-1',generation:1,relations:['LAB-MISSING']});
  assert.throws(()=>snapshotFor([...contributions,ref],2),/INVALID_PARENT_EDGE/);
});
test('duplicate artifact IDs fail closed',()=> {
  assert.throws(()=>snapshotFor([...contributions,contributions[0]],1),/DUPLICATE_ARTIFACT/);
});
test('paired report flags duplicate trial assignment',()=> {
  const r={generation:1,task_id:'a',arm:'C',score:1,consumer:{model_id:'x'}};
  assert.throws(()=>pairedReport([r,r]),/DUPLICATE_TRIAL_BLOCK/);
  assert.equal(pairedReport([r,{...r,arm:'A+',score:0}])[0].mean_C_minus_A_plus,1);
});
