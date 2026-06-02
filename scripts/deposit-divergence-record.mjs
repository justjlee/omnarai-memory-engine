#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Deposit the assembled Divergence Record as a PENDING proposal in the live
// pipeline. Mirrors api/store.js exactly: same chunked-meanpool 512-dim
// embedding (so the vector is comparable to the corpus index and reused at
// approval), same proposal blob shape (so it lists + approves through the
// existing UI). Writes ONE pending proposal blob. Publishes NOTHING — the entry
// only enters the corpus when the curator approves it in the Proposals tab.
// ─────────────────────────────────────────────────────────────────────────────

import { put, list } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

// ── Embedding (identical params to api/store.js) ──
const CHUNK_WORDS = 450, CHUNK_OVERLAP = 80, MAX_CHUNKS = 12;
const metaTail = (p) => [
  `Type: ${p.type || "synthesis"}`, `Ring: ${p.ring || "open"}`,
  `Contributors: ${(p.contributors || []).join(", ")}`, `Themes: ${(p.lineage || []).join(", ")}`,
].join("\n");
function buildChunkTexts(p) {
  const words = (p.full_text || p.excerpt || "").split(/\s+/).filter(Boolean);
  const title = p.title || "", tail = metaTail(p);
  if (words.length <= CHUNK_WORDS) return [[title, words.join(" "), tail].filter(Boolean).join("\n")];
  const chunks = [], step = CHUNK_WORDS - CHUNK_OVERLAP;
  for (let s = 0; s < words.length && chunks.length < MAX_CHUNKS; s += step)
    chunks.push([title, words.slice(s, s + CHUNK_WORDS).join(" "), tail].filter(Boolean).join("\n"));
  return chunks;
}
function meanPool(vecs) {
  const dim = vecs[0].length, acc = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) acc[i] += v[i];
  for (let i = 0; i < dim; i++) acc[i] /= vecs.length;
  let n = 0; for (let i = 0; i < dim; i++) n += acc[i] * acc[i]; n = Math.sqrt(n) || 1;
  return acc.map((x) => x / n);
}
async function embed(p) {
  const chunks = buildChunkTexts(p);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: chunks, dimensions: 512 }),
  });
  if (!res.ok) throw new Error(`embedding failed: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const vecs = (data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  return vecs.length === 1 ? vecs[0] : meanPool(vecs);
}

// ── Load the draft, shape it as a pending proposal (mirrors store.js fields) ──
const draft = JSON.parse(readFileSync(join(__dirname, "divergence-pilot-runs", "divergence-record-DRAFT.json"), "utf8"));
const ts = Date.now();
const id = `OMN-D${ts}`;            // D = divergence record (vs OMN-S synthesis)

console.log(`Embedding record (${draft.wordCount} words, chunked-meanpool 512-dim)…`);
const embedding = await embed(draft);
console.log(`  ✓ embedding ready (${embedding.length} dims, ${buildChunkTexts(draft).length} chunk(s))`);

const proposal = {
  id,
  num: null,
  title: draft.title,
  ring: draft.ring,
  type: draft.type,                  // "divergence" — preserved through approve → corpus
  contributors: draft.contributors,
  lineage: draft.lineage,
  excerpt: draft.excerpt,
  date: draft.date,
  wordCount: draft.wordCount,
  permalink: null,
  full_text: draft.full_text,
  embedding,                         // pre-computed; approve reuses it (no re-embed)
  provenance: {
    ...draft.provenance,
    sourceIds: [],                   // present for frontend/compat
    glyphsActive: [],
    generatedAt: new Date().toISOString(),
    approvedAt: null,
    status: "pending",
  },
};

await put(`proposals/${id}.json`, JSON.stringify(proposal, null, 2), {
  access: "public", addRandomSuffix: false, contentType: "application/json",
});
console.log(`\n✓ Pending proposal written: proposals/${id}.json`);

// Confirm it lists
const { blobs } = await list({ prefix: `proposals/${id}` });
console.log(`✓ Confirmed in store: ${blobs.length ? blobs[0].pathname : "NOT FOUND"}`);
console.log(`\nProposal id: ${id}  (status: pending — awaiting curator approval)`);
