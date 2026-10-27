#!/usr/bin/env node
// The tool-contract parity gate (2026-10-27). One table — api/_contract.js TOOL_META, byte-copied from
// omnarai-mcp/contract.js — says what every tool is. This checks the four places a tool is described
// against it and against each other:
//
//   npm package  (../omnarai-mcp/lib/tool-definitions.js ENGINE_TOOLS + DECISION_TOOLS)
//   remote MCP   (api/_mcp.js LISTED_TOOLS — exactly what tools/list sends)
//   OpenAI       (../omnarai-mcp/openai-tools.json)
//   OpenAPI      (public/openapi.json)
//
// Checked: the contract copies are identical; each tool is on exactly the surfaces TOOL_META names;
// npm and remote agree on property names, required lists, types and enums (documented exceptions
// below, nothing else); both carry the annotations TOOL_META derives; every input property is either
// mapped to a documented OpenAPI parameter / body field of the route the tool calls, or declared
// client-side; the protocol runners send what the contract says.
//
// Pure: no network, no Blob, no model. Without ../omnarai-mcp the npm/OpenAI layers are skipped with
// a note (as check-mcp-surface.js does) and the rest still runs.
//
//   node scripts/check-tool-contract.mjs          # exit 1 on any problem
// Tests: scripts/test-tool-contract.mjs (incl. injected drift).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const MCP_DIR = process.env.OMNARAI_MCP_DIR || `${root}../omnarai-mcp/`;

// The ONLY tolerated npm↔remote schema differences, each with its reason.
export const EXCEPTIONS = {
  omnarai_inquiry_brief: { stdio_only_props: ["include_deliberation"], why: "the remote surface has no deliberate path (stateless, 60s wall)" },
};

const props = (s) => Object.keys(s?.properties || {}).sort();
const req = (s) => [...(s?.required || [])].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function checkContract({ mcpDir = MCP_DIR, openapi = JSON.parse(readFileSync(`${root}public/openapi.json`, "utf8")), engineContractSrc = readFileSync(`${root}api/_contract.js`, "utf8") } = {}) {
  const problems = [];
  const notes = [];
  const C = await import(pathToFileURL(`${root}api/_contract.js`).href);
  const { LISTED_TOOLS } = await import(pathToFileURL(`${root}api/_mcp.js`).href);
  const { PROTOCOL_ROUTES } = await import(pathToFileURL(`${root}api/_protocol-tools.js`).href);
  const META = C.TOOL_META;

  // ── 1. The two contract copies are one file ─────────────────────────────────
  let npm = null, openai = null;
  if (existsSync(`${mcpDir}contract.js`)) {
    if (readFileSync(`${mcpDir}contract.js`, "utf8") !== engineContractSrc) problems.push("api/_contract.js differs from omnarai-mcp/contract.js — edit omnarai-mcp first, then copy");
    const td = await import(pathToFileURL(`${mcpDir}lib/tool-definitions.js`).href);
    npm = [...td.ENGINE_TOOLS, ...td.DECISION_TOOLS];
    openai = JSON.parse(readFileSync(`${mcpDir}openai-tools.json`, "utf8")).map((t) => t.function || t);
  } else {
    notes.push(`${mcpDir} not found (or has no contract.js) — npm and openai-tools.json layers skipped`);
  }

  const remote = new Map(LISTED_TOOLS.map((t) => [t.name, t]));
  const stdio = npm ? new Map(npm.map((t) => [t.name, t])) : null;

  // ── 2. Each tool is on exactly the surfaces the contract names ──────────────
  for (const [name, m] of Object.entries(META)) {
    if (m.surfaces.includes("remote") !== remote.has(name)) problems.push(`${name}: contract says remote=${m.surfaces.includes("remote")}, tools/list says ${remote.has(name)}`);
    if (stdio) {
      const onStdio = m.surfaces.includes("stdio") || m.surfaces.includes("stdio-local");
      if (onStdio !== stdio.has(name)) problems.push(`${name}: contract says stdio=${onStdio}, npm package says ${stdio.has(name)}`);
    }
  }
  for (const name of [...remote.keys(), ...(stdio ? stdio.keys() : [])]) if (!META[name]) problems.push(`${name} is shipped but has no TOOL_META entry`);

  // ── 3. npm ↔ remote schemas, and annotations on both ────────────────────────
  for (const [name, t] of remote) {
    if (!same(t.annotations, C.annotationsFor(name))) problems.push(`remote ${name}: annotations ≠ contract`);
  }
  if (stdio) {
    for (const [name, t] of stdio) if (!same(t.annotations, C.annotationsFor(name))) problems.push(`npm ${name}: annotations ≠ contract`);
    for (const [name, r] of remote) {
      const s = stdio.get(name);
      if (!s) continue;
      const ex = EXCEPTIONS[name]?.stdio_only_props || [];
      const sp = props(s.inputSchema).filter((p) => !ex.includes(p));
      if (!same(sp, props(r.inputSchema))) problems.push(`${name}: properties npm [${sp}] vs remote [${props(r.inputSchema)}]`);
      if (!same(req(s.inputSchema), req(r.inputSchema))) problems.push(`${name}: required npm [${req(s.inputSchema)}] vs remote [${req(r.inputSchema)}]`);
      for (const p of props(r.inputSchema)) {
        const a = s.inputSchema.properties[p], b = r.inputSchema.properties[p];
        if (a?.type !== b?.type) problems.push(`${name}.${p}: type npm ${a?.type} vs remote ${b?.type}`);
        if (!same(a?.enum || null, b?.enum || null)) problems.push(`${name}.${p}: enum differs between npm and remote`);
      }
      for (const p of ex) if (!s.inputSchema.properties?.[p]) problems.push(`${name}: exception lists '${p}', which npm no longer has — drop the exception`);
    }
  }

  // ── 4. openai-tools.json ↔ npm engine tools ─────────────────────────────────
  if (openai && stdio) {
    const oa = new Map(openai.map((f) => [f.name, f]));
    for (const [name, m] of Object.entries(META)) {
      const engineTool = m.http.length > 0 && (m.surfaces.includes("stdio"));
      if (engineTool !== oa.has(name)) problems.push(`${name}: openai-tools.json ${oa.has(name) ? "lists" : "lacks"} it, contract says ${engineTool ? "engine tool on stdio" : "not exported"}`);
      const f = oa.get(name), s = stdio.get(name);
      if (f && s) {
        if (!same(props(f.parameters), props(s.inputSchema))) problems.push(`${name}: openai properties [${props(f.parameters)}] vs npm [${props(s.inputSchema)}]`);
        if (!same(req(f.parameters), req(s.inputSchema))) problems.push(`${name}: openai required vs npm differ`);
      }
    }
  }

  // ── 5. Contract ↔ OpenAPI, and every property accounted for ─────────────────
  const schemaFor = (name) => (stdio?.get(name) || remote.get(name))?.inputSchema;
  for (const [name, m] of Object.entries(META)) {
    if (!m.http.length) continue;
    const covered = new Set(Object.keys(m.client_side || {}));
    for (const h of m.http) {
      const op = openapi.paths?.[h.path]?.[h.method.toLowerCase()];
      if (!op) { problems.push(`${name}: ${h.method} ${h.path} is not in public/openapi.json`); continue; }
      const params = (op.parameters || []).map((p) => (p.$ref ? openapi.components?.parameters?.[p.$ref.split("/").pop()] : p)).filter(Boolean);
      const has = (where, n) => params.some((p) => p.in === where && p.name === n);
      for (const [arg, q] of Object.entries(h.params || {})) { covered.add(arg); if (!has("query", q)) problems.push(`${name}.${arg} → ?${q}: not documented on ${h.method} ${h.path}`); }
      for (const [arg, hd] of Object.entries(h.headers || {})) { covered.add(arg); if (!has("header", hd)) problems.push(`${name}.${arg} → header ${hd}: not documented on ${h.method} ${h.path}`); }
      if (h.body) {
        const bodySchema = op.requestBody?.content?.["application/json"]?.schema || {};
        const bp = Object.keys(bodySchema.properties || {});
        for (const f of h.body) { covered.add(f); if (!bp.includes(f)) problems.push(`${name}.${f}: not a documented body field of ${h.method} ${h.path}`); }
        const s = schemaFor(name);
        if (s && !same(req(s), [...(bodySchema.required || [])].sort())) problems.push(`${name}: required [${req(s)}] vs OpenAPI body required [${[...(bodySchema.required || [])].sort()}]`);
      }
    }
    // Coverage on EVERY surface that ships the tool, so a property added on one side only is caught
    // here even when the npm layer is skipped.
    const schemas = [stdio?.get(name), remote.get(name)].filter(Boolean).map((t) => t.inputSchema);
    const seen = new Set();
    for (const s of schemas) {
      for (const p of props(s)) {
        seen.add(p);
        if (!covered.has(p)) problems.push(`${name}.${p} is neither mapped to the route nor declared client_side in the contract`);
      }
    }
    if (schemas.length) for (const k of covered) if (!seen.has(k) && !(EXCEPTIONS[name]?.stdio_only_props || []).includes(k)) problems.push(`${name}: contract names '${k}', which no schema has`);
  }

  // ── 6. The protocol runners send what the contract says ─────────────────────
  for (const [name, r] of Object.entries(PROTOCOL_ROUTES)) {
    const h = META[name]?.http?.[0];
    if (!h || h.path !== r.path || h.method !== (r.method || "GET")) { problems.push(`${name}: runner route ${r.method || "GET"} ${r.path} ≠ contract`); continue; }
    if (r.method === "POST" ? !same(h.body, r.body) : (!same(Object.keys(h.params).sort(), [...r.params].sort()) || !same(h.headers || {}, r.headers || {}))) problems.push(`${name}: runner parameters ≠ contract`);
  }

  // ── 7. One write reaches the engine ─────────────────────────────────────────
  const remoteWrites = [...remote.values()].filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name);
  if (!same(remoteWrites, ["omnarai_contribute"])) problems.push(`remote write tools are [${remoteWrites}] — expected only omnarai_contribute`);

  return { problems: [...new Set(problems)], notes, tools: { remote: remote.size, npm: stdio?.size ?? null, contract: Object.keys(META).length }, contract_version: C.CONTRACT_VERSION };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, notes, tools, contract_version } = await checkContract();
  for (const n of notes) console.log(`note: ${n}`);
  if (problems.length) {
    console.error(`✖ tool contract ${contract_version}: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`🟢 tool contract ${contract_version}: ${tools.contract} tools · remote ${tools.remote} · npm ${tools.npm ?? "skipped"} · openai + OpenAPI + annotations + runners agree`);
}
