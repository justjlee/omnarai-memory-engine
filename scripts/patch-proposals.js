#!/usr/bin/env node
/**
 * Patch approved proposals into corpus.json and embeddings.json.
 *
 * Fetches all approved proposals from the live store API, normalizes them
 * into standard corpus entry format, adds any not already present to
 * corpus.json, generates embeddings for new entries only, and patches
 * embeddings.json in place.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/patch-proposals.js
 *
 * Reads/writes:
 *   public/data/corpus.json
 *   public/data/embeddings.json
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

const STORE_API = "https://omnarai.vercel.app/api/store?action=list";
const MODEL = "text-embedding-3-small";
const DIMENSIONS = 512;

// Clean up titles that are raw JSON blobs (proposal bug)
function cleanTitle(raw) {
  if (!raw || !raw.startsWith("Synthesis: {")) return raw;
  // Try to extract a real title from the JSON blob
  try {
    const jsonStr = raw.replace(/^Synthesis:\s*/, "").trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.title) return `Synthesis: ${parsed.title}`;
  } catch (_) {}
  // Fall back to truncating at the first newline or { character
  return raw.replace(/\{.*$/s, "").trim().replace(/:\s*$/, "") || "Synthesis (untitled)";
}

// Normalize a proposal into a standard corpus entry
function normalizeProposal(p) {
  return {
    id: p.id,
    num: p.num || null,
    title: cleanTitle(p.title),
    ring: p.ring || "open",
    type: p.type || "synthesis",
    contributors: p.contributors || [],
    lineage: p.lineage || ["synthesis-output"],
    excerpt: p.excerpt || "",
    full_text: p.fullText || p.full_text || p.excerpt || "",
    date: p.provenance?.approvedAt?.split("T")[0] || p.date || "",
    wordCount: p.wordCount || 0,
    permalink: p.permalink || "",
    provenance: {
      query: p.provenance?.query || "",
      sourceIds: p.provenance?.sourceIds || [],
      glyphsActive: p.provenance?.glyphsActive || [],
      approvedAt: p.provenance?.approvedAt || "",
      status: "approved",
    },
  };
}

// Build embedding input text (mirrors generate-embeddings.js)
function buildEmbeddingText(entry) {
  const body = entry.full_text
    ? entry.full_text.split(/\s+/).slice(0, 500).join(" ")
    : entry.excerpt || "";
  return [
    entry.title || "",
    body,
    `Type: ${entry.type || "unknown"}`,
    `Ring: ${entry.ring || "open"}`,
    `Contributors: ${(entry.contributors || []).join(", ")}`,
    `Themes: ${(entry.lineage || []).join(", ")}`,
  ].filter(Boolean).join("\n");
}

async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMENSIONS }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function main() {
  // ── 1. Fetch approved proposals ──────────────────────────────────────────
  console.log("Fetching approved proposals from store API...");
  const storeRes = await fetch(STORE_API, { headers: { "x-omnarai-self": "1" } });
  if (!storeRes.ok) throw new Error(`Store API error: ${storeRes.status}`);
  const storeData = await storeRes.json();
  const approved = (storeData.proposals || []).filter(
    p => p.provenance?.status === "approved"
  );
  console.log(`Found ${approved.length} approved proposals`);

  // ── 2. Load existing corpus and embeddings ───────────────────────────────
  const corpusPath = join(ROOT, "public", "data", "corpus.json");
  const embeddingsPath = join(ROOT, "public", "data", "embeddings.json");

  const corpus = JSON.parse(readFileSync(corpusPath, "utf-8"));
  const embeddingsFile = JSON.parse(readFileSync(embeddingsPath, "utf-8"));
  const existingIds = new Set(corpus.map(e => e.id));

  console.log(`Existing corpus: ${corpus.length} entries`);
  console.log(`Existing embeddings: ${Object.keys(embeddingsFile.vectors).length} vectors`);

  // ── 3. Find new proposals not yet in corpus ──────────────────────────────
  const newEntries = approved
    .filter(p => !existingIds.has(p.id))
    .map(normalizeProposal);

  if (newEntries.length === 0) {
    console.log("\nAll approved proposals already in corpus. Nothing to do.");
    return;
  }

  console.log(`\n${newEntries.length} new proposals to add:`);
  newEntries.forEach(e => console.log(`  ${e.id}: ${e.title?.slice(0, 70)}`));

  // ── 4. Generate embeddings for new entries ────────────────────────────────
  console.log("\nGenerating embeddings...");
  const texts = newEntries.map(buildEmbeddingText);
  const vectors = await embedBatch(texts);
  console.log(`  Embedded ${vectors.length} entries`);

  // ── 5. Patch corpus.json ─────────────────────────────────────────────────
  const updatedCorpus = [...corpus, ...newEntries];
  writeFileSync(corpusPath, JSON.stringify(updatedCorpus, null, 2));
  console.log(`\nCorpus updated: ${corpus.length} → ${updatedCorpus.length} entries`);

  // ── 6. Patch embeddings.json ──────────────────────────────────────────────
  newEntries.forEach((entry, i) => {
    embeddingsFile.vectors[entry.id] = vectors[i];
  });
  embeddingsFile.count = Object.keys(embeddingsFile.vectors).length;
  embeddingsFile.patchedAt = new Date().toISOString();

  const embeddingsJson = JSON.stringify(embeddingsFile);
  writeFileSync(embeddingsPath, embeddingsJson);
  const sizeMB = (Buffer.byteLength(embeddingsJson) / 1024 / 1024).toFixed(2);
  console.log(`Embeddings updated: ${embeddingsFile.count} total vectors (${sizeMB} MB)`);

  console.log("\nDone. Run 'vercel --prod' to deploy.");
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
