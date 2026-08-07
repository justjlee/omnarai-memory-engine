#!/usr/bin/env bash
# verify-adiff.sh — acceptance checks for the architecture-differential finding
# (HANDOFF-ADIFF-2026-08 §4). Standalone by design: some checks depend on a deploy
# (live page, live retrieval) or on API keys (the paid repro run), so folding them
# into the promote gate verify-omnarai.sh would wrongly red-fail every clean deploy.
# Local, deploy-independent checks PASS/FAIL here; deploy- or key-dependent ones report
# PENDING / MANUAL rather than FAIL. Wire the PASS/FAIL subset into verify-omnarai.sh
# once the page + record are live.
#
# Usage:
#   bash scripts/verify-adiff.sh                  # local checks + probe live if reachable
#   HOME_BASE=https://omnarai.org ENGINE_BASE=https://engine.omnarai.org bash scripts/verify-adiff.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
HOME_BASE="${HOME_BASE:-https://omnarai.org}"
ENGINE_BASE="${ENGINE_BASE:-https://engine.omnarai.org}"
HOME_SITE="${HOME_SITE:-../omnarai-home}"   # local omnarai.org static site (flagship page + landing)

c_green='\033[0;32m'; c_red='\033[0;31m'; c_yel='\033[0;33m'; c_dim='\033[2m'; c_off='\033[0m'
PASS=0; FAIL=0; PEND=0
ok(){   printf "${c_green}PASS${c_off}    %s\n" "$1"; PASS=$((PASS+1)); }
no(){   printf "${c_red}FAIL${c_off}    %s\n" "$1"; FAIL=$((FAIL+1)); }
pend(){ printf "${c_yel}PENDING${c_off} %s\n" "$1"; PEND=$((PEND+1)); }
info(){ printf "${c_dim}····    %s${c_off}\n" "$1"; }

STATS="public/data/adiff-stats.json"
PAGE="$HOME_SITE/findings/architecture-differential.html"

echo "== verify-adiff =="

# ── 0. single source is consistent with the primary eval aggregate ─────────────────────────
if node scripts/build-adiff-stats.mjs --check >/dev/null 2>&1; then
  ok "adiff-stats.json + HF card consistent with the primary aggregate (build-adiff-stats --check)"
else
  no "adiff-stats.json / HF card DRIFTED from the primary aggregate — run: node scripts/build-adiff-stats.mjs"
fi

# ── 1. flagship page: stats byte-identical to the source-of-truth file ─────────────────────
if [ -f "$PAGE" ] && [ -f "$STATS" ]; then
  missing=$(python3 - "$STATS" "$PAGE" <<'PY'
import json,sys,re
stats=json.load(open(sys.argv[1])); html=open(sys.argv[2],encoding="utf-8").read()
bad=[]
for c in stats["consumers"]:
    if f'{c["T"]}–{c["P"]}' not in html and f'{c["T"]}-{c["P"]}' not in html:
        bad.append(f'{c["model"]} {c["T"]}-{c["P"]}')
print(";".join(bad))
PY
)
  if [ -z "$missing" ]; then ok "flagship page baked stats match every T-P in $STATS"
  else no "flagship page stats DRIFT from source: $missing"; fi
else
  no "flagship page or stats file missing ($PAGE / $STATS)"
fi
# live variant (only if the page is deployed)
if curl -fsS --max-time 12 "$HOME_BASE/findings/architecture-differential" >/tmp/adiff_live.html 2>/dev/null; then
  live_bad=$(python3 - "$STATS" /tmp/adiff_live.html <<'PY'
import json,sys
stats=json.load(open(sys.argv[1])); html=open(sys.argv[2],encoding="utf-8").read()
print(";".join(f'{c["model"]} {c["T"]}-{c["P"]}' for c in stats["consumers"]
      if f'{c["T"]}–{c["P"]}' not in html and f'{c["T"]}-{c["P"]}' not in html))
PY
)
  if [ -z "$live_bad" ]; then ok "LIVE $HOME_BASE/findings/architecture-differential serves matching stats"
  else no "LIVE page stats drift: $live_bad"; fi
else
  pend "flagship page not live yet at $HOME_BASE/findings/architecture-differential (deploy omnarai.org)"
fi

# ── 2. limitations.md: original text intact + pointer added (append-only) ───────────────────
LIM="public/limitations.md"
if grep -q "measurably \*degraded\* Claude's revisions" "$LIM"; then ok "limitations.md original degradation text intact"
else no "limitations.md original degradation text MISSING (append-only violated)"; fi
if grep -q "/findings/architecture-differential" "$LIM"; then ok "limitations.md pointer to the flagship page present"
else no "limitations.md pointer to /findings/architecture-differential MISSING"; fi

# ── 3. repro script: runnable + minimal-honest + <10min ≥1 pair ─────────────────────────────
REPRO="repro/adiff-repro.sh"
if [ -f "$REPRO" ] && bash -n "$REPRO" 2>/dev/null; then ok "repro script present and parses ($REPRO)"
else no "repro script missing or has a syntax error ($REPRO)"; fi
if [ -x "$REPRO" ]; then ok "repro script is executable"; else info "repro not +x (bash $REPRO still works)"; fi
# key-guard must refuse a keyless run cleanly (proves it won't silently no-op)
if ( env -i PATH="$PATH" bash "$REPRO" ) >/dev/null 2>&1; then
  no "repro did not refuse a keyless run (key-guard broken)"
else
  ok "repro key-guard refuses a run without the required provider keys"
fi
pend "TIMED real run (<10 min, >=1 model pair) is MANUAL — needs >=4 provider keys: bash $REPRO"

# ── 4. new corpus record: authored + ingestable + (post-deploy) retrievable top-3 ───────────
REC="analysis/adiff-corpus-record.json"
if [ -f "$REC" ]; then
  layer=$(python3 - "$REC" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
def layerOf(r):
    if r["type"]=="divergence": return "divergence"
    ev=r.get("evidence_status","uncharacterized")
    if r["ring"]=="media" or ev=="fictional": return "realms"
    if r["ring"]=="core": return "canon"
    return "research"
ok = r.get("evidence_status")=="empirical" and layerOf(r)=="research" and r.get("id") and r.get("full_text")
print(("OK " if ok else "BAD ")+r.get("id","?")+" layer="+layerOf(r)+" ev="+str(r.get("evidence_status")))
PY
)
  case "$layer" in
    OK*) ok "corpus record valid ($layer)";;
    *)   no "corpus record malformed ($layer)";;
  esac
else
  no "corpus record $REC missing"
fi
# live retrieval top-3 for "Atlas exposure degrades Claude" (needs the record ingested+embedded)
RECID=$(python3 -c "import json;print(json.load(open('$REC'))['id'])" 2>/dev/null || echo OMN-R-ADIFF)
Q="Atlas%20exposure%20degrades%20Claude"
if grep -q "\"$RECID\"" public/data/corpus.json 2>/dev/null; then INGESTED=1; else INGESTED=0; fi
if [ "$INGESTED" = 0 ]; then
  pend "record $RECID not ingested into corpus.json yet — ingest + embed + deploy (see analysis/adiff-corpus-ingest.md)"
elif curl -fsS --max-time 15 "$ENGINE_BASE/api/query?q=$Q&format=context" >/tmp/adiff_ret.json 2>/dev/null; then
  top3=$(python3 - /tmp/adiff_ret.json "$RECID" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); rid=sys.argv[2]
ids=[r.get("id") for r in (d.get("records") or [])][:3] or (d.get("sources") or [])[:3]
print("HIT" if rid in ids else "MISS "+",".join(map(str,ids)))
PY
)
  if [ "${top3%% *}" = "HIT" ]; then ok "record $RECID retrievable top-3 for 'Atlas exposure degrades Claude'"
  else no "record $RECID NOT top-3 (got: ${top3#MISS }) — re-check ingest/embedding"; fi
else
  pend "record $RECID not retrievable yet — ingest + embed + deploy first (see analysis/adiff-corpus-ingest.md)"
fi

# ── 5. task-type JSON present; cells report n + noise floor ─────────────────────────────────
TT="analysis/adiff-tasktype-2026-08.json"
if [ -f "$TT" ]; then
  res=$(python3 - "$TT" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
cells=d.get("cells_2x2",{})
good = bool(cells) and all(("base_n" in c and "replicate_noise_sd" in c and "decided" in c) for c in cells.values())
print("OK" if good else "BAD")
PY
)
  if [ "$res" = OK ]; then ok "adiff-tasktype JSON present; every 2x2 cell reports n + noise floor"
  else no "adiff-tasktype JSON missing per-cell n or noise floor"; fi
else
  no "adiff-tasktype JSON $TT missing"
fi

echo
printf "== %d passed, %d failed, %d pending (deploy/keys) ==\n" "$PASS" "$FAIL" "$PEND"
[ "$FAIL" -eq 0 ]
