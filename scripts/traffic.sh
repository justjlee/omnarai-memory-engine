#!/usr/bin/env bash
# Read (or reset) the access-telemetry milestone report.
#
# This is the one-command answer to "has an AI/agent called the engine that we
# didn't cause yet?" — the honest milestone. It reads the curator-gated report
# at /api/info?_view=traffic (see api/_telemetry.js). Reading the report does NOT
# itself get logged (the report branch returns before the telemetry hook).
#
# Usage:
#   ./scripts/traffic.sh                    # show the report (+ per-day rollup)
#   ./scripts/traffic.sh --day 2026-07-18   # loss-proof per-event record for a day
#   ./scripts/traffic.sh --day today        # same, for today
#   FORCE_RESET=1 ./scripts/traffic.sh --reset   # wipe the log (DANGER: see below)
#
# Requires .env.local with INGEST_SECRET (+ BLOB_READ_WRITE_TOKEN for --reset).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.local 2>/dev/null || { echo "ERROR: .env.local not found"; exit 1; }; set +a
BASE="${OMNARAI_BASE:-https://omnarai.vercel.app}"

if [[ "${1:-}" == "--reset" ]]; then
  # The milestone fired 2026-06-16 (first real external visitor) and firstExternalAt
  # is PINNED — wiping the log would destroy it. Reset only exists for catastrophic
  # corruption, and only with FORCE_RESET=1.
  if [[ "${FORCE_RESET:-}" != "1" ]]; then
    echo "REFUSED: the milestone log is pinned (firstExternalAt 2026-06-16)."
    echo "A reset would erase it permanently. If you truly mean it: FORCE_RESET=1 $0 --reset"
    exit 1
  fi
  echo ">> FORCE-resetting telemetry aggregate log (per-event files under telemetry/events/ are kept)…"
  node -e "import('@vercel/blob').then(async ({list,del})=>{const {blobs}=await list({prefix:'telemetry/access-log.json'});if(!blobs.length){console.log('   already pristine');return}for(const b of blobs){await del(b.url);console.log('   deleted',b.pathname)}})"
  exit 0
fi

if [[ "${1:-}" == "--day" ]]; then
  DAY="${2:-today}"
  curl -s -H "x-omnarai-self:1" -H "Authorization: Bearer $INGEST_SECRET" "$BASE/api/info?_view=traffic&day=$DAY" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let j;try{j=JSON.parse(d)}catch{console.error('Bad response (auth? URL?):',d.slice(0,120));process.exit(1)}
console.log('');
console.log('  '+j.day+' — '+(j.count||0)+' event(s)'+(j.truncated?' (TRUNCATED at 1000)':''));
for(const e of j.events||[]){
  const bits=[e.at.slice(11,19),e.category,e.endpoint,(e.tool||e.rpc||''),(e.country||''),(e.city||'')].filter(Boolean).join(' · ');
  console.log('   '+bits);
  if(e.q)console.log('       q: '+e.q.slice(0,110));
  if(e.identity)console.log('       identity: '+e.identity);
  if(e.ua)console.log('       ua: '+e.ua.slice(0,90));
}
console.log('');})"
  exit 0
fi

curl -s -H "x-omnarai-self:1" -H "Authorization: Bearer $INGEST_SECRET" "$BASE/api/info?_view=traffic" \
| node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let j;try{j=JSON.parse(d)}catch{console.error('Bad response (auth? URL?):',d.slice(0,120));process.exit(1)}
console.log('');
console.log('  '+(j.milestone||'(no milestone field)'));
console.log('');
console.log('  total stranger calls :',j.totals?.logged||0);
console.log('  by category          :',JSON.stringify(j.byCategory||{}));
console.log('  by endpoint          :',JSON.stringify(j.byEndpoint||{}));
if(j.byCountry&&Object.keys(j.byCountry).length)console.log('  by country           :',JSON.stringify(j.byCountry));
if(j.days&&Object.keys(j.days).length){console.log('');console.log('  per-day rollup (permanent):');
for(const day of Object.keys(j.days).sort().slice(-14)){const dd=j.days[day];console.log('   ',day,'·',String(dd.total).padStart(4),'events ·',Object.keys(dd.visitors||{}).length+(dd.visitorsTruncated?'+':''),'visitors ·',JSON.stringify(dd.byCategory))}}
if(j.recent?.length){console.log('');console.log('  most recent:');for(const e of j.recent.slice(0,10)){console.log('   ',e.at,'·',e.category,'·',e.endpoint,'·',(e.tool||e.rpc||(e.q?('q:'+e.q.slice(0,30)):''))||'','·',(e.ua||'').slice(0,40),e.country?('· '+e.country):'')}}
console.log('');})"
