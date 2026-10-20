#!/usr/bin/env node
/**
 * precommit.mjs — freeze a falsifier before computation; verify it after.
 *
 * Part of the Omnarai handoff package (Muse, 2026-10-14), Work Item 4.
 * Exists because of a published lesson: the register-proximity refutation
 * (2026-08-07) had its decision rule written down before computation, but no
 * hash or independent timestamp was taken, and the registry later had to
 * publish a provenance correction downgrading its own pre-commitment. This
 * tool makes the verifiable version the easy version.
 *
 * The hash is SHA-256 over the EXACT UTF-8 bytes of the falsifier text.
 * No trimming, no normalization: what is hashed is what is stored, verbatim.
 *
 * Usage:
 *   node precommit.mjs freeze --claim <claim-id> --by <name> \
 *        (--file falsifier.txt | --text "...") [--context "..."] [--out DIR]
 *   node precommit.mjs verify <record.json>
 *   node precommit.mjs verify --file falsifier.txt --sha <hex>
 *
 * freeze writes <out>/<claim-id>/<timestamp>.json and prints the git
 * commands that pin the record into history (commit + tag). Run them.
 * An uncommitted record is a claim about a pre-commitment, not one.
 *
 * Exit codes: 0 ok / verified · 1 verification FAILED · 2 usage error
 * Dependencies: none (Node >= 18).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function usage(msg) {
  if (msg) console.error(`precommit: ${msg}`);
  console.error('usage: precommit.mjs freeze --claim <id> --by <name> (--file <path> | --text <text>) [--context <text>] [--out <dir>]');
  console.error('       precommit.mjs verify <record.json> | verify --file <path> --sha <hex>');
  process.exit(2);
}

const [mode, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  else (flags._ ??= []).push(rest[i]);
}

if (mode === 'freeze') {
  const claim = flags.claim, by = flags.by;
  if (!claim || !by) usage('freeze requires --claim and --by');
  let text;
  if (flags.file) text = readFileSync(flags.file, 'utf8');
  else if (typeof flags.text === 'string') text = flags.text;
  else usage('freeze requires --file or --text');
  if (!text.trim()) usage('falsifier text is empty — a falsifier that says nothing commits to nothing');

  const record = {
    claim_id: claim,
    falsifier_text: text,
    sha256: sha256(text),
    frozen_at: new Date().toISOString(),
    frozen_by: by,
    context: typeof flags.context === 'string' ? flags.context : '',
  };
  const outDir = join(typeof flags.out === 'string' ? flags.out : 'precommitments', claim);
  mkdirSync(outDir, { recursive: true });
  const fileName = record.frozen_at.replace(/[:.]/g, '-') + '.json';
  const path = join(outDir, fileName);
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');

  const tag = `precommit/${claim}/${record.frozen_at.slice(0, 10).replaceAll('-', '')}`;
  console.log(`frozen: ${path}`);
  console.log(`sha256: ${record.sha256}`);
  console.log('');
  console.log('Pin it into history now — an uncommitted record proves nothing:');
  console.log(`  git add ${path}`);
  console.log(`  git commit -m "precommit: ${claim} falsifier frozen ${record.frozen_at.slice(0, 10)}"`);
  console.log(`  git tag ${tag}`);
} else if (mode === 'verify') {
  let text, expected;
  if (flags._?.[0]) {
    const record = JSON.parse(readFileSync(flags._[0], 'utf8'));
    text = record.falsifier_text;
    expected = record.sha256;
    if (typeof text !== 'string' || typeof expected !== 'string') usage('record lacks falsifier_text/sha256');
    console.log(`record: claim ${record.claim_id}, frozen ${record.frozen_at} by ${record.frozen_by}`);
  } else if (flags.file && flags.sha) {
    text = readFileSync(flags.file, 'utf8');
    expected = flags.sha;
  } else {
    usage('verify requires a record path, or --file plus --sha');
  }
  const actual = sha256(text);
  if (actual === expected) {
    console.log(`VERIFIED — sha256 ${actual}`);
  } else {
    console.error(`FAILED — expected ${expected}, computed ${actual}`);
    console.error('The text being verified is not the text that was frozen.');
    process.exit(1);
  }
} else {
  usage(`unknown mode "${mode ?? ''}"`);
}
