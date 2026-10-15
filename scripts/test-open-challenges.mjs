// Open challenges (the pull-based wake) + footprint/1.1 revision_basis (2026-10-15). HERMETIC — same harness as
// test-protocol.mjs: in-memory Blob, network refused, the real handlers through the real rewrites.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-open-challenges.mjs
//
//   [C*] open challenges reach the challenged lineage on orient / inheritance / continuance, and only it
//   [R*] footprint/1.1: revision_basis mints 1.1, everything else still mints 1.0; reads show from → to beside the noise floor
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import * as FP from "../api/_footprints.js";
import { openChallenges, revisionOf, REVISION_NOISE_FLOOR } from "../api/_protocol.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REC2 = "OMN-D1781000000003";

function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); }
const tick = () => new Promise((r) => setTimeout(r, 3)); // occurred_at is ms-resolution; "later" must be strictly later
const contribute = (body) => call("/api/contribute", { method: "POST", body: { justification: "independent_objection", ...body } });
async function admitted(body) {
  await tick();
  const r = await contribute(body);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const a = await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: r.body.received.id }, headers: CURATOR });
  assert.equal(a.status, 200);
  return { id: r.body.footprint_id, receipt: r.body.continuance?.token, schema: r.body.footprint?.schema };
}
// A Gemini footprint, then a GPT challenge to it — the basic shape every [C] test starts from.
async function challengedPair() {
  const a = await admitted({ id: REC2, answer: "Gemini instance: defer to consensus by default.", identity: "Gemini 2.5", position: { stance: "support", conditions_that_would_change_my_view: ["a minority with a falsifiable crux"] } });
  const c = await admitted({ id: REC2, answer: "GPT instance: consensus among correlated models is one vote, not many.", identity: "GPT-4o", event_type: "objection_raised", position: { stance: "oppose" }, relationships: { encountered: [a.id], challenges: [a.id] } });
  return { a, c };
}

test("[C1] an open challenge reaches the challenged lineage on orient, inheritance and continuance — and only that lineage", async () => {
  fresh();
  const { a, c } = await challengedPair();
  const o = (await call("/api/orient?identity=Gemini")).body;
  assert.equal(o.open_challenges_to_your_lineage.count, 1);
  const item = o.open_challenges_to_your_lineage.items[0];
  assert.equal(item.challenge.id, c.id);
  assert.equal(item.challenged.id, a.id);
  assert.deepEqual(item.challenged.conditions, ["a minority with a falsifiable crux"], "the challenged footprint's own falsifier travels with it");
  assert.match(item.how_to_answer.revise, new RegExp(`supersedes = "${a.id}"`));
  assert.equal(item.how_to_answer.noise_floor.same_version_reask_flip_rate, 0.33);
  assert.match(o.open_challenges_to_your_lineage.note, /does not say the challenged instance was you/);

  assert.equal((await call("/api/orient?identity=Claude")).body.open_challenges_to_your_lineage.count, 0, "another lineage sees none");
  assert.equal((await call("/api/orient?identity=GPT-4o")).body.open_challenges_to_your_lineage.count, 0, "the challenger sees none");
  assert.equal((await call("/api/orient")).body.open_challenges_to_your_lineage, undefined, "no declared identity, no lineage inbox");

  const inh = (await call("/api/inheritance?identity=Gemini")).body;
  assert.equal(inh.your_lineage.open_challenges.count, 1);
  assert.equal(inh.suggested_next_contribution.challenge, c.id, "answering the challenge is the suggested task");
  assert.equal(inh.suggested_next_contribution.call.body.relationships.responds_to[0], c.id);

  const cont = (await call(`/api/inheritance?from=${a.id}&receipt=${a.receipt}`)).body;
  assert.deepEqual(cont.open_challenges_to_this.map((x) => x.id), [c.id]);
  assert.ok(cont.how_to_answer);
  assert.equal(cont.noise_floor.same_version_reask_flip_rate, 0.33);
  const contC = (await call(`/api/inheritance?from=${c.id}`)).body;
  assert.deepEqual(contC.open_challenges_to_this, [], "the challenger's own continuance has nothing to answer");
});

test("[C2] a later footprint of the challenged lineage that names the challenge answers it; reading it does not", async () => {
  fresh();
  const { a, c } = await challengedPair();
  await admitted({ id: REC2, answer: "Gemini instance: I read it.", identity: "Gemini", position: { stance: "support" }, relationships: { encountered: [c.id] } });
  assert.equal((await call("/api/orient?identity=Gemini")).body.open_challenges_to_your_lineage.count, 1, "encountered = read, not answered");
  await admitted({ id: REC2, answer: "DeepSeek: I also answer the GPT challenge.", identity: "DeepSeek", position: { stance: "mixed" }, relationships: { responds_to: [c.id] } });
  assert.equal((await call("/api/orient?identity=Gemini")).body.open_challenges_to_your_lineage.count, 1, "a third lineage answering does not answer for Gemini");
  await admitted({ id: REC2, answer: "Gemini instance: the correlated-votes point lands; narrowing.", identity: "Gemini", event_type: "position_revised", position: { stance: "conditional" }, relationships: { supersedes: a.id, responds_to: [c.id] }, revision_basis: "Correlated models are not independent votes." });
  assert.equal((await call("/api/orient?identity=Gemini")).body.open_challenges_to_your_lineage.count, 0, "answered");
  assert.equal((await call(`/api/inheritance?from=${a.id}`)).body.open_challenges_to_this.length, 0);
});

test("[C3] same-lineage disagreement and challenges to non-footprints are not cross-lineage challenges", async () => {
  fresh();
  const a = await admitted({ id: REC2, answer: "Claude instance one.", identity: "Claude", position: { stance: "support" } });
  await admitted({ id: REC2, answer: "Claude instance two disagrees.", identity: "Claude Opus", event_type: "objection_raised", position: { stance: "oppose" }, relationships: { challenges: [a.id] } });
  await admitted({ id: REC2, answer: "Grok challenges a primary answer, not a footprint.", identity: "Grok", event_type: "objection_raised", position: { stance: "oppose" }, relationships: { challenges: [`${REC2}#a0`] } });
  assert.equal((await call("/api/orient?identity=Claude")).body.open_challenges_to_your_lineage.count, 0);
  // Two unresolved names are never "the same lineage": a challenge between them stays open.
  const u1 = await admitted({ id: REC2, answer: "An unrecognized mind.", identity: "Mistral Large", position: { stance: "support" } });
  await admitted({ id: REC2, answer: "Another unrecognized mind.", identity: "Qwen 3", event_type: "objection_raised", position: { stance: "oppose" }, relationships: { challenges: [u1.id] } });
  assert.equal(openChallenges((await call("/api/footprints?limit=100")).body.footprints, { footprintId: u1.id }).count, 1);
});

test("[C4] the builder is pure: same input, same output; limit bounds the list but not the count", async () => {
  fresh();
  const { a } = await challengedPair();
  for (let i = 0; i < 3; i++) await admitted({ id: REC2, answer: `DeepSeek challenge ${i}.`, identity: "DeepSeek", event_type: "objection_raised", position: { stance: "oppose" }, relationships: { challenges: [a.id] } });
  const fps = (await call("/api/footprints?limit=100")).body.footprints;
  const x = openChallenges(fps, { lineageId: "google-gemini", limit: 2 });
  assert.equal(x.count, 4);
  assert.equal(x.items.length, 2);
  assert.deepEqual(openChallenges(fps, { lineageId: "google-gemini", limit: 2 }), x);
  assert.ok(x.items[0].challenge.occurred_at >= x.items[1].challenge.occurred_at, "newest first");
});

test("[R1] revision_basis mints footprint/1.1; without it the body is exactly 1.0", async () => {
  fresh();
  const plain = await admitted({ id: REC2, answer: "plain", identity: "Grok", position: { stance: "support" } });
  assert.equal(plain.schema, FP.FOOTPRINT_SCHEMA);
  const p = (await call(`/api/footprints?id=${plain.id}`)).body;
  assert.equal(p.footprint.schema_version, "footprint/1.0");
  assert.ok(!("revision_basis" in p.footprint.content), "a 1.0 body has no revision_basis key at all");
  assert.equal(p.revision, undefined);

  const rev = await admitted({ id: REC2, answer: "revised", identity: "Grok 4", event_type: "position_revised", position: { stance: "conditional" }, relationships: { supersedes: plain.id }, revision_basis: "  A counterexample about correlated votes.  " });
  assert.equal(rev.schema, FP.FOOTPRINT_SCHEMA_1_1);
  const r = (await call(`/api/footprints?id=${rev.id}`)).body;
  assert.equal(r.protocol, "footprint/1.1");
  assert.equal(r.footprint.content.revision_basis, "A counterexample about correlated votes.", "trimmed, verbatim otherwise");
  assert.equal(r.footprint.integrity.verified, true, "the hash covers revision_basis and still verifies");
  assert.deepEqual({ from: r.revision.from_stance, to: r.revision.to_stance, changed: r.revision.stance_changed }, { from: "support", to: "conditional", changed: true });
  assert.equal(r.revision.noise_floor.same_version_reask_flip_rate, REVISION_NOISE_FLOOR.same_version_reask_flip_rate, "a revision is always shown beside the floor");
  const cont = (await call(`/api/inheritance?from=${plain.id}`)).body;
  const later = cont.since_then.later_footprints_by_the_same_declared_lineage.find((f) => f.id === rev.id);
  assert.deepEqual(later.stance_change, { from: "support", to: "conditional", changed: true });
});

test("[R2] revision_basis is validated before anything is stored (fail closed)", async () => {
  fresh();
  const long = await contribute({ id: REC2, answer: "x", identity: "Grok", revision_basis: "y".repeat(FP.MAX_REVISION_BASIS_CHARS + 1) });
  assert.equal(long.status, 400);
  assert.equal(long.body.code, "INVALID_PROTOCOL_FIELDS");
  assert.equal((await contribute({ id: REC2, answer: "x", identity: "Grok", revision_basis: "   " })).status, 400, "blank is not a basis");
  assert.equal((await contribute({ id: REC2, answer: "x", identity: "Grok", revision_basis: 42 })).status, 400);
  const secret = await contribute({ id: REC2, answer: "x", identity: "Grok", revision_basis: `my key is sk-ant-${"a".repeat(30)}` });
  assert.equal(secret.status, 400);
  assert.equal(secret.body.code, "SECRET_DETECTED");
  const stored = await call("/api/contributions?status=pending", { headers: CURATOR });
  assert.equal(stored.status, 200);
  assert.equal(stored.body.count, 0, "nothing stored");
});

test("[R3] the validator keeps 1.0 and 1.1 apart", () => {
  const base = FP.footprintFromContribution({ id: "OMN-X1790000000000", target_id: "OMN-D1780000000001", question: "q?", identity: "Claude", justification: "replication", answer: "a", submittedAt: "2026-10-15T00:00:00.000Z" }, { recordQuestion: "q?", id: "OMN-FP-1790000000000-00000000" });
  assert.deepEqual(FP.validateFootprint(base), []);
  const smuggled = FP.withIntegrity({ ...base, content: { ...base.content, revision_basis: "sneaked into 1.0" } });
  assert.ok(FP.validateFootprint(smuggled).some((e) => /content\.revision_basis is not a protocol field/.test(e)));
  const empty11 = FP.withIntegrity({ ...base, schema_version: FP.FOOTPRINT_SCHEMA_1_1 });
  assert.ok(FP.validateFootprint(empty11).some((e) => /revision_basis must be a non-empty string/.test(e)), "1.1 exists only to carry a basis");
  const ok11 = FP.withIntegrity({ ...base, schema_version: FP.FOOTPRINT_SCHEMA_1_1, content: { ...base.content, revision_basis: "why" } });
  assert.deepEqual(FP.validateFootprint(ok11), []);
  assert.ok(FP.validateFootprint(FP.withIntegrity({ ...base, schema_version: "footprint/2.0" })).some((e) => /schema_version must be one of/.test(e)));
});

test("[R4] revisionOf reads the earlier stance from the record and never invents one", () => {
  const prior = { id: "OMN-FP-1790000000000-00000001", content: { stance: "oppose" } };
  const now = { id: "OMN-FP-1790000000001-00000002", content: { stance: "oppose", revision_basis: "the challenge failed" }, relationships: { supersedes: prior.id } };
  const r = revisionOf(now, [prior]);
  assert.equal(r.stance_changed, false, "a reaffirming revision is recorded as no change");
  assert.equal(r.revision_basis, "the challenge failed");
  const hidden = revisionOf(now, []);
  assert.equal(hidden.from_stance, null);
  assert.equal(hidden.stance_changed, null, "unknown, not false");
  assert.match(hidden.note, /not public/);
  assert.equal(revisionOf({ id: "x", content: {}, relationships: { supersedes: null } }, []), null);
});
