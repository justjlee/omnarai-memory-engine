// Grown-memory races: a write must never erase a record another writer stored.
// Every grown-memory write is a read-modify-write of one whole file. Until
// 2026-11-04 the put was unconditional, so a writer that read a stale copy (CDN
// lag) or raced another writer put back a file missing the other's records: 2 of
// 5 elicit-002 records were lost that way on 2026-11-03. Writers now put
// conditionally on the ETag of what they read and retry from a fresh read.
// Hermetic: runs against the in-memory store, which enforces @vercel/blob 2.x
// ETag / ifMatch / allowOverwrite semantics.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-grown-race.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.GROWN_WRITE_BACKOFF_MS = "1";
const mem = await import("@vercel/blob");
const { appendGrownEntry, appendGrownEntries, patchGrownCertifications } = await import("../api/_grown.js");

const KEY = "memory/grown.json";
const seed = { version: 1, updatedAt: "2026-11-03", vectors: {}, entries: [
  { id: "OMN-A", ring: "open", type: "divergence", divergence: { tensions: [] } },
] };
const ids = () => mem.__read(KEY).entries.map((e) => e.id).sort();
const entry = (id) => ({ id, title: id, ring: "open" });

beforeEach(() => {
  mem.__reset();
  mem.__seed(KEY, seed);
});

test("[R1] the 2026-11-03 case: a writer reading a stale copy does not erase the record written just before", async () => {
  assert.equal(await appendGrownEntry(entry("OMN-X")), 2);
  // The next read of grown.json is served from a lagging edge: the copy from
  // before OMN-X, with that copy's ETag. Later reads are fresh.
  let stale = 1;
  mem.__faults.staleRead = (k) => k === KEY && stale-- > 0;
  assert.equal(await appendGrownEntry(entry("OMN-Y")), 3);
  assert.deepEqual(ids(), ["OMN-A", "OMN-X", "OMN-Y"]);
});

test("[R2] five concurrent appends: every record is kept", async () => {
  const counts = await Promise.all(["OMN-1", "OMN-2", "OMN-3", "OMN-4", "OMN-5"].map((id) => appendGrownEntry(entry(id))));
  assert.ok(counts.every((c) => c !== null), `a writer gave up: ${counts}`);
  assert.deepEqual(ids(), ["OMN-1", "OMN-2", "OMN-3", "OMN-4", "OMN-5", "OMN-A"]);
});

test("[R3] a batch append racing a certification patch: both land", async () => {
  const [n, patched] = await Promise.all([
    appendGrownEntries([{ entry: entry("OMN-B1") }, { entry: entry("OMN-B2") }]),
    patchGrownCertifications({ "OMN-A": { tier: "C1" } }),
  ]);
  assert.notEqual(n, null);
  assert.equal(patched, 1);
  const g = mem.__read(KEY);
  assert.deepEqual(g.entries.map((e) => e.id).sort(), ["OMN-A", "OMN-B1", "OMN-B2"]);
  assert.equal(g.entries.find((e) => e.id === "OMN-A").divergence.certification.tier, "C1");
});

test("[R4] reads that stay stale: the writer gives up and writes NOTHING", async () => {
  assert.equal(await appendGrownEntry(entry("OMN-X")), 2);
  mem.__faults.staleRead = (k) => k === KEY;
  const putsBefore = mem.__putLog.length;
  assert.equal(await appendGrownEntry(entry("OMN-Y")), null);
  assert.equal(mem.__putLog.length, putsBefore, "no put may land from a stale base");
  assert.deepEqual(ids(), ["OMN-A", "OMN-X"]);
});

test("[R5] a put failure that isn't a lost race: returns null, no retry, nothing written", async () => {
  let calls = 0;
  mem.__faults.put = (k) => k === KEY && ++calls > 0;
  assert.equal(await appendGrownEntry(entry("OMN-X")), null);
  assert.equal(calls, 1);
  assert.deepEqual(ids(), ["OMN-A"]);
});

test("[R6] a retried certification patch keeps one history entry, not one per attempt", async () => {
  assert.equal(await patchGrownCertifications({ "OMN-A": { tier: "C0" } }), 1);
  let stale = 1;
  mem.__faults.staleRead = (k) => k === KEY && stale-- > 0;
  assert.equal(await patchGrownCertifications({ "OMN-A": { tier: "C1" } }), 1);
  const cert = mem.__read(KEY).entries[0].divergence.certification;
  assert.equal(cert.tier, "C1");
  assert.deepEqual(cert.history, [{ tier: "C0" }]);
});
