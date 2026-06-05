import { put } from "@vercel/blob";

// ── Shared proposal helpers ───────────────────────────────────────────────────
// store.js builds proposals inline from a deliberation; this module builds the
// SAME shape from a drafted synthesis (e.g. tension repair). Keeping the shape
// identical means the existing store.js `approve` flow (embed → grown memory)
// handles repair-born proposals with no special-casing. We deliberately do NOT
// reach into store.js's inline builder — the proposal path shipped a broken
// bundle once, so the critical path stays untouched and this stays additive.

const BLOB_PREFIX = "proposals/";

// Build a PENDING proposal entry from a drafted synthesis. Mirrors the fields
// store.js produces (id, ring:"open", type:"synthesis", provenance.status:
// "pending", full_text, excerpt, wordCount, …) so api/store.js?action=approve
// can graduate it into durable grown memory unchanged.
export function buildSynthesisProposal({ title, full_text, contributors, lineage, provenance }) {
  const id = `OMN-S${Date.now()}`;
  const excerpt = full_text.length > 300 ? full_text.slice(0, 297) + "..." : full_text;
  return {
    id,
    num: null, // assigned on graduation
    title: title.startsWith("Synthesis:") ? title : `Synthesis: ${title}`,
    ring: "open", // all proposals start as open exploration
    type: "synthesis",
    contributors: contributors || [],
    lineage: lineage?.length ? lineage : ["tension-repair"],
    excerpt,
    date: new Date().toISOString().split("T")[0],
    wordCount: full_text.split(/\s+/).length,
    permalink: null,
    full_text,
    provenance: {
      ...(provenance || {}),
      generatedAt: new Date().toISOString(),
      approvedAt: null,
      status: "pending",
    },
  };
}

export async function saveProposal(proposal) {
  await put(BLOB_PREFIX + proposal.id + ".json", JSON.stringify(proposal, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}
