// The one door to Blob storage. Every module in api/ imports put / list / del
// from here (scripts/check-storage-classes.mjs enforces it), and reads stored
// bodies with blobFetch() instead of fetch().
//
// Routing is by pathname, from api/_storage-classes.js:
//   • public class  → the project's default store, exactly as before.
//   • private class → the private store, with an explicit server-side token.
//     Its objects have no public URL: blobFetch() reads them through the SDK.
//     Without that token a private write throws PrivateStoreUnavailable (503)
//     and NEVER falls back to the public store.
//
// Transition reads: while PRIVATE_READ_FALLBACK is not "off", a private-class
// LIST also includes objects from the previous location, so records written
// before this change stay visible until they are copied. The private copy
// always wins a pathname; every object served from the old location is counted
// (storageStatus()).
import * as sdk from "@vercel/blob";
import { classOf as tableClassOf, classOfPrefix as tableClassOfPrefix } from "./_storage-classes.js";

export { BlobPreconditionFailedError } from "@vercel/blob";

export class PrivateStoreUnavailable extends Error {
  constructor() {
    super("private storage is not configured");
    this.name = "PrivateStoreUnavailable";
    this.status = 503;
  }
}

// Unknown pathnames are treated as private: a missing table entry can only make
// a record harder to read, never public.
export const classOf = (pathname) => tableClassOf(pathname) || "private";
function classOfPrefix(prefix) {
  const c = tableClassOfPrefix(prefix);
  if (c === "mixed") throw new Error(`storage: list prefix "${prefix}" spans public and private classes`);
  return c || "private";
}

function privateToken() {
  const t = (process.env.PRIVATE_BLOB_READ_WRITE_TOKEN || "").trim();
  if (!t) throw new PrivateStoreUnavailable();
  return t;
}
export const privateStoreConfigured = () => Boolean((process.env.PRIVATE_BLOB_READ_WRITE_TOKEN || "").trim());
const fallbackOn = () => (process.env.PRIVATE_READ_FALLBACK || "").trim().toLowerCase() !== "off";

/** True for a URL on a private Blob host (real or the hermetic test store). */
export function isPrivateUrl(url) {
  try {
    return new URL(String(url)).hostname.split(".").includes("private");
  } catch {
    return false;
  }
}

// ── Transition accounting ────────────────────────────────────────────────────
const fallback = { reads: 0, byPrefix: {} };
function noteFallback(prefix, n) {
  if (!n) return;
  fallback.reads += n;
  fallback.byPrefix[prefix] = (fallback.byPrefix[prefix] || 0) + n;
  console.warn(`[storage] ${n} object(s) under ${prefix} served from the previous location`);
}
export function storageStatus() {
  return {
    private_configured: privateStoreConfigured(),
    transition_reads: fallbackOn(),
    fallback_reads_this_instance: fallback.reads,
    fallback_by_prefix: { ...fallback.byPrefix },
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────
export async function put(pathname, body, opts = {}) {
  if (classOf(pathname) === "private") {
    const token = privateToken();
    return sdk.put(pathname, body, { ...opts, access: "private", token });
  }
  return sdk.put(pathname, body, opts);
}

// ── Listing ──────────────────────────────────────────────────────────────────
const LIST_CEILING = 60000; // per store per prefix; the largest live prefix is one telemetry day
async function listEverything(prefix, extra) {
  const out = [];
  let cursor;
  do {
    const r = await sdk.list({ prefix, limit: 1000, cursor, ...extra });
    out.push(...(r.blobs || []));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor && out.length < LIST_CEILING);
  return out;
}

// Continuation pages of a merged listing reuse the first page's snapshot for a
// few seconds, so paging through a prefix doesn't re-list both stores per page.
const merged = new Map(); // prefix -> { at, blobs }
const MERGE_TTL_MS = 5000;

async function mergedListing(prefix, token, continuation) {
  const hit = merged.get(prefix);
  if (continuation && hit && Date.now() - hit.at < MERGE_TTL_MS) return hit.blobs;
  const [priv, pub] = await Promise.all([
    listEverything(prefix, { token }),
    listEverything(prefix, {}).catch(() => []),
  ]);
  const byPath = new Map();
  for (const b of pub) byPath.set(b.pathname, b);
  let fromPublic = byPath.size;
  for (const b of priv) {
    if (byPath.has(b.pathname)) fromPublic--;
    byPath.set(b.pathname, b);
  }
  noteFallback(prefix, fromPublic);
  const blobs = [...byPath.values()].sort((a, b) => (a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0));
  merged.set(prefix, { at: Date.now(), blobs });
  return blobs;
}

export async function list(opts = {}) {
  const prefix = opts.prefix || "";
  if (classOfPrefix(prefix) === "public") return sdk.list(opts);
  const token = privateToken();
  if (!fallbackOn()) return sdk.list({ ...opts, token });
  const continuation = typeof opts.cursor === "string" && opts.cursor.startsWith("m:");
  const all = await mergedListing(prefix, token, continuation);
  const start = continuation ? Number(opts.cursor.slice(2)) || 0 : 0;
  const limit = opts.limit || 1000;
  const blobs = all.slice(start, start + limit);
  const next = start + limit < all.length ? `m:${start + limit}` : undefined;
  return { blobs, cursor: next, hasMore: Boolean(next) };
}

// ── Deletes ──────────────────────────────────────────────────────────────────
export async function del(urlsOrPathnames) {
  const items = [].concat(urlsOrPathnames).filter(Boolean).map(String);
  const priv = [];
  const pub = [];
  for (const u of items) {
    const isUrl = /^https?:\/\//.test(u);
    if (isUrl ? isPrivateUrl(u) : classOf(u) === "private") priv.push(u);
    else pub.push(u);
  }
  if (priv.length) await sdk.del(priv, { token: privateToken() });
  if (pub.length) await sdk.del(pub);
}

// ── Reads ────────────────────────────────────────────────────────────────────
// Drop-in for fetch(blob.url…): public URLs pass straight through; private URLs
// are read server-side through the SDK, newest copy, never cached at an edge.
export async function blobFetch(url, init) {
  const u = String(url);
  if (!isPrivateUrl(u)) return fetch(u, init);
  const clean = u.split("?")[0];
  try {
    const r = await sdk.get(clean, { access: "private", token: privateToken(), useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return new Response("not found", { status: 404 });
    const headers = { "content-type": r.blob?.contentType || "application/json" };
    if (r.blob?.etag) headers.etag = r.blob.etag;
    return new Response(r.stream, { status: 200, headers });
  } catch (e) {
    if (e instanceof PrivateStoreUnavailable) throw e;
    return new Response("read failed", { status: 502 });
  }
}
