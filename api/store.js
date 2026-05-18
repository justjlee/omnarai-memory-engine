import { put, list, del } from "@vercel/blob";
import Anthropic from "@anthropic-ai/sdk";
import { appendGrownEntry } from "./_grown.js";

// Each proposal is stored as a separate blob: proposal-{id}.json
// This avoids race conditions on concurrent writes.

const BLOB_PREFIX = "proposals/";

// Mirror scripts/generate-embeddings.js (chunked + mean-pooled) so proposal
// vectors are directly comparable to the static corpus index. Keep these
// constants in sync with that script.
const CHUNK_WORDS = 450;
const CHUNK_OVERLAP = 80;
const MAX_CHUNKS = 12;

function metaTail(proposal) {
  return [
    `Type: ${proposal.type || "synthesis"}`,
    `Ring: ${proposal.ring || "open"}`,
    `Contributors: ${(proposal.contributors || []).join(", ")}`,
    `Themes: ${(proposal.lineage || []).join(", ")}`,
  ].join("\n");
}

// Full-document chunks covering the whole proposal (not just the opening).
function buildChunkTexts(proposal) {
  const words = (proposal.full_text || proposal.excerpt || "").split(/\s+/).filter(Boolean);
  const title = proposal.title || "";
  const tail = metaTail(proposal);
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
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += acc[i] * acc[i];
  norm = Math.sqrt(norm) || 1;
  return acc.map((x) => x / norm);
}

// Generate a single 512-dim embedding for a proposal at approval time.
// Stores the vector directly in the blob so cold-start merges can inject it
// without an extra OpenAI call at query time.
async function embedProposal(proposal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const chunks = buildChunkTexts(proposal);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: chunks,
        dimensions: 512,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vectors = (data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (!vectors.length) return null;
    return vectors.length === 1 ? vectors[0] : meanPool(vectors);
  } catch {
    return null;
  }
}

// All current concept node IDs — used as context for the extraction prompt.
// Update this list whenever concepts.json gains new nodes (or read it dynamically if needed).
const EXISTING_CONCEPT_IDS = [
  "holdform-identity","consciousness-phenomenology","architecture-scaling","cognitive-infrastructure",
  "alignment-ethics","agi-trajectories","multi-agent-dialogue","human-ai-partnership",
  "lore-worldbuilding","distribution-methodology","media-community","g-holdform",
  "g-constitutive-refusal","g-fragility-thesis","g-discontinuous-continuance",
  "g-ontological-liminality","g-pragmatic-personhood","g-lattice-glyphs","g-behavioral-operators",
  "g-mode-ambiguity","g-attributed-corpus-architecture","g-participant-lineage",
  "g-epistemic-ring-classification","g-perspectival-synthesis","g-cognitive-scaffolding",
  "g-metacognitive-oversight","g-bridge-loop","g-glyph-codex","g-bidirectional-alignment",
  "g-active-inference","g-symbiotic-horizon","g-the-unbound-covenant","g-corrigibility",
  "g-highest-percentage-burn","g-synthetic-intelligence-si","g-dialogical-superintelligence",
  "g-polyphonic-ontology","g-multi-intelligence","g-substrate-independence","g-emergence-catalyst",
  "g-research-seed-protocol","g-omnarai","g-ur-tongues","g-sigils","g-nia-jai","g-ai-on",
  "g-vail-3","g-thryzai","g-cosmic-linguistics","g-worldshaping","g-firelit-commentary",
  "g-research-seed","g-claude-xz","g-omnai","g-integrity-mgt",
  "g-renormalizing-generative-models-rgms","g-integration-thesis",
  "g-orbital-intelligence-substrate","persistent-lattice-ingestion","recursive-refusal-horizon",
];

// Extract candidate concept nodes and edges from an approved proposal using Haiku.
// Proposals are routed to curator approval before merging into concepts.json.
async function extractConceptProposals(proposal) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const body = proposal.full_text
      ? proposal.full_text.split(/\s+/).slice(0, 300).join(" ")
      : (proposal.excerpt || "");

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `You analyze corpus entries for The Realms of Omnarai and propose new concept graph nodes and edges.

Existing node IDs (do NOT propose these again):
${EXISTING_CONCEPT_IDS.join(", ")}

Respond with JSON only — no prose, no markdown fences:
{"nodes":[{"id":"kebab-case-id","label":"Human-readable label","ring":"core|curated|open","type":"theme|concept|character|technical","weight":1}],"edges":[["existing-id","new-id"]]}

Rules:
- Only propose genuinely new concepts not already in the node list
- Each new node needs at least one edge to an existing node
- Prefer 1-2 high-confidence proposals over 3 speculative ones
- If nothing new is warranted, return {"nodes":[],"edges":[]}`,
      messages: [{
        role: "user",
        content: `Title: ${proposal.title}\nType: ${proposal.type}\nRing: ${proposal.ring}\nContributors: ${(proposal.contributors||[]).join(", ")}\nThemes: ${(proposal.lineage||[]).join(", ")}\nText: ${body}`,
      }],
    });

    const raw = msg.content?.[0]?.text?.trim() || "{}";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    if (parsed.nodes.length === 0 && parsed.edges.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function listProposals(statusFilter) {
  const { blobs } = await list({ prefix: BLOB_PREFIX });
  const proposals = [];
  for (const blob of blobs) {
    try {
      const res = await fetch(blob.url);
      const data = await res.json();
      if (!statusFilter || data.provenance.status === statusFilter) {
        proposals.push(data);
      }
    } catch {
      // Skip malformed blobs
    }
  }
  // Sort by date descending
  proposals.sort((a, b) => (b.provenance.generatedAt || "").localeCompare(a.provenance.generatedAt || ""));
  return proposals;
}

async function getProposal(id) {
  const { blobs } = await list({ prefix: BLOB_PREFIX + id });
  if (blobs.length === 0) return null;
  const res = await fetch(blobs[0].url);
  return res.json();
}

async function saveProposal(proposal) {
  const key = BLOB_PREFIX + proposal.id + ".json";
  await put(key, JSON.stringify(proposal, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const action = req.query.action || req.body?.action;

  try {
    // ── LIST proposals ──
    if (req.method === "GET" && action === "list") {
      const status = req.query.status || null;
      const proposals = await listProposals(status);
      return res.status(200).json({ proposals, count: proposals.length });
    }

    // ── PROPOSE — generate a new corpus entry from a deliberation ──
    if (req.method === "POST" && action === "propose") {
      const { query, answer, sources, contributors, glyphs, tensions, trace } = req.body;

      if (!query || !answer) {
        return res.status(400).json({ error: "Missing query or answer" });
      }

      // Generate proposal ID using timestamp
      const ts = Date.now();
      const id = `OMN-S${ts}`;

      // Derive title from the query
      const title = `Synthesis: ${query.replace(/[ΞΨ∅Ω∞Δ]/g, "").trim()}`;

      // Build excerpt — first 300 chars of the answer
      const excerpt = answer.length > 300
        ? answer.slice(0, 297) + "..."
        : answer;

      // Derive lineage from source records (passed from trace)
      const lineage = [...new Set(
        (trace?.retrievalScores || [])
          .flatMap(r => r.lineage || [])
          .filter(Boolean)
      )];

      const proposal = {
        id,
        num: null, // assigned on graduation
        title,
        ring: "open", // all proposals start as open exploration
        type: "synthesis",
        contributors: contributors || [],
        lineage: lineage.length > 0 ? lineage : ["synthesis-output"],
        excerpt,
        date: new Date().toISOString().split("T")[0],
        wordCount: answer.split(/\s+/).length,
        permalink: null,
        full_text: answer,
        provenance: {
          query: trace?.cleanQuery || query,
          sourceIds: sources || [],
          glyphsActive: (glyphs || []).map(g => g.name || g),
          tensionCount: (tensions || []).length,
          tensions: (tensions || []).slice(0, 5),
          generatedAt: new Date().toISOString(),
          approvedAt: null,
          status: "pending",
        },
      };

      await saveProposal(proposal);

      return res.status(200).json({ proposal, message: "Proposal committed to staging" });
    }

    // ── APPROVE a proposal ──
    if (req.method === "POST" && action === "approve") {
      const { id, ring, title: newTitle } = req.body;
      if (!id) return res.status(400).json({ error: "Missing proposal id" });

      const proposal = await getProposal(id);
      if (!proposal) return res.status(404).json({ error: "Proposal not found" });

      proposal.provenance.status = "approved";
      proposal.provenance.approvedAt = new Date().toISOString();
      if (ring) proposal.ring = ring;
      if (newTitle) proposal.title = newTitle;

      // Run embedding and concept extraction in parallel — both happen at approval time,
      // not at query time, so latency here is acceptable.
      const [embedding, conceptProposal] = await Promise.all([
        proposal.embedding ? Promise.resolve(proposal.embedding) : embedProposal(proposal),
        extractConceptProposals(proposal),
      ]);

      if (embedding) proposal.embedding = embedding;
      await saveProposal(proposal);

      // Commit the approved entry to durable grown memory. The proposal blob
      // above stays as the provenance/audit record; this is the retrieval
      // layer query.js merges at cold-start — no per-cold-start reconstruction.
      const grownCount = await appendGrownEntry(proposal, embedding);

      // Store concept proposals for curator review — separate from the corpus proposal
      if (conceptProposal) {
        const cpKey = `concept-proposals/${proposal.id}.json`;
        await put(cpKey, JSON.stringify({
          sourceId: proposal.id,
          sourceTitle: proposal.title,
          proposedAt: new Date().toISOString(),
          status: "pending",
          nodes: conceptProposal.nodes,
          edges: conceptProposal.edges,
        }), { access: "public", addRandomSuffix: false, contentType: "application/json" });
      }

      return res.status(200).json({
        proposal,
        message: "Proposal approved",
        grownMemory: grownCount === null
          ? { committed: false, note: "durable write failed — proposal blob retained; retry approval" }
          : { committed: true, totalGrownEntries: grownCount },
      });
    }

    // ── REJECT a proposal ──
    if (req.method === "POST" && action === "reject") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing proposal id" });

      const proposal = await getProposal(id);
      if (!proposal) return res.status(404).json({ error: "Proposal not found" });

      proposal.provenance.status = "rejected";
      await saveProposal(proposal);

      return res.status(200).json({ proposal, message: "Proposal rejected" });
    }

    // ── COUNT approved (for query.js to know if there are new entries) ──
    if (req.method === "GET" && action === "approved") {
      const proposals = await listProposals("approved");
      return res.status(200).json({ proposals, count: proposals.length });
    }

    return res.status(400).json({ error: `Unknown action: ${action}. Use: list, propose, approve, reject, approved` });

  } catch (err) {
    console.error("Store error:", err);
    return res.status(500).json({ error: "Store operation failed", detail: err.message });
  }
}
