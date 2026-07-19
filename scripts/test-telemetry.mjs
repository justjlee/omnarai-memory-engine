#!/usr/bin/env node
// Unit tests for the pure parts of api/_telemetry.js: classifyCaller (the
// stranger/self gate) and buildEvent (the enriched event record). No network,
// no Blob — mock req objects only.
import { classifyCaller, buildEvent, summarize } from "../api/_telemetry.js";

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, "\n      got :", JSON.stringify(got), "\n      want:", JSON.stringify(want)); }
}
const req = (headers = {}, extra = {}) => ({ method: "GET", url: "/api/query?q=x", headers, ...extra });

// ── classifyCaller (the original 12 behaviours, unchanged) ───────────────────
t("self header wins", classifyCaller(req({ "x-omnarai-self": "1", "user-agent": "curl/8" })), { category: "self", log: false });
t("vercel cron is ours", classifyCaller(req({ "user-agent": "vercel-cron/1.0" })), { category: "cron", log: false });
t("own UI referer is ours", classifyCaller(req({ referer: "https://omnarai.vercel.app/x", "user-agent": "Mozilla/5.0" })), { category: "ui", log: false });
t("localhost referer is ours", classifyCaller(req({ origin: "http://localhost:5173", "user-agent": "Mozilla/5.0" })), { category: "ui", log: false });
t("mcp client tag", classifyCaller(req({ "x-omnarai-client": "mcp", "user-agent": "node" })), { category: "mcp-client", log: true });
t("bot crawler", classifyCaller(req({ "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)" })), { category: "bot-crawler", log: true });
t("ai agent (httpx)", classifyCaller(req({ "user-agent": "python-httpx/0.28.1" })), { category: "ai-agent", log: true });
t("ai agent (langchain)", classifyCaller(req({ "user-agent": "langchain/0.2" })), { category: "ai-agent", log: true });
t("no UA", classifyCaller(req({})), { category: "unknown-no-ua", log: true });
t("nonbrowser UA", classifyCaller(req({ "user-agent": "somecustomclient/0.1" })), { category: "unknown-nonbrowser", log: true });
t("external browser", classifyCaller(req({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605" })), { category: "external-browser", log: true });
t("external referer still stranger", classifyCaller(req({ referer: "https://example.com", "user-agent": "Mozilla/5.0 Chrome/125" })), { category: "external-browser", log: true });

// ── generic bot/registry long tail (2026-07-19) ───────────────────────────────
// Every UA below is real traffic from the 2026-07-19 event files, and every one
// was landing in unknown-nonbrowser or — worse — external-browser, where a
// crawler reads as a human arrival. The classifier is the thing every headline
// number is derived from, so these are pinned verbatim.
t("Bot suffix behind a Mozilla mask is NOT a browser", classifyCaller(req({ "user-agent": "Mozilla/5.0 (compatible; AwarioBot/1.0; +https://awario.com/bots.html)" })), { category: "bot-crawler", log: true });
t("SynaptoRadarBot is a bot", classifyCaller(req({ "user-agent": "SynaptoRadarBot/0.1 (+https://hml.search.synapto.com)" })), { category: "bot-crawler", log: true });
t("self-declared crawler", classifyCaller(req({ "user-agent": "agent-tools.cloud-crawler/0.1 (+https://agent-tools.cloud)" })), { category: "bot-crawler", log: true });
t("registry indexer", classifyCaller(req({ "user-agent": "aisec-registry/0.2 (+https://sec.sqrx.io)" })), { category: "bot-crawler", log: true });
t("contact-URL convention alone is enough", classifyCaller(req({ "user-agent": "PRSM-MCP-Graph/1.0 (+https://prsm.network)" })), { category: "bot-crawler", log: true });
t("bare node UA is a script, not an unknown", classifyCaller(req({ "user-agent": "node" })), { category: "ai-agent", log: true });
// Guard the other direction: the generic net must not swallow real browsers or
// our own MCP client (whose tag is checked before any UA pattern).
t("plain Chrome stays a browser", classifyCaller(req({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36" })), { category: "external-browser", log: true });
t("our MCP client keeps its own bucket", classifyCaller(req({ "x-omnarai-client": "mcp", "user-agent": "omnarai-mcp/1.6.2 (+https://omnarai.vercel.app)" })), { category: "mcp-client", log: true });

// ── monitor category (2026-07-19): liveness pollers are logged but not reach ──
t("sentineloracle is a monitor", classifyCaller(req({ "user-agent": "SentinelOracle/0.1 (+https://glimind.com/opt-out; liveness-only, never invokes tools)" })), { category: "monitor", log: true });
t("uptimerobot is a monitor", classifyCaller(req({ "user-agent": "Mozilla/5.0 (compatible; UptimeRobot/2.0)" })), { category: "monitor", log: true });
t("monitor beats mcp client tag", classifyCaller(req({ "x-omnarai-client": "mcp", "user-agent": "Pingdom.com_bot" })), { category: "monitor", log: true });
t("monitor is still logged, never self", classifyCaller(req({ "user-agent": "checkly/1.0" })).log, true);
t("self header still beats monitor", classifyCaller(req({ "x-omnarai-self": "1", "user-agent": "SentinelOracle/0.1" })), { category: "self", log: false });

// ── summarize: signal = logged minus monitors ────────────────────────────────
const sum = summarize({
  totals: { logged: 201 },
  byCategory: { monitor: 108, "external-browser": 62, "ai-agent": 4 },
  days: {
    "2026-07-19": {
      total: 201,
      byCategory: { monitor: 108, "external-browser": 62 },
      visitors: { aaa: 108, bbb: 1, ccc: 2 },
    },
  },
});
t("all-time signal excludes monitors", sum.signal, 93);
t("all-time monitor count surfaced", sum.monitor, 108);
t("raw logged total preserved", sum.logged, 201);
t("per-day signal excludes monitors", sum.days["2026-07-19"].signal, 93);
t("per-day distinct visitors", sum.days["2026-07-19"].distinctVisitors, 3);
t("top-visitor share flags domination", Math.round(sum.days["2026-07-19"].topVisitorShare * 100), 54);
t("summarize survives an empty log", summarize({}).signal, 0);
t("signal never goes negative", summarize({ totals: { logged: 2 }, byCategory: { monitor: 9 } }).signal, 0);

// ── buildEvent enrichment ────────────────────────────────────────────────────
const now = new Date("2026-07-18T12:00:00.000Z");

const e1 = buildEvent(
  req(
    {
      "user-agent": "python-httpx/0.28.1",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "x-vercel-ip-country": "SE",
      "x-vercel-ip-country-region": "AB",
      "x-vercel-ip-city": "Stockholm",
      "accept-language": "sv-SE,sv;q=0.9",
    },
    { query: { q: "what is holdform", si: "GPT-4o" } }
  ),
  "query", "ai-agent", now
);
t("event: query text captured", e1.q, "what is holdform");
t("event: declared identity captured", e1.identity, "GPT-4o");
t("event: coarse geo", [e1.country, e1.region, e1.city], ["SE", "AB", "Stockholm"]);
t("event: lang", e1.lang, "sv-SE,sv;q=0.9");
t("event: ipHash present, raw IP absent", [e1.ipHash?.length, JSON.stringify(e1).includes("203.0.113.9")], [12, false]);

const e2 = buildEvent(
  req({ "user-agent": "node" }, {
    method: "POST",
    url: "/api/lattice?_view=mcp",
    query: { _view: "mcp" },
    body: { jsonrpc: "2.0", method: "tools/call", params: { name: "omnarai_divergence", arguments: { query: "identity persistence", syntheticIdentity: "Grok" } } },
  }),
  "mcp", "unknown-nonbrowser", now
);
t("mcp: rpc method captured", e2.rpc, "tools/call");
t("mcp: tool name captured", e2.tool, "omnarai_divergence");
t("mcp: q lifted from tool args", e2.q, "identity persistence");
t("mcp: identity lifted from tool args", e2.identity, "Grok");

const e3 = buildEvent(req({ "user-agent": "node" }, { method: "POST", url: "/api/lattice?_view=mcp", query: { _view: "mcp" }, body: { jsonrpc: "2.0", method: "tools/list" } }), "mcp", "unknown-nonbrowser", now);
t("mcp: tools/list has no tool", [e3.rpc, e3.tool], ["tools/list", null]);

const e4 = buildEvent(req({ "user-agent": "node" }, { method: "POST", body: [1, 2, 3] }), "mcp", "unknown-nonbrowser", now);
t("mcp: array body guarded", [e4.rpc, e4.tool, e4.q], [null, null, null]);

const e5 = buildEvent(req({ "user-agent": "x" }, { query: { q: "Q".repeat(500) } }), "query", "unknown-nonbrowser", now);
t("truncation: q capped at 200", e5.q.length, 200);

const e6 = buildEvent(req({ "user-agent": "x" }, { method: "POST", body: { query: "from body", identity: "DeepSeek" } }), "query", "unknown-nonbrowser", now);
t("POST body q + identity", [e6.q, e6.identity], ["from body", "DeepSeek"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
