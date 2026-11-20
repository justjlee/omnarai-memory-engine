// Inheritance study 001 — list prices for PROJECTIONS and post-hoc cost reporting. USD per 1M tokens [input, output].
//
// Source: each provider's own pricing page as read on 2026-11-13 (recorded in the utility-v2 session notes) and
// 2026-11-18 (frontier-track notes). They are assumptions until re-read on the day a live run is approved. A model with
// no entry is priced `null` → cost "unknown", never 0, and the live runner refuses it (it cannot bound the spend).
// Kept apart from scripts/lib/model-prices.mjs on purpose: that table predates these models and has one known-stale
// entry (grok-4.3); consolidating them is listed in research/inheritance-001/DECISIONS_REQUIRED.md.
export const PRICES_AS_OF = "2026-11-13 / 2026-11-18 provider pages (re-verify before any live run)";
export const PRICES = {
  "claude-opus-5-5": [{ from: "2026-01-01", in: 4, out: 20 }],
  "claude-sonnet-5-5": [{ from: "2026-01-01", in: 2, out: 10 }],
  "claude-haiku-5-5": [{ from: "2026-01-01", in: 0.1, out: 0.5 }],
  "gpt-6.1-sol": [{ from: "2026-01-01", in: 2, out: 10 }],
  "gpt-6.1-terra": [{ from: "2026-01-01", in: 1, out: 5 }],
  "gpt-6-luna": [{ from: "2026-01-01", in: 0.1, out: 0.5 }],
  "gemini-4-carbon": [{ from: "2026-01-01", in: 2, out: 10 }, { from: "2026-12-01", in: 4, out: 20 }],
  "grok-4.7": [{ from: "2026-01-01", in: 2, out: 6 }],
  "deepseek-v4-pro": [{ from: "2026-01-01", in: 1.32, out: 3.96 }],
  "deepseek-v4-flash": [{ from: "2026-01-01", in: 0.3, out: 1.2 }],
};

// A dated snapshot id ("claude-sonnet-5-5-20261101", "gpt-6.1-sol-2026-11-02") is priced as its base id.
const baseId = (id) => String(id || "").replace(/^models\//, "").replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "");
export function priceFor(modelId, onDate = "2026-11-20") {
  const tiers = Object.hasOwn(PRICES, modelId) ? PRICES[modelId] : Object.hasOwn(PRICES, baseId(modelId)) ? PRICES[baseId(modelId)] : null;
  if (!tiers) return null;
  const t = tiers.filter((x) => x.from <= onDate).at(-1);
  return t ? { in: t.in, out: t.out } : null;
}
// → {usd, status}: "priced" with a number, or "unknown" with null. Mock calls are "mock-zero".
export function costOf(modelId, tokensIn, tokensOut, { onDate, mock = false } = {}) {
  if (mock) return { usd: 0, status: "mock-zero" };
  const p = priceFor(modelId, onDate);
  if (!p) return { usd: null, status: "unknown" };
  return { usd: +((tokensIn * p.in + tokensOut * p.out) / 1e6).toFixed(6), status: "priced" };
}
