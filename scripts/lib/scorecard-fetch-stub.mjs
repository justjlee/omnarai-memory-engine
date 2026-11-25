// Test-only network stub for scripts/test-scorecard-run.mjs: scripts/scorecard.mjs runs for real, but
// every fetch is answered from STUB_MODE fixtures and every POST is written to STUB_OUT. Nothing leaves.
import { appendFileSync } from "node:fs";
const MODE = process.env.STUB_MODE || "ok";
const OUT = process.env.STUB_OUT;
const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if ((init.method || "GET") === "POST") {
    appendFileSync(OUT, JSON.stringify({ path: u.pathname + u.search, body: JSON.parse(init.body) }) + "\n");
    return json({ ok: true });
  }
  const day = u.searchParams.get("day");
  if (u.host === "omnarai.org" && u.pathname === "/api/telemetry") {
    return MODE === "front-down" ? json({ error: "nope" }, 401) : json({ events: [{ at: `${day}T12:00:00Z`, ipHash: "h1", ua: "Mozilla/5.0", path: "/", kind: "pageview", referer: "https://www.google.com/" }] });
  }
  if (u.pathname === "/api/info" && u.searchParams.get("_view") === "traffic") return json({ events: [] });
  if (u.pathname === "/api/info" && u.searchParams.get("_view") === "scorecard") {
    return json({ schema: "scorecard/1", generated: "2026-11-20T00:00:00.000Z", endorsements: { github: { repos: [{ name: "omnarai-memory-engine", views_14d: 40, unique_viewers_14d: 9, clones_14d: 70 }] } }, milestones: { internal: [{ label: "private one", date: "2026-11-01" }] } });
  }
  if (u.pathname === "/api/footprints") return json({ total_admitted: 4, matched: 0, count: 0 });
  if (u.pathname === "/api/contributions") return json({ count: 0 });
  if (u.pathname === "/api/manifest") return json({ domains: { footprints: { origin_disclosures: { "curator-prompted": 3, "automated-test": 1 }, admitted_without_origin_disclosure: 0 } } });
  return json({}, 404); // GitHub, Hugging Face, npm: unavailable in tests (the script treats them as optional)
};
