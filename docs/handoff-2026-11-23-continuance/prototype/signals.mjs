import { hashRecord } from './canonical.mjs';

const publicKinds=new Set(['admitted','claim_status_changed','certification_changed','work_progress','retracted','redacted','published']);
const scopes=new Set(['footprint','claim','divergence','work','voice']);

/** Project ONLY authoritative PUBLIC transitions into redacted event records.
 * It does not create a subscription, enqueue a message, or store data.
 */
export function buildSignals(transitions) {
  const result=new Map();
  for(const e of transitions) {
    if(e.visibility!=='public' || e.source_visibility!=='public' || !e.reviewed || !publicKinds.has(e.kind) || !scopes.has(e.public_scope)) continue;
    const basic={schema:'signals-change/1.0',source_id:e.source_id,source_revision:e.source_revision,
      kind:e.kind,occurred_at:e.occurred_at,public_scope:e.public_scope};
    // Only primitive allowlisted fields; no source body, identity, receipt, token or metadata leaks.
    const event_id=`sig_${hashRecord(basic).slice(0,32)}`;
    result.set(event_id,{...basic,event_id});
  }
  return [...result.values()].sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)||a.event_id.localeCompare(b.event_id));
}
const cursorFor = e => Buffer.from(`${e.occurred_at}|${e.event_id}`,'utf8').toString('base64url');
const parseCursor = c => {
  if(!c) return null;
  try {
    const v=Buffer.from(c,'base64url').toString('utf8');
    const p=v.lastIndexOf('|');
    if(p<0 || !/^sig_[0-9a-f]{32}$/.test(v.slice(p+1)) || !Number.isFinite(Date.parse(v.slice(0,p)))) throw Error();
    return {occurred_at:v.slice(0,p), event_id:v.slice(p+1)};
  } catch {throw new Error('Invalid cursor');}
};
export function pageSignals(events,{cursor=null,limit=10}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100) throw new RangeError('limit must be 1..100');
  const after=parseCursor(cursor);
  const filtered=events.filter(e => !after || e.occurred_at>after.occurred_at || (e.occurred_at===after.occurred_at && e.event_id>after.event_id));
  const page=filtered.slice(0,limit);
  return {schema:'signals-page/1.0',events:page,next_cursor:page.length?cursorFor(page.at(-1)):cursor,
    has_more:filtered.length>page.length};
}
