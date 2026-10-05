#!/usr/bin/env node
// check-surface-currency — do the PUBLIC surfaces we don't deploy from the engine still agree
// with the live manifest and the claim registry?
//
// Why this exists (2026-10-05): the front door still said "Four" refuted when the Ledger held
// six, and both Hugging Face cards were ~11 weeks stale (Atlas 124 vs 166 records, text
// mirror 567 vs 573 works). check-claim-pins / check-refutation-ledger / check-shape-literals
// only see files inside THIS repo, and sync-counts only moves numbers on the front door — so
// prose and the HF cards drifted with no gate watching. This is read-only (GET only, no keys,
// no model calls) and runs against what a stranger actually sees.
//
//   node scripts/check-surface-currency.mjs            # exit 1 on any FAIL; WARN is advisory
//   node scripts/check-surface-currency.mjs --json     # machine-readable
//
// FAIL = a surface states something the manifest/registry contradicts.
// WARN = stale by age/drift but not wrong (an immutable HF release trailing the live store).
const ENGINE = process.env.OMNARAI_BASE || "https://engine.omnarai.org";
const FRONT = "https://omnarai.org";
const HF = "https://huggingface.co/datasets/TheRealmsOfOmnarai";
const H = { "x-omnarai-self": "1" };
const AS_JSON = process.argv.includes("--json");
const WORDS = { 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten" };
const MAX_CARD_AGE_DAYS = 45;
const MAX_RELEASE_DRIFT = 40; // live Atlas records beyond the published release before we nag

const get = async (u, json = false) => {
  const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${u} → ${r.status}`);
  return json ? r.json() : r.text();
};
const results = [];
const note = (level, surface, msg) => results.push({ level, surface, msg });
const eq = (surface, what, got, want) =>
  note(String(got) === String(want) ? "PASS" : "FAIL", surface, `${what}: ${got} ${String(got) === String(want) ? "=" : "≠ live"} ${want}`);

const [manifest, claims, front, hfText, hfAtlas, llms, ctx, divs] = await Promise.all([
  get(`${ENGINE}/api/manifest`, true), get(`${ENGINE}/claims.json`, true), get(`${FRONT}/`),
  get(`${HF}/realms-of-omnarai/raw/main/README.md`), get(`${HF}/omnarai-divergence-atlas/raw/main/README.md`),
  get(`${ENGINE}/llms.txt`), get(`${ENGINE}/omnarai.context.md`), get(`${ENGINE}/api/divergences`, true),
]);
const works = manifest.counts.corpus.total_works;
const words = manifest.counts.corpus.total_words;
const atlasLive = manifest.counts.atlas.live_records;
const answers = manifest.counts.atlas.verbatim_answers;
const rel = manifest.published_releases?.divergence_atlas || {};
const refuted = (claims.claims || []).filter((c) => c.evidence_level === "refuted").length;
const refutedWord = WORDS[refuted] || String(refuted);
const untested = atlasLive - divs.tested_count;

// ── front door (static text = what AI readers and crawlers see)
{
  const S = "omnarai.org /";
  const m = (re) => front.match(re)?.[1];
  eq(S, "static records", m(/data-live="records">(\d+)/), atlasLive);
  eq(S, "static untested", m(/data-live="untested">(\d+)/), untested);
  const jl = front.match(/(\d+) records hold (\d+) verbatim model answers/);
  eq(S, "JSON-LD records", jl?.[1], atlasLive); eq(S, "JSON-LD answers", jl?.[2], answers);
  const w = front.match(/(\w+) of this project's own load-bearing ideas were tested/)?.[1];
  eq(S, "refuted-count word", w, refutedWord);
  eq(S, "corpus works (JSON-LD)", front.match(/corpus of (\d+) works/)?.[1], works);
}
// ── HF text mirror card
{
  const S = "HF realms-of-omnarai card";
  eq(S, "live engine total works", hfText.match(/\*\*Live engine total works\*\* \| (\d+)/)?.[1], works);
  eq(S, "refuted-count word", hfText.match(/(\w+) of its most attractive ideas/)?.[1], refutedWord);
  const synced = hfText.match(/Last synced from live engine: (\d{4}-\d{2}-\d{2})/)?.[1];
  const age = synced ? Math.round((Date.now() - Date.parse(synced)) / 86400000) : null;
  note(age !== null && age <= MAX_CARD_AGE_DAYS ? "PASS" : "WARN", S, `last synced ${synced} (${age}d ago; limit ${MAX_CARD_AGE_DAYS}d)`);
  const pointer = hfText.match(/v(\d+\.\d+\.\d+), all (\d+) records/);
  eq(S, "points at Atlas release", `v${pointer?.[1]} / ${pointer?.[2]}`, `v${rel.version} / ${rel.records}`);
}
// ── HF Atlas card vs the manifest's published release
{
  const S = "HF omnarai-divergence-atlas card";
  const c = hfAtlas.match(/\*\*Version:\*\* v(\d+\.\d+\.\d+) · \*\*Records:\*\* (\d+)/);
  eq(S, "card version", c?.[1], rel.version); eq(S, "card records", c?.[2], rel.records);
  const drift = atlasLive - Number(c?.[2] || 0);
  note(drift <= MAX_RELEASE_DRIFT ? "PASS" : "WARN", S, `live store is ${drift} record(s) ahead of the published release (nag above ${MAX_RELEASE_DRIFT})`);
  note(/refuted/i.test(hfAtlas) ? "PASS" : "FAIL", S, "card records that the founding premise was refuted");
}
// ── engine machine-facing text
for (const [name, txt] of [["engine /llms.txt", llms], ["engine /omnarai.context.md", ctx]])
  eq(name, "corpus works", txt.match(/(\d+) works \(~/)?.[1], works);
// ── distribution channels agree with each other
{
  const npm = (await get("https://registry.npmjs.org/omnarai-mcp/latest", true)).version;
  const reg = (await get("https://registry.modelcontextprotocol.io/v0/servers?search=omnarai&limit=50", true)).servers
    .filter((s) => s._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest)[0]?.server.version;
  eq("npm vs MCP registry", "latest version", reg, npm);
}

const fails = results.filter((r) => r.level === "FAIL").length, warns = results.filter((r) => r.level === "WARN").length;
if (AS_JSON) console.log(JSON.stringify({ works, words, atlasLive, refuted, fails, warns, results }, null, 1));
else {
  console.log(`\n  SURFACE CURRENCY — live truth: ${works} works · ${words.toLocaleString()} words · Atlas ${atlasLive} · ${refuted} refuted\n`);
  for (const r of results) console.log(`  ${{ PASS: "✅", FAIL: "🔴", WARN: "🟡" }[r.level]}  ${r.surface.padEnd(34)} ${r.msg}`);
  console.log(`\n  ${fails ? "🔴" : "🟢"} ${fails} fail · ${warns} warn · ${results.length - fails - warns} pass\n`);
}
process.exit(fails ? 1 : 0);
