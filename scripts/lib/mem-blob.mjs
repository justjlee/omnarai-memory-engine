// In-memory stand-in for @vercel/blob — HERMETIC tests and the local engine.
// Loaded in place of the real SDK by scripts/lib/register-mem-blob.mjs, so the
// real handlers (council.js, info.js, …) run unmodified against it. Nothing here
// can reach the production Blob store: every blob URL is on mem.blob.test, and
// the fetch shim refuses all other network unless MEM_BLOB_ALLOW_NET=1.
//
// Test hooks (named exports prefixed __): reset, seed, dump, and fault
// injection — `__faults.put` (throw on matching puts), `__faults.list` (throw on
// LIST), `__faults.staleList` (LIST omits blobs written in the last N ms, the
// CDN read-after-write lag that made the consolidated-array pattern lose data),
// `__faults.staleRead` (a GET of a matching pathname serves the PREVIOUS version,
// body and ETag together, as a lagging CDN edge does).
//
// Mirrors @vercel/blob 2.x put semantics: every blob carries an ETag; a put onto
// an existing pathname throws unless `allowOverwrite: true` or `ifMatch` is set;
// an `ifMatch` that isn't the current ETag throws BlobPreconditionFailedError.
import { createHash } from "node:crypto";

export const MEM_ORIGIN = "https://mem.blob.test/";

const S = (globalThis.__MEM_BLOB__ ||= {
  files: new Map(),       // pathname -> { body, uploadedAt, contentType }
  putLog: [],             // every put, in order: { pathname, at }
  faults: { put: null, list: null, staleList: 0, staleRead: null },
});

export const __faults = S.faults;
export function __reset() {
  S.files.clear();
  S.putLog.length = 0;
  S.faults.put = null;
  S.faults.list = null;
  S.faults.staleList = 0;
  S.faults.stalePrefix = "";
  S.faults.staleRead = null;
}
// Whole-store snapshot/restore: lets a harness run several arms from the SAME store state (CRT v1 runs arms N/S/R
// from one admitted prior footprint). Bodies are strings, so a shallow copy of the map is a true snapshot.
export function __snapshot() { return new Map(S.files); }
export function __restore(snap) { S.files.clear(); for (const [k, v] of snap) S.files.set(k, v); }
const etagOf = (text) => `"${createHash("md5").update(text).digest("hex")}"`;

export function __seed(pathname, value) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  S.files.set(pathname, { body, etag: etagOf(body), uploadedAt: new Date(0), contentType: "application/json" });
}
export function __dump(prefix = "") {
  return [...S.files.keys()].filter((k) => k.startsWith(prefix)).sort();
}
export function __read(pathname) {
  const f = S.files.get(pathname);
  return f ? JSON.parse(f.body) : null;
}
export const __putLog = S.putLog;

const rand = () => Math.random().toString(36).slice(2, 10);

export class BlobError extends Error {}
export class BlobPreconditionFailedError extends BlobError {
  constructor() { super("Vercel Blob: Precondition failed: ETag mismatch."); this.name = "BlobPreconditionFailedError"; }
}

export async function put(pathname, body, opts = {}) {
  if (S.faults.put && S.faults.put(pathname)) throw new Error(`mem-blob: injected put failure for ${pathname}`);
  let path = pathname;
  if (opts.addRandomSuffix) {
    const dot = path.lastIndexOf(".");
    path = dot > 0 ? `${path.slice(0, dot)}-${rand()}${path.slice(dot)}` : `${path}-${rand()}`;
  }
  const text = typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  const cur = S.files.get(path);
  if (opts.ifMatch !== undefined && (!cur || cur.etag !== opts.ifMatch)) throw new BlobPreconditionFailedError();
  if (cur && !opts.allowOverwrite && opts.ifMatch === undefined) {
    throw new BlobError("Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.");
  }
  const etag = etagOf(text);
  S.files.set(path, { body: text, etag, prev: cur ? { body: cur.body, etag: cur.etag } : null, uploadedAt: new Date(), contentType: opts.contentType || "application/octet-stream" });
  S.putLog.push({ pathname: path, at: Date.now() });
  return { url: MEM_ORIGIN + path, downloadUrl: MEM_ORIGIN + path, pathname: path, contentType: opts.contentType, etag };
}

export async function list({ prefix = "", cursor, limit = 1000 } = {}) {
  if (S.faults.list && S.faults.list(prefix)) throw new Error(`mem-blob: injected list failure for ${prefix}`);
  const lagged = S.faults.staleList && prefix.startsWith(S.faults.stalePrefix || "");
  const cutoff = lagged ? Date.now() - S.faults.staleList : Infinity;
  const keys = [...S.files.keys()]
    .filter((k) => k.startsWith(prefix) && S.files.get(k).uploadedAt.getTime() <= cutoff)
    .sort();
  const start = cursor ? Number(cursor) : 0;
  const page = keys.slice(start, start + limit);
  const next = start + limit < keys.length ? String(start + limit) : undefined;
  return {
    blobs: page.map((k) => ({ pathname: k, url: MEM_ORIGIN + k, downloadUrl: MEM_ORIGIN + k, size: S.files.get(k).body.length, uploadedAt: S.files.get(k).uploadedAt, etag: S.files.get(k).etag })),
    cursor: next,
    hasMore: Boolean(next),
  };
}

export async function del(urls) {
  for (const u of [].concat(urls)) S.files.delete(String(u).replace(MEM_ORIGIN, "").split("?")[0]);
}

export async function head(url) {
  const k = String(url).replace(MEM_ORIGIN, "").split("?")[0];
  const f = S.files.get(k);
  if (!f) throw new Error("BlobNotFoundError");
  return { pathname: k, url: MEM_ORIGIN + k, size: f.body.length, uploadedAt: f.uploadedAt, contentType: f.contentType, etag: f.etag };
}

export async function copy() { throw new Error("mem-blob: copy not implemented"); }

// fetch shim: serves mem.blob.test from the map; refuses everything else.
export function installFetch() {
  if (globalThis.__MEM_FETCH_INSTALLED__) return;
  const realFetch = globalThis.fetch;
  globalThis.__MEM_FETCH_INSTALLED__ = true;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (url.startsWith(MEM_ORIGIN)) {
      const k = decodeURIComponent(url.slice(MEM_ORIGIN.length).split("?")[0]);
      const f = S.files.get(k);
      if (!f) return new Response("not found", { status: 404 });
      const v = S.faults.staleRead && f.prev && S.faults.staleRead(k) ? f.prev : f;
      return new Response(v.body, { status: 200, headers: { "content-type": f.contentType, etag: v.etag } });
    }
    if (process.env.MEM_BLOB_ALLOW_NET === "1") return realFetch(input, init);
    throw new Error(`hermetic: network blocked (${url.slice(0, 80)})`);
  };
}
installFetch();
