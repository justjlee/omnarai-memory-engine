#!/usr/bin/env node
// Dump the live grown-memory blob to a local snapshot so build-hf-derivatives.py
// can merge it (the seed corpus.json doesn't contain grown entries like the
// divergence records). Read-only against the Blob.

import { list } from "@vercel/blob";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); process.env[m[1]] = v; }
}

const { blobs } = await list({ prefix: "memory/grown.json" });
const grown = await (await fetch(blobs[0].url, { cache: "no-store" })).json();
const out = join(__dirname, ".grown-snapshot.json");
writeFileSync(out, JSON.stringify(grown, null, 2));
console.log(`✓ grown snapshot: ${grown.entries?.length} entries → ${out}`);
console.log(`  ids: ${(grown.entries || []).map(e => e.id).join(", ")}`);
