// Request-time figures (2026-10-14). The engine pages that state LIVE numbers get them filled in as they are served,
// so they cannot trail the Atlas the 06:00 UTC cron grows every day. Without this, a page's figures were frozen at
// its last deploy and the public Balance tracker (/api/sync) showed it "lagging" most mornings.
//
// Same function as the deploy-time bake (api/_figures.js), so the two can never disagree.
//
// FAIL-OPEN by construction: a slow engine, an error, a non-text response, or any surprise returns next() — the page
// exactly as deployed, whose figures were baked at deploy time. The tracker then reports it as lagging (honestly).
// It never serves a broken page and never invents a number.
//
// Not a Serverless Function (Routing Middleware), so the Hobby 12-function cap is untouched. It touches only the
// pages in the matcher; /api/* never runs through it.
import { next } from "@vercel/functions/middleware";
import { figuresFrom, bakeFigures } from "./api/_figures.js";

export const config = {
  matcher: ["/divergences", "/divergences.html", "/for-researchers", "/for-researchers.html", "/release-manifest.md"],
};

export const BYPASS = "x-omnarai-bake"; // marks our own subrequest for the as-deployed page (prevents recursion)
const SELF = { "x-omnarai-self": "1" }; // never counted as visitor traffic
const BUDGET_MS = 1500;

export default async function middleware(request) {
  if (request.method !== "GET" || request.headers.get(BYPASS)) return next();
  try {
    const origin = new URL(request.url).origin;
    const signal = AbortSignal.timeout(BUDGET_MS);
    const [page, stats, manifest] = await Promise.all([
      fetch(request.url, { headers: { ...SELF, [BYPASS]: "1", accept: request.headers.get("accept") || "*/*" }, signal }),
      fetch(origin + "/api/stats", { headers: SELF, signal }),
      fetch(origin + "/api/manifest", { headers: SELF, signal }),
    ]);
    const type = page.headers.get("content-type") || "";
    if (!page.ok || !stats.ok || !manifest.ok || !/^text\/(html|markdown|plain)/.test(type)) return next();
    const figs = figuresFrom(await stats.json(), await manifest.json());
    const { text } = bakeFigures(await page.text(), figs);
    const headers = new Headers(page.headers);
    // The body was decoded by fetch and then changed: drop every header that described the OLD bytes.
    for (const h of ["content-encoding", "content-length", "etag", "age", "x-vercel-cache"]) headers.delete(h);
    headers.set("cache-control", "public, max-age=0, must-revalidate");
    headers.set("x-omnarai-figures", "live");
    return new Response(text, { status: 200, headers });
  } catch {
    return next();
  }
}
