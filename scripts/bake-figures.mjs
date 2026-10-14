#!/usr/bin/env node
// Bake live figures into public/*.md|html|txt at DEPLOY time — the same function middleware.js applies at REQUEST
// time (api/_figures.js). The deploy-time bake still matters: it is what a reader sees if the request-time fill
// ever fails open (slow engine), and what the repo itself records.
//
//   node scripts/bake-figures.mjs            # dry run: report what would change
//   node scripts/bake-figures.mjs --apply    # write
//   node scripts/bake-figures.mjs --check    # exit 1 if anything is stale (writes nothing)
// Exit 2 = an unknown <!--live:KEY--> / data-live key (a typo would otherwise never update).
// If the live engine cannot be read, NOTHING is written (never guess a number) and it exits 0 with SKIPPED.
// Last stdout line is always `CHANGED <n>` so scripts/sync-doc-counts.py can fold the count into its own report.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { figuresFrom, bakeFigures } from "../api/_figures.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const APPLY = process.argv.includes("--apply");
const CHECK = process.argv.includes("--check");
const ENGINE = process.env.OMNARAI_TRUTH_BASE || "https://engine.omnarai.org";
const get = async (p) => {
  const r = await fetch(ENGINE + p, { headers: { "x-omnarai-self": "1" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
};

let figs;
try { figs = figuresFrom(await get("/api/stats"), await get("/api/manifest")); }
catch (e) { console.log(`  generated figures: SKIPPED — live engine unreachable (${e.message}); nothing written`); console.log("CHANGED 0"); process.exit(0); }

let changed = 0;
const unknown = [];
for (const f of fs.readdirSync(PUB).filter((n) => /\.(md|html|txt)$/.test(n)).sort()) {
  const p = path.join(PUB, f);
  const before = fs.readFileSync(p, "utf8");
  const { text, unknown: u } = bakeFigures(before, figs);
  for (const k of u) unknown.push(`${f}: unknown figure key '${k}'`);
  if (text !== before) {
    changed++;
    console.log(`  ${APPLY ? "WRITE" : "WOULD CHANGE"}: public/${f}  (generated figures)`);
    if (APPLY) fs.writeFileSync(p, text);
  }
}
for (const e of unknown) console.log(`  ERROR: ${e}`);
console.log(`CHANGED ${changed}`);
process.exit(unknown.length ? 2 : CHECK && changed ? 1 : 0);
