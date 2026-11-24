import { createHash } from 'node:crypto';

// Offline reference only. No floats requiring JCS canonical-number semantics;
// use a formal JSON Canonicalization Scheme implementation in production.
export function stableJson(value) {
  const walk = (v, seen) => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object') throw new TypeError('Unsupported canonical value');
    if (seen.has(v)) throw new TypeError('Cyclic object');
    seen.add(v);
    let out;
    if (Array.isArray(v)) out = `[${v.map(x => walk(x, seen)).join(',')}]`;
    else if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) {
      out = `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${walk(v[k], seen)}`).join(',')}}`;
    } else throw new TypeError('Only plain JSON objects supported');
    seen.delete(v);
    return out;
  };
  return walk(value, new WeakSet());
}
export const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const hashRecord = (data) => sha256Bytes(Buffer.from(stableJson(data), 'utf8'));
export function assertHash(data, expected) {
  if (hashRecord(data) !== expected) throw new Error('Integrity check failed');
  return true;
}
