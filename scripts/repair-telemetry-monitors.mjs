#!/usr/bin/env node
// One-shot repair: reclassify already-logged uptime/liveness-monitor traffic
// into the `monitor` category added to api/_telemetry.js on 2026-07-19.
//
// Why a patch and not a rebuild: the per-event blobs (telemetry/events/) only
// start 2026-07-18 (v2 storage). Everything before that exists ONLY in the
// aggregate log. Rebuilding the aggregate from event files would silently erase
// the June record — including the pinned firstExternalAt milestone. So this
// walks the aggregate and moves counts between categories in place.
//
// It is deliberately CONSERVATIVE: it only ever reclassifies an event whose
// stored user-agent matches MONITOR_RE. It never invents, drops, or re-times an
// event, and `totals.logged` is unchanged — a monitor is still a stranger that
// called us, it just isn't reach.
//
// Sources of truth for the per-day monitor counts, in order:
//   1. telemetry/events/<day>/*.json — ground truth, exists for days ≥ 2026-07-18
//   2. the aggregate's own recent[] — has UAs, covers the last 1000 events
// A day with neither cannot be repaired (no UA survives) and is reported as
// UNKNOWN rather than guessed at.
//
// Usage:
//   node scripts/repair-telemetry-monitors.mjs           # dry run (default)
//   node scripts/repair-telemetry-monitors.mjs --apply   # write the repaired log
// Requires BLOB_READ_WRITE_TOKEN (source .env.local).

import { list, put } from "@vercel/blob";

const LOG_KEY = "telemetry/access-log.json";
const EVENTS_PREFIX = "telemetry/events/";
const APPLY = process.argv.includes("--apply");

// Keep in sync with MONITOR_RE in api/_telemetry.js.
const MONITOR_RE =
  /sentineloracle|uptimerobot|uptime-kuma|pingdom|statuscake|betteruptime|betterstack|checkly|site24x7|hetrixtools|freshping|cron-job\.org|datadog|newrelic|healthchecks\.io|statusca[kt]e|monitoring|uptime/i;

const isMonitor = (ua) => !!ua && MONITOR_RE.test(ua);

async function fetchJson(url) {
  const r = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  return r.ok ? r.json() : null;
}

async function loadAggregate() {
  const { blobs } = await list({ prefix: LOG_KEY });
  if (!blobs.length) throw new Error("no aggregate log found");
  const data = await fetchJson(blobs[0].url);
  if (!data) throw new Error("aggregate log unreadable");
  return data;
}

const main = async () => {
  const data = await loadAggregate();

  // Per-day: how many monitor events, and which category they are sitting in.
  // { day -> { fromCategory -> count } }
  const moves = {};
  const unrepairable = [];

  for (const day of Object.keys(data.days || {})) {
    // SOURCE MUST BE recent[], NOT the event files. The two stores have
    // different denominators by design: the aggregate is a read-modify-write
    // blob with no CAS, so concurrent bursts drop each other's updates, while
    // the per-event blobs cannot lose anything. On 2026-07-19 the event files
    // held 465 monitor events for a day the aggregate had counted 202 events
    // total. Moving event-file counts into aggregate counters produced negative
    // signal — an incoherent log. We are repairing the AGGREGATE's category
    // labels, so the counts must come from the aggregate's own record.
    const fromRecent = (data.recent || []).filter((e) => e.at?.slice(0, 10) === day);
    // recent[] only covers a day fully if it holds every event for that day.
    if (fromRecent.length < (data.days[day].total || 0)) {
      if ((data.days[day].total || 0) > 0) {
        unrepairable.push({ day, total: data.days[day].total, inRecent: fromRecent.length });
      }
      continue;
    }
    for (const e of fromRecent) {
      if (!isMonitor(e.ua)) continue;
      if (e.category === "monitor") continue; // already repaired
      moves[day] = moves[day] || {};
      moves[day][e.category] = (moves[day][e.category] || 0) + 1;
    }
  }

  // Apply the moves to per-day and all-time category counts.
  let totalMoved = 0;
  const allTimeFrom = {};
  const appliedByDay = {};   // post-clamp — what the log actually got
  const clampedByDay = {};   // how much the clamp refused, per day
  for (const [day, from] of Object.entries(moves)) {
    const d = data.days[day];
    for (const [cat, rawN] of Object.entries(from)) {
      // Never move more than the aggregate actually holds under that category —
      // a clamp is the difference between a repair and a corruption.
      const n = Math.min(rawN, d.byCategory[cat] || 0, data.byCategory[cat] || 0);
      clampedByDay[day] = (clampedByDay[day] || 0) + Math.max(0, rawN - n);
      if (n <= 0) continue;
      appliedByDay[day] = (appliedByDay[day] || 0) + n;
      d.byCategory[cat] = Math.max(0, (d.byCategory[cat] || 0) - n);
      if (d.byCategory[cat] === 0) delete d.byCategory[cat];
      d.byCategory.monitor = (d.byCategory.monitor || 0) + n;
      data.byCategory[cat] = Math.max(0, (data.byCategory[cat] || 0) - n);
      if (data.byCategory[cat] === 0) delete data.byCategory[cat];
      data.byCategory.monitor = (data.byCategory.monitor || 0) + n;
      allTimeFrom[cat] = (allTimeFrom[cat] || 0) + n;
      totalMoved += n;
    }
  }

  // Keep recent[] consistent so the verbatim tail agrees with the counts.
  let recentRelabelled = 0;
  for (const e of data.recent || []) {
    if (isMonitor(e.ua) && e.category !== "monitor") {
      e.category = "monitor";
      recentRelabelled += 1;
    }
  }

  // Report.
  console.log(`\n  ${APPLY ? "APPLYING" : "DRY RUN"} — monitor reclassification\n`);
  console.log(`  events reclassified : ${totalMoved}`);
  console.log(`  recent[] relabelled : ${recentRelabelled}`);
  console.log(`  moved out of        : ${Object.entries(allTimeFrom).map(([c, n]) => `${c} (${n})`).join(", ") || "—"}`);
  console.log(`  totals.logged       : ${data.totals?.logged} (UNCHANGED by design)`);
  console.log(`  monitor category    : ${data.byCategory.monitor || 0}`);
  console.log(
    `  signal (logged−mon) : ${Math.max(0, (data.totals?.logged || 0) - (data.byCategory.monitor || 0))}`
  );
  console.log(`  firstExternalAt     : ${data.firstExternalAt} (untouched)`);
  if (Object.keys(moves).length) {
    console.log("\n  per day:");
    for (const day of Object.keys(moves).sort()) {
      const d = data.days[day];
      const clamped = clampedByDay[day] || 0;
      console.log(
        `    ${day}  monitor ${appliedByDay[day] || 0} / ${d.total} total → signal ${d.total - (d.byCategory.monitor || 0)}` +
          (clamped ? `   [clamp refused ${clamped} — recent[] holds more events than the day rollup counted]` : "")
      );
    }
  }
  if (unrepairable.length) {
    console.log("\n  UNREPAIRABLE (no stored UA for these days — left exactly as-is):");
    for (const u of unrepairable) {
      console.log(`    ${u.day}  ${u.total} event(s), only ${u.inRecent} still in recent[]`);
    }
  }

  if (!APPLY) {
    console.log("\n  No write performed. Re-run with --apply to persist.\n");
    return;
  }
  await put(LOG_KEY, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  console.log("\n  ✓ aggregate log written\n");
};

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
