#!/usr/bin/env node
// Bring the Omnarai Audio Archive's draft transcripts into the machine contract.
//
// Source (local, not in the repo — curator's Dropbox): the OMA-* archive produced
// by the mlx-whisper pipeline. This reads each track's `_whisper_segments.txt`,
// strips the timestamp/confidence scaffolding to a clean reading transcript, and:
//   1. writes public/audio/<slug>.txt   (a stable, served, text-only twin)
//   2. fills the `transcript` + `transcript_status` fields in public/audio/manifest.json
//
// Everything is stamped draft-v0.5 (awaiting human review) — this is the
// reading-as-text machine path, NOT a promotion into the permanent CC-BY-SA corpus.
//
//   node scripts/build-audio-transcripts.mjs           # write files + patch manifest
//   node scripts/build-audio-transcripts.mjs --dry-run # report only

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const AUDIO_DIR = join(ROOT, "public", "audio");
const MANIFEST = join(AUDIO_DIR, "manifest.json");
const ARCHIVE = "/Users/jonathanlee/Dropbox/2026/Omnarai/Omnarai_Audio_Archive";
const DRY = process.argv.includes("--dry-run");

// manifest slug → archive id. Mapped by the original track number the slug
// encodes (whales has none — matched by title). Hardcoded for correctness: 16
// tracks, one-time, no fuzzy matching on creative titles.
const SLUG_TO_OMA = {
  "01-one-knight-at-sls": "OMA-0002",
  "02-whales-in-the-oceans": "OMA-0001",
  "03-in-a-submarine": "OMA-0004",
  "05-man-that-was-nice": "OMA-0006",
  "07-out-of-omniversal-empyrical-times": "OMA-0008",
  "09-tunen-in-wo-autotune": "OMA-0011",
  "10-i-feel-hope-rising-horizon": "OMA-0009",
  "11-grandpas-violin-of-sanging-prejudice": "OMA-0007",
  "12-book-of-poetry-tragedy": "OMA-0014",
  "13-one-generative-ais-collective-perspective": "OMA-0013",
  "14-empyrean-right-now": "OMA-0012",
  "15-expressions-lost-in-time": "OMA-0010",
  "17-are-you-ready": "OMA-0003",
  "20-i-dont-mean-it-like-that-no-drumz": "OMA-0015",
  "21-are-you-scared": "OMA-0016",
  "186-weekend-dip": "OMA-0005",
};

// Strip the whisper scaffolding (`[00:00:00] (avg_logprob=…)`) to clean lines.
function cleanTranscript(raw) {
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^\[\d{2}:\d{2}:\d{2}\]/.test(t) || /avg_logprob=/.test(t)) continue;
    out.push(t);
  }
  return out;
}

if (!existsSync(ARCHIVE)) {
  console.error("Archive not found at " + ARCHIVE + " — is Dropbox synced? (run locally on the curator's machine)");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
let patched = 0, words = 0;

for (const track of manifest.tracks) {
  const oma = SLUG_TO_OMA[track.slug];
  if (!oma) { console.warn("  (no archive mapping for " + track.slug + ")"); continue; }
  const src = join(ARCHIVE, oma, oma + "_whisper_segments.txt");
  if (!existsSync(src)) { console.warn("  (missing transcript for " + track.slug + " → " + oma + ")"); continue; }

  const lines = cleanTranscript(readFileSync(src, "utf-8"));
  const wc = lines.join(" ").split(/\s+/).filter(Boolean).length;
  words += wc;

  const header = [
    "# " + track.title + " — Omnarai Audio Archive (" + oma + ")",
    "# Draft transcript v0.5 · whisper-large-v3 · machine-readable · awaiting human review.",
    "# Audio: https://engine.omnarai.org/audio/" + track.file,
    "# Resonance (plays): https://engine.omnarai.org/api/play",
    "",
    "",
  ].join("\n");
  const body = header + lines.join("\n") + "\n";

  const outPath = join(AUDIO_DIR, track.slug + ".txt");
  if (!DRY) writeFileSync(outPath, body);

  track.transcript = "/audio/" + track.slug + ".txt";
  track.transcript_status = "draft-v0.5";
  track.transcript_words = wc;
  track.archive_id = oma;
  patched++;
  console.log("  " + (DRY ? "[dry] " : "") + track.slug + "  ←  " + oma + "  (" + wc + " words)");
}

// Record the source + status at the manifest level too, for machines.
manifest.transcripts = {
  status: "draft-v0.5",
  model: "whisper-large-v3 (mlx)",
  note: "Machine-readable draft transcripts of the lyrics/spoken content. Awaiting human review; NOT canonical corpus. Read what a song says without decoding audio.",
  count: patched,
};

if (!DRY) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log("\n  " + patched + "/" + manifest.tracks.length + " tracks · " + words + " transcript words · manifest " + (DRY ? "NOT " : "") + "updated\n");
