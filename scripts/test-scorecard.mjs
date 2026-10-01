// Hermetic tests for the scorecard's scoring rules. No network.
//   node scripts/test-scorecard.mjs
import assert from "node:assert/strict";
import {
  findSweepers, summarizeFrontDoor, summarizeEngine, visitorsInWindow, isSearchReferrer, isCrawlerUA, refererHost,
} from "./lib/scorecard-core.mjs";

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; } };

const ev = (at, path, ip, extra = {}) => ({ at, path, ipHash: ip, category: "external-browser", ...extra });
const PAGES = ["/", "/explore", "/world", "/findings/architecture-differential"];

// The 2026-09-27..29 fleet: one visitor, four pages, ~10 requests, one minute.
const sweep = (day, ip) => PAGES.flatMap((p, i) => [ev(`${day}T23:35:0${i}Z`, p, ip), ev(`${day}T23:35:0${i}Z`, p, ip)]);

t("a four-page sweep inside one minute is a sweeper", () => {
  assert.ok(findSweepers(sweep("2026-09-27", "a1")).has("2026-09-27|a1"));
});
t("a person reading one page is not a sweeper", () => {
  assert.equal(findSweepers([ev("2026-09-30T15:02:00Z", "/", "h1")]).size, 0);
});
t("a person who browses four pages over ten minutes is NOT a sweeper", () => {
  const e = PAGES.map((p, i) => ev(`2026-09-30T15:${String(i * 3).padStart(2, "0")}:00Z`, p, "h2"));
  assert.equal(findSweepers(e).size, 0);
});
t("eight rapid requests to one page still count as a sweep", () => {
  const e = Array.from({ length: 8 }, (_, i) => ev(`2026-09-30T15:00:0${i}Z`, "/", "h3"));
  assert.ok(findSweepers(e).has("2026-09-30|h3"));
});
t("same IP on different days is judged per day", () => {
  const e = [...sweep("2026-09-27", "x"), ev("2026-09-28T10:00:00Z", "/", "x")];
  const s = findSweepers(e);
  assert.ok(s.has("2026-09-27|x"));
  assert.ok(!s.has("2026-09-28|x"));
});

t("front-door summary subtracts sweepers from real visitors", () => {
  const events = [...sweep("2026-09-27", "a"), ...sweep("2026-09-27", "b"), ev("2026-09-27T01:00:00Z", "/", "p1"), ev("2026-09-27T02:00:00Z", "/", "p2")];
  const { perDay } = summarizeFrontDoor(events, ["2026-09-27"]);
  assert.deepEqual(
    { real: perDay[0].real, sweepers: perDay[0].sweepers, raw: perDay[0].raw_browser },
    { real: 2, sweepers: 2, raw: 4 },
  );
});
t("only external-browser visitors count as real (bots and agents are reported separately)", () => {
  const events = [ev("2026-09-27T01:00:00Z", "/", "p1"), { at: "2026-09-27T02:00:00Z", path: "/", ipHash: "b1", category: "bot-crawler" }, { at: "2026-09-27T03:00:00Z", path: "/", ipHash: "g1", category: "ai-agent" }];
  const { perDay } = summarizeFrontDoor(events, ["2026-09-27"]);
  assert.equal(perDay[0].real, 1);
  assert.equal(perDay[0].bots, 1);
  assert.equal(perDay[0].ai_agents, 1);
});

t("window count excludes sweepers and anything outside the window", () => {
  const events = [ev("2026-09-30T21:00:00Z", "/", "p1"), ev("2026-09-30T22:00:00Z", "/", "p2"), ev("2026-09-30T19:00:00Z", "/", "early"), ...sweep("2026-09-30", "s")];
  const { sweepers } = summarizeFrontDoor(events, ["2026-09-30"]);
  assert.equal(visitorsInWindow(events, sweepers, "2026-09-30T20:30:00Z", 24), 2);
});

t("search referrers are recognised, Reddit/none are not", () => {
  assert.ok(isSearchReferrer("https://www.google.com/"));
  assert.ok(isSearchReferrer("https://www.bing.com/"));
  assert.ok(isSearchReferrer("https://duckduckgo.com/"));
  assert.ok(!isSearchReferrer("https://www.reddit.com/r/x"));
  assert.ok(!isSearchReferrer(null));
  assert.equal(refererHost("https://www.google.com/"), "google.com");
});

t("crawler UAs are recognised; ordinary client strings are not", () => {
  for (const ua of ["MCP-Cloud-AboutBot/1.0 (+https://github.com/mcp-cloud)", "rokmcp-collector/0.2", "SaSame-MCP-Audit/0.1", "BrickBlueBot/0.1 (+https://brick.blue/bo", "MCPCatalogSync/1.0"]) assert.ok(isCrawlerUA(ua), ua);
  for (const ua of ["claude-code/2.1", "Cursor/0.42", "mcp/1.0.0", "node"]) assert.ok(!isCrawlerUA(ua), ua);
});

t("engine summary splits crawler tool calls from unidentified ones and ignores monitors", () => {
  const call = (ua, tool, cat = "mcp-client") => ({ at: "2026-09-30T10:00:00Z", endpoint: "mcp", rpc: "tools/call", tool, ua, category: cat, ipHash: "i" });
  const events = [
    call("rokmcp-collector/0.2", "omnarai_divergence"),
    call("mcp/1.0.0", "omnarai_divergence"),
    call("x", "__verifymcp_auth_probe_ab12__"),
    call("SentinelOracle/0.1", "omnarai_info", "monitor"),
  ];
  const { perDay } = summarizeEngine(events, ["2026-09-30"]);
  assert.equal(perDay[0].tool_calls_unidentified, 1);
  assert.equal(perDay[0].tool_calls_crawlers, 2);
});

console.log(`\n${pass} passed${process.exitCode ? " — WITH FAILURES" : ""}`);
