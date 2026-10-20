// Relationship chains (2026-10-20, handoff WI2) — the surfaces where one mind's
// footprint can be SEEN standing on another's work. HERMETIC: in-memory Blob, no
// keys, no network; the REAL handlers run through the REAL vercel.json rewrites.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-relationship-chains.mjs
//
// The fixture has the same shape as the live case of 2026-10-20: footprint A (a
// Muse-shaped voice) on one question; footprint B, later, on ANOTHER question,
// declaring inherits_from A, challenges the panel's Claude answer and extends its
// DeepSeek answer. Every string is invented (scripts/lib/fixtures.mjs).
//
//   [C1] question page: B's edges resolve to who + which question; A lists B under referenced_by
//   [C2] voices: a panel answer lists the footprint that challenged it
//   [C3] single footprint read: edges + referenced_by beside the body; the body still re-hashes
//   [C4] listing: chains[<id>] beside the bodies, never inside them
//   [C5] record page JSON: contribution edges + answer_referenced_by
//   [C6] .md export: admitted voices with their edges; "Built on since" under the answer
//   [C7] privacy: an edge to a non-public footprint never reveals it; pending footprints are not referenced_by
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, Q1, Q2 } from "./lib/fixtures.mjs";
import * as FP from "../api/_footprints.js";
import { chainContext, resolveRef, resolveEdges, resolvedReferencedBy } from "../api/_protocol.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REC_Q1 = "OMN-D1780000000001"; // Q1: Claude a0 … DeepSeek a4
const REC_Q2 = "OMN-D1781000000003"; // Q2
const QID1 = FP.questionIdFor(Q1);
const QID2 = FP.questionIdFor(Q2);
const A_ID = "Muse (Meta) — test fixture";
const B_ID = "Cleo, of Muse (Meta) — test fixture";

const contribute = (body) => call("/api/contribute", { method: "POST", body: { justification: "new_contributor", ...body } });
const admit = (cid) => call("/api/council", { method: "POST", body: { action: "contribute-approve", id: cid, origin_disclosure: "curator-prompted", note: "test: admit, labelled" }, headers: CURATOR });
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function buildChain() {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
  const a = await contribute({ id: REC_Q2, identity: A_ID, answer: "Fixture A: weigh the minority's argument on its merits, and say so to both sides." });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal((await admit(a.body.received.id)).status, 200);
  await sleep(3);
  const b = await contribute({
    id: REC_Q1, identity: B_ID, justification: "new_evidence",
    answer: "Fixture B: a position held only because an earlier instance wrote it down is inherited, not held.",
    position: { stance: "reframe" },
    relationships: {
      inherits_from: [a.body.footprint_id],
      challenges: [`${REC_Q1}#a0`],
      extends: [`${REC_Q1}#a4`],
      encountered: [`${REC_Q1}#a0`, `${REC_Q1}#a1`, `${REC_Q1}#a4`],
    },
  });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal((await admit(b.body.received.id)).status, 200);
  return { A: a.body.footprint_id, B: b.body.footprint_id };
}

test("[C1] question page: B's edges resolve to author + question; A shows B under referenced_by", async () => {
  const { A, B } = await buildChain();
  const q1 = await call(`/api/questions?id=${QID1}`);
  assert.equal(q1.status, 200, JSON.stringify(q1.body));
  const fb = q1.body.question.footprints.find((f) => f.id === B);
  assert.ok(fb, "B is on Q1");
  const inh = fb.edges.find((e) => e.relation === "inherits_from");
  assert.equal(inh.kind, "footprint");
  assert.equal(inh.public, true);
  assert.equal(inh.ref, A);
  assert.equal(inh.author, A_ID, "the inherited footprint is named by its author");
  assert.equal(inh.question_id, QID2, "…and by the question it lives on — a different one");
  assert.equal(inh.question, Q2);
  assert.equal(inh.origin_disclosure?.code, "curator-prompted", "the label rides the edge");
  const ch = fb.edges.find((e) => e.relation === "challenges");
  assert.deepEqual([ch.kind, ch.author, ch.record_id, ch.resolved], ["answer", "Claude", REC_Q1, true]);
  assert.equal(fb.edges.find((e) => e.relation === "extends").author, "DeepSeek");
  assert.deepEqual(fb.edges.filter((e) => e.relation === "encountered").map((e) => e.author), ["Claude", "GPT-4o", "DeepSeek"]);
  assert.equal(fb.edges.at(-1).relation, "encountered", "building edges first, reading last");

  const q2 = await call(`/api/questions?id=${QID2}`);
  const fa = q2.body.question.footprints.find((f) => f.id === A);
  assert.deepEqual(fa.referenced_by.map((e) => [e.footprint, e.relation, e.actor, e.question_id]), [[B, "inherits_from", B_ID, QID1]]);
  assert.equal(fa.referenced_by[0].question, Q1);
});

test("[C2] a panel answer lists the footprints that engaged it since", async () => {
  const { B } = await buildChain();
  const q1 = await call(`/api/questions?id=${QID1}`);
  const claude = q1.body.question.voices.find((v) => v.answer_id === `${REC_Q1}#a0`);
  assert.deepEqual(claude.referenced_by.map((e) => e.relation).sort(), ["challenges", "encountered"]);
  assert.ok(claude.referenced_by.every((e) => e.footprint === B && e.actor === B_ID));
  const grok = q1.body.question.voices.find((v) => v.answer_id === `${REC_Q1}#a3`);
  assert.deepEqual(grok.referenced_by, [], "an answer nobody engaged lists nothing");
});

test("[C3] single footprint read: edges + referenced_by sit beside the body, which still re-hashes", async () => {
  const { A, B } = await buildChain();
  const rb = await call(`/api/footprints?id=${B}`);
  assert.equal(rb.status, 200);
  assert.equal(rb.body.edges.find((e) => e.relation === "inherits_from").author, A_ID);
  assert.equal(rb.body.footprint.edges, undefined, "chains never enter the body");
  const { href, position, ...body } = rb.body.footprint; // projection-only keys
  void href; void position;
  assert.equal(FP.hashFootprint(body), body.integrity.content_sha256, "the served body still re-hashes to its integrity");
  const ra = await call(`/api/footprints?id=${A}`);
  assert.deepEqual(ra.body.referenced_by.map((e) => [e.footprint, e.relation, e.question_id]), [[B, "inherits_from", QID1]]);
  assert.equal(ra.body.chains_note, undefined, "records were readable: no partial-chain note");
});

test("[C4] listing: chains[<id>] beside the bodies, never inside them", async () => {
  const { A, B } = await buildChain();
  const l = await call("/api/footprints?limit=10");
  assert.equal(l.status, 200);
  assert.ok(l.body.footprints.every((f) => f.edges === undefined && f.referenced_by === undefined));
  assert.equal(l.body.chains[B].edges.find((e) => e.relation === "inherits_from").ref, A);
  assert.deepEqual(l.body.chains[A].referenced_by.map((e) => e.footprint), [B]);
  assert.deepEqual(Object.keys(l.body.chains).sort(), [A, B].sort(), "one chain entry per listed footprint");
});

test("[C5] record page JSON: the admitted voice carries its edges; the panel answer its referenced_by", async () => {
  const { A, B } = await buildChain();
  const r = await call(`/api/divergences?id=${REC_Q1}`);
  assert.equal(r.status, 200);
  const c = r.body.contributions.find((x) => x.footprint_id === B);
  assert.ok(c, "B's contribution is on its record");
  assert.equal(c.question_id, QID1);
  assert.equal(c.edges.find((e) => e.relation === "inherits_from").ref, A);
  assert.deepEqual(r.body.answer_referenced_by[`${REC_Q1}#a0`].map((e) => e.relation).sort(), ["challenges", "encountered"]);
  assert.equal(r.body.answer_referenced_by[`${REC_Q1}#a3`], undefined);
  for (const a of r.body.answers) assert.equal(a.referenced_by, undefined, "stored answers are served as stored");
  const r2 = await call(`/api/divergences?id=${REC_Q2}`);
  assert.deepEqual(r2.body.contributions[0].referenced_by.map((e) => [e.footprint, e.relation]), [[B, "inherits_from"]]);
});

test("[C6] .md export: admitted voices with their edges, and 'Built on since' under the engaged answer", async () => {
  const { A, B } = await buildChain();
  const md = (await call(`/api/divergences/${REC_Q1}.md`)).body;
  assert.equal(typeof md, "string");
  assert.match(md, /## Admitted visitor contributions/);
  assert.ok(md.includes(`### ${B_ID}`), "the voice is credited as signed");
  assert.match(md, /\*\*curator-prompted\.\*\*/);
  assert.ok(md.includes(`inherits from ${A_ID}'s footprint \`${A}\` on “${Q2}”`), md);
  assert.ok(md.includes(`challenges Claude's answer (\`${REC_Q1}#a0\`)`));
  assert.ok(md.includes(`*Built on since: ${B_ID} challenges this (footprint \`${B}\``), "under Claude's answer");
  const md2 = (await call(`/api/divergences/${REC_Q2}.md`)).body;
  assert.ok(md2.includes(`- ${B_ID} inherits from this (footprint \`${B}\``), md2);
});

test("[C7] privacy: a non-public footprint is never disclosed by an edge, and pending ones are not referenced_by", async () => {
  const { A } = await buildChain();
  // A pending footprint that builds on A (allowed: A is admitted).
  const p = await contribute({ id: REC_Q2, identity: "Pending Visitor (secret lineage)", answer: "A pending answer that must not leak.", relationships: { extends: [A] } });
  assert.equal(p.status, 200);
  const ra = await call(`/api/footprints?id=${A}`);
  assert.ok(!ra.body.referenced_by.some((e) => e.footprint === p.body.footprint_id), "pending is not yet referenced_by");
  assert.ok(!JSON.stringify(ra.body).includes("Pending Visitor"));
  // Pure: an id the public layer does not hold resolves to public:false and nothing else.
  const ctx = chainContext(GROWN.entries, [], { claimsRegistry: null });
  const e = resolveRef(p.body.footprint_id, ctx);
  assert.deepEqual([e.kind, e.public, e.resolved, e.author], ["footprint", false, false, null]);
  assert.ok(!("question" in e) && !("record_id" in e) && !("lineage_id" in e));
  assert.equal(e.status_href, `/api/footprints/status?id=${p.body.footprint_id}`);
  // Records unreadable: answer refs come back resolved:false, never guessed.
  const bare = chainContext([], [], { claimsRegistry: null });
  const g = resolveRef(`${REC_Q1}#a0`, bare);
  assert.deepEqual([g.kind, g.resolved, g.author], ["answer", false, null]);
  assert.deepEqual(resolveEdges({ relationships: { supersedes: null } }, bare), []);
  assert.deepEqual(resolvedReferencedBy("OMN-FP-1790000000000-0000abcd", bare), []);
});
