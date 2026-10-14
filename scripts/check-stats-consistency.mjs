#!/usr/bin/env node
// CHECK STATS CONSISTENCY — HANDOFF-DEPTH-2026-Q4 §5 checks 2 (stats) + 3 (mcp-count).
//
// Every surface that quotes a figure must agree with engine /api/stats. Surfaces
// are read as RAW BYTES — no JavaScript — because that is how AI fetchers,
// crawlers and Dataset Search read them. (A 2026-09-28 handoff quoted the
// homepage's stale no-JS fallbacks as "verified live"; this is the check that
// would have caught it.)
//
//   node scripts/check-stats-consistency.mjs [--scope front|engine|hf|all] [--only mcp|stats]
//   exit 1 = a figure disagrees · 0 = all agree
//
// --scope (2026-10-14) lets each deploy gate the surfaces it OWNS: the engine deploy checks `engine`,
// the front-door deploy checks `front`, the weekly run checks `all`. `hf` = published channels
// (Hugging Face cards, npm README) — owned by no deploy.
//
// MCP is compared PER TRANSPORT: remote (/api/mcp) and npm stdio ship different
// true tool counts, so demanding one number would red-fail an honest state.
//
// Hugging Face's Atlas card freezes at a published RELEASE (immutable, versioned), so it is checked
// against the manifest's `published_releases` — NOT against the live store, which keeps growing. The
// old live-vs-card comparison failed an honest state and disagreed with check-surface-currency.

const E = "https://engine.omnarai.org";
const H = { "x-omnarai-self": "1", "user-agent": "omnarai-check-stats" };
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const ONLY = arg("--only");
const SCOPE = arg("--scope") || "all";
if (!["front", "engine", "hf", "all"].includes(SCOPE)) { console.error(`unknown --scope ${SCOPE} (front|engine|hf|all)`); process.exit(64); }
const inScope = (s) => SCOPE === "all" || SCOPE === s;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];
const wordOrNum = (s) => (WORDS.indexOf(String(s).toLowerCase()) >= 0 ? WORDS.indexOf(String(s).toLowerCase()) : Number(String(s).replace(/,/g, "")));

let fails = 0, unreachable = 0;
const bad = (m) => { fails++; console.log(`  🔴 ${m}`); };
const warn = (m) => { unreachable++; console.log(`  🟡 ${m}`); };
const ok = (m) => console.log(`  🟢 ${m}`);
const eq = (label, got, want) => (String(got) === String(want) ? ok(`${label} = ${want}`) : bad(`${label}: surface says ${got}, /api/stats says ${want}`));
// A slow or unreachable SURFACE is a warning, never a crash (2026-10-14: an unhandled timeout used to blank the whole run).
const text = async (u) => { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.text(); };
const json = async (u) => JSON.parse(await text(u));
const tryText = async (u) => { try { return await text(u); } catch (e) { warn(`${u} unreachable (${e.message})`); return null; } };
const tryJson = async (u) => { try { return await json(u); } catch (e) { warn(`${u} unreachable (${e.message})`); return null; } };
const num = (s) => Number(String(s).replace(/,/g, ""));

// Source of truth. Before the deploy that adds /api/stats, derive the same
// figures from the endpoints it is built on — same definitions, flagged.
async function loadStats() {
  try { return await json(`${E}/api/stats`); } catch { /* fall through */ }
  const [d, i, m] = await Promise.all([json(`${E}/api/divergences`), json(`${E}/api/info`), json(`${E}/api/manifest`)]);
  console.log("  ⚠︎  /api/stats not live yet — derived from /api/divergences + /api/info + /api/manifest");
  return {
    atlas: { recorded: d.count, tested: d.tested_count, untested: d.count - d.tested_count, certified: d.certified_count,
      certified_strongest: d.tier_distribution?.C3 || 0, tier_distribution: d.tier_distribution,
      verbatim_answers: m.counts.atlas.verbatim_answers, tension_axes: m.counts.atlas.tension_axes },
    corpus: { works: i.corpus.totalWorks, words: i.corpus.totalWords, lineages: i.lineages?.count },
    mcp: null,
  };
}

let S;
try { S = await loadStats(); } catch (e) { console.log(`  🟡 INCONCLUSIVE: live truth unreachable (${e.message}) — nothing was judged.`); process.exit(2); }
const A = S.atlas, C = S.corpus;

if (ONLY !== "mcp") {
  if (inScope("front")) {
    console.log("== stats-consistency: front door (raw HTML, no JS)");
    const LIVE = { works: C.works, words: C.words, lineages: C.lineages, records: A.recorded, tested: A.tested,
      certified: A.certified, certified_strong: A.certified_strongest, untested: A.untested, tools: S.mcp?.remote };
    for (const page of ["https://omnarai.org/", "https://omnarai.org/explore"]) {
      const html = await tryText(page); if (html === null) continue;
      for (const [, key, val] of html.matchAll(/data-live="([a-z_]+)">([^<]*)</g)) if (LIVE[key] != null) eq(`${page} [${key}] fallback`, num(val), LIVE[key]);
      const ld = html.match(/(\d[\d,]*) records hold (\d[\d,]*) verbatim model answers across (\d[\d,]*) tension axes/);
      if (ld) { eq(`${page} JSON-LD records`, num(ld[1]), A.recorded); eq(`${page} JSON-LD answers`, num(ld[2]), A.verbatim_answers); eq(`${page} JSON-LD tensions`, num(ld[3]), A.tension_axes); }
      const lt = html.match(/of the (\d+) records put through perturbation testing, (\d+) (?:is|are) paraphrase-robust and (\d+) clears? both/);
      if (lt) { eq(`${page} JSON-LD tested`, lt[1], A.tested); eq(`${page} JSON-LD C1`, lt[2], A.tier_distribution?.C1 || 0); eq(`${page} JSON-LD C3`, lt[3], A.certified_strongest); }
    }
  }

  console.log("== stats-consistency: llms.txt (corpus works)");
  for (const [scope, u] of [["front", "https://omnarai.org/llms.txt"], ["engine", `${E}/llms.txt`]]) {
    if (!inScope(scope)) continue;
    const t = await tryText(u); if (t === null) continue;
    const hits = [...t.matchAll(/\b(\d{3}) (?:attributed )?works\b/g)].map((m) => num(m[1]));
    hits.length ? [...new Set(hits)].forEach((n) => eq(`${u} "N works"`, n, C.works)) : ok(`${u}: quotes no work count`);
  }

  if (inScope("hf")) {
    console.log("== stats-consistency: HuggingFace cards");
    const man = await tryJson(`${E}/api/manifest`);
    const rel = man?.published_releases?.divergence_atlas;
    const atlasCard = await tryText("https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas/raw/main/README.md");
    if (atlasCard !== null && rel) {
      const rec = atlasCard.match(/\*\*Version:\*\* v(\d+\.\d+\.\d+) · \*\*Records:\*\* (\d+)/);
      if (rec) { eq("HF Atlas card version (vs manifest release)", rec[1], rel.version); eq("HF Atlas card records (vs manifest release)", rec[2], rel.records); }
      else bad("HF Atlas card: could not read its Version/Records line");
      const tst = atlasCard.match(/\*\*(\d+) of (\d+) records have now been through the harness/);
      if (tst) ok(`HF Atlas card tested ${tst[1]} of ${tst[2]} (frozen at release v${rel.version}; live is ${A.tested} of ${A.recorded})`);
    }
    const corpCard = await tryText("https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/raw/main/README.md");
    const lt = corpCard?.match(/Live engine total works\*\* \| (\d+)/); if (lt) eq("HF corpus card live total", lt[1], C.works);
  }
}

if (ONLY !== "stats") {
  console.log("== mcp-count (per transport)");
  let remote = null;
  try {
    const rpc = await fetch(`${E}/api/mcp`, { method: "POST", headers: { ...H, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), signal: AbortSignal.timeout(25000) }).then((r) => r.text());
    const line = rpc.split("\n").map((l) => l.replace(/^data: ?/, "")).find((l) => l.trim().startsWith("{"));
    remote = JSON.parse(line).result.tools.map((t) => t.name);
  } catch (e) { warn(`${E}/api/mcp tools/list unreachable (${e.message})`); }
  const remoteN = remote ? remote.length : S.mcp?.remote;
  if (remote && inScope("engine")) {
    if (S.mcp) eq("live tools/list vs /api/stats mcp.remote", remote.length, S.mcp.remote);
    const llms = await tryText(`${E}/llms.txt`);
    if (llms !== null) {
      const missing = remote.filter((n) => !llms.includes(n));
      missing.length ? bad(`engine llms.txt missing remote tools: ${missing.join(", ")}`) : ok(`engine llms.txt names all ${remote.length} remote tools`);
    }
  }
  if (inScope("hf")) {
    const stdioDefault = S.mcp ? S.mcp.stdio_default : (remote || []).filter((n) => n !== "omnarai_job").length;
    const npm = await tryJson("https://registry.npmjs.org/omnarai-mcp");
    if (npm) {
      const rw = (npm.readme || "").match(/as (\w+) tools/i);
      rw ? eq("npm README stdio tool count", wordOrNum(rw[1]), stdioDefault) : bad("npm README states no tool count");
    }
  }
  if (inScope("front") && remoteN != null) {
    const explore = await tryText("https://omnarai.org/explore");
    if (explore !== null) {
      // Accepts "Twelve tools" (prose) or "12 tools" (the data-live token the front-door sync maintains).
      const ew = explore.replace(/<[^>]*>/g, " ").match(/api\/mcp[\s\S]{0,120}?\b(\w+) tools/i);
      ew ? eq("/explore remote tool count", wordOrNum(ew[1]), remoteN) : bad("/explore states no remote tool count");
    }
  }
}

console.log(fails ? `\n🔴 stats-consistency: ${fails} mismatch(es)${unreachable ? `, ${unreachable} unreachable` : ""}` : `\n🟢 stats-consistency: all surfaces agree${unreachable ? ` (${unreachable} unreachable — not judged)` : ""}`);
process.exit(fails ? 1 : 0);
