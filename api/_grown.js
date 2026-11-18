import { list, put, BlobPreconditionFailedError } from "@vercel/blob";

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
// Single blob (not one-per-proposal) is deliberate. Every write is a
// read-modify-write of the whole file, made safe by a CONDITIONAL put: the write
// carries the ETag of the copy it read and is refused if the blob has changed
// since, then retried from a fresh read (see writeGrown). Before 2026-11-04 the
// put was unconditional, and a writer that read a stale or concurrently-updated
// copy silently erased the records written in between (2 of 5 elicit-002 records,
// 2026-11-03; 4 of 8 in a 2026-09-28 batch).

const GROWN_KEY = "memory/grown.json";

function emptyGrown() {
  return { version: 1, updatedAt: null, entries: [], vectors: {} };
}

// ── Ring normalization ────────────────────────────────────────────────────────
// The seed corpus uses lowercase ring TOKENS (core/curated/open/media); display
// labels ("Open Exploration") belong to the frontend's theme map. Early council
// records were written with the display label, so clients grouping by ring saw
// two buckets for the same ring (D5, DELTA.md 2026-07-16). Normalize at this
// choke point — every reader goes through loadGrownMemory, and every Blob
// writer is load-modify-write, so stored labels self-heal to tokens on the
// next write without a hot migration.
const RING_TOKENS = new Set(["core", "curated", "open", "media"]);
const RING_LABELS = {
  "core canon": "core",
  "curated expansions": "curated",
  "open exploration": "open",
};

export function normalizeRing(ring) {
  const lower = String(ring || "").trim().toLowerCase();
  if (RING_TOKENS.has(lower)) return lower;
  // Grown records are frontier material by definition — unknown/missing ring
  // degrades to "open" (same default the count surfaces already use).
  return RING_LABELS[lower] || "open";
}

// Load the consolidated grown-memory blob.
//
// Readers (default): never throws — returns an empty structure if the blob is
// absent or the store is unreachable, so the live site degrades to the seed.
//
// Writers MUST pass { strict: true }: every write is load-modify-write of the
// WHOLE file, so a failed read that silently returned "empty" would be written
// back as the entire grown memory — one new entry, every other record erased.
// Strict throws instead, and the writer aborts without calling put(). A missing
// blob is also an error in strict mode: the store was seeded 2026-06, so "no
// grown.json" now means a failed or inconsistent LIST, not a fresh store.
export async function loadGrownMemory({ strict = false } = {}) {
  return (await readGrown({ strict })).grown;
}

// The read behind loadGrownMemory, plus the ETag of the copy actually served.
// The ETag travels with the body: a lagging CDN edge serves an old body WITH its
// old ETag, so a conditional put based on it is refused rather than applied.
async function readGrown({ strict = false } = {}) {
  try {
    const { blobs } = await list({ prefix: GROWN_KEY });
    if (!blobs.length) {
      if (strict) throw new Error("grown.json not listed — refusing to treat the store as empty");
      return { grown: emptyGrown(), etag: null };
    }
    // Cache-bust: the public Blob URL is served via CDN, which can return a STALE
    // copy for a short window after a put(). A unique query string forces a CDN
    // miss → origin read → the just-written content. Without this, even SERIAL
    // read-modify-write sequences silently lose updates (observed: 13/14 records
    // dropped in a rapid batch). It is not sufficient on its own (serial writes
    // ~43s apart still read stale, 2026-09-28), which is why writers also put
    // conditionally on the ETag of what they read.
    const res = await fetch(`${blobs[0].url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      if (strict) throw new Error(`grown.json read failed: HTTP ${res.status}`);
      return { grown: emptyGrown(), etag: null };
    }
    const etag = res.headers.get("etag");
    const data = await res.json();
    if (strict && !Array.isArray(data.entries)) throw new Error("grown.json has no entries array");
    const entries = Array.isArray(data.entries) ? data.entries : [];
    for (const e of entries) e.ring = normalizeRing(e.ring);
    const grown = {
      version: data.version || 1,
      updatedAt: data.updatedAt || null,
      entries,
      vectors: data.vectors && typeof data.vectors === "object" ? data.vectors : {},
    };
    return { grown, etag };
  } catch (err) {
    if (strict) throw err;
    return { grown: emptyGrown(), etag: null };
  }
}

// The one write path for grown memory. `mutate(grown)` edits a fresh copy and
// returns { value, write }; `write: false` skips the put (nothing changed). The
// put is conditional on the ETag of that copy. If another writer got there first,
// or the read was stale, the put is refused and the whole read-mutate-put runs
// again on a fresh read, so a lost race costs a retry instead of records.
// Returns `value`, or null when the store is unreadable, carries no ETag, a put
// fails, or every attempt loses the race: in each case nothing is written.
const WRITE_ATTEMPTS = 6;

async function writeGrown(mutate) {
  const backoffMs = Number(process.env.GROWN_WRITE_BACKOFF_MS ?? 250);
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    let snap;
    try {
      snap = await readGrown({ strict: true });
    } catch {
      return null; // unreadable store: write nothing rather than write back "empty"
    }
    if (!snap.etag) return null; // can't write conditionally, so don't write at all
    const { value, write } = mutate(snap.grown);
    if (!write) return value;
    snap.grown.updatedAt = new Date().toISOString();
    try {
      await put(GROWN_KEY, JSON.stringify(snap.grown), {
        access: "public",
        addRandomSuffix: false,
        ifMatch: snap.etag,
        contentType: "application/json",
      });
      return value;
    } catch (err) {
      if (!(err instanceof BlobPreconditionFailedError)) return null;
      if (attempt < WRITE_ATTEMPTS) {
        // Jittered exponential backoff from 250 ms (about 8 s over all attempts,
        // inside the 60 s function limit), so racing writers don't collide again.
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1) * (0.5 + Math.random())));
      }
    }
  }
  return null;
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
    ring: normalizeRing(entry.ring),
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
      // Perturbation-certification block (set by patchGrownCertifications). Kept
      // here so a record created already-certified doesn't lose its tier.
      ...(entry.provenance.certification ? { certification: entry.provenance.certification } : {}),
      // Taxonomy bucket recorded at write time by batches outside the 82-question
      // bank. Without it the Atlas builder can only keyword-match the question and
      // drops such records into the "open" catch-all.
      ...(entry.provenance.cluster ? { cluster: entry.provenance.cluster } : {}),
      // Panel composition note for non-standard councils (e.g. a guest member on a
      // one-time batch). Load-bearing for honest reading: without it a 6-answer
      // record is indistinguishable from the standard 5-model panel.
      ...(entry.provenance.panel_note ? { panel_note: entry.provenance.panel_note } : {}),
      // Question provenance recorded AT CREATION (doctrine: never retrofitted,
      // never defaulted to "unrecorded"). Who authored the question, who curated
      // it, and — where the question was adapted from a source — the verbatim
      // original, so the transformation is auditable rather than silent.
      // Before 2026-09 this key was absent from the allowlist, which is why the
      // first 124 records carry no question provenance: it was being dropped on
      // write, not omitted by the batches.
      ...(entry.provenance.question_provenance ? { question_provenance: entry.provenance.question_provenance } : {}),
      // Inside/outside position recorded at creation rather than backfilled by a
      // later classifier. "inside" = the question implicates the answering panel;
      // "outside" = it does not. The registry's required_experiment for the
      // refuted lead claim needs this as a designed arm, not an inferred label.
      ...(entry.provenance.involvement_class ? { involvement_class: entry.provenance.involvement_class } : {}),
      // Cycle tag, so a designed batch can be read back as one unit.
      ...(entry.provenance.cycle ? { cycle: entry.provenance.cycle } : {}),
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
  return writeGrown((grown) => {
    const have = new Set(grown.entries.map((e) => e.id));
    for (const { entry, embedding } of list_) {
      if (!have.has(entry.id)) {
        grown.entries.push(normalizeEntry(entry));
        have.add(entry.id);
      }
      if (embedding) grown.vectors[entry.id] = embedding;
    }
    return { value: grown.entries.length, write: true };
  });
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

// Patch the `certification` block onto EXISTING divergence records in a SINGLE
// load-modify-write (same concurrency discipline as appendGrownEntries — never
// loop per-id). `certs` = { [id]: certificationObject }. Additive: only sets
// `entry.divergence.certification`; the verbatim answers and tension map are
// never touched. Returns the number of records updated, or null on write failure.
export async function patchGrownCertifications(certs) {
  const ids = certs && typeof certs === "object" ? Object.keys(certs) : [];
  if (!ids.length) return null;
  return writeGrown((grown) => {
    let updated = 0;
    for (const e of grown.entries) {
      if (e.type === "divergence" && e.divergence && certs[e.id]) {
        // Append-only discipline (2026-07-18): a re-certification must not erase
        // the evidence of what the instrument previously graded. The superseded
        // block (minus its own history, which is carried forward flat) moves into
        // the new block's `history[]`, oldest first — so any reader can see the
        // grade's full lineage, including demotions. Built from a copy, so a
        // retried attempt recomputes history from its own fresh read.
        const prior = e.divergence.certification;
        const next = { ...certs[e.id] };
        if (prior) {
          const { history: priorHistory, ...priorCompact } = prior;
          next.history = [...(priorHistory || []), priorCompact];
        }
        e.divergence.certification = next;
        updated++;
      }
    }
    return { value: updated, write: updated > 0 };
  });
}
