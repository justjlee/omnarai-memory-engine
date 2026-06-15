#!/usr/bin/env bash
# Read (or reset) the access-telemetry milestone report.
#
# This is the one-command answer to "has an AI/agent called the engine that we
# didn't cause yet?" — the honest milestone. It reads the curator-gated report
# at /api/info?_view=traffic (see api/_telemetry.js). Reading the report does NOT
# itself get logged (the report branch returns before the telemetry hook).
#
# Usage:
#   ./scripts/traffic.sh            # show the report
#   ./scripts/traffic.sh --reset    # wipe the log clean (e.g. after a test run)
#
# Requires .env.local with INGEST_SECRET (+ BLOB_READ_WRITE_TOKEN for --reset).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.local 2>/dev/null || { echo "ERROR: .env.local not found"; exit 1; }; set +a
BASE="${OMNARAI_BASE:-https://omnarai.vercel.app}"

if [[ "${1:-}" == "--reset" ]]; then
  echo ">> Resetting telemetry log (so firstExternal stays pristine)…"
  node -e "import('@vercel/blob').then(async ({list,del})=>{const {blobs}=await list({prefix:'telemetry/access-log.json'});if(!blobs.length){console.log('   already pristine');return}for(const b of blobs){await del(b.url);console.log('   deleted',b.pathname)}})"
  exit 0
fi

curl -s -H "Authorization: Bearer $INGEST_SECRET" "$BASE/api/info?_view=traffic" \
| node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let j;try{j=JSON.parse(d)}catch{console.error('Bad response (auth? URL?):',d.slice(0,120));process.exit(1)}
console.log('');
console.log('  '+(j.milestone||'(no milestone field)'));
console.log('');
console.log('  total stranger calls :',j.totals?.logged||0);
console.log('  by category          :',JSON.stringify(j.byCategory||{}));
console.log('  by endpoint          :',JSON.stringify(j.byEndpoint||{}));
if(j.recent?.length){console.log('');console.log('  most recent:');for(const e of j.recent.slice(0,10)){console.log('   ',e.at,'·',e.category,'·',e.endpoint,'·',(e.ua||'').slice(0,48),e.country?('· '+e.country):'')}}
console.log('');})"
