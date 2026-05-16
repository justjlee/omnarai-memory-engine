#!/usr/bin/env node
/**
 * Merge approved concept proposals from Vercel Blob into concepts.json.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... node scripts/merge-concepts.js
 *
 * Reads:  Vercel Blob concept-proposals/*.json  (status === "approved")
 * Writes: public/data/concepts.json
 *
 * Run this after approving concept proposals via /api/concepts, then deploy.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { list } from "@vercel/blob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONCEPTS_PATH = join(ROOT, "public", "data", "concepts.json");

async function main() {
  const conceptsRaw = readFileSync(CONCEPTS_PATH, "utf-8");
  const concepts = JSON.parse(conceptsRaw);
  const existingIds = new Set(concepts.nodes.map(n => n.id));

  console.log(`Loaded concepts.json: ${concepts.nodes.length} nodes, ${concepts.edges.length} edges`);

  // Fetch approved concept proposals from Vercel Blob
  const { blobs } = await list({ prefix: "concept-proposals/" });
  const approved = [];
  for (const blob of blobs) {
    try {
      const res = await fetch(blob.url);
      const data = await res.json();
      if (data.status === "approved") approved.push(data);
    } catch {
      console.warn(`  Skipping malformed blob: ${blob.url}`);
    }
  }

  console.log(`Found ${approved.length} approved concept proposal(s)`);

  if (approved.length === 0) {
    console.log("Nothing to merge.");
    return;
  }

  let nodesAdded = 0;
  let edgesAdded = 0;

  for (const proposal of approved) {
    console.log(`\nMerging from ${proposal.sourceId} ("${proposal.sourceTitle}"):`);

    for (const node of (proposal.nodes || [])) {
      if (existingIds.has(node.id)) {
        console.log(`  [skip] Node already exists: ${node.id}`);
        continue;
      }
      // Validate required fields
      if (!node.id || !node.label) {
        console.log(`  [skip] Invalid node (missing id or label): ${JSON.stringify(node)}`);
        continue;
      }
      concepts.nodes.push({
        id: node.id,
        label: node.label,
        ring: node.ring || "open",
        type: node.type || "concept",
        weight: node.weight || 1,
      });
      existingIds.add(node.id);
      nodesAdded++;
      console.log(`  [+] Node: ${node.id} — "${node.label}"`);
    }

    for (const edge of (proposal.edges || [])) {
      if (!Array.isArray(edge) || edge.length < 2) {
        console.log(`  [skip] Invalid edge format: ${JSON.stringify(edge)}`);
        continue;
      }
      const [a, b] = edge;
      // Only add edge if both endpoints exist
      if (!existingIds.has(a)) {
        console.log(`  [skip] Edge references unknown node: ${a}`);
        continue;
      }
      if (!existingIds.has(b)) {
        console.log(`  [skip] Edge references unknown node: ${b}`);
        continue;
      }
      // Check for duplicate
      const isDupe = concepts.edges.some(e =>
        Array.isArray(e)
          ? (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)
          : (e.source === a && e.target === b) || (e.source === b && e.target === a)
      );
      if (isDupe) {
        console.log(`  [skip] Edge already exists: ${a} ↔ ${b}`);
        continue;
      }
      concepts.edges.push([a, b]);
      edgesAdded++;
      console.log(`  [+] Edge: ${a} ↔ ${b}`);
    }
  }

  if (nodesAdded === 0 && edgesAdded === 0) {
    console.log("\nNo new nodes or edges to add (all already present or invalid).");
    return;
  }

  writeFileSync(CONCEPTS_PATH, JSON.stringify(concepts));
  console.log(`\nDone. Added ${nodesAdded} node(s) and ${edgesAdded} edge(s).`);
  console.log(`concepts.json: ${concepts.nodes.length} nodes, ${concepts.edges.length} edges`);
  console.log(`\nNext: vercel --prod`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
