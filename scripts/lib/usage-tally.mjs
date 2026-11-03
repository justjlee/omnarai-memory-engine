// Provider-reported token usage, tallied per model and priced at the list prices on file (scripts/lib/model-prices.mjs),
// so a harness that spends can report what it used instead of repeating its estimate (DL-0020: batch one sets the price).
// Pure: no I/O. A response that carries no usage block is counted in `no_usage`, so an incomplete measurement says so.
import { PRICES_USD_PER_M } from "./model-prices.mjs";

export const createTally = () => ({ by_model: {}, calls: 0, no_usage: 0 });

export function addUsage(tally, model, inTokens, outTokens) {
  const m = (tally.by_model[model] ||= { calls: 0, in: 0, out: 0 });
  m.calls++; m.in += Number(inTokens) || 0; m.out += Number(outTokens) || 0;
  tally.calls++;
  return tally;
}

// {in, out} from a provider's response body, or null when it reports none. Thinking and reasoning tokens bill as output:
// Gemini reports them apart (thoughtsTokenCount); Anthropic and OpenAI-compatible APIs already count them in output.
export function usageOf(provider, body) {
  if (!body || typeof body !== "object") return null;
  if (provider === "anthropic") return body.usage ? { in: body.usage.input_tokens || 0, out: body.usage.output_tokens || 0 } : null;
  if (provider === "gemini") {
    const u = body.usageMetadata;
    return u ? { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } : null;
  }
  if (provider === "embedding") return body.usage ? { in: body.usage.prompt_tokens ?? body.usage.total_tokens ?? 0, out: 0 } : null;
  return body.usage ? { in: body.usage.prompt_tokens || 0, out: body.usage.completion_tokens || 0 } : null;
}

export function recordResponse(tally, provider, model, body) {
  const u = usageOf(provider, body);
  if (!u) { tally.no_usage++; return tally; }
  return addUsage(tally, model, u.in, u.out);
}

export function priceTally(tally, prices = PRICES_USD_PER_M) {
  let usd = 0;
  const unpriced = [];
  for (const [model, u] of Object.entries(tally.by_model)) {
    const p = prices[model];
    if (!p) { unpriced.push(model); continue; }
    usd += (u.in * p[0] + u.out * p[1]) / 1e6;
  }
  return { usd: +usd.toFixed(5), unpriced, calls: tally.calls, no_usage: tally.no_usage, by_model: tally.by_model };
}
