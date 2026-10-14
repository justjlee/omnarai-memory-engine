#!/usr/bin/env node
// check-surfaces — ONE entry point for "do all our public surfaces agree with the live numbers?"
//
//   node scripts/check-surfaces.mjs --scope engine   # engine deploy gate  (surfaces the engine ships)
//   node scripts/check-surfaces.mjs --scope front    # front-door deploy gate (omnarai.org)
//   node scripts/check-surfaces.mjs --scope hf       # published channels: HF cards, npm, MCP registry
//   node scripts/check-surfaces.mjs                  # everything (the weekly check)
//
// It runs the three layers that each catch something the others cannot (2026-10-14 audit):
//   1. check-surface-numbers     every counted figure in every public text surface — the NET
//   2. check-stats-consistency   the specific structured figures (data-live fallbacks, JSON-LD, MCP tool
//                                counts, HF release pins)
//   3. check-surface-currency    prose + claim currency (refuted-count word, build stamp, card age,
//                                npm vs MCP registry versions)
// Exit: 1 if ANY layer found a stale surface · 2 if nothing could be judged (live truth unreachable) · else 0.
// Read-only (GETs, no keys, no model calls). Individual slow sources WARN; they never crash a layer.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf("--scope");
const scope = i >= 0 ? process.argv[i + 1] : "all";
const extra = process.argv.includes("--verbose") ? ["--verbose"] : [];

const layers = [
  ["numbers      ", "check-surface-numbers.mjs"],
  ["stats        ", "check-stats-consistency.mjs"],
  ["currency     ", "check-surface-currency.mjs"],
];
let failed = [], inconclusive = [];
for (const [label, file] of layers) {
  console.log(`\n━━ ${label.trim()} (--scope ${scope}) ━━`);
  const r = spawnSync(process.execPath, [path.join(DIR, file), "--scope", scope, ...(file === "check-surface-numbers.mjs" ? extra : [])], { stdio: "inherit", env: process.env });
  if (r.status === 1) failed.push(label.trim());
  else if (r.status !== 0) inconclusive.push(`${label.trim()} (exit ${r.status})`);
}
console.log("\n━━ summary ━━");
if (failed.length) console.log(`  🔴 stale surface(s) found by: ${failed.join(", ")}`);
if (inconclusive.length) console.log(`  🟡 could not judge: ${inconclusive.join(", ")}`);
if (!failed.length && !inconclusive.length) console.log(`  🟢 every ${scope === "all" ? "public" : scope} surface agrees with the live numbers`);
process.exit(failed.length ? 1 : inconclusive.length === layers.length ? 2 : 0);
