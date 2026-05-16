import { put, list } from "@vercel/blob";

/**
 * POST /api/ingest
 *
 * Ingests a new corpus entry directly — no redeploy required.
 * The entry is stored as an approved proposal in Vercel Blob and immediately
 * picked up by api/query.js (mergeApprovedProposals) and api/info.js.
 * On-the-fly embedding in api/query.js handles retrieval until
 * embeddings.json is regenerated.
 *
 * Body:
 * {
 *   title:        string  (required)
 *   full_text:    string  (required — the post body)
 *   ring:         "core" | "curated" | "open"  (default: "curated")
 *   type:         string  (default: "post")
 *   contributors: string[]  (default: ["xz"])
 *   lineage:      string[]  (tags — optional)
 *   date:         "YYYY-MM-DD"  (default: today)
 *   permalink:    string  (Reddit URL — optional)
 *   secret:       string  (must match INGEST_SECRET env var)
 * }
 *
 * Returns: { id, title, ring, message }
 *
 * Security: guarded by INGEST_SECRET environment variable.
 * Set this in Vercel dashboard — without it, all requests are rejected.
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "Ingest endpoint not configured — set INGEST_SECRET in Vercel env" });
  }
  if (req.body?.secret?.trim() !== secret.trim()) {
    return res.status(401).json({ error: "Unauthorized — wrong or missing secret" });
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  const {
    title,
    full_text,
    ring = "curated",
    type = "post",
    contributors = ["xz"],
    lineage = [],
    date = new Date().toISOString().split("T")[0],
    permalink = null,
    excerpt: excerptOverride = null,
  } = req.body || {};

  if (!title || !full_text) {
    return res.status(400).json({ error: "Missing required fields: title, full_text" });
  }

  if (!["core", "curated", "open"].includes(ring)) {
    return res.status(400).json({ error: "ring must be: core | curated | open" });
  }

  // ── Build entry ───────────────────────────────────────────────────────────
  const id = `OMN-S${Date.now()}`;
  const words = full_text.trim().split(/\s+/);
  const wordCount = words.length;
  const excerpt = excerptOverride || words.slice(0, 80).join(" ") + (wordCount > 80 ? "…" : "");

  const entry = {
    id,
    num: null,
    title: title.trim(),
    ring,
    type,
    contributors: Array.isArray(contributors) ? contributors : [contributors],
    lineage: Array.isArray(lineage) ? lineage : [lineage].filter(Boolean),
    excerpt,
    date,
    wordCount,
    permalink,
    fullText: full_text.trim(),
    provenance: {
      query: `Ingested via /api/ingest — ${title.trim()}`,
      sourceIds: [],
      glyphsActive: [],
      tensionCount: 0,
      tensions: [],
      generatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      status: "approved",    // bypass proposal queue — ingest is pre-approved
      ingestedAt: new Date().toISOString(),
    },
  };

  // ── Check for duplicates (by title) ──────────────────────────────────────
  try {
    const { blobs } = await list({ prefix: "proposals/" });
    for (const blob of blobs) {
      try {
        const existing = await (await fetch(blob.url)).json();
        if (existing.title?.toLowerCase() === title.trim().toLowerCase()) {
          return res.status(409).json({
            error: "Duplicate title — entry with this title already exists",
            existing_id: existing.id,
          });
        }
      } catch { /* skip */ }
    }
  } catch { /* skip duplicate check if Blob unavailable */ }

  // ── Store in Blob ─────────────────────────────────────────────────────────
  try {
    await put(`proposals/${id}.json`, JSON.stringify(entry, null, 2), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to store entry", detail: err.message });
  }

  return res.status(200).json({
    id,
    title: entry.title,
    ring: entry.ring,
    wordCount,
    date,
    message: `Entry stored as ${id}. Immediately retrievable via /api/query. Run scripts/generate-embeddings.js to add to embeddings.json for optimal retrieval.`,
    note: "On-the-fly embedding active — entry is searchable now, pre-computed embedding improves retrieval quality.",
  });
}
