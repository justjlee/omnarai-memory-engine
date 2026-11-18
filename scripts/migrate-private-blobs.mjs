#!/usr/bin/env node
// Copy private-class records from the previous (public) store into the private store.
// DRY RUN BY DEFAULT: reads, counts and plans; writes nothing.
//
//   node scripts/migrate-private-blobs.mjs [--site engine|org]                       # dry run
//   node scripts/migrate-private-blobs.mjs --apply --archive <abs file> --manifest <abs file>
//   node scripts/migrate-private-blobs.mjs --delete-public --manifest <f> --archive <f> [--apply --approval "<text>"]
//
// Credentials come from the environment, never the command line:
//   SOURCE_BLOB_TOKEN   read-write token of the previous store (defaults to BLOB_READ_WRITE_TOKEN)
//   PRIVATE_BLOB_READ_WRITE_TOKEN   the private store
//   ARCHIVE_KEY         64 hex (AES-256-GCM); kept in the macOS Keychain, never in a file
//
// --apply, in order, refusing to go on at any failure:
//   1. reads every in-scope object (retrying transient errors; one unreadable object stops the run);
//   2. writes ONE encrypted archive of every object exactly as it was (0600, outside synced folders and
//      git checkouts, never overwritten), then reads it back and checks the count and every hash;
//   3. copies: records keep their pathname and bytes; access telemetry passes the request-address rule
//      (api/_telemetry.js) on the way in; events older than the retention window are not copied (the
//      archive holds them) and every past day gets a daily total (telemetry/daily/<day>.json);
//      an object the new code already wrote privately is never overwritten;
//   4. reads every private object back (no cache) and checks its hash;
//   5. writes an encrypted manifest (pathname, hashes, sizes, action; no content) and prints its hash.
// Re-running is safe: finished objects are recognised by hash and skipped.
//
// --delete-public removes copied objects from the previous store. Dry run unless --apply, and --apply
// needs --approval with the exact sentence the dry run prints (it names the store, the object count and
// the manifest hash). Scope "fixed-address" (default) leaves access-telemetry event files in place.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { openSync, writeSync, closeSync, readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { list, put, get, del } from "@vercel/blob";
import { STORAGE_CLASSES } from "../api/_storage-classes.js";
import { scrubEvent, validateBackupPath } from "./scrub-telemetry-urls.mjs";

export const ARCHIVE_FORMAT = "omnarai-private-move-archive/1";
export const MANIFEST_FORMAT = "omnarai-private-move-manifest/1";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SITES = {
  engine: { store: "engine", prefixes: Object.entries(STORAGE_CLASSES).filter(([, c]) => c === "private").map(([p]) => p), eventsPrefix: "telemetry/events/", logKey: "telemetry/access-log.json", dailyPrefix: "telemetry/daily/" },
  org: { store: "front-door", prefixes: ["telemetry/"], eventsPrefix: "telemetry/org-events/", logKey: null, dailyPrefix: "telemetry/org-daily/" },
};

async function retry(fn, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (e?.permanent) throw e; await sleep(Math.min(4000, 150 * 2 ** i)); }
  }
  throw last;
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ── 1. Inventory and read ───────────────────────────────────────────────────
export async function inventory({ site = "engine", sourceToken } = {}) {
  const cfg = SITES[site];
  const seen = new Map();
  for (const prefix of cfg.prefixes) {
    let cursor;
    do {
      const r = await retry(() => list({ prefix, limit: 1000, cursor, ...(sourceToken ? { token: sourceToken } : {}) }));
      for (const b of r.blobs) seen.set(b.pathname, b);
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
  }
  return [...seen.values()].sort((a, b) => (a.pathname < b.pathname ? -1 : 1));
}

async function readPublic(b) {
  const bust = b.pathname.includes("/events/") ? "" : `?ts=${Date.now()}`;
  return retry(async () => {
    const r = await fetch(`${b.url}${bust}`, { cache: "no-store" });
    if (r.status === 404) throw Object.assign(new Error("gone"), { permanent: true });
    if (!r.ok) throw new Error(`read ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    return { bytes, contentType: r.headers.get("content-type") || "application/json" };
  });
}

export async function readAll(blobs, { concurrency = 64, log = () => {} } = {}) {
  const failed = [];
  const vanished = []; // listed, then removed by the engine itself (expired jobs/sessions) — nothing to move
  let done = 0;
  const objects = await pool(blobs, concurrency, async (b) => {
    try {
      const { bytes, contentType } = await readPublic(b);
      if (++done % 5000 === 0) log(`  read ${done}/${blobs.length}`);
      return { pathname: b.pathname, url: b.url, bytes, contentType, sha256: sha(bytes), size: bytes.length };
    } catch (e) {
      (e?.permanent ? vanished : failed).push({ pathname: b.pathname, error: String(e.message || e).slice(0, 80) });
      return null;
    }
  });
  return { objects: objects.filter(Boolean), failed, vanished };
}

// ── 2. Archive ───────────────────────────────────────────────────────────────
function keyFrom(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex || "")) throw new Error("ARCHIVE_KEY must be 64 hex characters");
  return Buffer.from(hex, "hex");
}
function sealTo(file, format, payloadObj, keyHex, extra = {}) {
  const plain = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const zipped = gzipSync(plain);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(keyHex), iv);
  const ct = Buffer.concat([c.update(zipped), c.final()]);
  const doc = { format, created_at: new Date().toISOString(), ...extra, payload_sha256: sha(plain), cipher: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ciphertext: ct.toString("base64") };
  const fd = openSync(file, "wx", 0o600);
  try { writeSync(fd, JSON.stringify(doc)); } finally { closeSync(fd); }
  return doc.payload_sha256;
}
export function openSealed(file, format, keyHex) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  if (doc.format !== format) throw new Error(`not a ${format} file`);
  const d = createDecipheriv("aes-256-gcm", keyFrom(keyHex), Buffer.from(doc.iv, "base64"));
  d.setAuthTag(Buffer.from(doc.tag, "base64"));
  const plain = gunzipSync(Buffer.concat([d.update(Buffer.from(doc.ciphertext, "base64")), d.final()]));
  if (sha(plain) !== doc.payload_sha256) throw new Error("payload hash mismatch");
  if ((statSync(file).mode & 0o777) !== 0o600) throw new Error("file mode is not 600");
  return { doc, payload: JSON.parse(plain.toString("utf8")) };
}
export function writeArchive(file, objects, keyHex, site) {
  const entries = objects.map((o) => ({ pathname: o.pathname, contentType: o.contentType, sha256: o.sha256, size: o.size, b64: o.bytes.toString("base64") }));
  const hash = sealTo(file, ARCHIVE_FORMAT, { site, entries }, keyHex, { site, count: entries.length });
  // Read back before anything else happens.
  const { payload } = openSealed(file, ARCHIVE_FORMAT, keyHex);
  if (payload.entries.length !== objects.length) throw new Error("archive count mismatch on read-back");
  const want = new Map(objects.map((o) => [o.pathname, o.sha256]));
  for (const e of payload.entries) {
    if (want.get(e.pathname) !== e.sha256 || sha(Buffer.from(e.b64, "base64")) !== e.sha256) throw new Error(`archive entry ${e.pathname} does not verify`);
  }
  return { count: payload.entries.length, payload_sha256: hash };
}

// ── 3. Plan the copy ─────────────────────────────────────────────────────────
function eventDay(cfg, pathname) {
  if (!pathname.startsWith(cfg.eventsPrefix)) return null;
  const d = pathname.slice(cfg.eventsPrefix.length, cfg.eventsPrefix.length + 10);
  return DAY_RE.test(d) ? d : null;
}
export function sanitizeLog(log) {
  const out = { ...log };
  if (Array.isArray(log.recent)) out.recent = log.recent.map((e) => scrubEvent(e).event);
  if (log.firstExternal) out.firstExternal = scrubEvent(log.firstExternal).event;
  return out;
}
export function planObject(cfg, o, { cutoffDay }) {
  const day = eventDay(cfg, o.pathname);
  if (day) {
    if (day < cutoffDay) return { action: "aggregate-only" };
    let ev;
    try { ev = JSON.parse(o.bytes.toString("utf8")); } catch { return { action: "copy", bytes: o.bytes }; }
    const { changed, event } = scrubEvent(ev);
    return changed ? { action: "sanitized", bytes: Buffer.from(JSON.stringify(event)) } : { action: "copy", bytes: o.bytes };
  }
  if (cfg.logKey && o.pathname === cfg.logKey) return { action: "log" };
  return { action: "copy", bytes: o.bytes };
}
export function dailyTotals(events) {
  const days = {};
  for (const e of events) {
    const d = String(e.at || "").slice(0, 10);
    if (!DAY_RE.test(d)) continue;
    const t = (days[d] ||= { day: d, total: 0, monitor: 0, byCategory: {}, byEndpoint: {}, byCountry: {}, visitors: new Set() });
    t.total++;
    if (e.category === "monitor") t.monitor++;
    if (e.category) t.byCategory[e.category] = (t.byCategory[e.category] || 0) + 1;
    const ep = e.endpoint || e.path;
    if (e.endpoint) t.byEndpoint[ep] = (t.byEndpoint[ep] || 0) + 1;
    if (e.country) t.byCountry[e.country] = (t.byCountry[e.country] || 0) + 1;
    t.visitors.add(e.ipHash || "no-ip");
  }
  return Object.values(days).map((t) => ({
    format: "omnarai-daily-telemetry/1", day: t.day, total: t.total, monitor: t.monitor, signal: t.total - t.monitor,
    distinct_visitors: t.visitors.size, byCategory: t.byCategory, byEndpoint: t.byEndpoint, byCountry: t.byCountry,
  }));
}

async function readPrivate(pathname, token) {
  return retry(async () => {
    const r = await get(pathname, { access: "private", token, useCache: false });
    if (!r || r.statusCode !== 200) return null;
    const bytes = Buffer.from(await new Response(r.stream).arrayBuffer());
    return { bytes, sha256: sha(bytes), etag: r.blob?.etag };
  });
}
async function writePrivate(pathname, bytes, contentType, token, opts = {}) {
  return retry(() => put(pathname, bytes, { access: "private", token, addRandomSuffix: false, contentType, ...opts }), 4);
}

// ── Run ──────────────────────────────────────────────────────────────────────
export async function run({ site = "engine", apply = false, archive = null, manifest = null, keyHex = process.env.ARCHIVE_KEY,
  sourceToken = process.env.SOURCE_BLOB_TOKEN || undefined, privateToken = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN,
  now = new Date(), retentionDays = 90, concurrency = 48, log = console.log } = {}) {
  const cfg = SITES[site];
  if (!cfg) throw new Error(`unknown site ${site}`);
  if (apply) {
    for (const [flag, f] of [["--archive", archive], ["--manifest", manifest]]) {
      const p = validateBackupPath(f).map((x) => x.replace("--backup <file> is required with --apply", `${flag} <file> is required with --apply`).replace(/backup/g, "file"));
      if (p.length) throw new Error(`${flag}: ${p.join("; ")}`);
    }
    keyFrom(keyHex);
    if (!privateToken) throw new Error("PRIVATE_BLOB_READ_WRITE_TOKEN is not set");
  }
  const cutoffDay = new Date(now.getTime() - retentionDays * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const blobs = await inventory({ site, sourceToken });
  log(`${cfg.store} store: ${blobs.length} private-class objects in the previous location`);
  const { objects, failed, vanished } = await readAll(blobs, { concurrency, log });
  if (vanished.length) log(`${vanished.length} listed object(s) were removed before they could be read (expired); skipped`);
  if (failed.length) {
    log(`REFUSING: ${failed.length} object(s) could not be read after retries (first: ${failed.slice(0, 3).map((f) => f.pathname).join(", ")})`);
    return { ok: false, refused: "unreadable", failed, read: objects.length };
  }
  const plans = objects.map((o) => ({ o, plan: planObject(cfg, o, { cutoffDay }) }));
  const count = (a) => plans.filter((p) => p.plan.action === a).length;
  const events = [];
  for (const { o } of plans) if (eventDay(cfg, o.pathname)) { try { events.push(JSON.parse(o.bytes.toString("utf8"))); } catch { /* counted in archive */ } }
  const daily = dailyTotals(events).filter((d) => d.day < today);
  const summary = {
    site, objects: objects.length, bytes: objects.reduce((s, o) => s + o.size, 0), retention_cutoff: cutoffDay,
    copy: count("copy"), sanitized: count("sanitized"), aggregate_only: count("aggregate-only"), log: count("log"), daily_totals: daily.length,
  };
  log(`plan: ${JSON.stringify(summary)}`);
  if (!apply) { log("dry run — nothing written. Re-run with --apply --archive <file> --manifest <file>."); return { ok: true, dryRun: true, summary }; }

  // 2. Archive first.
  const arch = writeArchive(archive, objects, keyHex, site);
  log(`archive written and verified: ${arch.count} objects (payload sha256 ${arch.payload_sha256.slice(0, 16)}…)`);

  // 3. Copy.
  const results = [];
  const problems = [];
  await pool(plans, concurrency, async ({ o, plan }) => {
    const base = { pathname: o.pathname, source_sha256: o.sha256, source_size: o.size };
    try {
      if (plan.action === "aggregate-only") { results.push({ ...base, action: "aggregate-only", private_sha256: null }); return; }
      if (plan.action === "log") {
        // The private log may already be newer (the new code writes it); sanitize whichever is current.
        const cur = await readPrivate(o.pathname, privateToken);
        const src = cur ? JSON.parse(cur.bytes.toString("utf8")) : JSON.parse(o.bytes.toString("utf8"));
        const bytes = Buffer.from(JSON.stringify(sanitizeLog(src)));
        if (!cur || cur.sha256 !== sha(bytes)) {
          await put(o.pathname, bytes, { access: "private", token: privateToken, addRandomSuffix: false, contentType: "application/json", ...(cur ? { ifMatch: cur.etag } : {}) });
        }
        const back = await readPrivate(o.pathname, privateToken);
        results.push({ ...base, action: cur ? "log-sanitized-private" : "log-sanitized", private_sha256: back?.sha256 || null });
        return;
      }
      const want = sha(plan.bytes);
      const cur = await readPrivate(o.pathname, privateToken);
      if (cur) {
        results.push({ ...base, action: cur.sha256 === want ? "already-copied" : "kept-private", private_sha256: cur.sha256 });
        return;
      }
      await writePrivate(o.pathname, plan.bytes, o.contentType, privateToken);
      const back = await readPrivate(o.pathname, privateToken);
      if (!back || back.sha256 !== want) throw new Error("read-back hash mismatch");
      results.push({ ...base, action: plan.action === "sanitized" ? "sanitized" : "copied", private_sha256: back.sha256 });
    } catch (e) {
      problems.push({ pathname: o.pathname, error: String(e.message || e).slice(0, 120) });
    }
  });
  for (const d of daily) {
    const pathname = `${cfg.dailyPrefix}${d.day}.json`;
    try {
      const bytes = Buffer.from(JSON.stringify(d));
      const cur = await readPrivate(pathname, privateToken);
      if (!cur) await writePrivate(pathname, bytes, "application/json", privateToken);
      else if (cur.sha256 !== sha(bytes)) await writePrivate(pathname, bytes, "application/json", privateToken, { allowOverwrite: true });
      const back = await readPrivate(pathname, privateToken);
      if (back?.sha256 !== sha(bytes)) throw new Error("read-back hash mismatch");
      results.push({ pathname, source_sha256: null, source_size: 0, action: "daily-total", private_sha256: back.sha256 });
    } catch (e) {
      problems.push({ pathname, error: String(e.message || e).slice(0, 120) });
    }
  }
  results.sort((a, b) => (a.pathname < b.pathname ? -1 : 1));
  if (problems.length) {
    log(`INCOMPLETE: ${problems.length} object(s) failed (first: ${problems.slice(0, 3).map((p) => `${p.pathname} ${p.error}`).join("; ")}). Re-run to resume; no manifest written.`);
    return { ok: false, refused: "incomplete", problems, results };
  }
  const manifestHash = sealTo(manifest, MANIFEST_FORMAT, { site, store: cfg.store, archive_payload_sha256: arch.payload_sha256, entries: results }, keyHex, { site, count: results.length });
  const byAction = {};
  for (const r of results) byAction[r.action] = (byAction[r.action] || 0) + 1;
  log(`done: ${JSON.stringify(byAction)}; manifest sha256 ${manifestHash}`);
  return { ok: true, summary, byAction, manifestHash, archiveHash: arch.payload_sha256, results };
}

// ── Delete from the previous store (separate, approved step) ────────────────
export function approvalSentence(store, n, manifestHash) {
  return `Delete the ${n} public objects in manifest ${manifestHash.slice(0, 12)} from the ${store} store`;
}
export async function deletePublic({ manifest, archive, keyHex = process.env.ARCHIVE_KEY, scope = "fixed-address", apply = false, approval = "",
  sourceToken = process.env.SOURCE_BLOB_TOKEN || undefined, privateToken = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN, log = console.log } = {}) {
  const m = openSealed(manifest, MANIFEST_FORMAT, keyHex);
  const a = openSealed(archive, ARCHIVE_FORMAT, keyHex);
  if (m.payload.archive_payload_sha256 !== a.doc.payload_sha256) throw new Error("manifest and archive do not belong together");
  const cfg = SITES[m.payload.site];
  const archived = new Map(a.payload.entries.map((e) => [e.pathname, e.sha256]));
  const copiedish = new Set(["copied", "sanitized", "already-copied", "kept-private", "log-sanitized", "log-sanitized-private"]);
  const candidates = m.payload.entries.filter((e) => e.source_sha256 && copiedish.has(e.action) && (scope === "all" || !e.pathname.startsWith(cfg.eventsPrefix)));
  // Every candidate: archived with the same hash, present in the private store now, unchanged in the old store.
  const live = new Map((await inventory({ site: m.payload.site, sourceToken })).map((b) => [b.pathname, b]));
  const blockers = [];
  const targets = [];
  for (const e of candidates) {
    if (archived.get(e.pathname) !== e.source_sha256) { blockers.push(`${e.pathname}: not in the archive with the same hash`); continue; }
    if (!(await readPrivate(e.pathname, privateToken))) { blockers.push(`${e.pathname}: no private copy`); continue; }
    const b = live.get(e.pathname);
    if (!b) continue; // already gone
    const now = await readPublic(b);
    if (sha(now.bytes) !== e.source_sha256) { blockers.push(`${e.pathname}: changed in the old store since the copy`); continue; }
    targets.push(b);
  }
  const hash = m.doc.payload_sha256;
  const sentence = approvalSentence(m.payload.store, targets.length, hash);
  log(`${targets.length} object(s) to delete (${scope}); ${blockers.length} blocker(s)`);
  for (const x of blockers.slice(0, 10)) log(`  blocker: ${x}`);
  if (blockers.length) return { ok: false, refused: "blockers", blockers, sentence };
  if (!apply) { log(`dry run. The approval sentence is:\n  ${sentence}`); return { ok: true, dryRun: true, count: targets.length, sentence, pathnames: targets.map((b) => b.pathname) }; }
  if (approval.trim() !== sentence) throw new Error("approval sentence does not match; nothing deleted");
  for (let i = 0; i < targets.length; i += 100) {
    await retry(() => del(targets.slice(i, i + 100).map((b) => b.url), sourceToken ? { token: sourceToken } : {}));
  }
  const still = [];
  for (const b of targets) {
    const r = await fetch(`${b.url}?ts=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    if (r && r.status !== 404) still.push(`${b.pathname} ${r.status}`);
  }
  log(`deleted ${targets.length}; ${still.length} still answering (edge caches can lag; re-check later)`);
  return { ok: true, deleted: targets.length, still, sentence };
}

export function parseArgs(argv) {
  const o = { site: "engine", apply: false, deletePublic: false, scope: "fixed-address" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null || v.startsWith("--")) throw new Error(`${a} needs a value`); return v; };
    if (a === "--apply") o.apply = true;
    else if (a === "--delete-public") o.deletePublic = true;
    else if (a === "--site") o.site = val();
    else if (a === "--archive") o.archive = val();
    else if (a === "--manifest") o.manifest = val();
    else if (a === "--scope") o.scope = val();
    else if (a === "--approval") o.approval = val();
    else if (a === "--retention-days") o.retentionDays = Number(val());
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const o = parseArgs(process.argv.slice(2));
  const p = o.deletePublic ? deletePublic(o) : run(o);
  p.then((r) => process.exit(r.ok ? 0 : 1)).catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(2); });
}
