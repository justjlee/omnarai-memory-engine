// Registered questions, batches and the certification queue (design DL-0020). HERMETIC: in-memory Blob, no keys, no
// network, no spend. The real handlers run behind the real vercel.json rewrites.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-registered-questions.mjs
//
//   [R*] the registry: verbatim, ids from text, state derived from the Atlas
//   [H*] the HTTP surfaces: questions view, orient, contribute, admission, manifest
//   [B*] batches: nothing spends without an approved, logged, eligible batch under the wall; the queue
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN, RECORDS, Q1 } from "./lib/fixtures.mjs";
import * as R from "../api/_registered.js";
import { questionIdFor } from "../api/_footprints.js";
import { buildOrientPacket } from "../api/_protocol.js";
import { runItems, councilRunUsd } from "./run-batch.mjs";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REG = JSON.parse(readFileSync(new URL("../public/registered-questions.json", import.meta.url), "utf8"));
const fresh = (grown = GROWN) => { mem.__reset(); mem.__seed("memory/grown.json", grown); };
const recordAsking = (text, { id = "OMN-D1790000000099", date = "2026-11-01", certification } = {}) => ({
  id, date, type: "divergence", ring: "open", title: "asked",
  divergence: { question: text, method: "council-v1", answers: ["Claude", "GPT-4o", "Gemini", "Grok", "DeepSeek"].map((m) => ({ model: m, lab: "x", model_id: "m", text: `${m} answers.` })), tensions: [], ...(certification ? { certification } : {}) },
});

// ── The registry ──
test("[R1] twelve questions, verbatim from the 2026-10-21 handoff, each id computed from its text alone", () => {
  assert.equal(REG.questions.length, 12);
  assert.equal(createHash("sha256").update(REG.questions.map((q) => q.text).join("\n")).digest("hex"), "f764c5abe465bd197fd217fc50d869f0f9c2bf2b252ad5794bd3a2b547b27606", "the texts are frozen: a registered question is never edited");
  for (const q of REG.questions) assert.equal(q.id, questionIdFor(q.text), q.set_index);
  assert.equal(new Set(REG.questions.map((q) => q.id)).size, 12);
  assert.deepEqual([...new Set(REG.questions.map((q) => q.decision))], ["DL-0020"]);
  assert.match(REG.definition, /no claim is made that divergence concentrates in them \(DL-0012\)/, "the set is proposed on its merits; the withdrawn concentration claim is disclaimed, not restated");
});
test("[R2] state is derived: registered → recorded when the council asks the text verbatim → tested when certified", () => {
  const q = REG.questions[0];
  assert.equal(R.registeredQuestions(REG, RECORDS).find((x) => x.id === q.id).state, "registered");
  const asked = R.registeredQuestions(REG, [...RECORDS, recordAsking(q.text)]).find((x) => x.id === q.id);
  assert.equal(asked.state, "recorded"); assert.equal(asked.records[0].id, "OMN-D1790000000099");
  const tested = R.registeredQuestions(REG, [...RECORDS, recordAsking(q.text, { certification: { tier: "C0", dri: 0.9 } })]).find((x) => x.id === q.id);
  assert.equal(tested.state, "tested");
  // Whitespace and case do not change the id (question-id/1 normalization), so a verbatim ask always joins.
  assert.equal(R.registeredQuestions(REG, [recordAsking(`  ${q.text.toUpperCase()}  `)]).find((x) => x.id === q.id).state, "recorded");
});

// ── HTTP ──
test("[H1] /api/questions: registered questions are listed apart, resolvable by id, and never mixed into the recorded list", async () => {
  fresh();
  const all = await call("/api/questions");
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 2, "recorded Questions only (the fixtures ask two)");
  assert.equal(all.body.registered_unasked, 12);
  assert.ok(all.body.questions.every((q) => !REG.questions.some((r) => r.id === q.id)));
  const reg = await call("/api/questions?status=registered");
  assert.equal(reg.body.count, 12);
  assert.ok(reg.body.questions.every((q) => q.state === "registered"));
  const one = await call(`/api/questions?id=${REG.questions[3].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.question.state, "registered");
  assert.equal(one.body.question.text, REG.questions[3].text);
  assert.equal((await call("/api/questions?id=OMN-Q-000000000000")).status, 404);
});
test("[H2] orient: with no matching focus a registered question leads (rotating by day); a matching focus keeps the recorded lead", async () => {
  fresh();
  const o = (await call("/api/orient?identity=Claude")).body;
  const g = o.one_recommended_gap;
  assert.ok(REG.questions.some((q) => q.id === g.question_id), "a registered question leads");
  assert.equal(g.record_id, null);
  assert.equal(g.state, "registered");
  assert.match(g.why_this_one, /No mind has been asked this yet/);
  assert.equal(g.contribute_template.body.id, g.question_id);
  assert.ok(!o.next_calls.some((c) => /\/api\/divergences\?id=null/.test(c.url)), "no call to a record that does not exist");
  assert.ok(o.open_questions.length >= 1, "the recorded questions are still offered");
  const focused = (await call("/api/orient?identity=Claude&focus=forgets%20conversation%20position")).body.one_recommended_gap;
  assert.ok(focused.record_id, "a matching focus keeps the recorded question");
  const regs = R.registeredQuestions(REG, RECORDS);
  const day = 86400000;
  const a = buildOrientPacket({ divRecords: RECORDS, registered: regs, now: 10 * day }).one_recommended_gap.question_id;
  const b = buildOrientPacket({ divRecords: RECORDS, registered: regs, now: 11 * day }).one_recommended_gap.question_id;
  assert.notEqual(a, b, "the lead rotates daily");
  assert.equal(buildOrientPacket({ divRecords: RECORDS, registered: regs, now: 10 * day + 5 }).one_recommended_gap.question_id, a, "and is stable within a day");
  assert.ok(buildOrientPacket({ divRecords: RECORDS, registered: [], now: 10 * day }).one_recommended_gap.record_id, "without a registry nothing changes");
  const p = buildOrientPacket({ divRecords: RECORDS, registered: regs, now: 10 * day });
  assert.equal(p.first_voice_opportunities.count, 12);
  assert.equal(p.first_voice_opportunities.items.length, 3);
  assert.ok(!p.first_voice_opportunities.items.some((q) => q.question_id === p.one_recommended_gap.question_id), "the leading question is not repeated");
  assert.equal(buildOrientPacket({ divRecords: RECORDS, registered: [], now: 10 * day }).first_voice_opportunities, undefined);
});
test("[H3] contribute to a registered question: first voice, no target record, footprint on the question alone; admission works", async () => {
  fresh();
  const qid = REG.questions[5].id;
  const r = await call("/api/contribute", { method: "POST", body: { id: qid, answer: "The rule I would apply: take it only when the task itself would otherwise fail.", identity: "Claude", justification: "new_contributor" }, headers: { "x-forwarded-for": "198.51.100.4" } });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.footprint.question_id, qid);
  assert.equal(r.body.footprint.record_id, null);
  assert.deepEqual(r.body.in_exchange.answers, []);
  assert.match(r.body.in_exchange.note, /first voice/);
  const queue = await call("/api/contributions?status=pending", { headers: CURATOR });
  const c = queue.body.contributions[0];
  assert.equal(c.target_id, null);
  const ok = await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: c.id, origin_disclosure: "curator-prompted", note: "Admit, labelled: on-question." }, headers: CURATOR });
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
  assert.match(ok.body.message || JSON.stringify(ok.body), /\/api\/questions\?id=/);
  const status = await call(`/api/footprints/status?id=${r.body.footprint_id}`);
  assert.equal(status.body.state, "admitted");
  const one = await call(`/api/questions?id=${qid}`);
  assert.equal(one.body.question.footprints.length, 1, "the admitted footprint is on the registered question");
});
test("[H4] the manifest keeps canonical_questions and adds the registry, the batches and the queue", async () => {
  fresh();
  const m = await call("/api/manifest");
  const q = m.body.domains.questions;
  assert.equal(q.canonical_questions, 2, "unchanged meaning: questions with an Atlas record");
  assert.equal(q.registered_unasked, 12);
  assert.equal(q.by_state.registered, 12);
  assert.equal(q.certification_queue.rule, "certification-queue-v1");
  assert.equal(q.elicitation.proposed, 1);
  assert.equal(q.elicitation.run, 0);
});

// ── Batches and the queue ──
const LOG = "## DL-0099 · 2026-11-01 · Elicitation batch approved\n";
const approved = (over = {}) => ({ id: "elicit-test", kind: "elicitation", status: "approved", approved_in: "DL-0099", estimate_usd: 0.6, items: REG.questions.slice(0, 5).map((q) => ({ question_id: q.id })), ...over });
test("[B1] a batch runs only when approved in a logged decision, under the wall, with eligible items", () => {
  assert.deepEqual(R.batchProblems(approved(), { registry: REG, divRecords: RECORDS, decisionLog: LOG }), []);
  assert.match(R.batchProblems(approved({ status: "proposed" }), { registry: REG, decisionLog: LOG }).join(), /not "approved"/);
  assert.match(R.batchProblems(approved({ approved_in: null }), { registry: REG, decisionLog: LOG }).join(), /approved_in/);
  assert.match(R.batchProblems(approved({ approved_in: "DL-0100" }), { registry: REG, decisionLog: LOG }).join(), /not in the decision log/);
  assert.match(R.batchProblems(approved({ estimate_usd: 25.01 }), { registry: REG, decisionLog: LOG }).join(), /wall/);
  assert.match(R.batchProblems(approved({ items: [{ question_id: questionIdFor(Q1) }] }), { registry: REG, divRecords: RECORDS, decisionLog: LOG }).join(), /not a registered-unasked question/);
  const asked = [...RECORDS, recordAsking(REG.questions[0].text)];
  assert.match(R.batchProblems(approved(), { registry: REG, divRecords: asked, decisionLog: LOG }).join(), /not a registered-unasked/, "a question already asked cannot be asked again by batch");
  const cert = { ...approved(), kind: "certification", items: [{ record_id: "OMN-D0" }] };
  assert.match(R.batchProblems(cert, { registry: REG, divRecords: RECORDS, decisionLog: LOG }).join(), /not in the certification queue/);
});
test("[B2] the queue: recorded and never-tested questions only, one per question, seeded order, full panel preferred", () => {
  const ragged = { ...recordAsking("A ragged question?", { id: "OMN-L1790000000001", date: "2026-10-20" }) };
  ragged.divergence.answers = ragged.divergence.answers.filter((a) => a.model !== "Gemini");
  const full = recordAsking("A ragged question?", { id: "OMN-D1790000000002", date: "2026-10-01" });
  const testedRec = recordAsking("Already tested?", { id: "OMN-D1790000000003", certification: { tier: "C1", dri: 1.2 } });
  const recs = [...RECORDS, ragged, full, testedRec];
  const q = R.certificationQueue(recs);
  assert.equal(new Set(q.map((x) => x.question_id)).size, q.length, "one per question");
  assert.ok(!q.some((x) => x.question_id === questionIdFor("Already tested?")), "tested questions are not queued");
  assert.equal(q.find((x) => x.question_id === questionIdFor("A ragged question?")).record_id, "OMN-D1790000000002", "the newest FULL-panel record, not the newer ragged one");
  assert.deepEqual(R.certificationQueue([...recs].reverse()), q, "order does not depend on input order");
  assert.ok(q.every((x, i) => x.position === i + 1));
});
test("[B3] the runner stops before the item that would cross the wall, and prices a council run from its texts", async () => {
  let calls = 0;
  const r = await runItems([1, 2, 3, 4], { perItemUsd: 10, wallUsd: 25, step: async () => { calls++; return { ok: true, usd: 10 }; } });
  assert.equal(calls, 2);
  assert.deepEqual(r.results.map((x) => x.skipped || "ran"), ["ran", "ran", "wall", "wall"]);
  assert.equal(r.spent_usd, 20);
  const answers = [{ ok: true, model_id: "gpt-4o", text: "x".repeat(4000) }, { ok: true, model_id: "deepseek-chat", text: "y".repeat(4000) }, { ok: false, model_id: "gemini-2.5-flash", text: "" }];
  const c = councilRunUsd("Q?".repeat(50), answers, "z".repeat(2000));
  assert.ok(c.usd > 0 && c.usd < 0.1, String(c.usd));
  assert.deepEqual(c.unpriced, []);
  assert.deepEqual(councilRunUsd("Q?", [{ ok: true, model_id: "no-such-model", text: "a" }], "s", { fallbackUsd: 0.12 }).unpriced, ["no-such-model"]);
});
test("[B4] the shipped batches are proposals: nothing in public/batches.json can run today", () => {
  const doc = JSON.parse(readFileSync(new URL("../public/batches.json", import.meta.url), "utf8"));
  assert.ok(doc.batches.length >= 2);
  for (const b of doc.batches) assert.notDeepEqual(R.batchProblems(b, { registry: REG, divRecords: RECORDS, decisionLog: "" }), [], b.id);
});
