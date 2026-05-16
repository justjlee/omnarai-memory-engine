import { put, list } from "@vercel/blob";

/**
 * Omnarai Tensions API
 *
 * Persists and serves unresolved tensions extracted from deliberations.
 * Each unique tension (by voice pair + topic) is stored once and updated
 * when seen again — same tension from multiple queries doesn't duplicate.
 *
 * GET /api/tensions              → list all tensions
 * GET /api/tensions?status=unresolved → only unresolved
 * GET /api/tensions?status=divergent  → only divergent
 * GET /api/tensions?q=keyword    → search by topic keyword
 * POST /api/tensions {action:"persist", tensions:[], query, sources} → store new tensions
 */

const BLOB_PREFIX = "tensions/";

// Stable key from a tension — deduplicates same tension across queries
export function tensionKey(t) {
  const voices = [t.voice_a, t.voice_b].sort().join("--");
  const topic = (t.topic || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${voices}__${topic}`.slice(0, 120);
}

async function listTensions(statusFilter, searchQuery) {
  const { blobs } = await list({ prefix: BLOB_PREFIX });
  const tensions = [];

  for (const blob of blobs) {
    try {
      const res = await fetch(blob.url);
      const t = await res.json();
      if (statusFilter && t.status !== statusFilter) continue;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = `${t.topic} ${t.voice_a} ${t.voice_b} ${t.claim_a} ${t.claim_b}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      tensions.push(t);
    } catch { /* skip malformed */ }
  }

  tensions.sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
  return tensions;
}

export async function persistTension(tension, query, sources) {
  const key = tensionKey(tension);
  const blobKey = BLOB_PREFIX + key + ".json";

  // Try to load existing — update seen count and queries
  let existing = null;
  try {
    const { blobs } = await list({ prefix: BLOB_PREFIX + key });
    if (blobs.length > 0) {
      const res = await fetch(blobs[0].url);
      existing = await res.json();
    }
  } catch { /* first time */ }

  const record = existing
    ? {
        ...existing,
        status: tension.status,        // status may have evolved
        claim_a: tension.claim_a,       // claims may be better articulated
        claim_b: tension.claim_b,
        seenCount: (existing.seenCount || 1) + 1,
        lastSeenAt: new Date().toISOString(),
        lastSeenQuery: query,
        queries: [...new Set([...(existing.queries || []), query])].slice(-10),
        sources: [...new Set([...(existing.sources || []), ...(sources || [])])].slice(-20),
      }
    : {
        key,
        voice_a: tension.voice_a,
        claim_a: tension.claim_a,
        voice_b: tension.voice_b,
        claim_b: tension.claim_b,
        topic: tension.topic,
        status: tension.status,
        seenCount: 1,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        lastSeenQuery: query,
        queries: [query],
        sources: sources || [],
      };

  await put(blobKey, JSON.stringify(record, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });

  return record;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET — list tensions ──────────────────────────────────────────────────
  if (req.method === "GET") {
    const status = req.query.status || null;
    const q = req.query.q || null;

    try {
      const tensions = await listTensions(status, q);
      return res.status(200).json({
        tensions,
        count: tensions.length,
        filter: { status, query: q },
        note: "Poll GET /api/tensions?status=unresolved for open cognitive gaps. POST {action:'persist'} to store new tensions.",
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to list tensions", detail: err.message });
    }
  }

  // ── POST — persist tensions from a deliberation ──────────────────────────
  if (req.method === "POST") {
    const { action, tensions, query, sources } = req.body || {};

    if (action !== "persist") {
      return res.status(400).json({ error: "Unknown action. Use: persist" });
    }

    if (!Array.isArray(tensions) || tensions.length === 0) {
      return res.status(200).json({ persisted: 0, message: "No tensions to persist" });
    }

    try {
      const results = await Promise.all(
        tensions
          .filter(t => t.voice_a && t.voice_b && t.topic)
          .map(t => persistTension(t, query || "", sources || []))
      );

      return res.status(200).json({
        persisted: results.length,
        tensions: results,
        message: `${results.length} tension${results.length !== 1 ? "s" : ""} stored`,
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to persist tensions", detail: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
