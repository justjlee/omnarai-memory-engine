// Live figures for generated text — ONE implementation, used at deploy time (scripts/bake-figures.mjs, which
// scripts/sync-doc-counts.py calls) AND at request time (middleware.js), so a page served right now and a page
// baked at the last deploy follow identical rules. Pure: no I/O, edge-runtime safe.
//
//   <!--live:KEY-->N<!--/live-->   generated text in any public .md/.html/.txt
//   data-live="KEY">N<             the no-JS fallback of an element the browser also hydrates
//
// Source of truth: /api/stats + /api/manifest (the same pair the Balance tracker and every gate read).
// An unknown KEY is reported, never silently left — at deploy time it fails the bake (exit 2).
export const ALIASES = { cleared: "certified", certified_strong: "c3", distinct: "distinct_questions" };
const MARK = /(<!--live:([a-z0-9_]+)-->)([^<]*?)(<!--\/live-->)/g;
const TOKEN = /(data-live="([a-z0-9_]+)">)([^<]*)(<)/g;

export function figuresFrom(stats, manifest) {
  const a = stats.atlas, c = stats.corpus, mc = manifest.counts.corpus, td = a.tier_distribution || {};
  const q = manifest.domains?.questions?.canonical_questions;
  return {
    works: c.works, words: c.words, seed_works: mc.seed_works, merged_proposals: mc.merged_proposals,
    records: a.recorded, distinct_questions: q, reelicitations: q == null ? null : a.recorded - q,
    tested: a.tested, untested: a.untested, certified: a.certified,
    c0: td.C0 || 0, c1: td.C1 || 0, c2: td.C2 || 0, c3: td.C3 || 0,
    answers: a.verbatim_answers, tensions: a.tension_axes,
    nodes: manifest.counts.concept_graph?.nodes, edges: manifest.counts.concept_graph?.edges,
    lineages: c.lineages, tools_remote: stats.mcp?.remote, tools_stdio: stats.mcp?.stdio_default,
  };
}

// Thousands separators without Intl (not guaranteed in every edge runtime). Only `words` is formatted.
const fmt = (key, v) => (key === "words" && typeof v === "number" ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : String(v));

export function bakeFigures(text, figs) {
  const unknown = new Set();
  const out = String(text)
    .replace(MARK, (m, open, key, _old, close) => (figs[key] == null ? (unknown.add(key), m) : open + fmt(key, figs[key]) + close))
    .replace(TOKEN, (m, open, raw, _old, close) => {
      const key = ALIASES[raw] || raw;
      return figs[key] == null ? (unknown.add(raw), m) : open + fmt(key, figs[key]) + close;
    });
  return { text: out, unknown: [...unknown] };
}
