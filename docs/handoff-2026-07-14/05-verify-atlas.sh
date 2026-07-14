#!/usr/bin/env bash
# verify-atlas.sh — Atlas ship verification (V1–V8 from 02-ATLAS-SHIP.md §6)
# Extends the repo's existing verify.sh pattern. Exit nonzero on any failure.
# CLAUDE CODE: wire STORE_COUNT_CMD and API_BASE to repo reality before running.

set -uo pipefail
FAIL=0
ATLAS_DIR="atlas"
JSONL="$ATLAS_DIR/atlas-v1.0.0.jsonl"
CARD="$ATLAS_DIR/README.md"
API_BASE="${API_BASE:-https://omnarai.vercel.app}"
STORE_COUNT_CMD="${STORE_COUNT_CMD:-echo REPLACE_ME}"   # command printing canonical store count

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=1; }

echo "== V1: count coherence (D2 proof) =="
jsonl_count=$(wc -l < "$JSONL" 2>/dev/null || echo -1)
card_count=$(grep -oP 'Records:\*?\*?\s*\K[0-9]+' "$CARD" 2>/dev/null | head -1 || echo -2)
store_count=$($STORE_COUNT_CMD 2>/dev/null || echo -3)
excluded=$(grep -vc '^#' "$ATLAS_DIR/excluded.log" 2>/dev/null || echo 0)
if [[ "$jsonl_count" == "$card_count" && $((jsonl_count + excluded)) == "$store_count" ]]; then
  pass "jsonl=$jsonl_count card=$card_count store=$store_count excluded=$excluded"
else
  fail "jsonl=$jsonl_count card=$card_count store=$store_count excluded=$excluded"
fi

echo "== V2: schema validation, zero silent drops =="
python3 - "$JSONL" <<'PY' && pass "all lines validate" || fail "validation failures"
import json, sys, jsonschema
schema = json.load(open("divergence-delta.schema.json"))
bad = 0
for i, line in enumerate(open(sys.argv[1], encoding="utf-8"), 1):
    try: jsonschema.validate(json.loads(line), schema)
    except Exception as e: bad += 1; print(f"line {i}: {str(e)[:120]}")
sys.exit(1 if bad else 0)
PY

echo "== V3: round-trip byte fidelity, 5% sample =="
# CLAUDE CODE: compare sampled exported answer text byte-for-byte against store.
echo "  ⏭  implement against canonical store accessor"

echo "== V4: /api/divergences?id= honors its parameter (D1 proof) =="
# Uses a known-live record id; returned payload must contain ONLY that id.
TEST_ID="${TEST_ID:-OMN-D1780752434684}"
resp=$(curl -sf "$API_BASE/api/divergences?id=$TEST_ID" || echo "")
if [[ -n "$resp" ]] && echo "$resp" | grep -q "$TEST_ID"; then
  other_ids=$(echo "$resp" | grep -oP 'OMN-[LD][0-9]{13}' | grep -v "$TEST_ID" | sort -u | wc -l)
  [[ "$other_ids" == "0" ]] && pass "returns only $TEST_ID" || fail "returned $other_ids other record ids (param still ignored)"
else
  fail "no/invalid response for id=$TEST_ID"
fi

echo "== V5: retrieval bleed (D3 proof) =="
# Conceptual query battery must return zero Media/Oral tier hits.
# CLAUDE CODE: reuse the audit battery file; loop queries against retrieval endpoint,
# grep tier field, fail on any media/oral hit for conceptual-class queries.
echo "  ⏭  wire audit battery"

echo "== V6: omnarai_trace latency (D4 proof) =="
# CLAUDE CODE: run trace across battery; fail if any call exceeds timeout threshold.
echo "  ⏭  wire trace timing"

echo "== V7: PII sweep clean =="
if [[ ! -s "$ATLAS_DIR/review-needed.log" ]] || grep -q '^# none' "$ATLAS_DIR/review-needed.log"; then
  pass "review-needed.log empty"
else
  fail "PII review outstanding"
fi

echo "== V8: no personal names in staged files =="
# CLAUDE CODE: source denylist from repo config (never hardcode names here);
# grep -ri across $ATLAS_DIR; fail on any hit.
echo "  ⏭  wire denylist sweep"

echo
[[ $FAIL == 0 ]] && echo "ATLAS VERIFY: PASS (implemented checks)" || { echo "ATLAS VERIFY: FAIL"; exit 1; }
