// Generated figures: the bake rules (api/_figures.js) and the request-time middleware that applies them.
// The middleware must fill in live numbers — and must FAIL OPEN (serve the page as deployed) on any doubt.
//   node --test scripts/test-figures.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { figuresFrom, bakeFigures } from "../api/_figures.js";
import middleware, { BYPASS } from "../middleware.js";

const stats = { atlas: { recorded: 176, tested: 47, untested: 129, certified: 6, certified_strongest: 2, tier_distribution: { C0: 170, C1: 4, C3: 2 }, verbatim_answers: 907, tension_axes: 499 },
  corpus: { works: 573, words: 530406, lineages: 8 }, mcp: { remote: 12, stdio_default: 11, stdio_opt_in: 3 } };
const manifest = { counts: { corpus: { seed_works: 568, merged_proposals: 5 }, concept_graph: { nodes: 61, edges: 164 } }, domains: { questions: { canonical_questions: 130 } } };
const figs = figuresFrom(stats, manifest);
const PAGE = `<div data-live="records">175</div> <span data-live="untested">128</span> splits across <span data-live="distinct">129</span>; <span data-live="cleared">6</span> clear, <span data-live="c3">2</span> C3.
| tested_count | <!--live:tested-->47<!--/live--> | · re-elicitations <!--live:reelicitations-->46<!--/live--> · words <!--live:words-->530,406<!--/live-->`;

test("figuresFrom derives every key the pages use", () => {
  assert.equal(figs.records, 176);
  assert.equal(figs.distinct_questions, 130);
  assert.equal(figs.reelicitations, 46);
  assert.equal(figs.tools_stdio, 11);
  assert.equal(figs.c0, 170);
});

test("bakeFigures rewrites markers AND data-live fallbacks (with aliases) and is idempotent", () => {
  const { text, unknown } = bakeFigures(PAGE, figs);
  assert.deepEqual(unknown, []);
  assert.match(text, /data-live="records">176</);
  assert.match(text, /data-live="untested">129</);
  assert.match(text, /data-live="distinct">130</);   // alias → distinct_questions
  assert.match(text, /data-live="cleared">6</);      // alias → certified
  assert.match(text, /<!--live:words-->530,406<!--\/live-->/); // thousands separators without Intl
  assert.equal(bakeFigures(text, figs).text, text);
});

test("an unknown key is reported (a typo must never silently stop updating)", () => {
  const { text, unknown } = bakeFigures('<!--live:recrods-->175<!--/live--> <b data-live="untsted">1</b>', figs);
  assert.deepEqual(unknown.sort(), ["recrods", "untsted"]);
  assert.match(text, /175/); // left as-is, not blanked
});

// ── middleware ────────────────────────────────────────────────────────────────────────────────────────────
const isPassthrough = (res) => res.headers.get("x-middleware-next") === "1";
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const r = routes[new URL(url).pathname];
    if (r instanceof Error) throw r;
    if (r === "hang") return new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    const { status = 200, body = "", type = "text/html; charset=utf-8" } = r || { status: 404 };
    return new Response(body, { status, headers: { "content-type": type, "content-encoding": "br", etag: '"old"' } });
  };
  return calls;
}
const json = (o) => ({ body: JSON.stringify(o), type: "application/json" });
const req = (path, headers = {}) => new Request("https://engine.omnarai.org" + path, { headers });

test("serves the page with LIVE figures filled in, and drops headers that described the old bytes", async () => {
  const calls = stubFetch({ "/divergences": { body: PAGE }, "/api/stats": json(stats), "/api/manifest": json(manifest) });
  const res = await middleware(req("/divergences"));
  assert.equal(isPassthrough(res), false);
  const body = await res.text();
  assert.match(body, /data-live="records">176</);
  assert.equal(res.headers.get("x-omnarai-figures"), "live");
  assert.equal(res.headers.get("content-encoding"), null, "must not claim the old compression");
  assert.equal(res.headers.get("etag"), null);
  assert.ok(calls.every((c) => c.headers["x-omnarai-self"] === "1"), "self-marked: never counted as visitor traffic");
  assert.ok(calls.find((c) => c.url.endsWith("/divergences")).headers[BYPASS], "page subrequest carries the bypass marker");
});

test("its own subrequest (bypass marker) passes straight through — no recursion", async () => {
  stubFetch({});
  assert.ok(isPassthrough(await middleware(req("/divergences", { [BYPASS]: "1" }))));
});

test("FAILS OPEN: slow engine, thrown error, bad status, or non-text page all serve the page as deployed", async () => {
  for (const routes of [
    { "/divergences": { body: PAGE }, "/api/stats": "hang", "/api/manifest": json(manifest) },
    { "/divergences": { body: PAGE }, "/api/stats": new Error("ECONNRESET"), "/api/manifest": json(manifest) },
    { "/divergences": { body: PAGE }, "/api/stats": { status: 503 }, "/api/manifest": json(manifest) },
    { "/divergences": { body: "{}", type: "application/json" }, "/api/stats": json(stats), "/api/manifest": json(manifest) },
    { "/divergences": { body: PAGE }, "/api/stats": { body: "not json", type: "application/json" }, "/api/manifest": json(manifest) },
  ]) {
    stubFetch(routes);
    assert.ok(isPassthrough(await middleware(req("/divergences"))), JSON.stringify(Object.keys(routes)));
  }
});

test("non-GET requests are never touched", async () => {
  stubFetch({});
  assert.ok(isPassthrough(await middleware(new Request("https://engine.omnarai.org/divergences", { method: "HEAD" }))));
});
