// Grown-memory write guard: a failed READ must never become a WRITE of "empty".
// Every grown-memory write is load-modify-write of the whole file, so before
// 2026-09-29 an unreadable store (network blip, LIST hiccup, bad JSON) made
// appendGrownEntries put back ONE entry — erasing every other record. Writers now
// load with { strict: true } and abort. Offline: @vercel/blob and fetch are mocked;
// nothing touches the real store.
//
//   node --experimental-test-module-mocks scripts/test-grown-guard.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = { listImpl: null, puts: [] };
mock.module("@vercel/blob", {
  namedExports: {
    list: async (...a) => state.listImpl(...a),
    put: async (key, body) => { state.puts.push({ key, body: JSON.parse(body) }); return { url: "x" }; },
  },
});
const { loadGrownMemory, appendGrownEntry, patchGrownCertifications } = await import("../api/_grown.js");

const listed = async () => ({ blobs: [{ url: "https://blob.test/memory/grown.json" }] });
const stored = { version: 1, updatedAt: "2026-09-29", vectors: {}, entries: [
  { id: "OMN-A", ring: "open", type: "divergence", divergence: { tensions: [] } },
  { id: "OMN-B", ring: "open" },
] };
const respond = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const newEntry = { id: "OMN-NEW", title: "t", ring: "open" };

function setup(listImpl, fetchImpl) {
  state.listImpl = listImpl;
  state.puts = [];
  globalThis.fetch = fetchImpl;
}

const failures = {
  "LIST throws": [async () => { throw new Error("network"); }, respond(200, stored)],
  "LIST returns no blob": [async () => ({ blobs: [] }), respond(200, stored)],
  "read returns HTTP 503": [listed, respond(503, "unavailable")],
  "read returns invalid JSON": [listed, respond(200, "{truncated")],
  "read has no entries array": [listed, respond(200, { version: 1 })],
  "fetch throws": [listed, async () => { throw new Error("socket hang up"); }],
};

for (const [name, [l, f]] of Object.entries(failures)) {
  test(`append: ${name} → returns null and writes NOTHING`, async () => {
    setup(l, f);
    assert.equal(await appendGrownEntry(newEntry), null);
    assert.equal(state.puts.length, 0);
  });
  test(`patch certs: ${name} → returns null and writes NOTHING`, async () => {
    setup(l, f);
    assert.equal(await patchGrownCertifications({ "OMN-A": { tier: "C1" } }), null);
    assert.equal(state.puts.length, 0);
  });
  test(`reader: ${name} → still fail-soft (empty, no throw)`, async () => {
    setup(l, f);
    const g = await loadGrownMemory();
    assert.deepEqual(g.entries, []);
  });
}

test("append happy path: keeps existing entries and adds the new one, in one put", async () => {
  setup(listed, respond(200, stored));
  assert.equal(await appendGrownEntry(newEntry), 3);
  assert.equal(state.puts.length, 1);
  assert.deepEqual(state.puts[0].body.entries.map((e) => e.id), ["OMN-A", "OMN-B", "OMN-NEW"]);
});

test("append is idempotent by id", async () => {
  setup(listed, respond(200, stored));
  assert.equal(await appendGrownEntry({ id: "OMN-A", ring: "open" }), 2);
  assert.deepEqual(state.puts[0].body.entries.map((e) => e.id), ["OMN-A", "OMN-B"]);
});

test("patch certs happy path: patches the named record, keeps the rest", async () => {
  setup(listed, respond(200, stored));
  assert.equal(await patchGrownCertifications({ "OMN-A": { tier: "C1" } }), 1);
  assert.equal(state.puts[0].body.entries.length, 2);
  assert.equal(state.puts[0].body.entries[0].divergence.certification.tier, "C1");
});
