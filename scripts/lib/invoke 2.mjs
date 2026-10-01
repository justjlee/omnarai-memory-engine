// Drive the REAL serverless handlers the way Vercel would: apply vercel.json
// rewrites to a path, import api/<fn>.js, and call its default export with a
// minimal req/res. Used by the hermetic tests and the local engine server.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vercel = JSON.parse(readFileSync(`${root}vercel.json`, "utf8"));

// Match a vercel.json `source` against a path. Supports literal segments,
// `:name` (one segment) — enough for every rewrite the engine uses on /api.
function matchSource(source, path) {
  const s = source.split("/"), p = path.split("/");
  if (s.length !== p.length) return null;
  const params = {};
  for (let i = 0; i < s.length; i++) {
    if (s[i].startsWith(":")) { if (!p[i]) return null; params[s[i].slice(1)] = decodeURIComponent(p[i]); }
    else if (s[i] !== p[i]) return null;
  }
  return params;
}

export function resolveRoute(pathname, searchParams = new URLSearchParams()) {
  let target = pathname;
  const query = {};
  for (const r of vercel.rewrites || []) {
    const params = matchSource(r.source, pathname);
    if (!params) continue;
    let dest = r.destination;
    for (const [k, v] of Object.entries(params)) dest = dest.replace(`:${k}`, encodeURIComponent(v));
    const [p, qs] = dest.split("?");
    target = p;
    for (const [k, v] of new URLSearchParams(qs || "")) query[k] = v;
    break;
  }
  for (const [k, v] of searchParams) if (!(k in query)) query[k] = v;
  const m = /^\/api\/([a-z-]+)$/.exec(target);
  return m ? { fn: m[1], query, target } : { fn: null, query, target };
}

const handlers = new Map();
async function handlerFor(fn) {
  if (!handlers.has(fn)) handlers.set(fn, (await import(`${root}api/${fn}.js`)).default);
  return handlers.get(fn);
}

// call("/api/footprints?id=…", {method, body, headers}) → {status, body, headers}
export async function call(url, { method = "GET", body, headers = {} } = {}) {
  const u = new URL(url, "http://local.test");
  const { fn, query } = resolveRoute(u.pathname, u.searchParams);
  if (!fn) return { status: 404, body: { error: `no api route for ${u.pathname}` }, headers: {} };
  const handler = await handlerFor(fn);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      getHeader(k) { return this.headers[k.toLowerCase()]; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o)), headers: this.headers }); return this; },
      send(s) { resolve({ status: this.statusCode, body: s, headers: this.headers }); return this; },
      end() { resolve({ status: this.statusCode, body: null, headers: this.headers }); return this; },
    };
    const req = { method, query, body: body ?? {}, headers: { "user-agent": "omnarai-hermetic-test", ...lower }, url: u.pathname + u.search };
    Promise.resolve(handler(req, res)).catch((err) => resolve({ status: 500, body: { error: String(err?.stack || err) }, headers: res.headers }));
  });
}
