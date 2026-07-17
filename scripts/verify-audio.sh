#!/usr/bin/env bash
# verify-audio.sh — post-deploy verification for the self-hosted audio corpus.
#
# Fixes a real bug in the original handoff's verify.sh: section 2 piped the
# manifest into `while read`, which runs in a subshell — any PASS/FAIL
# increments inside it are discarded, so ALL 16 tracks could 404 and the
# script would still print PASS/FAIL counts of 0 and exit 🟢 SHIP. Process
# substitution (`< <(...)`) below keeps the loop in the current shell so
# failures actually reach the gate.
#
# Usage: bash scripts/verify-audio.sh https://omnarai.vercel.app
set -u
BASE="${1:?Usage: bash scripts/verify-audio.sh <base_url>}"
PASS=0; FAIL=0

check() { # label, condition-result (0=ok)
  if [ "$2" -eq 0 ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1"; FAIL=$((FAIL+1)); fi
}

echo "== 1. Manifest =="
MANIFEST=$(curl -sf "$BASE/audio/manifest.json"); check "manifest.json reachable" $?
COUNT=$(echo "$MANIFEST" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['tracks']))" 2>/dev/null)
[ "$COUNT" = "16" ]; check "manifest declares 16 tracks (got: ${COUNT:-none})" $?

echo "== 2. Track availability =="
TRACK_FAIL=0
while read -r f; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -I "$BASE/audio/$f")
  if [ "$CODE" = "200" ]; then echo "  ✅ $f"; else echo "  ❌ $f (HTTP $CODE)"; TRACK_FAIL=$((TRACK_FAIL+1)); fi
done < <(echo "$MANIFEST" | python3 -c "import json,sys; [print(t['file']) for t in json.load(sys.stdin)['tracks']]" 2>/dev/null)
[ "$TRACK_FAIL" -eq 0 ]; check "all tracks return 200 (0 failures)" $?

echo "== 3. Content-type spot check =="
CT=$(curl -sI "$BASE/audio/07-out-of-omniversal-empyrical-times.m4a" | grep -i '^content-type' | tr -d '\r')
echo "$CT" | grep -qiE 'audio|mp4|octet-stream'; check "content-type audio-compatible ($CT)" $?

echo "== 4. Range request (seek support) =="
RCODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=0-1023" "$BASE/audio/07-out-of-omniversal-empyrical-times.m4a")
[ "$RCODE" = "206" ]; check "byte-range honored (HTTP $RCODE, want 206)" $?

echo "== 5. Slug/URL hygiene =="
echo "$MANIFEST" | python3 -c "
import json,sys,re
m=json.load(sys.stdin)
bad=[t['file'] for t in m['tracks'] if not re.fullmatch(r'[a-z0-9\-]+\.m4a', t['file'])]
sys.exit(1 if bad else 0)
" 2>/dev/null; check "all filenames URL-safe" $?

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "🟢 SHIP" || echo "🔴 HOLD — resolve failures before closing handoff"
[ "$FAIL" -eq 0 ]
