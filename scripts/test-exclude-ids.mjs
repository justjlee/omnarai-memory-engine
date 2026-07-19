// Tests for id-level retrieval withholding (api/query.js: exclude_ids).
// No network, no Blob — run anytime: node scripts/test-exclude-ids.mjs
//
// WHY THIS FILE EXISTS. The inward perturbation test (resident/) measures behavior
// with a memory present vs withheld. If the "withheld" record can be retrieved back
// through the pool, the two arms are identical, the delta collapses to noise, and the
// test reports H0 — the cosmetic-continuity null — by INSTRUMENT ERROR. The project
// has publicly committed to publishing that null, so manufacturing it accidentally is
// the most expensive failure available. See resident/INTEGRATION_REPORT.md §2.
//
// The load-bearing assertion here is NOT "the filter drops the record." It is that a
// caller can VERIFY the drop happened (exclude_ids.matched) and can therefore discard
// a run whose withhold silently no-opped.
import assert from "node:assert/strict";
import { parseLayerFilters, applyLayerFilters, matchedExcludedIds } from "../api/query.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✅ ${name}`); };

const corpus = [
  { id: "OMN-001", ring: "core", type: "essay", evidence_status: "theoretical" },
  { id: "OMN-D1780752664952", ring: "open", type: "divergence" },
  { id: "OMN-085", ring: "core", type: "essay" },
  { id: "prim_abc123", ring: "open", type: "essay" },
];

console.log("== defaults are untouched (no silent behavior change) ==");
t("no filters → pool unchanged", () => {
  const f = parseLayerFilters({});
  assert.equal(applyLayerFilters(corpus, f).length, 4);
  assert.equal(f.active, false);
});
t("no exclude_ids → no receipt emitted", () =>
  assert.equal(matchedExcludedIds(corpus, parseLayerFilters({})), null));

console.log("\n== withholding drops the record from the pool ==");
t("single id withheld", () => {
  const f = parseLayerFilters({ exclude_ids: "OMN-085" });
  const pool = applyLayerFilters(corpus, f);
  assert.equal(f.active, true);
  assert.equal(pool.length, 3);
  assert.ok(!pool.some((r) => r.id === "OMN-085"));
});
t("multiple ids, csv + surrounding whitespace tolerated", () => {
  const f = parseLayerFilters({ exclude_ids: " OMN-001 , OMN-085 " });
  assert.equal(applyLayerFilters(corpus, f).length, 2);
  assert.equal(matchedExcludedIds(corpus, f).matched.length, 2);
});

console.log("\n== THE SAFETY PROPERTY: a withhold that didn't happen must be visible ==");
t("unmatched id does NOT 400 (withholding a non-corpus id is legitimate)", () =>
  assert.equal(parseLayerFilters({ exclude_ids: "OMN-85" }).unknown.length, 0));
t("unmatched id is reported so a harness can discard the run", () => {
  const f = parseLayerFilters({ exclude_ids: "OMN-85" });
  const m = matchedExcludedIds(corpus, f);
  assert.deepEqual(m.matched, []);
  assert.deepEqual(m.unmatched, ["OMN-85"]);
  // pool intact — nothing was withheld, and the receipt says so
  assert.equal(applyLayerFilters(corpus, f).length, 4);
});
t("receipt echoes exactly what was requested", () => {
  const f = parseLayerFilters({ exclude_ids: "OMN-001,OMN-85" });
  const m = matchedExcludedIds(corpus, f);
  assert.deepEqual(m.requested, ["OMN-001", "OMN-85"]);
  assert.deepEqual(m.matched, ["OMN-001"]);
  assert.deepEqual(m.unmatched, ["OMN-85"]);
});

console.log("\n== case sensitivity (the bug that would no-op every exclusion) ==");
t("case-bearing ids match exactly and are dropped", () => {
  const f = parseLayerFilters({ exclude_ids: "OMN-D1780752664952" });
  assert.equal(matchedExcludedIds(corpus, f).matched.length, 1);
  assert.ok(!applyLayerFilters(corpus, f).some((r) => r.id === "OMN-D1780752664952"));
});
t("lowercasing an id would NOT match (guards the csv-folding regression)", () => {
  const f = parseLayerFilters({ exclude_ids: "omn-085" });
  assert.deepEqual(matchedExcludedIds(corpus, f).matched, []);
});

console.log("\n== composition with the existing layer filters ==");
t("exclude_ids composes with layers=", () => {
  const f = parseLayerFilters({ layers: "canon", exclude_ids: "OMN-085" });
  const pool = applyLayerFilters(corpus, f);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].id, "OMN-001");
});
t("layers= alone still works (no regression)", () =>
  assert.equal(applyLayerFilters(corpus, parseLayerFilters({ layers: "divergence" })).length, 1));
t("unknown LAYER still reported → the 400 path is intact", () =>
  assert.ok(parseLayerFilters({ layers: "bogus" }).unknown.includes("bogus")));
t("rings= alone still works (no regression)", () =>
  assert.equal(applyLayerFilters(corpus, parseLayerFilters({ rings: "core" })).length, 2));

console.log(`\n  ${n}/${n} passed`);
