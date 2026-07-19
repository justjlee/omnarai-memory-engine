// ── Visitor question proposals ────────────────────────────────────────────────
// A council run ALREADY produces everything a divergence record needs — the same
// buildDivergenceRecord() the longitudinal cron uses. Until now an anonymous
// visitor's run was built, rendered, and discarded: five frontier calls of real
// spend, thrown away. This module catches the good ones.
//
// WHAT IS SCORED, AND WHAT ISN'T.
// The B11 quality instrument (scripts/score-question-quality.mjs) scores four
// axes, but three of them — axis_stability, intra_model_stability,
// irreducibility_yield — read a tier-3 certification block or a B5 cross-
// prediction run. Neither exists for a question asked ninety seconds ago, and
// manufacturing them would cost ~6 more council calls per paraphrase. So exactly
// ONE axis is measured here: position_spread, the mean pairwise cosine distance
// between the verbatim answers we already paid for. Everything else stays null.
// A null is an honest "untested", never a 0 — the same discipline the offline
// scorer holds to.
//
// Spread is also the RIGHT single axis for this gate: the Atlas keeps questions
// that SPLIT frontier models. A question they all answer the same way is a fine
// question and a bad Atlas record.
//
// THE THRESHOLD IS CALIBRATED, NOT GUESSED.
// Derived from the 102 records in atlas/data/atlas-v1.0.0.jsonl that carry a
// stored divergence_score (2026-07-19). The bar is the Atlas median: a proposal
// is admitted when it splits the panel at least as hard as a typical record
// already in the Atlas. That makes the gate self-referential in the honest
// direction — it asks "does this belong among these?" rather than asserting an
// absolute number nobody calibrated.
//
// RECALIBRATION: as the Atlas grows, recompute from the jsonl and update
// ATLAS_SPREAD_DECILES. The deciles are stored (not just the median) so a
// proposal can be told its PERCENTILE, which is far more informative to a
// visitor than a bare pass/fail.

import { list, put } from "@vercel/blob";


const PENDING_PREFIX = "question-proposals/";
const DECLINED_PREFIX = "question-declined/";
const RUNS_PREFIX = "council-runs/";

// p0..p100 in steps of 10, from 102 scored Atlas records (2026-07-19).
export const ATLAS_SPREAD_DECILES = [
  0.0970, 0.1601, 0.1768, 0.1860, 0.1997, 0.2123, 0.2263, 0.2452, 0.2628, 0.3087, 0.3812,
];
export const ATLAS_SPREAD_MEDIAN = ATLAS_SPREAD_DECILES[5]; // 0.2123
export const SPREAD_BASIS = {
  source: "atlas/data/atlas-v1.0.0.jsonl",
  scored_records: 102,
  computed: "2026-07-19",
  metric: "mean pairwise cosine distance between verbatim answers (text-embedding-3-small, 512d, L2-normalized)",
};

export function spreadThreshold() {
  const n = parseFloat(process.env.QUESTION_SPREAD_THRESHOLD || "");
  return Number.isFinite(n) && n > 0 ? n : ATLAS_SPREAD_MEDIAN;
}

// Where a spread falls against the existing Atlas, 0–100. Linear within decile.
export function spreadPercentile(spread) {
  if (typeof spread !== "number" || !Number.isFinite(spread)) return null;
  const d = ATLAS_SPREAD_DECILES;
  if (spread <= d[0]) return 0;
  if (spread >= d[d.length - 1]) return 100;
  for (let i = 1; i < d.length; i++) {
    if (spread <= d[i]) {
      const lo = d[i - 1], hi = d[i];
      const within = hi > lo ? (spread - lo) / (hi - lo) : 0;
      return Math.round(((i - 1) + within) * 10);
    }
  }
  return null;
}

// MUST mirror scripts/run-atlas-bank.mjs:27-48 exactly — that is the pipeline
// that produced every divergence_score in the distribution this gate calibrates
// against. Two things matter and both were gotten wrong first time round:
//
//   · RAW text, not clamped. api/_council.js's embedOne() runs input through
//     clampWords(), which collapses newlines and repeated spaces. That shifts
//     the embedding, and on a heavily formatted answer it moved the measured
//     spread by ~0.013 — enough to flip an admit/decline decision at a threshold
//     of 0.2123. A number that isn't computed the same way as the distribution
//     it is compared against is not a measurement, it's a coincidence.
//   · Batched in ONE request with dimensions:512, same as the canonical call.
//
// Verified against stored scores by scripts/test-question-scoring.mjs.
const EMBED_ENDPOINT = "https://api.openai.com/v1/embeddings";
const SPREAD_DIMS = 512;

async function embedRaw(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !texts.length) return [];
  const res = await fetch(EMBED_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: SPREAD_DIMS }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function cos(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * Mean pairwise cosine DISTANCE across the panel's verbatim answers —
 * identical in value to the canonical `1 - meanPairwiseCos(vecs)`.
 * Returns { spread, answers_scored } — spread null when it cannot be measured
 * (fewer than two answers, or no embedding key), never a fabricated 0.
 */
export async function scoreSpread(answers = []) {
  const texts = answers.map((a) => (a?.text || "")).filter((t) => t.trim());
  if (texts.length < 2) return { spread: null, answers_scored: texts.length, reason: "need at least two answers" };

  const vecs = (await embedRaw(texts)).filter((v) => Array.isArray(v) && v.length);
  if (vecs.length < 2) return { spread: null, answers_scored: vecs.length, reason: "embeddings unavailable" };

  let s = 0, n = 0;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) { s += cos(vecs[i], vecs[j]); n++; }
  }
  return { spread: n ? 1 - s / n : null, answers_scored: vecs.length, reason: null };
}

/**
 * Full proposal assessment. `record` is the council result (question + answers).
 * Returns the scorecard that is stored on the proposal AND shown to the visitor —
 * same numbers to both, no private score.
 */
export async function assessQuestion({ question, answers }) {
  const { spread, answers_scored, reason } = await scoreSpread(answers);
  const threshold = spreadThreshold();
  const percentile = spreadPercentile(spread);
  // Unmeasurable spread is NOT a rejection — it is an unknown, and an unknown
  // goes to the curator rather than being thrown away on our own outage.
  const meets_bar = spread == null ? null : spread >= threshold;
  return {
    position_spread: spread,
    answers_scored,
    unmeasured_reason: reason,
    atlas_percentile: percentile,
    threshold,
    meets_bar,
    // Everything the offline B11 instrument measures that a fresh question
    // cannot yet support. Null = untested, never 0.
    axis_stability: null,
    intra_model_stability: null,
    irreducibility_yield: null,
    discrimination: null,
    basis: SPREAD_BASIS,
    note:
      "Only position_spread is measured at proposal time — the other axes need a " +
      "tier-3 certification or a cross-prediction run, which cost further council " +
      "calls and happen after admission, not before. Null means untested, not zero.",
  };
}

// ── Storage ──────────────────────────────────────────────────────────────────
// Per-entry blobs, never a consolidated array: Vercel Blob has no CAS, and a
// stale-read full-overwrite silently drops concurrent entries (see _grown.js and
// the contributions namespace, which learned this the expensive way).

function proposalKey(id, declined) {
  return `${declined ? DECLINED_PREFIX : PENDING_PREFIX}${id}.json`;
}

export async function saveQuestionProposal(p, { declined = false } = {}) {
  await put(proposalKey(p.id, declined), JSON.stringify(p), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return p;
}

export async function loadQuestionProposals({ declined = false } = {}) {
  const { blobs } = await list({ prefix: declined ? DECLINED_PREFIX : PENDING_PREFIX });
  const out = await Promise.all(
    blobs.map(async (b) => {
      try {
        // Cache-bust: Blob reads are CDN-fronted and a just-written status change
        // can otherwise read back stale.
        const r = await fetch(`${b.url}?t=${Date.now()}`);
        return r.ok ? await r.json() : null;
      } catch { return null; }
    })
  );
  return out.filter(Boolean);
}

export async function loadQuestionProposal(id) {
  for (const declined of [false, true]) {
    const { blobs } = await list({ prefix: proposalKey(id, declined) });
    if (blobs.length) {
      try {
        const r = await fetch(`${blobs[0].url}?t=${Date.now()}`);
        if (r.ok) return await r.json();
      } catch { /* fall through */ }
    }
  }
  return null;
}

// ── Council run cache ────────────────────────────────────────────────────────
// INTEGRITY, not convenience. A proposal must never carry answers supplied by
// the client: the Atlas's entire claim is that its answers are what the models
// ACTUALLY said, and accepting a client-provided panel would let anyone inject
// fabricated "verbatim" text into the review queue — where a plausible forgery
// is exactly the thing least likely to be caught by eye. So a completed run is
// cached server-side and the proposal references it by id. The client supplies a
// pointer, never content.
//
// Side benefit: proposing costs zero additional frontier calls.

export async function saveCouncilRun(run) {
  await put(`${RUNS_PREFIX}${run.run_id}.json`, JSON.stringify(run), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return run;
}

export async function loadCouncilRun(runId) {
  // Reject anything that could escape the namespace before it reaches storage.
  if (!/^OMN-R[A-Za-z0-9-]{1,40}$/.test(String(runId || ""))) return null;
  try {
    const { blobs } = await list({ prefix: `${RUNS_PREFIX}${runId}.json` });
    if (!blobs.length) return null;
    const r = await fetch(`${blobs[0].url}?t=${Date.now()}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export function buildCouncilRun({ question, answers, synthesis, visitorHash }) {
  return {
    run_id: `OMN-R${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    question,
    answers: answers.filter((a) => a.ok).map((a) => ({
      model: a.model, lab: a.lab, model_id: a.model_id, date: a.date, text: a.text,
    })),
    synthesis,
    visitor: visitorHash || null,
    at: new Date().toISOString(),
  };
}

/**
 * Build the stored proposal object. Keeps the ELICITED ANSWERS with it — the
 * council run is the expensive part and re-running it at approval time would
 * both cost again and produce different answers, quietly breaking the link
 * between what was reviewed and what gets published.
 */
export function buildQuestionProposal({ question, answers, synthesis, scorecard, proposer, visitorHash }) {
  return {
    id: `OMN-Q${Date.now()}`,
    status: scorecard.meets_bar === false ? "declined" : "pending",
    question,
    proposer: proposer || null, // self-declared, optional; never detected
    submittedAt: new Date().toISOString(),
    visitor: visitorHash || null, // salted hash only, same as telemetry
    scorecard,
    answers,     // verbatim panel, preserved for review and publication
    synthesis,   // narrative + tensions from the same run
    decidedAt: null,
    decidedNote: null,
    publishedAs: null, // OMN-D id once admitted to the Atlas
  };
}
