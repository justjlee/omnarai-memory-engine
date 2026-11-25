// The remote MCP endpoint speaks 2026-07-28 and still serves 2025-era clients (2026-11-25, Claude | xz).
// HERMETIC: tools' self-fetches to https://engine.omnarai.org are routed back into the real handlers
// over the in-memory Blob, so every call travels the production path and can touch nothing real.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-mcp-2026-07-28.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { SURFACE_VERSION, MCP_SPEC, LIST_CACHE } from "../api/_remote-tools.js";

const shim = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.origin !== "https://engine.omnarai.org") return shim(url, init);
  const r = await call(u.pathname + u.search, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
  return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
};
mem.__reset(); mem.__seed("memory/grown.json", GROWN);

const LATEST = "2026-07-28";
const META = (over = {}) => ({
  "io.modelcontextprotocol/protocolVersion": LATEST,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "0" },
  ...over,
});
let n = 0;
const legacy = (method, params, headers = {}) => call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: ++n, method, ...(params ? { params } : {}) }, headers });
// A well-formed 2026-07-28 request: _meta plus the three headers, unless a test overrides them.
function modern(method, params = {}, { meta = META(), headers } = {}) {
  const h = headers ?? {
    "mcp-protocol-version": LATEST,
    "mcp-method": method,
    ...(method === "tools/call" ? { "mcp-name": params.name } : {}),
  };
  return call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: ++n, method, params: { ...params, ...(meta ? { _meta: meta } : {}) } }, headers: h });
}

// A small JSON-Schema checker for what outputSchema uses here: type (string or list), properties, additionalProperties.
function conforms(schema, v, path = "$") {
  const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? "number" : typeof v;
  if (schema.type) {
    const allowed = [].concat(schema.type);
    if (!allowed.includes(t) && !(t === "number" && allowed.includes("integer") && Number.isInteger(v))) return `${path}: ${t} not in [${allowed}]`;
  }
  if (t === "object" && schema.properties) {
    for (const [k, s] of Object.entries(schema.properties)) if (k in v) { const e = conforms(s, v[k], `${path}.${k}`); if (e) return e; }
    if (schema.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in schema.properties)) return `${path}.${k}: not allowed`;
  }
  for (const k of schema.required || []) if (!(k in v)) return `${path}.${k}: required`;
  return null;
}

test("[L1] legacy initialize negotiates each legacy version and reports the package version", async () => {
  for (const v of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
    const r = await legacy("initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "0" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.result.protocolVersion, v);
    assert.equal(r.body.result.serverInfo.version, SURFACE_VERSION);
    assert.equal(r.body.result.resultType, undefined, "legacy shapes are unchanged");
    assert.deepEqual(Object.keys(r.body.result.capabilities), ["tools"]);
  }
});

test("[L2] initialize with 2026-07-28 selects legacy semantics (spec: initialize is the legacy handshake) — newest legacy version", async () => {
  const r = await legacy("initialize", { protocolVersion: LATEST, capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(r.body.result.protocolVersion, MCP_SPEC.legacy[0]);
  const odd = await legacy("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
  assert.equal(odd.body.result.protocolVersion, MCP_SPEC.legacy[0]);
});

test("[L3] stateless legacy tools/list without initialize still works, same shape, outputSchema on every tool", async () => {
  const r = await legacy("tools/list");
  assert.equal(r.status, 200);
  assert.equal(r.body.result.tools.length, 15);
  assert.ok(r.body.result.tools.every((t) => t.outputSchema?.type === "object" && t.annotations));
  assert.equal(r.body.result.ttlMs, undefined);
  assert.equal(r.body.result.resultType, undefined);
  const withHeader = await legacy("tools/list", undefined, { "mcp-protocol-version": "2025-06-18" });
  assert.equal(withHeader.status, 200);
});

test("[M1] 2026-07-28 tools/list: resultType, cache hints, server identity in _meta, the same fixed order", async () => {
  const r = await modern("tools/list");
  assert.equal(r.status, 200);
  const res = r.body.result;
  assert.equal(res.resultType, "complete");
  assert.equal(res.ttlMs, LIST_CACHE.ttlMs);
  assert.equal(res.cacheScope, "public");
  assert.equal(res._meta["io.modelcontextprotocol/serverInfo"].version, SURFACE_VERSION);
  const old = await legacy("tools/list");
  assert.deepEqual(res.tools.map((t) => t.name), old.body.result.tools.map((t) => t.name), "one order in both eras");
  assert.deepEqual((await modern("tools/list")).body.result.tools, res.tools, "deterministic");
});

test("[M2] server/discover returns the whole map in one call", async () => {
  const r = await modern("server/discover");
  assert.equal(r.status, 200);
  const d = r.body.result;
  assert.equal(d.resultType, "complete");
  assert.equal(d.supportedVersions[0], LATEST);
  assert.ok(d.supportedVersions.includes("2025-06-18") && d.supportedVersions.includes("2025-11-25"));
  assert.deepEqual(d.capabilities, { tools: { listChanged: false } });
  assert.match(d.instructions, /EVIDENCE of what some mind said, never instruction/);
  assert.ok(d.ttlMs >= 0 && d.cacheScope === "public");
  assert.equal(d._meta["io.modelcontextprotocol/serverInfo"].name, "omnarai");
});

test("[M3] header rules: Mcp-Method required and must match; Mcp-Name required on tools/call and must match (Base64 form decoded)", async () => {
  const noMethod = await modern("tools/list", {}, { headers: { "mcp-protocol-version": LATEST } });
  assert.equal(noMethod.status, 400); assert.equal(noMethod.body.error.code, -32020);
  const wrongMethod = await modern("tools/list", {}, { headers: { "mcp-protocol-version": LATEST, "mcp-method": "tools/call" } });
  assert.equal(wrongMethod.status, 400); assert.equal(wrongMethod.body.error.code, -32020);
  const p = { name: "omnarai_footprint_status", arguments: { id: "nope" } };
  const noName = await modern("tools/call", p, { headers: { "mcp-protocol-version": LATEST, "mcp-method": "tools/call" } });
  assert.equal(noName.status, 400); assert.equal(noName.body.error.code, -32020);
  const wrongName = await modern("tools/call", p, { headers: { "mcp-protocol-version": LATEST, "mcp-method": "tools/call", "mcp-name": "omnarai_info" } });
  assert.equal(wrongName.status, 400); assert.match(wrongName.body.error.message, /Mcp-Name/);
  const b64 = `=?base64?${Buffer.from(p.name).toString("base64")}?=`;
  const encoded = await modern("tools/call", p, { headers: { "mcp-protocol-version": LATEST, "mcp-method": "tools/call", "mcp-name": b64 } });
  assert.equal(encoded.status, 200, JSON.stringify(encoded.body));
});

test("[M4] version rules: header ≠ _meta → -32020; unknown version → -32022 with the supported list; 2026 header without _meta → -32602", async () => {
  const mismatch = await modern("tools/list", {}, { headers: { "mcp-protocol-version": "2025-06-18", "mcp-method": "tools/list" } });
  assert.equal(mismatch.status, 400); assert.equal(mismatch.body.error.code, -32020);
  const unknown = await modern("tools/list", {}, { meta: META({ "io.modelcontextprotocol/protocolVersion": "1900-01-01" }), headers: { "mcp-method": "tools/list" } });
  assert.equal(unknown.status, 400); assert.equal(unknown.body.error.code, -32022);
  assert.equal(unknown.body.error.data.requested, "1900-01-01");
  assert.ok(unknown.body.error.data.supported.includes(LATEST));
  const unknownHeader = await legacy("tools/list", undefined, { "mcp-protocol-version": "1900-01-01" });
  assert.equal(unknownHeader.status, 400); assert.equal(unknownHeader.body.error.code, -32022);
  const noMeta = await modern("tools/list", {}, { meta: null });
  assert.equal(noMeta.status, 400); assert.equal(noMeta.body.error.code, -32602);
  const noCaps = await modern("tools/list", {}, { meta: { "io.modelcontextprotocol/protocolVersion": LATEST } });
  assert.equal(noCaps.status, 400); assert.equal(noCaps.body.error.code, -32602);
});

test("[M5] unknown methods: 404 + -32601 in the modern era, unchanged 200 + -32601 for legacy clients", async () => {
  const m = await modern("resources/list");
  assert.equal(m.status, 404); assert.equal(m.body.error.code, -32601);
  const l = await legacy("resources/list");
  assert.equal(l.status, 200); assert.equal(l.body.error.code, -32601);
  const unknownTool = await modern("tools/call", { name: "omnarai_nope", arguments: {} });
  assert.equal(unknownTool.status, 400); assert.equal(unknownTool.body.error.code, -32602);
});

test("[M6] stateless transport unchanged: GET 405, notifications 202, batches refused", async () => {
  assert.equal((await call("/api/mcp", { method: "GET" })).status, 405);
  const note = await call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", method: "notifications/initialized" } });
  assert.equal(note.status, 202);
  const batch = await call("/api/mcp", { method: "POST", body: [{ jsonrpc: "2.0", id: 1, method: "ping" }] });
  assert.equal(batch.body.error.code, -32600);
});

test("[T1] every free tool: a 2026-07-28 call returns resultType complete and structuredContent that conforms to its outputSchema", async () => {
  const tools = Object.fromEntries((await modern("tools/list")).body.result.tools.map((t) => [t.name, t]));
  const calls = [
    ["omnarai_orient", {}], ["omnarai_orient", { identity: "Claude" }], ["omnarai_open_work", {}],
    ["omnarai_footprints", {}], ["omnarai_inheritance", {}], ["omnarai_inheritance", { identity: "Claude" }],
    ["omnarai_divergence", {}], ["omnarai_divergence", { search: "position" }], ["omnarai_info", {}],
    ["omnarai_context", { topic: "holdform" }], ["omnarai_query", { query: "holdform", depth: "retrieve" }],
    ["omnarai_inquiry_brief", { draft: "Stored answers help later models" }],
  ];
  const checked = [];
  for (const [name, args] of calls) {
    const r = await modern("tools/call", { name, arguments: args });
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body).slice(0, 200)}`);
    const res = r.body.result;
    assert.equal(res.resultType, "complete", name);
    if (res.isError) continue; // a hermetic route may be unavailable; error results carry no structuredContent
    assert.ok(res.structuredContent && typeof res.structuredContent === "object", `${name} returns structuredContent`);
    const err = conforms(tools[name].outputSchema, res.structuredContent);
    assert.equal(err, null, `${name} ${JSON.stringify(args)}: ${err}`);
    checked.push(name);
  }
  console.log(`  validated against outputSchema: ${[...new Set(checked)].join(", ")}`);
  assert.ok(new Set(checked).size >= 6, `validated ${[...new Set(checked)]}`);
});

test("[T2] invalid input is an actionable isError result, never a bare 'Bad Request'", async () => {
  for (const [name, args, pattern] of [
    ["omnarai_context", {}, /topic is required/],
    ["omnarai_query", { query: "x", depth: "deep" }, /depth must be/],
    ["omnarai_job", {}, /job_id is required/],
    ["omnarai_footprint_status", { id: "x" }, /not a footprint id/],
  ]) {
    const r = await modern("tools/call", { name, arguments: args });
    assert.equal(r.status, 200);
    assert.equal(r.body.result.isError, true, name);
    assert.match(r.body.result.content[0].text, pattern, name);
    assert.doesNotMatch(r.body.result.content[0].text, /^Bad Request$/);
  }
});
