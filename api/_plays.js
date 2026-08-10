import { list, put } from "@vercel/blob";
import { createHash, randomBytes } from "crypto";

// ── Song-play telemetry ───────────────────────────────────────────────────────
// "How many times has a song been played?" This module is the instrument for
// that question. The two players — the static bar in omnarai-home/omnarai-player.js
// and the engine's React <OmnaraiPlayer> — both beacon here (POST /api/play) when
// a track starts, becomes a *qualified* listen, or plays to the end. The audio
// itself is self-hosted on this origin (engine.omnarai.org/audio/), so the engine
// is the natural home for the count.
//
// Design, borrowed from the two ledgers that already work here:
//  • Zero-loss by construction (the _telemetry.js lesson). Every play event is its
//    own append-only blob under plays/events/<day>/… — a unique new path per
//    event that a concurrent write cannot clobber. Vercel Blob has no CAS, so an
//    RMW counter would silently drop racing plays; per-entry can't.
//  • Cheap to read (the _budget.js lesson). The facts the leaderboard needs —
//    which track, which event, which listener — are encoded IN the blob PATHNAME:
//        plays/events/<day>/<slug>__<event>__<ipHash>__<ts>-<rand>.json
//    so the whole leaderboard is built from a LIST (metadata only, one cheap call
//    per 1000) and NEVER fetches a body. Bodies exist only for the gated raw view.
//  • Never trusts the client for counting identity. `ipHash` is derived
//    server-side from the caller IP (salted, truncated — the same privacy stance
//    as access telemetry: a repeat listener is recognisable, the address is not).
//    So "unique listeners" can't be inflated by a client spoofing an id; a single
//    IP hammering POST inflates raw `starts` but not `listeners` — read the latter.
//  • Never throws on the write path. A telemetry failure must never break a play.
//
// Public read (GET /api/play) exposes ONLY aggregates (counts, no ipHash, no IP
// addresses). The raw per-event view (GET /api/play?_view=raw&day=…) is gated
// behind INGEST_SECRET, same as /api/info?_view=traffic.

const EVENTS_PREFIX = "plays/events/";
const LIST_CEILING = 50000; // absolute stop for the pagination loop
const DELIM = "__"; // slugs use single "-", never "__" — safe field separator

// The 16 canonical tracks (slug → display title), mirrored from the audio
// manifest. Used to order the leaderboard and to title tracks in the read; NOT a
// gate on writes — see isKnownableSlug (new tracks must count without a redeploy).
export const TRACK_TITLES = {
  "01-one-knight-at-sls": "One Knight at SLS",
  "02-whales-in-the-oceans": "Whales in The Oceans",
  "03-in-a-submarine": "In A Submarine",
  "05-man-that-was-nice": "Man That Was NICE",
  "07-out-of-omniversal-empyrical-times": "Out of Omniversal Empyrical Times",
  "09-tunen-in-wo-autotune": "Tune'n In w/o Autotune",
  "10-i-feel-hope-rising-horizon": "I Feel Hope Rising (Horizon)",
  "11-grandpas-violin-of-sanging-prejudice": "Grandpa's Violin of Sanging Prejudice",
  "12-book-of-poetry-tragedy": "Book of Poetry — Tragedy",
  "13-one-generative-ais-collective-perspective": "One Generative AI's Collective Perspective",
  "14-empyrean-right-now": "Empyrean Right Now (THAN)",
  "15-expressions-lost-in-time": "Expressions Lost in Time",
  "17-are-you-ready": "Are You Ready",
  "20-i-dont-mean-it-like-that-no-drumz": "I Don't Mean It Like That (NO DRUMZ)",
  "21-are-you-scared": "Are You Scared",
  "186-weekend-dip": "Weekend Dip",
};

// The three lifecycle events, narrowest → fullest. `start` = playback began;
// `qualified` = passed the "this was a real listen, not a skip" threshold (fired
// client-side at ~30s); `complete` = played to the end.
export const PLAY_EVENTS = ["start", "qualified", "complete"];

// A slug we're willing to store. Known tracks always pass; unknown ones pass only
// if they look like a manifest slug ("<num>-<lowercase-words>"), so a track added
// to the manifest counts immediately without a redeploy, while junk / injection
// attempts (paths, spaces, uppercase, over-length) are dropped. `__` is banned so
// it can never collide with the path field separator.
export function isKnownableSlug(slug) {
  if (typeof slug !== "string") return false;
  if (Object.prototype.hasOwnProperty.call(TRACK_TITLES, slug)) return true;
  if (slug.length > 80 || slug.includes(DELIM)) return false;
  return /^[0-9]{1,3}-[a-z0-9-]+$/.test(slug);
}

// Salted, truncated hash of the caller IP. Same construction as _telemetry.js so
// a listener seen by both instruments hashes identically. Never stores the IP.
export function playerHash(req) {
  const fwd = (req.headers?.["x-forwarded-for"] || "").toString();
  const ip = fwd.split(",")[0].trim() || req.socket?.remoteAddress || "";
  if (!ip) return "no-ip";
  const salt = process.env.INGEST_SECRET || "omnarai";
  return createHash("sha256").update(salt + ip).digest("hex").slice(0, 12);
}

/**
 * Validate + normalise an inbound play beacon into the record we store, or return
 * { error } for a 400. Pure except for reading the caller IP off `req`.
 */
export function normalizePlay(body, req, now = new Date()) {
  const b = body && typeof body === "object" ? body : {};
  const slug = (b.slug || "").toString().trim();
  const event = (b.event || "").toString().trim();
  if (!isKnownableSlug(slug)) return { error: "bad or missing slug" };
  if (!PLAY_EVENTS.includes(event)) return { error: "bad or missing event" };
  const rec = {
    slug,
    event,
    at: now.toISOString(),
    ipHash: playerHash(req),
    source: (b.source || "").toString().slice(0, 24) || "unknown", // "static" | "engine" | …
  };
  const ms = Number(b.ms);
  if (Number.isFinite(ms) && ms >= 0 && ms < 24 * 3600 * 1000) rec.ms = Math.round(ms);
  return { rec };
}

// Build the loss-proof, list-readable blob key for one event. Every fact the
// leaderboard needs lives in the pathname; the body is a superset for forensics.
export function playKey(rec) {
  const day = rec.at.slice(0, 10);
  const stamp = rec.at.replace(/[:.]/g, "");
  const rand = randomBytes(3).toString("hex");
  return `${EVENTS_PREFIX}${day}/${rec.slug}${DELIM}${rec.event}${DELIM}${rec.ipHash}${DELIM}${stamp}-${rand}.json`;
}

// Parse a play blob key back into the fields the aggregator needs. Returns null
// for anything that doesn't match the shape (defensive against stray keys).
export function parsePlayKey(key) {
  const rest = key.startsWith(EVENTS_PREFIX) ? key.slice(EVENTS_PREFIX.length) : key;
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const day = rest.slice(0, slash);
  const name = rest.slice(slash + 1).replace(/\.json$/, "");
  const parts = name.split(DELIM);
  if (parts.length < 4) return null;
  const [slug, event, ipHash] = parts;
  if (!PLAY_EVENTS.includes(event)) return null;
  return { slug, event, ipHash, day };
}

const emptyTally = () => ({ starts: 0, qualified: 0, completes: 0, listeners: 0, lastDay: null });

/**
 * Aggregate parsed play records into a leaderboard. Pure — takes {slug,event,
 * ipHash,day}[] and returns the public-safe shape (counts only, no ipHash). This
 * is the unit-tested core; the read path just feeds it parsed keys.
 */
export function summarizePlays(records) {
  const perSlug = new Map(); // slug → tally
  const listenerSets = new Map(); // slug → Set(ipHash)  (collapsed to a count on output)
  const totals = { starts: 0, qualified: 0, completes: 0 };
  const perDay = new Map(); // day → {starts,qualified,completes}

  for (const r of records) {
    if (!r || !r.slug || !PLAY_EVENTS.includes(r.event)) continue;
    if (!perSlug.has(r.slug)) {
      perSlug.set(r.slug, emptyTally());
      listenerSets.set(r.slug, new Set());
    }
    const tally = perSlug.get(r.slug);
    if (r.event === "start") tally.starts++;
    else if (r.event === "qualified") tally.qualified++;
    else if (r.event === "complete") tally.completes++;
    totals[r.event === "start" ? "starts" : r.event === "qualified" ? "qualified" : "completes"]++;
    if (r.ipHash && r.ipHash !== "no-ip") listenerSets.get(r.slug).add(r.ipHash);
    if (r.day && (!tally.lastDay || r.day > tally.lastDay)) tally.lastDay = r.day;
    if (r.day) {
      if (!perDay.has(r.day)) perDay.set(r.day, { starts: 0, qualified: 0, completes: 0 });
      const d = perDay.get(r.day);
      d[r.event === "start" ? "starts" : r.event === "qualified" ? "qualified" : "completes"]++;
    }
  }

  const tracks = [...perSlug.entries()]
    .map(([slug, t]) => ({
      slug,
      title: TRACK_TITLES[slug] || slug,
      plays: t.starts, // "a play" == a start; qualified/completes are quality signals
      qualified: t.qualified,
      completes: t.completes,
      listeners: listenerSets.get(slug).size,
      completion_rate: t.starts ? Number((t.completes / t.starts).toFixed(3)) : 0,
      last_played: t.lastDay,
    }))
    .sort((a, b) => b.plays - a.plays || b.qualified - a.qualified);

  const distinctListeners = new Set();
  for (const set of listenerSets.values()) for (const h of set) distinctListeners.add(h);

  const days = Object.fromEntries([...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])));

  return {
    totals: {
      plays: totals.starts,
      qualified: totals.qualified,
      completes: totals.completes,
      distinct_listeners: distinctListeners.size,
      tracks_played: tracks.length,
    },
    tracks,
    days,
  };
}

// ── Blob I/O ──────────────────────────────────────────────────────────────────

/** Record one validated play event. Never throws (caller can fire-and-forget). */
export async function recordPlay(rec) {
  try {
    await put(playKey(rec), JSON.stringify(rec), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    return true;
  } catch {
    return false;
  }
}

// List every play key in a date window (default: all). LIST is metadata-only and
// paged to exhaustion — no body fetches, so this stays cheap as plays accumulate.
async function listPlayKeys() {
  const keys = [];
  let cursor;
  do {
    const page = await list({ prefix: EVENTS_PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) keys.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && keys.length < LIST_CEILING);
  return keys;
}

/**
 * The public leaderboard. `sinceDays` (optional) windows to the last N days by
 * the day segment in the key. Built entirely from LIST metadata.
 */
export async function readPlays({ sinceDays } = {}) {
  const keys = await listPlayKeys();
  let records = keys.map(parsePlayKey).filter(Boolean);
  if (Number.isFinite(sinceDays) && sinceDays > 0) {
    const cutoff = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString().slice(0, 10);
    records = records.filter((r) => r.day >= cutoff);
  }
  const summary = summarizePlays(records);
  return { updatedAt: new Date().toISOString(), window_days: sinceDays || "all", ...summary };
}

/** Gated forensic read: every event body for one day. */
export async function readPlayDay(day, { limit = 2000 } = {}) {
  const prefix = `${EVENTS_PREFIX}${day}/`;
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && blobs.length < LIST_CEILING);
  const wanted = blobs.slice(0, limit);
  const events = await Promise.all(
    wanted.map((b) =>
      fetch(b.url)
        .then((r) => r.json())
        .catch(() => null),
    ),
  );
  // Sort by actual event time (the key is slug-dominant, so blob order isn't
  // chronological) — newest first, which is what a forensic scan wants.
  events.sort((a, b) => (a && b ? (a.at < b.at ? 1 : -1) : 0));
  return { day, total: blobs.length, returned: wanted.length, events: events.filter(Boolean) };
}
