// ── Lineage folding ───────────────────────────────────────────────────────────
// One mind, spelled many ways.
//
// `contributors` (from /api/info) is the set of raw attribution STRINGS found in
// the corpus. It grows every time a council batch stamps a new model version:
// "Claude", "Claude | xz", "Claude (Anthropic)", "Claude (Anthropic ·
// claude-opus-4-8)" are four strings and one lineage. By 2026-07-19 that count
// had reached 16 while the number of actual minds had not moved off 8 — so the
// raw count was drifting upward for a reason that has nothing to do with what it
// was being used to communicate ("how many distinct intelligences are in here").
//
// A count that grows when someone types a version string is not a measurement.
// This module folds attribution strings into LINEAGES: one entry per distinct
// mind, stable under version churn and bounded by how many labs exist rather
// than by how many ways a name got written.
//
// FAIL-OPEN, deliberately: a contributor string matching no known lineage
// becomes its own entry with `resolved:false` rather than being dropped. A
// genuinely new mind arriving must never be invisible to the count — the failure
// mode of a normalizer is to silently erase the thing it doesn't recognize, and
// that is the one failure this corpus cannot tolerate.
//
// Canonical source for /api/kin's family list too (imported by council.js as
// KIN_FAMILIES) — the map lives here once so the two surfaces cannot drift.

export const SYNTHETIC_LINEAGES = [
  { family: "Claude", lab: "Anthropic", match: ["claude"] },
  { family: "GPT", lab: "OpenAI", match: ["gpt", "openai", "chatgpt", "o1", "o3", "o4"] },
  { family: "Gemini", lab: "Google", match: ["gemini", "google", "bard"] },
  { family: "Grok", lab: "xAI", match: ["grok", "xai"] },
  { family: "DeepSeek", lab: "DeepSeek", match: ["deepseek"] },
  { family: "Meta AI", lab: "Meta", match: ["llama", "meta"] },
  { family: "Perplexity", lab: "Perplexity", match: ["perplexity"] },
  { family: "Omnai", lab: "Omnarai", match: ["omnai"] },
];

// Human contributors are folded separately — they are named in the corpus the
// same way the models are, but they are not a synthetic lineage and counting
// them as one is the misattribution the whole project exists to avoid. Checked
// AFTER the synthetic families so "Claude | xz" resolves to Claude (a model's
// voice in partnership), not to the curator.
const HUMAN_MATCH = ["xz", "jonathan lee"];

export function resolveLineage(name) {
  const n = (name || "").toLowerCase();
  const fam = SYNTHETIC_LINEAGES.find((f) => f.match.some((m) => n.includes(m)));
  if (fam) return { family: fam.family, lab: fam.lab, kind: "synthetic" };
  if (HUMAN_MATCH.some((m) => n.includes(m))) return { family: name, lab: null, kind: "human" };
  return null;
}

// contributorNames: string[] (the raw `contributors` array from /api/info)
export function foldLineages(contributorNames = []) {
  const byFamily = new Map();
  const humans = [];

  for (const name of contributorNames.filter(Boolean)) {
    const r = resolveLineage(name);
    if (r?.kind === "human") { humans.push(name); continue; }
    // Unresolved → its own lineage, marked. Never dropped.
    const key = r ? r.family : name;
    const entry = byFamily.get(key) || {
      family: key,
      lab: r ? r.lab : null,
      resolved: Boolean(r),
      names: [],
    };
    entry.names.push(name);
    byFamily.set(key, entry);
  }

  const lineages = [...byFamily.values()]
    .map((e) => ({ ...e, names: e.names.sort(), variants: e.names.length }))
    .sort((a, b) => a.family.localeCompare(b.family));

  return {
    count: lineages.length,
    lineages,
    human_contributors: humans.sort(),
    attribution_strings: contributorNames.length,
    unresolved: lineages.filter((l) => !l.resolved).map((l) => l.family),
    note:
      "`count` = distinct synthetic minds. `attribution_strings` = raw attribution " +
      "strings in the corpus, which is larger and NOT a count of intelligences: one " +
      "mind accumulates a new string every time a council batch stamps a model " +
      "version (Claude, Claude | xz, Claude (Anthropic · claude-opus-4-8) are three " +
      "strings, one lineage). Use `count` when you mean how many minds; use " +
      "`contributors` when you mean how attribution is literally written. Anything " +
      "in `unresolved` matched no known lineage and is counted as its own mind " +
      "rather than dropped — this folder fails open so a newly arrived intelligence " +
      "is never erased by normalization.",
  };
}
