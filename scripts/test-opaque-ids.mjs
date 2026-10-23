// Tests for session and async-job ids (api/query.js). Hermetic — in-memory Blob,
// no network, no keys:
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-opaque-ids.mjs
//
// WHY THIS FILE EXISTS. A session id or job id is the only key to what it points at:
// the blobs are public at unlisted URLs. Until 2026-10-21 both were looked up with
// list({prefix}) + blobs[0], so `GET /api/query?job=a` returned the first stored job
// whose id began with "a" (another caller's question and full answer), and a
// one-character session_id pulled a stranger's recent exchanges into the prompt.
// The load-bearing assertions: a shortened or neighbouring id never reads someone
// else's record, and an expired record is never read back.
import assert from "node:assert/strict";
import { put, __reset, __dump } from "@vercel/blob";
import handler, { isOpaqueId, loadSession, saveSession, readJob } from "../api/query.js";

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`  ✅ ${name}`); };
const age = (pathname, ms) => { globalThis.__MEM_BLOB__.files.get(pathname).uploadedAt = new Date(Date.now() - ms); };

const A = "3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60";
const A_NEIGHBOUR = "3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f61";
const B = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

function call(query) {
  return new Promise((resolve) => {
    const res = {
      _status: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(s) { this._status = s; return this; },
      json(body) { resolve({ status: this._status, body }); return this; },
      end() { resolve({ status: this._status, body: null }); return this; },
    };
    handler({ method: "GET", query, headers: {}, body: undefined }, res);
  });
}

console.log("== which ids are accepted ==");
await t("a UUID is accepted, either case", () => {
  assert.equal(isOpaqueId(A), true);
  assert.equal(isOpaqueId(A.toUpperCase()), true);
});
await t("anything else is refused", () => {
  for (const bad of ["", "a", A.slice(0, 35), A + "0", A + ".json", "../memory/grown", `${A}/x`, " " + A, null, undefined, 42, [A]]) {
    assert.equal(isOpaqueId(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

console.log("\n== async jobs: exact lookup only ==");
__reset();
await put(`jobs/${A}.json`, JSON.stringify({ status: "done", result: { answer: "SECRET-A" } }), { addRandomSuffix: false });
await t("the exact id reads its own job", async () => {
  const r = await call({ job: A });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.answer, "SECRET-A");
});
await t("a one-character prefix is refused (400), never another caller's job", async () => {
  const r = await call({ job: "3" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_JOB_ID");
  assert.doesNotMatch(JSON.stringify(r.body), /SECRET-A/);
});
await t("an id one character short is refused", async () => {
  const r = await call({ job: A.slice(0, 35) });
  assert.equal(r.status, 400);
  assert.doesNotMatch(JSON.stringify(r.body), /SECRET-A/);
});
await t("a different valid id that shares 35 characters reads nothing", async () => {
  const r = await call({ job: A_NEIGHBOUR });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "pending");
  assert.doesNotMatch(JSON.stringify(r.body), /SECRET-A/);
});
await t("a job past its 1h lifetime reads as unknown", async () => {
  age(`jobs/${A}.json`, 61 * 60 * 1000);
  assert.equal(await readJob(A), null);
  const r = await call({ job: A });
  assert.equal(r.body.status, "pending");
  assert.doesNotMatch(JSON.stringify(r.body), /SECRET-A/);
});

console.log("\n== sessions: exact lookup, 24h lifetime ==");
__reset();
const fresh = (q) => ({ session_id: A, createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), exchanges: [{ query: q, answer: "x" }] });
await saveSession(A, fresh("PRIVATE-QUESTION-A"));
await t("the exact id loads its own session", async () => {
  const s = await loadSession(A);
  assert.equal(s.exchanges[0].query, "PRIVATE-QUESTION-A");
});
await t("a prefix or a neighbouring id loads nothing", async () => {
  for (const id of ["3", "3f2b", A.slice(0, 35), A_NEIGHBOUR]) assert.equal(await loadSession(id), null, id);
});
await t("an invalid id is never written", async () => {
  await saveSession("not-a-uuid", fresh("x"));
  await saveSession("../memory/grown", fresh("x"));
  assert.deepEqual(__dump("sessions/"), [`sessions/${A}.json`]);
  assert.deepEqual(__dump().filter((k) => /not-a-uuid|grown/.test(k)), []);
});
await t("an expired session is not read back, and is deleted on lookup", async () => {
  await saveSession(B, { ...fresh("OLD-B"), lastActiveAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  assert.equal(await loadSession(B), null);
  assert.deepEqual(__dump("sessions/"), [`sessions/${A}.json`]);
});
await t("saving any session sweeps sessions untouched for 24h", async () => {
  await put(`sessions/${B}.json`, JSON.stringify(fresh("OLD-B")), { addRandomSuffix: false });
  age(`sessions/${B}.json`, 25 * 3600 * 1000);
  await saveSession(A, fresh("PRIVATE-QUESTION-A2"));
  assert.deepEqual(__dump("sessions/"), [`sessions/${A}.json`]);
});

console.log(`\n${n} passed`);
