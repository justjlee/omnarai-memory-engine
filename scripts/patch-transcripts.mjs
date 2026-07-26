#!/usr/bin/env node
// patch-transcripts.mjs — merge fetched ASR transcripts (.transcripts-cache.json) into the
// media-ring records of public/data/corpus.json, so "the transcripts are part of the corpus"
// is literally true. Sets full_text (=transcript, so the engine embeds + deliberates on it),
// transcript, and flips recovery_status "uncertain" → "auto-caption" with honest provenance.
//
//   node scripts/patch-transcripts.mjs [--apply]   (dry-run without --apply)
// After --apply: re-run generate-embeddings.js so the transcripts become semantically retrievable.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const CORPUS_PATH = join(ROOT, "public", "data", "corpus.json");
const CACHE_PATH = process.env.TRANSCRIPT_CACHE || join(ROOT, "scripts", ".transcripts-cache.json");

const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
const emb = JSON.parse(readFileSync(join(ROOT, "public", "data", "embeddings.json"), "utf8"));
const vectorIds = new Set(Object.keys(emb.vectors || {}));

const media = corpus.filter((e) => String(e.ring || "").toLowerCase() === "media" || e.type === "video");
let patched = 0, noCache = 0, alreadyEmbedded = 0, willBecomeSearchable = 0;
let totalChars = 0;

for (const e of media) {
  const c = cache[e.video_id];
  if (!c || !c.ok || !c.text) { noCache++; continue; }
  if (vectorIds.has(e.id)) alreadyEmbedded++; else willBecomeSearchable++;
  totalChars += c.text.length;
  if (APPLY) {
    e.transcript = c.text;
    e.full_text = c.text;              // engine embeds + passes full_text to Claude
    e.recovery_status = "auto-caption"; // was "uncertain"; honest: YouTube ASR, not a human transcript
    e.transcript_source = "youtube-asr";
    e.transcript_chars = c.text.length;
    e.last_modified = new Date().toISOString();
  }
  patched++;
}

console.log(`media records:            ${media.length}`);
console.log(`transcripts in cache:     ${patched}`);
console.log(`missing from cache:       ${noCache}`);
console.log(`avg transcript length:    ${patched ? Math.round(totalChars / patched) : 0} chars`);
console.log(`already in embeddings:    ${alreadyEmbedded}`);
console.log(`newly searchable (re-embed adds/updates): ${willBecomeSearchable + alreadyEmbedded}`);
if (APPLY) {
  writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2));
  console.log(`\n✅ APPLIED to ${CORPUS_PATH}`);
  console.log(`   NEXT: OPENAI_API_KEY=... node scripts/generate-embeddings.js   (re-embed so transcripts are retrievable)`);
} else {
  console.log(`\n(dry run — pass --apply to write)`);
}
