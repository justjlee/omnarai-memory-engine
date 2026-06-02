#!/usr/bin/env node
// Back up the live Vercel Blob state (grown memory, proposals, tensions, concept
// proposals) to a local timestamped folder OUTSIDE the repo, before any write.
// Safety net so a bad deposit/approval can be fully reversed.

import { list } from "@vercel/blob";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// minimal .env.local loader (strips surrounding quotes)
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(ROOT, "..", "omnarai-backups", stamp);
const PREFIXES = ["memory/", "proposals/", "tensions/", "concept-proposals/"];

let total = 0;
for (const prefix of PREFIXES) {
  const { blobs } = await list({ prefix });
  for (const b of blobs) {
    const res = await fetch(b.url, { cache: "no-store" });
    const body = await res.text();
    const outPath = join(backupDir, b.pathname);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, body);
    total++;
    console.log(`  saved ${b.pathname} (${body.length} bytes)`);
  }
  console.log(`${prefix} → ${blobs.length} blob(s)`);
}
console.log(`\n✓ Backed up ${total} blob(s) to: ${backupDir}`);
