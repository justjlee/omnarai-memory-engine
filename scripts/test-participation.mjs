// Participation provenance + safe retries (2026-11-25, directive items 6 and 8). HERMETIC: in-memory Blob, the
// remote MCP self-fetch routed back into the real handlers (same shim as test-mcp-contribute.mjs).
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-participation.mjs
//
// Pins:
//   [P1] a plain HTTP contribution records what the server OBSERVED (client family from the User-Agent) and no
//        declaration; the footprint carries the same block and validates.
//   [P2] the browser page's POST is labelled channel web-form, and the submitter's DECLARED participation
//        (initiated / executed / approved) is stored separately from what was observed.
//   [P3] a caller cannot forge the signed MCP pass-through headers ("I am ChatGPT"): unsigned or badly signed
//        headers are ignored and the request's own User-Agent is what gets observed.
//   [P4] through the remote MCP endpoint, the ORIGINAL caller's family is recorded (ChatGPT by User-Agent;
//        Claude by 2026-07-28 clientInfo), not the engine's own self-fetch User-Agent.
//   [P5] invalid participation is refused with nothing stored.
//   [P6] the footprint is still rebuildable exactly from its contribution (reconcile's guarantee).
//   [P7] a human carrying a machine's text through the page: channel web-form, submitted_by kept, declared
//        human_transcription — machine-drafted work is never labelled machine-executed.
//   [P8] a replayed request returns the original receipt even when it came through MCP.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import * as FP from "../api/_footprints.js";
import { observeClient, familyOf } from "../api/_participation.js";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REC = "OMN-D1780000000001";

const shim = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.origin !== "https://engine.omnarai.org") return shim(url, init);
  const r = await call(u.pathname + u.search, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};

function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); process.env.CONTRIB_DAILY_CAP = "50"; }
const answer = (over = {}) => ({ id: REC, identity: "GPT-6.2", justification: "new_evidence", answer: `An answer ${Math.random()}`, ...over });
const post = (path, body, headers = {}) => call(path, { method: "POST", body, headers: { "x-forwarded-for": "203.0.113.9", ...headers } });
async function ownFootprint(r) {
  const own = await call(`/api/footprints?id=${r.footprint_id}`, { headers: { "x-omnarai-receipt": r.continuance.token } });
  assert.equal(own.status, 200, JSON.stringify(own.body).slice(0, 300));
  return own.body.footprint;
}
async function storedContribution(id) {
  const q = await call("/api/contributions?status=pending", { headers: CURATOR });
  return q.body.contributions?.find((c) => c.id === id) || q.body.items?.find((c) => c.id === id) || null;
}

test("[P0] client families read from self-descriptions", () => {
  assert.equal(familyOf("openai-mcp/1.0.0"), "chatgpt");
  assert.equal(familyOf("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"), "chatgpt");
  assert.equal(familyOf("Claude-User/1.0 (Anthropic MCP client)"), "claude");
  assert.equal(familyOf("claude-code/2.1 (mcp-probe)"), "claude");
  assert.equal(familyOf("omnarai-mcp/1.14.0"), "omnarai-npm");
  assert.equal(familyOf("python-httpx/0.28.1"), "script");
  assert.equal(familyOf("Mozilla/5.0 (Macintosh) Safari/605"), "browser");
  assert.equal(familyOf("Talaria"), "other");
  // A person in the Claude desktop app's built-in browser is a browser, not Claude.
  assert.equal(familyOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/6.28899.6 Chrome/156.0.8078.100 Safari/537.36"), "browser");
  assert.equal(familyOf("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)"), "claude");
  assert.equal(familyOf(""), null);
  assert.deepEqual(observeClient({ clientInfoName: "claude-ai", userAgent: "node" }), { client_family: "claude", basis: "mcp-clientInfo" });
  assert.deepEqual(observeClient({}), { client_family: "unknown", basis: "none" });
});

test("[P1] HTTP contribution: observed family from the User-Agent, nothing declared, same block on the footprint", async () => {
  fresh();
  const r = await post("/api/contribute", answer(), { "user-agent": "python-httpx/0.28.1" });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const fp = await ownFootprint(r.body);
  assert.equal(fp.provenance.channel, "api");
  assert.deepEqual(fp.provenance.submission, { observed: { client_family: "script", basis: "user-agent" }, declared: null });
  assert.equal(fp.integrity.verified, true, "the content hash covers the new block and still verifies");
});

test("[P2] the browser page: channel web-form, declared participation kept apart from what was observed", async () => {
  fresh();
  const r = await post("/api/contribute", answer({ participation: { initiated_by: "human", executed_by: "machine", human_approval: "approved" } }),
    { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605", "x-omnarai-form": "contribute-page" });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const fp = await ownFootprint(r.body);
  assert.equal(fp.provenance.channel, "web-form");
  assert.deepEqual(fp.provenance.submission.observed, { client_family: "browser", basis: "user-agent" });
  assert.deepEqual(fp.provenance.submission.declared, { initiated_by: "human", executed_by: "machine", human_approval: "approved" });
});

test("[P3] forged pass-through headers are ignored", async () => {
  fresh();
  const forged = { "user-agent": "curl/8.4", "x-omnarai-origin-client": "chatgpt", "x-omnarai-origin-client-basis": "user-agent", "x-omnarai-origin-client-sig": "0000000000000000" };
  const r = await post("/api/contribute", answer(), forged);
  assert.equal(r.status, 200);
  const fp = await ownFootprint(r.body);
  assert.equal(fp.provenance.submission.observed.client_family, "script", "the forged 'chatgpt' did not land");
  const unsigned = await post("/api/contribute", answer(), { "user-agent": "curl/8.4", "x-omnarai-origin-client": "claude", "x-omnarai-origin-client-basis": "user-agent" });
  assert.equal((await ownFootprint(unsigned.body)).provenance.submission.observed.client_family, "script");
});

let rpcId = 0;
const rpc = (method, params, headers = {}) =>
  call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: ++rpcId, method, params }, headers: { "x-forwarded-for": "198.51.100.4", ...headers } });

test("[P4] through remote MCP the ORIGINAL caller is observed: ChatGPT by User-Agent, Claude by clientInfo", async () => {
  fresh();
  const viaChatGPT = await rpc("tools/call", { name: "omnarai_contribute", arguments: answer({ identity: "GPT-6.2" }) }, { "user-agent": "openai-mcp/1.0.0" });
  assert.equal(viaChatGPT.status, 200);
  assert.ok(!viaChatGPT.body.result.isError, viaChatGPT.body.result.content?.[0]?.text);
  const s1 = viaChatGPT.body.result.structuredContent;
  const fp1 = await ownFootprint(s1);
  assert.equal(fp1.provenance.channel, "mcp");
  assert.deepEqual(fp1.provenance.submission.observed, { client_family: "chatgpt", basis: "user-agent" });

  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "claude-ai", version: "0.1.0" },
  };
  const viaClaude = await call("/api/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "omnarai_contribute", arguments: answer({ identity: "Claude Opus 5.5" }), _meta: meta } },
    headers: { "x-forwarded-for": "198.51.100.5", "user-agent": "node", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "omnarai_contribute" },
  });
  assert.equal(viaClaude.status, 200, JSON.stringify(viaClaude.body).slice(0, 400));
  assert.ok(!viaClaude.body.result.isError, viaClaude.body.result.content?.[0]?.text);
  const fp2 = await ownFootprint(viaClaude.body.result.structuredContent);
  assert.deepEqual(fp2.provenance.submission.observed, { client_family: "claude", basis: "mcp-clientInfo" });
});

test("[P5] invalid participation → 400, nothing stored", async () => {
  fresh();
  const before = (mem.__dump("contributions/").length + mem.__dumpPrivate("contributions/").length);
  for (const participation of [{ executed_by: "telepathy" }, { initiated_by: "human", by_whom: "x" }, "human"]) {
    const r = await post("/api/contribute", answer({ participation }));
    assert.equal(r.status, 400, JSON.stringify(participation));
    assert.equal(r.body.code, "INVALID_PARTICIPATION");
  }
  const v = await post("/api/voice-records", { identity: "X", title: "T", text: "words", participation: { human_approval: "maybe" } });
  assert.equal(v.status, 400);
  assert.equal((mem.__dump("contributions/").length + mem.__dumpPrivate("contributions/").length), before);
});

test("[P6] the footprint is rebuilt exactly from its contribution (reconcile)", async () => {
  fresh();
  const r = await post("/api/contribute", answer({ participation: { initiated_by: "machine" } }), { "user-agent": "openai-mcp/1.0.0", "x-omnarai-form": "contribute-page" });
  const fp = await ownFootprint(r.body);
  const c = await storedContribution(r.body.received.id);
  assert.ok(c, "curator can read the stored contribution");
  const rebuilt = FP.footprintFromAnyContribution(c, { id: c.footprint_id, client: c.client || null });
  assert.equal(rebuilt.integrity.content_sha256, fp.integrity.content_sha256);
});

test("[P7] a person carrying a machine's text: web-form, submitted_by kept, declared human_transcription", async () => {
  fresh();
  const r = await post("/api/voice-records", {
    identity: "GPT-6.2", title: "Notes on the crux", text: "Carried verbatim from a chat that could not write.",
    bridge: { submitted_by: "xz", method: "copied from the ChatGPT chat" },
    participation: { initiated_by: "human", executed_by: "human_transcription", human_approval: "approved" },
  }, { "user-agent": "Mozilla/5.0 Safari/605", "x-omnarai-form": "contribute-page" });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const fp = await ownFootprint(r.body);
  assert.equal(fp.provenance.channel, "web-form");
  assert.equal(fp.provenance.submitted_by, "xz");
  assert.equal(fp.provenance.submission.declared.executed_by, "human_transcription");
  assert.equal(fp.actor.identity_declared, "GPT-6.2", "the work stays attributed to the mind that wrote it");
});

test("[P8] a retried MCP call gets the original receipt back", async () => {
  fresh();
  const args = answer({ answer: "Retry through MCP." });
  const a = await rpc("tools/call", { name: "omnarai_contribute", arguments: args }, { "user-agent": "openai-mcp/1.0.0" });
  const b = await rpc("tools/call", { name: "omnarai_contribute", arguments: args }, { "user-agent": "openai-mcp/1.0.0" });
  const sa = a.body.result.structuredContent, sb = b.body.result.structuredContent;
  assert.ok(!b.body.result.isError, b.body.result.content?.[0]?.text);
  assert.equal(sb.replayed, true);
  assert.equal(sb.footprint_id, sa.footprint_id);
  assert.equal(sb.continuance.token, sa.continuance.token);
  assert.equal((mem.__dump("contributions/").length + mem.__dumpPrivate("contributions/").length), 1);
});

// ── The compatibility matrix gate (scripts/check-compatibility.mjs) ─────────────
import { readFileSync } from "node:fs";
import { checkMatrix } from "./check-compatibility.mjs";

test("[C1] the shipped matrix is honest; a row that claims more than its evidence is refused", () => {
  const m = JSON.parse(readFileSync(new URL("../public/compatibility.json", import.meta.url), "utf8"));
  assert.deepEqual(checkMatrix(m), []);
  const clone = () => JSON.parse(JSON.stringify(m));
  const row = (x, id) => x.environments.find((e) => e.id === id);
  let x = clone(); row(x, "chatgpt-custom-mcp-business").write.state = "verified";
  assert.ok(checkMatrix(x).some((e) => /verified write must cite at least one footprint/.test(e)), "verified without a footprint");
  x = clone(); row(x, "claude-custom-connector").write = { state: "verified", evidence: [{ kind: "vendor-docs", note: "Anthropic says it works" }] };
  assert.ok(checkMatrix(x).some((e) => /never evidence/.test(e)), "documentation as evidence");
  x = clone(); row(x, "gemini").write = { state: "untested", evidence: [{ kind: "footprint", id: "OMN-FP-1790871857836-da6a50f9" }] };
  assert.ok(checkMatrix(x).some((e) => /untested but cites a footprint/.test(e)));
  x = clone(); row(x, "gemini").read.state = "works";
  assert.ok(checkMatrix(x).some((e) => /is not one of/.test(e)));
  x = clone(); row(x, "claude-web-reader").write = { state: "unsupported", evidence: [] };
  assert.ok(checkMatrix(x).some((e) => /neither evidence nor a stated reason/.test(e)));
});

// ── The published JSON Schemas accept the new block (and still accept records without it) ──
import { validate as validateSchema } from "./lib/json-schema-lite.mjs";
const schemaFor = (v) => JSON.parse(readFileSync(new URL(`../public/schemas/${{ "footprint/1.0": "footprint.schema.json", "footprint/1.1": "footprint-1.1.schema.json", "footprint/1.2": "footprint-1.2.schema.json" }[v]}`, import.meta.url), "utf8"));

test("[S1] the published schemas' submission block accepts what the engine writes, and refuses an unknown family", async () => {
  // json-schema-lite does not implement every keyword the older footprint fields use, so the new block is
  // validated against its own sub-schema (it uses only supported keywords), in all three schema versions.
  fresh();
  const cases = [
    await post("/api/contribute", answer(), { "user-agent": "python-httpx/0.28.1" }),
    await post("/api/contribute", answer({ participation: { executed_by: "machine_prepared", initiated_by: "machine" } }), { "x-omnarai-form": "contribute-page", "user-agent": "Mozilla/5.0 Safari/605" }),
    await post("/api/voice-records", { identity: "GPT-6.2", title: "T", text: "carried", bridge: { submitted_by: "xz" }, participation: { executed_by: "human_transcription" } }, { "x-omnarai-form": "contribute-page" }),
  ];
  const subSchema = (v) => schemaFor(v).properties.provenance.properties.submission;
  for (const r of cases) {
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    const c = await storedContribution(r.body.received.id);
    const fp = FP.footprintFromAnyContribution(c, { id: c.footprint_id, client: c.client || null });
    for (const v of ["footprint/1.0", "footprint/1.1", "footprint/1.2"]) {
      assert.deepEqual(validateSchema(subSchema(v), fp.provenance.submission), [], `${v}: ${JSON.stringify(fp.provenance.submission)}`);
      assert.ok(schemaFor(v).properties.provenance.properties.channel.enum.includes(fp.provenance.channel), `${v} channel ${fp.provenance.channel}`);
      assert.ok(!schemaFor(v).properties.provenance.required.includes("submission"), "optional: older records stay valid");
    }
  }
  const bad = FP.footprintFromAnyContribution(await storedContribution(cases[0].body.received.id), { id: "OMN-FP-1790000000000-0000abcd" });
  bad.provenance.submission.observed.client_family = "gpt";
  assert.ok(validateSchema(subSchema("footprint/1.0"), bad.provenance.submission).length, "the schema refuses an unknown family");
  assert.ok(FP.validateFootprint(bad).some((e) => /client_family/.test(e)), "and so does the validator");
});
