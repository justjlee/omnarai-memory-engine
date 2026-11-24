#!/usr/bin/env node
// Static gate: storage routing and secret handling in api/ (HARD in deploy.sh).
//
//  1. Only api/_blob.js imports @vercel/blob, so every read and write goes through
//     the class router.
//  2. Every storage pathname literal in api/ (prefix/key constants, and literals at
//     put/list call sites) is covered by api/_storage-classes.js.
//  3. No stored body is read with a bare fetch(<blob>.url): reads use blobFetch().
//  4. No secret is compared with === / !== (use secretEquals / operatorAuthed).
//
//   node scripts/check-storage-classes.mjs          → exit 0 green, 1 red
import { readFileSync, readdirSync } from "node:fs";
import { STORAGE_CLASSES, classOf } from "../api/_storage-classes.js";

const API = new URL("../api/", import.meta.url);
export function checkStorage(files = readdirSync(API).filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(new URL(f, API), "utf8")])) {
  const problems = [];
  const literals = new Set();
  for (const [name, src] of files) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    if (name !== "_blob.js" && /from\s+["']@vercel\/blob["']|import\(\s*["']@vercel\/blob["']\s*\)/.test(code)) {
      problems.push(`${name}: imports @vercel/blob directly (use ./_blob.js)`);
    }
    for (const m of code.matchAll(/const\s+[A-Z0-9_]*(?:PREFIX|_KEY|KEY)\s*=\s*["'`]([a-z0-9][a-z0-9-]*\/[^"'`$]*)["'`]/g)) literals.add([name, m[1]]);
    for (const m of code.matchAll(/\b(?:put|blobPut)\(\s*["'`]([a-z0-9][a-z0-9-]*\/[^"'`$]*)/g)) literals.add([name, m[1]]);
    for (const m of code.matchAll(/\b(?:list|blobList)\(\s*\{\s*prefix:\s*["'`]([a-z0-9][a-z0-9-]*\/[^"'`$]*)/g)) literals.add([name, m[1]]);
    if (name !== "_blob.js" && /\bfetch\(\s*(?:`\$\{)?\s*[A-Za-z_$][\w$]*(?:\[\d+\])?\.url\b/.test(code)) {
      problems.push(`${name}: reads a stored body with fetch(<blob>.url) — use blobFetch()`);
    }
    for (const m of code.matchAll(/[!=]==\s*(?:process\.env\.)?[A-Z_]*(?:SECRET|_TOKEN|_KEY)\b|(?:process\.env\.)?[A-Z_]*(?:SECRET|_TOKEN)\s*[!=]==/g)) {
      problems.push(`${name}: compares a secret with ${m[0].trim()} — use secretEquals()`);
    }
  }
  for (const [name, lit] of literals) {
    if (!classOf(lit)) problems.push(`${name}: storage path "${lit}" has no entry in api/_storage-classes.js`);
  }
  return { problems, literals: literals.size, classes: Object.keys(STORAGE_CLASSES).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { problems, literals, classes } = checkStorage();
  if (problems.length) {
    console.log(`🔴 storage classes: ${problems.length} problem(s)`);
    for (const p of problems) console.log(`   - ${p}`);
    process.exit(1);
  }
  console.log(`🟢 storage classes: ${literals} storage paths in api/ all classified (${classes} classes); one storage door; no bare blob reads; constant-time secret checks`);
}
