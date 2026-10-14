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
//   node scripts/check-surface-currency.mjs --scope front|engine|hf|all   # gate only the surfaces a deploy owns
//
// (2026-10-14) A slow or unreachable source is a WARN, never a crash: the registry search takes ~20s
// and sometimes stalls, and the old script died on its 60s timeout and reported nothing at all.
//
// FAIL = a surface states something the manifest/registry contradicts (wrong prose/claim, or a
//        count more than COUNT_TOLERANCE_PCT off).
// WARN = stale by age/drift but not wrong (a count a few records behind, an immutable HF release
//        trailing the live store, an unstamped build).
const ENGINE = process.env.OMNARAI_BASE || "https://engine.omnarai.org";
const FRONT = "https://omnarai.org";
const HF = "https://huggingface.co/datasets/TheRealmsOfOmnarai";
const H = { "x-omnarai-self": "1" };
const AS_JSON = process.argv.includes("--json");
const SCOPE = process.argv.includes("--scope") ? process.argv[process.argv.indexOf("--scope") + 1] : "all";
if (!["front", "engine", "hf", "all"].includes(SCOPE)) { console.error(`unknown --scope ${SCOPE} (front|engine|hf|all)`); process.exit(64); }
const inScope = (s) => SCOPE === "all" || SCOPE === s;
const WORDS = { 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten" };
const MAX_CARD_AGE_DAYS = 45;
const MAX_RELEASE_DRIFT = 40; // live Atlas records beyond the published release before we nag
const COUNT_TOLERANCE_PCT = 5; // a count this close to live is a WARN (refresh when convenient), beyond it a FAIL

const get = async (u, json = false) => {
  const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${u} → ${r.status}`);
  return json ? r.json() : r.text();
};
const results = [];
// A source we could not read is not judged — and is said out loud (never silently skipped).
const tryGet = async (u, json = false) => {
  try { return await get(u, json); }
  catch (e) { results.push({ level: "WARN", surface: u.replace(ENGINE, "engine").replace(FRONT, "omnarai.org").slice(0, 34), msg: `unreachable (${e.message}) — not judged` }); return null; }
};
const note = (level, surface, msg) => results.push({ level, surface, msg });
// Counts drift a little between refreshes (the daily cron adds Atlas records; the front door is
// redeployed by hand), so a small gap is advisory and a large one is a failure. Prose and claims
// (refuted-count word, release version) stay exact via eq().
const near = (surface, what, got, want, remedy = "") => {
  const g = Number(got), w = Number(want);
  if (String(got) === String(want)) return note("PASS", surface, `${what}: ${got} = ${want}`);
  if (Number.isFinite(g) && w && Math.abs(g - w) / w <= COUNT_TOLERANCE_PCT / 100)
    return note("WARN", surface, `${what}: ${got} vs live ${want} — ${g - w > 0 ? "+" : ""}${g - w}, within ${COUNT_TOLERANCE_PCT}%${remedy ? "; " + remedy : ""}`);
  note("FAIL", surface, `${what}: ${got} ≠ live ${want}${remedy ? " — " + remedy : ""}`);
};
const eq = (surface, what, got, want) =>
  note(String(got) === String(want) ? "PASS" : "FAIL", surface, `${what}: ${got} ${String(got) === String(want) ? "=" : "≠ live"} ${want}`);

const [manifest, claims, front, hfText, hfAtlas, llms, ctx, divs, health] = await Promise.all([
  tryGet(`${ENGINE}/api/manifest`, true), tryGet(`${ENGINE}/claims.json`, true), inScope("front") ? tryGet(`${FRONT}/`) : null,
  inScope("hf") ? tryGet(`${HF}/realms-of-omnarai/raw/main/README.md`) : null, inScope("hf") ? tryGet(`${HF}/omnarai-divergence-atlas/raw/main/README.md`) : null,
  inScope("engine") ? tryGet(`${ENGINE}/llms.txt`) : null, inScope("engine") ? tryGet(`${ENGINE}/omnarai.context.md`) : null,
  tryGet(`${ENGINE}/api/divergences`, true), inScope("engine") ? tryGet(`${ENGINE}/api/health`, true) : null,
]);
if (!manifest || !claims || !divs) { console.log("  🟡 INCONCLUSIVE: live manifest/claims/divergences unreachable — nothing was judged."); process.exit(2); }
const works = manifest.counts.corpus.total_works;
const words = manifest.counts.corpus.total_words;
const atlasLive = manifest.counts.atlas.live_records;
const answers = manifest.counts.atlas.verbatim_answers;
const rel = manifest.published_releases?.divergence_atlas || {};
const refuted = (claims.claims || []).filter((c) => c.evidence_level === "refuted").length;
const refutedWord = WORDS[refuted] || String(refuted);
const untested = atlasLive - divs.tested_count;

// ── front door (static text = what AI readers and crawlers see)
if (front) {
  const S = "omnarai.org /";
  const m = (re) => front.match(re)?.[1];
  const fix = "refresh with omnarai-home/deploy.sh";
  near(S, "static records", m(/data-live="records">(\d+)/), atlasLive, fix);
  near(S, "static untested", m(/data-live="untested">(\d+)/), untested, fix);
  const jl = front.match(/(\d+) records hold (\d+) verbatim model answers/);
  near(S, "JSON-LD records", jl?.[1], atlasLive, fix); near(S, "JSON-LD answers", jl?.[2], answers, fix);
  const w = front.match(/(\w+) of this project's own load-bearing ideas were tested/)?.[1];
  eq(S, "refuted-count word", w, refutedWord);
  near(S, "corpus works (JSON-LD)", front.match(/corpus of (\d+) works/)?.[1], works, "refresh with omnarai-home/deploy.sh");
}
// ── HF text mirror card
if (hfText) {
  const S = "HF realms-of-omnarai card";
  near(S, "live engine total works", hfText.match(/\*\*Live engine total works\*\* \| (\d+)/)?.[1], works, "re-sync the HF card");
  eq(S, "refuted-count word", hfText.match(/(\w+) of its most attractive ideas/)?.[1], refutedWord);
  const synced = hfText.match(/Last synced from live engine: (\d{4}-\d{2}-\d{2})/)?.[1];
  const age = synced ? Math.round((Date.now() - Date.parse(synced)) / 86400000) : null;
  note(age !== null && age <= MAX_CARD_AGE_DAYS ? "PASS" : "WARN", S, `last synced ${synced} (${age}d ago; limit ${MAX_CARD_AGE_DAYS}d)`);
  const pointer = hfText.match(/v(\d+\.\d+\.\d+), all (\d+) records/);
  eq(S, "points at Atlas release", `v${pointer?.[1]} / ${pointer?.[2]}`, `v${rel.version} / ${rel.records}`);
}
// ── HF Atlas card vs the manifest's published release
if (hfAtlas) {
  const S = "HF omnarai-divergence-atlas card";
  const c = hfAtlas.match(/\*\*Version:\*\* v(\d+\.\d+\.\d+) · \*\*Records:\*\* (\d+)/);
  eq(S, "card version", c?.[1], rel.version); eq(S, "card records", c?.[2], rel.records);
  const drift = atlasLive - Number(c?.[2] || 0);
  note(drift <= MAX_RELEASE_DRIFT ? "PASS" : "WARN", S, `live store is ${drift} record(s) ahead of the published release (nag above ${MAX_RELEASE_DRIFT})`);
  note(/refuted/i.test(hfAtlas) ? "PASS" : "FAIL", S, "card records that the founding premise was refuted");
}
// ── engine machine-facing text
for (const [name, txt] of [["engine /llms.txt", llms], ["engine /omnarai.context.md", ctx]])
  if (txt) near(name, "corpus works", txt.match(/(\d+) works \(~/)?.[1], works, "redeploy the engine");
// ── which build is live (stamped by deploy.sh)
if (health) {
  const v = String(health.version || "");
  note(/^\d{4}\.\d{2}\.\d{2}\+\w+$/.test(v) ? "PASS" : "WARN", "engine /api/health", `build stamp: ${v || "(none)"}`);
}
// ── distribution channels agree with each other
if (inScope("hf")) {
  const npm = (await tryGet("https://registry.npmjs.org/omnarai-mcp/latest", true))?.version;
  const regDoc = await tryGet("https://registry.modelcontextprotocol.io/v0/servers?search=omnarai&limit=50", true);
  const reg = regDoc?.servers?.filter((s) => s._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest)[0]?.server.version;
  if (npm && reg) eq("npm vs MCP registry", "latest version", reg, npm);
}

const fails = results.filter((r) => r.level === "FAIL").length, warns = results.filter((r) => r.level === "WARN").length;
if (AS_JSON) console.log(JSON.stringify({ works, words, atlasLive, refuted, fails, warns, results }, null, 1));
else {
  console.log(`\n  SURFACE CURRENCY — live truth: ${works} works · ${words.toLocaleString()} words · Atlas ${atlasLive} · ${refuted} refuted\n`);
  for (const r of results) console.log(`  ${{ PASS: "✅", FAIL: "🔴", WARN: "🟡" }[r.level]}  ${r.surface.padEnd(34)} ${r.msg}`);
  console.log(`\n  ${fails ? "🔴" : "🟢"} ${fails} fail · ${warns} warn · ${results.length - fails - warns} pass\n`);
}
process.exit(fails ? 1 : 0);
