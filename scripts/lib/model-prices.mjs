// List prices (USD per 1M tokens: [input, output]) used ONLY for pre-run cost estimates — the same figures
// scripts/stance-agreement.mjs already carries. An estimate is never a bill: harnesses reserve the estimate times a
// safety factor on the shared ledger, and the provider-side spend limits remain the real floor.
export const PRICES_USD_PER_M = {
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
  "gpt-4o": [2.5, 10],
  "gemini-2.5-flash": [0.3, 2.5],
  "grok-4.3": [3, 15],
  "deepseek-chat": [0.27, 1.1],
  // Added 2026-10-27 so certification can price what it used (its judges and embeddings). gpt-5-mini and
  // text-embedding-3-small: OpenAI's model pages. gemini-3.5-flash: third-party price listings only, not yet checked
  // against Google's own pricing page.
  "gpt-5-mini": [0.25, 2],
  "gemini-3.5-flash": [1.5, 9],
  "text-embedding-3-small": [0.02, 0],
};
export const PRICES_AS_OF = "2026-10-15, three added 2026-10-27 (assumed list prices; verify before a large run)";

// ~4 characters per token for English prose; rounded UP so estimates err high.
export const tokensFor = (chars) => Math.ceil((chars || 0) / 4);

export function costUsd(model, inTokens, outTokens) {
  const p = PRICES_USD_PER_M[model];
  if (!p) throw new Error(`no price on file for ${model}`);
  return (inTokens * p[0] + outTokens * p[1]) / 1e6;
}
