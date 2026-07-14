#!/usr/bin/env bash
# verify-atlas.sh — Atlas ship verification, V1–V8 per handoff 02-ATLAS-SHIP.md §6
# (docs/handoff-2026-07-14/). All eight checks fully wired to repo reality:
#   store  = scripts/.grown-snapshot.json (dump-grown.mjs snapshot of the canonical blob)
#   export = atlas/data/atlas-v1.0.0.jsonl (scripts/export_atlas.py)
#   live   = https://omnarai.vercel.app (curled with the x-omnarai-self telemetry marker)
# Exit nonzero on any failure. V5/V6 exercise LIVE retrieval/trace and can fail for
# live-side reasons independent of the export — that distinction matters when reading results.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

ATLAS_DIR="atlas"
JSONL="$ATLAS_DIR/data/atlas-v1.0.0.jsonl"
CARD="$ATLAS_DIR/README.md"
API_BASE="${API_BASE:-https://omnarai.vercel.app}"
SELF_HEADER="x-omnarai-self: 1"
FAIL=0

pass() { echo "  PASS $1"; }
fail() { echo "  FAIL $1"; FAIL=1; }

echo "== V1: count coherence (D2 proof) =="
jsonl_count=$(wc -l < "$JSONL" 2>/dev/null | tr -d ' ' || echo -1)
card_count=$(grep -oE 'Records:\*\* [0-9]+' "$CARD" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo -2)
store_count=$(python3 -c "
import json
g=json.load(open('scripts/.grown-snapshot.json'))
print(sum(1 for e in g['entries'] if e.get('type')=='divergence' and e.get('divergence')))")
excluded=$(grep -cv '^# none' "$ATLAS_DIR/excluded.log" 2>/dev/null || echo 0)
[[ "$(grep -c '^# none' "$ATLAS_DIR/excluded.log" 2>/dev/null)" == "1" ]] && excluded=0
if [[ "$jsonl_count" == "$card_count" && $((jsonl_count + excluded)) == "$store_count" ]]; then
  pass "jsonl=$jsonl_count card=$card_count store=$store_count excluded=$excluded"
else
  fail "jsonl=$jsonl_count card=$card_count store=$store_count excluded=$excluded"
fi

echo "== V2: schema validation, zero silent drops =="
python3 - "$JSONL" <<'PY' && pass "all lines validate against divergence-delta.schema.json" || fail "validation failures"
import json, sys, jsonschema
schema = json.load(open("atlas/divergence-delta.schema.json"))
bad = 0
for i, line in enumerate(open(sys.argv[1], encoding="utf-8"), 1):
    try: jsonschema.validate(json.loads(line), schema)
    except Exception as e: bad += 1; print(f"  line {i}: {str(e)[:120]}")
sys.exit(1 if bad else 0)
PY

echo "== V3: round-trip byte fidelity, 5%+ sample =="
python3 <<'PY' && pass "sampled answer text byte-identical to store" || fail "byte-fidelity mismatch"
import json, random
store = {e["id"]: e for e in json.load(open("scripts/.grown-snapshot.json"))["entries"]
         if e.get("type") == "divergence" and e.get("divergence")}
recs = [json.loads(l) for l in open("atlas/data/atlas-v1.0.0.jsonl")]
random.seed(20260714)  # deterministic sample so failures are re-runnable
sample = random.sample(recs, max(6, len(recs) // 20))
bad = 0
for r in sample:
    s = store[r["id"]]["divergence"]
    if r["question"] != s["question"]: bad += 1; print(f"  {r['id']}: question differs")
    exp = [a["text"] for a in r["answers"]]
    got = [a.get("text") for a in s.get("answers", [])]
    if exp != got: bad += 1; print(f"  {r['id']}: answer text differs")
print(f"  sampled {len(sample)} records")
raise SystemExit(1 if bad else 0)
PY

echo "== V4: /api/divergences?id= honors its parameter (D1 proof) =="
TEST_ID="${TEST_ID:-OMN-D1780752434684}"
resp=$(curl -sf -m 30 -H "$SELF_HEADER" "$API_BASE/api/divergences?id=$TEST_ID" || echo "")
if [[ -n "$resp" ]] && echo "$resp" | grep -q "$TEST_ID"; then
  other_ids=$(echo "$resp" | grep -oE 'OMN-[LD][0-9]{13}' | grep -v "$TEST_ID" | sort -u | wc -l | tr -d ' ')
  [[ "$other_ids" == "0" ]] && pass "returns only $TEST_ID" || fail "returned $other_ids other record ids (param ignored?)"
else
  fail "no/invalid response for id=$TEST_ID"
fi

echo "== V5: retrieval bleed — conceptual battery, zero Media/Oral hits (D3 proof) =="
python3 <<'PY' && pass "no media-tier records retrieved for conceptual queries" || fail "media-tier bleed detected"
import json, urllib.request, urllib.parse
gold = json.load(open("scripts/eval-gold-set.json"))
queries = [g["query"] for g in gold if g.get("type") == "conceptual"]
bad = 0
for q in queries:
    url = ("https://omnarai.vercel.app/api/query?format=context&q="
           + urllib.parse.quote(q))
    req = urllib.request.Request(url, headers={"x-omnarai-self": "1"})
    d = json.load(urllib.request.urlopen(req, timeout=45))
    hits = [r["id"] for r in d.get("records", []) if "media" in (r.get("ring") or "").lower()]
    status = "bleed: " + ",".join(hits) if hits else "clean"
    print(f"  [{status}] {q[:60]}")
    bad += len(hits)
raise SystemExit(1 if bad else 0)
PY

echo "== V6: trace completes end-to-end under threshold (D4 proof) =="
# /api/trace is async by design (bare GET returns a job ticket in <1s; the measured
# baseline-vs-augmented deliberation runs ~50s server-side). "No timeout" therefore
# means: the job COMPLETES with a measured receipt within the end-to-end threshold —
# not that the ticket comes back fast. Submit, poll, time the whole thing.
python3 <<'PY' && pass "trace jobs completed with measured receipts under 180s" || fail "trace timeout/error"
import json, time, urllib.request, urllib.parse
BASE = "https://omnarai.vercel.app"
def get(url):
    req = urllib.request.Request(url, headers={"x-omnarai-self": "1"})
    return json.load(urllib.request.urlopen(req, timeout=60))
gold = json.load(open("scripts/eval-gold-set.json"))
queries = [g["query"] for g in gold if g.get("type") in ("conceptual", "bridge")][:2]
bad = 0
for q in queries:
    t0 = time.time()
    try:
        d = get(BASE + "/api/trace?q=" + urllib.parse.quote(q))
        poll = d.get("poll_url")  # only the initial ticket carries it
        while d.get("status") in ("pending", "running") and time.time() - t0 < 180:
            time.sleep(4)
            d = get(BASE + poll if poll.startswith("/") else poll)
        dt = time.time() - t0
        result = d.get("result", d)
        measured = (result.get("receipt") or {}).get("measured")
        ok = d.get("status", "done") == "done" and not result.get("error") and measured is True
        print(f"  [{'ok' if ok else 'FAIL'} {dt:.0f}s, receipt.measured={measured}] {q[:55]}")
        bad += 0 if ok else 1
    except Exception as e:
        print(f"  [FAIL {time.time()-t0:.0f}s] {q[:55]} — {e}")
        bad += 1
raise SystemExit(1 if bad else 0)
PY

echo "== V7: PII sweep clean =="
if grep -q '^# none' "$ATLAS_DIR/review-needed.log" 2>/dev/null; then
  pass "review-needed.log empty (sweep ran in export_atlas.py: emails, phones, name denylist)"
else
  fail "PII review outstanding — see $ATLAS_DIR/review-needed.log"
fi

echo "== V8: no personal names in staged files =="
# Denylist sourced from an UNSTAGED local file (scripts/.pii-denylist.local,
# *.local is gitignored) — names are never hardcoded into a staged file.
if [[ ! -f scripts/.pii-denylist.local ]]; then
  fail "scripts/.pii-denylist.local missing — cannot sweep"
else
  hits=0
  while IFS= read -r name; do
    [[ -z "$name" || "$name" == \#* ]] && continue
    if grep -ril "$name" "$ATLAS_DIR" >/dev/null 2>&1; then
      echo "  hit: '$name' found in staged files:"; grep -ril "$name" "$ATLAS_DIR" | sed 's/^/    /'
      hits=$((hits+1))
    fi
  done < scripts/.pii-denylist.local
  [[ "$hits" == "0" ]] && pass "denylist sweep clean across $ATLAS_DIR/" || fail "$hits denylist name(s) present"
fi

echo
[[ $FAIL == 0 ]] && echo "ATLAS VERIFY: PASS (V1–V8)" || { echo "ATLAS VERIFY: FAIL"; exit 1; }
