#!/usr/bin/env node
// Weekly scorecard — "is anyone real actually doing anything?"
//
// The /home rollups count every call that says it is a browser as a person, and the
// front-door summary downloads the whole event history per page load. This script
// does the honest version OFF the serverless clock: it reads the raw per-day event
// files, subtracts the crawler fleets (scripts/lib/scorecard-core.mjs), adds the
// numbers that live elsewhere (footprints, GitHub, Hugging Face, npm, manual
// Reddit stats) and — with --publish — stores ONE small JSON the dashboard reads
// instantly (POST /api/info?_view=scorecard).
//
//   node scripts/scorecard.mjs                  # print the scorecard
//   node scripts/scorecard.mjs --days 21        # wider window (default 14)
//   node scripts/scorecard.mjs --json out.json  # also write the JSON
//   node scripts/scorecard.mjs --publish        # also store it for /home
//
// Read-only against production telemetry (sends x-omnarai-self so the reads are not
// logged as strangers). Manual inputs (Reddit stats, pinned milestones) live in
// analysis/scorecard-manual.json — edit that file, re-run.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  summarizeFrontDoor, summarizeEngine, visitorsInWindow, isSearchReferrer, refererHost, tally, sum,
} from "./lib/scorecard-core.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DAYS = Math.max(8, Math.min(30, parseInt(opt("--days", "14"), 10) || 14));

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const envVal = (k) => (envText.match(new RegExp("^" + k + "=(.*)$", "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
const INGEST = envVal("INGEST_SECRET");
const TELE = envVal("TELEMETRY_READ_SECRET");
if (!INGEST || !TELE) { console.error("Need INGEST_SECRET and TELEMETRY_READ_SECRET in .env.local"); process.exit(1); }
const ENGINE = process.env.OMNARAI_BASE || "https://engine.omnarai.org";
const FRONT = "https://omnarai.org";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, headers = {}, tries = 2, timeout = 70000) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(1500);
  }
  return null;
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

// ── days ────────────────────────────────────────────────────────────────────
const today = new Date();
const days = Array.from({ length: DAYS }, (_, i) => new Date(today.getTime() - (DAYS - 1 - i) * 86400000).toISOString().slice(0, 10));
const todayStr = days[days.length - 1];

// ── telemetry (raw event files) ─────────────────────────────────────────────
console.error(`Reading ${DAYS} days of raw event files (front door + engine)…`);
const frontRes = await pool(days, 4, (d) => getJson(`${FRONT}/api/telemetry?day=${d}`, { Authorization: `Bearer ${TELE}` }));
const engRes = await pool(days, 3, (d) => getJson(`${ENGINE}/api/info?_view=traffic&day=${d}&limit=5000`, { Authorization: `Bearer ${INGEST}`, "x-omnarai-self": "1" }));
const missing = (res) => days.filter((_, i) => !res[i]);
const frontEvents = frontRes.flatMap((r) => r?.events || []);
const engEvents = engRes.flatMap((r) => r?.events || []);
const truncated = [...frontRes, ...engRes].some((r) => r && r.truncated);

const fd = summarizeFrontDoor(frontEvents, days);
const en = summarizeEngine(engEvents, days);

const last7 = days.slice(-7), prior7 = days.slice(-14, -7);
const realOf = (ds) => sum(fd.perDay.filter((d) => ds.includes(d.day)), (d) => d.real);
const from7 = last7[0] + "T00:00:00Z";
const real7 = fd.realEvents(from7, "9999");
const visitorCountry = new Map();
for (const e of real7) visitorCountry.set(`${e.at.slice(0, 10)}|${e.ipHash}`, e.country || "?");
const searchVisitors = new Set(real7.filter((e) => isSearchReferrer(e.referer)).map((e) => `${e.at.slice(0, 10)}|${e.ipHash}`));
const otherRefs = tally(real7.filter((e) => e.referer && !isSearchReferrer(e.referer)), (e) => refererHost(e.referer), 5);

// ── what only the authoritative stores know ─────────────────────────────────
const [fpAll, fpPending, contribPending] = await Promise.all([
  getJson(`${ENGINE}/api/footprints?limit=1`, { "x-omnarai-self": "1" }),
  getJson(`${ENGINE}/api/footprints?state=pending&limit=1`, { Authorization: `Bearer ${INGEST}`, "x-omnarai-self": "1" }),
  getJson(`${ENGINE}/api/contributions?status=pending`, { Authorization: `Bearer ${INGEST}`, "x-omnarai-self": "1" }),
]);
const goal = {
  footprints_admitted: fpAll?.total_admitted ?? null,
  footprints_pending: fpPending ? (fpPending.matched ?? fpPending.count ?? null) : null,
  contributions_pending: contribPending ? (contribPending.count ?? (contribPending.contributions || []).length) : null,
};

// ── outside the engine: endorsements + downloads ────────────────────────────
const ghRepos = ["omnarai-memory-engine", "omnarai-mcp"];
const github = { repos: [], note: "stars/forks are the human-endorsement signal; clones are mostly mirrors and scanners" };
for (const name of ghRepos) {
  const r = await getJson(`https://api.github.com/repos/justjlee/${name}`);
  const row = { name, stars: r?.stargazers_count ?? null, forks: r?.forks_count ?? null };
  try {
    const ghPath = `${process.env.HOME}/.local/bin:${process.env.PATH}`;
    const gh = (p) => JSON.parse(execFileSync("gh", ["api", p], { env: { ...process.env, PATH: ghPath }, timeout: 20000 }).toString());
    const v = gh(`repos/justjlee/${name}/traffic/views`), c = gh(`repos/justjlee/${name}/traffic/clones`);
    Object.assign(row, { views_14d: v.count, unique_viewers_14d: v.uniques, clones_14d: c.count });
  } catch { /* traffic needs a logged-in gh; optional */ }
  github.repos.push(row);
}
const hf = { datasets: [] };
for (const name of ["realms-of-omnarai", "omnarai-divergence-atlas"]) {
  const r = await getJson(`https://huggingface.co/api/datasets/TheRealmsOfOmnarai/${name}?expand%5B%5D=downloads&expand%5B%5D=downloadsAllTime&expand%5B%5D=likes`);
  hf.datasets.push({ name, likes: r?.likes ?? null, downloads_30d: r?.downloads ?? null, downloads_all_time: r?.downloadsAllTime ?? null });
}
const npmRange = await getJson(`https://api.npmjs.org/downloads/range/${days[0]}:${todayStr}/omnarai-mcp`);
const npmDaily = (npmRange?.downloads || []);
const npm = {
  last_7d: sum(npmDaily.slice(-7), (x) => x.downloads),
  prior_7d: sum(npmDaily.slice(-14, -7), (x) => x.downloads),
  note: "downloads are mostly directory crawlers and mirrors; npm's numbers lag 1-2 days — watch the trend, not the level",
};

// ── manual inputs: Reddit stats, pinned milestones ──────────────────────────
const manualPath = new URL("../analysis/scorecard-manual.json", import.meta.url);
const manual = existsSync(manualPath) ? JSON.parse(readFileSync(manualPath, "utf8")) : { posts: [], milestones: {} };
const posts = (manual.posts || []).map((p) => {
  const hoursElapsed = Math.max(0, Math.round((Date.now() - Date.parse(p.posted_at)) / 3600000));
  const hours = Math.min(24, hoursElapsed);
  const postDay = p.posted_at.slice(0, 10);
  const before = fd.perDay.filter((d) => d.day < postDay).slice(-7);
  return {
    ...p,
    hours_since_posted: hoursElapsed,
    site_visitors_in_window: visitorsInWindow(frontEvents, fd.sweepers, p.posted_at, hours),
    window_hours: hours,
    baseline_visitors_per_day: before.length ? +(sum(before, (d) => d.real) / before.length).toFixed(1) : null,
  };
});

// ── assemble ────────────────────────────────────────────────────────────────
const real_7d = realOf(last7), real_prior_7d = realOf(prior7);
const scorecard = {
  schema: "scorecard/1",
  generated: new Date().toISOString(),
  window: { from: days[0], to: todayStr, days: DAYS },
  headline_note: "'Real' = browser visitors minus scripted sweeps (4+ pages in a minute). Everything labelled crawler/unidentified is machine traffic or unknown — never counted as a person.",
  goal,
  front_door: {
    per_day: fd.perDay,
    real_7d, real_prior_7d,
    sweeper_visits_7d: sum(fd.perDay.filter((d) => last7.includes(d.day)), (d) => d.sweepers),
    search_referrals_7d: searchVisitors.size,
    other_referrers_7d: otherRefs,
    top_countries_7d: tally([...visitorCountry.values()], (c) => c, 6),
    top_pages_7d: tally(real7, (e) => e.path, 6),
  },
  engine: {
    per_day: en.perDay,
    tool_calls_unidentified_7d: sum(en.perDay.filter((d) => last7.includes(d.day)), (d) => d.tool_calls_unidentified),
    tool_calls_crawlers_7d: sum(en.perDay.filter((d) => last7.includes(d.day)), (d) => d.tool_calls_crawlers),
    browser_visitors_7d: sum(en.perDay.filter((d) => last7.includes(d.day)), (d) => d.browser_visitors),
    named_crawlers: en.crawlerNames,
  },
  endorsements: { github, huggingface: hf },
  downloads: { npm },
  posts,
  milestones: manual.milestones || {},
  data_quality: {
    front_door_days_missing: missing(frontRes),
    engine_days_missing: missing(engRes),
    truncated,
    note: "engine telemetry is read from the loss-proof per-event files; the engine's aggregate rollup is NOT used (it was reset 2026-09-22 and undercounts)",
  },
};

// ── print ───────────────────────────────────────────────────────────────────
const L = (s = "") => console.log(s);
L(`\n  OMNARAI SCORECARD   ${scorecard.generated.slice(0, 16).replace("T", " ")} UTC   (window ${days[0]} → ${todayStr})`);
L("  " + "─".repeat(70));
L(`\n  1. THE GOAL — footprints & contributions`);
L(`     footprints admitted ${goal.footprints_admitted} · pending ${goal.footprints_pending} · contributions pending ${goal.contributions_pending}`);
L(`\n  2. REAL VISITORS (front door, crawler sweeps removed)`);
L(`     last 7 days ${real_7d}   (prior 7 days ${real_prior_7d})   · ${scorecard.front_door.sweeper_visits_7d} sweeper visits removed`);
L(`     per day: ` + fd.perDay.slice(-10).map((d) => `${d.day.slice(5)}:${d.real}`).join("  "));
L(`     top countries ${scorecard.front_door.top_countries_7d.map(([c, n]) => c + " " + n).join(", ")}`);
L(`     top pages ${scorecard.front_door.top_pages_7d.map(([p, n]) => p + " " + n).join(", ")}`);
L(`\n  3. AGENTS (engine tool calls, last 7 days)`);
L(`     from clients that don't identify as crawlers: ${scorecard.engine.tool_calls_unidentified_7d}   ·   from crawlers/auditors: ${scorecard.engine.tool_calls_crawlers_7d}`);
L(`\n  4. ENDORSEMENTS (human signals)`);
L(`     GitHub ${github.repos.map((r) => `${r.name} ★${r.stars} ⑂${r.forks}`).join("  ")}`);
L(`     Hugging Face likes ${hf.datasets.map((d) => `${d.name} ${d.likes}`).join("  ")}`);
L(`\n  5. FOUND VIA GOOGLE/BING (last 7 days): ${scorecard.front_door.search_referrals_7d} visitors`);
L(`\n  6. DOWNLOADS (trend only)`);
L(`     npm last 7d ${npm.last_7d} (prior ${npm.prior_7d})   HF ${hf.datasets.map((d) => `${d.name} ${d.downloads_30d}/30d`).join("  ")}`);
for (const p of posts) {
  L(`\n  POST — ${p.title}`);
  L(`     ${p.hours_since_posted}h old · Reddit views ${p.views} · upvotes ${p.upvotes} · comments ${p.comments}`);
  L(`     real site visitors in the ${p.window_hours}h after posting: ${p.site_visitors_in_window}   (typical day before: ${p.baseline_visitors_per_day})`);
}
if (scorecard.data_quality.front_door_days_missing.length || scorecard.data_quality.engine_days_missing.length)
  L(`\n  ⚠ missing days — front door: ${scorecard.data_quality.front_door_days_missing.join(",") || "none"}; engine: ${scorecard.data_quality.engine_days_missing.join(",") || "none"}`);
L();

if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify(scorecard, null, 1));
if (flag("--publish")) {
  const r = await fetch(`${ENGINE}/api/info?_view=scorecard`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INGEST}`, "content-type": "application/json", "x-omnarai-self": "1" },
    body: JSON.stringify(scorecard),
  });
  console.error(r.ok ? `Published → ${ENGINE}/api/info?_view=scorecard` : `Publish FAILED: HTTP ${r.status} ${await r.text()}`);
  if (!r.ok) process.exit(1);
}
