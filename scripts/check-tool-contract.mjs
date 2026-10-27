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
// ALL FOUR ARE REQUIRED. A missing source is a failure, never a skipped layer: a gate that passes
// because it could not see a surface has checked nothing. Point OMNARAI_MCP_DIR at the omnarai-mcp
// checkout you are releasing against if it is not the sibling directory.
//
// Checked:
//   1. the contract copies are identical;
//   2. each tool is on exactly the surfaces TOOL_META names;
//   3. npm ↔ remote and npm ↔ OpenAI: property names, required lists and the FULL parameter schema
//      (type, enum, items, nested properties, bounds — everything except description text), with the
//      documented exceptions below and nothing else; both MCP surfaces carry the derived annotations;
//   4. OpenAPI: every input property maps to a documented parameter / body field of the route the
//      tool calls (or is declared client-side), with a compatible type, the same enum, and nothing the
//      route requires left optional on the tool;
//   5. descriptions: every tool and property is described on every surface; where two surfaces
//      describe the same thing differently, that difference must be recorded, by hash, in
//      scripts/tool-contract-descriptions.lock.json — so editing a description on one surface fails
//      the gate until someone reviews the pair and re-accepts it (--accept-descriptions);
//   6. the protocol runners (protocol-tools.js) send what the contract says;
//   7. exactly one write tool reaches the engine.
//
// Pure: no network, no Blob, no model.
//
//   node scripts/check-tool-contract.mjs                        # exit 1 on any problem
//   node scripts/check-tool-contract.mjs --accept-descriptions  # after REVIEWING the reported pairs
// Tests: scripts/test-tool-contract.mjs (incl. injected drift).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const MCP_DIR = (process.env.OMNARAI_MCP_DIR || `${root}../omnarai-mcp`).replace(/\/?$/, "/");
export const LOCK_PATH = `${root}scripts/tool-contract-descriptions.lock.json`;

// The ONLY tolerated schema differences, each with its reason.
export const EXCEPTIONS = {
  omnarai_inquiry_brief: { stdio_only_props: ["include_deliberation"], why: "the remote surface has no deliberate path (stateless, 60s wall)" },
};
// Tool type ↔ OpenAPI type pairs accepted although not identical, each named.
export const TYPE_TOLERANCES = {
  "omnarai_footprints.limit": { tool: "number", openapi: "integer", why: "the route parses an integer; the tool schema predates the OpenAPI entry" },
};

const props = (s) => Object.keys(s?.properties || {}).sort();
const req = (s) => [...(s?.required || [])].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const h16 = (s) => createHash("sha256").update(String(s ?? "")).digest("hex").slice(0, 16);
// A parameter schema with its description text removed and keys sorted, at every depth.
const shape = (v) => Array.isArray(v) ? v.map(shape)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => k !== "description").sort().map((k) => [k, shape(v[k])]))
    : v;

function loadSources({ mcpDir, openapi, engineContractSrc, npmTools, openaiTools, descriptionLock }) {
  const missing = [];
  const need = (path, what) => { if (!existsSync(path)) missing.push(`${what} not found at ${path}`); return existsSync(path); };
  if (openapi == null && need(`${root}public/openapi.json`, "OpenAPI spec")) openapi = JSON.parse(readFileSync(`${root}public/openapi.json`, "utf8"));
  if (engineContractSrc == null && need(`${root}api/_contract.js`, "engine contract")) engineContractSrc = readFileSync(`${root}api/_contract.js`, "utf8");
  const npmContractSrc = need(`${mcpDir}contract.js`, "omnarai-mcp contract.js (set OMNARAI_MCP_DIR)") ? readFileSync(`${mcpDir}contract.js`, "utf8") : null;
  if (npmTools == null) need(`${mcpDir}lib/tool-definitions.js`, "omnarai-mcp tool definitions");
  if (openaiTools == null && need(`${mcpDir}openai-tools.json`, "omnarai-mcp openai-tools.json")) openaiTools = JSON.parse(readFileSync(`${mcpDir}openai-tools.json`, "utf8")).map((t) => t.function || t);
  if (descriptionLock == null && need(LOCK_PATH, "description lock (run --accept-descriptions after review)")) descriptionLock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  return { missing, openapi, engineContractSrc, npmContractSrc, openaiTools, descriptionLock };
}

export async function checkContract({ mcpDir = MCP_DIR, openapi, engineContractSrc, npmTools, openaiTools, descriptionLock, remoteTools } = {}) {
  const problems = [];
  const src = loadSources({ mcpDir, openapi, engineContractSrc, npmTools, openaiTools, descriptionLock });
  const C = await import(pathToFileURL(`${root}api/_contract.js`).href);
  const META = C.TOOL_META;
  if (src.missing.length) {
    return { problems: src.missing.map((m) => `required source missing — ${m}`), notes: [], pairs: {}, tools: { contract: Object.keys(META).length, remote: null, npm: null }, contract_version: C.CONTRACT_VERSION };
  }
  if (npmTools == null) {
    const td = await import(pathToFileURL(`${mcpDir}lib/tool-definitions.js`).href);
    npmTools = [...td.ENGINE_TOOLS, ...td.DECISION_TOOLS];
  }
  if (remoteTools == null) remoteTools = (await import(pathToFileURL(`${root}api/_mcp.js`).href)).LISTED_TOOLS;
  const { PROTOCOL_ROUTES } = await import(pathToFileURL(`${root}api/_protocol-tools.js`).href);
  const api = src.openapi;

  // ── 1. The two contract copies are one file ─────────────────────────────────
  if (src.npmContractSrc !== src.engineContractSrc) problems.push("api/_contract.js differs from omnarai-mcp/contract.js — edit omnarai-mcp first, then copy");

  const remote = new Map(remoteTools.map((t) => [t.name, t]));
  const stdio = new Map(npmTools.map((t) => [t.name, t]));
  const oa = new Map(src.openaiTools.map((f) => [f.name, f]));

  // ── 2. Each tool is on exactly the surfaces the contract names ──────────────
  for (const [name, m] of Object.entries(META)) {
    if (m.surfaces.includes("remote") !== remote.has(name)) problems.push(`${name}: contract says remote=${m.surfaces.includes("remote")}, tools/list says ${remote.has(name)}`);
    const onStdio = m.surfaces.includes("stdio") || m.surfaces.includes("stdio-local");
    if (onStdio !== stdio.has(name)) problems.push(`${name}: contract says stdio=${onStdio}, npm package says ${stdio.has(name)}`);
    const engineTool = m.http.length > 0 && m.surfaces.includes("stdio");
    if (engineTool !== oa.has(name)) problems.push(`${name}: openai-tools.json ${oa.has(name) ? "lists" : "lacks"} it, contract says ${engineTool ? "engine tool on stdio" : "not exported"}`);
  }
  for (const name of new Set([...remote.keys(), ...stdio.keys(), ...oa.keys()])) if (!META[name]) problems.push(`${name} is shipped but has no TOOL_META entry`);

  // ── 3. Schemas: npm ↔ remote, npm ↔ OpenAI; annotations on both MCP surfaces ─
  for (const [name, t] of remote) if (!same(t.annotations, C.annotationsFor(name))) problems.push(`remote ${name}: annotations ≠ contract`);
  for (const [name, t] of stdio) if (!same(t.annotations, C.annotationsFor(name))) problems.push(`npm ${name}: annotations ≠ contract`);
  const compareSchemas = (label, name, s, o, ex = []) => {
    const sp = props(s).filter((p) => !ex.includes(p));
    if (!same(sp, props(o))) problems.push(`${name}: properties npm [${sp}] vs ${label} [${props(o)}]`);
    if (!same(req(s), req(o))) problems.push(`${name}: required npm [${req(s)}] vs ${label} [${req(o)}]`);
    for (const p of props(o)) {
      const a = s?.properties?.[p], b = o.properties[p];
      if (!a) continue;
      if (a.type !== b?.type) problems.push(`${name}.${p}: type npm ${a.type} vs ${label} ${b?.type}`);
      else if (!same(a.enum || null, b?.enum || null)) problems.push(`${name}.${p}: enum differs between npm and ${label}`);
      else if (!same(shape(a), shape(b))) problems.push(`${name}.${p}: schema (items / nested properties / bounds) differs between npm and ${label}`);
    }
  };
  for (const [name, r] of remote) {
    const s = stdio.get(name);
    if (!s) continue;
    const ex = EXCEPTIONS[name]?.stdio_only_props || [];
    compareSchemas("remote", name, s.inputSchema, r.inputSchema, ex);
    for (const p of ex) if (!s.inputSchema.properties?.[p]) problems.push(`${name}: exception lists '${p}', which npm no longer has — drop the exception`);
  }
  for (const [name, f] of oa) {
    const s = stdio.get(name);
    if (s) compareSchemas("openai", name, s.inputSchema, f.parameters);
  }

  // ── 4. Contract ↔ OpenAPI, and every property accounted for ─────────────────
  const schemaFor = (name) => (stdio.get(name) || remote.get(name))?.inputSchema;
  const openapiPairs = [];
  for (const [name, m] of Object.entries(META)) {
    if (!m.http.length) continue;
    const covered = new Set(Object.keys(m.client_side || {}));
    const s = schemaFor(name);
    for (const h of m.http) {
      const op = api.paths?.[h.path]?.[h.method.toLowerCase()];
      if (!op) { problems.push(`${name}: ${h.method} ${h.path} is not in public/openapi.json`); continue; }
      const params = (op.parameters || []).map((p) => (p.$ref ? api.components?.parameters?.[p.$ref.split("/").pop()] : p)).filter(Boolean);
      const checkParam = (arg, where, pname) => {
        covered.add(arg);
        const p = params.find((x) => x.in === where && x.name === pname);
        const label = where === "header" ? `header ${pname}` : `?${pname}`;
        if (!p) { problems.push(`${name}.${arg} → ${label}: not documented on ${h.method} ${h.path}`); return; }
        const tp = s?.properties?.[arg];
        if (!tp) return;
        const tol = TYPE_TOLERANCES[`${name}.${arg}`];
        if (tp.type !== p.schema?.type && !(tol && tol.tool === tp.type && tol.openapi === p.schema?.type)) problems.push(`${name}.${arg} → ${label}: type tool ${tp.type} vs OpenAPI ${p.schema?.type}`);
        if ((tp.enum || p.schema?.enum) && !same([...(tp.enum || [])].sort(), [...(p.schema?.enum || [])].sort())) problems.push(`${name}.${arg} → ${label}: enum differs between the tool and OpenAPI`);
        if (p.required && !(s.required || []).includes(arg)) problems.push(`${name}.${arg} → ${label}: OpenAPI requires it, the tool leaves it optional`);
        openapiPairs.push([`${name}.${arg}`, tp.description, p.description]);
      };
      for (const [arg, q] of Object.entries(h.params || {})) checkParam(arg, "query", q);
      for (const [arg, hd] of Object.entries(h.headers || {})) checkParam(arg, "header", hd);
      if (h.body) {
        const bodySchema = op.requestBody?.content?.["application/json"]?.schema || {};
        for (const f of h.body) {
          covered.add(f);
          const b = bodySchema.properties?.[f];
          if (!b) { problems.push(`${name}.${f}: not a documented body field of ${h.method} ${h.path}`); continue; }
          const tp = s?.properties?.[f];
          if (tp && tp.type !== b.type) problems.push(`${name}.${f}: type tool ${tp.type} vs OpenAPI body ${b.type}`);
          if (tp && (tp.enum || b.enum) && !same([...(tp.enum || [])].sort(), [...(b.enum || [])].sort())) problems.push(`${name}.${f}: enum differs between the tool and the OpenAPI body`);
          if (tp) openapiPairs.push([`${name}.${f}`, tp.description, b.description]);
        }
        if (s && !same(req(s), [...(bodySchema.required || [])].sort())) problems.push(`${name}: required [${req(s)}] vs OpenAPI body required [${[...(bodySchema.required || [])].sort()}]`);
      }
    }
    // Coverage on EVERY surface that ships the tool.
    const schemas = [stdio.get(name), remote.get(name)].filter(Boolean).map((t) => t.inputSchema);
    const seen = new Set();
    for (const sc of schemas) {
      for (const p of props(sc)) {
        seen.add(p);
        if (!covered.has(p)) problems.push(`${name}.${p} is neither mapped to the route nor declared client_side in the contract`);
      }
    }
    if (schemas.length) for (const k of covered) if (!seen.has(k) && !(EXCEPTIONS[name]?.stdio_only_props || []).includes(k)) problems.push(`${name}: contract names '${k}', which no schema has`);
  }

  // ── 5. Descriptions: present everywhere; every difference reviewed ──────────
  const surfaces = [["npm", stdio, (t) => t.inputSchema], ["remote", remote, (t) => t.inputSchema], ["openai", oa, (f) => f.parameters]];
  for (const [label, tools, schemaOf] of surfaces) {
    for (const [name, t] of tools) {
      if (!String(t.description || "").trim()) problems.push(`${label} ${name}: no tool description`);
      for (const [p, d] of Object.entries(schemaOf(t)?.properties || {})) if (!String(d.description || "").trim()) problems.push(`${label} ${name}.${p}: no description`);
    }
  }
  const pairs = {};
  const pair = (key, a, b) => { if (String(a ?? "") !== String(b ?? "")) pairs[key] = `${h16(a)}:${h16(b)}`; };
  for (const [label, tools, schemaOf] of surfaces.slice(1)) {
    for (const [name, t] of tools) {
      const s = stdio.get(name);
      if (!s) continue;
      pair(`npm~${label}:${name}`, s.description, t.description);
      for (const p of props(schemaOf(t))) if (s.inputSchema.properties?.[p]) pair(`npm~${label}:${name}.${p}`, s.inputSchema.properties[p].description, schemaOf(t).properties[p].description);
    }
  }
  for (const [key, a, b] of openapiPairs) pair(`tool~openapi:${key}`, a, b);
  const lock = src.descriptionLock.pairs || {};
  for (const [k, v] of Object.entries(pairs)) {
    if (!(k in lock)) problems.push(`description: ${k} differs and the difference was never reviewed`);
    else if (lock[k] !== v) problems.push(`description: ${k} changed since it was last reviewed`);
  }
  for (const k of Object.keys(lock)) if (!(k in pairs)) problems.push(`description: lock entry ${k} no longer applies (the texts now match or the pair is gone) — re-accept to drop it`);

  // ── 6. The protocol runners send what the contract says ─────────────────────
  for (const [name, r] of Object.entries(PROTOCOL_ROUTES)) {
    const h = META[name]?.http?.[0];
    if (!h || h.path !== r.path || h.method !== (r.method || "GET")) { problems.push(`${name}: runner route ${r.method || "GET"} ${r.path} ≠ contract`); continue; }
    if (r.method === "POST" ? !same(h.body, r.body) : (!same(Object.keys(h.params).sort(), [...r.params].sort()) || !same(h.headers || {}, r.headers || {}))) problems.push(`${name}: runner parameters ≠ contract`);
  }

  // ── 7. One write reaches the engine ─────────────────────────────────────────
  const remoteWrites = [...remote.values()].filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name);
  if (!same(remoteWrites, ["omnarai_contribute"])) problems.push(`remote write tools are [${remoteWrites}] — expected only omnarai_contribute`);

  return { problems: [...new Set(problems)], notes: [], pairs, tools: { remote: remote.size, npm: stdio.size, openai: oa.size, contract: Object.keys(META).length }, contract_version: C.CONTRACT_VERSION };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const accept = process.argv.includes("--accept-descriptions");
  const r = await checkContract(accept ? { descriptionLock: { pairs: {} } } : {});
  const problems = accept ? r.problems.filter((p) => !p.startsWith("description: ")) : r.problems;
  if (accept && !problems.some((p) => p.startsWith("required source missing"))) {
    const sorted = Object.fromEntries(Object.entries(r.pairs).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(LOCK_PATH, JSON.stringify({ note: "Reviewed description differences between surfaces, by hash (scripts/check-tool-contract.mjs §5). Regenerate with --accept-descriptions only after reading each changed pair.", pairs: sorted }, null, 1) + "\n");
    console.log(`wrote ${Object.keys(sorted).length} reviewed description pair(s) to scripts/tool-contract-descriptions.lock.json`);
  }
  if (problems.length) {
    console.error(`✖ tool contract ${r.contract_version}: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`🟢 tool contract ${r.contract_version}: ${r.tools.contract} tools · remote ${r.tools.remote} · npm ${r.tools.npm} · openai ${r.tools.openai} · OpenAPI · annotations · protocol runners agree (mcp: ${MCP_DIR})`);
}
