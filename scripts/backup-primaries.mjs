#!/usr/bin/env node
// Back up every primary record from the Vercel Blob to a dated local folder.
// The Blob is the ONLY home of grown entries, visitor contributions, tension
// dispositions, and telemetry (the firstExternalAt milestone) — a single point
// of failure for the layer §0.5 calls unrecoverable. This dumps all of it
// except sessions/ (24h-TTL ephemeral, privacy-scoped).
//
// Read-only against the Blob. Writes to ../omnarai-backups/<timestamp>/.
// Run after any batch of approvals, and before any schema migration.

import { list } from "@vercel/blob";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); process.env[m[1]] = v; }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outRoot = join(__dirname, "..", "..", "omnarai-backups", stamp);

let cursor, all = [];
do {
  const page = await list({ cursor, limit: 1000 });
  all.push(...page.blobs);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

const skipped = all.filter(b => b.pathname.startsWith("sessions/"));
const targets = all.filter(b => !b.pathname.startsWith("sessions/"));

let bytes = 0;
for (const b of targets) {
  const res = await fetch(b.url, { cache: "no-store" });
  if (!res.ok) { console.error(`✗ ${b.pathname}: HTTP ${res.status}`); process.exitCode = 1; continue; }
  const body = Buffer.from(await res.arrayBuffer());
  const dest = join(outRoot, b.pathname);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
  bytes += body.length;
}

writeFileSync(join(outRoot, "MANIFEST.json"), JSON.stringify({
  backedUpAt: new Date().toISOString(),
  blobCount: targets.length,
  totalBytes: bytes,
  skippedSessions: skipped.length,
  pathnames: targets.map(b => b.pathname).sort(),
}, null, 2));

console.log(`✓ ${targets.length} blobs (${(bytes / 1e6).toFixed(2)} MB) → ${outRoot}`);
console.log(`  skipped ${skipped.length} sessions/ blobs (ephemeral)`);
