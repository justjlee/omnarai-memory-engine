#!/usr/bin/env node
// Post-approval steps for the divergence record:
//   1. Confirm the approved entry + its vector are in durable grown memory.
//   2. Persist the four CAPTURED tensions to the live Tension Registry — the
//      first registry entries sourced from models actually disagreeing.

import { list } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); process.env[m[1]] = v; }
}

const RECORD_ID = "OMN-D1780429830432";
const draft = JSON.parse(readFileSync(join(__dirname, "divergence-pilot-runs", "divergence-record-DRAFT.json"), "utf8"));

// 1. Confirm grown memory
const { blobs } = await list({ prefix: "memory/grown.json" });
const grown = await (await fetch(blobs[0].url, { cache: "no-store" })).json();
const entry = (grown.entries || []).find(e => e.id === RECORD_ID);
const hasVec = !!(grown.vectors && grown.vectors[RECORD_ID]);
console.log("── Durable grown memory ──");
console.log(`  entry present:  ${entry ? "YES — " + entry.title.slice(0,60) : "NO"}`);
console.log(`  ring/type:      ${entry ? entry.ring + " / " + entry.type : "—"}`);
console.log(`  vector present: ${hasVec ? "YES (" + grown.vectors[RECORD_ID].length + " dims)" : "NO"}`);
console.log(`  total grown entries: ${grown.entries?.length}`);

// 2. Persist the captured tensions
console.log("\n── Persisting captured tensions to the Registry ──");
const res = await fetch("https://omnarai.vercel.app/api/tensions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "persist", tensions: draft.provenance.tensions, query: draft.provenance.question, sources: [RECORD_ID] }),
});
const out = await res.json();
console.log(`  HTTP ${res.status}: ${out.message || JSON.stringify(out).slice(0,200)}`);
for (const t of out.tensions || []) console.log(`  ✓ ${t.voice_a} vs ${t.voice_b} — ${t.topic} [${t.status}]`);
