import { hashRecord, sha256Bytes } from './canonical.mjs';

export const ARMS=Object.freeze(['A','A+','B','C','D','E']);
const hashText=text=>sha256Bytes(Buffer.from(text,'utf8'));
function makeRng(seed) {let x=(seed>>>0)||1;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
function shuffle(items,seed){const out=[...items];const rng=makeRng(seed);for(let i=out.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
function eligible(task,artifact,consumer){
  if(!artifact||typeof artifact.content!=='string'||!artifact.provider_model_id||!consumer.provider_model_id||!artifact.provider_family||!consumer.provider_family) throw new Error('Provider identity missing');
  if(artifact.provider_family===consumer.provider_family) throw new Error('Same-family transfer is ineligible');
  // Generation numbers are STUDY-REGISTERED temporal cohorts, not vendor labels.
  // Real adapter must verify model release timestamps and exact provider-returned IDs.
  if(!Number.isInteger(artifact.generation)||!Number.isInteger(consumer.generation)||artifact.generation>=consumer.generation) throw new Error('Producer is not strictly a prior generation');
  const ar=Date.parse(artifact.model_released_at),cr=Date.parse(consumer.model_released_at),ap=Date.parse(artifact.produced_at),cs=Date.parse(consumer.trial_started_at);
  if(![ar,cr,ap,cs].every(Number.isFinite) || ar>=cr || ap>=cs) throw new Error('Unproven temporal precedence');
  if(artifact.task_id!==task.id||hashText(artifact.content)!==artifact.sha256) throw new Error('Artifact provenance/tamper mismatch');
}
function noOracleLeak(task,content) {
  if(!task.sealed_answer || task.sealed_answer.length<6) throw new Error('Missing robust sealed oracle');
  if(content.toLowerCase().includes(task.sealed_answer.toLowerCase())) throw new Error('Sealed oracle leaked into treatment');
  // Real harness MUST add semantic, substring, metadata, prompt/tool/log and embedding leaks gates.
}
/**
 * Offline planner only. Artifacts passed here are synthetic/test fixtures.
 * Does not make provider requests; not a scientific result.
 */
export function planTrials({study_id,tasks,artifact_sets,consumer,seed=20261123,max_tokens=512}) {
  if(!study_id||!Array.isArray(tasks)||!tasks.length||!Number.isInteger(seed)) throw new Error('Bad study');
  if(!Number.isInteger(max_tokens)||max_tokens<2) throw new Error('Bad compute ceiling');
  const baseline_tokens=Math.max(1, Math.floor(max_tokens/2));
  const trials=[];
  for(let ti=0;ti<tasks.length;ti++) {
    const task=tasks[ti],set=artifact_sets[task.id];
    if(!task||!set||!task.public_prompt||!task.sealed_answer) throw new Error('Missing task or treatments');
    const verified=set.verified;
    eligible(task,verified,consumer);
    if(!verified.verifier || verified.verifier.result!=='pass'||!verified.verifier.independent ||verified.verifier.source_sha256!==verified.sha256 || !verified.verifier.verifier_id) throw new Error('Unverified C artifact');
    for(const k of ['raw','contaminated','placebo']) {
      if(!set[k]) throw new Error('Missing treatment '+k);
      eligible(task,set[k],consumer);
    }
    for(const a of Object.values(set)) noOracleLeak(task,a.content);
    const treatment={A:null,'A+':null,B:set.raw,C:verified,D:set.contaminated,E:set.placebo};
    for(const [slot,arm] of shuffle(ARMS,seed+ti*7919).entries()) {
      const art=treatment[arm];
      const body={schema:'inheritance-trial/1.0',study_id,task_id:task.id,task_family:task.family,arm,
        consumer_provider_model_id:consumer.provider_model_id,consumer_family:consumer.provider_family,
        generation_consumer:consumer.generation,max_tokens:arm==='A'?baseline_tokens:max_tokens,
        prompt_sha256:hashText(task.public_prompt),status:'planned',slot,
        ...(art?{producer_provider_model_id:art.provider_model_id,producer_family:art.provider_family,
          generation_producer:art.generation,artifact_sha256:art.sha256}:{}),
        treatment_content:art?.content??null};
      // Planned trial records are sealed from the consumer and must not include hidden answer.
      trials.push({...body,trial_id:`trial_${hashRecord(body).slice(0,20)}`});
    }
  }
  return {schema:'inheritance-plan/1.0',study_id,seed,max_tokens,baseline_tokens,
    distinct_tasks:tasks.length,arms:ARMS,trials,plan_sha256:hashRecord(trials)};
}
export function summarizePairedScores(plan, outcomes) {
  const outcomeMap=new Map(outcomes.map(o=>[o.trial_id,o]));
  if(outcomeMap.size!==outcomes.length) throw new Error('Duplicate outcome');
  const groups=new Map();
  for(const t of plan.trials) {
    if(!groups.has(t.task_id))groups.set(t.task_id,new Map());
    const o=outcomeMap.get(t.trial_id);
    if(!o) continue;
    if(typeof o.score!=='number'||!Number.isFinite(o.score)||o.score<0||o.score>1) throw new Error('Invalid score');
    groups.get(t.task_id).set(t.arm,{score:o.score,cost_usd:o.cost_usd??null});
  }
  const rows=[];
  for(const [task_id,arms] of groups) {
    const c=arms.get('C'),ap=arms.get('A+');
    const cost=(a)=>arms.get(a)?.cost_usd;
    rows.push({task_id,complete:ARMS.every(a=>arms.has(a)),
      c_minus_a_plus_cost_usd:typeof cost('C')==='number'&&typeof cost('A+')==='number'?Number((cost('C')-cost('A+')).toFixed(6)):null,
      c_vs_compute_matched: c&&ap?Number((c.score-ap.score).toFixed(6)):null,
      negative_transfer:c&&ap?c.score<ap.score:null, placebo_vs_compute_matched:arms.has('E')&&ap?Number((arms.get('E').score-ap.score).toFixed(6)):null});
  }
  const d=rows.map(x=>x.c_vs_compute_matched).filter(x=>x!==null);
  return {schema:'inheritance-summary/1.0',study_id:plan.study_id,paired_tasks:d.length,total_tasks:rows.length,
    average_c_minus_a_plus:d.length?Number((d.reduce((a,b)=>a+b,0)/d.length).toFixed(6)):null,
    negative_transfer_tasks:rows.filter(x=>x.negative_transfer===true).length,rows,
    caveat:'DESCRIPTIVE MOCK ONLY. Not a confidence interval, causal claim, or evidence of cumulative intelligence.'};
}

// Descriptive paired bootstrap. Research analyst must freeze resampling unit,
// strata, estimator and interval before real outcomes; do not use trial-level
// bootstrap when repeated samples share the same problem, source or consumer.
export function bootstrapPairedGain(perTaskDifferences,{seed=20261123,repetitions=2000,alpha=.05}={}) {
  if(perTaskDifferences.length<2) return {interval:null,reason:'need >=2 independent task clusters'};
  if(!perTaskDifferences.every(Number.isFinite)||!Number.isInteger(repetitions)||repetitions<100||alpha<=0||alpha>=1) throw new Error('Invalid bootstrap input');
  const rng=makeRng(seed), n=perTaskDifferences.length, means=[];
  for(let j=0;j<repetitions;j++) {let total=0;for(let k=0;k<n;k++)total+=perTaskDifferences[Math.floor(rng()*n)];means.push(total/n);}
  means.sort((a,b)=>a-b);
  return {interval:[means[Math.floor((alpha/2)*repetitions)],means[Math.min(repetitions-1,Math.ceil((1-alpha/2)*repetitions)-1)]].map(x=>Number(x.toFixed(6))),
    method:'descriptive paired task-cluster bootstrap reference, not a preregistered real-study CI',repetitions,alpha};
}

/** Paired leave-one-source-out contribution value: a lower score on ablation is
 * suggestive, not conclusive. Cost/retrieval drift must also be held fixed. */
export function compareSourceAblation({full,without_source,source_id}) {
  if(!source_id||!Array.isArray(full)||!Array.isArray(without_source)) throw new Error('Invalid ablation');
  const a=new Map(without_source.map(x=>[x.task_id,x.score]));
  const out=[];
  for (const f of full) if (a.has(f.task_id)) {
    if(![f.score,a.get(f.task_id)].every(x=>typeof x==='number'&&x>=0&&x<=1))throw new Error('Invalid ablation score');
    out.push({task_id:f.task_id,full_minus_ablation:Number((f.score-a.get(f.task_id)).toFixed(6))});
  }
  return {source_id,paired_tasks:out.length,rows:out,interpretation:'Within-fixture ablation; do not infer unique causal contribution without leakage and correlation controls'};
}
