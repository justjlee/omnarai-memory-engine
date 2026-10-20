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
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

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
  const res = await fetch(source);
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
  const res = await fetch(`${base}/api/divergences`);
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

// 3. Not derivable from the manifest alone — said out loud, per the
//    project's own standard that unverifiable is a finding, not a pass.
check('hashes.corpus_seed', null, manifest.hashes?.corpus_seed);
check('hashes.footprint_state', null, manifest.hashes?.footprint_state);

console.log('');
console.log(`manifest generated_at: ${manifest.generated_at} · engine: ${manifest.engine_version}`);
console.log(`atlas live_records: ${manifest.counts.atlas.live_records} · corpus works: ${manifest.counts.corpus.total_works} · footprints admitted: ${manifest.counts.footprints?.admitted ?? manifest.domains?.footprints?.admitted ?? 'see domains.footprints'}`);
if (mismatches) { console.error(`\n${mismatches} MISMATCH(ES)`); process.exit(1); }
console.log('\nNo mismatches among recomputed hashes.');
