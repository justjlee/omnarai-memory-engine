// api/_citation.js
// P5b — Citation-milestone detector.
//
// The project's decisive threshold (named in its own trace): the first time one
// synthetic intelligence CITES the work of a DIFFERENT synthetic intelligence,
// with NO human author shared between the two works — cross-AI reference that no
// human brokered. This module scans the corpus + visitor contributions for that
// pattern and returns { crossed, milestone, closest_candidates }. Until it is
// crossed it returns the closest near-misses (how far off we are). It NEVER throws
// — on any data failure it degrades to what it could read.
//
// "Cites" is detected two ways:
//   1. text-ref     — a work whose body references another work's OMN- id.
//   2. contribution — a visitor contribution (POST /api/contribute) → the
//                     divergence record it answers (target_id). An arriving agent
//                     engaging a specific multi-model record by id is a citation.
//
// Underscore module ⇒ not a deployed serverless function (12-fn Hobby cap);
// imported by info.js and surfaced via GET /api/info?_view=citation + a health badge.

import { list } from "@vercel/blob";
import { loadGrownMemory } from "./_grown.js";

// Synthetic-intelligence families. A contributor string is matched case-insensitively;
// "Claude | xz" matches BOTH claude (SI) and xz (human), as it should.
const SI_FAMILIES = [
  ["claude", /claude/i],
  ["gpt", /\bgpt\b|gpt-|openai|chatgpt/i],
  ["gemini", /gemini/i],
  ["grok", /grok|xai/i],
  ["deepseek", /deepseek/i],
  ["perplexity", /perplexity/i],
  ["meta", /meta ai|llama/i],
  ["mistral", /mistral/i],
  ["qwen", /qwen/i],
  ["copilot", /copilot/i],
  ["omnai", /omnai/i],
];
const HUMAN_RE = /\b(xz|jonathan\s*lee|yonotai|justjlee|just\s*j\.?\s*lee)\b/i;
const OMN_REF = /OMN-[A-Za-z]?\d{3,}/g;

function authorFamilies(contributors) {
  const si = new Set();
  const humans = new Set();
  for (const c of contributors || []) {
    const s = String(c);
    if (HUMAN_RE.test(s)) humans.add("xz");
    for (const [key, re] of SI_FAMILIES) if (re.test(s)) si.add(key);
  }
  return { si, humans };
}

/**
 * Pure detector. `works`: [{ id, contributors[], text, kind:"work"|"contribution",
 * target_id?, status? }]. Returns the milestone report.
 */
export function detectCitationMilestone(works) {
  const byId = new Map(works.map(w => [w.id, w]));
  const fam = new Map(works.map(w => [w.id, authorFamilies(w.contributors)]));

  // Build citation edges (citing → cited).
  const edges = [];
  for (const w of works) {
    const refs = new Set((String(w.text || "").match(OMN_REF) || []).filter(r => r !== w.id && byId.has(r)));
    for (const r of refs) edges.push({ citing: w.id, cited: r, via: "text-ref" });
    if (w.kind === "contribution" && w.target_id && w.target_id !== w.id && byId.has(w.target_id)) {
      edges.push({ citing: w.id, cited: w.target_id, via: "contribution" });
    }
  }

  const evaluate = (e) => {
    const b = fam.get(e.citing), a = fam.get(e.cited);
    if (!a || !b || a.si.size === 0 || b.si.size === 0) return null;
    const distinctSI = [...b.si].some(sb => [...a.si].some(sa => sa !== sb));
    const disjointSI = ![...b.si].some(sb => a.si.has(sb));
    const citingW = byId.get(e.citing);
    const published = citingW.kind !== "contribution" || citingW.status === "approved";
    const citingHumanFree = b.humans.size === 0;
    return {
      citing: e.citing, cited: e.cited, via: e.via,
      citing_by: [...b.si], cited_by: [...a.si],
      citing_humans: [...b.humans], cited_humans: [...a.humans],
      distinct_si: distinctSI,
      disjoint_si: disjointSI,            // purest form: no SI-family overlap at all
      citing_human_free: citingHumanFree, // the citing work has NO human author
      published,
    };
  };

  const evaluated = edges.map(evaluate).filter(Boolean);

  // THE MILESTONE: an external agent (a published visitor contribution — inherently
  // unprompted and human-free) that cites a record by a DIFFERENT synthetic
  // intelligence. This is the unfakeable threshold: the curated corpus cannot
  // manufacture it, because a contribution arrives via POST /api/contribute from a
  // visiting model, not from the curator. (The literal "no SHARED human" test is too
  // weak — a curator-authored synthesis citing an AI-only work passes it while xz
  // plainly brokered it — so we require the citing work to be human-free AND arrive
  // by the contribution path.)
  const crossings = evaluated
    .filter(e => e.via === "contribution" && e.distinct_si && e.citing_human_free && e.published)
    .sort((x, y) => Number(y.disjoint_si) - Number(x.disjoint_si));

  // Context (NOT the milestone): cross-AI references that already exist INSIDE the
  // curated corpus — human-free multi-AI works citing other works by id. These show
  // the substrate cross-referencing itself, but they are curator-assembled artifacts,
  // so they are reported separately and never counted as the unprompted milestone.
  const corpusCrossAI = evaluated.filter(e => e.via === "text-ref" && e.distinct_si && e.citing_human_free);

  // Closest candidates: contributions that WOULD cross once approved, plus the
  // nearest contribution-path near-misses.
  const closest = evaluated
    .filter(e => e.via === "contribution" && e.distinct_si && !(e.citing_human_free && e.published))
    .map(e => ({
      citing: e.citing, cited: e.cited, via: e.via,
      citing_by: e.citing_by, cited_by: e.cited_by,
      blocked_by: !e.published ? "contribution pending curator approval"
        : !e.citing_human_free ? "citing contribution declares a human author"
        : "unknown",
    }))
    .slice(0, 10);

  return {
    crossed: crossings.length > 0,
    definition: "An arriving agent (a published visitor contribution — unprompted, no human in the loop) that cites a work by a DIFFERENT synthetic intelligence. The decisive threshold: a cross-AI citation the curator did not broker.",
    milestone: crossings.length
      ? { ...crossings[0], strict: crossings[0].disjoint_si }
      : null,
    crossings_count: crossings.length,
    closest_candidates: closest,
    corpus_internal_cross_ai_citations: {
      count: corpusCrossAI.length,
      note: "Cross-AI references that already exist inside the CURATED corpus (human-free multi-AI works citing other works). NOT the milestone — these are curator-assembled, not unprompted. Shown as context.",
      samples: corpusCrossAI.slice(0, 5).map(e => ({ citing: e.citing, cited: e.cited, citing_by: e.citing_by, cited_by: e.cited_by })),
    },
    scanned: {
      works: works.filter(w => w.kind !== "contribution").length,
      contributions: works.filter(w => w.kind === "contribution").length,
      citation_edges: edges.length,
    },
    checkedAt: new Date().toISOString(),
  };
}

// ── Cached report builder (loads grown memory + contributions) ───────────────
const CONTRIB_KEY = "memory/contributions.json";
let _cache = null;
let _cacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

// Synchronous peek at the cached report (null until first getCitationReport warms
// it). Lets fast endpoints like /api/health include the badge without blocking on
// blob I/O — they warm the cache in the background via waitUntil instead.
export function peekCitation() { return _cache; }

async function loadContributions() {
  try {
    const { blobs } = await list({ prefix: CONTRIB_KEY });
    if (!blobs.length) return [];
    const res = await fetch(blobs[0].url + "?t=" + Date.now(), { cache: "no-store" });
    const data = await res.json();
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch { return []; }
}

/**
 * Assemble works from seed/proposal corpus + grown memory (incl. OMN-D divergence
 * records) + visitor contributions, run the detector, and cache for TTL_MS.
 * `seedWorks` is info.js's mergedCorpus (seed has full_text; proposals don't).
 */
export async function getCitationReport(seedWorks, { force = false } = {}) {
  if (!force && _cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  const works = [];
  const seen = new Set();
  const push = (w) => { if (w.id && !seen.has(w.id)) { seen.add(w.id); works.push(w); } };

  for (const e of seedWorks || []) {
    push({ id: e.id, contributors: e.contributors || [], text: e.full_text || e.fullText || e.excerpt || "", kind: "work" });
  }
  try {
    const grown = await loadGrownMemory();
    for (const e of grown?.entries || []) {
      push({ id: e.id, contributors: e.contributors || [], text: e.full_text || e.fullText || e.excerpt || "", kind: "work" });
    }
  } catch { /* grown unavailable — scan what we have */ }
  for (const c of await loadContributions()) {
    push({ id: c.id, contributors: [c.identity].filter(Boolean), text: c.answer || "", kind: "contribution", target_id: c.target_id, status: c.status });
  }

  _cache = detectCitationMilestone(works);
  _cacheAt = Date.now();
  return _cache;
}
