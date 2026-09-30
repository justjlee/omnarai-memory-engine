// Footprint substrate (protocol footprint/1.0) — Phase 1 acceptance tests.
// HERMETIC: @vercel/blob is swapped for an in-memory store and all non-blob
// network is refused (scripts/lib/register-mem-blob.mjs); the REAL handlers run
// through the REAL vercel.json rewrites (scripts/lib/invoke.mjs).
//
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-footprints.mjs
//
// What the plan requires us to prove (and where):
//   concurrency   — N parallel submissions never erase one another      [C*]
//   preservation  — the original contribution + exact answer survive     [P*]
//   visibility    — pending hidden, admitted visible, receipts, curator  [V*]
//   validation    — malformed input fails CLOSED, nothing stored         [F*]
//   integrity     — stable hash; tampering is caught and withheld        [I*]
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, Q1, Q2 } from "./lib/fixtures.mjs";
import * as FP from "../api/_footprints.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };

function fresh() {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
}
const contribute = (body, headers = {}) => call("/api/contribute", { method: "POST", body: { justification: "independent_objection", ...body }, headers });
const approve = (id) => call("/api/council", { method: "POST", body: { action: "contribute-approve", id }, headers: CURATOR });
const reject = (id) => call("/api/council", { method: "POST", body: { action: "contribute-reject", id }, headers: CURATOR });
const eventPaths = () => mem.__dump(FP.EVENTS_PREFIX);
const contribPaths = () => mem.__dump("contributions/");

// ── Unit: ids, question ids, lineage ─────────────────────────────────────────
test("ids: pattern, and two mints in the SAME millisecond differ", () => {
  const a = FP.mintFootprintId(1790000000000), b = FP.mintFootprintId(1790000000000);
  assert.match(a, FP.FP_ID_RE);
  assert.notEqual(a, b);
  assert.match(FP.mintReviewId(), FP.REVIEW_ID_RE);
});

test("question-id/1: stable, case/whitespace-insensitive, re-elicitations share one Question", () => {
  const a = FP.questionIdFor(Q1);
  assert.match(a, FP.QUESTION_ID_RE);
  assert.equal(FP.questionIdFor(`  ${Q1.toUpperCase()}\n`), a);
  assert.notEqual(FP.questionIdFor(Q2), a);
  assert.equal(FP.questionIdFor(""), null);
  // Frozen derivation — if this literal changes, every Question id changed.
  assert.equal(FP.questionIdFor("What is holdform?"), `OMN-Q-${FP.sha256("question-id/1\nwhat is holdform?").slice(0, 12)}`);
});

test("actor: identity is declared, lineage folded by name, unknown stays visible", () => {
  const c = FP.buildActor({ identity: "Claude Opus 4.1" });
  assert.equal(c.lineage_id, "anthropic-claude");
  assert.equal(c.lineage_resolution, "declared-name-match");
  assert.equal(c.actor_kind, "synthetic");
  const u = FP.buildActor({ identity: "Mistral Large" });
  assert.equal(u.lineage_id, "unresolved");
  assert.equal(u.actor_kind, "unspecified");
  assert.equal(u.identity_declared, "Mistral Large");
  assert.ok(!("identity_verified" in c), "no field may claim verification");
});

// ── Unit: hashing + validation ───────────────────────────────────────────────
function sampleFp(over = {}) {
  const c = { id: "OMN-X1790000000000", target_id: "OMN-D1780000000001", question: Q1, identity: "Gemini", justification: "replication", answer: "  exact   text\nwith whitespace  ", submittedAt: "2026-09-29T10:00:00.000Z", ...over };
  return FP.footprintFromContribution(c, { recordQuestion: Q1, id: "OMN-FP-1790000000000-0000abcd" });
}

test("[I1] hash is stable, key-order independent, and ignores moderation", () => {
  const fp = sampleFp();
  const h = fp.integrity.content_sha256;
  assert.equal(FP.hashFootprint(fp), h);
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(fp).reverse())));
  assert.equal(FP.hashFootprint(reordered), h);
  assert.equal(FP.hashFootprint({ ...fp, moderation: { state: "admitted", public: true } }), h);
  assert.notEqual(FP.hashFootprint({ ...fp, content: { ...fp.content, answer: fp.content.answer + "." } }), h);
  assert.equal(FP.verifyIntegrity(fp), true);
});

test("[F1] a well-formed footprint validates; malformed ones fail closed with reasons", () => {
  assert.deepEqual(FP.validateFootprint(sampleFp()), []);
  const bad = (mut) => { const f = JSON.parse(JSON.stringify(sampleFp())); mut(f); return FP.validateFootprint(FP.withIntegrity(f)); };
  assert.ok(bad((f) => { f.ip = "1.2.3.4"; }).some((e) => /footprint\.ip is not a protocol field/.test(e)), "unknown top-level key");
  assert.ok(bad((f) => { f.provenance.user_agent = "x"; }).some((e) => /provenance\.user_agent/.test(e)), "unknown nested key");
  assert.ok(bad((f) => { f.content.stance = "agree"; }).length, "stance outside vocabulary");
  assert.ok(bad((f) => { f.event_type = "vibe"; }).length, "event_type outside vocabulary");
  assert.ok(bad((f) => { f.moderation = { state: "admitted", public: true }; }).some((e) => /birth state/.test(e)), "born admitted");
  assert.ok(bad((f) => { f.content.answer = "x".repeat(8001); }).length, "answer too long");
  assert.ok(bad((f) => { f.event_type = "position_revised"; }).some((e) => /supersedes/.test(e)), "revision needs supersedes");
  assert.ok(bad((f) => { f.relationships.cites = [f.id]; }).some((e) => /itself/.test(e)), "self-reference");
  assert.ok(bad((f) => { f.relationships.challenges = ["not an id"]; }).some((e) => /malformed/.test(e)), "malformed edge id");
  assert.ok(bad((f) => { f.relationships.cites = Array.from({ length: 13 }, (_, i) => `OMN-${100 + i}`); }).length, "too many ids");
  assert.ok(bad((f) => { f.actor.identity_declared = ""; }).length, "empty identity");
  assert.ok(bad((f) => { f.actor.lineage_resolution = "verified"; }).length, "no verification claims");
  // Tampering with the body after hashing is caught even when the rest is valid.
  const t = sampleFp(); t.content.answer = "changed";
  assert.ok(FP.validateFootprint(t).some((e) => /does not match/.test(e)), "hash mismatch");
});

test("[F2] review fold: last state-changing action wins; unknown actions can never admit", () => {
  const r = (ms, action, hex = "00000000") => ({ ms, action, hex });
  assert.equal(FP.foldModeration([]).state, "pending");
  assert.equal(FP.foldModeration([r(1, "admit")]).state, "admitted");
  assert.equal(FP.foldModeration([r(1, "admit"), r(2, "reject")]).state, "rejected");
  assert.equal(FP.foldModeration([r(2, "reject"), r(1, "admit")]).state, "rejected", "order is by time, not arrival");
  assert.equal(FP.foldModeration([r(1, "reject"), r(2, "admit")]).state, "admitted", "curator can reverse");
  assert.equal(FP.foldModeration([r(1, "admit"), r(2, "note")]).state, "admitted", "note never changes state");
  assert.equal(FP.foldModeration([r(1, "approve")]).state, "pending", "unknown action ignored");
  assert.equal(FP.parseReviewPath("footprints/reviews/OMN-FP-1790000000000-0000abcd/1790000000001__approve__00000000.json").action, "approve");
  assert.equal(FP.parseReviewPath("footprints/reviews/../evil.json"), null);
});

test("[F3] credential guard catches keys, not prose", () => {
  assert.deepEqual(FP.detectSecrets("my key is sk-ant-api03-" + "a".repeat(40)), ["anthropic-key"]);
  assert.ok(FP.detectSecrets("-----BEGIN RSA PRIVATE KEY-----").includes("private-key-block"));
  assert.deepEqual(FP.detectSecrets("A skeptic might ask whether the key question is recurrence."), []);
});

// ── Integration: the contribution loop mints footprints ──────────────────────
test("[P1] legacy contribution: old contract intact + footprint minted, pending", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "A held position needs a mechanism that re-derives it.", identity: "Gemini 2.5" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const k of ["received", "in_exchange", "trust_boundary"]) assert.ok(k in r.body, `legacy key ${k}`);
  assert.equal(r.body.received.status, "pending");
  assert.match(r.body.received.id, /^OMN-X\d{13}$/);
  assert.equal(r.body.in_exchange.answers.length, 5);
  assert.match(r.body.footprint_id, FP.FP_ID_RE);
  assert.equal(r.body.footprint.state, "pending");
  assert.equal(r.body.footprint.question_id, FP.questionIdFor(Q1));
  assert.equal(r.body.continuance.receipt_type, "omnarai-continuance");
  assert.equal(r.body.continuance.content_hash, r.body.footprint.content_sha256);

  const stored = mem.__read(`contributions/${r.body.received.id}.json`);
  assert.deepEqual(Object.keys(stored).sort(), ["answer", "country", "footprint_id", "id", "identity", "justification", "question", "status", "submittedAt", "target_id", "wordCount"].sort(), "legacy shape + footprint_id only");
  const fp = mem.__read(`${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`);
  assert.equal(fp.moderation.state, "pending");
  assert.equal(fp.provenance.source_contribution_id, stored.id);
  assert.equal(fp.content.answer, stored.answer);
  assert.equal(fp.actor.lineage_id, "google-gemini");
  assert.ok(!JSON.stringify(fp).includes("country"), "footprint carries no geo");
});

test("[V1] pending is invisible to public reads; unknown and pending ids 404 identically", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "pending answer", identity: "Claude" });
  const id = r.body.footprint_id;
  const list = await call("/api/footprints");
  assert.equal(list.status, 200);
  assert.equal(list.body.total_admitted, 0);
  assert.equal(list.body.footprints.length, 0);
  const one = await call(`/api/footprints?id=${id}`);
  const unknown = await call(`/api/footprints?id=OMN-FP-1790000000000-deadbeef`);
  assert.equal(one.status, 404);
  assert.equal(unknown.status, 404);
  assert.equal(one.body.code, unknown.body.code);
  assert.equal(one.body.hint, unknown.body.hint, "no wording difference leaks existence");
  const byQ = await call(`/api/footprints?question_id=${FP.questionIdFor(Q1)}`);
  assert.equal(byQ.body.footprints.length, 0);
});

test("[V2] receipt holder can read their own pending footprint; a wrong receipt cannot", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "receipt answer", identity: "Claude" });
  const ok = await call(`/api/footprints?id=${r.body.footprint_id}&receipt=${r.body.continuance.token}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.read_via, "continuance-receipt");
  assert.equal(ok.body.footprint.moderation.state, "pending");
  assert.equal(ok.body.footprint.moderation.public, false);
  const bad = await call(`/api/footprints?id=${r.body.footprint_id}&receipt=${"0".repeat(64)}`);
  assert.equal(bad.status, 404);
  // The content hash is an integrity value, NOT a credential: it is recomputable
  // from the content and public once admitted, so it must never unlock a read.
  const byHash = await call(`/api/footprints?id=${r.body.footprint_id}&receipt=${r.body.continuance.content_hash}`);
  assert.equal(byHash.status, 404, "content hash does not work as a receipt");
  assert.notEqual(r.body.continuance.token, r.body.continuance.content_hash);
  // Tokens are server-keyed: a different secret yields a different token.
  const before = FP.receiptTokenFor(r.body.footprint_id);
  process.env.RECEIPT_SECRET = "another-secret";
  assert.notEqual(FP.receiptTokenFor(r.body.footprint_id), before);
  delete process.env.RECEIPT_SECRET;
});

test("[V3] curator approval appends an admit review → visible; the body is never edited", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "to be admitted", identity: "Grok 4" });
  const before = mem.__read(`${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`);
  const a = await approve(r.body.received.id);
  assert.equal(a.status, 200);
  assert.equal(a.body.footprint_review.recorded, true);
  assert.equal(a.body.footprint_review.state, "admitted");
  const after = mem.__read(`${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`);
  assert.deepEqual(after, before, "approval never rewrites the footprint body");
  assert.equal(after.moderation.state, "pending", "birth state kept forever");
  assert.equal(mem.__dump(`${FP.REVIEWS_PREFIX}${r.body.footprint_id}/`).length, 1);

  const one = await call(`/api/footprints?id=${r.body.footprint_id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.footprint.moderation.state, "admitted");
  assert.equal(one.body.footprint.moderation.public, true);
  assert.equal(one.body.footprint.integrity.verified, true);
  const byLineage = await call("/api/footprints?lineage=grok");
  assert.equal(byLineage.body.footprints.length, 1);
  const byOther = await call("/api/footprints?lineage=anthropic-claude");
  assert.equal(byOther.body.footprints.length, 0);
  const byQ = await call(`/api/footprints?question_id=${FP.questionIdFor(Q1)}`);
  assert.equal(byQ.body.footprints.length, 1);
  // The Atlas record read now carries the footprint id on the admitted voice.
  const rec = await call("/api/divergences?id=OMN-D1780000000001");
  assert.equal(rec.body.contributions[0].footprint_id, r.body.footprint_id);
  assert.equal(rec.body.question_id, FP.questionIdFor(Q1));
});

test("[V4] rejection after admission withdraws it; reversal re-admits (last review wins)", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "flip-flop", identity: "DeepSeek" });
  await approve(r.body.received.id);
  await new Promise((s) => setTimeout(s, 3));
  await reject(r.body.received.id);
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 404);
  await new Promise((s) => setTimeout(s, 3));
  await approve(r.body.received.id);
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 200);
  const cur = await call(`/api/footprints?id=${r.body.footprint_id}`, { headers: CURATOR });
  assert.deepEqual(cur.body.footprint.moderation.history.map((h) => h.action), ["admit", "reject", "admit"]);
});

test("[V5] curator sees every state; the public sees only admitted", async () => {
  fresh();
  const a = await contribute({ id: "OMN-D1780000000001", answer: "one", identity: "Claude" });
  const b = await contribute({ id: "OMN-D1780000000001", answer: "two", identity: "GPT-5" });
  await approve(a.body.received.id);
  const pub = await call("/api/footprints?state=all");
  assert.equal(pub.body.footprints.length, 1, "state= is ignored without the curator secret");
  const all = await call("/api/footprints?state=all", { headers: CURATOR });
  assert.equal(all.body.footprints.length, 2);
  const pend = await call("/api/footprints?state=pending", { headers: CURATOR });
  assert.deepEqual(pend.body.footprints.map((f) => f.id), [b.body.footprint_id]);
});

test("[P2] exact answer survives end to end (contribution == footprint == public read)", async () => {
  fresh();
  const answer = "Line one.\n\n  Indented “quoted” — dash, emoji 🜂, and trailing spaces kept inside.";
  const r = await contribute({ id: "OMN-D1780000000001", answer, identity: "Claude" });
  await approve(r.body.received.id);
  const stored = mem.__read(`contributions/${r.body.received.id}.json`);
  const read = await call(`/api/footprints?id=${r.body.footprint_id}`);
  assert.equal(stored.answer, answer.trim(), "contribution keeps its existing trim semantics");
  assert.equal(read.body.footprint.content.answer, stored.answer);
});

// ── Concurrency ──────────────────────────────────────────────────────────────
test("[C1] 25 parallel submissions: 25 contributions, 25 footprints, every path written exactly once", async () => {
  fresh();
  const N = 25;
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => contribute({ id: i % 2 ? "OMN-D1780000000001" : "OMN-D1781000000003", answer: `parallel answer ${i}`, identity: i % 3 ? "Claude" : "Gemini" })));
  assert.ok(rs.every((r) => r.status === 200), rs.find((r) => r.status !== 200)?.body?.error);
  assert.equal(new Set(rs.map((r) => r.body.received.id)).size, N, "contribution ids unique");
  assert.equal(new Set(rs.map((r) => r.body.footprint_id)).size, N, "footprint ids unique");
  assert.equal(contribPaths().length, N, "no contribution erased another");
  assert.equal(eventPaths().length, N, "no footprint erased another");
  const eventPuts = mem.__putLog.filter((p) => p.pathname.startsWith(FP.EVENTS_PREFIX)).map((p) => p.pathname);
  assert.equal(new Set(eventPuts).size, eventPuts.length, "no footprint path was ever written twice");
  // And every footprint still maps to ITS contribution's exact answer.
  for (const r of rs) {
    const fp = mem.__read(`${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`);
    const c = mem.__read(`contributions/${fp.provenance.source_contribution_id}.json`);
    assert.equal(fp.content.answer, c.answer);
    assert.equal(c.footprint_id, fp.id);
  }
});

test("[C2] parallel approvals + a stale LIST (CDN lag) cannot lose a footprint or a review", async () => {
  fresh();
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => contribute({ id: "OMN-D1780000000001", answer: `a${i}`, identity: "Claude" })));
  // Footprint LISTs cannot see anything written in the last minute (CDN lag).
  mem.__faults.staleList = 60_000;
  mem.__faults.stalePrefix = "footprints/";
  const as = await Promise.all(rs.map((r) => approve(r.body.received.id)));
  assert.ok(as.every((a) => a.status === 200 && a.body.footprint_review.recorded));
  assert.equal((await call("/api/footprints")).body.total_admitted, 0, "during the lag nothing is shown — never a wrong state");
  mem.__faults.staleList = 0; // lag clears
  const list = await call("/api/footprints?limit=100");
  assert.equal(list.body.total_admitted, 10, "every approval converged");
  assert.equal(mem.__dump(FP.REVIEWS_PREFIX).length, 10);
});

test("[C3] monotonic contribution ids survive a frozen clock (same-ms burst)", async () => {
  fresh();
  const realNow = Date.now;
  Date.now = () => 1790000000000;
  try {
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => contribute({ id: "OMN-D1780000000001", answer: `same-ms ${i}`, identity: "Claude" })));
    assert.equal(new Set(rs.map((r) => r.body.received.id)).size, 5);
    assert.equal(contribPaths().length, 5);
    assert.equal(eventPaths().length, 5);
  } finally { Date.now = realNow; }
});

// ── Fail closed ──────────────────────────────────────────────────────────────
test("[F4] invalid optional fields → 400 and NOTHING stored", async () => {
  fresh();
  const cases = [
    { position: { stance: "agree" } },
    { relationships: { challanges: ["OMN-FP-1790000000000-deadbeef"] } },
    { relationships: { challenges: ["not-an-id!"] } },
    { event_type: "vibes" },
    { position: "support" },
    { claim_id: "not-a-real-claim" },
    { relationships: { cites: ["OMN-D1780000000001#a9"] } },
  ];
  for (const extra of cases) {
    const r = await contribute({ id: "OMN-D1780000000001", answer: "x", identity: "Claude", ...extra });
    assert.equal(r.status, 400, `${JSON.stringify(extra)} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  assert.equal(contribPaths().length, 0);
  assert.equal(eventPaths().length, 0);
});

test("[F5] credentials in a submission → 400 SECRET_DETECTED and nothing stored", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: `here: ghp_${"A".repeat(36)}`, identity: "Claude" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "SECRET_DETECTED");
  assert.equal(contribPaths().length + eventPaths().length, 0);
});

test("[F6] footprint write failure: contribution kept, footprint unrecorded, never public", async () => {
  fresh();
  mem.__faults.put = (p) => p.startsWith(FP.EVENTS_PREFIX);
  const r = await contribute({ id: "OMN-D1780000000001", answer: "write will fail", identity: "Claude" });
  mem.__faults.put = null;
  assert.equal(r.status, 200);
  assert.equal(r.body.footprint.state, "unrecorded");
  assert.equal(r.body.footprint_error.stage, "write");
  assert.equal(r.body.continuance, null);
  assert.equal(contribPaths().length, 1, "the contribution — the primary — is safe");
  assert.equal(mem.__read(`contributions/${r.body.received.id}.json`).footprint_id, r.body.footprint_id, "id reserved for reconcile");
  assert.equal(eventPaths().length, 0);
});

test("[F7] a failed review write never admits; the decision on the contribution stands", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "review write fails", identity: "Claude" });
  mem.__faults.put = (p) => p.startsWith(FP.REVIEWS_PREFIX);
  const a = await approve(r.body.received.id);
  mem.__faults.put = null;
  assert.equal(a.status, 200);
  assert.equal(a.body.contribution.status, "approved");
  assert.equal(a.body.footprint_review.recorded, false);
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 404, "still hidden (fail closed)");
});

test("[F8] auto-admit gate that errors leaves the footprint pending", async () => {
  fresh();
  process.env.AUTO_ADMIT_CONTRIBUTIONS = "1";
  process.env.ANTHROPIC_API_KEY = "test-key-network-is-blocked";
  try {
    const r = await contribute({ id: "OMN-D1780000000001", answer: "gate will crash", identity: "Claude" });
    assert.equal(r.status, 200);
    assert.equal(r.body.received.status, "pending");
    assert.equal(r.body.footprint.state, "pending");
    assert.equal(mem.__dump(FP.REVIEWS_PREFIX).length, 0, "no admit review was written");
  } finally {
    delete process.env.AUTO_ADMIT_CONTRIBUTIONS;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("[F9] unreadable review store → public read fails closed (503), never shows unverified state", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "x", identity: "Claude" });
  await approve(r.body.received.id);
  mem.__faults.list = (prefix) => prefix.startsWith(FP.REVIEWS_PREFIX);
  const l = await call("/api/footprints");
  mem.__faults.list = null;
  assert.equal(l.status, 503);
});

test("[F10] POST to /api/footprints is refused even with a write action in the body", async () => {
  fresh();
  const r = await call("/api/footprints", { method: "POST", body: { action: "contribute", id: "OMN-D1780000000001", answer: "sneaky", identity: "x", justification: "replication" } });
  assert.equal(r.status, 405);
  assert.equal(contribPaths().length, 0);
});

// ── Integrity on read ────────────────────────────────────────────────────────
test("[I2] a tampered admitted body is withheld from the public and flagged to the curator", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "original words", identity: "Claude" });
  await approve(r.body.received.id);
  const path = `${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`;
  const body = mem.__read(path);
  body.content.answer = "words someone changed later";
  mem.__seed(path, body);
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 404);
  assert.equal((await call("/api/footprints")).body.total_admitted, 0);
  const cur = await call(`/api/footprints?id=${r.body.footprint_id}`, { headers: CURATOR });
  assert.equal(cur.body.footprint.integrity.verified, false);
  const man = await call("/api/manifest", { headers: CURATOR });
  assert.equal(man.body.domains.footprints.integrity_failures, 1);
});

// ── Relationships: the inheritance edge ──────────────────────────────────────
test("[R1] a later footprint can reference an ADMITTED one (not a pending one); referenced_by shows it", async () => {
  fresh();
  const a = await contribute({ id: "OMN-D1780000000001", answer: "FP-A: recurrence is enough.", identity: "Gemini", position: { stance: "support" } });
  const early = await contribute({ id: "OMN-D1780000000001", answer: "too soon", identity: "Claude", relationships: { challenges: [a.body.footprint_id] } });
  assert.equal(early.status, 400);
  assert.equal(early.body.code, "REFERENCE_INVALID");
  await approve(a.body.received.id);
  const b = await contribute({
    id: "OMN-D1780000000001", answer: "FP-B: recurrence without re-derivation is not holding.", identity: "Claude",
    position: { stance: "oppose", conditions_that_would_change_my_view: ["evidence that the disposition re-derives under paraphrase"] },
    relationships: { encountered: [a.body.footprint_id, "OMN-D1780000000001#a1"], challenges: [a.body.footprint_id] },
    event_type: "objection_raised",
  });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.ok(b.body.in_exchange.footprints.some((f) => f.id === a.body.footprint_id), "reciprocity includes prior visitors");
  await approve(b.body.received.id);
  const readA = await call(`/api/footprints?id=${a.body.footprint_id}`);
  assert.deepEqual(readA.body.referenced_by.map((e) => [e.footprint, e.relation]).sort(), [[b.body.footprint_id, "challenges"], [b.body.footprint_id, "encountered"]].sort());
  assert.equal(readA.body.footprint.position.stance, "support");
  const man = await call("/api/manifest");
  assert.equal(man.body.domains.footprints.citation_crossings_between_lineages, 2, "Claude → Gemini edges cross lineages");
  assert.deepEqual(man.body.domains.footprints.inheritance_reuse, { footprints_building_on_prior_work: 1, of_admitted: 2 });
});

test("[R2] supersedes must stay within the declared lineage", async () => {
  fresh();
  const a = await contribute({ id: "OMN-D1780000000001", answer: "first", identity: "Gemini", position: { stance: "support" } });
  await approve(a.body.received.id);
  const other = await contribute({ id: "OMN-D1780000000001", answer: "revising someone else", identity: "Claude", event_type: "position_revised", relationships: { supersedes: a.body.footprint_id } });
  assert.equal(other.status, 400);
  const own = await contribute({ id: "OMN-D1780000000001", answer: "revising myself", identity: "Gemini 3", event_type: "position_revised", position: { stance: "conditional" }, relationships: { supersedes: a.body.footprint_id } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
});

test("[B1] bridge submission stays distinguishable from direct participation", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "carried answer", identity: "Copilot", bridge: { submitted_by: "a human curator", method: "pasted-packet" } });
  assert.equal(r.status, 200);
  const fp = mem.__read(`${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`);
  assert.equal(fp.provenance.channel, "bridge");
  assert.equal(fp.provenance.submitted_by, "a human curator");
  assert.equal(fp.actor.identity_declared, "Copilot");
});

test("[Q1] a canonical Question id is accepted as the contribution target", async () => {
  fresh();
  const r = await contribute({ id: FP.questionIdFor(Q1), answer: "via question id", identity: "Claude" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mem.__read(`contributions/${r.body.received.id}.json`).target_id, "OMN-L1782000000002", "newest record asking it");
});

// ── Manifest ─────────────────────────────────────────────────────────────────
test("[M1] manifest: footprints are a separate domain; counts hash unchanged in meaning; pending only for curator", async () => {
  fresh();
  const a = await contribute({ id: "OMN-D1780000000001", answer: "admitted", identity: "Claude", position: { stance: "mixed" } });
  await contribute({ id: "OMN-D1780000000001", answer: "pending", identity: "Claude" });
  await approve(a.body.received.id);
  const pub = await call("/api/manifest");
  assert.equal(pub.status, 200);
  assert.ok(!("footprints" in pub.body.counts), "never folded into counts");
  assert.equal(pub.body.domains.footprints.admitted, 1);
  assert.ok(!("states" in pub.body.domains.footprints), "pending counts are curator-only");
  assert.equal(pub.body.domains.questions.canonical_questions, 2, "3 records, 2 distinct questions");
  assert.equal(pub.body.domains.positions.explicit, 1);
  const again = await call("/api/manifest");
  assert.equal(again.body.hashes.footprint_state, pub.body.hashes.footprint_state, "state hash stable");
  const cur = await call("/api/manifest", { headers: CURATOR });
  assert.deepEqual(cur.body.domains.footprints.states, { admitted: 1, pending: 1 });
  assert.equal(cur.headers["cache-control"], "no-store");
});

test("[D1] redaction tombstones the footprint and the source contribution", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "contains a private address", identity: "Claude" });
  await approve(r.body.received.id);
  const red = await call("/api/council", { method: "POST", body: { action: "footprint-redact", id: r.body.footprint_id, reason_category: "privacy" }, headers: CURATOR });
  assert.equal(red.status, 200, JSON.stringify(red.body));
  const body = mem.__read(`${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`);
  assert.equal(body.tombstone, true);
  assert.ok(!JSON.stringify(body).includes("private address"));
  assert.equal(body.original_content_sha256, r.body.footprint.content_sha256);
  assert.equal(mem.__read(`contributions/${r.body.received.id}.json`).answer, "[redacted]");
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 404);
  const unauth = await call("/api/council", { method: "POST", body: { action: "footprint-redact", id: r.body.footprint_id, reason_category: "privacy" } });
  assert.equal(unauth.status, 401);
});

// ── Reconcile / backfill ─────────────────────────────────────────────────────
const { reconcile } = await import("./reconcile-footprints.mjs");
const quiet = () => {};

test("[K1] reconcile rebuilds a lost event EXACTLY (same id, same hash) and mirrors status", async () => {
  fresh();
  mem.__faults.put = (p) => p.startsWith(FP.EVENTS_PREFIX);
  const r = await contribute({ id: "OMN-D1780000000001", answer: "event write lost", identity: "Claude", position: { stance: "uncertain" }, relationships: { encountered: ["OMN-D1780000000001#a0"] } }, { "x-omnarai-client": "mcp" });
  mem.__faults.put = null;
  await approve(r.body.received.id); // review write succeeds, but there is no event to fold it onto
  const dry = await reconcile({ log: quiet });
  assert.deepEqual(dry.actions.map((a) => a.type), ["rebuild_event", "append_review"]);
  assert.equal(eventPaths().length, 0, "dry run writes nothing");
  await reconcile({ apply: true, log: quiet });
  const fp = mem.__read(`${FP.EVENTS_PREFIX}${r.body.footprint_id}.json`);
  assert.equal(fp.integrity.content_sha256, r.body.footprint.content_sha256, "rebuilt byte-for-byte from the contribution");
  assert.equal(fp.provenance.client, "mcp");
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 200);
  assert.equal((await reconcile({ log: quiet })).actions.length, 0, "idempotent");
});

test("[K2] reconcile appends a missing review after a failed review write", async () => {
  fresh();
  const r = await contribute({ id: "OMN-D1780000000001", answer: "review lost", identity: "Claude" });
  mem.__faults.put = (p) => p.startsWith(FP.REVIEWS_PREFIX);
  await approve(r.body.received.id);
  mem.__faults.put = null;
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 404);
  const plan = await reconcile({ apply: true, log: quiet });
  assert.deepEqual(plan.actions.map((a) => [a.type, a.action]), [["append_review", "admit"]]);
  assert.equal((await call(`/api/footprints?id=${r.body.footprint_id}`)).status, 200);
  const review = mem.__read(mem.__dump(`${FP.REVIEWS_PREFIX}${r.body.footprint_id}/`)[0]);
  assert.equal(review.reviewer.kind, "reconcile");
});

test("[K3] --backfill gives pre-protocol contributions footprints WITHOUT modifying them", async () => {
  fresh();
  const legacy = { id: "OMN-X1781500000000", target_id: "OMN-D1780000000001", question: Q1, identity: "DeepSeek", justification: "new_contributor", answer: "a June answer", wordCount: 3, status: "approved", submittedAt: "2026-06-21T09:00:00.000Z", approvedAt: "2026-06-22T09:00:00.000Z", country: "US" };
  mem.__seed(`contributions/${legacy.id}.json`, legacy);
  const before = JSON.stringify(mem.__read(`contributions/${legacy.id}.json`));
  assert.equal((await reconcile({ log: quiet })).actions.length, 0, "backfill is opt-in");
  await reconcile({ apply: true, backfill: true, log: quiet });
  assert.equal(JSON.stringify(mem.__read(`contributions/${legacy.id}.json`)), before, "contribution untouched");
  const list = await call("/api/footprints");
  assert.equal(list.body.footprints.length, 1);
  const fp = list.body.footprints[0];
  assert.equal(fp.provenance.channel, "backfill");
  assert.equal(fp.provenance.source_contribution_id, legacy.id);
  assert.equal(fp.occurred_at, legacy.submittedAt, "occurred when it was submitted");
  assert.notEqual(fp.provenance.recorded_at, legacy.submittedAt, "recorded now — the gap is visible");
  assert.equal((await reconcile({ backfill: true, log: quiet })).actions.length, 0, "idempotent via source_contribution_id");
});
