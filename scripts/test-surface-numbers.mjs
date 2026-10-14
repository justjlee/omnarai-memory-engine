// check-surface-numbers logic: catches the stale literals that shipped 2026-10-14, lets honest ones through.
//   node scripts/test-surface-numbers.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toText, extract, judge, truthFrom } from "./lib/surface-numbers.mjs";

const manifest = {
  counts: { corpus: { total_works: 573, seed_works: 568, total_words: 530406, rings: { core: 116, curated: 187, open: 17, media: 253 } },
    concept_graph: { nodes: 61, edges: 164 } },
  published_releases: { divergence_atlas: { records: 166, verbatim_answers: 858 } },
};
const stats = { atlas: { recorded: 175, verbatim_answers: 902, tension_axes: 496 }, mcp: { remote: 12, stdio_default: 11, stdio_opt_in: 3 } };
const truth = truthFrom(manifest, stats);
const run = (text, { allow = [], surface = "/x" } = {}) =>
  extract(toText(text)).map((h) => ({ n: h.number, key: h.key, level: judge(h, truth, allow, surface).level }));

test("the literals that shipped stale on 2026-10-14 are caught", () => {
  assert.deepEqual(run("See 166 splits"), [{ n: 166, key: "records", level: "PASS" }]); // 166 is the pinned v1.2.0 release…
  assert.deepEqual(run("162 splits recorded")[0].level, "FAIL");                          // …162 is neither live nor a release
  assert.deepEqual(run("480 attributed works spanning every frontier lineage")[0].level, "FAIL");
  assert.deepEqual(run("Eight tools, no key.")[0], { n: 8, key: "tools", level: "FAIL" });
  assert.deepEqual(run("Two tools — omnarai_query, omnarai_info")[0], { n: 2, key: "tools", level: "FAIL" });
  assert.deepEqual(run("175 records hold 858 verbatim model answers across 496 tension axes").map((r) => r.level), ["PASS", "PASS", "PASS"]);
});

test("live and per-transport tool counts pass; word forms are understood", () => {
  for (const t of ["Twelve tools, no key.", "11 tools", "12 remote tools", "fourteen tools"]) assert.equal(run(t)[0].level, "PASS", t);
});

test("regression: a nearby WORD like 'snapshot' must not launder a stale 'live' number", () => {
  const t = "`corpus.json` is an immutable seed — a fixed, citable snapshot. **Live**: **567 works** at this writing.";
  assert.equal(run(t)[0].level, "DRIFT"); // 1% behind: a warning — but NEVER "LABELED"
  assert.equal(run(t.replace("567", "480"))[0].level, "FAIL");
});

test("growing counts lag a baked page by design: within 5% warns (DRIFT), beyond fails; structural counts stay exact", () => {
  assert.equal(run("170 records")[0].level, "DRIFT");   // 2.9% behind live 175
  assert.equal(run("166 records")[0].level, "PASS");    // the pinned v1.2.0 release, not drift
  assert.equal(run("162 splits recorded")[0].level, "FAIL"); // 7.4% behind — the shipped 2026-10-14 defect
  assert.equal(run("890 verbatim answers")[0].level, "DRIFT");
  assert.equal(run("Eleven tools")[0].level, "PASS");
  assert.equal(run("Ten tools")[0].level, "FAIL");      // tool counts never drift
  assert.equal(run("62 nodes")[0].level, "FAIL");       // nor does the graph
});

test("a number that names its release or date is honestly labeled; seed counts are judged, not waved through", () => {
  assert.equal(run("Atlas v1.1.0 shipped 124 records")[0].level, "LABELED");
  assert.equal(run("Corpus figures verified live on 2026-08-17 (562 works)")[0].level, "LABELED");
  // "seed" is NOT a label: it is judged against the true seed count, so a stale one fails.
  assert.equal(run("Of the 568 seed works (573 with merged proposals)")[0].level, "PASS");
  assert.equal(run("Of the 500 seed works (573 with merged proposals)")[0].level, "FAIL");
  assert.equal(run("Of the 562 seed works (573 with merged proposals)")[0].level, "DRIFT"); // warned, never waved through
});

test("allowlist needs the right surface, key AND number — it cannot silence a different stale figure", () => {
  const allow = [{ surface: "/refutation-ledger", key: "records", number: 124, reason: "study denominator" }];
  assert.equal(run("5 of 124 recorded splits certify", { allow, surface: "/refutation-ledger.md" })[0].level, "ALLOWED");
  assert.equal(run("5 of 124 recorded splits certify", { allow, surface: "/divergences" })[0].level, "FAIL");
  assert.equal(run("5 of 130 recorded splits certify", { allow, surface: "/refutation-ledger.md" })[0].level, "FAIL");
});

test("'100+' is a lower bound; years and document lengths are not corpus figures", () => {
  assert.equal(run("Index of every recorded split (100+ records)")[0].level, "PASS");
  assert.equal(run("is contested by 2025 work: Wollschläger et al.").length, 0);
  assert.equal(run("This file is about 6,100 words long").length, 0);
  assert.equal(run("A corpus of ~530K words")[0].level, "PASS");
  assert.equal(run("A corpus of ~480K words")[0].level, "FAIL");
});

test("toText keeps JSON-LD (a no-JS reader's main source), drops executable script/style, strips markers", () => {
  const html = `<style>.x{}</style><script>var records = 999 splits;</script>
    <script type="application/ld+json">{"description":"175 records hold 902 verbatim model answers"}</script>
    <p>Live: <!--live:works-->573<!--/live--> works</p>`;
  const hits = extract(toText(html, { html: true })).map((h) => `${h.number} ${h.key}`).sort();
  assert.deepEqual(hits, ["175 records", "573 works", "902 answers"]);
});

test("truthFrom pins release answers and accepts ring + seed sub-counts as works", () => {
  assert.deepEqual(truth.answers.sort(), [858, 902]);
  for (const n of [573, 568, 116, 187, 17, 253]) assert.ok(truth.works.includes(n), String(n));
  assert.deepEqual(truth.tools.sort((a, b) => a - b), [11, 12, 14]);
});
