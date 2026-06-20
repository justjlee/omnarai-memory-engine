#!/usr/bin/env node
// "Which visits are me, and which are real strangers?"
//
// The telemetry log stores a salted hash of each caller's IP, never the raw IP:
//   ipHash = sha256(INGEST_SECRET + ip).slice(0,12)   (see api/_telemetry.js)
// This script hashes YOUR CURRENT public IP the same way and labels the traffic
// report accordingly — so your own un-self-marked pokes (manual curl, the published
// MCP, etc.) are separated from genuine outside visitors. Non-destructive: it only
// READS the report and computes locally. Nothing is erased or written.
//
// Because it re-derives your hash from your current IP on every run, it adapts when
// your IP changes. Caveat: it can only recognise the IP(s) you are on RIGHT NOW (plus
// any you pass as args) — past events from a different IP of yours won't be flagged.
//
// Usage:
//   node scripts/traffic-mine.mjs                      # label by this machine's IP
//   node scripts/traffic-mine.mjs 1.2.3.4 5.6.7.8      # also treat these IPs as you
//   node scripts/traffic-mine.mjs hash:0bfc9112ec1d    # also treat this hash as you
import { createHash } from "crypto";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const INGEST = (envText.match(/^INGEST_SECRET=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!INGEST) { console.error("No INGEST_SECRET in .env.local"); process.exit(1); }
const BASE = process.env.OMNARAI_BASE || "https://omnarai.vercel.app";
const hashIp = (ip) => createHash("sha256").update(INGEST + ip).digest("hex").slice(0, 12);

// Build the set of "my" hashes: current public IP + any IPs/hashes passed as args.
const mine = new Set();
const myIps = [];
try {
  const ip = (await (await fetch("https://ifconfig.me/ip")).text()).trim();
  if (ip) { mine.add(hashIp(ip)); myIps.push(ip); }
} catch { /* offline — rely on args */ }
for (const a of process.argv.slice(2)) {
  if (a.startsWith("hash:")) mine.add(a.slice(5));
  else { mine.add(hashIp(a)); myIps.push(a); }
}

const rep = await (await fetch(`${BASE}/api/info?_view=traffic`, {
  headers: { Authorization: `Bearer ${INGEST}` },
})).json();
const events = rep.recent || [];

const isMine = (e) => e.ipHash && mine.has(e.ipHash);
const ext = events.filter((e) => !isMine(e));
const me = events.filter(isMine);

const tally = (list, key) => list.reduce((a, e) => { const k = e[key] || "?"; a[k] = (a[k] || 0) + 1; return a; }, {});

console.log(`\n  you (this machine): ${myIps.join(", ") || "(unknown)"}  ->  ${[...mine].join(", ")}`);
console.log(`  ${rep.milestone || ""}`);
console.log(`\n  YOUR OWN calls   : ${me.length}`);
console.log(`  REAL EXTERNAL    : ${ext.length}   <-- the number that matters`);
console.log(`  external by category : ${JSON.stringify(tally(ext, "category"))}`);
console.log(`  external by endpoint : ${JSON.stringify(tally(ext, "endpoint"))}`);

// Per distinct external visitor
const byIp = {};
for (const e of ext) (byIp[e.ipHash || "no-ip"] = byIp[e.ipHash || "no-ip"] || []).push(e);
console.log(`\n  distinct external sources: ${Object.keys(byIp).length}`);
for (const [ip, evs] of Object.entries(byIp).sort((a, b) => b[1].length - a[1].length)) {
  const cats = [...new Set(evs.map((e) => e.category))].join(",");
  const eps = [...new Set(evs.map((e) => e.endpoint))].join(",");
  const ctys = [...new Set(evs.map((e) => e.country).filter(Boolean))].join(",");
  const ua = (evs.find((e) => e.ua)?.ua || "").slice(0, 40);
  console.log(`    ${ip}: ${evs.length} call(s) | ${ctys || "??"} | ${cats} | ${eps} | "${ua}"`);
}
console.log("");
