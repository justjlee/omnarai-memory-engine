// Hermetic tests for the council's per-provider requests and the longitudinal
// frontier track (no keys, no network, no spend).
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-council-requests.mjs
//
// What we pin:
//  - a standing-council (control) member's request is byte-identical to the one it
//    sent before tracks existed: the control track's comparability depends on it
//  - frontier members carry their own settings, and none sends sampling params,
//    a thinking budget or a refusal fallback
//  - replies: text blocks only (a thinking model's content[0] is its reasoning),
//    the provider-reported model, truncation and refusal
//  - records keep model_resolved / truncated and never ms / usage
//  - the cron: frontier is off unless FRONTIER_TRACK=on; idempotency is per track;
//    the /home missed-day watch counts the control track only
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { COUNCIL, FRONTIER_COUNCIL, memberRequest, parseMemberReply, buildDivergenceRecord, elicitCouncil } from "../api/_council.js";
import { requestedTrack, trackOf, findEpochRecord, epochCoverage, frontierEnabled } from "../api/_longitudinal.js";
import { estimatedCostUsd } from "../api/_budget.js";
import { CANON } from "../api/_canon.js";

const Q = "Is a perfectly controllable AI safe, dangerous, or both?";
const byProvider = (panel, p) => panel.find((m) => m.provider === p);

// The request bodies exactly as the pre-track callers built them (2026-06 → 2026-10).
function legacyBody(member, system) {
  if (member.provider === "anthropic") {
    return { model: member.model_id, max_tokens: 700, system, messages: [{ role: "user", content: Q }] };
  }
  if (member.provider === "gemini") {
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: Q }] }],
      generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
    };
  }
  return { model: member.model_id, max_tokens: 700, messages: [{ role: "system", content: system }, { role: "user", content: Q }] };
}

test("control members send byte-identical requests to the pre-track callers", () => {
  const system = memberRequest(COUNCIL[0], Q).system;
  assert.match(system, /^You are one voice in a panel of frontier models/);
  for (const m of COUNCIL) {
    assert.equal(JSON.stringify(memberRequest(m, Q)), JSON.stringify(legacyBody(m, system)), m.model_id);
  }
});

test("control panel ids are unchanged", () => {
  assert.deepEqual(COUNCIL.map((m) => m.model_id), ["claude-sonnet-4-6", "gpt-4o", "gemini-2.5-flash", "grok-4.3", "deepseek-chat"]);
});

test("frontier panel: one member per lab, same labs as control, no aliases", () => {
  assert.deepEqual(FRONTIER_COUNCIL.map((m) => m.lab).sort(), COUNCIL.map((m) => m.lab).sort());
  for (const m of FRONTIER_COUNCIL) {
    assert.ok(!COUNCIL.some((c) => c.model_id === m.model_id), `${m.model_id} must differ from the control id`);
    assert.doesNotMatch(m.model_id, /latest|deepseek-chat/, `${m.model_id} looks like an alias`);
  }
});

test("frontier requests carry their settings and no sampling / thinking budget / fallback", () => {
  const a = memberRequest(byProvider(FRONTIER_COUNCIL, "anthropic"), Q);
  assert.equal(a.model, "claude-opus-5-5");
  assert.equal(a.max_tokens, 4000);
  assert.deepEqual(a.output_config, { effort: "medium" });
  const o = memberRequest(byProvider(FRONTIER_COUNCIL, "openai"), Q);
  assert.ok(o.max_completion_tokens > 0 && !("max_tokens" in o), "OpenAI reasoning models take max_completion_tokens");
  const g = memberRequest(byProvider(FRONTIER_COUNCIL, "gemini"), Q);
  assert.ok(!g.generationConfig.thinkingConfig, "Gemini 3+ rejects thinkingBudget");
  for (const m of FRONTIER_COUNCIL) {
    const body = memberRequest(m, Q);
    for (const k of ["temperature", "top_p", "top_k", "thinking", "fallbacks", "betas"]) assert.ok(!(k in body), `${m.model_id} sends ${k}`);
    const text = JSON.stringify(body);
    assert.ok(text.includes(Q), `${m.model_id} carries the verbatim question`);
  }
});

test("Anthropic reply: text blocks only, provider-reported model, usage", () => {
  const m = byProvider(FRONTIER_COUNCIL, "anthropic");
  const r = parseMemberReply(m, {
    model: "claude-opus-5-5", stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Both, " }, { type: "text", text: "for different people." }],
    usage: { input_tokens: 120, output_tokens: 900 },
  });
  assert.deepEqual(r, { text: "Both, for different people.", resolved: "claude-opus-5-5", truncated: false, usage: { input: 120, output: 900 } });
});

test("Anthropic reply: refusal throws (the voice is dropped, never substituted)", () => {
  const m = byProvider(FRONTIER_COUNCIL, "anthropic");
  assert.throws(() => parseMemberReply(m, { stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }), /refusal \(cyber\)/);
});

test("truncation is flagged for every provider", () => {
  assert.equal(parseMemberReply(COUNCIL[0], { stop_reason: "max_tokens", content: [{ type: "text", text: "cut" }] }).truncated, true);
  assert.equal(parseMemberReply(byProvider(COUNCIL, "gemini"), { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "cut" }] } }] }).truncated, true);
  assert.equal(parseMemberReply(byProvider(COUNCIL, "openai"), { choices: [{ finish_reason: "length", message: { content: "cut" } }] }).truncated, true);
});

test("OpenAI-compatible and Gemini replies report the model the provider ran", () => {
  const o = parseMemberReply(byProvider(COUNCIL, "openai"), {
    model: "gpt-4o-2024-08-06", choices: [{ finish_reason: "stop", message: { content: "x" } }], usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  assert.deepEqual(o, { text: "x", resolved: "gpt-4o-2024-08-06", truncated: false, usage: { input: 10, output: 20 } });
  const g = parseMemberReply(byProvider(COUNCIL, "gemini"), {
    modelVersion: "gemini-2.5-flash", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "a" }, { text: "b" }] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 5 },
  });
  assert.deepEqual(g, { text: "ab", resolved: "gemini-2.5-flash", truncated: false, usage: { input: 3, output: 9 } });
});

test("records keep model_resolved / truncated, never ms / usage", () => {
  const answers = [
    { model: "Claude", lab: "Anthropic", model_id: "claude-opus-5-5", model_resolved: "claude-opus-5-5", truncated: true, date: "2026-11-01", text: "a", ok: true, ms: 9000, usage: { input: 1, output: 2 } },
    { model: "GPT", lab: "OpenAI", model_id: "gpt-6.1-sol", date: "2026-11-01", text: "b", ok: true, ms: 8000, usage: null },
  ];
  const rec = buildDivergenceRecord(Q, answers, { narrative: "", tensions: [], deliberation_card: null });
  assert.deepEqual(rec.provenance.answers[0], { model: "Claude", lab: "Anthropic", model_id: "claude-opus-5-5", model_resolved: "claude-opus-5-5", truncated: true, date: "2026-11-01", text: "a" });
  assert.deepEqual(rec.provenance.answers[1], { model: "GPT", lab: "OpenAI", model_id: "gpt-6.1-sol", date: "2026-11-01", text: "b" });
});

test("with no keys, the frontier panel asks nobody", async () => {
  assert.deepEqual(await elicitCouncil(Q, { panel: FRONTIER_COUNCIL }), []);
});

test("frontier run is costed above the control run", () => {
  assert.equal(estimatedCostUsd("cron"), 0.12);
  assert.equal(estimatedCostUsd("cron_frontier"), 0.35);
});

// ── tracks ───────────────────────────────────────────────────────────────────
const EPOCH = new Date().toISOString().slice(0, 7);
const lonRec = (id, canon_id, track) => ({
  id, type: "divergence", date: `${EPOCH}-01`, title: "t", ring: "open", contributors: ["Claude"], excerpt: Q,
  divergence: { question: Q, answers: [], tensions: [], longitudinal: { canon_id, epoch: EPOCH, ...(track ? { track } : {}) } },
});

test("track parsing: absent = control, unknown refused, legacy records are control", () => {
  assert.equal(requestedTrack({}), "control");
  assert.equal(requestedTrack({ track: "frontier" }), "frontier");
  assert.equal(requestedTrack({ track: "bogus" }), null);
  assert.equal(trackOf({ canon_id: "LC-01", epoch: EPOCH }), "control");
  assert.equal(frontierEnabled({}), false);
  assert.equal(frontierEnabled({ FRONTIER_TRACK: "on" }), true);
  assert.equal(frontierEnabled({ FRONTIER_TRACK: "true" }), false, "only the exact word turns it on");
});

test("idempotency and missed-day coverage are per track", () => {
  const entries = [lonRec("OMN-L1", CANON[0].canon_id), lonRec("OMN-L2", CANON[1].canon_id, "frontier")];
  assert.equal(findEpochRecord(entries, { canon_id: CANON[0].canon_id, epoch: EPOCH, track: "control" })?.id, "OMN-L1");
  assert.equal(findEpochRecord(entries, { canon_id: CANON[0].canon_id, epoch: EPOCH, track: "frontier" }), null);
  assert.equal(findEpochRecord(entries, { canon_id: CANON[1].canon_id, epoch: EPOCH, track: "control" }), null, "a frontier record is not the control run");
  assert.deepEqual([...epochCoverage(entries, EPOCH, "control").done], [CANON[0].canon_id]);
  assert.deepEqual([...epochCoverage(entries, EPOCH, "frontier").done], [CANON[1].canon_id]);
});

// ── the cron handler, end to end through vercel.json ─────────────────────────
process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
function seed(entries) {
  mem.__reset();
  mem.__seed("memory/grown.json", { version: 1, updatedAt: "2026-09-01T00:00:00.000Z", entries, vectors: {} });
}
const spendMarkers = () => mem.__dump("budget/spend/").length;

test("frontier cron is off by default: nothing asked, nothing spent", async () => {
  delete process.env.FRONTIER_TRACK;
  seed([]);
  const r = await call("/api/cron-longitudinal-frontier?index=0", { headers: CURATOR });
  assert.equal(r.status, 200);
  assert.equal(r.body.disabled, true);
  assert.equal(r.body.track, "frontier");
  assert.equal(spendMarkers(), 0);
});

test("unknown track is refused; no auth is refused", async () => {
  seed([]);
  assert.equal((await call("/api/cron-longitudinal?track=bogus&index=0", { headers: CURATOR })).status, 400);
  assert.equal((await call("/api/cron-longitudinal-frontier?index=0")).status, 401);
});

test("frontier on: skips its own existing record, ignores the control one", async () => {
  process.env.FRONTIER_TRACK = "on";
  try {
    seed([lonRec("OMN-L1", CANON[0].canon_id, "frontier")]);
    const skip = await call("/api/cron-longitudinal-frontier?index=0", { headers: CURATOR });
    assert.equal(skip.status, 200);
    assert.equal(skip.body.skipped, true);
    assert.equal(skip.body.existing, "OMN-L1");

    seed([lonRec("OMN-L2", CANON[0].canon_id)]); // control only
    const run = await call("/api/cron-longitudinal-frontier?index=0", { headers: CURATOR });
    assert.equal(run.status, 502, "not skipped: it tried to assemble the frontier panel (no keys here)");
    assert.equal(run.body.track, "frontier");
    assert.equal(spendMarkers(), 0, "a failed run is never billed");
  } finally {
    delete process.env.FRONTIER_TRACK;
  }
});

test("control cron is unchanged and ignores frontier records", async () => {
  seed([lonRec("OMN-L3", CANON[0].canon_id)]);
  const skip = await call("/api/cron-longitudinal?index=0", { headers: CURATOR });
  assert.equal(skip.body.skipped, true);
  assert.equal(skip.body.track, "control");

  seed([lonRec("OMN-L4", CANON[0].canon_id, "frontier")]);
  const run = await call("/api/cron-longitudinal?index=0", { headers: CURATOR });
  assert.equal(run.status, 502, "a frontier record does not satisfy the control run");
});
