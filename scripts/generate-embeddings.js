#!/usr/bin/env node

/**
 * Generate embeddings for the Omnarai corpus.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/generate-embeddings.js
 *   OPENAI_API_KEY=sk-... node scripts/generate-embeddings.js --window   # legacy 500-word opening only
 *
 * Default: full-document chunked + mean-pooled embedding. Each document is split
 * into overlapping word-chunks; every chunk is embedded; the chunk vectors are
 * averaged and L2-normalized into one vector per document. This makes semantic
 * retrieval see a document's whole substance, not just its opening 500 words.
 *
 * Reads:  public/data/corpus.json
 * Writes: public/data/embeddings.json
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
const BATCH_SIZE = 50;   // OpenAI allows up to 2048 inputs per request

const LEGACY_WINDOW = process.argv.includes("--window");
const CHUNK_WORDS = 450;     // ~600 tokens — comfortably within model context
const CHUNK_OVERLAP = 80;    // preserve cross-chunk continuity
const MAX_CHUNKS = 12;       // cap very long docs (~5,000 words) to bound cost

// Metadata tail appended to every document's text (or each chunk in chunk mode).
function metaTail(entry) {
  return [
    `Type: ${entry.type || "unknown"}`,
    `Ring: ${entry.ring || "open"}`,
    `Contributors: ${(entry.contributors || []).join(", ")}`,
    `Themes: ${(entry.lineage || []).join(", ")}`,
  ].join("\n");
}

function bodyText(entry) {
  return entry.full_text || entry.content || entry.excerpt || "";
}

// Legacy: single text, opening 500 words only.
function buildWindowText(entry) {
  const words = bodyText(entry).split(/\s+/).filter(Boolean);
  const body = words.slice(0, 500).join(" ");
  return [entry.title || "", body, metaTail(entry)].filter(Boolean).join("\n");
}

// Chunked: array of texts covering the full document.
function buildChunkTexts(entry) {
  const words = bodyText(entry).split(/\s+/).filter(Boolean);
  const title = entry.title || "";
  const tail = metaTail(entry);
  if (words.length <= CHUNK_WORDS) {
    return [[title, words.join(" "), tail].filter(Boolean).join("\n")];
  }
  const chunks = [];
  const step = CHUNK_WORDS - CHUNK_OVERLAP;
  for (let start = 0; start < words.length && chunks.length < MAX_CHUNKS; start += step) {
    const slice = words.slice(start, start + CHUNK_WORDS).join(" ");
    chunks.push([title, slice, tail].filter(Boolean).join("\n"));
  }
  return chunks;
}

function meanPool(vectors) {
  const dim = vectors[0].length;
  const acc = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) acc[i] += v[i];
  for (let i = 0; i < dim; i++) acc[i] /= vectors.length;
  // L2-normalize so cosine similarity stays well-behaved.
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += acc[i] * acc[i];
  norm = Math.sqrt(norm) || 1;
  return acc.map((x) => x / norm);
}

async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMENSIONS }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function embedAll(allTexts) {
  const out = [];
  for (let i = 0; i < allTexts.length; i += BATCH_SIZE) {
    const batch = allTexts.slice(i, i + BATCH_SIZE);
    console.log(
      `  embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allTexts.length / BATCH_SIZE)} (${batch.length})...`
    );
    out.push(...(await embedBatch(batch)));
  }
  return out;
}

async function main() {
  const corpus = JSON.parse(
    readFileSync(join(ROOT, "public", "data", "corpus.json"), "utf-8")
  );
  console.log(`Loaded ${corpus.length} corpus entries`);
  console.log(LEGACY_WINDOW ? "Mode: legacy 500-word window" : "Mode: full-document chunked + mean-pooled");

  const embeddings = {};

  if (LEGACY_WINDOW) {
    const texts = corpus.map(buildWindowText);
    const vectors = await embedAll(texts);
    corpus.forEach((entry, i) => { embeddings[entry.id] = vectors[i]; });
  } else {
    // Flatten every chunk of every doc into one request stream, then regroup.
    const flat = [];
    const spans = []; // [start, count] into flat, per corpus entry
    for (const entry of corpus) {
      const chunks = buildChunkTexts(entry);
      spans.push([flat.length, chunks.length]);
      flat.push(...chunks);
    }
    console.log(`  ${flat.length} chunks across ${corpus.length} docs (avg ${(flat.length / corpus.length).toFixed(1)}/doc)`);
    const vectors = await embedAll(flat);
    corpus.forEach((entry, i) => {
      const [start, count] = spans[i];
      const docVecs = vectors.slice(start, start + count);
      embeddings[entry.id] = count === 1 ? docVecs[0] : meanPool(docVecs);
    });
  }

  const output = {
    model: MODEL,
    dimensions: DIMENSIONS,
    count: Object.keys(embeddings).length,
    strategy: LEGACY_WINDOW ? "window-500" : "chunked-meanpool",
    generatedAt: new Date().toISOString(),
    vectors: embeddings,
  };

  const json = JSON.stringify(output);
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  writeFileSync(join(ROOT, "public", "data", "embeddings.json"), json);

  console.log(`\nDone! ${Object.keys(embeddings).length} entries embedded`);
  console.log(`Model: ${MODEL}, Dimensions: ${DIMENSIONS}, Strategy: ${output.strategy}`);
  console.log(`File size: ${sizeMB} MB → public/data/embeddings.json`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
