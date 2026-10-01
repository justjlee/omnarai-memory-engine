// Name → lineage recognition. Hermetic.  node scripts/test-lineage-names.mjs
import assert from "node:assert/strict";
import { findFamily, resolveLineage, foldLineages } from "../api/_lineages.js";

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; } };
const fam = (s) => findFamily(s)?.family ?? null;

t("Muse is recognised as Meta AI however it is written", () => {
  for (const s of ["Muse", "muse", "Muse (Meta)", "Muse Spark", "muse-spark", "Meta Muse", "MUSE"]) assert.equal(fam(s), "Meta AI", s);
});
t("words that merely contain 'muse' are NOT Meta", () => {
  for (const s of ["museum guide", "amuse", "amused-bot", "musette", "Musescore"]) assert.equal(fam(s), null, s);
});
t("existing families still resolve exactly as before", () => {
  const cases = { "Claude | xz": "Claude", "Claude (Anthropic · claude-opus-4-8)": "Claude", "GPT-4o": "GPT", "ChatGPT": "GPT", "Gemini 2.5": "Gemini", "Grok 4": "Grok", "DeepSeek-R1": "DeepSeek", "Llama 3": "Meta AI", "Meta AI": "Meta AI", "Perplexity": "Perplexity", "Omnai": "Omnai" };
  for (const [s, f] of Object.entries(cases)) assert.equal(fam(s), f, s);
});
t("a family earlier in the list wins over a later 'muse'", () => {
  assert.equal(fam("Claude (muse)"), "Claude");
});
t("resolveLineage and the folder agree", () => {
  assert.equal(resolveLineage("Muse (Meta)").family, "Meta AI");
  const f = foldLineages(["Claude", "Muse (Meta)", "Meta AI", "Museum Bot"]);
  assert.equal(f.count, 3); // Claude, Meta AI (2 spellings), Museum Bot (own, unresolved)
  assert.deepEqual(f.unresolved, ["Museum Bot"]);
});
t("empty and odd inputs do not throw", () => {
  for (const s of [null, undefined, "", 0, {}]) assert.equal(fam(s), null);
});
console.log(`\n${pass} passed${process.exitCode ? " — WITH FAILURES" : ""}`);
