// The Balance tracker's audit, against a FAKE internet where we plant faults and check it notices — a tracker that
// always says "in balance" would be worse than none.   node --test scripts/test-surface-audit.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAudit, publicReport, summarize } from "../api/_surface-audit.js";

const E = "https://engine.omnarai.org", F = "https://omnarai.org", HF = "https://huggingface.co/datasets/TheRealmsOfOmnarai";
const TOOLS = ["omnarai_context", "omnarai_divergence", "omnarai_inquiry_brief", "omnarai_query", "omnarai_trace", "omnarai_job", "omnarai_council", "omnarai_orient", "omnarai_footprints", "omnarai_concordance", "omnarai_inheritance", "omnarai_info"];

// ── a consistent world ────────────────────────────────────────────────────────────────────────────────────
const manifest = {
  counts: { corpus: { total_works: 573, seed_works: 568, merged_proposals: 5, total_words: 530406, rings: { core: 116, curated: 187, open: 17, media: 253 } },
    atlas: { live_records: 175, verbatim_answers: 902, tension_axes: 496 }, concept_graph: { nodes: 61, edges: 164 } },
  published_releases: { divergence_atlas: { version: "1.2.0", records: 166, verbatim_answers: 858 } },
  domains: { questions: { canonical_questions: 129 } },
};
const stats = { atlas: { recorded: 175, tested: 47, untested: 128, certified: 6, certified_strongest: 2, tier_distribution: { C0: 169, C1: 4, C3: 2 }, verbatim_answers: 902, tension_axes: 496 },
  corpus: { works: 573, words: 530406, lineages: 8 }, mcp: { remote: 12, stdio_default: 11, stdio_opt_in: 3 } };
const claims = { claims: Array.from({ length: 6 }, () => ({ evidence_level: "refuted" })) };

const frontHome = (o = {}) => `<html><script type="application/ld+json">{"description":"${o.records ?? 175} records hold ${o.answers ?? 902} verbatim model answers across 496 tension axes. Of the 47 records put through perturbation testing, 4 are paraphrase-robust and 2 clear both."}</script>
<body><p><span data-live="records">${o.records ?? 175}</span> cross-model splits recorded. <span data-live="tested">47</span> tested, <span data-live="certified">6</span> certified, <span data-live="certified_strong">2</span> strongest, <span data-live="untested">${o.untested ?? 128}</span> untested.</p>
<p>${o.word ?? "Six"} of this project's own load-bearing ideas were tested and did not hold. A corpus of 573 works.</p></body></html>`;
const explore = (tools = 12) => `<html><body><a href="https://engine.omnarai.org/api/mcp"><span>engine.omnarai.org/api/mcp</span> — paste into any MCP client. <span data-live="tools">${tools}</span> tools, no key.</a> <span data-live="works">573</span></body></html>`;
const hfAtlas = `# Atlas\n**Version:** v1.2.0 · **Records:** 166\n**47 of 166 records have now been through the harness.** The premise was refuted.`;
const hfText = `| **Live engine total works** | 573 |\nSix of its most attractive ideas were refuted. Last synced from live engine: 2026-10-10. Atlas v1.2.0, all 166 records.`;

function world(over = {}) {
  const j = (o) => ({ status: 200, body: JSON.stringify(o) });
  const t = (s) => ({ status: 200, body: s });
  const routes = {
    [`${E}/api/manifest`]: j(manifest), [`${E}/api/stats`]: j(stats), [`${E}/claims.json`]: j(claims),
    [`${E}/api/divergences`]: j({ tested_count: 47 }), [`${E}/api/health`]: j({ version: "2026.10.14+abc1234" }),
    [`${F}/sitemap.xml`]: t(`<urlset><loc>${F}/</loc><loc>${F}/explore</loc></urlset>`),
    [`${E}/sitemap.xml`]: t(`<urlset><loc>${E}/llms.txt</loc></urlset>`),
    [`${F}/`]: t(frontHome()), [`${F}/explore`]: t(explore()), [`${F}/llms.txt`]: t("573 works"),
    [`${E}/llms.txt`]: t(`**Current corpus:** 573 works (~530K words). ${TOOLS.join(" ")}`),
    [`${E}/omnarai.context.md`]: t("**Corpus:** 573 works (~530K words)"),
    [`${HF}/omnarai-divergence-atlas/raw/main/README.md`]: t(hfAtlas), [`${HF}/realms-of-omnarai/raw/main/README.md`]: t(hfText),
    "https://registry.npmjs.org/omnarai-mcp": j({ readme: "ships as eleven tools" }), "https://registry.npmjs.org/omnarai-mcp/latest": j({ version: "1.9.0" }),
    [`POST ${E}/api/mcp`]: t(`data: ${JSON.stringify({ result: { tools: TOOLS.map((name) => ({ name })) } })}`),
    ...over,
  };
  return async (url, init = {}) => {
    const key = init.method === "POST" ? `POST ${url}` : url;
    let hit = routes[key];
    if (hit === undefined) hit = { status: 200, body: "" }; // any other listed surface: present but says nothing countable
    if (hit instanceof Error) throw hit;
    return { ok: hit.status < 400, status: hit.status, headers: { get: () => "text/plain" }, text: async () => hit.body };
  };
}
const audit = (over, extra = {}) => runAudit({ fetchFn: world(over), now: () => Date.parse("2026-10-14T12:00:00Z"), timeoutMs: 500, ...extra });

test("a consistent world is IN BALANCE with zero discrepancies, and says what it checked", async () => {
  const r = await audit();
  assert.equal(r.status, "in_balance");
  assert.equal(r.summary.out_of_sync, 0);
  assert.equal(r.summary.not_checked, 0);
  assert.ok(r.summary.surfaces_checked >= 8 && r.summary.facts_checked >= 20, JSON.stringify(r.summary));
});

test("the 2026-10-14 front-door defect is caught — and counted ONCE, not once per layer", async () => {
  // the shipped state: data-live fallbacks, JSON-LD records and prose all said 166 while live was 175
  const r = await audit({ [`${F}/`]: { status: 200, body: frontHome({ records: 166, untested: 119 }) } });
  assert.equal(r.status, "out_of_sync");
  const rec = r.facts.filter((g) => g.surface === "front:/" && g.quantity === "records" && (g.level === "fail" || g.level === "drift"));
  assert.equal(rec.length, 1, "one underlying discrepancy, however many checks saw it");
  assert.ok(rec[0].layers.length >= 2, `seen by several layers: ${rec[0].layers}`);
  assert.ok(r.summary.surfaces_out_of_sync.includes("front:/"));
  assert.match(rec[0].remedy, /omnarai-home\/deploy\.sh/);
});

test("lagging (within 5%) counts as OUT OF SYNC for the tracker but is not STALE", async () => {
  const r = await audit({ [`${F}/`]: { status: 200, body: frontHome({ records: 172 }) } }); // 1.7% behind
  assert.equal(r.status, "out_of_sync");
  assert.equal(r.summary.stale, 0);
  assert.ok(r.summary.lagging >= 1);
  const pub = publicReport(r);
  assert.ok(pub.discrepancies.every((d) => d.kind === "lagging"));
  assert.match(pub.headline, /out of sync/);
});

test("a wrong claim word and a wrong tool count are stale (exact, never lagging)", async () => {
  const r = await audit({ [`${F}/`]: { status: 200, body: frontHome({ word: "Four" }) }, [`${F}/explore`]: { status: 200, body: explore(8) } });
  const stale = r.facts.filter((g) => g.level === "fail");
  assert.ok(stale.some((g) => g.quantity === "refuted_word" && g.got === "Four"));
  assert.ok(stale.some((g) => g.quantity === "tools" && g.surface === "front:/explore" && g.got === "8"));
});

test("an unreachable source is NOT CHECKED — never counted as balanced, never hidden, and does not flip status", async () => {
  const r = await audit({ [`${E}/omnarai.context.md`]: { status: 500, body: "" } });
  assert.equal(r.summary.not_checked, 1);
  assert.equal(r.status, "in_balance"); // nothing found out of sync…
  const pub = publicReport(r);
  assert.equal(pub.not_checked[0].source, "/omnarai.context.md"); // …but the gap is stated
  assert.ok(!r.summary.surfaces_out_of_sync.includes("/omnarai.context.md"));
});

test("a thrown network error is handled as unreachable, not a crash", async () => {
  const r = await audit({ [`${HF}/realms-of-omnarai/raw/main/README.md`]: new Error("ECONNRESET") });
  assert.equal(r.summary.not_checked, 1);
});

test("if live TRUTH cannot be read, the audit refuses to judge and reports UNKNOWN — never balance from ignorance", async () => {
  const r = await audit({ [`${E}/api/manifest`]: { status: 503, body: "" } });
  assert.equal(r.status, "unknown");
  assert.match(r.reason, /manifest/);
  const pub = publicReport(r);
  assert.equal(pub.headline, "Not able to check right now");
  assert.equal(pub.discrepancies.length, 0);
});

test("allowlisted history is listed publicly with its reason and is NOT a discrepancy", async () => {
  const r = await audit({ [`${E}/refutation-ledger.md`]: { status: 200, body: "Of 124 recorded splits, 5 certify." }, [`${E}/sitemap.xml`]: { status: 200, body: `<loc>${E}/refutation-ledger.md</loc>` } });
  assert.equal(r.status, "in_balance");
  const pub = publicReport(r);
  assert.equal(pub.allowlisted_history.length, 1);
  assert.match(pub.allowlisted_history[0].why, /Denominator/);
});

test("public report carries its own definition, its coverage limits and its source", async () => {
  const pub = publicReport(await audit());
  assert.equal(pub.headline, "In balance");
  assert.ok(pub.definition.out_of_sync && pub.definition.not_checked);
  assert.ok(pub.not_covered.length >= 4);
  assert.match(pub.source, /_surface-audit\.js/);
  assert.equal(publicReport(await audit(), { detail: "all" }).all_facts.length > 0, true);
});

test("summarize dedupes by (surface, quantity, stated value) and keeps the worst level", () => {
  const f = (layer, level) => ({ layer, surface: "front:/", quantity: "records", got: "166", want: "175", level });
  const { summary } = summarize([f("numbers", "fail"), f("stats", "drift"), f("currency", "fail")], ["front:/"]);
  assert.equal(summary.out_of_sync, 1);
  assert.equal(summary.stale, 1);
});
