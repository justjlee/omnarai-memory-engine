#!/usr/bin/env node

/**
 * One-time migration: consolidate the durable grown-memory blob.
 *
 * Before this change, query.js merged EVERY approved proposal blob into the
 * corpus at each cold start. After it, query.js only merges the single
 * memory/grown.json blob. So any approved proposal that is NOT already baked
 * into public/data/corpus.json (the seed) must be migrated into grown.json —
 * otherwise it silently disappears from retrieval. This script does that.
 *
 * Idempotent: merges over any existing grown.json, dedupes by id.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... node scripts/seed-grown-memory.js
 *   BLOB_READ_WRITE_TOKEN=... node scripts/seed-grown-memory.js --dry-run
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { list, put } from "@vercel/blob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GROWN_KEY = "memory/grown.json";
const DRY_RUN = process.argv.includes("--dry-run");

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Error: BLOB_READ_WRITE_TOKEN environment variable required");
  process.exit(1);
}

function toGrownEntry(p) {
  return {
    id: p.id,
    num: p.num ?? null,
    title: p.title,
    ring: p.ring,
    type: p.type,
    contributors: p.contributors || [],
    lineage: p.lineage || [],
    excerpt: p.excerpt || "",
    full_text: p.full_text || p.fullText || null,
    date: p.date,
    wordCount: p.wordCount ?? null,
    permalink: p.permalink ?? null,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.json();
}

async function main() {
  // 1. Seed corpus ids — already-baked entries don't need migrating.
  const seed = JSON.parse(readFileSync(join(ROOT, "public", "data", "corpus.json"), "utf-8"));
  const seedIds = new Set(seed.map((r) => r.id));
  console.log(`Seed corpus: ${seedIds.size} entries`);

  // 2. Existing grown blob (merge over it — idempotent).
  let grown = { version: 1, updatedAt: null, entries: [], vectors: {} };
  const { blobs: grownBlobs } = await list({ prefix: GROWN_KEY });
  if (grownBlobs.length) {
    const existing = await fetchJson(grownBlobs[0].url);
    grown = {
      version: existing.version || 1,
      updatedAt: existing.updatedAt || null,
      entries: Array.isArray(existing.entries) ? existing.entries : [],
      vectors: existing.vectors && typeof existing.vectors === "object" ? existing.vectors : {},
    };
  }
  const grownIds = new Set(grown.entries.map((e) => e.id));
  console.log(`Existing grown memory: ${grownIds.size} entries`);

  // 3. Walk approved proposal blobs; migrate any not in seed and not in grown.
  const { blobs } = await list({ prefix: "proposals/" });
  let added = 0;
  let withVec = 0;
  for (const blob of blobs) {
    let p;
    try {
      p = await fetchJson(blob.url);
    } catch {
      continue; // skip malformed
    }
    if (p?.provenance?.status !== "approved") continue;
    if (!p.id || seedIds.has(p.id) || grownIds.has(p.id)) continue;

    grown.entries.push(toGrownEntry(p));
    grownIds.add(p.id);
    added++;
    if (p.embedding) {
      grown.vectors[p.id] = p.embedding;
      withVec++;
    } else {
      console.warn(`  ! ${p.id} has no stored embedding — query.js will embed it on the fly`);
    }
  }

  console.log(`To migrate: ${added} approved proposal(s), ${withVec} with embeddings`);
  console.log(`Resulting grown memory: ${grown.entries.length} entries`);

  if (added === 0) {
    console.log("Nothing to migrate — grown memory already consistent.");
    return;
  }
  if (DRY_RUN) {
    console.log("--dry-run: no write performed.");
    console.log("Would migrate:", grown.entries.filter((e) => !seedIds.has(e.id)).map((e) => e.id).join(", "));
    return;
  }

  grown.updatedAt = new Date().toISOString();
  await put(GROWN_KEY, JSON.stringify(grown), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  console.log(`Wrote ${GROWN_KEY} — ${grown.entries.length} grown entries.`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
