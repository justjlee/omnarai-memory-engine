// ── Council daily cap ─────────────────────────────────────────────────────────
// The council elicitation path is the only endpoint here that spends real money
// per anonymous request: one run = 5 frontier model calls, ~35s. It has always
// been open and unmetered, which was survivable while the council was a buried
// toggle. Promoting it to the front-page primary action points it at exactly the
// traffic most likely to invoke it in a loop — agents that follow docs literally
// — so the meter ships with the button, not after it.
//
// Design constraints this file answers to:
//
//  1. NO read-modify-write. Vercel Blob has no CAS; a consolidated counter would
//     silently drop concurrent increments (the failure that cost 13/14 records in
//     _grown.js). One marker blob per run, counted with a prefix LIST — exact
//     under concurrency by construction.
//
//  2. Same identity as telemetry. Keyed on _telemetry.js's salted ipHash, so
//     "who is this visitor" means one thing across the system. Raw IPs are never
//     stored here either.
//
//  3. Remote-MCP callers must not share a quota. api/_mcp.js self-fetches
//     /api/council from OUR deployment on behalf of a real remote caller, so the
//     inbound IP is a Vercel egress address shared by every MCP user on earth. A
//     naive IP cap would collapse them all into one bucket and lock out all of
//     them after one user's runs. _mcp.js therefore forwards the ORIGINAL
//     caller's hash — and because a forwarded hash is otherwise trivially
//     spoofable (rotate the header, get unlimited runs), it is only honored when
//     signed with INGEST_SECRET, which only our own code has.
//
//  4. Fail OPEN, in both directions. A blob outage must never block a legitimate
//     visitor from the flagship action, and a request with no derivable IP is
//     allowed rather than guessed at. The cap is cost control, not security; the
//     worst case it protects against is a bill, and a bill is recoverable.

import { list, put } from "@vercel/blob";
import { createHash, timingSafeEqual } from "node:crypto";
import { ipHash } from "./_telemetry.js";

const PREFIX = "council-usage/";
const DEFAULT_CAP = 5;

export function councilDailyCap() {
  const n = parseInt(process.env.COUNCIL_DAILY_CAP || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Next UTC midnight — what we tell a capped visitor, so "come back later" has a
// number attached instead of being a shrug.
export function quotaResetsAt() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

// ── Signed origin passthrough (constraint 3) ─────────────────────────────────
export function signOriginHash(hash) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || !hash) return null;
  return createHash("sha256").update(`${secret}|council-origin|${hash}`).digest("hex").slice(0, 16);
}

// Headers for an internal self-fetch. api/_mcp.js spreads these into its
// /api/council request so the REMOTE caller — not Vercel's egress IP — is the
// one being metered.
export function originHeaders(req) {
  const h = ipHash(req);
  const sig = signOriginHash(h);
  if (!h || !sig) return {};
  return { "x-omnarai-origin-hash": h, "x-omnarai-origin-sig": sig };
}

function trustedOriginHash(req) {
  const h = req.headers?.["x-omnarai-origin-hash"];
  const sig = req.headers?.["x-omnarai-origin-sig"];
  if (!h || !sig) return null;
  const expect = signOriginHash(String(h));
  if (!expect) return null;
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expect);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? String(h) : null;
}

// ── Exemptions ───────────────────────────────────────────────────────────────
// The curator's own scripts, the cron, and anything holding INGEST_SECRET are
// not metered — they are not the abuse case and blocking them would break the
// verification runbooks.
function exemptReason(req) {
  if (req.headers?.["x-omnarai-self"]) return "self";
  const auth = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (auth && process.env.INGEST_SECRET && auth === process.env.INGEST_SECRET) return "curator";
  if (auth && process.env.CRON_SECRET && auth === process.env.CRON_SECRET) return "cron";
  return null;
}

/**
 * Who is being metered for this request.
 * Returns { hash, exempt, reason }. hash === null ⇒ unidentifiable ⇒ never blocked.
 */
export function quotaSubject(req) {
  const reason = exemptReason(req);
  if (reason) return { hash: null, exempt: true, reason };
  // A signed origin hash outranks the socket IP: it names the real caller behind
  // our own self-fetch. Unsigned or badly-signed headers are ignored entirely.
  const hash = trustedOriginHash(req) || ipHash(req);
  return { hash, exempt: false, reason: null };
}

/**
 * How many council runs this subject has already spent today.
 * Counted by LISTing marker blobs — no RMW, exact under concurrent runs.
 */
export async function councilRunsToday(hash, { day = today() } = {}) {
  if (!hash) return 0;
  const { blobs } = await list({ prefix: `${PREFIX}${day}/${hash}-` });
  return blobs.length;
}

/**
 * Quota check for one inbound council request.
 * Returns { allowed, used, cap, remaining, hash, exempt, reason, resetsAt }.
 * Any failure to read the ledger returns allowed:true (constraint 4).
 */
export async function checkCouncilQuota(req) {
  const cap = councilDailyCap();
  const { hash, exempt, reason } = quotaSubject(req);
  if (exempt || !hash) {
    return { allowed: true, used: 0, cap, remaining: cap, hash, exempt: true, reason: reason || "unidentified", resetsAt: quotaResetsAt() };
  }
  try {
    const used = await councilRunsToday(hash);
    return {
      allowed: used < cap,
      used, cap,
      remaining: Math.max(0, cap - used),
      hash, exempt: false, reason: null,
      resetsAt: quotaResetsAt(),
    };
  } catch {
    // Ledger unreachable — never block the flagship action on our own storage.
    return { allowed: true, used: 0, cap, remaining: cap, hash, exempt: true, reason: "ledger-unavailable", resetsAt: quotaResetsAt() };
  }
}

/**
 * Record that a run happened. Call AFTER a successful elicitation — a failed
 * council (no panel assembled) spent nothing the visitor got value from, and
 * charging for it would meter our own outages against the visitor.
 * Never throws: a lost marker undercounts, which is the safe direction.
 */
export async function recordCouncilRun(hash, { day = today() } = {}) {
  if (!hash) return false;
  try {
    const key = `${PREFIX}${day}/${hash}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await put(key, JSON.stringify({ at: new Date().toISOString() }), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return true;
  } catch {
    return false;
  }
}


// ── Contribution flood guard (Full Expansion Architecture §34: "input size limits; rate limiting;
// moderation; deduplication") ─────────────────────────────────────────────────
// /api/contribute is open and unauthenticated, and every call writes a contribution blob and a
// footprint blob and lands in the curator's pending queue. Size limits, the justification
// vocabulary and secret detection already exist; per-visitor rate limiting and exact-duplicate
// refusal did not. Same constraints as the council meter above: no read-modify-write (one marker
// blob per submission, counted by prefix LIST), keyed on the same salted ipHash (raw IPs are never
// stored), signed origin passthrough for remote-MCP callers, and FAIL OPEN on a storage error — this
// protects the curator's queue and our storage bill, it is not a security boundary; moderation still
// gates everything.
const CONTRIB_PREFIX = "contribute-usage/";
const DEDUPE_PREFIX = "contribute-dedupe/";
const DEFAULT_CONTRIB_CAP = 10;

export function contributionDailyCap() {
  const n = parseInt(process.env.CONTRIB_DAILY_CAP || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTRIB_CAP;
}

export async function checkContributionQuota(req) {
  const cap = contributionDailyCap();
  const { hash, exempt, reason } = quotaSubject(req);
  const open = (why) => ({ allowed: true, used: 0, cap, remaining: cap, hash, exempt: true, reason: why, resetsAt: quotaResetsAt() });
  if (exempt || !hash) return open(reason || "unidentified");
  try {
    const { blobs } = await list({ prefix: `${CONTRIB_PREFIX}${today()}/${hash}-` });
    return { allowed: blobs.length < cap, used: blobs.length, cap, remaining: Math.max(0, cap - blobs.length), hash, exempt: false, reason: null, resetsAt: quotaResetsAt() };
  } catch {
    return open("ledger-unavailable");
  }
}

// Call AFTER the contribution is stored: a rejected or failed submission never counts against the visitor.
export async function recordContributionUse(hash) {
  if (!hash) return false;
  try {
    await put(`${CONTRIB_PREFIX}${today()}/${hash}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`, JSON.stringify({ at: new Date().toISOString() }), { access: "public", contentType: "application/json", addRandomSuffix: false });
    return true;
  } catch {
    return false;
  }
}

const normForDedupe = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
/** Stable fingerprint of (target question, declared identity, answer text) after whitespace/case folding. */
export function contributionFingerprint(targetId, identity, answer) {
  return createHash("sha256").update(`${targetId}\n${normForDedupe(identity)}\n${normForDedupe(answer)}`).digest("hex").slice(0, 32);
}

/** The id of an earlier identical contribution, or null. Never throws (a read failure is "not a duplicate"). */
export async function findDuplicateContribution(fp) {
  try {
    const { blobs } = await list({ prefix: `${DEDUPE_PREFIX}${fp}__` });
    if (!blobs.length) return null;
    const m = /__(OMN-[A-Za-z0-9-]+)\.json$/.exec(blobs[0].pathname || "");
    return m ? m[1] : "unknown";
  } catch {
    return null;
  }
}

export async function recordContributionFingerprint(fp, contributionId) {
  try {
    await put(`${DEDUPE_PREFIX}${fp}__${contributionId}.json`, JSON.stringify({ at: new Date().toISOString() }), { access: "public", contentType: "application/json", addRandomSuffix: false });
    return true;
  } catch {
    return false;
  }
}
