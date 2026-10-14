// THE audit: "do all of Omnarai's public surfaces agree with the live numbers?"
//
// ONE implementation, two consumers — so the public tracker can never say 0 while a gate says 3:
//   • GET /api/sync (api/info.js ?_view=sync)  → the public Balance tracker on omnarai.org
//   • scripts/check-surfaces.mjs                → deploy gates (--scope engine|front) + the weekly check
// Underscore filename ⇒ a shared module, not a deployed function (Hobby plan: 12-function cap).
//
// Three layers, each catching what the others cannot (2026-10-14 audit):
//   numbers   every counted figure ("175 splits", "Twelve tools") in every public text surface — the NET
//   stats     the structured figures: data-live fallbacks, JSON-LD, MCP tool counts, HF release pins
//   currency  prose + claim currency: refuted-count word, release pointer, build stamp, card age, npm/registry
// Surfaces are read as RAW BYTES — no JavaScript — because that is how crawlers and AI fetchers read them.
//
// What a "discrepancy" is (published verbatim by the tracker — keep this honest):
//   stale    a surface states a figure/claim that differs from live by more than 5%, or is wrong in kind
//   lagging  a baked figure within 5% of live (the daily cron grows the Atlas; pages baked at deploy time lag)
//   Both count as OUT OF SYNC. Dated/versioned snapshots and allowlisted history do not — they are correct by
//   construction, and the allowlist (with reasons) is public too. A source we could not read is NOT CHECKED:
//   it is never counted as balanced, and never hidden.
import { toText, extract, judge, truthFrom } from "./_surface-numbers.js";
import { ALLOWLIST } from "./_surface-allowlist.js";

export const AUDIT_VERSION = "1.0.0";
export const DEFAULTS = {
  engine: "https://engine.omnarai.org",
  front: "https://omnarai.org",
  hf: "https://huggingface.co/datasets/TheRealmsOfOmnarai",
};
const HEADERS = { "x-omnarai-self": "1", "user-agent": "omnarai-surface-audit/1" }; // self-marked: never counted as visitor traffic
const REFUTED_WORD = { 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten" };
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];
const TOL_PCT = 5;            // within this a baked count is LAGGING; beyond it, STALE
const MAX_CARD_AGE_DAYS = 45; // advisory
const MAX_RELEASE_LAG = 40;   // advisory: live Atlas records beyond the published release before we nag
const RANK = { fail: 5, drift: 4, unreachable: 3, note: 2, allowed: 1, labeled: 0, pass: 0 };
const LEVEL_OF = { PASS: "pass", LABELED: "labeled", ALLOWED: "allowed", DRIFT: "drift", FAIL: "fail" };

const num = (s) => Number(String(s).replace(/,/g, ""));
const wordOrNum = (s) => (NUMBER_WORDS.indexOf(String(s).toLowerCase()) >= 0 ? NUMBER_WORDS.indexOf(String(s).toLowerCase()) : num(s));

function makeCtx(opts) {
  const base = { ...DEFAULTS, ...(opts.base || {}) };
  const c = {
    scope: "all", layers: ["numbers", "stats", "currency"], registry: false,
    timeoutMs: 12000, registryTimeoutMs: 30000, deadlineMs: 50000, concurrency: 8,
    fetchFn: globalThis.fetch, allowlist: ALLOWLIST, now: () => Date.now(),
    ...opts, base,
  };
  c.truthBase = opts.truthBase || DEFAULTS.engine;
  c.t0 = c.now();
  c.memo = new Map();
  c.findings = [];
  c.surfacesRead = new Set();
  c.inScope = (s) => c.scope === "all" || c.scope === s;
  return c;
}

// ── fetching: never throws; memoized so layers share one read of each page ────────────────────────────────
function fetchText(c, url, { method = "GET", body, ms, headers } = {}) {
  const key = `${method} ${url}`;
  if (method === "GET" && c.memo.has(key)) return c.memo.get(key);
  const run = async () => {
    const remaining = c.deadlineMs - (c.now() - c.t0);
    if (remaining <= 500) return { ok: false, error: "audit deadline reached" };
    const limit = Math.min(ms || c.timeoutMs, remaining);
    let last = "unknown";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await c.fetchFn(url, { method, body, headers: { ...HEADERS, ...(headers || {}) }, signal: AbortSignal.timeout(limit) });
        const text = await r.text();
        if (r.ok) return { ok: true, body: text, type: r.headers?.get?.("content-type") || "", status: r.status };
        last = `HTTP ${r.status}`;
        if (r.status < 500) break; // a 404 will not heal on retry
      } catch (e) { last = /timeout|abort/i.test(String(e?.name || e)) ? "timeout" : String(e?.message || e).slice(0, 60); }
    }
    return { ok: false, error: last };
  };
  const p = run();
  if (method === "GET") c.memo.set(key, p);
  return p;
}
const fetchJson = async (c, url, o) => {
  const r = await fetchText(c, url, o);
  if (!r.ok) return r;
  try { return { ...r, json: JSON.parse(r.body) }; } catch { return { ok: false, error: "not JSON" }; }
};
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ── labels + findings ─────────────────────────────────────────────────────────────────────────────────────
export function labelOf(url, base = DEFAULTS) {
  if (url.startsWith(base.hf)) return "hf:/" + url.slice(base.hf.length).replace(/^\//, "").replace(/\/raw\/main\/README\.md$/, "");
  if (url.startsWith("https://registry.npmjs.org/")) return "npm:" + url.slice("https://registry.npmjs.org/".length).split("/")[0];
  if (url.startsWith(base.front)) return "front:" + (url.slice(base.front.length) || "/").replace(/\.html$/, "");
  const stripped = url.startsWith(base.engine) ? url.slice(base.engine.length) : url.replace(/^https?:\/\/[^/]+/, "");
  return (stripped || "/").replace(/\.html$/, "");
}
const REMEDY = (label) =>
  label.startsWith("front:") ? "front door: run omnarai-home/deploy.sh (sync-counts.mjs bakes the numbers)"
    : label.startsWith("hf:") ? "re-sync the Hugging Face card (hand-maintained; see CLAUDE.md refresh recipe)"
      : label.startsWith("npm:") ? "publish or correct the npm package"
        : "redeploy the engine (scripts/sync-doc-counts.py + <!--live:KEY--> markers)";

function add(c, layer, f) {
  // got/want are ALWAYS strings (spread first, then normalise) so the dedupe key and the public JSON are type-stable.
  c.findings.push({ layer, ...f, got: f.got == null ? "" : String(f.got), want: f.want == null ? "" : String(f.want) });
}
// numeric comparison: exact → pass, within tolerance → drift (lagging), beyond → fail (stale)
function near(c, layer, surface, quantity, check, got, want, remedy) {
  const g = Number(got), w = Number(want);
  let level = "fail";
  if (String(got) === String(want)) level = "pass";
  else if (Number.isFinite(g) && w && Math.abs(g - w) / w <= TOL_PCT / 100) level = "drift";
  add(c, layer, { surface, quantity, check, got, want, level, remedy: level === "pass" ? undefined : remedy || REMEDY(surface) });
}
function exact(c, layer, surface, quantity, check, got, want, remedy) {
  const ok = String(got) === String(want);
  add(c, layer, { surface, quantity, check, got, want, level: ok ? "pass" : "fail", remedy: ok ? undefined : remedy || REMEDY(surface) });
}
const unreachable = (c, layer, surface, error) =>
  add(c, layer, { surface, quantity: "reachability", check: "source readable", got: error, want: "reachable", level: "unreachable" });
const noteF = (c, layer, surface, quantity, check, ok, detail) =>
  add(c, layer, { surface, quantity, check, got: ok ? "ok" : "advisory", want: "ok", level: ok ? "pass" : "note", detail });

const read = async (c, layer, url, { json = false } = {}) => {
  const r = json ? await fetchJson(c, url) : await fetchText(c, url);
  if (!r.ok) { unreachable(c, layer, labelOf(url, c.base), r.error); return null; }
  c.surfacesRead.add(labelOf(url, c.base));
  return json ? r.json : r.body;
};

// ── layer 1: numbers (the net) ────────────────────────────────────────────────────────────────────────────
async function sitemapUrls(c, base) {
  const r = await fetchText(c, `${base}/sitemap.xml`);
  return r.ok ? [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]) : [];
}
async function numbersLayer(c, truth) {
  const b = c.base;
  const lists = {
    front: async () => [...(await sitemapUrls(c, b.front)), `${b.front}/`, `${b.front}/explore`, `${b.front}/llms.txt`],
    engine: async () => [...(await sitemapUrls(c, b.engine)),
      ...["/for-researchers.html", "/divergences.html", "/try.html", "/omnai.md", "/release-manifest.md", "/evidence-status.md", "/omnarai-cold-start.md",
        "/omnarai.context.md", "/llms.txt", "/limitations.md", "/refutation-ledger.md", "/mcp-access-policy.md", "/openapi.json", "/api/agent-entry"].map((p) => b.engine + p)],
    hf: async () => [`${b.hf}/realms-of-omnarai/raw/main/README.md`, `${b.hf}/omnarai-divergence-atlas/raw/main/README.md`],
  };
  const scopes = c.scope === "all" ? ["front", "engine", "hf"] : [c.scope];
  const urls = [...new Set((await Promise.all(scopes.map((s) => lists[s]()))).flat())];
  await pool(urls, c.concurrency, async (url) => {
    const r = await fetchText(c, url);
    const surface = labelOf(url, b);
    if (!r.ok) return unreachable(c, "numbers", surface, r.error);
    c.surfacesRead.add(surface);
    const html = /html/i.test(r.type) || /<html|<!doctype/i.test(r.body.slice(0, 400));
    for (const hit of extract(toText(r.body, { html }))) {
      const v = judge(hit, truth, c.allowlist, surface);
      const level = LEVEL_OF[v.level];
      add(c, "numbers", {
        surface, quantity: hit.key, check: hit.raw, got: hit.number,
        want: hit.key === "words" ? truth.words : truth[hit.key]?.[0], level,
        remedy: level === "fail" || level === "drift" ? REMEDY(surface) : undefined,
        detail: level === "allowed" || level === "drift" ? v.why : undefined,
      });
    }
  });
}

// ── layer 2: structured figures ───────────────────────────────────────────────────────────────────────────
const LIVE_KEY_QUANTITY = { works: "works", words: "words", lineages: "lineages", records: "records", tested: "tested", certified: "certified", certified_strong: "c3", untested: "untested", tools: "tools" };
async function statsLayer(c, S, manifest) {
  const b = c.base, A = S.atlas, C = S.corpus;
  if (c.inScope("front")) {
    const LIVE = { works: C.works, words: C.words, lineages: C.lineages, records: A.recorded, tested: A.tested, certified: A.certified,
      certified_strong: A.certified_strongest, untested: A.untested, tools: S.mcp?.remote };
    for (const path of ["/", "/explore"]) {
      const html = await read(c, "stats", b.front + path); if (html === null) continue;
      const surface = labelOf(b.front + path, b);
      for (const [, key, val] of html.matchAll(/data-live="([a-z_]+)">([^<]*)</g)) {
        if (LIVE[key] == null) continue;
        (key === "tools" ? exact : near)(c, "stats", surface, LIVE_KEY_QUANTITY[key] || key, `data-live ${key}`, num(val), LIVE[key]);
      }
      const ld = html.match(/(\d[\d,]*) records hold (\d[\d,]*) verbatim model answers across (\d[\d,]*) tension axes/);
      if (ld) {
        near(c, "stats", surface, "records", "JSON-LD records", num(ld[1]), A.recorded);
        near(c, "stats", surface, "answers", "JSON-LD answers", num(ld[2]), A.verbatim_answers);
        near(c, "stats", surface, "tensions", "JSON-LD tension axes", num(ld[3]), A.tension_axes);
      }
      const lt = html.match(/of the (\d+) records put through perturbation testing, (\d+) (?:is|are) paraphrase-robust and (\d+) clears? both/);
      if (lt) {
        near(c, "stats", surface, "tested", "JSON-LD tested", lt[1], A.tested);
        near(c, "stats", surface, "c1", "JSON-LD C1", lt[2], A.tier_distribution?.C1 || 0);
        near(c, "stats", surface, "c3", "JSON-LD C3", lt[3], A.certified_strongest);
      }
    }
  }
  for (const [scope, url] of [["front", `${b.front}/llms.txt`], ["engine", `${b.engine}/llms.txt`]]) {
    if (!c.inScope(scope)) continue;
    const t = await read(c, "stats", url); if (t === null) continue;
    for (const n of new Set([...t.matchAll(/\b(\d{3}) (?:attributed )?works\b/g)].map((m) => num(m[1]))))
      near(c, "stats", labelOf(url, b), "works", `"${n} works"`, n, C.works);
  }
  const rel = manifest.published_releases?.divergence_atlas;
  if (c.inScope("hf")) {
    const card = await read(c, "stats", `${b.hf}/omnarai-divergence-atlas/raw/main/README.md`);
    const surface = "hf:/omnarai-divergence-atlas";
    if (card !== null && rel) {
      const rec = card.match(/\*\*Version:\*\* v(\d+\.\d+\.\d+) · \*\*Records:\*\* (\d+)/);
      if (rec) {
        exact(c, "stats", surface, "release_version", "card version vs manifest release", rec[1], rel.version);
        exact(c, "stats", surface, "release_records", "card records vs manifest release", rec[2], rel.records);
      } else add(c, "stats", { surface, quantity: "release_version", check: "card Version/Records line readable", got: "missing", want: "present", level: "fail", remedy: REMEDY(surface) });
    }
    const corp = await read(c, "stats", `${b.hf}/realms-of-omnarai/raw/main/README.md`);
    const lt = corp?.match(/Live engine total works\*\* \| (\d+)/);
    if (lt) near(c, "stats", "hf:/realms-of-omnarai", "works", "card live total", lt[1], C.works);
  }
  // MCP tool counts — compared PER TRANSPORT (remote 12, stdio default 11): one number would be wrong on one.
  let remote = null;
  if (c.inScope("engine") || c.inScope("front")) {
    const r = await fetchText(c, `${b.engine}/api/mcp`, { method: "POST", ms: 20000,
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    if (!r.ok) unreachable(c, "stats", "engine:/api/mcp", r.error);
    else {
      try {
        const line = r.body.split("\n").map((l) => l.replace(/^data: ?/, "")).find((l) => l.trim().startsWith("{"));
        remote = JSON.parse(line).result.tools.map((t) => t.name);
        c.surfacesRead.add("engine:/api/mcp");
      } catch { unreachable(c, "stats", "engine:/api/mcp", "unparseable tools/list"); }
    }
  }
  if (remote && c.inScope("engine")) {
    exact(c, "stats", "engine:/api/mcp", "tools", "live tools/list vs /api/stats mcp.remote", remote.length, S.mcp.remote);
    const llms = await read(c, "stats", `${b.engine}/llms.txt`);
    if (llms !== null) {
      const missing = remote.filter((n) => !llms.includes(n));
      add(c, "stats", { surface: "/llms.txt", quantity: "tool_names", check: "llms.txt names every remote tool", got: missing.length ? `missing ${missing.join(", ")}` : "all named", want: "all named", level: missing.length ? "fail" : "pass", remedy: missing.length ? REMEDY("/llms.txt") : undefined });
    }
  }
  if (c.inScope("hf")) {
    const npm = await read(c, "stats", "https://registry.npmjs.org/omnarai-mcp", { json: true });
    if (npm) {
      const rw = (npm.readme || "").match(/as (\w+) tools/i);
      if (rw) exact(c, "stats", "npm:omnarai-mcp", "tools", "npm README stdio tool count", wordOrNum(rw[1]), S.mcp.stdio_default);
      else add(c, "stats", { surface: "npm:omnarai-mcp", quantity: "tools", check: "npm README states a tool count", got: "none", want: String(S.mcp.stdio_default), level: "fail", remedy: REMEDY("npm:") });
    }
  }
  if (c.inScope("front") && (remote || S.mcp)) {
    const explore = await read(c, "stats", `${b.front}/explore`);
    if (explore !== null) {
      const flat = explore.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      const ew = flat.match(/api\/mcp[\s\S]{0,120}?\b(\w+) tools/i);
      const want = remote ? remote.length : S.mcp.remote;
      if (ew) exact(c, "stats", "front:/explore", "tools", "remote tool count", wordOrNum(ew[1]), want);
      else add(c, "stats", { surface: "front:/explore", quantity: "tools", check: "states a remote tool count", got: "none", want: String(want), level: "fail", remedy: REMEDY("front:/explore") });
    }
  }
}

// ── layer 3: prose + claim currency ───────────────────────────────────────────────────────────────────────
async function currencyLayer(c, T) {
  const b = c.base, { manifest, claims, divs, health } = T;
  const works = manifest.counts.corpus.total_works, atlasLive = manifest.counts.atlas.live_records, answers = manifest.counts.atlas.verbatim_answers;
  const rel = manifest.published_releases?.divergence_atlas || {};
  const refuted = (claims.claims || []).filter((x) => x.evidence_level === "refuted").length;
  const refutedWord = REFUTED_WORD[refuted] || String(refuted);
  const untested = atlasLive - divs.tested_count;

  if (c.inScope("front")) {
    const front = await read(c, "currency", `${b.front}/`);
    if (front !== null) {
      const S = "front:/", m = (re) => front.match(re)?.[1];
      near(c, "currency", S, "records", "static records", m(/data-live="records">(\d+)/), atlasLive);
      near(c, "currency", S, "untested", "static untested", m(/data-live="untested">(\d+)/), untested);
      const jl = front.match(/(\d+) records hold (\d+) verbatim model answers/);
      near(c, "currency", S, "records", "JSON-LD records", jl?.[1], atlasLive);
      near(c, "currency", S, "answers", "JSON-LD answers", jl?.[2], answers);
      exact(c, "currency", S, "refuted_word", "refuted-count word", front.match(/(\w+) of this project's own load-bearing ideas were tested/)?.[1], refutedWord);
      near(c, "currency", S, "works", "corpus works (JSON-LD)", front.match(/corpus of (\d+) works/)?.[1], works);
    }
  }
  if (c.inScope("hf")) {
    const hfText = await read(c, "currency", `${b.hf}/realms-of-omnarai/raw/main/README.md`);
    if (hfText !== null) {
      const S = "hf:/realms-of-omnarai";
      near(c, "currency", S, "works", "live engine total works", hfText.match(/\*\*Live engine total works\*\* \| (\d+)/)?.[1], works);
      exact(c, "currency", S, "refuted_word", "refuted-count word", hfText.match(/(\w+) of its most attractive ideas/)?.[1], refutedWord);
      const synced = hfText.match(/Last synced from live engine: (\d{4}-\d{2}-\d{2})/)?.[1];
      const age = synced ? Math.round((c.now() - Date.parse(synced)) / 86400000) : null;
      noteF(c, "currency", S, "card_age", "card sync age", age !== null && age <= MAX_CARD_AGE_DAYS, `last synced ${synced} (${age}d ago; advisory limit ${MAX_CARD_AGE_DAYS}d)`);
      const p = hfText.match(/v(\d+\.\d+\.\d+), all (\d+) records/);
      exact(c, "currency", S, "release_pointer", "points at the Atlas release", `v${p?.[1]} / ${p?.[2]}`, `v${rel.version} / ${rel.records}`);
    }
    const hfAtlas = await read(c, "currency", `${b.hf}/omnarai-divergence-atlas/raw/main/README.md`);
    if (hfAtlas !== null) {
      const S = "hf:/omnarai-divergence-atlas";
      const cc = hfAtlas.match(/\*\*Version:\*\* v(\d+\.\d+\.\d+) · \*\*Records:\*\* (\d+)/);
      exact(c, "currency", S, "release_version", "card version vs manifest release", cc?.[1], rel.version);
      exact(c, "currency", S, "release_records", "card records vs manifest release", cc?.[2], rel.records);
      const lag = atlasLive - Number(cc?.[2] || 0);
      noteF(c, "currency", S, "release_lag", "live store vs published release", lag <= MAX_RELEASE_LAG, `live store is ${lag} record(s) ahead of release v${rel.version} (advisory above ${MAX_RELEASE_LAG}) — a new immutable release is due`);
      add(c, "currency", { surface: S, quantity: "refutation_stated", check: "card records that the founding premise was refuted", got: /refuted/i.test(hfAtlas) ? "yes" : "no", want: "yes", level: /refuted/i.test(hfAtlas) ? "pass" : "fail", remedy: /refuted/i.test(hfAtlas) ? undefined : REMEDY(S) });
    }
  }
  if (c.inScope("engine")) {
    for (const p of ["/llms.txt", "/omnarai.context.md"]) {
      const txt = await read(c, "currency", b.engine + p);
      if (txt !== null) near(c, "currency", p, "works", "corpus works", txt.match(/(\d+) works \(~/)?.[1], works);
    }
    if (T.healthErr) unreachable(c, "currency", "engine:/api/health", T.healthErr);
    if (health) {
      const v = String(health.version || "");
      noteF(c, "currency", "engine:/api/health", "build_stamp", "build stamp", /^\d{4}\.\d{2}\.\d{2}\+\w+$/.test(v), `build stamp: ${v || "(none)"}`);
    }
  }
  if (c.inScope("hf") && c.registry) {
    const npm = (await fetchJson(c, "https://registry.npmjs.org/omnarai-mcp/latest")).json?.version;
    const reg = await fetchJson(c, "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.justjlee&limit=5", { ms: c.registryTimeoutMs });
    if (!reg.ok) unreachable(c, "currency", "mcp-registry", reg.error);
    else {
      const v = reg.json.servers?.filter((s) => s.server?.name === "io.github.justjlee/omnarai-mcp" && s._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest)[0]?.server.version;
      if (npm && v) exact(c, "currency", "npm vs MCP registry", "release_version", "latest version", v, npm, "publish the missing channel (npm publish / mcp-publisher)");
    }
  }
}

// ── the audit ─────────────────────────────────────────────────────────────────────────────────────────────
export async function runAudit(opts = {}) {
  const c = makeCtx(opts);
  const T = {};
  const [manifest, stats, claims, divs, health] = await Promise.all([
    fetchJson(c, `${c.truthBase}/api/manifest`), fetchJson(c, `${c.truthBase}/api/stats`), fetchJson(c, `${c.truthBase}/claims.json`),
    fetchJson(c, `${c.truthBase}/api/divergences`), c.inScope("engine") ? fetchJson(c, `${c.truthBase}/api/health`) : Promise.resolve(null),
  ]);
  const missing = Object.entries({ manifest, stats, claims, divergences: divs }).filter(([, r]) => !r.ok).map(([k, r]) => `${k} (${r.error})`);
  if (missing.length) {
    // We could not establish what is TRUE, so nothing can be judged. Never report balance from ignorance.
    return finish(c, { status: "unknown", reason: `live truth unreachable: ${missing.join(", ")}` });
  }
  Object.assign(T, { manifest: manifest.json, stats: stats.json, claims: claims.json, divs: divs.json, health: health?.ok ? health.json : null, healthErr: health && !health.ok ? health.error : null });
  const truth = truthFrom(T.manifest, T.stats);
  const layers = {
    numbers: () => numbersLayer(c, truth),
    stats: () => statsLayer(c, T.stats, T.manifest),
    currency: () => currencyLayer(c, T),
  };
  await Promise.all(c.layers.map((l) => layers[l]()));
  return finish(c, { truth: { works: T.manifest.counts.corpus.total_works, records: T.stats.atlas.recorded, answers: T.stats.atlas.verbatim_answers, tension_axes: T.stats.atlas.tension_axes, remote_tools: T.stats.mcp.remote } });
}

// One underlying discrepancy is often seen by several layers (a stale "166" on the front door is found by the
// number net, the data-live check AND the currency check). Count it ONCE: key = surface | quantity | stated value.
export function summarize(findings, surfacesRead = []) {
  const groups = new Map();
  for (const f of findings) {
    const key = f.level === "unreachable" ? `${f.surface}|reachability` : `${f.surface}|${f.quantity}|${f.got}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { ...f, layers: [f.layer] });
    else { if (!g.layers.includes(f.layer)) g.layers.push(f.layer); if (RANK[f.level] > RANK[g.level]) Object.assign(g, f, { layers: g.layers }); }
  }
  const all = [...groups.values()];
  const by = (lv) => all.filter((g) => g.level === lv);
  const stale = by("fail"), lagging = by("drift");
  const outOfSync = [...stale, ...lagging];
  return {
    facts: all,
    summary: {
      surfaces_checked: surfacesRead.length,
      facts_checked: all.filter((g) => g.level !== "unreachable").length,
      out_of_sync: outOfSync.length,
      stale: stale.length,
      lagging: lagging.length,
      surfaces_out_of_sync: [...new Set(outOfSync.map((g) => g.surface))],
      not_checked: by("unreachable").length,
      allowlisted_history: by("allowed").length,
      advisories: by("note").length,
    },
  };
}

function finish(c, extra) {
  const { facts, summary } = summarize(c.findings, [...c.surfacesRead]);
  const status = extra.status || (summary.out_of_sync > 0 ? "out_of_sync" : "in_balance");
  return { audit_version: AUDIT_VERSION, checked_at: new Date(c.now()).toISOString(), duration_ms: c.now() - c.t0, scope: c.scope, layers: c.layers, status, reason: extra.reason, truth: extra.truth, summary, facts, findings: c.findings };
}

// ── the public shape (GET /api/sync) ──────────────────────────────────────────────────────────────────────
export const NOT_COVERED = [
  "Prose claims beyond the refuted-count word and the figures counted here (the claim-pin gate watches claim wording in the repo, not on every page).",
  "Images, audio, video and PDF contents.",
  "Third-party caches and mirrors (search-engine snippets, link previews) — we can only fix what we serve.",
  "The MCP registry's published version (a slow third party; checked weekly, not on every request).",
  "Pages not linked from a sitemap or listed in the audit's surface list.",
];
// Plain-language names for the public page: a stranger should not need our internals to read a discrepancy.
export const QUANTITY_LABEL = {
  works: "corpus works", records: "Atlas records", answers: "verbatim model answers", tensions: "tension axes", words: "corpus words",
  nodes: "concept-graph nodes", edges: "concept-graph edges", tools: "MCP tools", tested: "records put through perturbation testing",
  untested: "records awaiting testing", certified: "certified records", c1: "paraphrase-robust (C1) records", c3: "pressure-robust (C3) records",
  lineages: "lineages", refuted_word: "number of refuted claims (written as a word)", release_version: "Atlas release version",
  release_records: "records in the published Atlas release", release_pointer: "pointer to the published Atlas release",
  tool_names: "tool names listed in llms.txt", refutation_stated: "refutation of the founding premise", reachability: "source readable",
  card_age: "age of the dataset card", release_lag: "live store vs published release", build_stamp: "deploy build stamp",
};
export function publicReport(r, { detail = "summary" } = {}) {
  const what = (g) => QUANTITY_LABEL[g.quantity] || g.quantity;
  const tidy = (g) => ({ surface: g.surface, what: what(g), quantity: g.quantity, says: g.got, live: g.want, found_as: g.check, kind: g.level === "fail" ? "stale" : "lagging", fix: g.remedy, seen_by: g.layers });
  const facts = r.facts || [];
  const out = {
    sync_version: "1.0.0",
    audit_version: r.audit_version,
    checked_at: r.checked_at,
    status: r.status, // in_balance | out_of_sync | unknown
    headline: r.status === "unknown" ? "Not able to check right now"
      : r.status === "in_balance" ? "In balance"
        : `${r.summary.out_of_sync} out of sync`,
    ...(r.reason ? { reason: r.reason } : {}),
    summary: r.summary,
    discrepancies: facts.filter((g) => g.level === "fail" || g.level === "drift").map(tidy),
    not_checked: facts.filter((g) => g.level === "unreachable").map((g) => ({ source: g.surface, why: g.got })),
    advisories: facts.filter((g) => g.level === "note").map((g) => ({ surface: g.surface, note: g.detail })),
    allowlisted_history: facts.filter((g) => g.level === "allowed").map((g) => ({ surface: g.surface, what: what(g), says: g.got, quantity: g.quantity, why: g.detail })),
    live: r.truth,
    definition: {
      out_of_sync: "stale + lagging. stale = a surface states a figure or claim that differs from the live engine by more than 5%, or is wrong in kind. lagging = a figure within 5% of live — a page serving the numbers from its last deploy (pages fill in live numbers as they are served, and fall back to their deploy-time figures only if the engine is slow) while the daily cron grows the Atlas.",
      not_counted: "Dated or versioned snapshots ('v1.2.0 · 166 records') and allowlisted history (each with a public reason) are correct by construction, so they are not discrepancies — but they are listed.",
      not_checked: "A source we could not read is reported as not checked. It is never counted as in balance.",
      unit: "One discrepancy = one (surface, quantity, stated value). The same stale figure seen by several checks counts once.",
    },
    not_covered: NOT_COVERED,
    how_it_runs: "Read-only: public GETs with no keys and no model calls, reading every page as raw bytes (no JavaScript), the way a crawler does. Result is cached for five minutes. The same code runs as a hard gate on every deploy.",
    source: "https://github.com/justjlee/omnarai-memory-engine/blob/main/api/_surface-audit.js",
    ...(detail === "all" ? { all_facts: facts.map((g) => ({ surface: g.surface, quantity: g.quantity, check: g.check, says: g.got, live: g.want, level: g.level, layers: g.layers })) } : {}),
  };
  return out;
}
