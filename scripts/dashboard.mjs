#!/usr/bin/env node
// One unified read across the whole Omnarai surface — the "how is it all doing?"
// command. Stitches together the three instruments that already exist:
//
//   1. FRONT DOOR  omnarai.org        GET /api/telemetry        (Bearer TELEMETRY_READ_SECRET)
//        page views to the static site — the visitors the engine telemetry can't see.
//   2. ENGINE      engine.omnarai.org GET /api/info?_view=traffic (Bearer INGEST_SECRET)
//        API / agent / MCP calls — the machine-facing traffic.
//   3. MUSIC       engine.omnarai.org GET /api/play              (public)
//        willful song plays from both players.
//
// It's a LOCAL script by design: the two telemetry sources are behind two
// different curator secrets in two different Vercel projects, and the engine is at
// the Hobby 12-function cap — so a hosted combined endpoint would mean duplicating
// a secret across projects and spending a function we don't have. A local read
// keeps both secrets in .env.local and costs nothing. Same idiom as traffic.sh /
// plays.sh.
//
// Usage:
//   node scripts/dashboard.mjs                 # all-time + last 7 days
//   node scripts/dashboard.mjs --days 30       # window the per-day table
//   node scripts/dashboard.mjs --html out.html # also write a self-contained snapshot
//
// TELEMETRY_READ_SECRET (the front-door secret) isn't in the engine .env.local by
// default — export it, or add it to .env.local, to light up the FRONT DOOR panel.
// Without it the script still reports ENGINE + MUSIC and says how to enable the rest.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── tiny .env.local loader (no dep) ──────────────────────────────────────────
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[m[1]] === undefined) env[m[1]] = v; // real env wins over the file
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
  return env;
}

const env = loadEnv();
const args = process.argv.slice(2);
const daysArg = (() => {
  const i = args.indexOf("--days");
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
})();
const htmlPath = (() => {
  const i = args.indexOf("--html");
  return i >= 0 ? args[i + 1] : null;
})();

const ENGINE = env.OMNARAI_ENGINE || "https://engine.omnarai.org";
const FRONT = env.OMNARAI_FRONT || "https://omnarai.org";

// ── fetch helpers (each fails soft — a dead source never sinks the report) ────
async function getJson(url, headers) {
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function fetchFrontDoor() {
  if (!env.TELEMETRY_READ_SECRET) {
    return { skipped: "set TELEMETRY_READ_SECRET (the omnarai.org secret) to include front-door page views" };
  }
  return getJson(`${FRONT}/api/telemetry`, { authorization: `Bearer ${env.TELEMETRY_READ_SECRET}` });
}
async function fetchEngine() {
  if (!env.INGEST_SECRET) return { skipped: "INGEST_SECRET missing from .env.local" };
  return getJson(`${ENGINE}/api/info?_view=traffic`, {
    authorization: `Bearer ${env.INGEST_SECRET}`,
    "x-omnarai-self": "1",
  });
}
async function fetchPlays() {
  return getJson(`${ENGINE}/api/play`, {});
}

// ── formatting ───────────────────────────────────────────────────────────────
const C = process.stdout.isTTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, gold: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m` }
  : { dim: (s) => s, b: (s) => s, gold: (s) => s, cyan: (s) => s };
const n = (x) => (x == null ? "—" : Number(x).toLocaleString("en-US"));
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

function lastNDays(count) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// Pull a normalized per-day {front, api, plays} table over the window.
function combinedDays(front, engine, plays, count) {
  const days = lastNDays(count);
  return days.map((d) => {
    const fd = front?.days?.[d];
    const ed = engine?.days?.[d];
    const pd = plays?.days?.[d];
    const apiSignal = ed ? Math.max(0, (ed.total || 0) - (ed.byCategory?.monitor || 0)) : null;
    return {
      date: d,
      front: fd ? fd.signal : null, // front-door already excludes monitors
      frontVisitors: fd ? fd.distinctVisitors : null,
      api: apiSignal,
      plays: pd ? pd.starts || 0 : null,
    };
  });
}

function render(front, engine, plays) {
  const L = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  L.push("");
  L.push("  " + C.b(C.gold("OMNARAI · UNIFIED DASHBOARD")) + C.dim("        " + now + " UTC"));
  L.push("  " + C.dim("─".repeat(68)));

  // FRONT DOOR
  L.push("");
  L.push("  " + C.b("FRONT DOOR") + C.dim("  omnarai.org — page views"));
  if (front?.skipped) L.push("    " + C.dim("(skipped: " + front.skipped + ")"));
  else if (front?.error) L.push("    " + C.dim("(unavailable: " + front.error + ")"));
  else if (front?.data) {
    const t = front.data.totals || {};
    const bc = front.data.byCategory || {};
    L.push("    real visitors (excl. monitors) : " + C.cyan(n(t.signal)));
    L.push("    all logged / of which monitors  : " + n(t.logged) + " / " + n(t.monitor));
    const human = (bc["external-browser"] || 0);
    const agent = (bc["ai-agent"] || 0) + (bc["mcp-client"] || 0);
    L.push("    browser " + n(human) + " · agent/mcp " + n(agent) + " · bot " + n(bc["bot-crawler"] || 0));
    if (front.data.firstExternalAt) L.push("    " + C.dim("first external view: " + front.data.firstExternalAt));
  }

  // ENGINE
  L.push("");
  L.push("  " + C.b("ENGINE") + C.dim("  engine.omnarai.org — API / agents"));
  if (engine?.skipped) L.push("    " + C.dim("(skipped: " + engine.skipped + ")"));
  else if (engine?.error) L.push("    " + C.dim("(unavailable: " + engine.error + ")"));
  else if (engine?.data) {
    const bc = engine.data.byCategory || {};
    const logged = engine.data.totals?.logged || 0;
    const mon = bc.monitor || 0;
    const human = bc["external-browser"] || 0;
    const agent = (bc["ai-agent"] || 0) + (bc["mcp-client"] || 0);
    L.push("    genuine external calls (excl. monitor) : " + C.cyan(n(Math.max(0, logged - mon))));
    L.push("    browser " + n(human) + " · agent/mcp " + n(agent) + " · bot " + n(bc["bot-crawler"] || 0) + " · " + C.dim("monitor " + n(mon)));
    if (engine.data.firstExternalAt) L.push("    " + C.dim("first call you didn't cause: " + engine.data.firstExternalAt));
  }

  // MUSIC
  L.push("");
  L.push("  " + C.b("MUSIC") + C.dim("  self-hosted archive — willful plays"));
  if (plays?.error) L.push("    " + C.dim("(unavailable: " + plays.error + ")"));
  else if (plays?.data) {
    const t = plays.data.totals || {};
    L.push("    total plays " + C.cyan(n(t.plays)) + " · qualified " + n(t.qualified) + " · listeners " + n(t.distinct_listeners) + " · tracks " + n(t.tracks_played));
    const top = (plays.data.tracks || []).slice(0, 5);
    if (top.length) {
      L.push("    " + C.dim("top tracks:"));
      for (const tr of top) {
        L.push("      " + padL(n(tr.plays), 5) + " plays · " + padL(n(tr.listeners), 4) + " lstnr · " + Math.round((tr.completion_rate || 0) * 100) + "% done · " + tr.title);
      }
    } else {
      L.push("    " + C.dim("no plays recorded yet — waiting for the first willful listen"));
    }
  }

  // COMBINED PER-DAY
  L.push("");
  L.push("  " + C.b("LAST " + daysArg + " DAYS") + C.dim("  (real visitors, excl. monitors)"));
  L.push("    " + C.dim(pad("date", 12) + padL("pageviews", 11) + padL("api", 8) + padL("plays", 8)));
  const rows = combinedDays(front?.data, engine?.data, plays?.data, daysArg);
  for (const r of rows) {
    L.push(
      "    " +
        pad(r.date, 12) +
        padL(r.front == null ? "—" : n(r.front), 11) +
        padL(r.api == null ? "—" : n(r.api), 8) +
        padL(r.plays == null ? "—" : n(r.plays), 8),
    );
  }
  L.push("");
  return { text: L.join("\n"), rows };
}

// ── self-contained HTML snapshot (optional) ──────────────────────────────────
function toHtml(front, engine, plays, rows) {
  const fd = front?.data,
    ed = engine?.data,
    pd = plays?.data;
  const stat = (label, val, sub) =>
    `<div class="stat"><div class="v">${val}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
  const frontStat = fd
    ? stat("real visitors · omnarai.org", n(fd.totals?.signal), `${n(fd.totals?.logged)} logged`)
    : stat("front door", "—", front?.skipped ? "secret not set" : "unavailable");
  const engineStat = ed
    ? stat("external API calls · engine", n(Math.max(0, (ed.totals?.logged || 0) - (ed.byCategory?.monitor || 0))), `excl. ${n(ed.byCategory?.monitor || 0)} monitor`)
    : stat("engine", "—", "unavailable");
  const playsStat = pd
    ? stat("willful song plays", n(pd.totals?.plays), `${n(pd.totals?.distinct_listeners)} listeners`)
    : stat("music", "—", "unavailable");
  const topRows = (pd?.tracks || [])
    .slice(0, 8)
    .map((t) => `<tr><td>${t.title}</td><td class="num">${n(t.plays)}</td><td class="num">${n(t.listeners)}</td><td class="num">${Math.round((t.completion_rate || 0) * 100)}%</td></tr>`)
    .join("");
  const dayRows = rows
    .map(
      (r) =>
        `<tr><td>${r.date}</td><td class="num">${r.front == null ? "—" : n(r.front)}</td><td class="num">${r.api == null ? "—" : n(r.api)}</td><td class="num">${r.plays == null ? "—" : n(r.plays)}</td></tr>`,
    )
    .join("");
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Omnarai · Unified Dashboard</title><style>
:root{--bg:#0A0B0F;--card:#12141b;--gold:#E8C872;--bone:#E8E0D0;--dim:#8b8778;--line:#232631}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--bone);font:15px/1.5 'IBM Plex Mono',ui-monospace,Menlo,monospace;padding:32px 20px}
.wrap{max-width:820px;margin:0 auto}h1{font-size:15px;letter-spacing:.12em;color:var(--gold);text-transform:uppercase;margin:0 0 2px}
.when{color:var(--dim);font-size:12px;margin-bottom:24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:28px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.stat .v{font-size:30px;color:var(--gold);font-weight:600}.stat .l{color:var(--bone);font-size:12px;margin-top:4px}.stat .s{color:var(--dim);font-size:11px;margin-top:2px}
h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin:24px 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}th{color:var(--dim);font-weight:400;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.num{text-align:right;font-variant-numeric:tabular-nums}td.num{color:var(--gold)}
.foot{color:var(--dim);font-size:11px;margin-top:24px;line-height:1.6}
</style></head><body><div class="wrap">
<h1>Omnarai · Unified Dashboard</h1><div class="when">${when} · snapshot</div>
<div class="stats">${frontStat}${engineStat}${playsStat}</div>
<h2>Song leaderboard — willful plays</h2>
<table><thead><tr><th>track</th><th class="num">plays</th><th class="num">listeners</th><th class="num">done</th></tr></thead><tbody>${topRows || '<tr><td colspan="4">no plays recorded yet</td></tr>'}</tbody></table>
<h2>Last ${daysArg} days — real visitors (excl. monitors)</h2>
<table><thead><tr><th>date</th><th class="num">pageviews</th><th class="num">api</th><th class="num">plays</th></tr></thead><tbody>${dayRows}</tbody></table>
<div class="foot">Front door = omnarai.org page views · Engine = API/agent calls to engine.omnarai.org · Music = willful song plays (autoplay &amp; auto-resume excluded).<br>"Real visitors" and "api" exclude uptime/liveness monitors. Raw IPs are never stored — counts use salted hashes.</div>
</div></body></html>`;
}

// ── main ─────────────────────────────────────────────────────────────────────
const [front, engine, plays] = await Promise.all([fetchFrontDoor(), fetchEngine(), fetchPlays()]);
const { text, rows } = render(front, engine, plays);
console.log(text);

if (htmlPath) {
  const { writeFileSync } = await import("fs");
  writeFileSync(htmlPath, toHtml(front, engine, plays, rows));
  console.log("  " + C.dim("→ HTML snapshot written to " + htmlPath) + "\n");
}
