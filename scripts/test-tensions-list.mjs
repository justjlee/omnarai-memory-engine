// /api/tensions must list EVERY tension, quickly, and honour paging.
//
// Found 2026-10-01 by a stranger-loop instance ("GET /api/tensions?status=unresolved returned empty") and then confirmed on
// production: the endpoint took 20–25 s per call, ignored `limit`, and returned exactly 1000 tensions. It read the registry one
// blob at a time and only the FIRST page of Vercel Blob's list() (max 1000), so anything past 1000 was silently dropped.
//
// HERMETIC:  node --import ./scripts/lib/register-mem-blob.mjs scripts/test-tensions-list.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";

const STATUSES = ["divergent", "unresolved", "emerging"];
function seed(n) {
  mem.__reset();
  for (let i = 0; i < n; i++) {
    mem.__seed(`tensions/t-${String(i).padStart(5, "0")}.json`, {
      key: `t-${i}`, topic: `topic ${i}`, voice_a: "A", voice_b: "B", claim_a: `a${i}`, claim_b: `b${i}`,
      status: STATUSES[i % 3], lastSeenAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    });
  }
}

test("lists past the 1000-entry Blob page: nothing is silently dropped", async () => {
  seed(1250);
  const r = await call("/api/tensions");
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 1250);
  assert.equal(r.body.total, 1250);
});

test("the status filter sees every page too", async () => {
  seed(1250);
  const r = await call("/api/tensions?status=unresolved");
  const truth = Array.from({ length: 1250 }, (_, i) => i).filter((i) => i % 3 === 1).length;
  assert.equal(r.body.count, truth);
  assert.ok(r.body.tensions.every((t) => t.status === "unresolved"));
});

test("newest first, and limit / offset page through the same list with has_more", async () => {
  seed(30);
  const first = await call("/api/tensions?limit=10");
  assert.equal(first.body.count, 10); assert.equal(first.body.total, 30); assert.equal(first.body.has_more, true);
  assert.equal(first.body.tensions[0].key, "t-29", "newest (largest lastSeenAt) first");
  const second = await call("/api/tensions?limit=10&offset=10");
  assert.equal(second.body.tensions[0].key, "t-19");
  const last = await call("/api/tensions?limit=10&offset=20");
  assert.equal(last.body.has_more, false);
  const ids = [...first.body.tensions, ...second.body.tensions, ...last.body.tensions].map((t) => t.key);
  assert.equal(new Set(ids).size, 30, "pages do not overlap or skip");
});

test("no limit still returns everything, with the original response shape plus total (additive)", async () => {
  seed(12);
  const r = await call("/api/tensions");
  assert.equal(r.body.count, 12);
  for (const k of ["tensions", "count", "filter", "note"]) assert.ok(k in r.body, k);
  assert.equal("limit" in r.body, false);
});

test("text search still works across pages", async () => {
  seed(1100);
  const r = await call("/api/tensions?q=topic%201099");
  assert.equal(r.body.count, 1);
});

test("a malformed blob is skipped, not fatal", async () => {
  seed(5);
  mem.__seed("tensions/zz-broken.json", "{ not json");
  const r = await call("/api/tensions");
  assert.equal(r.status, 200); assert.equal(r.body.count, 5);
});

test("it is cacheable (the registry changes only on persist)", async () => {
  seed(3);
  const r = await call("/api/tensions");
  assert.match(String(r.headers["cache-control"]), /s-maxage=60/);
});
