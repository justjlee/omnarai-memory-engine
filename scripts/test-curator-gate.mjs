// Tests for the curator gate on /api/store and /api/concepts (api/_curator.js).
// Hermetic — in-memory Blob, no network, no keys:
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-curator-gate.mjs
//
// WHY THIS FILE EXISTS. Until 2026-10-21 approve/reject on both endpoints had no
// check. Anyone could POST a proposal, approve it into grown memory (which the
// engine merges into the corpus it serves and retrieves from) and pick its ring,
// "core" included. The load-bearing assertion: without the curator's key, a
// proposal stays pending and grown memory is not written.
import assert from "node:assert/strict";
import { __reset, __dump, __read } from "@vercel/blob";

process.env.INGEST_SECRET = "test-curator-secret";
const { default: store } = await import("../api/store.js");
const { default: concepts } = await import("../api/concepts.js");
const { curatorAuthed } = await import("../api/_curator.js");

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ✅ ${name}`); };

function call(handler, { method = "POST", query = {}, body, auth } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      _status: 200,
      setHeader() { return this; },
      status(s) { this._status = s; return this; },
      json(b) { resolve({ status: this._status, body: b }); return this; },
      end() { resolve({ status: this._status, body: null }); return this; },
    };
    const headers = auth ? { authorization: `Bearer ${auth}` } : {};
    handler({ method, query, body, headers }, res).catch(reject);
  });
}

console.log("== the key check itself ==");
await t("only the exact secret passes", () => {
  assert.equal(curatorAuthed({ headers: { authorization: "Bearer test-curator-secret" } }), true);
  for (const h of [{}, { authorization: "" }, { authorization: "Bearer " }, { authorization: "Bearer test-curator-secre" },
    { authorization: "Bearer test-curator-secretX" }, { authorization: "test-curator-secret-wrong" }]) {
    assert.equal(curatorAuthed({ headers: h }), false, JSON.stringify(h));
  }
});
await t("no secret configured ⇒ closed, even for an empty bearer", () => {
  const saved = process.env.INGEST_SECRET;
  delete process.env.INGEST_SECRET;
  assert.equal(curatorAuthed({ headers: { authorization: "Bearer " } }), false);
  process.env.INGEST_SECRET = saved;
});

console.log("\n== /api/store: anyone may propose, only the curator decides ==");
__reset();
const proposed = await call(store, { query: { action: "propose" }, body: { query: "q", answer: "INJECTED TEXT" } });
const id = proposed.body?.proposal?.id;
await t("propose stays open (lands pending)", () => {
  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.proposal.provenance.status, "pending");
});
await t("approve without the key → 401, proposal still pending, grown memory untouched", async () => {
  const r = await call(store, { query: { action: "approve" }, body: { id, ring: "core" } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "CURATOR_ONLY");
  assert.equal(__read(`proposals/${id}.json`).provenance.status, "pending");
  assert.deepEqual(__dump("memory/"), []);
});
await t("approve with a wrong key → 401", async () => {
  const r = await call(store, { query: { action: "approve" }, body: { id }, auth: "guess" });
  assert.equal(r.status, 401);
  assert.deepEqual(__dump("memory/"), []);
});
await t("reject without the key → 401", async () => {
  const r = await call(store, { query: { action: "reject" }, body: { id } });
  assert.equal(r.status, 401);
});
await t("the curator's key gets past the gate", async () => {
  const r = await call(store, { query: { action: "reject" }, body: { id }, auth: "test-curator-secret" });
  assert.notEqual(r.status, 401);
});

console.log("\n== /api/concepts ==");
for (const action of ["approve", "reject"]) {
  await t(`${action} without the key → 401`, async () => {
    const r = await call(concepts, { query: { action }, body: { id: "OMN-S1" } });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "CURATOR_ONLY");
  });
}

console.log(`\n${n} passed`);
