#!/usr/bin/env node

/**
 * Generate embeddings for the Omnarai corpus.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/generate-embeddings.js
 *
 * Reads:  public/data/corpus.json
 * Writes: public/data/embeddings.json
 *         src/data/embeddings.json  (copy for Vite bundling)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable required");
  process.exit(1);
}

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 512; // Reduced from 1536 — still excellent quality, ~3x smaller file
const BATCH_SIZE = 50;  // OpenAI allows up to 2048 inputs per request

// Load corpus
const corpus = JSON.parse(readFileSync(join(ROOT, "public", "data", "corpus.json"), "utf-8"));
console.log(`Loaded ${corpus.length} corpus entries`);

// Build embedding input text for each entry
// Uses full_text (first 500 words) when available, falls back to content (video transcripts), then excerpt
function buildEmbeddingText(entry) {
  const body = entry.full_text
    ? entry.full_text.split(/\s+/).slice(0, 500).join(" ")
    : (entry.content || entry.excerpt || "");
  const parts = [
    entry.title || "",
    body,
    `Type: ${entry.type || "unknown"}`,
    `Ring: ${entry.ring || "open"}`,
    `Contributors: ${(entry.contributors || []).join(", ")}`,
    `Themes: ${(entry.lineage || []).join(", ")}`,
  ];
  return parts.filter(Boolean).join("\n");
}

// Call OpenAI embeddings API
async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      dimensions: DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  // Sort by index to maintain order
  return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function main() {
  const embeddings = {};
  const texts = corpus.map(buildEmbeddingText);
  let totalTokens = 0;

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchIds = corpus.slice(i, i + BATCH_SIZE).map(r => r.id);

    console.log(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} (${batch.length} entries)...`);

    const vectors = await embedBatch(batch);

    vectors.forEach((vec, j) => {
      embeddings[batchIds[j]] = vec;
    });
  }

  // Write output
  const output = {
    model: MODEL,
    dimensions: DIMENSIONS,
    count: Object.keys(embeddings).length,
    generatedAt: new Date().toISOString(),
    vectors: embeddings,
  };

  const json = JSON.stringify(output);
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);

  // Write to public/ only (read by API at runtime, not bundled into frontend)
  writeFileSync(join(ROOT, "public", "data", "embeddings.json"), json);

  console.log(`\nDone! ${Object.keys(embeddings).length} entries embedded`);
  console.log(`Model: ${MODEL}, Dimensions: ${DIMENSIONS}`);
  console.log(`File size: ${sizeMB} MB`);
  console.log(`Written to: public/data/embeddings.json`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
