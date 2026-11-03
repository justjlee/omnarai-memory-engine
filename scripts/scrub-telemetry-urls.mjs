#!/usr/bin/env node
// One-shot scrub: apply the 2026-10-27 request-address rule (api/_telemetry.js sanitizePath /
// sanitizeReferer) to visitor-log entries written BEFORE it. Older events stored `path` as the raw
// request address, which can hold a continuance-receipt token, a job or session id, or more of the
// question than the 200 characters the privacy page promises.
//
// It rewrites only `path` and `referer`, with the same functions new events use, so a scrubbed old
// event looks exactly like a new one. It never drops, re-times or reclassifies an event, and counts
// are unchanged. Covers the per-event files (telemetry/events/) and the aggregate log's recent[] and
// firstExternal (telemetry/access-log.json).
//
// Three modes. Nothing is written without --apply.
//   node scripts/scrub-telemetry-urls.mjs [--since YYYY-MM-DD]
//       DRY RUN: lists every record that would change — where, which field, the value it would get
//       (already sanitized) and the NAMES of the parameters whose values would be removed. Never
//       prints a value being removed.
//   SCRUB_BACKUP_KEY=<64 hex> node scripts/scrub-telemetry-urls.mjs --apply --backup <new file> [--since …]
//       Writes an ENCRYPTED backup of every value it will remove (AES-256-GCM, file mode 0600, refused
//       inside iCloud/Dropbox or a git checkout, never overwrites), reads it back and verifies it, and
//       only then rewrites the records. Each record is re-read first and skipped if it changed since
//       the plan; each write is re-read afterwards and verified.
//   SCRUB_BACKUP_KEY=<64 hex> node scripts/scrub-telemetry-urls.mjs --restore <backup> [--apply]
//       Recovery: puts the backed-up values back, field by field, only where a record still holds
//       exactly what the scrub wrote. Dry run unless --apply.
// Needs BLOB_READ_WRITE_TOKEN (source .env.local). Tests: scripts/test-receipt-hygiene.mjs [H9, H10].

import { list, put } from "@vercel/blob";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, openSync, writeSync, closeSync, readFileSync, statSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { sanitizePath, sanitizeReferer, REDACTED } from "../api/_telemetry.js";

const LOG_KEY = "telemetry/access-log.json";
const EVENTS_PREFIX = "telemetry/events/";
const BACKUP_FORMAT = "omnarai-scrub-backup/1";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Names (never values) of the query parameters whose values the rule removes from `raw`.
function redactedNames(raw, after) {
  try {
    const u = new URL(String(raw), "http://local.invalid");
    const names = [];
    const kept = new URLSearchParams((after || "").split("?")[1] || "");
    for (const [k, v] of u.searchParams) if (kept.get(k.slice(0, 40)) === REDACTED && v !== REDACTED) names.push(k.slice(0, 40));
    return [...new Set(names)];
  } catch { return []; }
}

// Pure: returns {changed, event, reasons, fields}. reasons and fields name what was found, never the value.
export function scrubEvent(ev) {
  if (!ev || typeof ev !== "object") return { changed: false, event: ev, reasons: [], fields: [] };
  const out = { ...ev };
  const reasons = [];
  const fields = [];
  if (ev.path != null) {
    const p = sanitizePath(ev.path);
    if (p !== ev.path) {
      out.path = p;
      const names = redactedNames(ev.path, p);
      if (names.includes("receipt")) reasons.push("receipt");
      if (names.some((n) => ["job", "session_id", "token"].includes(n))) reasons.push("capability-id");
      if (!reasons.length) reasons.push(names.length ? "query-value" : "path-normalized");
      fields.push({ field: "path", after: p, redacted_params: names });
    }
  }
  if (ev.referer != null) {
    const r = sanitizeReferer(ev.referer);
    if (r !== ev.referer) { out.referer = r; reasons.push("referer"); fields.push({ field: "referer", after: r, note: "query string and fragment dropped" }); }
  }
  return { changed: reasons.length > 0, event: out, reasons, fields };
}

const matchOf = (ev) => ({ at: ev?.at ?? null, endpoint: ev?.endpoint ?? null, ipHash: ev?.ipHash ?? null });
const sameMatch = (ev, m) => ev && ev.at === m.at && (ev.endpoint ?? null) === m.endpoint && (ev.ipHash ?? null) === m.ipHash;
const pick = (ev) => ({ path: ev?.path ?? null, referer: ev?.referer ?? null });
const sameFields = (ev, f) => (ev?.path ?? null) === f.path && (ev?.referer ?? null) === f.referer;

async function fetchJson(url) {
  const r = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return r.json();
}

const writeOpts = { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" };

async function findBlob(pathname) {
  const { blobs } = await list({ prefix: pathname });
  return blobs.find((b) => b.pathname === pathname) || null;
}

// Read every candidate record and decide what would change. Never writes.
export async function plan({ since = null, concurrency = 50 } = {}) {
  if (since != null && !DAY_RE.test(since)) throw new Error(`--since must be YYYY-MM-DD, got "${since}"`);
  const changes = [];
  const errors = [];
  const tally = { events_seen: 0, events_changed: 0, by_reason: {}, aggregate_recent_changed: 0, aggregate_first_changed: false, aggregate_by_reason: {}, errors: 0 };
  const bump = (into, rs) => { for (const r of rs) into[r] = (into[r] || 0) + 1; };

  let cursor;
  const pending = [];
  do {
    const page = await list({ prefix: EVENTS_PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const day = b.pathname.slice(EVENTS_PREFIX.length, EVENTS_PREFIX.length + 10);
      if (since && day < since) continue;
      pending.push(b);
    }
    cursor = page.cursor;
  } while (cursor);

  for (let i = 0; i < pending.length; i += concurrency) {
    await Promise.all(pending.slice(i, i + concurrency).map(async (b) => {
      try {
        const ev = await fetchJson(b.url);
        tally.events_seen++;
        const s = scrubEvent(ev);
        if (!s.changed) return;
        tally.events_changed++;
        bump(tally.by_reason, s.reasons);
        changes.push({ location: { kind: "event", pathname: b.pathname }, match: matchOf(ev), before: pick(ev), after: pick(s.event), reasons: s.reasons, fields: s.fields });
      } catch (err) {
        tally.errors++;
        errors.push({ pathname: b.pathname, error: String(err.message || err).slice(0, 120) });
      }
    }));
  }

  const agg = await findBlob(LOG_KEY);
  if (agg) {
    try {
      const data = await fetchJson(agg.url);
      (data.recent || []).forEach((ev, index) => {
        const s = scrubEvent(ev);
        if (!s.changed) return;
        tally.aggregate_recent_changed++;
        bump(tally.aggregate_by_reason, s.reasons);
        changes.push({ location: { kind: "aggregate-recent", pathname: LOG_KEY, index }, match: matchOf(ev), before: pick(ev), after: pick(s.event), reasons: s.reasons, fields: s.fields });
      });
      if (data.firstExternal) {
        const s = scrubEvent(data.firstExternal);
        if (s.changed) {
          tally.aggregate_first_changed = true;
          bump(tally.aggregate_by_reason, s.reasons);
          changes.push({ location: { kind: "aggregate-first", pathname: LOG_KEY }, match: matchOf(data.firstExternal), before: pick(data.firstExternal), after: pick(s.event), reasons: s.reasons, fields: s.fields });
        }
      }
    } catch (err) {
      tally.errors++;
      errors.push({ pathname: LOG_KEY, error: String(err.message || err).slice(0, 120) });
    }
  }
  changes.sort((a, b) => (a.location.pathname + (a.location.index ?? "")).localeCompare(b.location.pathname + (b.location.index ?? "")));
  return { changes, errors, tally };
}

// One printable line per change. Shows the value a field WOULD GET (already sanitized) and the names of
// the parameters whose values go — never a value being removed.
export function describe(c) {
  const where = c.location.kind === "event" ? c.location.pathname : c.location.kind === "aggregate-recent" ? `${LOG_KEY} recent[${c.location.index}]` : `${LOG_KEY} firstExternal`;
  return c.fields.map((f) => `  ${where}  ${f.field} → ${JSON.stringify(f.after)}${f.redacted_params?.length ? `  (value removed: ${f.redacted_params.join(", ")})` : f.note ? `  (${f.note})` : "  (address normalized)"}`).join("\n");
}

// ── Backup: encrypted, restricted, verified before anything is written ─────────
function keyFrom(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex || "")) throw new Error("SCRUB_BACKUP_KEY must be 64 hex characters (a 256-bit key). Keep it somewhere other than the backup.");
  return Buffer.from(hex, "hex");
}

export function validateBackupPath(file) {
  const problems = [];
  if (!file) return ["--backup <file> is required with --apply"];
  if (!isAbsolute(file)) problems.push("the backup path must be absolute");
  const abs = resolve(file);
  if (existsSync(abs)) problems.push("the backup file already exists — a backup is never overwritten");
  const dir = dirname(abs);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) { problems.push(`the backup directory ${dir} does not exist`); return problems; }
  const real = realpathSync(dir);
  if (/\/Mobile Documents\/|\/Library\/CloudStorage\/|\/Dropbox\b|\/Google Drive\b|\/OneDrive\b/i.test(real + "/")) problems.push("the backup must not be in a synced folder (iCloud, Dropbox, Google Drive, OneDrive)");
  for (let d = real; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) { problems.push(`the backup must not be inside a git checkout (${d})`); break; }
    if (dirname(d) === d) break;
  }
  return problems;
}

export function writeBackup(file, changes, keyHex) {
  const key = keyFrom(keyHex);
  const payload = Buffer.from(JSON.stringify({ changes: changes.map(({ location, match, before, after }) => ({ location, match, before, after })) }), "utf8");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([c.update(payload), c.final()]);
  const doc = {
    format: BACKUP_FORMAT, created_at: new Date().toISOString(), count: changes.length,
    payload_sha256: createHash("sha256").update(payload).digest("hex"),
    cipher: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
  };
  const fd = openSync(file, "wx", 0o600); // fails if the file exists; owner read/write only
  try { writeSync(fd, JSON.stringify(doc)); } finally { closeSync(fd); }
  return { count: doc.count, payload_sha256: doc.payload_sha256 };
}

export function readBackup(file, keyHex) {
  const key = keyFrom(keyHex);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  if (doc.format !== BACKUP_FORMAT) throw new Error(`not a ${BACKUP_FORMAT} file`);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(doc.iv, "base64"));
  d.setAuthTag(Buffer.from(doc.tag, "base64"));
  const payload = Buffer.concat([d.update(Buffer.from(doc.ciphertext, "base64")), d.final()]);
  if (createHash("sha256").update(payload).digest("hex") !== doc.payload_sha256) throw new Error("backup payload hash mismatch");
  const { changes } = JSON.parse(payload.toString("utf8"));
  if (!Array.isArray(changes) || changes.length !== doc.count) throw new Error("backup count mismatch");
  return { changes, count: doc.count, payload_sha256: doc.payload_sha256, created_at: doc.created_at };
}

function verifyBackup(file, keyHex, changes) {
  const b = readBackup(file, keyHex);
  const mode = statSync(file).mode & 0o777;
  if (mode !== 0o600) throw new Error(`backup file mode is ${mode.toString(8)}, expected 600`);
  const key = (c) => JSON.stringify([c.location, c.before, c.after]);
  const want = new Set(changes.map(key));
  if (b.changes.length !== changes.length || !b.changes.every((c) => want.has(key(c)))) throw new Error("backup content does not match the plan");
  return b;
}

async function verifyWrite(pathname, check, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const blob = await findBlob(pathname);
    if (blob) { try { if (check(await fetchJson(blob.url))) return true; } catch { /* retry */ } }
    await new Promise((r) => setTimeout(r, i === 0 ? 0 : 1000));
  }
  return false;
}

// ── Apply ─────────────────────────────────────────────────────────────────────
export async function run({ apply = false, since = null, backup = null, backupKey = process.env.SCRUB_BACKUP_KEY, concurrency = 50, log = console.log } = {}) {
  const p = await plan({ since, concurrency });
  const tally = { ...p.tally, applied: false };
  log(`${p.changes.length} change(s) planned — ${tally.events_changed} of ${tally.events_seen} event files, ${tally.aggregate_recent_changed} aggregate recent[] entries${tally.aggregate_first_changed ? ", aggregate firstExternal" : ""}.`);
  for (const c of p.changes) log(describe(c));
  for (const e of p.errors) log(`  ! could not read ${e.pathname}: ${e.error}`);
  log(JSON.stringify(tally, null, 2));
  if (!apply) {
    if (p.changes.length) log("Dry run: nothing written. To apply: --apply --backup <new absolute file> with SCRUB_BACKUP_KEY set.");
    return { ...tally, changes: p.changes.length };
  }
  if (p.errors.length) throw new Error(`refusing --apply: ${p.errors.length} record(s) could not be read, so the plan is incomplete`);
  if (!p.changes.length) { log("Nothing to apply."); return { ...tally, changes: 0 }; }
  const pathProblems = validateBackupPath(backup);
  if (pathProblems.length) throw new Error(`refusing --apply: ${pathProblems.join("; ")}`);
  keyFrom(backupKey);

  const written = writeBackup(resolve(backup), p.changes, backupKey);
  verifyBackup(resolve(backup), backupKey, p.changes);
  log(`backup written and verified: ${resolve(backup)} (${written.count} change(s), payload sha256 ${written.payload_sha256.slice(0, 16)}…, mode 600)`);

  const result = { written: 0, verified: 0, conflicts: [], unverified: [] };
  const backedUp = new Set(p.changes.map((c) => JSON.stringify([c.location.kind, c.match, c.before])));

  for (const c of p.changes.filter((x) => x.location.kind === "event")) {
    const blob = await findBlob(c.location.pathname);
    const cur = blob ? await fetchJson(blob.url).catch(() => null) : null;
    if (!cur || !sameFields(cur, c.before)) { result.conflicts.push(c.location.pathname); continue; }
    const next = { ...cur, path: c.after.path, referer: c.after.referer };
    if (cur.referer === undefined && c.after.referer === null) delete next.referer;
    await put(c.location.pathname, JSON.stringify(next), writeOpts);
    result.written++;
    if (await verifyWrite(c.location.pathname, (x) => sameFields(x, c.after))) result.verified++; else result.unverified.push(c.location.pathname);
  }

  // The aggregate is re-read right before its one write (live telemetry also writes it) and re-scrubbed;
  // only changes that are in the verified backup are applied.
  if (p.changes.some((x) => x.location.kind !== "event")) {
    const blob = await findBlob(LOG_KEY);
    const data = blob ? await fetchJson(blob.url) : null;
    if (data) {
      let n = 0;
      const fix = (ev, kind) => {
        const s = scrubEvent(ev);
        if (!s.changed) return ev;
        if (!backedUp.has(JSON.stringify([kind, matchOf(ev), pick(ev)]))) { result.conflicts.push(`${LOG_KEY} ${kind} ${ev.at}`); return ev; }
        n++;
        return s.event;
      };
      data.recent = (data.recent || []).map((ev) => fix(ev, "aggregate-recent"));
      if (data.firstExternal) data.firstExternal = fix(data.firstExternal, "aggregate-first");
      if (n) {
        await put(LOG_KEY, JSON.stringify(data), writeOpts);
        result.written += n;
        const ok = await verifyWrite(LOG_KEY, (x) => (x.recent || []).every((ev) => !scrubEvent(ev).changed || !backedUp.has(JSON.stringify(["aggregate-recent", matchOf(ev), pick(ev)]))));
        if (ok) result.verified += n; else result.unverified.push(LOG_KEY);
      }
    }
  }
  log(`applied: ${result.written} written, ${result.verified} verified, ${result.conflicts.length} skipped (changed since the plan), ${result.unverified.length} not yet verified.`);
  for (const x of result.conflicts) log(`  skipped: ${x}`);
  for (const x of result.unverified) log(`  re-check later: ${x}`);
  return { ...tally, applied: true, changes: p.changes.length, backup: resolve(backup), ...result };
}

// ── Restore (recovery) ────────────────────────────────────────────────────────
export async function restore({ backup, backupKey = process.env.SCRUB_BACKUP_KEY, apply = false, log = console.log } = {}) {
  const b = readBackup(resolve(backup), backupKey);
  log(`backup ${resolve(backup)}: ${b.count} change(s), made ${b.created_at}, payload verified.`);
  const result = { restorable: 0, restored: 0, conflicts: [], applied: apply };
  for (const c of b.changes.filter((x) => x.location.kind === "event")) {
    const blob = await findBlob(c.location.pathname);
    const cur = blob ? await fetchJson(blob.url).catch(() => null) : null;
    if (!cur || !sameFields(cur, c.after)) { result.conflicts.push(c.location.pathname); continue; }
    result.restorable++;
    if (apply) { await put(c.location.pathname, JSON.stringify({ ...cur, path: c.before.path, referer: c.before.referer }), writeOpts); result.restored++; }
  }
  const aggChanges = b.changes.filter((x) => x.location.kind !== "event");
  if (aggChanges.length) {
    const blob = await findBlob(LOG_KEY);
    const data = blob ? await fetchJson(blob.url) : null;
    let n = 0;
    for (const c of aggChanges) {
      const target = c.location.kind === "aggregate-first" ? (sameMatch(data?.firstExternal, c.match) ? data.firstExternal : null) : (data?.recent || []).find((ev) => sameMatch(ev, c.match));
      if (!target || !sameFields(target, c.after)) { result.conflicts.push(`${LOG_KEY} ${c.location.kind} ${c.match.at}`); continue; }
      result.restorable++;
      target.path = c.before.path; target.referer = c.before.referer; n++;
    }
    if (apply && n) { await put(LOG_KEY, JSON.stringify(data), writeOpts); result.restored += n; }
  }
  log(`${result.restorable} restorable, ${result.conflicts.length} no longer match what the scrub wrote (left as they are).${apply ? ` Restored ${result.restored}.` : " Dry run: nothing written; add --apply to restore."}`);
  return result;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const out = { apply: false, since: null, backup: null, restore: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--since" || a === "--backup" || a === "--restore") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (out.since && !DAY_RE.test(out.since)) throw new Error(`--since must be YYYY-MM-DD, got "${out.since}"`);
  if (out.restore && out.backup) throw new Error("--restore and --backup are separate modes");
  return out;
}

// Compared as file URLs, so a path with spaces (the iCloud folder) still counts as "run directly".
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("BLOB_READ_WRITE_TOKEN is required (source .env.local)."); process.exit(2); }
  try {
    if (args.restore) await restore({ backup: args.restore, apply: args.apply });
    else await run({ apply: args.apply, since: args.since, backup: args.backup });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
