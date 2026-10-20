#!/usr/bin/env node
/**
 * verify-manifest.mjs — independently recompute the Omnarai manifest hashes.
 *
 * Part of the Omnarai handoff package (Muse, 2026-10-14). The engine's
 * consistency contract says public surfaces quote /api/manifest and never
 * compute their own counts; this script is the other side of that contract —
 * anyone can check the manifest against its own stated basis, using the
 * recomputation method the manifest itself publishes:
 *
 *   hashes.manifest    = sha256(canonical JSON of `counts`)
 *   hashes.atlas_state = sha256(canonical JSON of {updated_at, ids: sorted
 *                        live Atlas record ids})
 *   canonical JSON     = keys recursively sorted, no whitespace
 *
 * Usage:
 *   node verify-manifest.mjs [url-or-file]   (default: live manifest URL)
 *
 * corpus_seed and footprint_state require source artifacts not derivable
 * from the manifest alone; they are reported as NOT RECOMPUTED, never
 * silently passed. Exit code is non-zero only on an actual MISMATCH.
 * Dependencies: none (Node >= 18, global fetch).
 *
 * Extended 2026-10-20 by Claude Code (Anthropic), in the repository copy
 * (governance/code/); the original is the previous commit. Both remaining
 * hashes turned out to be recomputable from public endpoints, so they are
 * now checked rather than skipped:
 *   hashes.corpus_seed     = sha256 of the raw bytes of /data/corpus.json
 *   hashes.footprint_state = sha256(canonical JSON of [[id, content_sha256], …]
 *                            over admitted footprints sorted by id), read from
 *                            /api/footprints. If the listing cannot return every
 *                            admitted footprint in one page, the hash is reported
 *                            NOT RECOMPUTED and the reason is given.
 * OMNARAI_SELF=1 sends x-omnarai-self, so the curator's own checks are not
 * counted as visitor traffic. A stranger running this should leave it unset.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const fetchInit = process.env.OMNARAI_SELF === '1' ? { headers: { 'x-omnarai-self': '1' } } : {};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const source = process.argv[2] ?? 'https://engine.omnarai.org/api/manifest';
let manifest;
if (/^https?:\/\//.test(source)) {
  const res = await fetch(source, fetchInit);
  if (!res.ok) { console.error(`fetch failed: ${res.status} ${source}`); process.exit(2); }
  manifest = await res.json();
} else {
  manifest = JSON.parse(readFileSync(source, 'utf8'));
}

let mismatches = 0;
const check = (name, computed, expected) => {
  if (computed === null) { console.log(`NOT RECOMPUTED  ${name} — needs source artifact beyond the manifest`); return; }
  const ok = computed === expected;
  if (!ok) mismatches++;
  console.log(`${ok ? 'VERIFIED       ' : 'MISMATCH       '} ${name}`);
  if (!ok) console.log(`  expected ${expected}\n  computed ${computed}`);
};

// 1. manifest hash over counts — fully recomputable from the manifest itself.
check('hashes.manifest', sha256(canonical(manifest.counts)), manifest.hashes?.manifest);

// 2. atlas_state — recomputable if the live record id list is fetchable.
let atlasComputed = null;
try {
  const base = source.startsWith('http') ? new URL(source).origin : 'https://engine.omnarai.org';
  const res = await fetch(`${base}/api/divergences`, fetchInit);
  if (res.ok) {
    const data = await res.json();
    const records = Array.isArray(data) ? data : data.records ?? data.results ?? [];
    const ids = records.map((r) => r.id).filter(Boolean).sort();
    if (ids.length) {
      atlasComputed = sha256(canonical({ updated_at: manifest.counts.atlas.store_updated_at, ids }));
    }
  }
} catch { /* leave null: reported as not recomputed, with the reason below */ }
check('hashes.atlas_state', atlasComputed, manifest.hashes?.atlas_state);
if (atlasComputed === null) console.log('  (id list not derivable from /api/divergences response shape — check the endpoint and extend this script)');

// 3. Not derivable from the manifest alone, but derivable from the public
//    artifacts it names. Anything that cannot be fetched whole is still said
//    out loud as NOT RECOMPUTED, never passed.
const base3 = source.startsWith('http') ? new URL(source).origin : 'https://engine.omnarai.org';
let seedComputed = null;
try {
  const res = await fetch(`${base3}/data/corpus.json`, fetchInit);
  if (res.ok) seedComputed = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
} catch { /* leave null */ }
check('hashes.corpus_seed', seedComputed, manifest.hashes?.corpus_seed);

let fpComputed = null, fpWhy = 'footprint listing unreachable';
try {
  const res = await fetch(`${base3}/api/footprints?limit=100`, fetchInit);
  if (res.ok) {
    const data = await res.json();
    const rows = data.footprints ?? [];
    if (typeof data.total_admitted === 'number' && rows.length < data.total_admitted) {
      fpWhy = `listing returned ${rows.length} of ${data.total_admitted} admitted footprints (one page) — extend this script to page`;
    } else {
      const pairs = rows.map((f) => [f.id, f.integrity?.content_sha256]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      fpComputed = sha256(canonical(pairs));
    }
  }
} catch { /* leave null */ }
check('hashes.footprint_state', fpComputed, manifest.hashes?.footprint_state);
if (fpComputed === null) console.log(`  (${fpWhy})`);

console.log('');
console.log(`manifest generated_at: ${manifest.generated_at} · engine: ${manifest.engine_version}`);
console.log(`atlas live_records: ${manifest.counts.atlas.live_records} · corpus works: ${manifest.counts.corpus.total_works} · footprints admitted: ${manifest.counts.footprints?.admitted ?? manifest.domains?.footprints?.admitted ?? 'see domains.footprints'}`);
if (mismatches) { console.error(`\n${mismatches} MISMATCH(ES)`); process.exit(1); }
console.log('\nNo mismatches among recomputed hashes.');
