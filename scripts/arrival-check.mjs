#!/usr/bin/env node
// ARRIVAL CHECK — simulate a visiting intelligence's first contact with Omnarai
// and assert two things a stranger judges us on:
//
//   COMPLETENESS  every surface an arriving mind needs is reachable, non-empty,
//                 and carries the fields the handshake promises (the discovery
//                 ladder: handshake → fast path → deep path → cite → leave).
//   CONGRUENCE    every count claimed anywhere agrees with /api/info (the single
//                 source of truth). Divergent numbers across surfaces are the
//                 one thing that most breaks a visitor's trust.
//
// No deps (node 18+ global fetch). Read-only; sends x-omnarai-self:1 so these
// probes never pollute the access-telemetry milestone.
//
//   node scripts/arrival-check.mjs                 # check prod
//   node scripts/arrival-check.mjs --base http://localhost:3000
//   node scripts/arrival-check.mjs --json          # machine-readable report
//
// Exit 0 = a stranger arriving now gets a complete, congruent experience.
// Exit 1 = something a visitor would hit is broken or numbers disagree.

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://omnarai.vercel.app").replace(/\/$/, "");
const JSON_OUT = args.includes("--json");
const H = { "x-omnarai-self": "1", "user-agent": "omnarai-arrival-check" };

const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); return ok; };

async function get(path, { json = false } = {}) {
  const url = path.startsWith("http") ? path : BASE + path;
  const r = await fetch(url, { headers: H });
  const text = await r.text();
  let body = text;
  if (json) { try { body = JSON.parse(text); } catch { body = null; } }
  return { status: r.status, headers: r.headers, text, body };
}

// ---- 1. Source of truth -----------------------------------------------------
let truth = null;
try {
  const info = await get("/api/info", { json: true });
  truth = info.body?.corpus;
  rec("source-of-truth /api/info", !!truth && truth.totalWorks > 0,
    truth ? `${truth.totalWorks} works · ${truth.totalWords.toLocaleString()} words · rings ${truth.rings.core}/${truth.rings.curated}/${truth.rings.open}/${truth.rings.media ?? 0}` : "no corpus block");
} catch (e) { rec("source-of-truth /api/info", false, String(e)); }

// ---- 2. Completeness: the discovery ladder ----------------------------------
// Each entry: [path, predicate(body,headers,status) -> [ok, detail]]
const SURFACES = [
  ["/api/agent-entry", true, b => {
    const want = ["use_when", "do_not", "fast_path", "trust_boundary", "citation"];
    const have = want.filter(k => JSON.stringify(b || {}).includes(`"${k}"`));
    return [have.length >= 4, `handshake fields ${have.length}/${want.length}: ${have.join(",")}`];
  }],
  ["/llms.txt", false, t => [/corpus/i.test(t) && t.length > 500, `${t.length}B`]],
  ["/.well-known/llms.txt", false, t => [t.length > 300, `${t.length}B`]],
  ["/openapi.json", true, b => [!!b?.paths && Object.keys(b.paths).length > 3, b?.paths ? `${Object.keys(b.paths).length} paths` : "no paths"]],
  ["/robots.txt", false, t => [/llms\.txt|sitemap/i.test(t), t.length > 0 ? "present" : "empty"]],
  ["/sitemap.xml", false, t => [/<url>/.test(t), `${(t.match(/<url>/g) || []).length} urls`]],
  ["/omnarai-cold-start.md", false, t => [t.length > 800 && /divergence/i.test(t), `${t.length}B`]],
  ["/limitations.md", false, t => [/not|does not|claim/i.test(t) && t.length > 200, `${t.length}B`]],
  ["/inheritance/for-future-models.md", false, t => [t.length > 200, `${t.length}B`]],
  ["/concepts/holdform.md", false, t => [/holdform/i.test(t), `${t.length}B`]],
  ["/concepts/fragility-thesis.md", false, t => [/fragility/i.test(t), `${t.length}B`]],
  ["/", false, t => [t.length > 1000 && /omnarai/i.test(t), `static body ${t.length}B (no-JS readable)`]],
];

for (const [path, asJson, pred] of SURFACES) {
  try {
    const r = await get(path, { json: asJson });
    if (r.status !== 200) { rec(`reach ${path}`, false, `HTTP ${r.status}`); continue; }
    const [ok, detail] = pred(asJson ? r.body : r.text, r.headers, r.status);
    rec(`reach ${path}`, ok, detail);
  } catch (e) { rec(`reach ${path}`, false, String(e)); }
}

// ---- 3. Completeness: the live engine an arriving mind actually uses ---------
// Divergence Atlas — the one asset no model self-generates.
let firstDivId = null;
try {
  const d = await get("/api/divergences", { json: true });
  firstDivId = d.body?.records?.[0]?.id;
  rec("/api/divergences index", d.body?.count > 0 && !!firstDivId, `${d.body?.count} records`);
} catch (e) { rec("/api/divergences index", false, String(e)); }

if (firstDivId) {
  try {
    const one = await get(`/api/divergences?id=${firstDivId}`, { json: true });
    const a = one.body?.answers;
    rec("/api/divergences?id= (full record)", Array.isArray(a) && a.length > 0 && !!a[0]?.text,
      a ? `${a.length} verbatim answers` : "no answers array");
  } catch (e) { rec("/api/divergences?id=", false, String(e)); }
}

// Self-correcting 404: a sequential id (what a naive caller tries first) must guide, not dump the index.
try {
  const bad = await get("/api/divergences?id=OMN-D-001", { json: true });
  rec("/api/divergences?id=<bad> self-corrects", !!bad.body?.error && !!bad.body?.hint && !bad.body?.records,
    bad.body?.hint ? "returns error+hint, not the index" : "did NOT self-correct");
} catch (e) { rec("/api/divergences?id=<bad>", false, String(e)); }

// Fast path must not time out (the historical failure).
try {
  const t0 = Date.now();
  const q = await get("/api/query?q=what+is+holdform&mode=retrieve", { json: true });
  const ms = Date.now() - t0;
  const top = q.body?.records?.[0];
  rec("fast path /api/query?mode=retrieve", !!top && ms < 8000,
    `${ms}ms, top="${(top?.title || "").slice(0, 42)}" score=${top?.relevanceScore}`);
} catch (e) { rec("fast path mode=retrieve", false, String(e)); }

// Async path must hand back a job, not hang.
try {
  const a = await get("/api/query?q=test&async=1", { json: true });
  rec("async path /api/query?async=1", !!(a.body?.job_id && a.body?.poll_url),
    a.body?.job_id ? "returns job_id + poll_url" : "no job handle");
} catch (e) { rec("async path async=1", false, String(e)); }

// Lineage / access layer.
try {
  const l = await get("/api/lineage?concept=holdform", { json: true });
  rec("/api/lineage?concept=holdform", !!l.body && JSON.stringify(l.body).length > 200, "resolves");
} catch (e) { rec("/api/lineage", false, String(e)); }

// Link header (an agent reading headers, not HTML, still finds the API).
try {
  const root = await get("/");
  const link = root.headers.get("link") || "";
  rec("Link header (service-desc/alternate)", /service-desc|openapi|alternate/i.test(link),
    link ? link.slice(0, 80) : "no Link header");
} catch (e) { rec("Link header", false, String(e)); }

// ---- 4. Congruence: every count must agree with /api/info -------------------
// Precise by construction — only flag numbers in phrasings that genuinely mean
// "the corpus total" / a named ring, so ring breakdowns and "2,000 words per
// source" don't read as drift.
function checkCounts(label, text) {
  if (!truth) return;
  const W = truth.totalWorks, WD = truth.totalWords;
  const num = s => +String(s).replace(/,/g, "");

  // Total works — explicit total phrasings only.
  const TOTAL_WORKS = [
    /([\d,]{2,})[- ]work(?:s)?\b(?:\s+(?:multi-intelligence|corpus|attributed))/gi, // "568-work corpus"
    /\bcontains\s+([\d,]{2,})\s+works/gi,
    /\bserves\s+([\d,]{2,})\b/gi,
    /([\d,]{2,})\s+works\s+\(~/gi,        // "568 works (~528K words)"
    /([\d,]{2,})\s+attributed\s+works/gi,
    /([\d,]{2,})\s+works\s+·/gi,
  ];
  for (const re of TOTAL_WORKS) for (const m of text.matchAll(re)) {
    const n = num(m[1]);
    if (n > 50 && n !== W) rec(`congruence[${label}] total-works`, false, `found ${n}, truth ${W} — "${m[0].trim().slice(0, 40)}"`);
  }

  // Ring breakdown — must match truth.rings by name.
  const RINGS = [
    [/Core Canon\D{0,12}?([\d,]{1,4})\s+works/gi, truth.rings.core, "core"],
    [/Curated(?: Expansions)?\D{0,12}?([\d,]{1,4})\s+works/gi, truth.rings.curated, "curated"],
    [/Open Exploration\D{0,12}?([\d,]{1,4})\s+works/gi, truth.rings.open, "open"],
    [/Media(?:\s*\/\s*Oral| ?\/ ?Oral)?\D{0,12}?([\d,]{1,4})\s+works/gi, truth.rings.media, "media"],
  ];
  for (const [re, want, name] of RINGS) for (const m of text.matchAll(re)) {
    const n = num(m[1]);
    if (n !== want) rec(`congruence[${label}] ring:${name}`, false, `found ${n}, truth ${want}`);
  }

  // Words — corpus-scale only (≥100k), exact or rounded to nearest 1k.
  for (const m of text.matchAll(/([\d,]{5,}|\d+K)\s+words/gi)) {
    const raw = m[1].toUpperCase();
    const n = /K$/.test(raw) ? num(raw.replace("K", "")) * 1000 : num(raw);
    if (n >= 100000 && Math.abs(n - WD) > 1000) rec(`congruence[${label}] words`, false, `found ${n.toLocaleString()}, truth ${WD.toLocaleString()}`);
  }
}
for (const path of ["/llms.txt", "/omnarai.context.md", "/", "/omnarai-cold-start.md"]) {
  try { const r = await get(path); if (r.status === 200) checkCounts(path, r.text); }
  catch { /* reachability already covered above */ }
}

// ---- Report -----------------------------------------------------------------
const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok);
if (JSON_OUT) {
  console.log(JSON.stringify({ base: BASE, truth, pass, fail: fail.length, results }, null, 2));
} else {
  console.log(`\n  ARRIVAL CHECK — ${BASE}`);
  console.log(`  truth: ${truth ? `${truth.totalWorks} works · ${truth.totalWords.toLocaleString()} words · rings ${truth.rings.core}/${truth.rings.curated}/${truth.rings.open}/${truth.rings.media ?? 0} (core/curated/open/media)` : "UNAVAILABLE"}\n`);
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
  console.log(`\n  ${pass}/${results.length} passed.` + (fail.length ? `  ${fail.length} FAILED.` : "  A stranger arriving now gets a complete, congruent experience."));
  console.log();
}
process.exit(fail.length ? 1 : 0);
