#!/usr/bin/env node
// check-surface-numbers — the net under the sync (2026-10-14).
//
// WHY: sync-doc-counts / sync-counts only fix the sentences someone wrote a rule for. On 2026-10-14
// the front door said "166 splits", /explore said "Eight tools", divergences.html "162", for-researchers
// "567 works" and release-manifest.md "33 tested" while the live engine said 175 / 12 / 175 / 573 / 47 —
// and the existing gates reported mostly clean, because none of them READ those sentences.
//
// WHAT: reads every public text surface (sitemaps + the known hand-written files + HF cards) as raw
// bytes — no JavaScript, the way crawlers and AI fetchers read — extracts every counted figure
// ("N works", "N splits", "Eight tools", …) and requires each to be: live truth, a release-pinned
// figure, an explicitly dated/versioned snapshot, or on the allowlist WITH a reason. Anything else
// is a typed literal gone stale → FAIL.
//
//   node scripts/check-surface-numbers.mjs [--scope front|engine|hf|all] [--verbose] [--json]
//   exit 0 = clean · 1 = stale number(s) · 2 = inconclusive (live truth unreachable; nothing judged)
//
// Read-only: GETs only, no keys, no model calls. A slow/unreachable SURFACE is a WARN, never a crash
// (the old currency gate died on a 60s registry timeout and reported nothing).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toText, extract, judge, truthFrom } from "./lib/surface-numbers.mjs";

const ENGINE = process.env.OMNARAI_BASE || "https://engine.omnarai.org";
// Truth always comes from the live API; OMNARAI_BASE can point the SURFACES at a local copy of
// public/ (e.g. `python3 -m http.server`) to check edits before they are deployed.
const TRUTH = process.env.OMNARAI_TRUTH_BASE || "https://engine.omnarai.org";
const FRONT = "https://omnarai.org";
const HF = "https://huggingface.co/datasets/TheRealmsOfOmnarai";
const H = { "x-omnarai-self": "1", "user-agent": "omnarai-check-surface-numbers" };
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const SCOPE = arg("--scope") || "all";
const VERBOSE = process.argv.includes("--verbose");
const AS_JSON = process.argv.includes("--json");
const DIR = path.dirname(fileURLToPath(import.meta.url));

async function get(url, ms = 25000) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status}`);
  return { body: await r.text(), type: r.headers.get("content-type") || "" };
}
const getRetry = async (u) => { try { return await get(u); } catch { return get(u); } };

async function sitemap(base) {
  try { return [...(await get(`${base}/sitemap.xml`)).body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]); } catch { return []; }
}

const SURFACES = {
  front: async () => [...new Set([...(await sitemap(FRONT)), `${FRONT}/`, `${FRONT}/explore`, `${FRONT}/llms.txt`])],
  engine: async () => [...new Set([...(await sitemap(ENGINE)),
    ...["/for-researchers.html", "/divergences.html", "/try.html", "/omnai.md", "/release-manifest.md", "/evidence-status.md",
      "/omnarai-cold-start.md", "/omnarai.context.md", "/llms.txt", "/limitations.md", "/refutation-ledger.md", "/mcp-access-policy.md",
      "/openapi.json", "/api/agent-entry"].map((p) => ENGINE + p)])],
  hf: async () => [`${HF}/realms-of-omnarai/raw/main/README.md`, `${HF}/omnarai-divergence-atlas/raw/main/README.md`],
};

let manifest, stats;
try {
  manifest = JSON.parse((await getRetry(`${TRUTH}/api/manifest`)).body);
  stats = JSON.parse((await getRetry(`${TRUTH}/api/stats`)).body);
} catch (e) {
  console.log(`  🟡 INCONCLUSIVE: live truth unreachable (${e.message}) — nothing was judged.`);
  process.exit(2);
}
const truth = truthFrom(manifest, stats);
let allow = [];
try { allow = JSON.parse(fs.readFileSync(path.join(DIR, "../docs/surface-number-allowlist.json"), "utf8")).entries || []; } catch { /* no allowlist yet */ }

const scopes = SCOPE === "all" ? Object.keys(SURFACES) : [SCOPE];
if (scopes.some((s) => !SURFACES[s])) { console.error(`unknown --scope ${SCOPE} (front|engine|hf|all)`); process.exit(64); }

const rows = [], warns = [];
const seen = new Set();
for (const s of scopes) {
  for (const url of await SURFACES[s]()) {
    if (seen.has(url)) continue; seen.add(url);
    let res;
    try { res = await getRetry(url); } catch (e) { warns.push(`${url} unreachable (${e.message})`); continue; }
    const html = /html/i.test(res.type) || /<html|<!doctype/i.test(res.body.slice(0, 400));
    const surface = url.replace(ENGINE, "").replace(FRONT, "front:").replace(HF, "hf:") || "/";
    for (const hit of extract(toText(res.body, { html }))) {
      const v = judge(hit, truth, allow, surface);
      rows.push({ surface, key: hit.key, number: hit.number, raw: hit.raw, level: v.level, why: v.why });
    }
  }
}

const by = (l) => rows.filter((r) => r.level === l);
const fails = by("FAIL");
if (AS_JSON) {
  console.log(JSON.stringify({ truth, scanned: seen.size, figures: rows.length, fails, warns, labeled: by("LABELED"), allowed: by("ALLOWED") }, null, 1));
} else {
  console.log(`\n  SURFACE NUMBERS — ${seen.size} surfaces · ${rows.length} counted figures · live: ${truth.works[0]} works, ${truth.records[0]} records, ${truth.answers[0]} answers, ${truth.tools[0]} remote tools\n`);
  for (const r of fails) console.log(`  🔴  ${r.surface.padEnd(36)} "${r.raw}" → ${r.why}`);
  for (const w of warns) console.log(`  🟡  ${w}`);
  if (VERBOSE) {
    for (const r of by("LABELED")) console.log(`  🏷️   ${r.surface.padEnd(36)} "${r.raw}" (${r.why})`);
    for (const r of by("ALLOWED")) console.log(`  ✅  ${r.surface.padEnd(36)} "${r.raw}" allowlisted: ${r.why}`);
  }
  console.log(`\n  ${fails.length ? "🔴" : "🟢"} ${fails.length} stale · ${by("LABELED").length} dated/versioned · ${by("ALLOWED").length} allowlisted · ${by("PASS").length} match live · ${warns.length} unreachable\n`);
}
process.exit(fails.length ? 1 : 0);
