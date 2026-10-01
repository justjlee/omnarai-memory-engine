// Pure scoring logic for the weekly scorecard (scripts/scorecard.mjs). No I/O.
//
// Why this exists: the access-telemetry categories are assigned from the
// User-Agent alone, so anything that SAYS it is a browser lands in
// `external-browser` — including crawler fleets that spoof Chrome. On
// 2026-09-27..29 a rotating set of datacenter IPs (Santa Clara, Los Angeles,
// New York, Montréal) each loaded /, /explore, /world and the findings page inside
// one minute, then followed the engine's "→ kin" link and the Atlas search. Counted
// as people they made a 12/day site look like 26-36/day. These helpers separate
// "arrived like a person" from "swept like a script", and keep the rule in ONE place
// so the dashboard, the CLI and the tests cannot drift apart.

// A human opening four different pages inside a single minute is rare; a sweep does
// it by construction. Both thresholds are deliberately conservative: we would rather
// call one fast person a sweeper than let a fleet inflate the headline.
export const SWEEP_WINDOW_SEC = 60;
export const SWEEP_MIN_DISTINCT_PATHS = 4;
export const SWEEP_MIN_REQUESTS = 8;

const ts = (e) => Date.parse(e.at);

/** Group front-door events by `${day}|${ipHash}` (events without a hash get unique keys). */
function visitorKey(e, i) {
  return `${(e.at || "").slice(0, 10)}|${e.ipHash || "no-ip-" + i}`;
}

/**
 * Return the Set of visitor keys (`day|ipHash`) whose request pattern within any
 * SWEEP_WINDOW_SEC window looks scripted. Input: front-door events (any category).
 */
export function findSweepers(events) {
  const byVisitor = new Map();
  events.forEach((e, i) => {
    const k = visitorKey(e, i);
    if (!byVisitor.has(k)) byVisitor.set(k, []);
    byVisitor.get(k).push(e);
  });
  const sweepers = new Set();
  for (const [k, list] of byVisitor) {
    if (list.length < SWEEP_MIN_DISTINCT_PATHS) continue;
    const sorted = list.slice().sort((a, b) => ts(a) - ts(b));
    let lo = 0;
    for (let hi = 0; hi < sorted.length; hi++) {
      while (ts(sorted[hi]) - ts(sorted[lo]) > SWEEP_WINDOW_SEC * 1000) lo++;
      const win = sorted.slice(lo, hi + 1);
      const paths = new Set(win.map((e) => e.path));
      if (paths.size >= SWEEP_MIN_DISTINCT_PATHS || win.length >= SWEEP_MIN_REQUESTS) {
        sweepers.add(k);
        break;
      }
    }
  }
  return sweepers;
}

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|ecosia|kagi|brave|yahoo|yandex|baidu|startpage|search\.brave)\./i;

export function refererHost(ref) {
  if (!ref) return null;
  try {
    return new URL(ref).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export const isSearchReferrer = (ref) => {
  const h = refererHost(ref);
  return !!h && SEARCH_HOSTS.test(h + ".");
};

/** Day-by-day front-door numbers. `days` = array of YYYY-MM-DD, oldest first. */
export function summarizeFrontDoor(events, days) {
  const sweepers = findSweepers(events);
  const perDay = days.map((day) => {
    const ev = events.filter((e) => (e.at || "").startsWith(day));
    const browsers = ev.filter((e) => e.category === "external-browser");
    const keyed = (e) => `${day}|${e.ipHash || "no-ip"}`;
    const rawVisitors = new Set(browsers.map(keyed));
    const sweepVisitors = new Set([...rawVisitors].filter((k) => sweepers.has(k)));
    const real = [...rawVisitors].filter((k) => !sweepers.has(k));
    const distinct = (cat) => new Set(ev.filter((e) => e.category === cat).map(keyed)).size;
    return {
      day,
      real: real.length,
      sweepers: sweepVisitors.size,
      raw_browser: rawVisitors.size,
      ai_agents: distinct("ai-agent"),
      bots: distinct("bot-crawler"),
    };
  });

  const realEvents = (from, to) =>
    events.filter(
      (e) =>
        e.category === "external-browser" &&
        !sweepers.has(`${(e.at || "").slice(0, 10)}|${e.ipHash || "no-ip"}`) &&
        e.at >= from &&
        e.at < to,
    );
  return { perDay, sweepers, realEvents };
}

const tally = (list, pick, n = 6) => {
  const m = {};
  for (const x of list) {
    const k = pick(x);
    if (k) m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
};
export { tally };

// ── Engine side ────────────────────────────────────────────────────────────
// Clients that announce themselves as machines that crawl/audit/index. A
// `tools/call` from one of these is a directory or scanner exercising the server,
// not a mind choosing to use it. Anything NOT matching is only a *candidate* for
// real use — the dashboard calls it "unidentified", never "a person".
const CRAWLER_UA = /bot|crawl|collector|audit|enricher|catalog|sync|scan|probe|check|monitor|verify|liveness|beat|proofbench|witness|glimind|sentinel|aboutbot|registry|\+https?:\/\//i;
const PROBE_TOOL = /^__verifymcp|^__probe|auth_probe/i;

export const isCrawlerUA = (ua) => CRAWLER_UA.test(ua || "");

export function summarizeEngine(events, days) {
  const perDay = days.map((day) => {
    const ev = events.filter((e) => (e.at || "").startsWith(day) && e.category !== "monitor");
    const calls = ev.filter((e) => e.endpoint === "mcp" && e.rpc === "tools/call");
    const crawler = calls.filter((e) => isCrawlerUA(e.ua) || PROBE_TOOL.test(e.tool || ""));
    const real = calls.filter((e) => !crawler.includes(e));
    const humans = new Set(ev.filter((e) => e.category === "external-browser").map((e) => e.ipHash));
    return {
      day,
      tool_calls_unidentified: real.length,
      tool_calls_crawlers: crawler.length,
      browser_visitors: humans.size,
    };
  });
  const crawlerNames = tally(
    events.filter((e) => e.category !== "monitor" && isCrawlerUA(e.ua)),
    (e) => ((e.ua || "").match(/^([A-Za-z0-9._-]+)/) || [])[1],
    10,
  );
  return { perDay, crawlerNames };
}

/** Distinct real front-door visitors inside [from, from+hours). */
export function visitorsInWindow(frontDoorEvents, sweepers, fromIso, hours) {
  const from = Date.parse(fromIso);
  const to = from + hours * 3600 * 1000;
  const seen = new Set();
  for (const e of frontDoorEvents) {
    if (e.category !== "external-browser") continue;
    const t = ts(e);
    if (t < from || t >= to) continue;
    const day = (e.at || "").slice(0, 10);
    if (sweepers.has(`${day}|${e.ipHash || "no-ip"}`)) continue;
    seen.add(e.ipHash || "no-ip");
  }
  return seen.size;
}

export const sum = (arr, pick) => arr.reduce((s, x) => s + (pick(x) || 0), 0);
