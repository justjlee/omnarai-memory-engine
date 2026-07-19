import { list, put } from "@vercel/blob";
import { createHash, randomBytes } from "crypto";

// ── Access telemetry ──────────────────────────────────────────────────────────
// "The honest milestone is the first API call you didn't cause." This module is
// the instrument for that milestone: it classifies each incoming API request and
// records only the ones that are plausibly NOT us — the strangers — so the
// curator can tell genuine external/agent traffic from their own scripts, the
// live UI, and the cron.
//
// Design constraints that shaped this:
//  • Underscore filename ⇒ a shared module, NOT a deployed serverless function.
//    The project is on the Vercel Hobby plan (12 functions max) and already at
//    the cap; telemetry had to live inside that budget.
//  • Cheap by default. Self/UI/preflight traffic is classified in microseconds
//    (header inspection only) and never touches the Blob. Blob writes happen
//    ONLY for stranger candidates — so the hot paths (info, retrieve) pay
//    nothing in normal operation.
//  • Never throws, never hangs. The whole thing is wrapped in try/catch and a
//    timeout; a telemetry failure can never break or slow a real response.
//  • Conservative about "self". We only treat a request as self when it carries
//    our explicit marker header. Over-counting a maybe-stranger is safe;
//    under-counting (mislabelling a real stranger as self) would corrupt the very
//    signal we care about, so the bias runs the safe direction.
//  • Zero-loss ground truth. The aggregate log is a read-modify-write blob, and
//    Vercel Blob has no CAS — concurrent stranger events (real bursts arrive
//    seconds apart) can silently drop each other's updates. So every event is
//    ALSO written as its own append-only blob (telemetry/events/<day>/...), the
//    same per-entry pattern that fixed the contributions store: a unique new
//    path per event cannot be lost by construction. The aggregate is the fast
//    dashboard; the event files are the forensic record.
//
// Privacy: raw IPs are never stored — only a salted hash (so a repeat caller can
// be recognised without retaining the address). Geo is Vercel's coarse
// country/region/city headers only. The Blob is keyed but its URL is not
// advertised, and the read path (/api/info?_view=traffic) is gated behind the
// curator's INGEST_SECRET.

const LOG_KEY = "telemetry/access-log.json";
const EVENTS_PREFIX = "telemetry/events/";
const RECENT_CAP = 1000; // last N stranger events verbatim in the aggregate log
const DAY_VISITOR_CAP = 300; // distinct ipHashes tracked per day in the rollup

// Local curator scripts set this header so their own traffic is never logged as a
// stranger. See scripts/_self-header.* and the convention note in CLAUDE.md.
const SELF_HEADER = "x-omnarai-self";
// Our published MCP server tags itself so MCP traffic is distinguishable. Note:
// MCP runs on OTHER people's machines too, so an MCP call is NOT automatically
// "self" — a stranger running our MCP IS the milestone. It gets its own category.
const CLIENT_HEADER = "x-omnarai-client";

function ipHash(req) {
  const fwd = (req.headers?.["x-forwarded-for"] || "").toString();
  const ip = fwd.split(",")[0].trim() || req.socket?.remoteAddress || "";
  if (!ip) return null;
  const salt = process.env.INGEST_SECRET || "omnarai";
  return createHash("sha256").update(salt + ip).digest("hex").slice(0, 12);
}

// Uptime/liveness monitors. These poll on a fixed schedule and never do anything
// with the answer — one of them can out-number every real visitor combined and
// silently manufacture "growth" in the headline totals. They stay LOGGED (a
// monitor is still a stranger, and dropping events would break the loss-proof
// record), but they are subtracted from the reported signal. See `summarize()`.
const MONITOR_RE = /sentineloracle|uptimerobot|uptime-kuma|pingdom|statuscake|betteruptime|betterstack|checkly|site24x7|hetrixtools|freshping|cron-job\.org|datadog|newrelic|healthchecks\.io|statusca[kt]e|monitoring|uptime/i;
// Known crawler/bot user-agents (corpus scrapers, search indexers, AI fetchers).
const BOT_RE = /gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|ccbot|perplexitybot|bytespider|amazonbot|applebot|google|bingbot|baiduspider|yandex|duckduckbot|facebookexternalhit|slurp|semrush|ahrefs/i;
// Programmatic clients / agent frameworks (the high-signal "an agent called us" bucket).
const AGENT_RE = /python-requests|httpx|aiohttp|node-fetch|undici|axios|got\/|okhttp|go-http|java\/|curl|wget|libwww|urllib|ruby|guzzle|openai|langchain|llama|autogpt|crewai|dify/i;
const BROWSER_RE = /mozilla|chrome|safari|firefox|edg\/|opera|gecko/i;

/**
 * Classify a request. Returns { category, log }.
 * `log: false` ⇒ we are confident it's us (self / UI / preflight) — skip the Blob.
 */
export function classifyCaller(req) {
  const h = req.headers || {};
  const ua = (h["user-agent"] || "").toString();
  const ref = (h.referer || h.origin || "").toString().toLowerCase();
  const clientTag = (h[CLIENT_HEADER] || "").toString().toLowerCase();

  if (h[SELF_HEADER]) return { category: "self", log: false };

  // Vercel's own scheduled invocations (the longitudinal cron) — our traffic.
  if (/vercel-cron/i.test(ua)) return { category: "cron", log: false };

  // Requests originating from our own site UI (or local dev) — humans we caused.
  if (ref.includes("omnarai.vercel.app") || ref.includes("localhost") || ref.includes("127.0.0.1")) {
    return { category: "ui", log: false };
  }

  // Monitors are checked FIRST among the logged branches: a liveness poller that
  // speaks MCP is still a poller, and its self-declared UA is the strongest
  // signal we have. Logged, but excluded from the reported signal.
  if (MONITOR_RE.test(ua)) return { category: "monitor", log: true };

  if (clientTag === "mcp") return { category: "mcp-client", log: true };
  if (BOT_RE.test(ua)) return { category: "bot-crawler", log: true };
  if (AGENT_RE.test(ua)) return { category: "ai-agent", log: true };
  if (!ua.trim()) return { category: "unknown-no-ua", log: true };
  if (!BROWSER_RE.test(ua)) return { category: "unknown-nonbrowser", log: true };
  // A browser UA with no referer to us: someone hitting an API URL directly, an
  // external embed, or a UA-spoofing client. Worth keeping an eye on.
  return { category: "external-browser", log: true };
}

/**
 * Build the full event record for a stranger candidate. Pure given (req,
 * endpoint, category, now) — exported for tests. Captures what the visitor
 * TOLD us (query text, declared identity, MCP tool) alongside transport facts;
 * never the raw IP.
 */
export function buildEvent(req, endpoint, category, now = new Date()) {
  const h = req.headers || {};
  const str = (v, n) => (v == null ? "" : v.toString()).slice(0, n) || null;
  // req.body is Vercel's pre-parsed JSON for POSTs; guard every shape.
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const qp = req.query && typeof req.query === "object" ? req.query : {};

  const event = {
    at: now.toISOString(),
    endpoint,
    category,
    method: req.method || "GET",
    ua: str(h["user-agent"], 300),
    path: str(req.url, 300),
    ipHash: ipHash(req),
    country: str(h["x-vercel-ip-country"], 8),
    region: str(h["x-vercel-ip-country-region"], 40),
    city: str(h["x-vercel-ip-city"], 60),
    lang: str(h["accept-language"], 60),
    client: str(h[CLIENT_HEADER], 60),
    referer: str(h.referer || h.origin, 200),
    // What they asked, if anything — the highest-signal field we have.
    q: str(qp.q || qp.query || body.q || body.query, 200),
    // A self-declared identity is the "declared, not detected" channel.
    identity: str(qp.si || qp.identity || body.si || body.syntheticIdentity || body.identity, 80),
  };

  // MCP calls are JSON-RPC: record the method, and for tools/call the tool name —
  // this is the difference between "something hit /api/mcp" and "an agent ran
  // omnarai_divergence".
  if (endpoint === "mcp") {
    const rpc = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    event.rpc = str(rpc.method, 60);
    event.tool = str(rpc.params?.name, 60);
    const args = rpc.params?.arguments;
    if (args && typeof args === "object") {
      event.q = event.q || str(args.q || args.query || args.question, 200);
      event.identity = event.identity || str(args.syntheticIdentity || args.identity || args.si, 80);
    }
  }
  return event;
}

function emptyLog() {
  return {
    version: 2,
    updatedAt: null,
    firstExternalAt: null,   // the milestone: timestamp of the first call we didn't cause
    firstExternal: null,     // the full first stranger event
    totals: { logged: 0 },
    byCategory: {},
    byEndpoint: {},
    byCountry: {},
    days: {},                // per-day permanent rollup — survives after `recent` rolls off
    recent: [],
  };
}

async function loadLog() {
  try {
    const { blobs } = await list({ prefix: LOG_KEY });
    if (!blobs.length) return emptyLog();
    const res = await fetch(`${blobs[0].url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return emptyLog();
    const data = await res.json();
    return { ...emptyLog(), ...data };
  } catch {
    return emptyLog();
  }
}

function rollupDay(days, event) {
  const day = event.at.slice(0, 10);
  const d = (days[day] = days[day] || {
    total: 0, byCategory: {}, byEndpoint: {}, byCountry: {}, visitors: {},
  });
  d.total += 1;
  d.byCategory[event.category] = (d.byCategory[event.category] || 0) + 1;
  d.byEndpoint[event.endpoint] = (d.byEndpoint[event.endpoint] || 0) + 1;
  if (event.country) d.byCountry[event.country] = (d.byCountry[event.country] || 0) + 1;
  const h = event.ipHash || "no-ip";
  if (h in d.visitors) d.visitors[h] += 1;
  else if (Object.keys(d.visitors).length < DAY_VISITOR_CAP) d.visitors[h] = 1;
  else d.visitorsTruncated = true;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/**
 * Record one API access. Call at the top of a handler, after the OPTIONS guard:
 *
 *     waitUntil(recordAccess(req, "query"));
 *
 * Best-effort: self/UI traffic returns instantly without I/O. A stranger
 * candidate triggers (1) an append-only per-event blob — the loss-proof record —
 * then (2) a bounded RMW update of the aggregate dashboard log. Both are
 * never-throwing and time-boxed.
 */
export async function recordAccess(req, endpoint) {
  try {
    const { category, log } = classifyCaller(req);
    if (!log) return { category, logged: false };

    const event = buildEvent(req, endpoint, category);

    await withTimeout((async () => {
      // 1. Ground truth first: unique path per event ⇒ concurrent bursts can
      //    never clobber each other (same pattern as contributions/<id>.json).
      const day = event.at.slice(0, 10);
      const eventKey = `${EVENTS_PREFIX}${day}/${event.at.replace(/[:.]/g, "")}-${randomBytes(3).toString("hex")}.json`;
      await put(eventKey, JSON.stringify(event), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      });

      // 2. Best-effort aggregate (fast dashboard; a lost race here is repairable
      //    from the event files, never the other way round).
      const data = await loadLog();
      data.version = 2;
      data.updatedAt = event.at;
      data.totals.logged = (data.totals.logged || 0) + 1;
      data.byCategory[category] = (data.byCategory[category] || 0) + 1;
      data.byEndpoint[endpoint] = (data.byEndpoint[endpoint] || 0) + 1;
      if (event.country) data.byCountry[event.country] = (data.byCountry[event.country] || 0) + 1;
      rollupDay(data.days, event);
      if (!data.firstExternalAt) {
        data.firstExternalAt = event.at;
        data.firstExternal = event;
      }
      data.recent.unshift(event);
      if (data.recent.length > RECENT_CAP) data.recent.length = RECENT_CAP;
      await put(LOG_KEY, JSON.stringify(data), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      });
    })(), 4000);

    return { category, logged: true };
  } catch {
    return { category: "error", logged: false };
  }
}

/**
 * Derive the reported SIGNAL from a raw log: totals with uptime/liveness monitor
 * traffic subtracted, all-time and per-day. Pure — exported for tests.
 *
 * Why this exists: a single liveness poller hitting /api/mcp every ~5 minutes
 * produced 108 of one day's 201 events (2026-07-19). Read straight, the headline
 * total reads as growth when it is a cron job. The raw counts are preserved
 * verbatim (`totals`, `byCategory`, `days`) — this only adds the honest read
 * beside them, so the instrument never quietly rewrites its own history.
 *
 * `signal.visitors` counts DISTINCT ipHashes per day, which is the number that
 * actually tracks reach: monitors are one host hammering, real arrivals are many
 * hosts calling once.
 */
export function summarize(data) {
  const monitorAll = data.byCategory?.monitor || 0;
  const days = {};
  for (const [day, d] of Object.entries(data.days || {})) {
    const mon = d.byCategory?.monitor || 0;
    // A monitor is one host; excluding it from the visitor count means dropping
    // exactly the hashes that only ever appear under the monitor category. We
    // can't attribute hashes to categories in the rollup, so report both: the
    // distinct-host count is monitor-insensitive enough to stand on its own.
    const visitorHashes = Object.keys(d.visitors || {});
    days[day] = {
      total: d.total,
      signal: Math.max(0, (d.total || 0) - mon),
      monitor: mon,
      distinctVisitors: visitorHashes.length,
      topVisitorShare: visitorHashes.length
        ? Math.max(...Object.values(d.visitors)) / (d.total || 1)
        : 0,
      truncated: !!d.visitorsTruncated,
    };
  }
  return {
    note:
      "signal = logged events minus uptime/liveness monitors. Raw counts are unchanged below; " +
      "monitors are logged (they are strangers) but never counted as reach.",
    logged: data.totals?.logged || 0,
    monitor: monitorAll,
    signal: Math.max(0, (data.totals?.logged || 0) - monitorAll),
    days,
  };
}

/** Read the access log (for the curator-gated report). Never throws. */
export async function readAccessLog() {
  const data = await loadLog();
  return { ...data, summary: summarize(data) };
}

/**
 * Read the loss-proof per-event record for one day (YYYY-MM-DD), newest first.
 * Curator-gated read path: /api/info?_view=traffic&day=YYYY-MM-DD. Never throws.
 */
export async function readDayEvents(day) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { day, count: 0, events: [], error: "day must be YYYY-MM-DD" };
    const { blobs } = await list({ prefix: `${EVENTS_PREFIX}${day}/`, limit: 1000 });
    const events = (
      await Promise.all(
        blobs.map(async (b) => {
          try {
            const r = await fetch(`${b.url}?ts=${Date.now()}`, { cache: "no-store" });
            return r.ok ? await r.json() : null;
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    events.sort((a, b) => (a.at < b.at ? 1 : -1));
    return { day, count: events.length, truncated: blobs.length >= 1000, events };
  } catch {
    return { day, count: 0, events: [] };
  }
}
