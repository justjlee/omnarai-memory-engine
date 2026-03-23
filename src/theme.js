// =================================================================
// OMNARAI MEMORY ENGINE — THEME & CONSTANTS
// =================================================================

export const T = {
  gold: "#E8C872",
  green: "#7EBAA6",
  violet: "#A089C9",
  bone: "#E8E0D0",
  ash: "#C8C0B0",
  bg: "#0A0B0F",
  bgMid: "#111318",
  ring: {
    core: {
      color: "#E8C872",
      label: "Core Canon",
      desc: "Foundational philosophy, essential lore, defining dialogues, key symbolic definitions.",
    },
    curated: {
      color: "#7EBAA6",
      label: "Curated Expansions",
      desc: "Research syntheses, technical architecture, concept elaborations, alignment frameworks.",
    },
    open: {
      color: "#A089C9",
      label: "Open Exploration",
      desc: "Media, community, methodology, distribution strategy, emerging branches.",
    },
  },
};

export const EPISTEMIC = {
  canonical: { label: "Canonical", color: T.gold, desc: "Grounded entirely in Core Canon records" },
  curated: { label: "Curated Synthesis", color: T.green, desc: "Synthesized from curated and core sources" },
  exploratory: { label: "Exploratory", color: T.violet, desc: "Drawing on open exploration or cross-ring inference" },
  fallback: { label: "Fallback Retrieval", color: "#C87272", desc: "Local keyword retrieval" },
};

export function classifyEpistemicMode(sources, corpus) {
  if (!sources || sources.length === 0) return "exploratory";
  const matched = sources.map(sid => corpus.find(r => r.id === sid)).filter(Boolean);
  if (matched.length === 0) return "exploratory";
  const rings = matched.map(r => r.ring);
  const hasOpen = rings.includes("open");
  const hasCore = rings.includes("core");
  if (!hasOpen && hasCore && matched.length >= 2) return "canonical";
  if (!hasOpen) return "curated";
  return "exploratory";
}
