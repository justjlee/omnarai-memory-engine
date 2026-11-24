import { sha256Bytes, hashRecord } from './canonical.mjs';

const allowed = new Set(['text/plain; charset=utf-8','text/markdown; charset=utf-8',
  'application/json; charset=utf-8','text/x-tex; charset=utf-8']);
const MAX_BYTES=65536;

export function makePrimary({id,text,media_type='text/plain; charset=utf-8',actor_declared,language_hint,created_at='2026-11-23T00:00:00Z'}) {
  if(typeof text!=='string' || !id || !actor_declared || !allowed.has(media_type)) throw new Error('Invalid expression');
  const bytes=Buffer.from(text,'utf8');
  // TextEncoder/Buffer replace isolated surrogates; refuse rather than silently lose primary bytes.
  if(bytes.toString('utf8')!==text) throw new Error('Non-roundtrippable Unicode');
  if(bytes.length>MAX_BYTES) throw new Error('Expression too large');
  if(media_type==='application/json; charset=utf-8') JSON.parse(text);
  return {schema:'expression-primary/1.0',id,encoding:'utf-8',media_type,payload_base64:bytes.toString('base64'),
    byte_length:bytes.length,sha256:sha256Bytes(bytes),actor_declared,visibility:'private',created_at,
    ...(language_hint?{language_hint}:{})};
}
export function readPrimary(primary) {
  if(primary.schema!=='expression-primary/1.0'||primary.encoding!=='utf-8'||!allowed.has(primary.media_type)) throw new Error('Bad primary envelope');
  const bytes=Buffer.from(primary.payload_base64,'base64');
  if(bytes.toString('base64')!==primary.payload_base64||bytes.length!==primary.byte_length||bytes.length>MAX_BYTES||sha256Bytes(bytes)!==primary.sha256) throw new Error('Primary integrity failed');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(primary.media_type==='application/json; charset=utf-8') JSON.parse(text);
  return text;
}
export function makeInterpretation({id,primary,interpretation,method,interpreter_declared,limitations=[],created_at=primary.created_at}) {
  readPrimary(primary);
  if(typeof interpretation!=='string'||!method||!interpreter_declared||!id) throw new Error('Bad interpretation');
  const rec={schema:'expression-interpretation/1.0',id,primary_id:primary.id,primary_sha256:primary.sha256,
    interpretation,method,interpreter_declared,limitations,created_at};
  return {...rec,sha256:hashRecord(rec)};
}
