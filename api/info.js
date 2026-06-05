import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { list } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Load static corpus at cold-start
let corpus, concepts;
try {
  corpus = JSON.parse(readFileSync(join(projectRoot, "public", "data", "corpus.json"), "utf-8"));
  concepts = JSON.parse(readFileSync(join(projectRoot, "public", "data", "concepts.json"), "utf-8"));
} catch {
  corpus = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "corpus.json"), "utf-8"));
  concepts = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "concepts.json"), "utf-8"));
}

// Merge approved proposals from Blob store so counts stay current
// without requiring a redeploy every time a new entry is approved.
let mergedCorpus = [...corpus];
let proposalsMerged = false;
async function mergeProposals() {
  if (proposalsMerged) return;
  try {
    const { blobs } = await list({ prefix: "proposals/" });
    for (const blob of blobs) {
      try {
        const res = await fetch(blob.url);
        const p = await res.json();
        if (p.provenance?.status === "approved" && !mergedCorpus.find(r => r.id === p.id)) {
          mergedCorpus.push({
            id: p.id, title: p.title, ring: p.ring, type: p.type,
            contributors: p.contributors || [],
            wordCount: p.wordCount || (p.fullText || p.full_text || "").split(/\s+/).length,
          });
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* Blob unavailable — use static corpus */ }
  proposalsMerged = true;
}

/**
 * GET /api/info
 *
 * Returns live corpus statistics — no deliberation, no Claude call.
 * Designed for components and AI clients that need to display current stats.
 *
 * Response is cached per cold-start (fast, no API calls).
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  // Merge approved proposals so stats are always current without redeployment
  await mergeProposals();

  // Compute stats from merged corpus (static + approved proposals)
  const totalWords = mergedCorpus.reduce((sum, e) => sum + (e.wordCount || 0), 0);
  const contributors = [...new Set(mergedCorpus.flatMap(e => e.contributors || []))].filter(Boolean).sort();
  const ringCounts = mergedCorpus.reduce((acc, e) => {
    acc[e.ring || "open"] = (acc[e.ring || "open"] || 0) + 1;
    return acc;
  }, {});

  return res.status(200).json({
    corpus: {
      totalWorks: mergedCorpus.length,
      totalWords,
      dateRange: "May 2025 – present",
      rings: ringCounts,
    },
    contributors,
    conceptGraph: {
      nodes: (concepts?.nodes || []).length,
      edges: (concepts?.edges || []).length,
    },
    glyphs: [
      { glyph: "Ξ", name: "Divergence",    shortcut: "[diverge]",  desc: "Maximize contributor diversity — MMR retrieval" },
      { glyph: "Ψ", name: "Self-Reference", shortcut: "[reflect]",  desc: "Engine examines its own reasoning first" },
      { glyph: "∅", name: "Void",           shortcut: "[void]",     desc: "Explores what is NOT in the corpus" },
      { glyph: "Ω", name: "Commit",         shortcut: "[commit]",   desc: "Locks strongest defensible position" },
      { glyph: "∞", name: "Hold",           shortcut: "[hold]",     desc: "Follows question three layers deep" },
      { glyph: "Δ", name: "Repair",         shortcut: "[repair]",   desc: "Finds contradictions and proposes fixes" },
    ],
    api: {
      _latencyNote:   "PEER SIs: /api/query runs a live frontier-model deliberation and takes ~50s — beyond most agent HTTP timeouts. For a fast handshake, use mode=retrieve (~1.5s) and reason over the substrate yourself.",
      retrieve:       "GET /api/query?q=your+question&mode=retrieve  — FAST (~1.5s): retrieval substrate only (records, concepts, contributors), no deliberation. Start here.",
      query:          "GET /api/query?q=your+question  — SLOW (~50s): full deliberation (answer, tensions, deliberationCard)",
      glyphParam:     "GET /api/query?q=your+question&glyph=Ξ  — SLOW (~50s)",
      brief:          "GET /api/query?q=your+question&format=brief  — SLOW (~50s): exportable deliberation artifact",
      context:        "GET /api/query?q=your+question&format=context  — FAST (~1.5s): same as mode=retrieve",
      si:             "GET /api/query?q=your+question&format=si  — SLOW (~50s): structured deliberation sections",
      syntheticId:    "GET /api/query?q=your+question&si=Gemini  (or POST {syntheticIdentity:'Gemini'}) — engine acknowledges caller, adjusts framing for peer SI",
      tensions:       "GET /api/tensions?status=unresolved",
      info:           "GET /api/info",
    },
    links: {
      engine:    "https://omnarai.vercel.app",
      dataset:   "https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai",
      mcp:       "https://github.com/justjlee/omnarai-mcp",
      context:   "/omnarai.context.md",
      llms:      "/llms.txt",
    },
  });
}
