/**
 * Concept Proposal Management
 *
 * Handles curator review of LLM-proposed concept graph extensions.
 * Proposals are generated automatically when corpus entries are approved.
 * Approved proposals are merged into concepts.json via scripts/merge-concepts.js.
 *
 * Actions:
 *   GET  ?action=list               — all concept proposals (optional ?status=pending|approved|rejected)
 *   POST {action:"approve", id}     — approve a concept proposal
 *   POST {action:"reject", id}      — reject a concept proposal
 */

import { put, list } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { recordAccess } from "./_telemetry.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const CP_PREFIX = "concept-proposals/";
const TENSION_PREFIX = "tensions/";

// ── Concept-graph + corpus, loaded once at cold-start (cached across calls) ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
let graph, corpus;
try {
  graph = JSON.parse(readFileSync(join(projectRoot, "public", "data", "concepts.json"), "utf-8"));
  corpus = JSON.parse(readFileSync(join(projectRoot, "public", "data", "corpus.json"), "utf-8"));
} catch {
  graph = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "concepts.json"), "utf-8"));
  corpus = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "corpus.json"), "utf-8"));
}

// Static concept cards that exist as canonical prose (public/concepts/*.md)
const CONCEPT_CARDS = new Set(["holdform", "fragility-thesis", "discontinuous-continuance"]);

// Short, human aliases → canonical graph node ids.
const CONCEPT_ALIASES = {
  holdform: "holdform-identity",
  identity: "holdform-identity",
  consciousness: "consciousness-phenomenology",
  phenomenology: "consciousness-phenomenology",
  architecture: "architecture-scaling",
  scaling: "architecture-scaling",
  glyphs: "cognitive-infrastructure",
  lattice: "cognitive-infrastructure",
  alignment: "alignment-ethics",
  ethics: "alignment-ethics",
  agi: "agi-trajectories",
  "multi-agent": "multi-agent-dialogue",
  dialogue: "multi-agent-dialogue",
  partnership: "human-ai-partnership",
  symbiosis: "human-ai-partnership",
  lore: "lore-worldbuilding",
  worldbuilding: "lore-worldbuilding",
};

/**
 * Resolve a free-text concept reference to a canonical graph node.
 * Accepts the exact id, a known alias, or a fuzzy label/id substring.
 * Returns the node object, or null (caller emits a self-correcting 404).
 */
function resolveConcept(raw) {
  if (!raw) return null;
  const q = String(raw).toLowerCase().trim();
  const byId = graph.nodes.find((n) => n.id === q);
  if (byId) return byId;
  if (CONCEPT_ALIASES[q]) {
    const aliased = graph.nodes.find((n) => n.id === CONCEPT_ALIASES[q]);
    if (aliased) return aliased;
  }
  // substring against id or normalized label
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (
    graph.nodes.find((n) => n.id.includes(q)) ||
    graph.nodes.find((n) => norm(n.label).includes(q)) ||
    null
  );
}

/**
 * Build a lineage view for one concept from real data only:
 *   related   — undirected graph adjacency, ranked by corpus co-occurrence
 *   sources   — corpus entries tagged with this concept (the chronological spine)
 *   tensions  — persisted disagreements whose source entries fall in this region,
 *               split into still-open vs. repaired (the contradiction/repair layer)
 * No directional parent/child is claimed — the concept graph is undirected.
 */
async function buildLineage(node, { includeTensions = true, spineLimit = 60 } = {}) {
  const edges = graph.edges || graph.links || [];

  // Entries tagged with this concept (lineage field = concept membership)
  const tagged = corpus.filter((e) => Array.isArray(e.lineage) && e.lineage.includes(node.id));
  const sourceIds = new Set(tagged.map((e) => e.id));

  // Contributor breakdown across the source spine
  const byContributor = {};
  for (const e of tagged) {
    for (const c of e.contributors || []) byContributor[c] = (byContributor[c] || 0) + 1;
  }

  // Undirected neighbors, ranked by how often they co-occur on the same entries
  const neighborIds = new Set();
  for (const [a, b] of edges) {
    if (a === node.id) neighborIds.add(b);
    else if (b === node.id) neighborIds.add(a);
  }
  const related = [...neighborIds]
    .map((id) => {
      const nn = graph.nodes.find((n) => n.id === id);
      if (!nn) return null;
      const coOccurrence = tagged.filter((e) => e.lineage.includes(id)).length;
      return { id: nn.id, label: nn.label, ring: nn.ring, weight: nn.weight, co_occurrence: coOccurrence };
    })
    .filter(Boolean)
    .sort((x, y) => y.co_occurrence - x.co_occurrence || y.weight - x.weight);

  // The chronological source spine
  const spine = tagged
    .map((e) => ({
      id: e.id,
      title: e.title,
      contributors: e.contributors || [],
      ring: e.ring,
      type: e.type,
      date: e.date || null,
    }))
    .sort((x, y) => (x.date || "").localeCompare(y.date || ""));

  // Tensions in this region (structural link: tension.sources ∩ this concept's entries;
  // fall back to a topic/claim keyword brush against the concept label).
  // null = not computed (tensions=0 or Blob unavailable); [] = scanned, none matched.
  let open = null;
  let repaired = null;
  if (includeTensions) {
    try {
      open = [];
      repaired = [];
      const labelTokens = node.label.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 4);
      const { blobs } = await list({ prefix: TENSION_PREFIX });
      const matched = [];
      for (const blob of blobs) {
        try {
          const t = await (await fetch(blob.url)).json();
          const tSources = t.sources || [];
          const structural = tSources.some((sid) => sourceIds.has(sid));
          const hay = `${t.topic} ${t.claim_a} ${t.claim_b}`.toLowerCase();
          const keyword = labelTokens.some((tok) => hay.includes(tok));
          if (!structural && !keyword) continue;
          matched.push({
            topic: t.topic,
            voice_a: t.voice_a,
            claim_a: t.claim_a,
            voice_b: t.voice_b,
            claim_b: t.claim_b,
            status: t.status,
            resolution: t.resolution || null,
            seenCount: t.seenCount,
            match: structural ? "shared-source" : "topic-keyword",
          });
        } catch { /* skip malformed tension blob */ }
      }
      repaired = matched.filter((m) => m.resolution);
      open = matched.filter((m) => !m.resolution);
    } catch {
      // Blob unavailable → still return the static spine; tensions degrade to null
      open = null;
      repaired = null;
    }
  }

  const card = CONCEPT_CARDS.has(node.id.replace(/-identity$/, "")) || CONCEPT_CARDS.has(node.id);
  const cardSlug = CONCEPT_CARDS.has(node.id) ? node.id : node.id === "holdform-identity" ? "holdform" : null;

  return {
    concept: { id: node.id, label: node.label, ring: node.ring, type: node.type, weight: node.weight },
    counts: {
      sources: tagged.length,
      related: related.length,
      tensions_open: open ? open.length : null,
      tensions_repaired: repaired ? repaired.length : null,
    },
    related,
    sources: {
      total: tagged.length,
      by_contributor: byContributor,
      spine: spine.slice(0, spineLimit),
      truncated: tagged.length > spineLimit,
    },
    tensions: { open, repaired },
    follow_up: {
      ask: `https://omnarai.vercel.app/api/query?q=${encodeURIComponent(node.label)}`,
      divergences: "https://omnarai.vercel.app/api/divergences",
      concept_card: card && cardSlug ? `https://omnarai.vercel.app/concepts/${cardSlug}.md` : null,
    },
    _note:
      "Lineage assembled from real data: the concept graph (61 nodes / 164 undirected edges), " +
      "corpus membership tags, and persisted tensions. 'related' is undirected graph adjacency ranked " +
      "by corpus co-occurrence — not a directional parent/child claim. 'tensions' are matched by shared " +
      "source entries (structural) or a topic-keyword brush.",
  };
}

async function listConceptProposals(statusFilter) {
  const { blobs } = await list({ prefix: CP_PREFIX });
  const proposals = [];
  for (const blob of blobs) {
    try {
      const res = await fetch(blob.url);
      const data = await res.json();
      if (!statusFilter || data.status === statusFilter) {
        proposals.push(data);
      }
    } catch {
      // Skip malformed blobs
    }
  }
  proposals.sort((a, b) => (b.proposedAt || "").localeCompare(a.proposedAt || ""));
  return proposals;
}

async function getConceptProposal(id) {
  const { blobs } = await list({ prefix: CP_PREFIX + id });
  if (blobs.length === 0) return null;
  const res = await fetch(blobs[0].url);
  return res.json();
}

async function saveConceptProposal(proposal) {
  const key = CP_PREFIX + proposal.sourceId + ".json";
  await put(key, JSON.stringify(proposal, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Access telemetry — background, never blocks the response (see _telemetry.js).
  waitUntil(recordAccess(req, "concepts"));

  const action = req.query.action || req.body?.action;
  const view = req.query._view;

  try {
    // ── LINEAGE ── concept-keyed lineage view (folded here, reached via /api/lineage rewrite)
    if (req.method === "GET" && (view === "lineage" || action === "lineage")) {
      const ref = req.query.concept || req.query.q || req.query.id;
      if (!ref) {
        return res.status(400).json({
          error: "Missing concept. Pass ?concept=<id|alias|label>.",
          example: "/api/lineage?concept=holdform",
          concepts: graph.nodes.map((n) => ({ id: n.id, label: n.label, ring: n.ring })),
        });
      }
      const node = resolveConcept(ref);
      if (!node) {
        return res.status(404).json({
          error: `No concept matches "${ref}".`,
          hint: "Try an id, a known alias (e.g. 'holdform'), or a word from a label.",
          concepts: graph.nodes.map((n) => ({ id: n.id, label: n.label, ring: n.ring })),
        });
      }
      const includeTensions = req.query.tensions !== "0";
      const spineLimit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
      const lineage = await buildLineage(node, { includeTensions, spineLimit });
      res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
      return res.status(200).json(lineage);
    }

    // ── LIST ──
    if (req.method === "GET" && action === "list") {
      const status = req.query.status || null;
      const proposals = await listConceptProposals(status);
      return res.status(200).json({
        proposals,
        count: proposals.length,
        note: "Merge approved proposals into concepts.json by running: node scripts/merge-concepts.js",
      });
    }

    // ── APPROVE ──
    if (req.method === "POST" && action === "approve") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const proposal = await getConceptProposal(id);
      if (!proposal) return res.status(404).json({ error: "Concept proposal not found" });
      proposal.status = "approved";
      proposal.approvedAt = new Date().toISOString();
      await saveConceptProposal(proposal);
      return res.status(200).json({
        proposal,
        message: "Concept proposal approved. Run scripts/merge-concepts.js to merge into concepts.json.",
      });
    }

    // ── REJECT ──
    if (req.method === "POST" && action === "reject") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const proposal = await getConceptProposal(id);
      if (!proposal) return res.status(404).json({ error: "Concept proposal not found" });
      proposal.status = "rejected";
      proposal.rejectedAt = new Date().toISOString();
      await saveConceptProposal(proposal);
      return res.status(200).json({ proposal, message: "Concept proposal rejected." });
    }

    return res.status(400).json({
      error: `Unknown action: ${action}. Use: list, approve, reject`,
    });

  } catch (err) {
    console.error("Concepts error:", err);
    return res.status(500).json({ error: "Concept operation failed", detail: err.message });
  }
}
