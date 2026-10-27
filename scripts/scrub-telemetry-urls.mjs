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
// Usage (needs BLOB_READ_WRITE_TOKEN — source .env.local):
//   node scripts/scrub-telemetry-urls.mjs                    # dry run (default): counts only, prints no values
//   node scripts/scrub-telemetry-urls.mjs --since 2026-07-18 # limit the event-file walk
//   node scripts/scrub-telemetry-urls.mjs --apply            # write the scrubbed records (curator decision)
// Tests: scripts/test-receipt-hygiene.mjs [H9].

import { list, put } from "@vercel/blob";
import { sanitizePath, sanitizeReferer } from "../api/_telemetry.js";

const LOG_KEY = "telemetry/access-log.json";
const EVENTS_PREFIX = "telemetry/events/";

// Pure: returns {changed, event, reasons}. reasons name what was found, never the value.
export function scrubEvent(ev) {
  if (!ev || typeof ev !== "object") return { changed: false, event: ev, reasons: [] };
  const out = { ...ev };
  const reasons = [];
  if (ev.path != null) {
    const p = sanitizePath(ev.path);
    if (p !== ev.path) {
      out.path = p;
      if (/[?&]receipt=/.test(String(ev.path))) reasons.push("receipt");
      if (/[?&](job|session_id|token)=/.test(String(ev.path))) reasons.push("capability-id");
      if (!reasons.length) reasons.push("query-value");
    }
  }
  if (ev.referer != null) {
    const r = sanitizeReferer(ev.referer);
    if (r !== ev.referer) { out.referer = r; reasons.push("referer"); }
  }
  return { changed: reasons.length > 0, event: out, reasons };
}

async function fetchJson(url) {
  const r = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return r.json();
}

const writeOpts = { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" };

export async function run({ apply = false, since = null, concurrency = 50, log = console.log } = {}) {
  const tally = { events_seen: 0, events_changed: 0, by_reason: {}, aggregate_recent_changed: 0, aggregate_first_changed: false, errors: 0, applied: apply };
  const bump = (rs) => { for (const r of rs) tally.by_reason[r] = (tally.by_reason[r] || 0) + 1; };

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
        const { changed, event, reasons } = scrubEvent(ev);
        if (!changed) return;
        tally.events_changed++;
        bump(reasons);
        if (apply) await put(b.pathname, JSON.stringify(event), writeOpts);
      } catch {
        tally.errors++;
      }
    }));
  }

  const { blobs } = await list({ prefix: LOG_KEY });
  const agg = blobs.find((b) => b.pathname === LOG_KEY);
  if (agg) {
    const data = await fetchJson(agg.url);
    let dirty = false;
    data.recent = (data.recent || []).map((ev) => {
      const s = scrubEvent(ev);
      if (s.changed) { tally.aggregate_recent_changed++; dirty = true; }
      return s.event;
    });
    if (data.firstExternal) {
      const s = scrubEvent(data.firstExternal);
      if (s.changed) { data.firstExternal = s.event; tally.aggregate_first_changed = true; dirty = true; }
    }
    if (dirty && apply) await put(LOG_KEY, JSON.stringify(data), writeOpts);
  }
  log(JSON.stringify(tally, null, 2));
  if (!apply && (tally.events_changed || tally.aggregate_recent_changed)) log("Dry run: nothing written. Re-run with --apply to scrub.");
  return tally;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sinceAt = args.indexOf("--since");
  if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("BLOB_READ_WRITE_TOKEN is required (source .env.local)."); process.exit(2); }
  await run({ apply: args.includes("--apply"), since: sinceAt >= 0 ? args[sinceAt + 1] : null });
}
