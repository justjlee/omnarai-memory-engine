// Hermetic test for the scorecard storage + endpoints (in-memory Blob; never touches prod).
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-scorecard-api.mjs
import assert from "node:assert/strict";
import { call } from "./lib/invoke.mjs";

process.env.INGEST_SECRET = "test-secret";
const auth = { authorization: "Bearer test-secret" };
let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name + "\n      " + (e.stack || e.message)); process.exitCode = 1; } };

const sc = { schema: "scorecard/1", generated: "2026-10-01T14:31:00.000Z", goal: { footprints_admitted: 0 }, front_door: { real_7d: 126 } };

await t("scorecard write requires the curator key", async () => {
  const r = await call("/api/info?_view=scorecard", { method: "POST", body: sc });
  assert.equal(r.status, 401);
});
await t("scorecard read requires the curator key", async () => {
  const r = await call("/api/info?_view=scorecard");
  assert.equal(r.status, 401);
});
await t("reading before any publish is a clear 404, not zeros", async () => {
  const r = await call("/api/info?_view=scorecard", { headers: auth });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no scorecard published/);
});
await t("malformed bodies are rejected", async () => {
  for (const bad of [{}, { schema: "other/1", generated: "2026-10-01T00:00:00Z" }, { schema: "scorecard/1" }, { schema: "scorecard/1", generated: "not-a-date" }]) {
    const r = await call("/api/info?_view=scorecard", { method: "POST", headers: auth, body: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});
await t("oversized bodies are rejected", async () => {
  const r = await call("/api/info?_view=scorecard", { method: "POST", headers: auth, body: { ...sc, pad: "x".repeat(210 * 1024) } });
  assert.equal(r.status, 400);
});
await t("a valid scorecard is stored and read back", async () => {
  const w = await call("/api/info?_view=scorecard", { method: "POST", headers: auth, body: sc });
  assert.equal(w.status, 200);
  assert.equal(w.body.ok, true);
  const r = await call("/api/info?_view=scorecard", { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(r.body.front_door.real_7d, 126);
});
await t("republishing overwrites latest (no stale read)", async () => {
  await call("/api/info?_view=scorecard", { method: "POST", headers: auth, body: { ...sc, generated: "2026-10-02T09:00:00.000Z", front_door: { real_7d: 77 } } });
  const r = await call("/api/info?_view=scorecard", { headers: auth });
  assert.equal(r.body.front_door.real_7d, 77);
});
await t("the dashboard payload carries the scorecard", async () => {
  const r = await call("/api/info?_view=dashboard", { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(r.body.scorecard?.front_door?.real_7d, 77);
});

// ── Scheduled runs (2026-11-25): a failed run is said out loud, never left to age into "stale" ──
await t("a successful publish records the run as ok", async () => {
  const r = await call("/api/info?_view=scorecard-run", { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.at, "2026-10-02T09:00:00.000Z");
});
await t("run status needs the curator key and a reason for a failure", async () => {
  assert.equal((await call("/api/info?_view=scorecard-run", { method: "POST", body: { ok: false, reason: "x" } })).status, 401);
  assert.equal((await call("/api/info?_view=scorecard-run", { method: "POST", headers: auth, body: { ok: false } })).status, 400);
  assert.equal((await call("/api/info?_view=scorecard-run", { method: "POST", headers: auth, body: { reason: "no ok" } })).status, 400);
});
await t("a failed run shows on /home as 'Scorecard failed at <time>: <reason>' and keeps the last good numbers", async () => {
  const w = await call("/api/info?_view=scorecard-run", { method: "POST", headers: auth, body: { ok: false, at: "2026-10-03T06:00:00Z", reason: "front-door telemetry unreadable for all 14 days", source: "github-actions", run_url: "https://github.com/justjlee/omnarai-memory-engine/actions/runs/1" } });
  assert.equal(w.status, 200);
  const d = await call("/api/info?_view=dashboard", { headers: auth });
  const item = d.body.attention.auto.find((i) => /^Scorecard failed at/.test(i.label));
  assert.ok(item, JSON.stringify(d.body.attention.auto));
  assert.match(item.label, /^Scorecard failed at 2026-10-03 06:00 UTC: front-door telemetry unreadable for all 14 days/);
  assert.equal(item.where, "https://github.com/justjlee/omnarai-memory-engine/actions/runs/1");
  assert.equal(d.body.scorecard.front_door.real_7d, 77, "the last good scorecard is untouched");
  assert.equal(d.body.scorecard_run.ok, false);
});
await t("a run_url that is not a GitHub URL is dropped", async () => {
  const w = await call("/api/info?_view=scorecard-run", { method: "POST", headers: auth, body: { ok: false, reason: "x", run_url: "https://evil.example/" } });
  assert.equal(w.body.run.run_url, null);
});
await t("the next good publish clears the failure", async () => {
  await call("/api/info?_view=scorecard", { method: "POST", headers: auth, body: { ...sc, generated: "2026-10-03T12:00:00.000Z", front_door: { real_7d: 80 } } });
  const d = await call("/api/info?_view=dashboard", { headers: auth });
  assert.ok(!d.body.attention.auto.some((i) => /^Scorecard failed/.test(i.label)));
  assert.equal(d.body.scorecard_run.ok, true);
});

console.log(`\n${pass} passed${process.exitCode ? " — WITH FAILURES" : ""}`);
