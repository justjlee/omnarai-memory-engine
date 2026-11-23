// Operator access: who may read and change the curator's own records.
//
// Two ways in, one helper (operatorAuthed):
//   1. A signed-in browser session. The curator signs in once with a passphrase
//      (POST /api/info?_view=operator-session) and gets a cookie that JS cannot
//      read: __Host-omn_op, HttpOnly, Secure, SameSite=Strict, host-only on this
//      engine, 12 hours. No key is ever kept in browser storage.
//   2. Authorization: Bearer <INGEST_SECRET>, for the curator's local scripts.
//      Header only: a key in a URL is never read.
//
// Every comparison is constant time. Session cookies are HMAC-signed with
// OPERATOR_SESSION_KEY (rotating it signs everyone out). The passphrase is
// checked against OPERATOR_PASSPHRASE_HASH (scrypt); the passphrase itself is
// never stored anywhere on the server.
//
// Browser discipline for cookie-authenticated calls: the request must carry
// `x-omnarai-operator: 1` (which forces a CORS preflight) and, when it names an
// Origin, one from OPERATOR_ORIGINS. Responses on these routes are
// `private, no-store`.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { list, put } from "./_blob.js";
import { ipHash } from "./_telemetry.js";

export const COOKIE = "__Host-omn_op";
export const SESSION_TTL_S = 12 * 60 * 60;
export const OPERATOR_HEADER = "x-omnarai-operator";
export const OPERATOR_ORIGINS = Object.freeze(["https://omnarai.org", "https://www.omnarai.org", "https://engine.omnarai.org"]);
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAILS_PER_CALLER = 5;
const FAILS_GLOBAL = 30;
const FAIL_PREFIX = "operator-auth/fails/";

// ── Constant-time comparison ────────────────────────────────────────────────
// Both sides are reduced to fixed-length HMACs first, so neither the content nor
// the length of the secret leaks through timing.
export function secretEquals(given, secret) {
  if (!given || !secret) return false;
  const k = "omnarai-compare";
  const a = createHmac("sha256", k).update(String(given)).digest();
  const b = createHmac("sha256", k).update(String(secret)).digest();
  return timingSafeEqual(a, b);
}

export function bearerToken(req) {
  return String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

/** The curator's script credential (Bearer INGEST_SECRET), constant time. */
export function bearerIsCurator(req) {
  return secretEquals(bearerToken(req), (process.env.INGEST_SECRET || "").trim());
}

// ── Session cookie ──────────────────────────────────────────────────────────
const b64u = (buf) => Buffer.from(buf).toString("base64url");
function sessionKey() {
  return (process.env.OPERATOR_SESSION_KEY || "").trim() || null;
}
function sign(payload, key) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function mintSession(nowMs = Date.now()) {
  const key = sessionKey();
  if (!key) return null;
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_S;
  const payload = b64u(JSON.stringify({ sid: b64u(randomBytes(12)), exp }));
  return { value: `${payload}.${sign(payload, key)}`, exp };
}

export function verifySession(value, nowMs = Date.now()) {
  const key = sessionKey();
  if (!key || typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!secretEquals(sig, sign(payload, key))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isFinite(p.exp) || p.exp * 1000 <= nowMs) return null;
    return p;
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  const raw = String(req.headers?.cookie || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function originOk(req) {
  const o = req.headers?.origin;
  return !o || OPERATOR_ORIGINS.includes(String(o));
}

/** A valid browser session that follows the browser discipline above. */
export function sessionAuthed(req, nowMs = Date.now()) {
  if (!verifySession(readCookie(req, COOKIE), nowMs)) return false;
  if (String(req.headers?.[OPERATOR_HEADER] || "") !== "1") return false;
  return originOk(req);
}

/** The one operator check for every curator-only route. */
export function operatorAuthed(req) {
  return bearerIsCurator(req) || sessionAuthed(req);
}

// ── Response helpers ────────────────────────────────────────────────────────
function addVary(res, values) {
  const cur = String(res.getHeader?.("Vary") || "");
  const set = new Set(cur.split(",").map((s) => s.trim()).filter(Boolean));
  for (const v of values) set.add(v);
  res.setHeader("Vary", [...set].join(", "));
}

/** Credentialed CORS for the operator's own sites; anything else is left as is. */
export function applyOperatorCors(req, res) {
  const o = String(req.headers?.origin || "");
  if (!OPERATOR_ORIGINS.includes(o)) return;
  res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Omnarai-Receipt, X-Omnarai-Operator");
  addVary(res, ["Origin"]);
}

/** Headers for any response built from private records or an access check. */
export function privateNoStore(req, res) {
  applyOperatorCors(req, res);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  addVary(res, ["Authorization", "Cookie", "Origin", "x-omnarai-receipt"]);
}

export const OPERATOR_ONLY = Object.freeze({
  error: "Operator sign-in or Bearer INGEST_SECRET required",
  code: "OPERATOR_ONLY",
  retryable: false,
});
export function operatorDenied(req, res) {
  privateNoStore(req, res);
  return res.status(401).json(OPERATOR_ONLY);
}

// ── Passphrase ──────────────────────────────────────────────────────────────
// Stored form: scrypt$N$r$p$<salt base64>$<hash base64> (64-byte key).
export function hashPassphrase(passphrase, { N = 16384, r = 8, p = 1, salt = randomBytes(16) } = {}) {
  const hash = scryptSync(String(passphrase).normalize("NFC"), salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function verifyPassphrase(passphrase, stored = process.env.OPERATOR_PASSPHRASE_HASH) {
  const parts = String(stored || "").trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || typeof passphrase !== "string" || !passphrase) return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  try {
    const want = Buffer.from(hashB64, "base64");
    const got = scryptSync(passphrase.normalize("NFC"), Buffer.from(saltB64, "base64"), want.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// ── Failed-attempt limit ────────────────────────────────────────────────────
function failMs(pathname) {
  const m = /\/(\d{13})-[a-z0-9]+\.json$/.exec(pathname);
  return m ? Number(m[1]) : 0;
}
async function recentFails(caller, nowMs) {
  const { blobs } = await list({ prefix: FAIL_PREFIX });
  const recent = blobs.filter((b) => nowMs - failMs(b.pathname) < FAIL_WINDOW_MS);
  return {
    caller: recent.filter((b) => b.pathname.startsWith(`${FAIL_PREFIX}${caller}/`)).length,
    global: recent.length,
    oldest: recent.length ? Math.min(...recent.map((b) => failMs(b.pathname))) : nowMs,
  };
}
async function recordFail(caller, nowMs) {
  await put(`${FAIL_PREFIX}${caller}/${nowMs}-${randomBytes(3).toString("hex")}.json`, JSON.stringify({ at: new Date(nowMs).toISOString() }), {
    access: "private", addRandomSuffix: false, contentType: "application/json",
  });
}

// ── POST|GET /api/info?_view=operator-session ───────────────────────────────
//   GET                         → { signed_in, expires_at }
//   POST {passphrase}           → sets the session cookie
//   POST ?action=end | {action:"end"} → clears it
export async function handleOperatorSession(req, res, { nowMs = Date.now() } = {}) {
  // Never a wildcard here: only the curator's own pages may call sign-in.
  if (!OPERATOR_ORIGINS.includes(String(req.headers?.origin || ""))) res.setHeader("Access-Control-Allow-Origin", OPERATOR_ORIGINS[0]);
  privateNoStore(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const s = verifySession(readCookie(req, COOKIE), nowMs);
    return res.status(200).json({ signed_in: Boolean(s), expires_at: s ? new Date(s.exp * 1000).toISOString() : null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  // Browser discipline applies to sign-in and sign-out too.
  if (String(req.headers?.[OPERATOR_HEADER] || "") !== "1" || !originOk(req)) {
    return res.status(403).json({ error: "operator requests must come from the curator's pages", code: "OPERATOR_ORIGIN" });
  }
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return res.status(400).json({ error: "JSON body required" });
  }

  if ((req.query?.action || body.action) === "end") {
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    return res.status(200).json({ signed_in: false });
  }

  if (!sessionKey() || !String(process.env.OPERATOR_PASSPHRASE_HASH || "").trim()) {
    return res.status(503).json({ error: "operator sign-in is not configured", code: "OPERATOR_UNCONFIGURED" });
  }
  if (req.query?.passphrase != null) {
    return res.status(400).json({ error: "send the passphrase in the request body, never in the address" });
  }
  const caller = ipHash(req) || "no-ip";
  let fails;
  try {
    fails = await recentFails(caller, nowMs);
  } catch {
    return res.status(503).json({ error: "sign-in is unavailable right now", code: "OPERATOR_UNAVAILABLE" });
  }
  if (fails.caller >= FAILS_PER_CALLER || fails.global >= FAILS_GLOBAL) {
    const retry = Math.max(1, Math.ceil((fails.oldest + FAIL_WINDOW_MS - nowMs) / 1000));
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: "too many failed sign-ins; try again later", retry_after_s: retry });
  }

  if (!verifyPassphrase(typeof body.passphrase === "string" ? body.passphrase : "")) {
    try { await recordFail(caller, nowMs); } catch { /* the attempt is still refused */ }
    return res.status(401).json({ error: "that passphrase didn't work", code: "OPERATOR_PASSPHRASE" });
  }
  const s = mintSession(nowMs);
  res.setHeader("Set-Cookie", sessionCookie(s.value, SESSION_TTL_S));
  return res.status(200).json({ signed_in: true, expires_at: new Date(s.exp * 1000).toISOString() });
}
