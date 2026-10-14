#!/usr/bin/env node
// check-surfaces — "do all our public surfaces agree with the live numbers?"  (the deploy-gate / weekly CLI)
//
//   node scripts/check-surfaces.mjs --scope engine   # engine deploy gate  (surfaces the engine ships)
//   node scripts/check-surfaces.mjs --scope front    # front-door deploy gate (omnarai.org)
//   node scripts/check-surfaces.mjs --scope hf       # published channels: HF cards, npm, MCP registry
//   node scripts/check-surfaces.mjs                  # everything (the weekly check)
//   flags: --layers numbers,stats,currency  --verbose  --json
//
// This is only a RENDERER. The audit itself is api/_surface-audit.js — the same code that powers the public
// Balance tracker (GET /api/sync), so a gate and the tracker can never disagree about what is out of sync.
//
// Exit: 1 = something is STALE (a figure/claim beyond tolerance, or wrong in kind) · 2 = live truth unreachable
// (nothing judged) · 0 otherwise. LAGGING (within 5%) and NOT CHECKED are reported loudly but do not fail a
// deploy: a baked page trails the daily cron by design, and a slow third party must never block a ship.
// Read-only: GETs only, no keys, no model calls. OMNARAI_BASE points the SURFACES at a local copy of public/;
// truth always comes from the live API (OMNARAI_TRUTH_BASE overrides).
import { runAudit } from "../api/_surface-audit.js";

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const scope = arg("--scope") || "all";
const layers = (arg("--layers") || process.env.OMNARAI_AUDIT_LAYERS || "numbers,stats,currency").split(",");
const VERBOSE = process.argv.includes("--verbose");
const AS_JSON = process.argv.includes("--json");
if (!["front", "engine", "hf", "all"].includes(scope)) { console.error(`unknown --scope ${scope} (front|engine|hf|all)`); process.exit(64); }
if (layers.some((l) => !["numbers", "stats", "currency"].includes(l))) { console.error(`unknown --layers ${layers} (numbers,stats,currency)`); process.exit(64); }

const base = {};
if (process.env.OMNARAI_BASE) base.engine = process.env.OMNARAI_BASE;
const r = await runAudit({ scope, layers, base, truthBase: process.env.OMNARAI_TRUTH_BASE, registry: scope === "hf" || scope === "all" });

if (AS_JSON) { console.log(JSON.stringify(r, null, 1)); process.exit(r.status === "unknown" ? 2 : r.summary.stale ? 1 : 0); }
if (r.status === "unknown") { console.log(`\n  🟡 INCONCLUSIVE: ${r.reason}\n  Nothing was judged — and nothing is reported as in balance.\n`); process.exit(2); }

const s = r.summary, f = r.facts;
const show = (lv) => f.filter((g) => g.level === lv);
const line = (icon, g, msg) => console.log(`  ${icon}  ${g.surface.padEnd(32)} ${msg}`);
console.log(`\n  SURFACES (--scope ${scope}, layers ${layers.join("+")}) — ${s.surfaces_checked} surfaces · ${s.facts_checked} facts · live: ${r.truth.works} works, ${r.truth.records} records, ${r.truth.answers} answers, ${r.truth.remote_tools} remote tools\n`);
for (const g of show("fail")) line("🔴", g, `${g.check}: says ${g.got || "(missing)"}, live ${g.want}  — ${g.remedy}`);
for (const g of show("drift")) line("🟡", g, `${g.check}: says ${g.got}, live ${g.want} (lagging within 5% — refresh when convenient)`);
for (const g of show("unreachable")) line("🟡", g, `not checked: ${g.got}`);
for (const g of show("note")) line("ℹ️ ", g, g.detail);
if (VERBOSE) for (const g of show("allowed")) line("✅", g, `"${g.check}" differs from live on purpose: ${g.detail}`);
const parts = [`${s.stale} stale`, `${s.lagging} lagging`, `${s.allowlisted_history} allowlisted history`, `${s.not_checked} not checked`];
console.log(`\n  ${s.stale ? "🔴" : "🟢"} ${r.status === "in_balance" ? "IN BALANCE" : `${s.out_of_sync} OUT OF SYNC`} — ${parts.join(" · ")}\n`);
process.exit(s.stale ? 1 : 0);
