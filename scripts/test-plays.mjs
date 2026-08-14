#!/usr/bin/env node
// Unit tests for the pure parts of api/_plays.js: slug validation, beacon
// normalisation, the key encode/decode round-trip, and the leaderboard
// aggregator. No network, no Blob — mock req objects only.
import {
  isKnownableSlug,
  normalizePlay,
  playKey,
  parsePlayKey,
  summarizePlays,
  PLAY_EVENTS,
} from "../api/_plays.js";

let pass = 0,
  fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    console.log("  ✗", name, "\n      got :", JSON.stringify(got), "\n      want:", JSON.stringify(want));
  }
}
const req = (headers = {}) => ({ method: "POST", headers });

// ── isKnownableSlug ──────────────────────────────────────────────────────────
t("known slug passes", isKnownableSlug("01-one-knight-at-sls"), true);
t("unknown but manifest-shaped passes", isKnownableSlug("99-a-brand-new-track"), true);
t("uppercase rejected", isKnownableSlug("01-One-Knight"), false);
t("spaces rejected", isKnownableSlug("01 one knight"), false);
t("no leading number rejected", isKnownableSlug("one-knight"), false);
t("path traversal rejected", isKnownableSlug("../../etc/passwd"), false);
t("double-underscore rejected (field separator)", isKnownableSlug("01-a__b"), false);
t("over-length rejected", isKnownableSlug("1-" + "x".repeat(90)), false);
t("non-string rejected", isKnownableSlug(42), false);

// ── normalizePlay ────────────────────────────────────────────────────────────
const okReq = req({ "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0" });
const { rec: r1 } = normalizePlay({ slug: "02-whales-in-the-oceans", event: "start", source: "static" }, okReq, new Date("2026-08-10T12:00:00.000Z"));
t("valid start normalises", { slug: r1.slug, event: r1.event, source: r1.source, hasHash: typeof r1.ipHash === "string" }, {
  slug: "02-whales-in-the-oceans",
  event: "start",
  source: "static",
  hasHash: true,
});
t("bad event rejected", normalizePlay({ slug: "02-whales-in-the-oceans", event: "skip" }, okReq).error, "bad or missing event");
t("bad slug rejected", normalizePlay({ slug: "DROP TABLE", event: "start" }, okReq).error, "bad or missing slug");
t("missing body rejected", normalizePlay(null, okReq).error, "bad or missing slug");
t("ms clamped out when absurd", normalizePlay({ slug: "02-whales-in-the-oceans", event: "start", ms: 999999999999 }, okReq).rec.ms, undefined);
t("ms kept when sane", normalizePlay({ slug: "02-whales-in-the-oceans", event: "qualified", ms: 30000 }, okReq).rec.ms, 30000);
t("no IP → no-ip hash", normalizePlay({ slug: "02-whales-in-the-oceans", event: "start" }, req({})).rec.ipHash, "no-ip");
// Same IP hashes stably; different IPs differ.
const hA = normalizePlay({ slug: "03-in-a-submarine", event: "start" }, req({ "x-forwarded-for": "203.0.113.7" })).rec.ipHash;
const hB = normalizePlay({ slug: "03-in-a-submarine", event: "start" }, req({ "x-forwarded-for": "203.0.113.8" })).rec.ipHash;
t("same IP → stable hash", hA, normalizePlay({ slug: "03-in-a-submarine", event: "complete" }, req({ "x-forwarded-for": "203.0.113.7" })).rec.ipHash);
t("different IP → different hash", hA === hB, false);

// ── playKey / parsePlayKey round-trip ────────────────────────────────────────
const key = playKey(r1);
const parsed = parsePlayKey(key);
t("key round-trips slug/event/ipHash/day", { slug: parsed.slug, event: parsed.event, ipHash: parsed.ipHash, day: parsed.day }, {
  slug: "02-whales-in-the-oceans",
  event: "start",
  ipHash: r1.ipHash,
  day: "2026-08-10",
});
t("stray key rejected", parsePlayKey("plays/events/2026-08-10/garbage.json"), null);
t("all events survive round-trip", PLAY_EVENTS.map((e) => parsePlayKey(playKey({ slug: "17-are-you-ready", event: e, ipHash: "abc123def456", at: "2026-08-10T01:02:03.000Z" })).event), PLAY_EVENTS);

// ── summarizePlays ───────────────────────────────────────────────────────────
const recs = [
  { slug: "02-whales-in-the-oceans", event: "start", ipHash: "aaa", day: "2026-08-10" },
  { slug: "02-whales-in-the-oceans", event: "start", ipHash: "bbb", day: "2026-08-10" },
  { slug: "02-whales-in-the-oceans", event: "qualified", ipHash: "aaa", day: "2026-08-10" },
  { slug: "02-whales-in-the-oceans", event: "complete", ipHash: "aaa", day: "2026-08-10" },
  { slug: "17-are-you-ready", event: "start", ipHash: "aaa", day: "2026-08-11" },
  // A no-ip event must NOT inflate distinct listeners.
  { slug: "17-are-you-ready", event: "start", ipHash: "no-ip", day: "2026-08-11" },
];
const s = summarizePlays(recs);
t("totals: plays counts every start (incl. no-ip)", s.totals.plays, 4);
t("totals: qualified", s.totals.qualified, 1);
t("totals: completes", s.totals.completes, 1);
t("totals: distinct listeners ignores no-ip", s.totals.distinct_listeners, 2); // aaa, bbb
t("leaderboard sorted, whales first", s.tracks[0].slug, "02-whales-in-the-oceans");
t("whales: 2 plays, 2 listeners", { plays: s.tracks[0].plays, listeners: s.tracks[0].listeners }, { plays: 2, listeners: 2 });
t("whales: completion rate", s.tracks[0].completion_rate, 0.5);
t("are-you-ready: 1 real listener (no-ip excluded)", s.tracks[1].listeners, 1);
t("title resolved from manifest", s.tracks[0].title, "Whales in The Oceans");
t("per-day rollup present", Object.keys(s.days), ["2026-08-10", "2026-08-11"]);
t("empty input → empty leaderboard", summarizePlays([]).tracks, []);

// ── autostart: counted, but never inside a willful metric ────────────────────
// The whole point of a separate event is that turning autoplay on cannot move
// `plays`, `listeners`, or `completion_rate`. These pin that.
const autoRecs = [
  { slug: "02-whales-in-the-oceans", event: "start", ipHash: "aaa", day: "2026-08-12" },
  { slug: "02-whales-in-the-oceans", event: "autostart", ipHash: "zzz", day: "2026-08-12" },
  { slug: "02-whales-in-the-oceans", event: "autostart", ipHash: "yyy", day: "2026-08-12" },
];
const a = summarizePlays(autoRecs);
t("autostart does not inflate plays", a.tracks[0].plays, 1);
t("autostart is reported on its own field", a.tracks[0].autoplays, 2);
t("autostart does not create listeners", a.tracks[0].listeners, 1); // aaa only
t("autostart does not skew completion rate", a.tracks[0].completion_rate, 0);
t("totals carry autoplays separately", { plays: a.totals.plays, autoplays: a.totals.autoplays }, { plays: 1, autoplays: 2 });
t("per-day rollup counts autostarts", a.days["2026-08-12"].autostarts, 2);
t("autostart alone still yields a track row", summarizePlays([{ slug: "17-are-you-ready", event: "autostart", ipHash: "q", day: "2026-08-12" }]).tracks[0].autoplays, 1);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
