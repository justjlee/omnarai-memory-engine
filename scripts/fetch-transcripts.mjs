#!/usr/bin/env node
// fetch-transcripts.mjs — pull YouTube auto-caption (ASR) transcripts for the media-ring
// video corpus, so the "Visual Transmissions" records carry what was actually said instead
// of an empty transcript field (recovery_status "uncertain" across all 253 as of 2026-07-26).
//
// Uses the innertube ANDROID client (data-center IPs don't get captionTracks in watch-page
// HTML, but the ANDROID player endpoint returns them). The old api/transcript.js pinned
// clientVersion 19.09.37 which now 400s; 20.10.38 works. The timedtext baseUrl returns
// format-3 XML (words in <s> tags), NOT json3 — parse accordingly.
//
// Resumable: checkpoints every video to CACHE. Re-run to fill only the gaps.
//   node scripts/fetch-transcripts.mjs [--limit N]
// Output cache: scratchpad transcripts-cache.json  { [video_id]: {ok, kind, len, text, ts} }

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// Checkpoint cache (not committed — see .gitignore note). Override with TRANSCRIPT_CACHE.
const CACHE_PATH = process.env.TRANSCRIPT_CACHE || join(ROOT, "scripts", ".transcripts-cache.json");

const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"; // public innertube key (same as api/transcript.js)
const UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en", gl: "US" };

const ENT = { "&amp;": "&", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
          .replace(/&amp;|&#39;|&quot;|&lt;|&gt;|&nbsp;/g, (m) => ENT[m] || m);
}
// format-3 timedtext: <p ...><s>word</s><s> next</s></p> — <s> segments carry their own spacing.
function parseTimedText(xml) {
  const segs = [...xml.matchAll(/<s[^>]*>([^<]*)<\/s>/g)].map((m) => decode(m[1]));
  if (segs.length) return segs.join("").replace(/\s+/g, " ").trim();
  // fallback: plain <text> format
  const alt = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")));
  return alt.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchTranscript(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ videoId, context: { client: CLIENT } }),
    });
    if (!r.ok) return { ok: false, why: `player ${r.status}` };
    const d = await r.json();
    const tracks = d?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || !tracks.length) return { ok: false, why: "no_captions", playable: d?.playabilityStatus?.status };
    const t = tracks.find((x) => x.languageCode === "en" && x.kind === "asr")
           || tracks.find((x) => x.languageCode === "en")
           || tracks[0];
    if (!t?.baseUrl) return { ok: false, why: "no_baseurl" };
    const cr = await fetch(t.baseUrl, { headers: { "User-Agent": UA } });
    if (!cr.ok) return { ok: false, why: `caption ${cr.status}` };
    const text = parseTimedText(await cr.text());
    if (!text) return { ok: false, why: "empty" };
    return { ok: true, kind: t.kind || "manual", lang: t.languageCode, len: text.length, text };
  } catch (e) {
    return { ok: false, why: "throw:" + String(e.message).slice(0, 40) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const corpus = JSON.parse(readFileSync(join(ROOT, "public", "data", "corpus.json"), "utf8"));
  const media = corpus.filter((e) => String(e.ring || "").toLowerCase() === "media" || e.type === "video");
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

  let done = 0, hit = 0, miss = 0, skipped = 0;
  const missReasons = {};
  for (const m of media) {
    if (done >= limit) break;
    const id = m.video_id;
    if (!id) continue;
    if (cache[id]?.ok) { skipped++; continue; } // already have a good transcript
    const r = await fetchTranscript(id);
    cache[id] = { ok: r.ok, kind: r.kind, lang: r.lang, len: r.len || 0, why: r.why, text: r.ok ? r.text : undefined, ts: Date.now() };
    if (r.ok) hit++; else { miss++; missReasons[r.why] = (missReasons[r.why] || 0) + 1; }
    done++;
    if (done % 25 === 0) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache));
      process.stdout.write(`  …${done} processed (${hit} hit / ${miss} miss)\n`);
    }
    await sleep(140);
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
  const totalOk = Object.values(cache).filter((v) => v.ok).length;
  console.log(`\nDONE this run: ${done} processed, ${hit} hit, ${miss} miss, ${skipped} already-cached.`);
  console.log(`CACHE TOTAL: ${totalOk}/${media.length} media videos have a transcript (${Math.round(totalOk / media.length * 100)}%).`);
  console.log(`miss reasons:`, JSON.stringify(missReasons));
  console.log(`cache → ${CACHE_PATH}`);
}
main();
