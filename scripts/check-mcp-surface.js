#!/usr/bin/env node
/**
 * Remote MCP surface check (decision record OMN-P-044, omnarai-mcp repo).
 *
 * Enforces the boundary stated in public/mcp-access-policy.md:
 *   1. Every tool on the remote /api/mcp surface is on the read-oriented
 *      ALLOWLIST below — adding a tool means consciously editing this file too.
 *   2. No decision-ledger or write/approval tool name ever ships remotely.
 *   3. api/_inquiry.js matches omnarai-mcp/inquiry.js byte-for-byte when the
 *      sibling checkout is present (they are declared synchronized copies).
 *   4. The access-policy doc exists and _mcp.js actually links it.
 *
 * Run before deploying MCP-surface changes: node scripts/check-mcp-surface.js
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../api/_mcp.js";

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
];

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
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(tool.name)) {
      problems.push(`remote tool '${tool.name}' matches forbidden pattern ${pattern} — write/approval authority is not exposed remotely`);
    }
  }
}

// ── 3. _inquiry.js copy sync (soft: skipped when sibling repo absent) ─────────

const localCopy = `${root}api/_inquiry.js`;
const sibling = `${root}../omnarai-mcp/inquiry.js`;
if (existsSync(sibling)) {
  if (readFileSync(localCopy, "utf8") !== readFileSync(sibling, "utf8")) {
    problems.push("api/_inquiry.js differs from ../omnarai-mcp/inquiry.js — these are declared synchronized copies; re-sync before deploying");
  }
} else {
  console.log("note: ../omnarai-mcp checkout not found — inquiry.js sync check skipped");
}

// ── 4. Access policy exists and is linked ─────────────────────────────────────

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
console.log(`Remote MCP surface OK — ${TOOLS.length} tools, all read-oriented; no write/approval tools; policy doc present and linked.`);
