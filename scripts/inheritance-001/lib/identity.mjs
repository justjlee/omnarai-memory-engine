// Inheritance study 001 — model family from the PROVIDER-RETURNED model id. No imports, so the solver side (adapters)
// and the sealed side (artifacts, snapshot) can share it without either reaching the other.
//
// Never from a self-label, a display name or a Footprint's declared identity. Names line up with the lineage ids in
// api/_footprints.js. Unknown stays unknown and is excluded from every cross-family estimate.
const FAMILY_RULES = [
  [/^claude-/, "anthropic-claude"],
  [/^(gpt-|o\d)/, "openai-gpt"],
  [/^(models\/)?gemini-/, "google-gemini"],
  [/^grok-/, "xai-grok"],
  [/^deepseek-/, "deepseek"],
  [/^(llama|meta-llama)/i, "meta-llama"],
  [/^mock-([a-z]+)-/, (m) => `mock-${m[1]}`],
];
export function familyOfModelId(modelId) {
  const id = String(modelId || "");
  for (const [re, fam] of FAMILY_RULES) {
    const m = re.exec(id);
    if (m) return typeof fam === "function" ? fam(m) : fam;
  }
  return "unknown";
}
