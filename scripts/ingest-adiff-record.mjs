// ingest-adiff-record.mjs — add OMN-R-ADIFF to the corpus, surgically (Work Item C).
//
// Idempotent. Touches ONLY the new record:
//   - appends the full record to public/data/corpus.json      (engine retrieval source)
//   - appends the stripped record (no full_text) to src/data/corpus.json  (frontend list)
//   - embeds ONLY this record with the SAME chunk+mean-pool+L2 recipe as
//     scripts/generate-embeddings.js and appends its vector to
//     public/data/embeddings.json — every existing vector is left byte-for-byte untouched
//     (no full re-embed, so no risk of shifting the rest of the corpus's retrieval).
//
//   node scripts/ingest-adiff-record.mjs         # writes
//   node scripts/ingest-adiff-record.mjs --check  # report state, write nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
// load OPENAI_API_KEY from .env.local (same convention as the other scripts)
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) { let v = m[2].trim(); if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1); process.env[m[1]] = v; }
}

const MODEL = "text-embedding-3-small", DIMENSIONS = 512, CHUNK_WORDS = 450;
const rj = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const wj = (p, o) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(o) + "\n");

const rec = rj("analysis/adiff-corpus-record.json");
const ID = rec.id;

// metaTail + chunk text — copied verbatim from generate-embeddings.js so the vector matches.
const metaTail = (e) => [`Type: ${e.type || "unknown"}`, `Ring: ${e.ring || "open"}`, `Contributors: ${(e.contributors || []).join(", ")}`, `Themes: ${(e.lineage || []).join(", ")}`].join("\n");
function chunkText(e) {
  const words = (e.full_text || e.excerpt || "").split(/\s+/).filter(Boolean);
  if (words.length > CHUNK_WORDS) throw new Error(`record is ${words.length} words > ${CHUNK_WORDS}; this surgical script only handles single-chunk records — use generate-embeddings.js`);
  return [e.title || "", words.join(" "), metaTail(e)].filter(Boolean).join("\n");
}
function l2(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); }
async function embedOne(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, input: [text], dimensions: DIMENSIONS }) });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return l2((await res.json()).data[0].embedding);
}

const corpus = rj("public/data/corpus.json");
const src = rj("src/data/corpus.json");
const emb = rj("public/data/embeddings.json");
const inCorpus = corpus.some((e) => e.id === ID);
const inSrc = src.some((e) => e.id === ID);
const inEmb = ID in emb.vectors;
console.log(`state: corpus=${inCorpus ? "present" : "absent"} src=${inSrc ? "present" : "absent"} embeddings=${inEmb ? "present" : "absent"}  (corpus n=${corpus.length}, src n=${src.length}, vectors n=${Object.keys(emb.vectors).length})`);
if (CHECK) process.exit(0);
if (inCorpus && inSrc && inEmb) { console.log("already ingested — nothing to do."); process.exit(0); }

if (!inCorpus) { corpus.push(rec); wj("public/data/corpus.json", corpus); console.log(`+ public/data/corpus.json (n=${corpus.length})`); }
if (!inSrc) { const { full_text, ...stripped } = rec; src.push(stripped); wj("src/data/corpus.json", src); console.log(`+ src/data/corpus.json (n=${src.length})`); }
if (!inEmb) {
  const vec = await embedOne(chunkText(rec));
  if (vec.length !== DIMENSIONS) throw new Error(`unexpected dim ${vec.length}`);
  emb.vectors[ID] = vec;
  emb.count = Object.keys(emb.vectors).length;
  wj("public/data/embeddings.json", emb);
  console.log(`+ public/data/embeddings.json vector[${ID}] dim=${vec.length} (count now ${emb.count})`);
}
console.log("done.");
