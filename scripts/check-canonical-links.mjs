#!/usr/bin/env node
// CHECK CANONICAL LINKS — HANDOFF-DEPTH-2026-Q4 §5 check 1 (WS1 acceptance).
//
// One host per surface (D-1): omnarai.org · engine.omnarai.org · chess.omnarai.org.
// Every other host must answer with ONE permanent redirect to the matching
// canonical path — 301 for pages, 308 for /api/* (308 keeps the method, so a
// POST from a pre-1.8 omnarai-mcp client still lands as a POST).
//
// Fails (exit 1) on:
//   · any vercel.app href on the crawled pages
//   · any internal link whose final status isn't 200, or that needs >1 redirect
//   · any legacy host root that doesn't 301/308 straight to its canonical host
//   · any sitemap page (HTML) missing rel=canonical, or pointing elsewhere
//
//   node scripts/check-canonical-links.mjs            # full check
//   node scripts/check-canonical-links.mjs --no-legacy   # skip legacy-host redirects
//                                                     # (before the redirect deploy lands)

const CANON = ["omnarai.org", "engine.omnarai.org", "chess.omnarai.org"];
const CRAWL = ["https://omnarai.org/", "https://omnarai.org/explore", "https://engine.omnarai.org/"];
const LEGACY = {
  "https://www.omnarai.org/": "https://omnarai.org/",
  "https://omnarai-home.vercel.app/": "https://omnarai.org/",
  "https://omnarai.vercel.app/": "https://engine.omnarai.org/",
  "https://omnarai-memory-engine.vercel.app/": "https://engine.omnarai.org/",
  "https://omnarai-chess.vercel.app/": "https://chess.omnarai.org/",
  "https://omnarai.vercel.app/api/info": "https://engine.omnarai.org/api/info",
};
// Protocol endpoints linked as hrefs but POST-only: 405 on GET means "alive".
const POST_ONLY = new Set(["https://engine.omnarai.org/api/mcp"]);
const SITEMAPS = ["https://omnarai.org/sitemap.xml", "https://engine.omnarai.org/sitemap.xml"];
const SKIP_LEGACY = process.argv.includes("--no-legacy");
const H = { "x-omnarai-self": "1", "user-agent": "omnarai-check-canonical-links" };

let fails = 0;
const bad = (m) => { fails++; console.log(`  🔴 ${m}`); };
const ok = (m) => console.log(`  🟢 ${m}`);

// Follow redirects by hand so the chain length is visible.
async function trace(url, max = 5) {
  const hops = [];
  let u = url;
  for (let i = 0; i <= max; i++) {
    const r = await fetch(u, { redirect: "manual", headers: H });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      hops.push(r.status);
      u = new URL(r.headers.get("location"), u).href;
      continue;
    }
    return { status: r.status, final: u, hops, body: r.headers.get("content-type")?.includes("html") ? await r.text() : "" };
  }
  return { status: 0, final: u, hops };
}
const isInternal = (u) => { try { const h = new URL(u).hostname; return CANON.includes(h) || h.endsWith(".vercel.app") || h.endsWith("omnarai.org"); } catch { return false; } };
const canonicalOf = (html) => (html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0].match(/href=["']([^"']+)/i) || [])[1];

console.log("== hrefs on crawled pages");
const links = new Set();
for (const page of CRAWL) {
  const { body, status } = await trace(page);
  if (status !== 200) { bad(`${page} → ${status}`); continue; }
  const hrefs = [...body.matchAll(/href=["']([^"'#]+)/gi)].map((m) => new URL(m[1], page).href);
  const vc = hrefs.filter((h) => h.includes("vercel.app"));
  vc.length ? vc.forEach((h) => bad(`${page} links ${h}`)) : ok(`${page}: 0 vercel.app hrefs (${hrefs.length} links)`);
  hrefs.filter(isInternal).forEach((h) => links.add(h));
}

console.log(`== ${links.size} internal links: final 200, ≤1 redirect`);
for (const u of links) {
  const t = await trace(u);
  if (POST_ONLY.has(u) && t.status === 405 && !t.hops.length) continue;
  if (t.status !== 200) bad(`${u} → final ${t.status} (${t.final})`);
  else if (t.hops.length > 1) bad(`${u} → ${t.hops.length}-hop chain ${t.hops.join("→")}`);
}
ok("internal link sweep done");

if (!SKIP_LEGACY) {
  console.log("== legacy hosts: one permanent redirect to canonical");
  for (const [from, to] of Object.entries(LEGACY)) {
    const r = await fetch(from, { redirect: "manual", headers: H });
    const loc = r.headers.get("location") && new URL(r.headers.get("location"), from).href;
    const want = from.includes("/api/") ? [308] : [301, 308];
    if (want.includes(r.status) && loc === to) ok(`${from} ${r.status} → ${loc}`);
    else bad(`${from} ${r.status}${loc ? ` → ${loc}` : ""} (want ${want.join("/")} → ${to})`);
  }
}

console.log("== rel=canonical on sitemap HTML pages");
for (const sm of SITEMAPS) {
  const xml = await (await fetch(sm, { headers: H })).text();
  for (const loc of [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) {
    const t = await trace(loc);
    if (!t.body) continue; // .md / .json / .txt twins carry no <link>
    const c = canonicalOf(t.body);
    if (!c) bad(`${loc} has no rel=canonical`);
    else if (c.replace(/\/$/, "") !== loc.replace(/\/$/, "")) bad(`${loc} canonical → ${c}`);
  }
  ok(`${sm} swept`);
}

console.log(fails ? `\n🔴 canonical-links: ${fails} failure(s)` : "\n🟢 canonical-links: all clear");
process.exit(fails ? 1 : 0);
