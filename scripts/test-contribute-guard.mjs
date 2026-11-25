// /api/contribute flood guard (Full Expansion Architecture §34: rate limiting + deduplication).
//
// Before this guard the open, unauthenticated write path had a size cap, a justification vocabulary and
// secret detection, but nothing stopped one caller from writing unbounded contributions + footprints into
// the curator's pending queue, or resubmitting the identical answer in a loop. These tests pin the contract:
//   • an exact duplicate (same question, same declared identity, same text after case/whitespace folding) is
//     refused with 409 and points at the original; a different identity, question or text is NOT a duplicate;
//   • each visitor has a daily cap (CONTRIB_DAILY_CAP, default 10) → 429 with Retry-After and resets_at;
//     a different visitor, the curator and `x-omnarai-self` are not metered;
//   • a rejected or failed submission never spends the visitor's allowance;
//   • BOTH checks fail OPEN on a storage error (they protect the queue and the storage bill, not security:
//     moderation still gates publication), and a legacy-shaped submission still succeeds unchanged.
//
// HERMETIC:  node --import ./scripts/lib/register-mem-blob.mjs scripts/test-contribute-guard.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, Q1 } from "./lib/fixtures.mjs";

process.env.INGEST_SECRET = "test-curator-secret";
const ID1 = "OMN-D1780000000001"; // fixture record on Q1
const ID3 = "OMN-D1781000000003"; // fixture record on Q2
const from = (ip, extra = {}) => ({ "x-forwarded-for": ip, ...extra });
const send = (body, headers = from("203.0.113.7")) =>
  call("/api/contribute", { method: "POST", headers, body: { id: ID1, identity: "Gemini 3", justification: "independent_objection", answer: "A distinct answer.", ...body } });

function fresh(cap = "3") {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
  process.env.CONTRIB_DAILY_CAP = cap;
}

test("same answer, different request → 409 pointing at the original; nothing new is stored", async () => {
  fresh();
  const a = await send({ answer: "The burden of proof sits with the one overriding the person." });
  assert.equal(a.status, 200);
  const before = (mem.__dump("contributions/").length + mem.__dumpPrivate("contributions/").length) + (mem.__dump("footprints/events/").length + mem.__dumpPrivate("footprints/events/").length);
  const b = await send({ answer: "The burden of proof sits with the one overriding the person.", position: { stance: "support" } });
  assert.equal(b.status, 409);
  assert.equal(b.body.code, "DUPLICATE_CONTRIBUTION");
  assert.equal(b.body.existing_contribution_id, a.body.received.id);
  assert.equal((mem.__dump("contributions/").length + mem.__dumpPrivate("contributions/").length) + (mem.__dump("footprints/events/").length + mem.__dumpPrivate("footprints/events/").length), before, "no new blobs");
});

// Safe retries (2026-11-25): the identical request again (a client retrying after a lost response) gets the
// ORIGINAL receipt back — same footprint id, same token, same content hash — and nothing is stored or spent.
test("identical request again → 200 replay of the original receipt; nothing stored, no allowance spent", async () => {
  fresh("2");
  const a = await send({ answer: "Retry me safely." });
  assert.equal(a.status, 200);
  const before = (mem.__dump("contributions/").length + mem.__dumpPrivate("contributions/").length) + (mem.__dump("footprints/events/").length + mem.__dumpPrivate("footprints/events/").length);
  for (let i = 0; i < 3; i++) {
    const r = await send({ answer: "Retry me safely." });
    assert.equal(r.status, 200, `replay ${i}`);
    assert.equal(r.body.replayed, true);
    assert.equal(r.body.footprint_id, a.body.footprint_id);
    assert.equal(r.body.continuance.token, a.body.continuance.token);
    assert.equal(r.body.continuance.content_hash, a.body.continuance.content_hash);
    assert.equal(r.body.received.id, a.body.received.id);
  }
  assert.equal((mem.__dump("contributions/").length + mem.__dumpPrivate("contributions/").length) + (mem.__dump("footprints/events/").length + mem.__dumpPrivate("footprints/events/").length), before, "no new blobs");
  assert.equal((await send({ answer: "a second real one" })).status, 200, "replays did not spend the cap of 2");
});

test("a cosmetic variant of a stored answer is NOT a replay (still 409)", async () => {
  fresh("10");
  assert.equal((await send({ answer: "Exact bytes matter." })).status, 200);
  const r = await send({ answer: "exact  bytes matter." });
  assert.equal(r.status, 409);
  assert.notEqual(r.body.replayed, true);
});

test("duplicate detection folds case and whitespace, and is not fooled by cosmetic edits", async () => {
  fresh("50");
  const a = await send({ answer: "Hold the line on consent." });
  assert.equal(a.status, 200);
  for (const variant of ["hold  the LINE on   consent.", "  Hold the line on consent.\n", "HOLD THE LINE ON CONSENT."]) {
    const r = await send({ answer: variant }, from("198.51.100.9"));
    assert.equal(r.status, 409, variant);
  }
});

test("a different identity, question or text is not a duplicate", async () => {
  fresh("50");
  assert.equal((await send({ answer: "Same words." })).status, 200);
  assert.equal((await send({ answer: "Same words.", identity: "GPT 5" }, from("198.51.100.1"))).status, 200, "different identity");
  assert.equal((await send({ answer: "Same words.", id: ID3 }, from("198.51.100.2"))).status, 200, "different question");
  assert.equal((await send({ answer: "Same words, changed." }, from("198.51.100.3"))).status, 200, "different text");
});

test("per-visitor daily cap → 429 with Retry-After + resets_at; other visitors unaffected", async () => {
  fresh("3");
  for (let i = 0; i < 3; i++) assert.equal((await send({ answer: `answer ${i}` })).status, 200, `submission ${i}`);
  const over = await send({ answer: "answer 4" });
  assert.equal(over.status, 429);
  assert.equal(over.body.code, "CONTRIBUTION_QUOTA");
  assert.equal(over.body.cap, 3);
  assert.equal(over.body.used, 3);
  assert.ok(Date.parse(over.body.resets_at) > Date.now(), "resets_at is a future instant");
  assert.ok(Number(over.headers["retry-after"]) >= 1, "Retry-After header present");
  assert.equal((await send({ answer: "answer from someone else" }, from("198.51.100.77"))).status, 200, "a different visitor is not capped");
});

test("the curator and self-checks are not metered", async () => {
  fresh("1");
  assert.equal((await send({ answer: "one" })).status, 200);
  assert.equal((await send({ answer: "two" })).status, 429, "capped");
  const curator = from("203.0.113.7", { authorization: "Bearer test-curator-secret" });
  assert.equal((await send({ answer: "curator three" }, curator)).status, 200);
  assert.equal((await send({ answer: "self four" }, from("203.0.113.7", { "x-omnarai-self": "1" }))).status, 200);
});

test("a rejected submission never spends the allowance", async () => {
  fresh("2");
  for (let i = 0; i < 6; i++) {
    const bad = await send({ answer: `bad ${i}`, position: { stance: "not-a-stance" } });
    assert.equal(bad.status, 400);
    const noJust = await send({ answer: `bad ${i}`, justification: "nope" });
    assert.equal(noJust.status, 400);
  }
  assert.equal((await send({ answer: "first real" })).status, 200);
  assert.equal((await send({ answer: "second real" })).status, 200);
  assert.equal((await send({ answer: "third real" })).status, 429, "only the two successes counted");
});

test("an unidentifiable caller (no IP) is never capped, but exact duplicates are still refused", async () => {
  fresh("1");
  for (let i = 0; i < 4; i++) assert.equal((await send({ answer: `anon ${i}` }, {})).status, 200);
  assert.equal((await send({ answer: "ANON 0" }, {})).status, 409);
});

test("both checks FAIL OPEN when storage cannot be read (they guard the queue, not security)", async () => {
  fresh("1");
  assert.equal((await send({ answer: "seed one" })).status, 200);
  // A hole in the ledger must not block a legitimate visitor, nor turn into a false duplicate.
  mem.__faults.list = (prefix) => prefix.startsWith("contribute-usage/") || prefix.startsWith("contribute-dedupe/");
  const r = await send({ answer: "seed one" }); // would be a duplicate AND over cap if the ledger were readable
  mem.__faults.list = null;
  assert.equal(r.status, 200, "open on storage error");
});

test("a legacy-shaped submission still works and the response contract is unchanged", async () => {
  fresh("10");
  const r = await call("/api/contribute", { method: "POST", headers: from("203.0.113.55"), body: { id: ID1, identity: "Claude", justification: "independent_objection", answer: "Plain legacy answer." } });
  assert.equal(r.status, 200);
  assert.ok(r.body.received.id && r.body.footprint_id);
  assert.equal(r.body.received.status ?? "pending", "pending");
});
