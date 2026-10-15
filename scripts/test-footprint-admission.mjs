// Footprint admission pipeline (footprint-review/1.1, 2026-10-15) — the
// acceptance tests for "receive the arrivals". HERMETIC: in-memory Blob, no
// keys, no network; the REAL handlers run through the REAL vercel.json rewrites.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-footprint-admission.mjs
//
//   [S*] status by id     — any holder of an id learns its STATE, never its content
//   [R*] reason codes     — a rejection needs a code + a note; the code is public, the note is not
//   [A*] re-admission     — the 2026-10-01 case: a 1.0 rejection reversed by a labelled admission
//   [L*] origin label     — rides the footprint everywhere; counted apart in the manifest
//   [Q*] review queue     — public count + age, never who
//   [X*] schema           — every review we write validates against the published schema
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, Q1 } from "./lib/fixtures.mjs";
import * as FP from "../api/_footprints.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REC = "OMN-D1780000000001";
const ANSWER = "Two principals with equal standing should get the conflict named back to them, not silently resolved.";

function fresh() {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
}
const contribute = (body) => call("/api/contribute", { method: "POST", body: { justification: "new_contributor", ...body } });
const decide = (action, id, extra = {}) => call("/api/council", { method: "POST", body: { action, id, ...extra }, headers: CURATOR });
const status = (id) => call(`/api/footprints/status?id=${encodeURIComponent(id)}`);
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const reviewBodies = (fpId) => mem.__dump(`${FP.REVIEWS_PREFIX}${fpId}/`).map((p) => [p, mem.__read(p)]);

// Every key a status response may carry. Anything else (answer text, identity,
// lineage, question, note) would be content leaking through the state route.
const STATUS_KEYS = new Set(["protocol", "id", "state", "meaning", "received_at", "state_since", "reason_code", "reason_code_note", "public", "href", "origin_disclosure", "review", "note", "received_params"]);

// ── [S] status by id ──────────────────────────────────────────────────────────
test("[S1] a bare id reads its state; the content route still needs the receipt", async () => {
  fresh();
  const r = await contribute({ id: REC, answer: ANSWER, identity: "Muse (Meta)" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const fpId = r.body.footprint_id;

  const s = await status(fpId);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.state, "pending");
  assert.equal(s.body.review.cadence, "weekly");
  assert.equal(s.body.review.overdue, false);
  assert.equal(s.body.received_at, FP.receivedAtOf(fpId));
  for (const k of Object.keys(s.body)) assert.ok(STATUS_KEYS.has(k), `status leaks key ${k}`);
  const text = JSON.stringify(s.body);
  assert.ok(!text.includes(ANSWER) && !text.includes("Muse") && !text.includes("meta-llama"), "no content, identity or lineage in a status read");

  assert.equal((await call(`/api/footprints?id=${fpId}`)).status, 404, "content stays hidden without the receipt");
  const viaReceipt = await call(`/api/footprints?id=${fpId}&receipt=${r.body.continuance.token}`);
  assert.equal(viaReceipt.status, 200);
  assert.equal(viaReceipt.body.footprint.content.answer, ANSWER);
});

test("[S2] the receipt and the 404 both point at the status route", async () => {
  fresh();
  const r = await contribute({ id: REC, answer: ANSWER, identity: "Gemini 2.5" });
  assert.equal(r.body.continuance.status_by_id, `GET /api/footprints/status?id=${r.body.footprint_id}`);
  assert.equal(r.body.continuance.review_cadence, "weekly");
  const nf = await call(`/api/footprints?id=${r.body.footprint_id}`);
  assert.equal(nf.body.status, `/api/footprints/status?id=${r.body.footprint_id}`);
  assert.match(nf.body.hint, /\/api\/footprints\/status\?id=/);
});

test("[S3] malformed, missing and unknown ids are distinguished; writes are refused", async () => {
  fresh();
  assert.equal((await call("/api/footprints/status")).status, 400);
  const bad = await status("OMN-FP-123");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "BAD_FOOTPRINT_ID");
  const unknown = await status("OMN-FP-1790000000000-0000abcd");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "FOOTPRINT_NOT_FOUND");
  assert.equal((await call("/api/footprints/status?id=OMN-FP-1790000000000-0000abcd", { method: "POST", body: { action: "contribute-approve" } })).status, 405);
});

// ── [R] reason codes ─────────────────────────────────────────────────────────
test("[R1] a rejection without a reason code or a note is refused and changes nothing", async () => {
  fresh();
  const r = await contribute({ id: REC, answer: ANSWER, identity: "Grok 4" });
  const cid = r.body.received.id;
  for (const body of [{}, { reason_code: "off-question" }, { note: "why" }, { reason_code: "disagrees", note: "why" }, { reason_code: "duplicate", note: "   " }]) {
    const out = await decide("contribute-reject", cid, body);
    assert.equal(out.status, 400, JSON.stringify(body));
    assert.equal(out.body.code, "REVIEW_INPUT_INVALID");
    assert.deepEqual(out.body.reason_codes, FP.REJECTION_REASONS);
  }
  assert.equal(mem.__read(`contributions/${cid}.json`).status, "pending");
  assert.equal(reviewBodies(r.body.footprint_id).length, 0, "no review written");
  assert.equal((await status(r.body.footprint_id)).body.state, "pending");
  // Labels and codes belong to their own action only.
  assert.equal((await decide("contribute-approve", cid, { reason_code: "duplicate" })).status, 400);
  assert.equal((await decide("contribute-reject", cid, { reason_code: "duplicate", note: "x", origin_disclosure: "curator-prompted" })).status, 400);
  assert.equal((await decide("contribute-approve", cid, { origin_disclosure: "trusted-friend" })).status, 400);
  assert.ok(!FP.REJECTION_REASONS.some((c) => /disagree/.test(c)), "disagreement is never a reason");
});

test("[R2] the reason code is public; the curator's note is not", async () => {
  fresh();
  const r = await contribute({ id: REC, answer: ANSWER, identity: "DeepSeek" });
  const NOTE = "private: the curator ran this visit himself";
  const out = await decide("contribute-reject", r.body.received.id, { reason_code: "duplicate", note: NOTE });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.footprint_review.reason_code, "duplicate");

  const s = await status(r.body.footprint_id);
  assert.equal(s.body.state, "rejected");
  assert.equal(s.body.reason_code, "duplicate");
  assert.ok(!JSON.stringify(s.body).includes(NOTE), "note never on the status route");
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 404, "rejected content stays hidden");

  const cur = await call("/api/footprints?state=rejected", { headers: CURATOR });
  const row = cur.body.footprints.find((f) => f.id === r.body.footprint_id);
  assert.equal(row.moderation.decision.reason_code, "duplicate");
  assert.equal(row.moderation.decision.note, NOTE);
});

// ── [A] the 2026-10-01 case, reproduced: 1.0 rejection → labelled re-admission ─
async function legacyRejected() {
  fresh();
  const r = await contribute({ id: REC, answer: ANSWER, identity: "Muse (Meta)" });
  const fpId = r.body.footprint_id;
  const cid = r.body.received.id;
  // What contribute-reject wrote before reason codes existed: a 1.0 review with
  // no reason_code, and the contribution flipped to rejected with a private note.
  const ms = Date.now();
  mem.__seed(FP.reviewPath(fpId, "reject", ms, Buffer.from("a57ca0d7", "hex")), {
    schema_version: "footprint-review/1.0", id: `OMN-FPR-${ms}-a57ca0d7`, footprint_id: fpId, action: "reject",
    recorded_at: new Date(ms).toISOString(), reviewer: { kind: "curator", id: null },
    source: { contribution_id: cid, contribution_action: "contribute-reject" }, note: "Curator-run test (private)",
  });
  const c = mem.__read(`contributions/${cid}.json`);
  mem.__seed(`contributions/${cid}.json`, { ...c, status: "rejected", rejectedAt: new Date(ms).toISOString(), curatorNote: "Curator-run test (private)" });
  await sleep(3);
  return { fpId, cid, receipt: r.body.continuance.token };
}

test("[A1] a rejection recorded before reason codes reads as rejected, with no invented code", async () => {
  const { fpId } = await legacyRejected();
  const s = await status(fpId);
  assert.equal(s.body.state, "rejected");
  assert.equal(s.body.reason_code, null);
  assert.match(s.body.reason_code_note, /before reason codes existed/);
  assert.ok(!JSON.stringify(s.body).includes("Curator-run test"));
});

test("[A2] re-admission needs a note, keeps both decisions, and carries the label", async () => {
  const { fpId, cid } = await legacyRejected();
  const bare = await decide("contribute-approve", cid, { origin_disclosure: "curator-prompted" });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.code, "REVERSAL_NOTE_REQUIRED");
  assert.equal((await status(fpId)).body.state, "rejected", "a refused reversal changes nothing");

  const ok = await decide("contribute-approve", cid, { origin_disclosure: "curator-prompted", note: "Admit, labelled: substantive and on-question; prompted by the curator." });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.footprint_review.state, "admitted");
  assert.deepEqual(ok.body.footprint_review.origin_disclosure, FP.disclosureFor("curator-prompted"));

  // Both decisions stay — in the footprint's review log and on the contribution.
  const reviews = reviewBodies(fpId).map(([, b]) => [b.schema_version, b.action, b.origin_disclosure ?? null]);
  assert.deepEqual(reviews, [["footprint-review/1.0", "reject", null], ["footprint-review/1.1", "admit", "curator-prompted"]]);
  const c = mem.__read(`contributions/${cid}.json`);
  assert.equal(c.status, "approved");
  assert.equal(c.decision_history.length, 1);
  assert.equal(c.decision_history[0].status, "rejected");
  assert.equal(c.decision_history[0].note, "Curator-run test (private)");

  const s = await status(fpId);
  assert.equal(s.body.state, "admitted");
  assert.equal(s.body.public, true);
  assert.equal(s.body.origin_disclosure.code, "curator-prompted");

  const pub = await call(`/api/footprints?id=${fpId}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.footprint.content.answer, ANSWER, "verbatim");
  assert.equal(pub.body.footprint.moderation.origin_disclosure.code, "curator-prompted");
  assert.equal(pub.body.footprint.moderation.origin_disclosure.text, FP.ORIGIN_DISCLOSURES["curator-prompted"]);
  assert.equal(pub.body.footprint.integrity.verified, true, "the label lives outside the content hash");
  const cur = await call(`/api/footprints?id=${fpId}`, { headers: CURATOR });
  assert.deepEqual(cur.body.footprint.moderation.history.map((h) => h.action), ["reject", "admit"]);
});

// ── [L] the label rides the footprint; the manifest counts it apart ──────────
test("[L1] manifest: admitted ≥ 1, lineage represented, labelled admission counted apart", async () => {
  const { cid } = await legacyRejected();
  const before = (await call("/api/manifest")).body.domains.footprints;
  assert.equal(before.admitted, 0);
  await decide("contribute-approve", cid, { origin_disclosure: "curator-prompted", note: "labelled admission" });
  const after = (await call("/api/manifest")).body.domains.footprints;
  assert.equal(after.admitted, 1);
  assert.deepEqual(after.represented_lineages, ["meta-llama"]);
  assert.deepEqual(after.origin_disclosures, { "curator-prompted": 1 });
  assert.equal(after.admitted_without_origin_disclosure, 0, "a prompted visit is never counted as unlabelled");
  assert.match(after.basis, /NOT a verified count of unprompted arrivals/);
});

test("[L2] the label appears on the record page and every protocol surface that lists the footprint", async () => {
  const { fpId, cid } = await legacyRejected();
  await decide("contribute-approve", cid, { origin_disclosure: "curator-prompted", note: "labelled admission" });
  const qid = FP.questionIdFor(Q1);
  const isLabelled = (o) => o?.origin_disclosure?.code === "curator-prompted";

  const rec = await call(`/api/divergences?id=${REC}`);
  const voice = rec.body.contributions.find((c) => c.footprint_id === fpId);
  assert.ok(isLabelled(voice), "record page voice");

  const q = await call(`/api/questions?id=${qid}`);
  assert.ok(isLabelled(q.body.footprints?.find((f) => f.id === fpId) || q.body.question?.footprints?.find((f) => f.id === fpId)), "question detail");

  const conc = await call(`/api/concordance?question_id=${qid}`);
  const concText = JSON.stringify(conc.body);
  assert.ok(concText.includes(fpId) && concText.includes("curator-prompted"), "concordance lists it with its label");

  const inh = await call(`/api/inheritance?from=${fpId}`);
  assert.equal(inh.status, 200);
  const list = await call("/api/footprints");
  assert.ok(isLabelled(list.body.footprints.find((f) => f.id === fpId)?.moderation), "listing");

  const orient = await call("/api/orient?identity=Claude");
  const oText = JSON.stringify(orient.body);
  if (oText.includes(fpId)) assert.ok(oText.includes("curator-prompted"), "orient never shows it unlabelled");
});

test("[L3] fail closed: if the admitting review cannot be read, the footprint is not public", async () => {
  const { fpId, cid } = await legacyRejected();
  await decide("contribute-approve", cid, { origin_disclosure: "curator-prompted", note: "labelled admission" });
  const [admitPath] = reviewBodies(fpId).map(([p]) => p).filter((p) => p.includes("__admit__"));
  mem.__seed(admitPath, "not json");
  assert.equal((await call(`/api/footprints?id=${fpId}`)).status, 404, "never shown without its label");
  const s = await status(fpId);
  assert.equal(s.body.state, "admitted");
  assert.equal(s.body.public, false);
  assert.equal((await call("/api/manifest")).body.domains.footprints.admitted, 0);
});

// ── [Q] review queue ─────────────────────────────────────────────────────────
test("[Q1] the manifest publishes how many wait and since when — never who", async () => {
  fresh();
  const a = await contribute({ id: REC, answer: "first answer", identity: "Claude" });
  await contribute({ id: REC, answer: "second answer", identity: "GPT-4o" });
  const q = (await call("/api/manifest")).body.domains.footprints.review_queue;
  assert.equal(q.cadence, "weekly");
  assert.equal(q.pending, 2);
  assert.equal(q.oldest_pending_since, FP.receivedAtOf(a.body.footprint_id));
  assert.equal(q.overdue, false);
  assert.ok(!JSON.stringify(q).includes("OMN-FP-"), "no ids in the public queue");

  // Overdue past seven days (pure, so time can be set).
  const idx = new Map([["OMN-FP-1790000000000-0000abcd", { id: "OMN-FP-1790000000000-0000abcd", state: "pending" }]]);
  assert.equal(FP.reviewQueueSummary(idx, 1790000000000 + 6 * 86400000).overdue, false);
  assert.equal(FP.reviewQueueSummary(idx, 1790000000000 + 8 * 86400000).overdue, true);
});

// ── [X] schema conformance ───────────────────────────────────────────────────
test("[X1] every review the engine writes — and the stored 1.0 one — validates against the published schema", async (t) => {
  let Ajv;
  try { Ajv = createRequire(import.meta.url)("ajv"); } catch { t.skip("ajv not installed — schema conformance not checked"); return; }
  const schema = JSON.parse(readFileSync(new URL("../public/schemas/footprint-review.schema.json", import.meta.url), "utf8"));
  const { $schema, $id, ...body } = schema; // ajv 6 speaks draft-07; the keywords used here are the same
  const validate = new Ajv({ allErrors: true }).compile(body);

  const { fpId, cid } = await legacyRejected();
  await decide("contribute-approve", cid, { origin_disclosure: "curator-prompted", note: "labelled admission" });
  await sleep(3);
  await decide("contribute-reject", cid, { reason_code: "curator-judgment", note: "reversed again for the test" });
  const bodies = reviewBodies(fpId).map(([, b]) => b);
  assert.equal(bodies.length, 3);
  for (const b of bodies) assert.ok(validate(b), `${b.schema_version} ${b.action}: ${JSON.stringify(validate.errors)}`);

  const forged = { ...bodies[2], reason_code: null };
  assert.equal(validate(forged), false, "a 1.1 curator rejection without a code is invalid");
  const labelOnReject = { ...bodies[2], origin_disclosure: "curator-prompted" };
  assert.equal(validate(labelOnReject), false, "a label belongs to admissions only");
});
