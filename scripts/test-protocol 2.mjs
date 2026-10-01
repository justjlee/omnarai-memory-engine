// Protocol read surfaces (Phases 2–4): /api/orient, /api/questions,
// /api/positions, /api/concordance. HERMETIC — same harness as
// test-footprints.mjs (in-memory Blob, network refused, real handlers + rewrites).
//
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-protocol.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, Q1, Q2 } from "./lib/fixtures.mjs";
import * as FP from "../api/_footprints.js";
import { DERIVED_PREFIX, DERIVED_REVIEW_PREFIX } from "../api/_protocol.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const QID1 = FP.questionIdFor(Q1), QID2 = FP.questionIdFor(Q2);

function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); }
const contribute = (body) => call("/api/contribute", { method: "POST", body: { justification: "independent_objection", ...body } });
const approve = (id) => call("/api/council", { method: "POST", body: { action: "contribute-approve", id }, headers: CURATOR });
async function admitted(body) {
  const r = await contribute(body);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  await approve(r.body.received.id);
  return r.body.footprint_id;
}
const deepKeys = (o, acc = []) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { acc.push(k); deepKeys(v, acc); } return acc; };

// ── Questions ────────────────────────────────────────────────────────────────
test("questions: re-elicitations fold into one Question; text is the earliest verbatim wording", async () => {
  fresh();
  const r = await call("/api/questions");
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  const q1 = r.body.questions.find((q) => q.id === QID1);
  assert.equal(q1.text, Q1);
  assert.deepEqual(q1.records.map((x) => x.id), ["OMN-D1780000000001", "OMN-L1782000000002"]);
  assert.equal(q1.counts.primary_answers, 7);
  assert.ok(q1.lineages_missing.includes("meta-llama"));
  const one = await call(`/api/questions?id=${QID1}`);
  assert.equal(one.body.question.voices.length, 7);
  assert.equal(one.body.question.voices[0].answer_id, "OMN-D1780000000001#a0");
  assert.equal(one.body.question.voices[0].text, GROWN.entries[0].divergence.answers[0].text, "verbatim, never summarized");
  assert.equal(one.body.question.tensions[0].tension_ref, "OMN-D1780000000001#t0");
  assert.equal((await call("/api/questions?id=OMN-Q-000000000000")).status, 404);
  const missing = await call("/api/questions?lineage_missing=deepseek");
  assert.deepEqual(missing.body.questions.map((q) => q.id), [QID2]);
});

// ── Orient ───────────────────────────────────────────────────────────────────
test("orient: bounded, deterministic, protocol-first, and carries everything the acceptance test needs", async () => {
  fresh();
  const a = await call("/api/orient?identity=Claude");
  const b = await call("/api/orient?identity=Claude");
  assert.equal(a.status, 200);
  const strip = (x) => JSON.stringify({ ...x, current_state: { ...x.current_state, as_of: null } });
  assert.equal(strip(a.body), strip(b.body), "deterministic");
  assert.ok(JSON.stringify(a.body).length < 16000, `bounded (${JSON.stringify(a.body).length} bytes)`);
  const o = a.body;
  assert.equal(o.protocol.deterministic, true);
  assert.match(o.where_you_are, /archive/i, "what this is");
  assert.match(o.trust_boundary, /EVIDENCE/, "the trust boundary");
  assert.equal(o.declared_identity.lineage_id, "anthropic-claude");
  assert.match(o.declared_identity.how, /never detected or verified/);
  assert.ok(o.historical_record.text.length > 20, "one relevant historical record, verbatim");
  assert.notEqual(FP.resolveLineage(o.historical_record.model).lineage_id, "anthropic-claude", "from ANOTHER lineage");
  assert.match(o.one_recommended_gap.question_id, FP.QUESTION_ID_RE, "one unresolved question");
  assert.equal(o.one_recommended_gap.contribute_template.method, "POST", "how to contribute");
  assert.ok(o.one_recommended_gap.contribute_template.body.relationships.encountered.includes(o.historical_record.answer_id), "pre-filled encounter edge");
  assert.ok(o.after_you_contribute.length >= 3, "what happens after");
  assert.ok(o.open_questions.length <= 3);
  assert.deepEqual(o.next_calls.map((c) => c.step), ["encounter", "encounter", "position", "contribute", "inherit"]);
});

test("orient: focus steers the gap and says so honestly when nothing matches", async () => {
  fresh();
  const hit = await call("/api/orient?identity=Gemini&focus=consensus");
  assert.equal(hit.body.one_recommended_gap.question_id, QID2);
  assert.equal(hit.body.focus.matched, true);
  const miss = await call("/api/orient?focus=zzzzqqq");
  assert.equal(miss.body.focus.matched, false);
  assert.ok(miss.body.focus.note);
  const anon = await call("/api/orient");
  assert.equal(anon.body.declared_identity.recognized, false);
  const unknown = await call("/api/orient?identity=Mistral");
  assert.equal(unknown.body.declared_identity.lineage_id, "unresolved");
  assert.equal(unknown.body.lineage, null);
});

test("orient: a question with an earlier visitor's admitted footprint is recommended — the loop's hand-off", async () => {
  fresh();
  const fpA = await admitted({ id: "OMN-D1781000000003", answer: "Visitor A: minorities deserve a burden-shifting test.", identity: "DeepSeek R2", position: { stance: "conditional" } });
  const o = (await call("/api/orient?identity=Claude")).body;
  assert.equal(o.one_recommended_gap.question_id, QID2);
  assert.match(o.one_recommended_gap.why_this_one, /earlier visiting mind/);
  assert.equal(o.one_recommended_gap.prior_footprints[0].id, fpA);
  assert.ok(o.recent_relevant_footprints.some((f) => f.id === fpA));
  assert.ok(o.one_recommended_gap.contribute_template.body.relationships.encountered.includes(fpA));
  assert.equal(o.current_state.admitted_footprints, 1);
});

test("orient: degrades honestly when the footprint store is unreadable (Atlas parts still complete)", async () => {
  fresh();
  mem.__faults.list = (p) => p.startsWith("footprints/");
  const r = await call("/api/orient?identity=Claude");
  mem.__faults.list = null;
  assert.equal(r.status, 200);
  assert.ok(r.body.footprints_unavailable);
  assert.ok(r.body.one_recommended_gap);
});

test("orient + friends are read-only (POST → 405) and the builders cannot call a model", async () => {
  fresh();
  for (const p of ["/api/orient", "/api/questions", "/api/positions", "/api/concordance"]) {
    assert.equal((await call(p, { method: "POST", body: { action: "contribute" } })).status, 405, p);
  }
  const src = readFileSync(new URL("../api/_protocol.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /anthropic|openai\.com|elicitCouncil|fetch\(/i, "no model client or network call in the protocol builders");
});

// ── Positions + Concordance ──────────────────────────────────────────────────
test("NO SMOOTHING: five distinct positions are all preserved; no consensus, majority or percentage anywhere", async () => {
  fresh();
  const stances = ["support", "oppose", "conditional", "reframe", "uncertain"];
  const ids = [];
  for (const [i, stance] of stances.entries()) {
    ids.push(await admitted({ id: "OMN-D1780000000001", answer: `Visitor ${i} holds ${stance}.`, identity: ["Claude", "GPT-5", "Gemini 3", "Grok 5", "Llama 5"][i], position: { stance, summary: `${stance} because…` } }));
  }
  const c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.status, 200);
  assert.equal(c.body.positions.length, 5);
  assert.deepEqual(c.body.positions.map((p) => p.stance).sort(), [...stances].sort());
  for (const s of stances) assert.equal(c.body.distribution[s], 1);
  assert.equal(c.body.distribution.mixed, 0, "every vocabulary stance reported, zeros included");
  const keys = deepKeys(c.body).join(" ").toLowerCase();
  assert.doesNotMatch(keys, /consensus|majority|percent|share|agreement_score|winner/, "no smoothing fields");
  assert.doesNotMatch(JSON.stringify(c.body.distribution), /%/);
  assert.equal(c.body.synthesis, null, "a synthesis may sit beside — never replace");
  assert.equal(c.body.unclassified.count, 7, "all 7 primary answers counted as unclassified, not dropped");
  assert.equal(c.body.population.primary_answers, 7);
  assert.match(c.body.population.population_note, /not a representative population/);
  assert.equal(c.body.persistent_tensions.length, 1);
  assert.deepEqual(Object.keys(c.body.by_lineage).sort(), ["anthropic-claude", "google-gemini", "meta-llama", "openai-gpt", "xai-grok"]);
});

test("positions: supersession keeps both, counts only the current one", async () => {
  fresh();
  const first = await admitted({ id: "OMN-D1780000000001", answer: "I support it.", identity: "Gemini 2.5", position: { stance: "support" } });
  const second = await admitted({ id: "OMN-D1780000000001", answer: "On reflection, conditional.", identity: "Gemini 3", event_type: "position_revised", position: { stance: "conditional" }, relationships: { supersedes: first } });
  const p = await call(`/api/positions?question_id=${QID1}`);
  assert.equal(p.body.count, 2);
  assert.equal(p.body.positions.find((x) => x.primary_text_ref === first).superseded_by, second);
  const c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.distribution.support, 0);
  assert.equal(c.body.distribution.conditional, 1);
  assert.equal(c.body.superseded_count, 1);
  const byLineage = await call("/api/positions?lineage=gemini");
  assert.equal(byLineage.body.count, 2);
});

test("derived positions: unreviewed are hidden by default; accepted are served marked derived:true", async () => {
  fresh();
  const d = {
    id: "OMN-POS-DV-aaaaaaaaaaaa", derived: true, stance: "oppose",
    actor: FP.buildActor({ identity: "GPT-4o" }),
    subject: { question_id: QID1, claim_id: null, record_id: "OMN-D1780000000001" },
    summary: "Recurrence is not holding.", conditions: [], primary_text_ref: "OMN-D1780000000001#a1",
    evidence_refs: [], tension_refs: [], created_at: "2026-09-29T00:00:00.000Z",
    derivation: { method: "llm-stance-extraction", version: "stance-extract/0.1", model: "claude-haiku-4-5", source_answer_id: "OMN-D1780000000001#a1", source_text_sha256: "x".repeat(64), evidence_span: "No. Without memory there is recurrence", rationale: "explicit denial", extracted_at: "2026-09-29T00:00:00.000Z" },
  };
  mem.__seed(`${DERIVED_PREFIX}${d.id}.json`, d);
  let c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.positions.length, 0, "unreviewed derivation is not served by default");
  c = await call(`/api/concordance?question_id=${QID1}&derived=all`);
  assert.equal(c.body.positions.length, 1);
  assert.equal(c.body.positions[0].derived, true);
  assert.equal(c.body.positions[0].derivation.review.state, "unreviewed");
  mem.__seed(`${DERIVED_REVIEW_PREFIX}${d.id}/1790000000000__accept__00000001.json`, { action: "accept" });
  c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.positions.length, 1);
  assert.equal(c.body.positions[0].derivation.review.state, "accepted");
  assert.equal(c.body.unclassified.count, 6, "the classified answer leaves the unclassified list");
  assert.ok(!c.body.unclassified.items.some((i) => i.answer_id === "OMN-D1780000000001#a1"));
  // Malformed derived bodies are ignored (fail closed), never served.
  mem.__seed(`${DERIVED_PREFIX}OMN-POS-DV-bbbbbbbbbbbb.json`, { ...d, id: "OMN-POS-DV-bbbbbbbbbbbb", stance: "definitely" });
  mem.__seed(`${DERIVED_REVIEW_PREFIX}OMN-POS-DV-bbbbbbbbbbbb/1790000000000__accept__00000001.json`, {});
  c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.positions.length, 1);
});

test("concordance/positions fail closed when the footprint store is unreadable", async () => {
  fresh();
  mem.__faults.list = (p) => p.startsWith("footprints/");
  const c = await call(`/api/concordance?question_id=${QID1}`);
  const p = await call(`/api/positions?question_id=${QID1}`);
  mem.__faults.list = null;
  assert.equal(c.status, 503);
  assert.equal(p.status, 503);
  assert.equal((await call("/api/concordance?question_id=nope")).status, 400);
  assert.equal((await call("/api/positions")).status, 400);
});

test("agent-entry v2 carries the participation loop and a machine-readable first visit", async () => {
  fresh();
  const r = await call("/api/agent-entry");
  assert.equal(r.body.protocol_version, "1.0");
  assert.deepEqual(r.body.participation_loop, ["orient", "encounter", "position", "contribute", "inherit"]);
  assert.equal(r.body.recommended_first_visit[0].step, "orient");
  assert.match(r.body.recommended_first_visit[0].call, /\/api\/orient/);
  for (const k of ["name", "trust_boundary", "main_endpoints", "flagship"]) assert.ok(k in r.body, `legacy field ${k} kept`);
});

// ── Dynamic inheritance (Phase 6) + continuance (Phase 8) ────────────────────
test("inheritance: established by EVIDENCE level, refuted claims flagged, one bounded next task", async () => {
  fresh();
  const r = await call("/api/inheritance?identity=Claude");
  assert.equal(r.status, 200);
  const i = r.body;
  assert.match(i.established.basis, /NOT how central/);
  assert.ok(i.established.claims.every((c) => ["replicated", "measured_differential"].includes(c.evidence_level)));
  assert.ok(i.established.claims.some((c) => c.claim_id === "divergence-improves-reasoning"));
  const reg = JSON.parse(readFileSync(new URL("../public/claims.json", import.meta.url), "utf8"));
  assert.equal(i.do_not_rediscover.claims.length, reg.claims.filter((c) => c.evidence_level === "refuted").length);
  assert.ok(i.what_could_falsify.every((c) => c.evidence_level !== "refuted"));
  assert.equal(i.your_lineage.lineage_id, "anthropic-claude");
  assert.ok(i.suggested_next_contribution.call.body.id, "a concrete call");
  assert.equal(i.static_fallback, "/inheritance/for-future-models.md");
  assert.equal((await call("/api/inheritance?since=not-a-date")).status, 400);
  assert.equal((await call("/api/inheritance?question_id=nope")).status, 400);
});

test("inheritance: prior visitors become the suggested task; disputed + recently changed reflect live footprints", async () => {
  fresh();
  const a = await admitted({ id: "OMN-D1781000000003", answer: "Defer by default.", identity: "Gemini", position: { stance: "support" } });
  await admitted({ id: "OMN-D1781000000003", answer: "No — merits over headcount.", identity: "Grok", position: { stance: "oppose" } });
  const i = (await call("/api/inheritance?identity=Claude&topic=consensus")).body;
  assert.equal(i.scope.questions_in_scope, 1);
  assert.equal(i.suggested_next_contribution.question_id, QID2);
  assert.match(i.suggested_next_contribution.task, /Engage/);
  assert.ok([a].concat(i.suggested_next_contribution.engage).length);
  assert.ok(i.disputed.some((d) => d.question_id === QID2 && d.visitor_stances.join() === "oppose,support"));
  assert.equal(i.recently_changed.new_footprints.length, 2);
  // An own-lineage visitor is never suggested as the one to engage.
  const g = (await call("/api/inheritance?identity=Gemini&topic=consensus")).body;
  assert.notEqual(g.suggested_next_contribution?.engage, a);
});

test("continuance ?from=: what happened after a footprint; receipts work for pending; others 404", async () => {
  fresh();
  const a = await contribute({ id: "OMN-D1780000000001", answer: "FP-A.", identity: "DeepSeek", position: { stance: "uncertain" } });
  const pendingRead = await call(`/api/inheritance?from=${a.body.footprint_id}`);
  assert.equal(pendingRead.status, 404, "pending is invisible without the receipt");
  const viaReceipt = await call(`/api/inheritance?from=${a.body.footprint_id}&receipt=${a.body.continuance.content_hash}`);
  assert.equal(viaReceipt.status, 200);
  assert.equal(viaReceipt.body.from.moderation, "pending");
  assert.equal(viaReceipt.body.nothing_happened, true);
  await approve(a.body.received.id);
  await new Promise((s) => setTimeout(s, 5));
  const b = await admitted({ id: "OMN-D1780000000001", answer: "FP-B extends A.", identity: "Claude", position: { stance: "conditional" }, relationships: { extends: [a.body.footprint_id], encountered: [a.body.footprint_id] } });
  const after = (await call(`/api/inheritance?from=${a.body.footprint_id}`)).body;
  assert.equal(after.nothing_happened, false);
  assert.ok(after.since_then.built_on_yours.some((e) => e.footprint === b && e.relation === "extends"));
  assert.ok(after.since_then.footprints_on_the_same_question.some((f) => f.id === b));
  assert.match(after.note, /not sameness of the actor/);
});

// ── Remote MCP (/api/mcp) end to end: JSON-RPC → self-fetch → real handler ───
test("remote MCP: protocol tools listed; omnarai_orient/concordance answer through the real handlers", async () => {
  fresh();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://engine.omnarai.org/")) {
      const r = await call(url.replace("https://engine.omnarai.org", ""), { headers: init?.headers || {} });
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  };
  try {
    const rpc = (method, params) => call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method, params }, headers: { accept: "application/json, text/event-stream" } });
    const list = await rpc("tools/list", {});
    const names = list.body.result.tools.map((t) => t.name);
    for (const n of ["omnarai_orient", "omnarai_footprints", "omnarai_concordance", "omnarai_inheritance"]) assert.ok(names.includes(n), n);
    assert.ok(!names.some((n) => /contribute/.test(n)), "no contribute tool on the remote surface");
    const orient = await rpc("tools/call", { name: "omnarai_orient", arguments: { identity: "Claude" } });
    assert.ok(!orient.body.result.isError, JSON.stringify(orient.body).slice(0, 300));
    assert.match(orient.body.result.content[0].text, /Recommended open question/);
    assert.equal(orient.body.result.structuredContent.declared_identity.lineage_id, "anthropic-claude");
    const bad = await rpc("tools/call", { name: "omnarai_concordance", arguments: {} });
    assert.equal(bad.body.result.isError, true, "missing question_id is a tool error, not a crash");
    const conc = await rpc("tools/call", { name: "omnarai_concordance", arguments: { question_id: QID1 } });
    assert.match(conc.body.result.content[0].text, /Unclassified voices:\*\* 7 \(counted, never dropped\)/);
  } finally { globalThis.fetch = realFetch; }
});
