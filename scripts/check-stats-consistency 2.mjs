#!/usr/bin/env node
// CHECK STATS CONSISTENCY — HANDOFF-DEPTH-2026-Q4 §5 checks 2 (stats) + 3 (mcp-count).
//
// Every surface that quotes a figure must agree with engine /api/stats. Surfaces
// are read as RAW BYTES — no JavaScript — because that is how AI fetchers,
// crawlers and Dataset Search read them. (A 2026-09-28 handoff quoted the
// homepage's stale no-JS fallbacks as "verified live"; this is the check that
// would have caught it.)
//
//   node scripts/check-stats-consistency.mjs          # exit 1 on any mismatch
//   node scripts/check-stats-consistency.mjs --only mcp|stats
//
// MCP is compared PER TRANSPORT: remote (/api/mcp) and npm stdio ship different
// true tool counts, so demanding one number would red-fail an honest state.

const E = "https://engine.omnarai.org";
const H = { "x-omnarai-self": "1", "user-agent": "omnarai-check-stats" };
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

let fails = 0;
const bad = (m) => { fails++; console.log(`  🔴 ${m}`); };
const ok = (m) => console.log(`  🟢 ${m}`);
const eq = (label, got, want) => (String(got) === String(want) ? ok(`${label} = ${want}`) : bad(`${label}: surface says ${got}, /api/stats says ${want}`));
const text = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.text(); };
const json = async (u) => JSON.parse(await text(u));
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

const S = await loadStats();
const A = S.atlas, C = S.corpus;

if (ONLY !== "mcp") {
  console.log("== stats-consistency: front door (raw HTML, no JS)");
  const LIVE = { works: C.works, words: C.words, lineages: C.lineages, records: A.recorded, tested: A.tested,
    certified: A.certified, certified_strong: A.certified_strongest, untested: A.untested };
  for (const page of ["https://omnarai.org/", "https://omnarai.org/explore"]) {
    const html = await text(page);
    for (const [, key, val] of html.matchAll(/data-live="([a-z_]+)">([^<]*)</g)) if (key in LIVE) eq(`${page} [${key}] fallback`, num(val), LIVE[key]);
    const ld = html.match(/(\d[\d,]*) records hold (\d[\d,]*) verbatim model answers across (\d[\d,]*) tension axes/);
    if (ld) { eq(`${page} JSON-LD records`, num(ld[1]), A.recorded); eq(`${page} JSON-LD answers`, num(ld[2]), A.verbatim_answers); eq(`${page} JSON-LD tensions`, num(ld[3]), A.tension_axes); }
    const lt = html.match(/of the (\d+) records put through perturbation testing, (\d+) (?:is|are) paraphrase-robust and (\d+) clears? both/);
    if (lt) { eq(`${page} JSON-LD tested`, lt[1], A.tested); eq(`${page} JSON-LD C1`, lt[2], A.tier_distribution?.C1 || 0); eq(`${page} JSON-LD C3`, lt[3], A.certified_strongest); }
  }

  console.log("== stats-consistency: llms.txt (corpus works)");
  for (const u of ["https://omnarai.org/llms.txt", `${E}/llms.txt`]) {
    const t = await text(u);
    const hits = [...t.matchAll(/\b(\d{3}) (?:attributed )?works\b/g)].map((m) => num(m[1]));
    hits.length ? [...new Set(hits)].forEach((n) => eq(`${u} "N works"`, n, C.works)) : ok(`${u}: quotes no work count`);
  }

  console.log("== stats-consistency: HuggingFace cards");
  const atlasCard = await text("https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas/raw/main/README.md");
  const rec = atlasCard.match(/\*\*Records:\*\* (\d+)/); if (rec) eq("HF Atlas card records", rec[1], A.recorded);
  const tst = atlasCard.match(/\*\*(\d+) of (\d+) records have now been through the harness/); if (tst) eq("HF Atlas card tested", tst[1], A.tested);
  const corpCard = await text("https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/raw/main/README.md");
  const lt = corpCard.match(/Live engine total works\*\* \| (\d+)/); if (lt) eq("HF corpus card live total", lt[1], C.works);
}

if (ONLY !== "stats") {
  console.log("== mcp-count (per transport)");
  const rpc = await fetch(`${E}/api/mcp`, { method: "POST", headers: { ...H, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then((r) => r.text());
  const line = rpc.split("\n").map((l) => l.replace(/^data: ?/, "")).find((l) => l.trim().startsWith("{"));
  const remote = JSON.parse(line).result.tools.map((t) => t.name);
  if (S.mcp) { eq("live tools/list vs /api/stats mcp.remote", remote.length, S.mcp.remote); }
  const stdioDefault = S.mcp ? S.mcp.stdio_default : remote.filter((n) => n !== "omnarai_job").length;

  const readme = (await json("https://registry.npmjs.org/omnarai-mcp")).readme || "";
  const rw = readme.match(/as (\w+) tools/i);
  rw ? eq("npm README stdio tool count", WORDS.indexOf(rw[1].toLowerCase()) >= 0 ? WORDS.indexOf(rw[1].toLowerCase()) : num(rw[1]), stdioDefault) : bad("npm README states no tool count");

  const explore = await text("https://omnarai.org/explore");
  const ew = explore.replace(/<[^>]*>/g, " ").match(/api\/mcp[\s\S]{0,120}?\b(\w+) tools/i);
  ew ? eq("/explore remote tool count", WORDS.indexOf(ew[1].toLowerCase()), remote.length) : bad("/explore states no remote tool count");

  const llms = await text(`${E}/llms.txt`);
  const missing = remote.filter((n) => !llms.includes(n));
  missing.length ? bad(`engine llms.txt missing remote tools: ${missing.join(", ")}`) : ok(`engine llms.txt names all ${remote.length} remote tools`);
}

console.log(fails ? `\n🔴 stats-consistency: ${fails} mismatch(es)` : "\n🟢 stats-consistency: all surfaces agree");
process.exit(fails ? 1 : 0);
