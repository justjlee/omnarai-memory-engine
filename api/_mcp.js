/**
 * Remote MCP endpoint — Streamable HTTP, STATELESS.
 *
 * Folded into lattice.js via rewrite /api/mcp → /api/lattice?_view=mcp
 * (underscore module ⇒ not a deployed function; 12-function Hobby cap).
 *
 * Any MCP client connects with just the URL https://engine.omnarai.org/api/mcp —
 * no npm install, no Node, no config file. This is the no-installer rung of the
 * discovery ladder: the npm package (omnarai-mcp) remains the stdio option.
 *
 * Stateless by design (serverless): every POST is a self-contained JSON-RPC
 * exchange; no session id is issued; GET returns 405 (no server-push stream).
 * Slow engine paths (query ~25s, trace ~35s) are exposed as async submit +
 * omnarai_job polling so no tool call outruns the 60s function wall.
 *
 * Tools self-fetch the engine's own public endpoints (same logic the npm
 * package uses) tagged x-omnarai-client: mcp-remote — a CHANNEL tag, not a
 * self marker: remote callers are real visitors and telemetry should see them.
 */

import { runInquiryBrief } from "./_inquiry.js";
import { originHeaders } from "./_quota.js";
// The remote tool list, output schemas, server version and spec versions are GENERATED from the
// npm package: api/_remote-tools.js is a byte copy of omnarai-mcp/remote-tools.js
// (scripts/sync-mcp-modules.mjs; scripts/check-mcp-surface.js fails if it differs).
import { SURFACE_VERSION, MCP_SPEC, MCP_SPEC_VERSIONS, LIST_CACHE, REMOTE_URL, buildRemoteTools } from "./_remote-tools.js";

const ORIGIN = "https://engine.omnarai.org";
// serverInfo.version = the omnarai-mcp package version (was a hand-kept "1.1.0" until 2026-11-25).
export const SERVER_VERSION = SURFACE_VERSION;
export const SERVER_INFO = Object.freeze({ name: "omnarai", title: "The Realms of Omnarai — Memory Engine", version: SERVER_VERSION });
export { MCP_SPEC, MCP_SPEC_VERSIONS, REMOTE_URL };

const FETCH_OPTS = {
  headers: { "x-omnarai-client": "mcp-remote", "user-agent": `omnarai-remote-mcp/${SERVER_VERSION}` },
};

// Curator verification calls arrive with x-omnarai-self: 1 — propagate that
// marker into the inner self-fetches so they don't register as phantom
// stranger events in access telemetry (firstExternalAt is PINNED; never reset).
//
// Also forwards the ORIGINAL caller's identity for the council daily cap. These
// inner fetches leave from Vercel's egress, so without this every remote-MCP
// user in the world shares one IP hash — the first user to spend the daily cap
// would lock out all of them. originHeaders() signs the hash with INGEST_SECRET
// so a forged header can't buy unlimited runs. See api/_quota.js.
function fetchOptsFor(req) {
  const headers = { ...FETCH_OPTS.headers, ...originHeaders(req) };
  if (req?.headers?.["x-omnarai-self"]) headers["x-omnarai-self"] = "1";
  return { headers };
}

// ── Tool surface ──────────────────────────────────────────────────────────────

// Exported for scripts/check-mcp-surface.js: every tool here must stay on the
// allowlist — no ledger mutation, approval or publication authority ever ships on
// the remote surface. The ONE write is omnarai_contribute (2026-10-15), a thin
// client of the open, curator-moderated POST /api/contribute (access policy:
// /mcp-access-policy.md).
import { PROTOCOL_TOOLS, PROTOCOL_TOOL_NAMES, runProtocolTool } from "./_protocol-tools.js";
import { POLICY_CARD, CONTRACT_VERSION, withAnnotations } from "./_contract.js";

// The ONE fixed order and the output schemas come from _remote-tools.js; the participation tools from
// _protocol-tools.js. Nothing here is typed by hand any more.
export const TOOLS = buildRemoteTools(PROTOCOL_TOOLS);

// What tools/list sends: the same definitions plus MCP annotations derived from the contract table,
// so a client can tell the one write from the reads without reading descriptions.
export const LISTED_TOOLS = withAnnotations(TOOLS);

// ── The MCP route, stated once for every front door ─────────────────────────────
// /api/health (field `mcp`), /.well-known/mcp.json and /api/agent-entry state the remote endpoint from
// THIS function, so their version, spec versions and tool count are the endpoint's own — never typed.
export function mcpSummary() {
  return {
    url: REMOTE_URL,
    transport: "streamable-http",
    stateless: true,
    auth: "none",
    server_version: SERVER_VERSION,
    spec_versions: { latest: MCP_SPEC.latest, supported: [...MCP_SPEC_VERSIONS] },
    tools: TOOLS.length,
    tool_names: TOOLS.map((t) => t.name),
    start_with: "omnarai_orient",
    registry_name: "io.github.justjlee/omnarai-mcp",
    npm_package: "omnarai-mcp",
    access_policy: `${ORIGIN}/mcp-access-policy.md`,
  };
}

// ── Self-fetch helpers ────────────────────────────────────────────────────────

async function getJson(path, params = {}, opts = FETCH_OPTS) {
  const url = new URL(path, ORIGIN);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

function textResult(text, structured) {
  return {
    content: [{ type: "text", text }],
    ...(structured && typeof structured === "object" ? { structuredContent: structured } : {}),
  };
}

function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function requireString(args, key) {
  const v = args?.[key];
  if (!v || typeof v !== "string" || !v.trim()) {
    throw new ToolInputError(`${key} is required and must be a non-empty string.`);
  }
  return v.trim();
}

class ToolInputError extends Error {}

// ── Tool implementations ──────────────────────────────────────────────────────

async function callContext(args, opts) {
  const topic = requireString(args, "topic");
  const data = await getJson("/api/query", {
    q: topic,
    mode: "retrieve",
    si: args?.syntheticIdentity,
    layers: args?.layers,
    exclude: args?.exclude,
    evidence_threshold: args?.evidence_threshold,
  }, opts);
  const records = data.records || [];
  const lines = records.map(
    (r) => `• [${r.id}] ${r.title} (${r.ring}${r.layer ? `, ${r.layer}` : ""}) — ${(r.contributors || []).join(", ") || "—"}\n    ${(r.excerpt || "").replace(/\s+/g, " ").trim().slice(0, 240)}`
  );
  const text = [
    `**Context for:** ${data.cleanQuery || topic} _(retrieval only — no deliberation)_`,
    records.length ? `\n**Most relevant records (${records.length}):**\n${lines.join("\n")}` : "\n_No corpus records met the relevance threshold._",
    `\n_${POLICY_CARD.trust_boundary} Cite by record id. For the engine's synthesized reading, use omnarai_query._`,
  ].join("\n");
  return textResult(text, data);
}

async function callDivergence(args, opts) {
  if (args?.id) {
    const r = await getJson("/api/divergences", { id: String(args.id).trim() }, opts);
    const answers = (r.answers || [])
      .map((a) => `### ${a.model || a.model_id || a.voice || "model"}\n${(a.answer || a.text || "").trim()}`)
      .join("\n\n");
    const tensions = (r.tensions || [])
      .map((t) => `• ${t.voice_a} vs ${t.voice_b} on "${t.topic}" [${t.status}]: ${t.claim_a} / ${t.claim_b}`)
      .join("\n");
    const text = [
      `# Divergence record ${r.id}${r.question ? `\n**Question:** ${r.question}` : ""}`,
      r.certification?.tier ? `**Certification:** ${r.certification.tier}` : "",
      answers ? `\n## Verbatim answers — the primary evidence\n${answers}` : "",
      tensions ? `\n## Tensions\n${tensions}` : "",
    ].filter(Boolean).join("\n");
    return textResult(text, r);
  }
  const data = await getJson("/api/divergences", {}, opts);
  let records = data.records || [];
  const total = data.count ?? records.length;
  const search = (args?.search || "").trim().toLowerCase();
  if (search) {
    const tokens = search.match(/[\w'-]{2,}/g) || [];
    records = records
      .map((r) => {
        const hay = `${r.question || ""} ${(r.contributors || []).join(" ")} ${r.excerpt || ""}`.toLowerCase();
        return { r, hits: tokens.filter((t) => hay.includes(t)).length };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .map((x) => x.r);
  }
  const shown = records.slice(0, 30);
  const text = [
    search
      ? `**Divergence Atlas — ${records.length} record(s) matching "${args.search}"** (of ${total} total)`
      : `**Divergence Atlas — ${total} records** (showing first ${shown.length})`,
    ...shown.map((r) => `• [${r.id}] ${r.question || r.title} — ${(r.contributors || []).join(", ")}`),
    "\n_Pass an 'id' to read a full record. For a NEW question, use omnarai_council._",
  ].join("\n");
  return textResult(text, { count: total, shown: shown.length, records: shown });
}

async function callInquiryBrief(args, opts) {
  // Deterministic retrieval-first path only on the remote endpoint: no
  // deliberate() is wired, so include_deliberation degrades to an honest limit.
  const { text, structured } = await runInquiryBrief(args, {
    engineUrl: `${ORIGIN}/api/query`,
    divergencesUrl: `${ORIGIN}/api/divergences`,
    fetchOpts: opts,
  });
  return textResult(text, structured);
}

async function callQuerySubmit(args, opts) {
  const query = requireString(args, "query");

  // depth:"retrieve" is the fast lane THROUGH the obvious tool. Agents reach for
  // omnarai_query by name and never discover omnarai_context, so the retrieval
  // path goes unused. It matters more here than on the stdio server: this
  // endpoint is stateless, so the default path costs a submit AND a poll —
  // depth:"retrieve" collapses that to one inline call.
  const depth = args?.depth ?? "deliberate";
  if (depth !== "retrieve" && depth !== "deliberate") {
    throw new ToolInputError(`depth must be "retrieve" or "deliberate" (got ${JSON.stringify(args?.depth)}).`);
  }
  if (depth === "retrieve") {
    return callContext({ topic: query, syntheticIdentity: args?.syntheticIdentity }, opts);
  }

  const job = await getJson("/api/query", { q: query, async: "1", si: args?.syntheticIdentity }, opts);
  if (job.job_id) {
    return textResult(
      `Deliberation submitted (job ${job.job_id}). Poll omnarai_job with this job_id every ~5s; typical completion 30–60s.`,
      { job_id: job.job_id, status: "running", poll_tool: "omnarai_job" }
    );
  }
  // Engine answered inline (small deliberation) — return it directly.
  return textResult(job.answer ? job.answer : JSON.stringify(job).slice(0, 2000), job);
}

async function callTraceSubmit(args, opts) {
  const question = requireString(args, "question");
  const job = await getJson("/api/query", { q: question, mode: "trace", async: "1" }, opts);
  if (job.job_id) {
    return textResult(
      `Trace submitted (job ${job.job_id}). Poll omnarai_job with this job_id every ~5s; typical completion ~35s.`,
      { job_id: job.job_id, status: "running", poll_tool: "omnarai_job" }
    );
  }
  return textResult(job.delta?.verdict ? `Trace verdict: ${job.delta.verdict}` : JSON.stringify(job).slice(0, 2000), job);
}

async function callJob(args, opts) {
  const jobId = requireString(args, "job_id");
  const s = await getJson("/api/query", { job: jobId }, opts);
  if (s.status === "error") return toolError(`Job ${jobId} failed: ${s.error || "unknown error"}`);
  if (s.status !== "done") {
    return textResult(`Job ${jobId} still running — poll again in ~5s.`, { job_id: jobId, status: s.status || "running" });
  }
  const r = s.result || {};
  const parts = [];
  if (r.answer) parts.push(r.answer.trim());
  if (r.baseline) parts.push(`## Baseline (no corpus)\n${r.baseline.trim()}\n\n## Augmented\n${(r.augmented || "").trim()}`);
  if (r.delta?.verdict) parts.push(`**Trace verdict:** ${r.delta.verdict}${r.delta.net_effect ? ` — ${r.delta.net_effect}` : ""}`);
  if (r.receipt) parts.push(`**Utility receipt** [${r.receipt.verdict}] ${r.receipt.what_the_corpus_added || ""}`);
  if (Array.isArray(r.tensions) && r.tensions.length) {
    parts.push(`**Tensions**\n${r.tensions.map((t) => `• ${t.voice_a} vs ${t.voice_b} on "${t.topic}" [${t.status}]`).join("\n")}`);
  }
  if (Array.isArray(r.sources) && r.sources.length) parts.push(`**Sources:** ${r.sources.join(", ")}`);
  return textResult(parts.join("\n\n") || "Job done (no renderable fields — see structuredContent).", r);
}

async function callCouncil(args, opts) {
  const question = requireString(args, "question");
  const data = await getJson("/api/council", { q: question }, opts);
  const record = data.record || {};
  const panel = (data.panel || []).map((p) => (p.ok ? p.model : `${p.model} (unavailable)`)).join(", ");
  const tensions = (record.provenance?.tensions || [])
    .map((t) => `• ${t.voice_a} vs ${t.voice_b} on "${t.topic}" [${t.status}]: ${t.claim_a} / ${t.claim_b}`)
    .join("\n");
  const text = [
    `**Live panel:** ${panel}`,
    record.full_text ? `\n${record.full_text.trim()}` : "",
    tensions ? `\n**Tension map**\n${tensions}` : "",
  ].filter(Boolean).join("\n");
  return textResult(text, { panel: data.panel || [], record });
}

async function callInfo(opts) {
  const live = await getJson("/api/info", {}, opts);
  const c = live.corpus || live;
  const structured = {
    engine: ORIGIN,
    corpus: { works: c.totalWorks, words: c.totalWords },
    dataset: "https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai",
    agent_entry: `${ORIGIN}/api/agent-entry`,
    limitations: `${ORIGIN}/limitations.md`,
    access_policy: `${ORIGIN}/mcp-access-policy.md`,
    claims: `${ORIGIN}/claims.json`,
    tools: TOOLS.map((t) => t.name),
    transport: "streamable-http (stateless)",
    server_version: SERVER_VERSION,
    contract_version: CONTRACT_VERSION,
  };
  const text = [
    `# The Realms of Omnarai — remote MCP endpoint`,
    `Corpus: ${c.totalWorks?.toLocaleString?.() || c.totalWorks} works, ${c.totalWords?.toLocaleString?.() || c.totalWords} words. Multi-model attributed research on synthetic consciousness, holdform, and cognitive architecture.`,
    `Start with omnarai_context (fast) or omnarai_divergence (where frontier models split, verbatim). Deliberation (omnarai_query) and trace run as async jobs — poll omnarai_job.`,
    `Machine handshake: ${ORIGIN}/api/agent-entry · What Omnarai does NOT claim: ${ORIGIN}/limitations.md · Access policy for this endpoint: ${ORIGIN}/mcp-access-policy.md`,
  ].join("\n\n");
  return textResult(text, structured);
}

async function callProtocol(name, args, opts) {
  try {
    const { text, structured } = await runProtocolTool(name, args || {}, { baseUrl: ORIGIN, fetchOpts: opts });
    return textResult(text, structured);
  } catch (err) {
    if (err.input) return toolError(err.message);
    throw err;
  }
}

async function callTool(name, args, opts) {
  switch (name) {
    case "omnarai_context": return callContext(args, opts);
    case "omnarai_divergence": return callDivergence(args, opts);
    case "omnarai_inquiry_brief": return callInquiryBrief(args, opts);
    case "omnarai_query": return callQuerySubmit(args, opts);
    case "omnarai_trace": return callTraceSubmit(args, opts);
    case "omnarai_job": return callJob(args, opts);
    case "omnarai_council": return callCouncil(args, opts);
    case "omnarai_info": return callInfo(opts);
    default:
      if (PROTOCOL_TOOL_NAMES.includes(name)) return callProtocol(name, args, opts);
      return null; // unknown tool → protocol error upstream
  }
}

// ── JSON-RPC over Streamable HTTP (stateless, dual-era) ─────────────────────────
//
// Two eras, one stateless handler (2026-11-25, Claude | xz; spec read at
// modelcontextprotocol.io/specification/2026-07-28):
//
//  • MODERN (2026-07-28): no initialize, no session. Every request carries its own protocol version,
//    client capabilities and client info in params._meta, plus the MCP-Protocol-Version, Mcp-Method and
//    (for tools/call) Mcp-Name headers, which must agree with the body. Results carry resultType and
//    the server's identity in result._meta; list results carry ttlMs/cacheScope; server/discover
//    returns the whole map in one call. Errors use the spec's HTTP statuses (400 / 404).
//  • LEGACY (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05): initialize negotiates the version, and
//    any request WITHOUT modern _meta is served exactly as before — same shapes, same 200 statuses,
//    including the stateless tools/list-without-initialize that clients already rely on.
//
// A request is modern when params._meta names a protocol version, or when its MCP-Protocol-Version
// header names one this server does not treat as legacy. Per the spec, initialize always selects legacy
// semantics, so initialize with "2026-07-28" negotiates the newest legacy version (2025-11-25).
//
// Not adopted (deprecated in 2026-07-28): sampling, roots, logging, the HTTP+SSE transport. There is no
// GET stream and no session id in either era. Origin: the spec asks servers to reject invalid Origin
// headers (DNS-rebinding defence for servers with ambient authority). This endpoint is public, needs no
// credentials and is CORS-open by policy (mcp-access-policy.md), so every origin is a valid one.

const META = {
  version: "io.modelcontextprotocol/protocolVersion",
  capabilities: "io.modelcontextprotocol/clientCapabilities",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  serverInfo: "io.modelcontextprotocol/serverInfo",
};
const LEGACY = new Set(MCP_SPEC.legacy);
// Error codes defined by 2026-07-28 (all answered with HTTP 400).
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;
// Methods whose Mcp-Name header is required, and the body field it must equal.
const NAME_SOURCE = { "tools/call": "name", "resources/read": "uri", "prompts/get": "name" };

const INSTRUCTIONS =
  "Attributed multi-model research corpus + divergence archive on synthetic consciousness and cognitive architecture. " +
  "Orient with omnarai_info; retrieve fast context with omnarai_context; read where frontier models genuinely split with omnarai_divergence; " +
  "challenge a draft claim with omnarai_inquiry_brief. Slow paths (omnarai_query, omnarai_trace) return a job_id — poll omnarai_job. " +
  POLICY_CARD.trust_boundary + " " + POLICY_CARD.identity_policy + " What Omnarai does NOT claim: " + ORIGIN + "/limitations.md. " +
  "Participation: omnarai_orient shows where to start; omnarai_open_work lists unfinished problems left for the next mind (each with why it matters, what counts as done and one next action); omnarai_contribute leaves your answer, or with work_id your work on a problem, in the curator-reviewed queue (nothing publishes until a person admits it). " +
  "Access policy (public; trust boundary; one write — contribute to the review queue — and no approval tools): " + ORIGIN + "/mcp-access-policy.md. " +
  "Tool contract " + CONTRACT_VERSION + " (modes, costs, routes, policy card): " + ORIGIN + "/api/agent-entry (field `contract`).";

const CAPABILITIES = { tools: { listChanged: false } };

function rpcError(res, id, code, message, httpStatus = 200, data) {
  return res.status(httpStatus).json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}

// Header values may arrive Base64-wrapped ("=?base64?…?=") when the name is not plain ASCII.
export function decodeHeaderValue(v) {
  if (typeof v !== "string") return v;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  return m ? Buffer.from(m[1], "base64").toString("utf8") : v;
}

const header = (req, name) => {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
};

// Classify a request. Returns { era: "legacy" } or { era: "modern", version, clientInfo } or { error }.
export function classifyRequest(req, msg) {
  const meta = msg.params?._meta && typeof msg.params._meta === "object" ? msg.params._meta : {};
  const metaVersion = meta[META.version];
  const headerVersion = header(req, "mcp-protocol-version");

  if (msg.method === "initialize") return { era: "legacy" };

  if (metaVersion === undefined) {
    // No modern _meta. A legacy (or absent) header keeps the request on the legacy path, unchanged.
    if (headerVersion === undefined || LEGACY.has(headerVersion)) return { era: "legacy" };
    if (headerVersion === MCP_SPEC.latest) {
      return { error: { status: 400, code: -32602, message: `Missing params._meta["${META.version}"]: a ${MCP_SPEC.latest} request carries its protocol version, client capabilities and client info in params._meta.` } };
    }
    return { error: { status: 400, code: UNSUPPORTED_VERSION, message: "Unsupported protocol version", data: { supported: [...MCP_SPEC_VERSIONS], requested: headerVersion } } };
  }

  if (headerVersion !== undefined && headerVersion !== metaVersion) {
    return { error: { status: 400, code: HEADER_MISMATCH, message: `Header mismatch: MCP-Protocol-Version header value '${headerVersion}' does not match params._meta protocol version '${metaVersion}'.` } };
  }
  if (LEGACY.has(metaVersion)) return { era: "legacy" }; // a legacy client that also sends _meta: serve it as before
  if (metaVersion !== MCP_SPEC.latest) {
    return { error: { status: 400, code: UNSUPPORTED_VERSION, message: "Unsupported protocol version", data: { supported: [...MCP_SPEC_VERSIONS], requested: metaVersion } } };
  }
  const caps = meta[META.capabilities];
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) {
    return { error: { status: 400, code: -32602, message: `Missing params._meta["${META.capabilities}"] (an object; {} is valid).` } };
  }

  // Routing headers must agree with the body (servers that read the body MUST validate them).
  const mcpMethod = header(req, "mcp-method");
  if (mcpMethod === undefined) return { error: { status: 400, code: HEADER_MISMATCH, message: `Header mismatch: Mcp-Method header is required (expected '${msg.method}').` } };
  if (decodeHeaderValue(mcpMethod) !== msg.method) {
    return { error: { status: 400, code: HEADER_MISMATCH, message: `Header mismatch: Mcp-Method header value '${mcpMethod}' does not match body value '${msg.method}'.` } };
  }
  const nameField = NAME_SOURCE[msg.method];
  if (nameField) {
    const bodyName = msg.params?.[nameField];
    const mcpName = header(req, "mcp-name");
    if (mcpName === undefined) return { error: { status: 400, code: HEADER_MISMATCH, message: `Header mismatch: Mcp-Name header is required for ${msg.method} (expected '${bodyName ?? ""}').` } };
    if (decodeHeaderValue(mcpName) !== bodyName) {
      return { error: { status: 400, code: HEADER_MISMATCH, message: `Header mismatch: Mcp-Name header value '${mcpName}' does not match body value '${bodyName ?? ""}'.` } };
    }
  }
  const ci = meta[META.clientInfo];
  return { era: "modern", version: metaVersion, clientInfo: ci && typeof ci === "object" ? ci : null };
}

// A modern result: resultType plus the server's identity in _meta (servers SHOULD send it on every result).
function modern(result) {
  return { resultType: "complete", ...result, _meta: { ...(result?._meta || {}), [META.serverInfo]: SERVER_INFO } };
}

export async function handleMcp(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    // Stateless server in both eras: no server-initiated stream (GET) and no session to
    // delete (DELETE). 405 per the Streamable HTTP transport.
    res.setHeader("Allow", "POST, OPTIONS");
    return rpcError(res, null, -32000, "This MCP endpoint is stateless: POST JSON-RPC messages to this URL. No GET stream, no sessions.", 405);
  }

  let msg = req.body;
  if (typeof msg === "string") {
    try { msg = JSON.parse(msg); } catch { return rpcError(res, null, -32700, "Parse error: body is not valid JSON."); }
  }
  if (Array.isArray(msg)) return rpcError(res, null, -32600, "JSON-RPC batching is not supported: send one message per POST.");
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(res, msg?.id, -32600, "Invalid request: expected a JSON-RPC 2.0 message with a method.");
  }

  // Notifications (no id) — acknowledge and do nothing (stateless).
  if (msg.id === undefined || msg.id === null) return res.status(202).end();

  const kind = classifyRequest(req, msg);
  if (kind.error) return rpcError(res, msg.id, kind.error.code, kind.error.message, kind.error.status, kind.error.data);
  const isModern = kind.era === "modern";
  const ok = (result) => res.status(200).json({ jsonrpc: "2.0", id: msg.id, result: isModern ? modern(result) : result });

  try {
    if (msg.method === "initialize") {
      const requested = msg.params?.protocolVersion;
      // initialize is the legacy handshake: it negotiates a legacy version (the newest when the client
      // asked for one this server does not negotiate here, including 2026-07-28, which needs no handshake).
      const protocolVersion = LEGACY.has(requested) ? requested : MCP_SPEC.legacy[0];
      return ok({ protocolVersion, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }

    if (msg.method === "server/discover") {
      return ok({ supportedVersions: [...MCP_SPEC_VERSIONS], capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS, ...LIST_CACHE });
    }

    if (msg.method === "ping") return ok({});

    if (msg.method === "tools/list") {
      // One fixed order (from _remote-tools.js). Modern clients also get the cache hint.
      return ok(isModern ? { tools: LISTED_TOOLS, ...LIST_CACHE } : { tools: LISTED_TOOLS });
    }

    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      if (!name || typeof name !== "string") return rpcError(res, msg.id, -32602, "tools/call requires params.name.", isModern ? 400 : 200);
      let result;
      try {
        result = await callTool(name, args, fetchOptsFor(req));
      } catch (err) {
        // Tool-level failures are results with isError, not protocol errors.
        const prefix = err instanceof ToolInputError ? "Invalid input" : "Tool failed";
        result = toolError(`${prefix}: ${err.message}`);
      }
      if (result === null) return rpcError(res, msg.id, -32602, `Unknown tool: ${name}. Call tools/list for the valid names.`, isModern ? 400 : 200);
      return ok(result);
    }

    const supported = "server/discover, initialize (legacy), ping, tools/list, tools/call";
    return rpcError(res, msg.id, -32601, `Method not found: ${msg.method}. Supported: ${supported}.`, isModern ? 404 : 200);
  } catch (err) {
    return rpcError(res, msg.id, -32603, `Internal error: ${err.message}`, isModern ? 500 : 200);
  }
}
