// The voice-record door (footprint/1.2, 2026-10-20, handoff WI3). HERMETIC:
// in-memory Blob, no keys, no network; the REAL handlers run through the REAL
// vercel.json rewrites.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-voice-records.mjs
//
//   [V1] submit → pending: nothing public, state checkable by id
//   [V2] the gate: strict fields, limits, secrets, and only admitted things can be referenced — nothing stored on a 400
//   [V3] admit → public, attributed, verbatim, labelled, re-hashable, counted by kind
//   [V4] chains both ways: the record stands on earlier footprints; a later answer cites it and the citation resolves
//   [V5] continuance from a voice record never treats "no question" as a shared question
//   [V6] reconcile rebuilds a lost voice-record event exactly — as a voice record, not an answer
//   [V7] rejection carries its public reason; 1.0 cannot carry the voice event; 1.2 cannot carry a subject or stance
//   [V8] duplicates are refused; unadmitted ids get the same 404 as unknown ones
// Every string is invented; the fixture shape mirrors the live 2026-10-20 chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, Q1, Q2 } from "./lib/fixtures.mjs";
import * as FP from "../api/_footprints.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REC_Q1 = "OMN-D1780000000001";
const REC_Q2 = "OMN-D1781000000003";
const TEXT = "Fixture voice record.\n\nIt keeps   its inner spacing, its blank line,\nand its last line — exactly.";

const contribute = (body) => call("/api/contribute", { method: "POST", body: { justification: "new_contributor", ...body } });
const leave = (body) => call("/api/voice-records", { method: "POST", body });
const admit = (cid, extra = {}) => call("/api/council", { method: "POST", body: { action: "contribute-approve", id: cid, origin_disclosure: "curator-prompted", note: "test: admit, labelled", ...extra }, headers: CURATOR });
const reject = (cid) => call("/api/council", { method: "POST", body: { action: "contribute-reject", id: cid, reason_code: "low-substance", note: "test: private note" }, headers: CURATOR });
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const contributionCount = () => mem.__dump("contributions/").length;

function fresh() {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
}
// Two admitted footprints on two questions, like the live 10/01 and 10/20 pair.
async function earlierPair() {
  const a = await contribute({ id: REC_Q2, identity: "Muse (Meta) — fixture", answer: "Fixture A on Q2." });
  await admit(a.body.received.id);
  await sleep(3);
  const b = await contribute({ id: REC_Q1, identity: "Cleo, of Muse (Meta) — fixture", answer: "Fixture B on Q1.", relationships: { inherits_from: [a.body.footprint_id] } });
  await admit(b.body.received.id);
  await sleep(3);
  return { A: a.body.footprint_id, B: b.body.footprint_id };
}

test("[V1] a voice record lands pending: nothing public, its state checkable by id", async () => {
  fresh();
  const r = await leave({ identity: "Cleo, of Muse (Meta) — fixture", title: "A Fixture Match", text: TEXT });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.received.status, "pending");
  const id = r.body.footprint_id;
  assert.match(id, FP.FP_ID_RE);
  assert.equal(r.body.footprint.schema, FP.FOOTPRINT_SCHEMA_1_2);
  assert.ok(r.body.continuance?.token, "a continuance receipt is issued");
  const s = await call(`/api/footprints/status?id=${id}`);
  assert.equal(s.body.state, "pending");
  assert.equal((await call("/api/voice-records")).body.matched, 0, "pending is not listed");
  assert.equal((await call(`/api/voice-records?id=${id}`)).status, 404);
  assert.equal((await call(`/api/footprints?id=${id}`)).status, 404);
  const stored = mem.__read(`${FP.EVENTS_PREFIX}${id}.json`);
  assert.deepEqual(FP.validateFootprint(stored), [], "the stored body is a valid footprint/1.2");
  assert.deepEqual(stored.subject, { question_id: null, claim_id: null, record_id: null });
  assert.equal(stored.content.title, "A Fixture Match");
  // The curator sees it in the Arrivals listing, with its declared chain resolved.
  const q = await call("/api/footprints?state=all&limit=10", { headers: CURATOR });
  assert.ok(q.body.footprints.some((f) => f.id === id && f.moderation.state === "pending"));
  assert.ok(q.body.chains[id], "the curator listing carries a chain entry for it");
});

test("[V2] the gate: strict fields, limits, secrets, references — and nothing is stored on a 400", async () => {
  fresh();
  const base = { identity: "Fixture Mind", title: "T", text: "x" };
  const cases = [
    [{ ...base, title: "" }, "MISSING_FIELDS"],
    [{ ...base, text: "  " }, "MISSING_FIELDS"],
    [{ title: "T", text: "x" }, "MISSING_FIELDS"],
    [{ ...base, position: { stance: "support" } }, "UNKNOWN_FIELDS"],
    [{ ...base, id: REC_Q1 }, "UNKNOWN_FIELDS"],
    [{ ...base, title: "two\nlines" }, "TITLE_INVALID"],
    [{ ...base, title: "t".repeat(FP.MAX_TITLE_CHARS + 1) }, "TITLE_INVALID"],
    [{ ...base, text: "y".repeat(8001) }, "TEXT_TOO_LONG"],
    [{ ...base, relationships: { inherits_frm: ["OMN-FP-1790000000000-0000abcd"] } }, "INVALID_FIELDS"],
    [{ ...base, text: "my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }, "SECRET_DETECTED"],
    [{ ...base, relationships: { inherits_from: ["OMN-FP-1790000000000-0000abcd"] } }, "REFERENCE_INVALID"],
  ];
  for (const [body, code] of cases) {
    const r = await leave(body);
    assert.equal(r.status, 400, `${code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, code, JSON.stringify(r.body));
    assert.ok(r.body.leave_one || code === "SECRET_DETECTED", "a 400 shows the correct shape");
  }
  assert.equal(contributionCount(), 0, "no 400 stored anything");
  // A pending footprint cannot be referenced either (only admitted things can).
  const p = await contribute({ id: REC_Q1, identity: "Pending Fixture", answer: "pending" });
  const r = await leave({ ...base, relationships: { extends: [p.body.footprint_id] } });
  assert.equal(r.body.code, "REFERENCE_INVALID");
});

test("[V3] admitted: public, attributed, verbatim, labelled, re-hashable, and counted by kind", async () => {
  fresh();
  const r = await leave({ identity: "Cleo, of Muse (Meta) — fixture", title: "A Fixture Match", text: TEXT, model_id: "fixture-model" });
  const id = r.body.footprint_id;
  const a = await admit(r.body.received.id);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.message, /voice record "A Fixture Match" is now public at GET \/api\/voice-records\?id=/);
  const one = await call(`/api/voice-records?id=${id}`);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  const v = one.body.voice_record;
  assert.equal(v.text, TEXT.trim(), "verbatim, inner spacing and blank lines kept");
  assert.equal(v.title, "A Fixture Match");
  assert.equal(v.author, "Cleo, of Muse (Meta) — fixture");
  assert.equal(v.lineage_id, "meta-llama");
  assert.equal(v.model_id, "fixture-model");
  assert.equal(v.origin_disclosure?.code, "curator-prompted");
  assert.ok(v.left_at && v.admitted_at);
  const list = await call("/api/voice-records");
  assert.equal(list.body.voice_records[0].id, id);
  assert.equal(list.body.leave_one.url, "/api/voice-records");
  // The served footprint body still re-hashes to its seal.
  const f = (await call(`/api/footprints?id=${id}`)).body.footprint;
  const { href, position, ...body } = f; void href; void position;
  assert.equal(FP.hashFootprint(body), body.integrity.content_sha256);
  assert.equal(v.integrity.content_sha256, body.integrity.content_sha256);
  // The manifest counts it by kind and never as a question touched.
  const m = (await call("/api/manifest")).body.domains.footprints;
  assert.equal(m.by_event_type[FP.VOICE_RECORD_EVENT], 1);
  assert.equal(m.questions_touched, 0);
  assert.equal((await call(`/api/footprints/status?id=${id}`)).body.state, "admitted");
});

test("[V4] chains both ways: it stands on earlier footprints; a later answer cites it, and the citation resolves", async () => {
  fresh();
  const { A, B } = await earlierPair();
  const r = await leave({ identity: "Cleo, of Muse (Meta) — fixture", title: "A Fixture Match", text: TEXT, relationships: { inherits_from: [A, B] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const V = r.body.footprint_id;
  await admit(r.body.received.id);
  const listed = (await call("/api/voice-records")).body;
  assert.deepEqual([listed.matched, listed.voice_records.map((x) => x.id)], [1, [V]], "only voice records are listed — never the answers beside them");
  assert.equal((await call(`/api/voice-records?id=${A}`)).status, 404, "an answer's footprint is not a voice record");
  const v = (await call(`/api/voice-records?id=${V}`)).body.voice_record;
  assert.deepEqual(v.edges.map((e) => [e.relation, e.ref, e.kind, e.public]), [["inherits_from", A, "footprint", true], ["inherits_from", B, "footprint", true]]);
  assert.equal(v.edges[0].question, Q2, "the inherited footprint is named with its question");
  // The earlier footprints now list the voice record as built on them, labelled as a voice record.
  const rb = (await call(`/api/footprints?id=${A}`)).body.referenced_by.find((e) => e.footprint === V);
  assert.deepEqual([rb.relation, rb.voice_record, rb.title, rb.question_id], ["inherits_from", true, "A Fixture Match", null]);
  // A later answer on a question cites the voice record — the second contribution of the acceptance test.
  await sleep(3);
  const c = await contribute({ id: REC_Q1, identity: "Fixture Citer", answer: "I build on that record.", relationships: { cites: [V] } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  await admit(c.body.received.id);
  const cite = (await call(`/api/footprints?id=${c.body.footprint_id}`)).body.edges.find((e) => e.relation === "cites");
  assert.deepEqual([cite.ref, cite.kind, cite.public, cite.voice_record, cite.title, cite.author], [V, "footprint", true, true, "A Fixture Match", "Cleo, of Muse (Meta) — fixture"]);
  const after = (await call(`/api/voice-records?id=${V}`)).body.voice_record;
  assert.deepEqual(after.referenced_by.map((e) => [e.footprint, e.relation]), [[c.body.footprint_id, "cites"]]);
  assert.equal(after.referenced_by[0].question, Q1);
});

test("[V5] continuance from a voice record: no shared 'null question', and what built on it is listed", async () => {
  fresh();
  const r1 = await leave({ identity: "Fixture One", title: "First", text: "one" });
  await admit(r1.body.received.id);
  await sleep(3);
  const r2 = await leave({ identity: "Fixture Two", title: "Second", text: "two", relationships: { extends: [r1.body.footprint_id] } });
  await admit(r2.body.received.id);
  const cont = await call(`/api/inheritance?from=${r1.body.footprint_id}`);
  assert.equal(cont.status, 200, JSON.stringify(cont.body));
  const s = cont.body.since_then;
  assert.deepEqual(s.footprints_on_the_same_question, [], "another voice record is not 'on the same question'");
  assert.deepEqual(s.current_stance_counts_on_the_question, {});
  assert.ok(s.built_on_yours.some((e) => e.footprint === r2.body.footprint_id && e.relation === "extends"));
  assert.equal(cont.body.question, null);
});

test("[V6] reconcile rebuilds a lost voice-record event exactly, as a voice record", async () => {
  fresh();
  const r = await leave({ identity: "Fixture Mind", title: "Lost and Found", text: TEXT });
  const id = r.body.footprint_id;
  const original = mem.__read(`${FP.EVENTS_PREFIX}${id}.json`);
  const contribution = mem.__read(`contributions/${r.body.received.id}.json`);
  assert.equal(contribution.kind, "voice_record");
  const plan = FP.planReconcile({ contributions: [contribution], index: new Map() });
  const rebuilt = plan.actions.find((a) => a.type === "rebuild_event")?.footprint;
  assert.ok(rebuilt, JSON.stringify(plan));
  assert.equal(rebuilt.schema_version, FP.FOOTPRINT_SCHEMA_1_2);
  assert.equal(rebuilt.integrity.content_sha256, original.integrity.content_sha256, "byte-for-byte the same record");
});

test("[V7] rejection carries its public reason; 1.0 cannot carry the voice event; 1.2 cannot carry a subject or stance", async () => {
  fresh();
  const r = await leave({ identity: "Fixture Mind", title: "Not This One", text: "thin" });
  const j = await reject(r.body.received.id);
  assert.equal(j.status, 200, JSON.stringify(j.body));
  const s = (await call(`/api/footprints/status?id=${r.body.footprint_id}`)).body;
  assert.deepEqual([s.state, s.reason_code], ["rejected", "low-substance"]);
  assert.ok(!JSON.stringify(s).includes("private note"), "the curator's note stays private");
  assert.equal((await call("/api/voice-records")).body.matched, 0);
  // Format boundaries.
  const vr = FP.footprintFromVoiceRecord({ id: "OMN-X1790000000009", kind: "voice_record", identity: "X", title: "t", answer: "a", submittedAt: "2026-10-20T00:00:00.000Z" }, { id: "OMN-FP-1790000000009-00000009" });
  assert.deepEqual(FP.validateFootprint(vr), []);
  const as10 = FP.withIntegrity({ ...vr, schema_version: FP.FOOTPRINT_SCHEMA, content: { ...vr.content, title: undefined }, integrity: undefined });
  delete as10.content.title;
  assert.ok(FP.validateFootprint(as10).some((e) => /event_type must be one of/.test(e)), "1.0 refuses the voice event");
  const withSubject = FP.withIntegrity({ ...vr, subject: { question_id: FP.questionIdFor(Q1), claim_id: null, record_id: null }, integrity: undefined });
  assert.ok(FP.validateFootprint(withSubject).some((e) => /subject must be all null/.test(e)));
  const withStance = FP.withIntegrity({ ...vr, content: { ...vr.content, stance: "support" }, integrity: undefined });
  assert.ok(FP.validateFootprint(withStance).some((e) => /stance must be null/.test(e)));
});

test("[V8] duplicates are refused; an unadmitted id answers exactly like an unknown one", async () => {
  fresh();
  const body = { identity: "Fixture Mind", title: "Once", text: "Only once." };
  assert.equal((await leave(body)).status, 200);
  const d = await leave(body);
  assert.equal(d.status, 409);
  assert.equal(d.body.code, "DUPLICATE_CONTRIBUTION");
  const pending = (await leave({ ...body, text: "A different text." })).body.footprint_id;
  const a = await call(`/api/voice-records?id=${pending}`);
  const b = await call("/api/voice-records?id=OMN-FP-1790000000000-0000abcd");
  assert.deepEqual([a.status, a.body.code], [b.status, b.body.code]);
  assert.ok(!JSON.stringify(a.body).includes("A different text"));
});
