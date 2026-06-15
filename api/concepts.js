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

const CP_PREFIX = "concept-proposals/";

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

  try {
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
