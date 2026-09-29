#!/usr/bin/env node
// Footprint-protocol parity gate (2026-09-29). One protocol, many surfaces —
// this fails when any of them silently drifts from the code:
//
//   1. public/schemas/*.schema.json vocabularies == api/_footprints.js constants
//   2. every public protocol route is: rewritten in vercel.json (folded, no new
//      function), documented in openapi.json, llms.txt, the agent-entry packet,
//      README, omnarai.context.md and limitations.md
//   3. every protocol MCP tool exists on the remote surface (api/_mcp.js), the
//      npm canonical definitions and openai-tools.json (sibling checkout), and
//      NO write tool appears on any MCP surface
//   4. the serverless function count is still 12 (Hobby cap)
//
//   node scripts/check-footprint-parity.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as FP from "../api/_footprints.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(`${root}${p}`, "utf8");
const problems = [];
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ── 1. Schema ↔ validator ──────────────────────────────────────────────────────
const schema = JSON.parse(read("public/schemas/footprint.schema.json"));
const review = JSON.parse(read("public/schemas/footprint-review.schema.json"));
const P = schema.properties;
const checks = [
  ["event_type", P.event_type.enum, FP.EVENT_TYPES],
  ["content.stance", P.content.properties.stance.enum.filter((x) => x !== null), FP.STANCES],
  ["actor.actor_kind", P.actor.properties.actor_kind.enum, FP.ACTOR_KINDS],
  ["actor.lineage_id", P.actor.properties.lineage_id.enum, [...FP.KNOWN_LINEAGE_IDS, "unresolved"]],
  ["provenance.channel", P.provenance.properties.channel.enum, FP.CHANNELS],
  ["relationships", Object.keys(P.relationships.properties), [...FP.RELATION_LISTS, "supersedes"]],
  ["review.action", review.properties.action.enum, FP.REVIEW_ACTIONS],
  ["review.reviewer.kind", review.properties.reviewer.properties.kind.enum, FP.REVIEWER_KINDS],
];
for (const [name, a, b] of checks) if (!same(a, b)) problems.push(`schema ${name} [${a}] ≠ validator [${b}] — regenerate public/schemas`);
if (P.schema_version.const !== FP.FOOTPRINT_SCHEMA) problems.push("schema_version const drifted");
const sample = FP.footprintFromContribution(
  { id: "OMN-X1790000000000", target_id: "OMN-D1780000000001", question: "q?", identity: "Claude", justification: "replication", answer: "a", submittedAt: "2026-09-29T00:00:00.000Z" },
  { recordQuestion: "q?", id: "OMN-FP-1790000000000-00000000" },
);
if (!same(schema.required, Object.keys(sample))) problems.push(`schema required [${schema.required}] ≠ built footprint keys [${Object.keys(sample)}]`);
if (FP.validateFootprint(sample).length) problems.push(`the builder emits an invalid footprint: ${FP.validateFootprint(sample)[0]}`);

// ── 2. Routes on every surface ────────────────────────────────────────────────
// Each entry: [public path, rewrite destination prefix]. Grows with each phase.
export const PROTOCOL_ROUTES = [
  ["/api/footprints", "/api/council?_view=footprints"],
];
const vercel = JSON.parse(read("vercel.json"));
const openapi = JSON.parse(read("public/openapi.json"));
const surfaces = {
  "llms.txt": read("public/llms.txt"),
  "agent-entry (api/info.js)": read("api/info.js"),
  "README.md": read("README.md"),
  "omnarai.context.md": read("public/omnarai.context.md"),
  "limitations.md": read("public/limitations.md"),
};
for (const [path, dest] of PROTOCOL_ROUTES) {
  const rw = (vercel.rewrites || []).find((r) => r.source === path);
  if (!rw) problems.push(`vercel.json has no rewrite for ${path}`);
  else if (!rw.destination.startsWith(dest)) problems.push(`vercel.json rewrites ${path} → ${rw.destination}, expected ${dest}`);
  if (!openapi.paths?.[path]) problems.push(`openapi.json is missing ${path}`);
  for (const [name, text] of Object.entries(surfaces)) if (!text.includes(path)) problems.push(`${name} does not mention ${path}`);
}
if (!surfaces["llms.txt"].includes("/schemas/footprint.schema.json")) problems.push("llms.txt does not link /schemas/footprint.schema.json");

// ── 3. MCP tools ──────────────────────────────────────────────────────────────
export const PROTOCOL_TOOLS = [];
const { TOOLS: REMOTE } = await import("../api/_mcp.js");
const remoteNames = REMOTE.map((t) => t.name);
for (const t of PROTOCOL_TOOLS) if (!remoteNames.includes(t)) problems.push(`remote MCP (api/_mcp.js) is missing ${t}`);
const writeish = /contribute|footprint_(create|write|post)|approve|redact|publish/i;
for (const n of remoteNames) if (writeish.test(n)) problems.push(`remote MCP exposes a write-shaped tool: ${n}`);
const sibling = `${root}../omnarai-mcp/`;
if (existsSync(`${sibling}lib/tool-definitions.js`)) {
  const { ENGINE_TOOLS } = await import(`${sibling}lib/tool-definitions.js`);
  const npmNames = ENGINE_TOOLS.map((t) => t.name);
  const oa = JSON.parse(readFileSync(`${sibling}openai-tools.json`, "utf8")).map((t) => t.function.name);
  for (const t of PROTOCOL_TOOLS) {
    if (!npmNames.includes(t)) problems.push(`npm MCP (omnarai-mcp/lib/tool-definitions.js) is missing ${t}`);
    if (!oa.includes(t)) problems.push(`omnarai-mcp/openai-tools.json is missing ${t}`);
  }
  for (const n of npmNames) if (writeish.test(n)) problems.push(`npm MCP exposes a write-shaped engine tool: ${n}`);
} else {
  console.log("note: ../omnarai-mcp not found — npm/openai MCP parity skipped");
}

// ── 4. Function count ─────────────────────────────────────────────────────────
const fns = readdirSync(`${root}api`).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
if (fns.length > 12) problems.push(`api/ has ${fns.length} serverless functions (cap 12): ${fns.join(", ")} — fold new routes via vercel.json rewrites`);

if (problems.length) {
  console.error("Footprint parity FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`🟢 footprint parity: schema ↔ validator, ${PROTOCOL_ROUTES.length} route(s) on ${Object.keys(surfaces).length + 2} surfaces, ${PROTOCOL_TOOLS.length} MCP tool(s), ${fns.length}/12 functions`);
