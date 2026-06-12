import { list, put } from "@vercel/blob";

// ── Durable grown-memory layer ────────────────────────────────────────────────
// The organism's growth — approved syntheses and their embeddings — lives here,
// in ONE consolidated Vercel Blob, not in the deploy artifact and not as N
// per-proposal blobs reconstructed on every cold start.
//
// The committed public/data/corpus.json + embeddings.json remain the immutable
// SEED (the 298+10 base works). This blob is the mutable DELTA on top of it.
// query.js loads the seed from disk (always available, fallback-safe) and merges
// this blob over it. If the blob store is unreachable, the seed still serves —
// the live site cannot break from a grown-memory failure.
//
// Single blob (not one-per-proposal) is deliberate: approvals are curator-gated
// and infrequent, so a read-modify-write on one object is safe. The old
// per-proposal scheme existed to avoid races on concurrent *proposal* writes —
// a different, high-frequency path. Growth is written only on *approve*.

const GROWN_KEY = "memory/grown.json";

function emptyGrown() {
  return { version: 1, updatedAt: null, entries: [], vectors: {} };
}

// Load the consolidated grown-memory blob. Never throws — returns an empty
// structure if the blob is absent or the store is unreachable.
export async function loadGrownMemory() {
  try {
    const { blobs } = await list({ prefix: GROWN_KEY });
    if (!blobs.length) return emptyGrown();
    // Cache-bust: the public Blob URL is served via CDN, which can return a STALE
    // copy for a short window after a put(). A unique query string forces a CDN
    // miss → origin read → the just-written content. Without this, even SERIAL
    // read-modify-write sequences silently lose updates (observed: 13/14 records
    // dropped in a rapid batch). Origin (Blob storage) is consistent post-put.
    const res = await fetch(`${blobs[0].url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return emptyGrown();
    const data = await res.json();
    return {
      version: data.version || 1,
      updatedAt: data.updatedAt || null,
      entries: Array.isArray(data.entries) ? data.entries : [],
      vectors: data.vectors && typeof data.vectors === "object" ? data.vectors : {},
    };
  } catch {
    return emptyGrown();
  }
}

// Build the stored shape for one entry: strip transient fields, and preserve the
// structured `divergence` block for divergence records. (Without this, provenance
// — the verbatim five positions + tension map — would be dropped, leaving
// /api/divergences only the prose.)
function normalizeEntry(entry) {
  const e = {
    id: entry.id,
    num: entry.num ?? null,
    title: entry.title,
    ring: entry.ring,
    type: entry.type,
    contributors: entry.contributors || [],
    lineage: entry.lineage || [],
    excerpt: entry.excerpt || "",
    full_text: entry.full_text || entry.fullText || null,
    date: entry.date,
    wordCount: entry.wordCount ?? null,
    permalink: entry.permalink ?? null,
  };
  if (entry.type === "divergence" && entry.provenance) {
    e.divergence = {
      question: entry.provenance.question,
      method: entry.provenance.method,
      answers: entry.provenance.answers || [],
      tensions: entry.provenance.tensions || [],
      deliberation_card: entry.provenance.deliberation_card || null,
      // Optional analytics (set by the bank runner): continuous answer-spread
      // score and a divergent/convergent label. Preserved when present.
      ...(entry.provenance.score != null ? { score: entry.provenance.score } : {}),
      ...(entry.provenance.label ? { label: entry.provenance.label } : {}),
      // Longitudinal cadence provenance (canon_id + epoch) — the cron's
      // idempotency key. Dropping this would let daily re-runs duplicate.
      ...(entry.provenance.longitudinal ? { longitudinal: entry.provenance.longitudinal } : {}),
    };
  }
  return e;
}

// Append MANY entries in a SINGLE load-modify-write. This is the concurrency-safe
// primitive: one read, one put, regardless of batch size. Any bulk or automated
// path MUST use this rather than calling appendGrownEntry in a loop — N separate
// writes will land inside Vercel Blob's read-after-write window and drop entries
// (observed). Idempotent by id. `items` = [{ entry, embedding }]. Returns the new
// total grown-entry count, or null if the write failed.
export async function appendGrownEntries(items) {
  const list_ = Array.isArray(items) ? items.filter((it) => it?.entry?.id) : [];
  if (!list_.length) return null;
  const grown = await loadGrownMemory();
  const have = new Set(grown.entries.map((e) => e.id));
  for (const { entry, embedding } of list_) {
    if (!have.has(entry.id)) {
      grown.entries.push(normalizeEntry(entry));
      have.add(entry.id);
    }
    if (embedding) grown.vectors[entry.id] = embedding;
  }
  grown.updatedAt = new Date().toISOString();

  try {
    await put(GROWN_KEY, JSON.stringify(grown), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    return grown.entries.length;
  } catch {
    return null;
  }
}

// Append one approved entry (and its embedding, if available) to durable grown
// memory. Thin wrapper over the batch primitive so single- and bulk-callers share
// one write path. Idempotent by id. Returns the new total grown-entry count, or
// null if the write failed (caller decides whether that is fatal). Safe for the
// infrequent curator-gated approval flow; for bulk use appendGrownEntries.
export async function appendGrownEntry(entry, embedding) {
  if (!entry?.id) return null;
  return appendGrownEntries([{ entry, embedding }]);
}
