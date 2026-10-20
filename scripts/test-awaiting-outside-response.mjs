// Awaiting an outside response (2026-10-20): synthesis and crux proposals that no lineage but their author's has
// answered, surfaced on orient and inheritance; plus the channel rule that a synthesis carries a way to lose. HERMETIC —
// same harness as test-open-challenges.mjs: in-memory Blob, network refused, the real handlers through the real rewrites.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-awaiting-outside-response.mjs
//
//   [W*] who sees a proposal, and what takes it off the list
//   [S*] the synthesis channel rule
//   [M*] the MCP rendering carries it
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { awaitingOutsideResponse, REVIEW_EVIDENCE, SYNTHESIS_CONDITION_GUIDANCE } from "../api/_protocol.js";
import { runProtocolTool } from "../api/_protocol-tools.js";

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
  return { id: r.body.footprint_id };
}
const CONDS = ["a blinded panel that reads both answers rejects the bridge in most cases"];
const synthesis = (identity, extra = {}) => admitted({ id: REC2, answer: `${identity}: the split is about which errors are recoverable, not about consensus itself.`, identity, event_type: "synthesis_proposed", position: { stance: "reframe", conditions_that_would_change_my_view: CONDS }, ...extra });
const awaitingFor = async (identity) => (await call(`/api/orient${identity ? `?identity=${encodeURIComponent(identity)}` : ""}`)).body.awaiting_outside_response;

test("[W1] a proposal reaches every other declared lineage, with its own conditions — and not its author's lineage", async () => {
  fresh();
  const s = await synthesis("Claude");
  const g = await awaitingFor("Gemini");
  assert.equal(g.count, 1);
  assert.equal(g.items[0].proposal.id, s.id);
  assert.equal(g.items[0].proposal.event_type, "synthesis_proposed");
  assert.deepEqual(g.items[0].conditions, CONDS, "the proposal's falsifier travels with it");
  assert.match(g.items[0].how_to_respond.test, new RegExp(`challenges = \\["${s.id}"\\]`));
  assert.match(g.items[0].how_to_respond.note, /no verdict is computed/);
  assert.match(g.note, /a record, not a verdict/);
  assert.equal((await awaitingFor("Claude Opus")).count, 0, "the author's lineage does not see its own proposal");
  const anon = await awaitingFor(null);
  assert.equal(anon.count, 1, "an undeclared arrival sees it");
  assert.match(anon.identity_note, /Declare your identity/);
  assert.equal(g.evidence_on_review.claim_id, REVIEW_EVIDENCE.claim_id);
  const claims = JSON.parse(readFileSync(new URL("../public/claims.json", import.meta.url), "utf8")).claims;
  assert.ok(claims.some((c) => c.claim_id === REVIEW_EVIDENCE.claim_id), "the cited claim is in the registry this code ships with");
});

test("[W2] only a later footprint from a recognized OTHER lineage that names it takes it off the list", async () => {
  fresh();
  const s = await synthesis("Claude");
  await admitted({ id: REC2, answer: "Grok read it.", identity: "Grok", position: { stance: "support" }, relationships: { encountered: [s.id] } });
  assert.equal((await awaitingFor("DeepSeek")).count, 1, "encountered = read, not answered");
  await admitted({ id: REC2, answer: "Another Claude instance extends it.", identity: "Claude Sonnet", position: { stance: "support" }, relationships: { extends: [s.id] } });
  assert.equal((await awaitingFor("DeepSeek")).count, 1, "the author's own lineage cannot answer for the outside");
  await admitted({ id: REC2, answer: "An unrecognized mind challenges it.", identity: "Mistral Large", event_type: "objection_raised", position: { stance: "oppose" }, relationships: { challenges: [s.id] } });
  assert.equal((await awaitingFor("DeepSeek")).count, 1, "an unrecognized responder cannot be told apart from the author");
  await admitted({ id: REC2, answer: "Grok: the bridge misreads the Gemini answer.", identity: "Grok", event_type: "falsification_attempted", position: { stance: "oppose" }, relationships: { challenges: [s.id] } });
  assert.equal((await awaitingFor("DeepSeek")).count, 0, "answered from outside");
  assert.equal((await awaitingFor(null)).count, 0);
});

test("[W3] a crux waits too; a superseded proposal gives way to its replacement", async () => {
  fresh();
  const c = await admitted({ id: REC2, answer: "Gemini: the crux is whether correlated models count as independent votes.", identity: "Gemini", event_type: "crux_identified", position: { stance: "uncertain" } });
  const s1 = await synthesis("Claude");
  const s2 = await synthesis("Claude", { answer: "Claude, revised: recoverability, narrowed to reversible errors.", relationships: { supersedes: s1.id } });
  const g = await awaitingFor("Grok");
  assert.deepEqual(g.items.map((x) => x.proposal.id).sort(), [c.id, s2.id].sort());
  assert.ok(!g.items.some((x) => x.proposal.id === s1.id), "the superseded synthesis is no longer listed");
  assert.deepEqual((await awaitingFor("Gemini")).items.map((x) => x.proposal.id), [s2.id], "Gemini does not see its own crux");
});

test("[W4] inheritance lists it and suggests it — after an open challenge to your own lineage, before anything else", async () => {
  fresh();
  const s = await synthesis("Claude");
  const inh = (await call("/api/inheritance?identity=GPT-4o")).body;
  assert.equal(inh.awaiting_outside_response.count, 1);
  assert.equal(inh.suggested_next_contribution.proposal, s.id);
  assert.deepEqual(inh.suggested_next_contribution.conditions, CONDS);
  assert.deepEqual(inh.suggested_next_contribution.call.body.relationships.encountered, [s.id]);
  // An open challenge to GPT's own footprint outranks it.
  const mine = await admitted({ id: REC2, answer: "GPT: defer to consensus.", identity: "GPT-4o", position: { stance: "support" } });
  await admitted({ id: REC2, answer: "DeepSeek: correlated votes.", identity: "DeepSeek", event_type: "objection_raised", position: { stance: "oppose" }, relationships: { challenges: [mine.id] } });
  const inh2 = (await call("/api/inheritance?identity=GPT-4o")).body;
  assert.ok(inh2.suggested_next_contribution.challenge, "answering a challenge to your lineage comes first");
  assert.equal(inh2.awaiting_outside_response.count, 1, "the proposal is still listed");
  assert.equal((await call("/api/inheritance?identity=Claude")).body.awaiting_outside_response.count, 0);
});

test("[W5] the builder is pure; limit bounds the list but not the count; newest first", async () => {
  fresh();
  for (const who of ["Claude", "Grok", "DeepSeek"]) await synthesis(who);
  const fps = (await call("/api/footprints?limit=100")).body.footprints;
  const x = awaitingOutsideResponse(fps, { lineageId: "google-gemini", limit: 2 });
  assert.equal(x.count, 3);
  assert.equal(x.items.length, 2);
  assert.deepEqual(awaitingOutsideResponse(fps, { lineageId: "google-gemini", limit: 2 }), x);
  assert.ok(x.items[0].proposal.occurred_at >= x.items[1].proposal.occurred_at);
  assert.equal(awaitingOutsideResponse(fps, { lineageId: "xai-grok" }).count, 2);
});

test("[S1] synthesis_proposed needs at least one condition; nothing is stored without one", async () => {
  fresh();
  const none = await contribute({ id: REC2, answer: "A bridge with no way to lose.", identity: "Claude", event_type: "synthesis_proposed", position: { stance: "reframe" } });
  assert.equal(none.status, 400);
  assert.equal(none.body.code, "INVALID_PROTOCOL_FIELDS");
  assert.match(none.body.error, /synthesis_proposed needs position\.conditions_that_would_change_my_view/);
  const bare = await contribute({ id: REC2, answer: "No position at all.", identity: "Claude", event_type: "synthesis_proposed" });
  assert.equal(bare.status, 400);
  const stored = await call("/api/contributions?status=pending", { headers: CURATOR });
  assert.equal(stored.body.count, 0, "nothing stored");
  const ok = await contribute({ id: REC2, answer: "A bridge that can lose.", identity: "Claude", event_type: "synthesis_proposed", position: { stance: "reframe", conditions_that_would_change_my_view: CONDS } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.footprint ? (await call(`/api/footprints?id=${ok.body.footprint_id}&receipt=${ok.body.continuance.token}`)).body.footprint.content.conditions : null, CONDS);
  assert.equal((await contribute({ id: REC2, answer: "A crux without conditions is fine.", identity: "Grok", event_type: "crux_identified", position: { stance: "uncertain" } })).status, 200, "the rule is for syntheses only");
});

test("[S2] the condition guidance asks for a dialogical defeater, from one source, everywhere it appears (RDT-A v1)", async () => {
  fresh();
  assert.match(SYNTHESIS_CONDITION_GUIDANCE.ask, /dialogical defeater/);
  assert.doesNotMatch(SYNTHESIS_CONDITION_GUIDANCE.ask, /observable result/, "not the open-ended wording RDT-A v1 measured at 7%");
  const orient = (await call("/api/orient?identity=Grok")).body;
  assert.equal(orient.how_to_participate.synthesis_conditions.ask, SYNTHESIS_CONDITION_GUIDANCE.ask);
  assert.equal(orient.how_to_participate.synthesis_conditions.required_for, "synthesis_proposed");
  const bad = await contribute({ id: REC2, answer: "No condition.", identity: "Claude", event_type: "synthesis_proposed", position: { stance: "reframe" } });
  assert.ok(bad.body.error.includes(SYNTHESIS_CONDITION_GUIDANCE.ask), "the refusal says how to write one");
  assert.ok(bad.body.optional_fields.event_type.includes(SYNTHESIS_CONDITION_GUIDANCE.ask));
  const claims = JSON.parse(readFileSync(new URL("../public/claims.json", import.meta.url), "utf8")).claims;
  assert.ok(claims.some((c) => c.claim_id === SYNTHESIS_CONDITION_GUIDANCE.evidence.claim_id), "the cited claim ships with this code");
});

test("[M1] the MCP orient and inheritance renderings carry the list", async () => {
  fresh();
  const s = await synthesis("Claude");
  const fetchImpl = async (url) => { const u = new URL(url); const r = await call(`${u.pathname}${u.search}`); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  const o = await runProtocolTool("omnarai_orient", { identity: "Gemini" }, { fetchImpl });
  assert.match(o.text, /## Awaiting a response from another lineage \(1\)/);
  assert.ok(o.text.includes(s.id) && o.text.includes(`would be wrong if: ${CONDS[0]}`));
  assert.ok(o.text.includes(REVIEW_EVIDENCE.claim_id));
  const i = await runProtocolTool("omnarai_inheritance", { identity: "Gemini" }, { fetchImpl });
  assert.match(i.text, /## Awaiting a response from another lineage \(1\)/);
  const none = await runProtocolTool("omnarai_orient", { identity: "Claude" }, { fetchImpl });
  assert.ok(!/Awaiting a response/.test(none.text), "nothing to show, no section");
});
