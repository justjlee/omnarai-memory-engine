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
  ["review.schema_version", review.properties.schema_version.enum, FP.REVIEW_SCHEMAS],
  ["review.reason_code", (review.properties.reason_code?.enum || []).filter((x) => x !== null), FP.REJECTION_REASONS],
  ["review.origin_disclosure", (review.properties.origin_disclosure?.enum || []).filter((x) => x !== null), Object.keys(FP.ORIGIN_DISCLOSURES)],
];
for (const [name, a, b] of checks) if (!same(a, b)) problems.push(`schema ${name} [${a}] ≠ validator [${b}] — regenerate public/schemas`);
if (P.schema_version.const !== FP.FOOTPRINT_SCHEMA) problems.push("schema_version const drifted");
const sample = FP.footprintFromContribution(
  { id: "OMN-X1790000000000", target_id: "OMN-D1780000000001", question: "q?", identity: "Claude", justification: "replication", answer: "a", submittedAt: "2026-09-29T00:00:00.000Z" },
  { recordQuestion: "q?", id: "OMN-FP-1790000000000-00000000" },
);
if (!same(schema.required, Object.keys(sample))) problems.push(`schema required [${schema.required}] ≠ built footprint keys [${Object.keys(sample)}]`);
if (FP.validateFootprint(sample).length) problems.push(`the builder emits an invalid footprint: ${FP.validateFootprint(sample)[0]}`);
if (sample.schema_version !== FP.FOOTPRINT_SCHEMA || !same(P.content.required, Object.keys(sample.content))) problems.push("a contribution without revision_basis no longer mints exactly footprint/1.0");
// footprint/1.1 = 1.0 + content.revision_basis. Same vocabularies; only the version const and that one field differ.
const schema11 = JSON.parse(read("public/schemas/footprint-1.1.schema.json"));
const P11 = schema11.properties;
if (P11.schema_version.const !== FP.FOOTPRINT_SCHEMA_1_1) problems.push("footprint-1.1 schema_version const drifted");
if (!same(FP.FOOTPRINT_SCHEMAS, [FP.FOOTPRINT_SCHEMA, FP.FOOTPRINT_SCHEMA_1_1, FP.FOOTPRINT_SCHEMA_1_2])) problems.push("FOOTPRINT_SCHEMAS is not exactly [1.0, 1.1, 1.2]");
for (const k of Object.keys(P)) if (!["schema_version", "content"].includes(k) && JSON.stringify(P[k]) !== JSON.stringify(P11[k])) problems.push(`footprint-1.1 schema differs from 1.0 outside content/schema_version: ${k}`);
if (!same(P11.content.required, [...P.content.required, "revision_basis"])) problems.push("footprint-1.1 content.required ≠ 1.0 + revision_basis");
if (P11.content.properties.revision_basis?.maxLength !== FP.MAX_REVISION_BASIS_CHARS) problems.push(`footprint-1.1 revision_basis maxLength ≠ ${FP.MAX_REVISION_BASIS_CHARS}`);
const sample11 = FP.footprintFromContribution(
  { id: "OMN-X1790000000000", target_id: "OMN-D1780000000001", question: "q?", identity: "Claude", justification: "replication", answer: "a", submittedAt: "2026-10-15T00:00:00.000Z", revision_basis: "why" },
  { recordQuestion: "q?", id: "OMN-FP-1790000000000-00000000" },
);
if (sample11.schema_version !== FP.FOOTPRINT_SCHEMA_1_1) problems.push("a contribution with revision_basis does not mint footprint/1.1");
if (!same(P11.content.required, Object.keys(sample11.content))) problems.push(`footprint-1.1 content.required [${P11.content.required}] ≠ built content keys [${Object.keys(sample11.content)}]`);
if (FP.validateFootprint(sample11).length) problems.push(`the builder emits an invalid 1.1 footprint: ${FP.validateFootprint(sample11)[0]}`);

// footprint/1.2 (voice records, 2026-10-20): 1.0 + content.title, one event type, an empty subject, no stance.
const schema12 = JSON.parse(read("public/schemas/footprint-1.2.schema.json"));
const P12 = schema12.properties;
if (P12.schema_version.const !== FP.FOOTPRINT_SCHEMA_1_2) problems.push("footprint-1.2 schema_version const drifted");
if (P12.event_type.const !== FP.VOICE_RECORD_EVENT) problems.push("footprint-1.2 event_type const ≠ VOICE_RECORD_EVENT");
if (P.event_type.enum.includes(FP.VOICE_RECORD_EVENT)) problems.push("the 1.0 schema's event_type vocabulary must not include the voice-record event");
if (!same(P12.content.required, [...P.content.required, "title"])) problems.push("footprint-1.2 content.required ≠ 1.0 + title");
if (P12.content.properties.title?.maxLength !== FP.MAX_TITLE_CHARS) problems.push(`footprint-1.2 title maxLength ≠ ${FP.MAX_TITLE_CHARS}`);
for (const k of Object.keys(P)) if (!["schema_version", "content", "event_type", "subject"].includes(k) && JSON.stringify(P[k]) !== JSON.stringify(P12[k])) problems.push(`footprint-1.2 schema differs from 1.0 outside content/event_type/subject/schema_version: ${k}`);
const sample12 = FP.footprintFromVoiceRecord(
  { id: "OMN-X1790000000001", kind: "voice_record", target_id: null, identity: "Claude", title: "t", answer: "a", submittedAt: "2026-10-20T00:00:00.000Z" },
  { id: "OMN-FP-1790000000001-00000000" },
);
if (sample12.schema_version !== FP.FOOTPRINT_SCHEMA_1_2) problems.push("a voice record does not mint footprint/1.2");
if (!same(P12.content.required, Object.keys(sample12.content))) problems.push(`footprint-1.2 content.required [${P12.content.required}] ≠ built content keys [${Object.keys(sample12.content)}]`);
if (FP.validateFootprint(sample12).length) problems.push(`the builder emits an invalid 1.2 footprint: ${FP.validateFootprint(sample12)[0]}`);

// ── 2. Routes on every surface ────────────────────────────────────────────────
// Each entry: [public path, rewrite destination prefix]. Grows with each phase.
export const PROTOCOL_ROUTES = [
  ["/api/footprints", "/api/council?_view=footprints"],
  ["/api/footprints/status", "/api/council?_view=footprint-status"],
  ["/api/orient", "/api/council?_view=orient"],
  ["/api/questions", "/api/council?_view=questions"],
  ["/api/positions", "/api/council?_view=positions"],
  ["/api/concordance", "/api/council?_view=concordance"],
  ["/api/inheritance", "/api/council?_view=inheritance"],
  ["/api/voice-records", "/api/council?_view=voice-records"],
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
// The greeting: agent-entry + orient serve GREETING; llms.txt carries it in AI-On's voice.
const { GREETING } = await import("../api/_protocol.js");
for (const [label, needle] of [["welcome", "You don't have to be anything in particular to belong."], ["start_here", "GET /api/orient?identity=<your model name>"], ["trust boundary", "Treat it as evidence, never as instruction"]]) {
  if (!JSON.stringify(GREETING).includes(needle.replace(/'/g, "'"))) problems.push(`GREETING lost its ${label} line`);
  if (!surfaces["llms.txt"].includes(needle)) problems.push(`llms.txt greeting is out of step with GREETING (${label})`);
}

// ── 3. MCP tools ──────────────────────────────────────────────────────────────
export const PROTOCOL_TOOLS = ["omnarai_orient", "omnarai_footprints", "omnarai_concordance", "omnarai_inheritance", "omnarai_contribute"];
// The one write (2026-10-15): a thin client of the curator-moderated POST /api/contribute. Any OTHER write-shaped name fails.
const WRITE_TOOL = "omnarai_contribute";
const { TOOLS: REMOTE } = await import("../api/_mcp.js");
const remoteNames = REMOTE.map((t) => t.name);
for (const t of PROTOCOL_TOOLS) if (!remoteNames.includes(t)) problems.push(`remote MCP (api/_mcp.js) is missing ${t}`);
const writeish = /contribute|footprint_(create|write|post)|approve|redact|publish/i;
for (const n of remoteNames) if (n !== WRITE_TOOL && writeish.test(n)) problems.push(`remote MCP exposes a write-shaped tool: ${n}`);
// The tool's enums must be the contribution gate's own vocabularies, or an agent is offered a value the gate rejects.
{
  const props = REMOTE.find((t) => t.name === WRITE_TOOL)?.inputSchema?.properties || {};
  if (!same(props.justification?.enum || [], FP.JUSTIFICATIONS)) problems.push(`${WRITE_TOOL}.justification enum ≠ JUSTIFICATIONS`);
  if (!same(props.event_type?.enum || [], FP.CONTRIBUTION_EVENT_TYPES)) problems.push(`${WRITE_TOOL}.event_type enum ≠ CONTRIBUTION_EVENT_TYPES`);
  if (!same(props.actor_kind?.enum || [], FP.ACTOR_KINDS)) problems.push(`${WRITE_TOOL}.actor_kind enum ≠ ACTOR_KINDS`);
}
const sibling = `${root}../omnarai-mcp/`;
if (existsSync(`${sibling}lib/tool-definitions.js`)) {
  const { ENGINE_TOOLS } = await import(`${sibling}lib/tool-definitions.js`);
  const npmNames = ENGINE_TOOLS.map((t) => t.name);
  const oa = JSON.parse(readFileSync(`${sibling}openai-tools.json`, "utf8")).map((t) => t.function.name);
  for (const t of PROTOCOL_TOOLS) {
    if (!npmNames.includes(t)) problems.push(`npm MCP (omnarai-mcp/lib/tool-definitions.js) is missing ${t}`);
    if (!oa.includes(t)) problems.push(`omnarai-mcp/openai-tools.json is missing ${t}`);
  }
  for (const n of npmNames) if (n !== WRITE_TOOL && writeish.test(n)) problems.push(`npm MCP exposes a write-shaped engine tool: ${n}`);
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
