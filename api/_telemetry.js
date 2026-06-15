import { list, put } from "@vercel/blob";
import { createHash } from "crypto";

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
//    (header inspection only) and never touches the Blob. A Blob read-modify-write
//    happens ONLY for stranger candidates, which are currently rare/zero — so the
//    hot paths (info, retrieve) pay nothing in normal operation.
//  • Never throws, never hangs. The whole thing is wrapped in try/catch and a
//    timeout; a telemetry failure can never break or slow a real response.
//  • Conservative about "self". We only treat a request as self when it carries
//    our explicit marker header. Over-counting a maybe-stranger is safe;
//    under-counting (mislabelling a real stranger as self) would corrupt the very
//    signal we care about, so the bias runs the safe direction.
//
// Privacy: raw IPs are never stored — only a salted hash (so a repeat caller can
// be recognised without retaining the address). The Blob is keyed but its URL is
// not advertised, and the read path (/api/info?_view=traffic) is gated behind the
// curator's INGEST_SECRET.

const LOG_KEY = "telemetry/access-log.json";
const RECENT_CAP = 250; // keep the last N stranger events verbatim

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

  if (clientTag === "mcp") return { category: "mcp-client", log: true };
  if (BOT_RE.test(ua)) return { category: "bot-crawler", log: true };
  if (AGENT_RE.test(ua)) return { category: "ai-agent", log: true };
  if (!ua.trim()) return { category: "unknown-no-ua", log: true };
  if (!BROWSER_RE.test(ua)) return { category: "unknown-nonbrowser", log: true };
  // A browser UA with no referer to us: someone hitting an API URL directly, an
  // external embed, or a UA-spoofing client. Worth keeping an eye on.
  return { category: "external-browser", log: true };
}

function emptyLog() {
  return {
    version: 1,
    updatedAt: null,
    firstExternalAt: null,   // the milestone: timestamp of the first call we didn't cause
    firstExternal: null,     // the full first stranger event
    totals: { logged: 0 },
    byCategory: {},
    byEndpoint: {},
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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/**
 * Record one API access. Call at the top of a handler, after the OPTIONS guard:
 *
 *     await recordAccess(req, "query");
 *
 * Best-effort: self/UI traffic returns instantly without I/O; stranger candidates
 * trigger a bounded, never-throwing Blob write. The returned classification is
 * also handy if a caller wants to adapt behaviour (none do yet).
 */
export async function recordAccess(req, endpoint) {
  try {
    const { category, log } = classifyCaller(req);
    if (!log) return { category, logged: false };

    const event = {
      at: new Date().toISOString(),
      endpoint,
      category,
      method: req.method || "GET",
      ua: (req.headers?.["user-agent"] || "").toString().slice(0, 300),
      path: (req.url || "").toString().slice(0, 300),
      ipHash: ipHash(req),
      country: (req.headers?.["x-vercel-ip-country"] || "").toString() || null,
      client: (req.headers?.[CLIENT_HEADER] || "").toString().slice(0, 60) || null,
      referer: (req.headers?.referer || req.headers?.origin || "").toString().slice(0, 200) || null,
    };

    await withTimeout((async () => {
      const data = await loadLog();
      data.updatedAt = event.at;
      data.totals.logged = (data.totals.logged || 0) + 1;
      data.byCategory[category] = (data.byCategory[category] || 0) + 1;
      data.byEndpoint[endpoint] = (data.byEndpoint[endpoint] || 0) + 1;
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
    })(), 2500);

    return { category, logged: true };
  } catch {
    return { category: "error", logged: false };
  }
}

/** Read the access log (for the curator-gated report). Never throws. */
export async function readAccessLog() {
  return loadLog();
}
