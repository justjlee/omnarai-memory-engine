#!/usr/bin/env node
// Backfill the structured divergence block onto approved grown-memory entries.
// appendGrownEntry() drops proposal.provenance, so the live entries lost their
// {question, answers[], tensions[]} — but the proposal blobs still have it.
// This reads each divergence record's proposal blob and writes a `divergence`
// field onto the grown entry, so /api/divergences can serve it as structured data.
// Backs up grown.json locally first. Idempotent (skips entries already backfilled).

import { list, put } from "@vercel/blob";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); process.env[m[1]] = v; }
}

const { blobs } = await list({ prefix: "memory/grown.json" });
const grown = await (await fetch(blobs[0].url, { cache: "no-store" })).json();

// local backup before mutating the live canonical store
const bdir = join(__dirname, "..", "..", "omnarai-backups", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(bdir, { recursive: true });
writeFileSync(join(bdir, "grown.json"), JSON.stringify(grown, null, 2));
console.log(`backup → ${join(bdir, "grown.json")}\n`);

let changed = 0;
for (const e of grown.entries) {
  if (e.type !== "divergence" || e.divergence) continue;
  const { blobs: pb } = await list({ prefix: `proposals/${e.id}` });
  if (!pb.length) { console.log(`  ⚠ no proposal blob for ${e.id} — skipped`); continue; }
  const p = (await (await fetch(pb[0].url, { cache: "no-store" })).json()).provenance || {};
  e.divergence = { question: p.question, method: p.method, answers: p.answers || [], tensions: p.tensions || [] };
  changed++;
  console.log(`  + ${e.id}: ${(p.answers || []).length} answers, ${(p.tensions || []).length} tensions`);
}

if (changed) {
  grown.updatedAt = new Date().toISOString();
  await put("memory/grown.json", JSON.stringify(grown), { access: "public", addRandomSuffix: false, contentType: "application/json" });
  console.log(`\n✓ backfilled ${changed} record(s) into grown.json`);
} else {
  console.log("\nno changes (already backfilled)");
}