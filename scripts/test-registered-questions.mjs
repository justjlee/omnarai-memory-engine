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
import { runItems, councilRunUsd, missingVoices, certifyArgs, certOutcome } from "./run-batch.mjs";
import { createTally, recordResponse, priceTally } from "./lib/usage-tally.mjs";

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
  // The batch counts are read from public/batches.json as shipped, so they follow its statuses rather than pin them.
  const shipped = JSON.parse(readFileSync(new URL("../public/batches.json", import.meta.url), "utf8")).batches.filter((b) => b.kind === "elicitation");
  for (const s of ["proposed", "approved", "run"]) assert.equal(q.elicitation[s], shipped.filter((b) => b.status === s).length, s);
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
test("[B5] the runner keeps the design: full panel or nothing; certification is ×3, written, reserved once, priced from usage", () => {
  const five = ["Claude", "GPT-4o", "Gemini", "Grok", "DeepSeek"].map((model) => ({ model, ok: true }));
  assert.deepEqual(missingVoices(R.FULL_PANEL, five), []);
  assert.deepEqual(missingVoices(R.FULL_PANEL, five.map((a) => (a.model === "Gemini" ? { ...a, ok: false } : a))), ["Gemini"], "a failed voice is a missing voice");
  assert.deepEqual(missingVoices(R.FULL_PANEL, five.filter((a) => a.model !== "Grok")), ["Grok"]);
  const args = certifyArgs("cert-001", "OMN-D1", "/tmp/r.json");
  assert.equal(args[args.indexOf("--runs") + 1], "3", "the ×3 strict-min battery, not the legacy single run");
  assert.ok(args.includes("--write"), "the certification reaches the live record");
  assert.equal(args[args.indexOf("--reserved-by") + 1], "batch cert-001", "reserved once, by the batch");
  assert.equal(args[args.indexOf("--report-out") + 1], "/tmp/r.json");
  assert.equal(args[args.indexOf("--ids") + 1], "OMN-D1");
  const report = { method: "tier3-perturbation-v3-consensus-x3", write: true, written: 1, certified: [{ id: "OMN-D1", tier: "C1" }], failed: [], usage: { usd: 1.234, unpriced: [], no_usage: 0 } };
  const good = certOutcome(report, "OMN-D1", 1.45);
  assert.equal(good.ok, true); assert.equal(good.usd, 1.234, "the measured price, not the estimate"); assert.equal(good.created, "OMN-D1"); assert.equal(good.tier, "C1");
  assert.match(good.usd_basis, /^provider-reported tokens/);
  const unwritten = certOutcome({ ...report, written: null }, "OMN-D1", 1.45);
  assert.equal(unwritten.ok, false); assert.equal(unwritten.created, null); assert.match(unwritten.error, /not written/);
  const dry = certOutcome({ ...report, write: false }, "OMN-D1", 1.45);
  assert.equal(dry.ok, false, "a dry run is not a certification");
  const failed = certOutcome({ ...report, certified: [], failed: [{ id: "OMN-D1", error: "boom" }] }, "OMN-D1", 1.45);
  assert.equal(failed.ok, false); assert.equal(failed.error, "boom");
  const none = certOutcome(null, "OMN-D1", 1.45);
  assert.equal(none.ok, false); assert.equal(none.usd, 1.45); assert.match(none.usd_basis, /^estimate/);
  assert.match(certOutcome({ ...report, usage: { usd: 1, unpriced: ["x-model"], no_usage: 2 } }, "OMN-D1", 1.45).usd_basis, /no price on file for x-model; 2 response\(s\) reported no usage/);
});
test("[B6] usage tally: provider-reported tokens per model, thinking billed as output, priced at list prices", () => {
  const t = createTally();
  recordResponse(t, "anthropic", "claude-sonnet-4-6", { usage: { input_tokens: 1000, output_tokens: 500 } });
  recordResponse(t, "gemini", "gemini-3.5-flash", { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 400 } });
  recordResponse(t, "openai", "gpt-5-mini", { usage: { prompt_tokens: 2000, completion_tokens: 1000 } });
  recordResponse(t, "embedding", "text-embedding-3-small", { usage: { prompt_tokens: 10000, total_tokens: 10000 } });
  recordResponse(t, "deepseek", "deepseek-chat", { choices: [] });
  recordResponse(t, "openai", "no-such-model", { usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const p = priceTally(t);
  assert.equal(t.by_model["gemini-3.5-flash"].out, 500, "Gemini's thoughts are output tokens");
  assert.equal(p.no_usage, 1); assert.equal(p.calls, 5);
  assert.deepEqual(p.unpriced, ["no-such-model"]);
  const expect = (1000 * 3 + 500 * 15 + 1000 * 1.5 + 500 * 9 + 2000 * 0.25 + 1000 * 2 + 10000 * 0.02) / 1e6;
  assert.equal(p.usd, +expect.toFixed(5));
});
test("[B4] a shipped batch can run only on its own logged approval, and never twice", () => {
  const doc = JSON.parse(readFileSync(new URL("../public/batches.json", import.meta.url), "utf8"));
  const log = readFileSync(new URL("../governance/decision-log.md", import.meta.url), "utf8");
  assert.ok(doc.batches.length >= 2);
  const approvals = doc.batches.map((b) => b.approved_in).filter(Boolean);
  assert.equal(new Set(approvals).size, approvals.length, "one decision-log entry per batch: approving one is not approving another");
  for (const b of doc.batches) {
    const p = R.batchProblems(b, { registry: REG, divRecords: RECORDS, decisionLog: log });
    if (b.status === "approved") {
      assert.ok(!p.some((x) => /approved|decision log/.test(x)), `${b.id}: ${p}`);
      assert.match(log, new RegExp(`^## ${b.approved_in} · .*\\b${b.id}\\b.*approved`, "m"), `${b.approved_in} is the entry that approves ${b.id}`);
    } else assert.ok(p.some((x) => /not "approved"/.test(x)), `${b.id} (${b.status}) must be refused`);
  }
  assert.ok(R.batchProblems({ ...doc.batches[0], status: "run" }, { registry: REG, divRecords: RECORDS, decisionLog: log }).some((x) => /not "approved"/.test(x)), "a batch that has run is refused: it cannot spend twice");
  assert.ok(R.batchProblems({ ...doc.batches[0], approved_in: "DL-9999" }, { registry: REG, divRecords: RECORDS, decisionLog: log }).some((x) => /not in the decision log/.test(x)));
});
