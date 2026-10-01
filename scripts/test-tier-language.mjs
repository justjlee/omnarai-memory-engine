// The tier-language gate catches the exact wording that shipped wrong on 2026-10-01 and lets honest wording through.
//   node scripts/test-tier-language.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText } from "./check-tier-language.mjs";

const hits = (t) => scanText(t).map((h) => h.rule);

test("catches the shipped hero sentence", () => {
  assert.deepEqual(hits("Only 6 of 162 recorded splits survive paraphrase and adversarial pressure to certify"), ["R2"]);
});
test("catches the shipped chip label", () => {
  assert.deepEqual(hits('{tier} · certified  // was: C1 · certified'), ["R1"]);
  assert.deepEqual(hits("<span>C1 · certified</span>"), ["R1"]);
  assert.deepEqual(hits("C2 splits are certified genuine divergence"), ["R1"]);
});
test("also catches the slash/plus variants that shipped in orient", () => {
  assert.deepEqual(hits("certified ${tier}: the split survived paraphrase/pressure perturbation"), ["R2"]);
  assert.deepEqual(hits("splits that survive paraphrase + pressure"), ["R2"]);
});
test("lets honest wording through", () => {
  for (const ok of [
    "C3 · certified",
    "C1 · paraphrase-robust",
    "C1 — paraphrase-robust (uncertified)",
    "C1/C2 splits are not certified genuine divergence",
    "Only C3 survived both paraphrase and adversarial pressure",
    "2 survive both paraphrase and adversarial pressure (C3 — the only tier called genuine divergence)",
    "certified C3: the split survived both paraphrase AND adversarial-pressure perturbation",
    "Filter by robustness with ?cert=C1|C2|C3|certified.",
    "A tier is never upgraded: C1 has not been certified.",
  ]) assert.deepEqual(hits(ok), [], ok);
});
test("an explicit escape hatch exists for a legitimate exception", () => {
  assert.deepEqual(hits("C1 · certified // tier-language:ok (quoting the old bug)"), []);
});
test("reports file and line", () => {
  const h = scanText("fine\nC1 splits are certified\nfine", "x.md");
  assert.equal(h.length, 1); assert.equal(h[0].line, 2); assert.equal(h[0].file, "x.md");
});
