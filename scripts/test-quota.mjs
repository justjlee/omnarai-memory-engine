#!/usr/bin/env node
// Unit tests for the council daily cap (api/_quota.js). Pure logic only — no
// network, no blob. The counting path is exercised separately against a live
// store; what's pinned here is the part that decides WHO gets metered, which is
// where a mistake is silent and expensive.
//
//   node scripts/test-quota.mjs
import assert from "node:assert";

process.env.INGEST_SECRET = "test-ingest-secret";
process.env.CRON_SECRET = "test-cron-secret";

const { quotaSubject, signOriginHash, originHeaders, councilDailyCap, quotaResetsAt } =
  await import("../api/_quota.js");

const mk = (headers = {}) => ({ headers, socket: {} });
let pass = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

console.log("council quota\n");

t("default cap is 5", () => assert.equal(councilDailyCap(), 5));

t("COUNCIL_DAILY_CAP overrides", () => {
  process.env.COUNCIL_DAILY_CAP = "12";
  assert.equal(councilDailyCap(), 12);
  delete process.env.COUNCIL_DAILY_CAP;
});

t("garbage cap falls back to default", () => {
  process.env.COUNCIL_DAILY_CAP = "not-a-number";
  assert.equal(councilDailyCap(), 5);
  process.env.COUNCIL_DAILY_CAP = "-3";
  assert.equal(councilDailyCap(), 5);
  delete process.env.COUNCIL_DAILY_CAP;
});

t("curator self-header is exempt", () => {
  const s = quotaSubject(mk({ "x-omnarai-self": "1" }));
  assert.equal(s.exempt, true);
  assert.equal(s.reason, "self");
});

t("INGEST_SECRET bearer is exempt", () => {
  const s = quotaSubject(mk({ authorization: "Bearer test-ingest-secret" }));
  assert.equal(s.exempt, true);
  assert.equal(s.reason, "curator");
});

t("CRON_SECRET bearer is exempt", () => {
  const s = quotaSubject(mk({ authorization: "Bearer test-cron-secret" }));
  assert.equal(s.exempt, true);
  assert.equal(s.reason, "cron");
});

t("a wrong bearer is NOT exempt", () => {
  const s = quotaSubject(mk({ authorization: "Bearer nope", "x-forwarded-for": "203.0.113.9" }));
  assert.equal(s.exempt, false);
  assert.ok(s.hash);
});

t("ordinary caller is metered by ip hash", () => {
  const s = quotaSubject(mk({ "x-forwarded-for": "203.0.113.1" }));
  assert.equal(s.exempt, false);
  assert.ok(s.hash && s.hash.length === 12);
});

t("distinct IPs get distinct buckets", () => {
  const a = quotaSubject(mk({ "x-forwarded-for": "203.0.113.1" })).hash;
  const b = quotaSubject(mk({ "x-forwarded-for": "203.0.113.2" })).hash;
  assert.notEqual(a, b);
});

t("no derivable IP is never blocked", () => {
  const s = quotaSubject(mk({}));
  assert.equal(s.hash, null);
});

// The MCP passthrough — the case that would otherwise collapse every remote-MCP
// user in the world into one shared Vercel egress bucket.
t("signed origin hash is honored over the socket IP", () => {
  const caller = mk({ "x-forwarded-for": "198.51.100.5" });
  const fwd = originHeaders(caller);
  assert.ok(fwd["x-omnarai-origin-hash"], "expected a forwarded hash");
  const inner = quotaSubject(mk({ ...fwd, "x-forwarded-for": "10.0.0.1" }));
  assert.equal(inner.hash, fwd["x-omnarai-origin-hash"]);
});

t("two MCP callers stay in separate buckets", () => {
  const a = originHeaders(mk({ "x-forwarded-for": "198.51.100.5" }));
  const b = originHeaders(mk({ "x-forwarded-for": "198.51.100.6" }));
  assert.notEqual(a["x-omnarai-origin-hash"], b["x-omnarai-origin-hash"]);
});

t("FORGED origin hash is rejected, falls back to real IP", () => {
  const forged = { "x-omnarai-origin-hash": "deadbeefcafe", "x-omnarai-origin-sig": "0".repeat(16) };
  const s = quotaSubject(mk({ ...forged, "x-forwarded-for": "10.0.0.1" }));
  assert.notEqual(s.hash, "deadbeefcafe");
  assert.equal(s.hash, quotaSubject(mk({ "x-forwarded-for": "10.0.0.1" })).hash);
});

t("origin hash with NO signature is ignored", () => {
  const s = quotaSubject(mk({ "x-omnarai-origin-hash": "deadbeefcafe", "x-forwarded-for": "10.0.0.1" }));
  assert.notEqual(s.hash, "deadbeefcafe");
});

t("signature is bound to its own hash (not replayable onto another)", () => {
  const a = originHeaders(mk({ "x-forwarded-for": "198.51.100.5" }));
  const swapped = { "x-omnarai-origin-hash": "aaaaaaaaaaaa", "x-omnarai-origin-sig": a["x-omnarai-origin-sig"] };
  const s = quotaSubject(mk({ ...swapped, "x-forwarded-for": "10.0.0.1" }));
  assert.notEqual(s.hash, "aaaaaaaaaaaa");
});

t("signing returns null without INGEST_SECRET", () => {
  const saved = process.env.INGEST_SECRET;
  delete process.env.INGEST_SECRET;
  assert.equal(signOriginHash("abc"), null);
  process.env.INGEST_SECRET = saved;
});

t("reset time is a future ISO instant", () => {
  const r = quotaResetsAt();
  assert.ok(!Number.isNaN(Date.parse(r)));
  assert.ok(Date.parse(r) > Date.now());
});

console.log(`\n${pass} passed${process.exitCode ? " — WITH FAILURES" : ""}`);
