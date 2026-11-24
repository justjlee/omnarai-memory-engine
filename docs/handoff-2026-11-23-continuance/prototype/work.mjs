import { hashRecord } from './canonical.mjs';

const KINDS = new Set(['attempt_recorded','advance_claimed','advance_tested','advance_reviewed','advance_refuted','superseded','reopened']);

/**
 * Derives a public work packet from a REGISTERED problem, admitted source records,
 * and PUBLIC reviewed progress events. Not a write path; not a production adapter.
 * Caller must supply a complete, consistent source snapshot.
 */
export function deriveWorkPacket(problem, events, admittedSources) {
  if (problem?.schema !== 'work-problem/1.0' || problem.visibility !== 'public') throw new Error('Problem not public');
  if (!problem.id || !Array.isArray(problem.acceptance_criteria)) throw new Error('Invalid problem');
  const srcs = new Map(admittedSources.filter(s => s.visibility === 'public' && s.moderation === 'admitted')
    .map(s => [s.id, s]));
  const accepted = events
    .filter(e => e.visibility === 'public' && e.moderation === 'admitted' && e.problem_id === problem.id)
    .sort((a,b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  let rung = 'registered';
  const issues=[];const steps=[];const claims=new Map();
  for(const e of accepted) {
    if (!KINDS.has(e.kind)) { issues.push({id:e.id,reason:'unrecognized-kind'}); continue; }
    const source=srcs.get(e.source_id);
    if (!source || source.sha256 !== e.source_sha256) {issues.push({id:e.id,reason:'missing-or-mismatched-public-source'});continue;}
    if(e.kind === 'attempt_recorded') {rung='attempted';steps.push({event_id:e.id,kind:e.kind,source_id:e.source_id});continue;}
    if(e.kind === 'advance_claimed') {claims.set(e.id,{source_id:e.source_id,sha256:e.source_sha256,author:e.author_declared});rung='claimed';steps.push({event_id:e.id,kind:e.kind,source_id:e.source_id});continue;}
    if(e.kind === 'advance_tested') {
      const c=claims.get(e.claim_event_id);
      if(!c || !e.verifier_receipt?.independent || e.verifier_receipt.result !== 'pass' || e.verifier_receipt.source_sha256 !== c.sha256 || !e.verifier_receipt.verifier_id) {
        issues.push({id:e.id,reason:'unverifiable-test'}); continue;
      }
      rung='tested';steps.push({event_id:e.id,kind:e.kind,source_id:e.source_id,claim_event_id:e.claim_event_id,receipt_id:e.verifier_receipt.receipt_id});continue;
    }
    if(e.kind === 'advance_reviewed') {
      const c=claims.get(e.claim_event_id);
      if(!c || !steps.some(x=>x.kind === 'advance_tested' && x.claim_event_id===e.claim_event_id) || !e.review?.independent || e.review.decision !== 'accept' || e.review.reviewer_id === c.author) {
        issues.push({id:e.id,reason:'missing-independent-review'});continue;
      }
      rung='reviewed';steps.push({event_id:e.id,kind:e.kind,source_id:e.source_id,claim_event_id:e.claim_event_id});continue;
    }
    if(e.kind==='advance_refuted') {rung='refuted';steps.push({event_id:e.id,kind:e.kind,source_id:e.source_id});continue;}
    if(e.kind==='reopened') {rung='open';steps.push({event_id:e.id,kind:e.kind,source_id:e.source_id});continue;}
    steps.push({event_id:e.id,kind:e.kind,source_id:e.source_id});
  }
  const packet={schema:'work-packet/1.0',problem_id:problem.id,title:problem.title,objective:problem.objective,
    acceptance_criteria:problem.acceptance_criteria,open_questions:problem.open_questions||[],
    failed_attempts:problem.failed_attempts||[],source_refs:problem.source_refs?.filter(id=>srcs.has(id))||[],
    progress_rung:rung,steps,issues};
  return {...packet,snapshot_sha256:hashRecord(packet)};
}
