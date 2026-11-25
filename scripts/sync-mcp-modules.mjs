#!/usr/bin/env node
// Copy the omnarai-mcp package's synchronized modules into api/ (2026-11-25).
//
// The remote MCP endpoint is GENERATED from the npm package: these four files are edited in
// omnarai-mcp first and copied here byte for byte. Nothing in the copies is ever hand-edited.
//
//   omnarai-mcp/contract.js        → api/_contract.js        (tool contract + policy card)
//   omnarai-mcp/protocol-tools.js  → api/_protocol-tools.js  (participation tools)
//   omnarai-mcp/inquiry.js         → api/_inquiry.js         (inquiry brief)
//   omnarai-mcp/remote-tools.js    → api/_remote-tools.js    (remote tool list, output schemas,
//                                                              server version, spec versions)
//
//   node scripts/sync-mcp-modules.mjs           # copy (prints what changed)
//   node scripts/sync-mcp-modules.mjs --check   # exit 1 if any copy differs (scripts/check-mcp-surface.js runs this)
// OMNARAI_MCP_DIR points at the omnarai-mcp checkout you release against (default: the sibling ../omnarai-mcp).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const MCP_DIR = (process.env.OMNARAI_MCP_DIR || `${root}../omnarai-mcp`).replace(/\/?$/, "/");
export const SYNCED = [
  ["contract.js", "api/_contract.js"],
  ["protocol-tools.js", "api/_protocol-tools.js"],
  ["inquiry.js", "api/_inquiry.js"],
  ["remote-tools.js", "api/_remote-tools.js"],
];

export function compareCopies(mcpDir = MCP_DIR) {
  return SYNCED.map(([src, dst]) => {
    const from = `${mcpDir}${src}`;
    if (!existsSync(from)) return { src, dst, state: "missing-source" };
    const a = readFileSync(from, "utf8");
    const b = existsSync(`${root}${dst}`) ? readFileSync(`${root}${dst}`, "utf8") : null;
    return { src, dst, state: a === b ? "same" : "differs", text: a };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const rows = compareCopies();
  let bad = 0;
  for (const r of rows) {
    if (r.state === "missing-source") { console.error(`missing: ${MCP_DIR}${r.src} (set OMNARAI_MCP_DIR)`); bad++; continue; }
    if (r.state === "same") { console.log(`same     ${r.dst}`); continue; }
    if (check) { console.error(`DIFFERS  ${r.dst} ≠ omnarai-mcp/${r.src}`); bad++; continue; }
    writeFileSync(`${root}${r.dst}`, r.text);
    console.log(`copied   omnarai-mcp/${r.src} → ${r.dst}`);
  }
  process.exit(bad ? 1 : 0);
}
