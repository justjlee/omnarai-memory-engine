// Pure logic for check-surface-numbers.mjs — no network, no filesystem, so it is unit-testable.
//
// The question it answers: a public page says "175 splits" / "567 works" / "Eight tools".
// Is that number (a) live truth, (b) a release-pinned figure, (c) a dated snapshot that
// SAYS it is one, or (d) a typed literal that has gone stale?  (d) is the failure.
//
// What this net catches: counted PROSE ("N works", "N splits", "Eight tools").
// What it cannot see: key/value table cells ("| tested_count | 33 |") — those are covered by
// generated <!--live:KEY--> markers (sync-doc-counts.py) and the specific gates in
// check-stats-consistency.mjs. Both layers exist because neither alone is enough.

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen"];

// noun group → canonical key. Everything on the left of the arrow is prose a human types.
const NOUN_KEY = {
  work: "works", works: "works",
  record: "records", records: "records", split: "records", splits: "records",
  answer: "answers", answers: "answers",
  tension: "tensions", tensions: "tensions", "tension axes": "tensions",
  word: "words", words: "words",
  node: "nodes", nodes: "nodes",
  edge: "edges", edges: "edges",
  tool: "tools", tools: "tools",
};
// Below this a number is ordinary prose ("three works inspired…"), not a corpus figure.
// words: corpus-scale only — "~6,100 words" is the length of a document, not the corpus.
const MIN = { works: 100, records: 100, answers: 100, tensions: 100, words: 100000, nodes: 1, edges: 1, tools: 1 };

const MODS = "(?:attributed|cross-model|verbatim|model|recorded|concept|total|frontier|primary|distinct|remote|read-only|MCP|stdio|live|seed)";
const NOUNS = "(works?|records?|splits?|answers?|tension axes|tensions?|words|nodes?|edges?|tools?)";
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?([kK])?";
const NUMWORD = `(${WORDS.slice(1).join("|")})`;
const RE_DIGIT = new RegExp(`(?<![\\w.$/-])~?${NUM}(\\+)?\\s+(?:${MODS}\\s+){0,2}${NOUNS}\\b`, "g");
// Number WORDS only count for tools ("Eight tools") — "five works" in prose is not a corpus figure.
const RE_WORD = new RegExp(`\\b${NUMWORD}\\s+(?:${MODS}\\s+){0,2}(tools?)\\b`, "gi");

export function toText(raw, { html = false } = {}) {
  let t = String(raw);
  if (html) {
    // Keep JSON-LD (a no-JS reader's main source of figures); drop executable script + style.
    t = t.replace(/<script(?![^>]*ld\+json)[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
    t = t.replace(/<[^>]+>/g, " ");
  }
  // Generated markers are the sync's job; keep their number, drop the comment syntax.
  t = t.replace(/<!--\/?live:?[a-z0-9_]*-->/g, "");
  return t.replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

/** Every "N <counted noun>" in the text → [{key, number, raw, index, ctx}]. */
export function extract(text) {
  const out = [];
  for (const m of text.matchAll(RE_DIGIT)) {
    const key = NOUN_KEY[m[4].toLowerCase()];
    let n = Number(m[1].replace(/,/g, ""));
    if (m[2]) n *= 1000; // "530K"
    if (!key || n < MIN[key]) continue;
    // "2025 work" is a year, not a count of works.
    if (key === "works" && /^\d{4}$/.test(m[1]) && n >= 1990 && n <= 2100) continue;
    out.push({ key, number: n, atLeast: Boolean(m[3]), raw: m[0].trim(), index: m.index, ctx: window(text, m.index, m[0].length) });
  }
  for (const m of text.matchAll(RE_WORD)) {
    out.push({ key: "tools", number: WORDS.indexOf(m[1].toLowerCase()), raw: m[0].trim(), index: m.index, ctx: window(text, m.index, m[0].length) });
  }
  return out;
}

function window(text, i, len, pad = 110) {
  return text.slice(Math.max(0, i - pad), Math.min(text.length, i + len + pad));
}

// A number is honestly labeled if it names the release/version/date it belongs to.
// ("at this writing" is deliberately NOT a label — it is the phrase that went stale — and neither is
// a nearby word like "snapshot": 2026-10-14 that waved through "Live: 567 works at this writing".)
const LABEL = [
  /\bv\d+\.\d+\.\d+\b/i,                       // release version: "Atlas v1.2.0 · 166 records"
  /\b20\d\d-\d\d-\d\d\b/,                      // an ISO date nearby: "verified live … on 2026-08-17"
  /\bas of (?:20\d\d|[A-Z][a-z]+ \d)/,         // "as of 2026-10-05" / "as of October 5"
];
export const isLabeled = (ctx) => LABEL.some((re) => re.test(ctx));

/**
 * truth = { works:[…], records:[…], answers:[…], tensions:[…], nodes:[…], edges:[…], tools:[…], words: n }
 * allow = [{ surface, key, number, reason }]
 * → { level: "PASS"|"LABELED"|"ALLOWED"|"FAIL", why }
 */
export function judge(hit, truth, allow = [], surface = "") {
  const { key, number: n } = hit;
  if (key === "words") {
    return Math.abs(n - truth.words) / truth.words <= 0.01 ? { level: "PASS", why: "words ≈ live" } : verdict(hit, truth, allow, surface);
  }
  // "100+ records" is a lower bound: true as long as the live figure is at least that.
  if (hit.atLeast && Math.max(...(truth[key] || [0])) >= n) return { level: "PASS", why: `${n}+ ${key} ≤ live` };
  if ((truth[key] || []).includes(n)) return { level: "PASS", why: `${n} ${key} = a live/pinned figure` };
  return verdict(hit, truth, allow, surface);
}

function verdict(hit, truth, allow, surface) {
  const a = allow.find((e) => e.key === hit.key && Number(e.number) === hit.number && surface.includes(e.surface));
  if (a) return { level: "ALLOWED", why: a.reason };
  if (isLabeled(hit.ctx)) return { level: "LABELED", why: "dated/versioned snapshot" };
  const want = hit.key === "words" ? truth.words : (truth[hit.key] || []).join(" | ");
  return { level: "FAIL", why: `${hit.number} ${hit.key} ≠ ${want}` };
}

/** Build the accepted-value sets from /api/manifest + /api/stats. */
export function truthFrom(manifest, stats) {
  const c = manifest.counts.corpus, a = stats.atlas, rel = manifest.published_releases?.divergence_atlas || {};
  const rings = Object.values(c.rings || {});
  const uniq = (xs) => [...new Set(xs.filter((x) => Number.isFinite(x)))];
  return {
    works: uniq([c.total_works, c.seed_works, ...rings]),
    records: uniq([a.recorded, rel.records]),
    answers: uniq([a.verbatim_answers, rel.verbatim_answers]),
    tensions: uniq([a.tension_axes]),
    nodes: uniq([manifest.counts.concept_graph.nodes]),
    edges: uniq([manifest.counts.concept_graph.edges]),
    // Per-transport counts differ on purpose (remote 12, stdio default 11, +3 opt-in = 14).
    tools: uniq([stats.mcp.remote, stats.mcp.stdio_default, stats.mcp.stdio_default + stats.mcp.stdio_opt_in]),
    words: c.total_words,
  };
}
