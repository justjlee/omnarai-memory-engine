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
    const res = await fetch(blobs[0].url, { cache: "no-store" });
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

// Append one approved entry (and its embedding, if available) to durable grown
// memory. Idempotent by entry id. Returns the new total grown-entry count, or
// null if the write failed (caller decides whether that is fatal).
export async function appendGrownEntry(entry, embedding) {
  if (!entry?.id) return null;
  const grown = await loadGrownMemory();

  if (!grown.entries.find((e) => e.id === entry.id)) {
    const newEntry = {
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
    // Divergence records carry structured, verbatim cross-model data. Preserve it
    // here (appendGrownEntry otherwise drops provenance) so /api/divergences can
    // serve the raw artifact — the five positions + tension map — not just prose.
    if (entry.type === "divergence" && entry.provenance) {
      newEntry.divergence = {
        question: entry.provenance.question,
        method: entry.provenance.method,
        answers: entry.provenance.answers || [],
        tensions: entry.provenance.tensions || [],
      };
    }
    grown.entries.push(newEntry);
  }
  if (embedding) grown.vectors[entry.id] = embedding;
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
