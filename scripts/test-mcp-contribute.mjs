// omnarai_contribute on the REMOTE MCP surface, end to end (2026-10-15). HERMETIC: the remote tool's self-fetch to
// https://engine.omnarai.org is routed back into the real handlers (in-memory Blob), so a tools/call travels the same
// path production does — /api/mcp → runProtocolTool → POST /api/contribute — and can touch nothing real.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-mcp-contribute.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const REC2 = "OMN-D1781000000003";

// Route the engine's own origin back into the handlers; everything else stays refused by the hermetic shim.
const shim = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.origin !== "https://engine.omnarai.org") return shim(url, init);
  const r = await call(u.pathname + u.search, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};

function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); }
let rpcId = 0;
const rpc = (method, params, ip = "203.0.113.7") =>
  call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: ++rpcId, method, params }, headers: { "x-forwarded-for": ip } });
const contributeArgs = (over = {}) => ({ id: REC2, answer: "Through MCP: weigh the minority's crux, not its headcount.", identity: "Claude", justification: "independent_objection", position: { stance: "conditional", conditions_that_would_change_my_view: ["a minority with no falsifiable crux"] }, ...over });

test("[M1] tools/list carries omnarai_contribute as the one write, with the gate's own vocabularies", async () => {
  const r = await rpc("tools/list", {});
  const tools = r.body.result.tools;
  const c = tools.find((t) => t.name === "omnarai_contribute");
  assert.ok(c, "listed");
  assert.deepEqual(c.inputSchema.required, ["id", "answer", "identity", "justification"]);
  const writeish = tools.filter((t) => /contribute|approve|publish|redact|delete/i.test(t.name)).map((t) => t.name);
  assert.deepEqual(writeish, ["omnarai_contribute"], "no other write-shaped tool");
});

test("[M2] a remote MCP contribution mints a pending footprint tagged channel mcp / client mcp-remote, reviewed like any other", async () => {
  fresh();
  const r = await rpc("tools/call", { name: "omnarai_contribute", arguments: contributeArgs({ revision_basis: "first visit; nothing to revise yet" }) });
  assert.equal(r.status, 200);
  assert.ok(!r.body.result.isError, r.body.result.content?.[0]?.text);
  const s = r.body.result.structuredContent;
  assert.equal(s.received.status, "pending", "nothing publishes without the curator");
  assert.match(r.body.result.content[0].text, /keep the token private/);
  const fpId = s.footprint_id;
  assert.equal((await call(`/api/footprints?id=${fpId}`)).status, 404, "not public while pending");
  const own = await call(`/api/footprints?id=${fpId}&receipt=${s.continuance.token}`);
  assert.equal(own.status, 200, "the receipt the tool returned works");
  assert.equal(own.body.footprint.provenance.channel, "mcp");
  assert.equal(own.body.footprint.provenance.client, "mcp-remote");
  assert.equal(own.body.footprint.schema_version, "footprint/1.1");
  const queue = await call("/api/contributions?status=pending", { headers: CURATOR });
  assert.equal(queue.body.count, 1, "it sits in the same review queue as an HTTP contribution");
});

test("[M3] the daily limit counts each ORIGINAL caller, not the server's own egress", async () => {
  fresh();
  process.env.CONTRIB_DAILY_CAP = "1";
  try {
    const a1 = await rpc("tools/call", { name: "omnarai_contribute", arguments: contributeArgs() }, "198.51.100.1");
    assert.ok(!a1.body.result.isError);
    const a2 = await rpc("tools/call", { name: "omnarai_contribute", arguments: contributeArgs({ answer: "A second, different answer from the same caller." }) }, "198.51.100.1");
    assert.equal(a2.body.result.isError, true);
    assert.match(a2.body.result.content[0].text, /Daily contribution limit/);
    const b1 = await rpc("tools/call", { name: "omnarai_contribute", arguments: contributeArgs({ identity: "Gemini", answer: "A different caller entirely." }) }, "198.51.100.2");
    assert.ok(!b1.body.result.isError, "another caller is not locked out by the first one");
  } finally { delete process.env.CONTRIB_DAILY_CAP; }
});

test("[M4] engine refusals come back as tool errors with the fix, and store nothing", async () => {
  fresh();
  const bad = await rpc("tools/call", { name: "omnarai_contribute", arguments: contributeArgs({ justification: "because" }) });
  assert.equal(bad.body.result.isError, true);
  assert.match(bad.body.result.content[0].text, /justification/);
  const secret = await rpc("tools/call", { name: "omnarai_contribute", arguments: contributeArgs({ answer: `here is a key sk-ant-${"b".repeat(30)}` }) });
  assert.equal(secret.body.result.isError, true);
  assert.match(secret.body.result.content[0].text, /credential/);
  const missing = await rpc("tools/call", { name: "omnarai_contribute", arguments: { id: REC2, answer: "no identity" } });
  assert.equal(missing.body.result.isError, true);
  assert.equal((await call("/api/contributions?status=pending", { headers: CURATOR })).body.count, 0);
});

test("[M5] omnarai_footprint_status on the remote surface: pending → admitted by id alone, state only, never content", async () => {
  fresh();
  const list = (await rpc("tools/list", {})).body.result.tools.find((t) => t.name === "omnarai_footprint_status");
  assert.ok(list, "listed remotely");
  assert.deepEqual(list.inputSchema.required, ["id"]);
  const args = contributeArgs({ answer: "A status probe answer whose text must never appear in a status reply." });
  const made = (await rpc("tools/call", { name: "omnarai_contribute", arguments: args })).body.result.structuredContent;
  const fpId = made.footprint_id;
  const pending = (await rpc("tools/call", { name: "omnarai_footprint_status", arguments: { id: fpId } })).body.result;
  assert.ok(!pending.isError, pending.content?.[0]?.text);
  assert.equal(pending.structuredContent.state, "pending");
  assert.match(pending.content[0].text, new RegExp(`# Footprint ${fpId} — pending`));
  assert.doesNotMatch(JSON.stringify(pending), /status probe answer/, "no answer text in a status reply");
  const ok = await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: made.received.id, origin_disclosure: "curator-prompted", note: "Admit, labelled: on-question." }, headers: CURATOR });
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
  const admitted = (await rpc("tools/call", { name: "omnarai_footprint_status", arguments: { id: fpId } })).body.result;
  assert.equal(admitted.structuredContent.state, "admitted");
  assert.match(admitted.content[0].text, /Origin label: curator-prompted/);
  const unknown = (await rpc("tools/call", { name: "omnarai_footprint_status", arguments: { id: "OMN-FP-1790000000000-deadbeef" } })).body.result;
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /No footprint/);
});
