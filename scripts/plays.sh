#!/usr/bin/env bash
# Read the song-play leaderboard — "how many times has each track been played?"
#
# Both players (the static bar on omnarai.org and the engine's React player)
# beacon to /api/play; this reads the aggregate back (see api/_plays.js). The
# public leaderboard needs no auth; the per-day forensic dump is gated on
# INGEST_SECRET.
#
# Usage:
#   ./scripts/plays.sh                 # all-time leaderboard
#   ./scripts/plays.sh --days 30       # last 30 days only
#   ./scripts/plays.sh --day today     # per-event dump for a day (needs INGEST_SECRET)
#   ./scripts/plays.sh --day 2026-08-10
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${OMNARAI_BASE:-https://engine.omnarai.org}"

if [[ "${1:-}" == "--day" ]]; then
  set -a; source .env.local 2>/dev/null || { echo "ERROR: .env.local not found (needed for --day)"; exit 1; }; set +a
  DAY="${2:-today}"
  [[ "$DAY" == "today" ]] && DAY="$(date -u +%F)"
  curl -s -H "Authorization: Bearer $INGEST_SECRET" "$BASE/api/play?raw=1&day=$DAY" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let j;try{j=JSON.parse(d)}catch{console.error('Bad response (auth? URL?):',d.slice(0,120));process.exit(1)}
console.log('');console.log('  '+j.day+' — '+(j.total||0)+' event(s), showing '+(j.returned||0));
for(const e of j.events||[]){console.log('   '+e.at.slice(11,19)+' · '+e.event.padEnd(9)+' · '+e.slug+' · '+(e.source||''))}
console.log('');})"
  exit 0
fi

DAYS=""
if [[ "${1:-}" == "--days" ]]; then DAYS="?days=${2:-30}"; fi

curl -s "$BASE/api/play$DAYS" \
| node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let j;try{j=JSON.parse(d)}catch{console.error('Bad response:',d.slice(0,120));process.exit(1)}
const t=j.totals||{};
console.log('');
console.log('  window               :',j.window_days);
console.log('  total plays          :',t.plays||0,' (qualified '+(t.qualified||0)+' · completes '+(t.completes||0)+')');
console.log('  distinct listeners   :',t.distinct_listeners||0);
console.log('  tracks played        :',t.tracks_played||0);
console.log('');
console.log('  leaderboard (by plays):');
for(const tr of (j.tracks||[])){
  console.log('   '+String(tr.plays).padStart(5)+' plays · '+String(tr.qualified).padStart(4)+' qual · '+String(tr.listeners).padStart(4)+' lstnr · '+Math.round((tr.completion_rate||0)*100)+'% done · '+tr.title);
}
if(!(j.tracks||[]).length)console.log('   (no plays recorded yet)');
console.log('');})"
