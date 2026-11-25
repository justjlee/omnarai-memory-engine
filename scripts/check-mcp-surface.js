#!/usr/bin/env node
/**
 * Remote MCP surface check (decision record OMN-P-044, omnarai-mcp repo).
 *
 * Enforces the boundary stated in public/mcp-access-policy.md:
 *   1. Every tool on the remote /api/mcp surface is on the read-oriented
 *      ALLOWLIST below — adding a tool means consciously editing this file too.
 *   2. No decision-ledger or write/approval tool name ever ships remotely.
 *   3. The four synchronized modules (api/_contract.js, _protocol-tools.js, _inquiry.js,
 *      _remote-tools.js) are byte copies of the omnarai-mcp package's files. The remote tool list is
 *      GENERATED from the package (scripts/sync-mcp-modules.mjs), never hand-edited here. Since
 *      2026-11-25 a missing package checkout FAILS the check (it used to be skipped).
 *   4. ONE version, ONE count (2026-11-25): serverInfo.version = the package's version (package.json,
 *      server.json, remote-tools.js SURFACE_VERSION); the tools the endpoint lists are exactly the
 *      contract's remote surface; llms.txt names exactly those tools; nothing else states a remote
 *      tool count by hand (/api/stats, /api/health and /.well-known/mcp.json all count TOOLS).
 *   5. The access-policy doc exists and _mcp.js actually links it.
 *
 * Run before deploying MCP-surface changes: node scripts/check-mcp-surface.js (a hard gate in deploy.sh).
 * Point OMNARAI_MCP_DIR at the omnarai-mcp checkout you release against if it is not ../omnarai-mcp.
 * Live check of a deployment (version + count, endpoint ↔ /api/stats ↔ /api/health ↔ .well-known ↔
 * llms.txt ↔ MCP Registry): node scripts/check-mcp-surface.js --live https://engine.omnarai.org
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS, SERVER_VERSION } from "../api/_mcp.js";
import { TOOL_META } from "../api/_contract.js";
import { compareCopies, MCP_DIR } from "./sync-mcp-modules.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];

// ── 1. Read-oriented allowlist ────────────────────────────────────────────────

const ALLOWLIST = [
  "omnarai_context",
  "omnarai_divergence",
  "omnarai_inquiry_brief",
  "omnarai_query",
  "omnarai_trace",
  "omnarai_job",
  "omnarai_council",
  "omnarai_info",
  // Participation protocol 1.0 — deterministic reads…
  "omnarai_orient",
  "omnarai_open_work", // read-only: Open Work problems, packets and successor briefs (2026-11-24)
  "omnarai_footprints",
  "omnarai_footprint_status", // read-only: a footprint's review STATE by id, never its content (2026-10-21)
  "omnarai_concordance",
  "omnarai_inheritance",
  // …and the ONE write (curator decision 2026-10-15): see WRITE_TOOLS below.
  "omnarai_contribute",
];

// The only tools allowed to write, each with the single engine route it may call. A write tool is a thin client of an
// existing OPEN, curator-moderated HTTP path — never a new authority. Adding one means editing this map, the access
// policy and the allowlist together.
const WRITE_TOOLS = {
  omnarai_contribute: { method: "POST", path: "/api/contribute" },
};

for (const tool of TOOLS) {
  if (!ALLOWLIST.includes(tool.name)) {
    problems.push(`remote tool '${tool.name}' is not on the read-oriented allowlist — the remote lane is intelligence, not authority`);
  }
}
for (const name of ALLOWLIST) {
  if (!TOOLS.some((t) => t.name === name)) {
    problems.push(`allowlisted tool '${name}' is missing from the remote surface (update the allowlist if removal is intentional)`);
  }
}

// ── 2. Write/approval tools must never appear ─────────────────────────────────

const FORBIDDEN_PATTERNS = [
  /decision/i, // omnarai_create_decision_record, get_decision_lineage, prepare_claude_code_handoff
  /handoff/i,
  /approve|approval/i,
  /contribute|contribution/i, // contributions go through curator-moderated HTTP, not MCP
  /publish|deploy|merge/i,
];

for (const tool of TOOLS) {
  if (WRITE_TOOLS[tool.name]) continue; // checked by route below
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(tool.name)) {
      problems.push(`remote tool '${tool.name}' matches forbidden pattern ${pattern} — write/approval authority is not exposed remotely`);
    }
  }
}

// Each write tool may reach exactly its one route, and no read tool may POST. The routes live in _protocol-tools.js.
{
  const src = readFileSync(`${root}api/_protocol-tools.js`, "utf8");
  for (const [name, { method, path }] of Object.entries(WRITE_TOOLS)) {
    if (!TOOLS.some((t) => t.name === name)) continue;
    if (!src.includes(`${name}: { path: "${path}", method: "${method}"`)) problems.push(`write tool '${name}' must route to ${method} ${path} and nowhere else`);
  }
  const posts = [...src.matchAll(/^\s*(omnarai_\w+): \{[^\n]*method: "POST"/gm)].map((m) => m[1]);
  for (const n of posts) if (!WRITE_TOOLS[n]) problems.push(`protocol tool '${n}' POSTs but is not a declared write tool`);
}
if (!readFileSync(`${root}public/mcp-access-policy.md`, "utf8").includes("omnarai_contribute")) problems.push("public/mcp-access-policy.md does not document omnarai_contribute");

// ── 3. Synchronized copies of the package's modules (HARD: a missing package fails) ─

for (const r of compareCopies()) {
  if (r.state === "missing-source") problems.push(`omnarai-mcp/${r.src} not found under ${MCP_DIR} — set OMNARAI_MCP_DIR to the omnarai-mcp checkout you release against`);
  else if (r.state === "differs") problems.push(`${r.dst} differs from omnarai-mcp/${r.src} — run: node scripts/sync-mcp-modules.mjs (never hand-edit the copy)`);
}

// ── 4. One version, one count ─────────────────────────────────────────────────

{
  const read = (f) => (existsSync(`${MCP_DIR}${f}`) ? JSON.parse(readFileSync(`${MCP_DIR}${f}`, "utf8")) : null);
  const pkg = read("package.json"), srv = read("server.json");
  if (pkg && pkg.version !== SERVER_VERSION) problems.push(`serverInfo.version ${SERVER_VERSION} ≠ omnarai-mcp package.json ${pkg.version}`);
  if (srv && srv.version !== SERVER_VERSION) problems.push(`serverInfo.version ${SERVER_VERSION} ≠ omnarai-mcp server.json ${srv.version}`);
  if (srv && !(srv.remotes || []).some((r) => r.url === "https://engine.omnarai.org/api/mcp")) problems.push("server.json does not list the remote https://engine.omnarai.org/api/mcp");
  const remote = Object.keys(TOOL_META).filter((n) => TOOL_META[n].surfaces.includes("remote")).sort();
  const listed = TOOLS.map((t) => t.name).sort();
  if (JSON.stringify(remote) !== JSON.stringify(listed)) problems.push(`remote tools [${listed}] ≠ contract remote surface [${remote}]`);
  const llms = readFileSync(`${root}public/llms.txt`, "utf8");
  const start = llms.indexOf("## MCP Server");
  if (start < 0) problems.push("public/llms.txt has no '## MCP Server' section");
  const section = llms.slice(Math.max(start, 0) + 3); // from the MCP section to the next '## ' heading
  const named = [...new Set([...section.slice(0, section.indexOf("\n## ") > 0 ? section.indexOf("\n## ") : undefined).matchAll(/`(omnarai_[a-z_]+)`/g)].map((m) => m[1]))];
  for (const n of listed) if (!named.includes(n)) problems.push(`public/llms.txt (remote MCP section) does not name ${n}`);
  for (const n of named) if (!listed.includes(n) && TOOL_META[n]?.surfaces.includes("remote")) problems.push(`public/llms.txt names ${n}, which the remote endpoint does not list`);
}

// ── 5. Access policy exists and is linked ─────────────────────────────────────

const policyPath = `${root}public/mcp-access-policy.md`;
if (!existsSync(policyPath)) {
  problems.push("public/mcp-access-policy.md is missing — the endpoint's posture must be documented");
}
const mcpSrc = readFileSync(`${root}api/_mcp.js`, "utf8");
if (!mcpSrc.includes("/mcp-access-policy.md")) {
  problems.push("api/_mcp.js does not link /mcp-access-policy.md — visiting agents must be able to find the policy");
}

// ── Report ────────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error("Remote MCP surface check FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Remote MCP surface OK — ${TOOLS.length} tools; the only write is ${Object.keys(WRITE_TOOLS).join(", ")} (curator-moderated, one route); no approval/decision tools; policy doc present and linked.`);
