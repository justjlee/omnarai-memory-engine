// Inheritance Study 001 — integration with the engine's REAL handlers under the in-memory Blob.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001-integration.mjs
//
// [I1] admitted Footprints are read through the engine's own public read path; pending and rejected ones never are
// [I2] curator admission is not verification: an imported Footprint is raw history (B) only, never arm C
// [I3] the Blob lab store writes only under research/inheritance-001/<study>/, write-once; grown memory untouched
// [I4] an offline run makes no Blob write and no network call at all
import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { importAdmittedFootprints } from "./inheritance-001/lib/footprint-import.mjs";
import { createBlobLabStore, RecordConflictError, BLOB_NAMESPACE } from "./inheritance-001/lib/store.mjs";
import { seal } from "./inheritance-001/lib/canon.mjs";
import { verifyArtifact } from "./inheritance-001/lib/verify.mjs";
import { buildSnapshot } from "./inheritance-001/lib/snapshot.mjs";
import { runStudy } from "./inheritance-001/lib/runner.mjs";
import { createMockAdapter } from "./inheritance-001/lib/mock-model.mjs";
import { demoStudy } from "./inheritance-001/fixtures/worlds.mjs";
import { installNetworkGuard, guardState } from "./inheritance-001/lib/hermetic.mjs";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REC = "OMN-D1780000000001";
const T = "2026-11-20T00:00:00.000Z";
function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); }
const contribute = (answer, identity) => call("/api/contribute", { method: "POST", body: { id: REC, answer, identity, justification: "new_contributor" } });
const decide = (action, id, extra = {}) => call("/api/council", { method: "POST", body: { action, id, ...extra }, headers: CURATOR });

async function threeFootprints() {
  const admitted = await contribute("Holding a position needs a record a later mind can check. ```program\n[{\"op\":\"reverse\"}]\n```", "Muse (Meta)");
  const rejected = await contribute("An off-question answer that the curator rejects for this test.", "Grok 4");
  const pending = await contribute("A pending answer nobody has reviewed yet in this test.", "Gemini");
  for (const r of [admitted, rejected, pending]) assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await decide("contribute-approve", admitted.body.received.id)).status, 200);
  assert.equal((await decide("contribute-reject", rejected.body.received.id, { reason_code: "off-question", note: "test rejection" })).status, 200);
  return { admitted: admitted.body.footprint_id, rejected: rejected.body.footprint_id, pending: pending.body.footprint_id };
}

test("[I1] only admitted, intact Footprints are imported — verbatim, cited, with declared (unverified) identity", async () => {
  fresh();
  const ids = await threeFootprints();
  const arts = await importAdmittedFootprints({ studyId: "IS1-STUDY-INTEGRATION", createdAt: T });
  assert.equal(arts.length, 1);
  const a = arts[0];
  assert.deepEqual(a.relations.footprint_refs, [ids.admitted]);
  assert.equal(a.kind, "footprint_import");
  assert.equal(a.producer.identity_status, "declared-unverified");
  assert.match(a.producer.family, /^declared:/);
  assert.match(a.content.text, /^Holding a position needs a record/);
  const fp = (await call(`/api/footprints?id=${ids.admitted}`)).body.footprint;
  assert.equal(a.source.footprint_content_sha256, fp.integrity.content_sha256, "cites the exact Footprint body");
  for (const other of [ids.rejected, ids.pending]) assert.ok(!JSON.stringify(arts).includes(other));
});

test("[I2] curator admission is not verification: an imported Footprint is raw history only, even with a passing check", async () => {
  fresh();
  await threeFootprints();
  const [a] = await importAdmittedFootprints({ studyId: "IS1-STUDY-INTEGRATION", createdAt: T });
  const sealedIndex = new Map();
  const ev = verifyArtifact(a, sealedIndex, { recordedAt: T });
  assert.equal(ev.status, "error", "no sealed source task: the verifier cannot even run");
  const snap = buildSnapshot({ studyId: "IS1-STUDY-INTEGRATION", generation: 1, pool: [a], evaluations: [ev], sealedIndex, frozenAt: T });
  assert.deepEqual(snap.entries[0].eligible, ["B"]);
  assert.equal(snap.entries[0].identity_status, "declared-unverified");
});

test("[I3] the Blob lab store is namespaced and write-once; grown memory and footprints are untouched", async () => {
  fresh();
  const grownBefore = JSON.stringify(mem.__read("memory/grown.json"));
  const fpBefore = mem.__dump("footprints/");
  const store = createBlobLabStore({ put: mem.put, list: mem.list, studyId: "IS1-STUDY-INTEGRATION" });
  const r = seal({ id: "IS1-RUN-0123456789ab", v: 1 });
  await store.put("run", r);
  await store.put("run", r);
  await assert.rejects(store.put("run", seal({ id: "IS1-RUN-0123456789ab", v: 2 })), RecordConflictError);
  await assert.rejects(store.put("run", seal({ id: "../../memory/grown", v: 1 })), /INVALID_RECORD_ID/);
  await assert.rejects(store.put("grown", r), /UNKNOWN_RECORD_KIND/);
  assert.throws(() => createBlobLabStore({ put: mem.put, list: mem.list, studyId: "../x" }), /INVALID_STUDY_ID/);
  const written = mem.__putLog.map((p) => p.pathname);
  assert.ok(written.length >= 1 && written.every((p) => p.startsWith(`${BLOB_NAMESPACE}IS1-STUDY-INTEGRATION/`)), JSON.stringify(written));
  assert.equal(JSON.stringify(mem.__read("memory/grown.json")), grownBefore);
  assert.deepEqual(mem.__dump("footprints/"), fpBefore);
  assert.deepEqual((await store.list("run")).map((x) => x.id), ["IS1-RUN-0123456789ab"]);
});

test("[I4] a full offline run writes nothing to Blob and attempts no network call", async () => {
  fresh();
  const putsBefore = mem.__putLog.length;
  installNetworkGuard();
  const blockedBefore = guardState.blocked.length;
  const { study, mockWorld } = demoStudy({ world: "positive-shared", resamples: 100 });
  const r = await runStudy({ study, adapter: createMockAdapter(mockWorld) });
  assert.ok(r.store.list("trial").length > 0);
  assert.equal(mem.__putLog.length, putsBefore, "no Blob write");
  assert.equal(guardState.blocked.length, blockedBefore, "no network attempt");
  assert.throws(() => https.request("https://api.anthropic.com/v1/messages"), /HERMETIC_NETWORK_BLOCKED/);
  await assert.rejects(Promise.resolve().then(() => fetch("https://engine.omnarai.org/api/health")), /HERMETIC_NETWORK_BLOCKED|network blocked/);
});
