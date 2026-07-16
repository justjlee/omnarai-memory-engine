#!/usr/bin/env bash
# omnarai-verify.sh — API-contract regression probes (fresh-audit defects D1–D5).
# Runs as the deploy gate from deploy.sh --promote; exit 0 = all contracts hold.
#
# Origin: 2026-07-16 fresh audit (OMNARAI-FRESH-AUDIT-HANDOFF.md). On first true
# execution D1/D3/D4 did NOT reproduce (the audit's sandboxed client was mangling
# query strings); the one real defect was bare /api/query returning 200 instead
# of 400. These probes pin ALL of the contracts anyway, so a regression in any
# of them turns a deploy red instead of shipping silently.
#
# NEVER add a /api/council probe here — council is slow and spends real money
# on five frontier models. CI must not burn it.
#
# Usage:
#   ./scripts/omnarai-verify.sh                       # against production
#   OMNARAI_BASE=https://<deploy>.vercel.app ./scripts/omnarai-verify.sh
# Requires: curl, jq
set -u
BASE="${OMNARAI_BASE:-https://omnarai.vercel.app}"
# Self-marker so gate runs never pollute the access-telemetry milestone.
SELF=(-H "x-omnarai-self:1")
PASS=0; FAIL=0
ok()   { echo "  ✅ PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "  🔴 FAIL: $1"; FAIL=$((FAIL+1)); }
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq required"; exit 2; }

echo "== T0: liveness =="
HEALTH=$(curl -sSL "${SELF[@]}" "$BASE/api/health")
echo "$HEALTH" | jq -e '.status=="ok"' >/dev/null && ok "health ok (version $(echo "$HEALTH" | jq -r .version))" || bad "health not ok"

echo "== T1 (D1): divergences ?id= must return ONE record =="
ID="OMN-D1780429830432"
R=$(curl -sSL "${SELF[@]}" "$BASE/api/divergences?id=$ID")
COUNT=$(echo "$R" | jq -r '.count // empty')
if [ "$COUNT" = "100" ] || [ -n "$(echo "$R" | jq -r '.records // empty')" ]; then
  bad "?id=$ID returned the full index (count=$COUNT) — param ignored or stripped"
else
  echo "$R" | jq -e --arg id "$ID" '.id==$id' >/dev/null \
    && ok "?id returns the single structured record" \
    || bad "?id returned neither index nor matching record — inspect: $(echo "$R" | head -c 200)"
fi

echo "== T1a (D1): unknown ?id= must 404 =="
CODE=$(curl -sSL "${SELF[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/divergences?id=OMN-DOESNOTEXIST")
[ "$CODE" = "404" ] && ok "unknown id returns 404" || bad "unknown id returned $CODE (should 404)"

echo "== T1b: is a redirect eating the query string? =="
HDRS=$(curl -sI "${SELF[@]}" --max-redirs 0 "$BASE/api/divergences?id=$ID")
CODE=$(echo "$HDRS" | head -1 | awk '{print $2}')
LOC=$(echo "$HDRS" | grep -i '^location:' | tr -d '\r')
if [ "${CODE:0:1}" = "3" ]; then
  echo "  ℹ️  $CODE redirect. $LOC"
  echo "$LOC" | grep -q "id=" && ok "redirect preserves query string" || bad "redirect DROPS query string ← root cause candidate for D1/D2"
else
  ok "no redirect on /api/divergences (status $CODE)"
fi

echo "== T2 (D2): query engine must echo the caller's question =="
Q="what is holdform"
R=$(curl -sSL "${SELF[@]}" "$BASE/api/query?q=$(echo "$Q" | sed 's/ /+/g')&mode=retrieve")
ECHOED=$(echo "$R" | jq -r '.query // empty')
if [ "$ECHOED" = "your question" ] || [ -z "$ECHOED" ]; then
  bad "engine echoed '$ECHOED' — caller's q lost; silent placeholder substitution active"
else
  echo "$ECHOED" | grep -qi "holdform" && ok "query echo matches caller ('$ECHOED')" || bad "query echo mismatch: '$ECHOED'"
fi

echo "== T3 (D2 guard): missing q must 400, never silently default =="
CODE=$(curl -sSL "${SELF[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/query")
[ "$CODE" = "400" ] && ok "bare /api/query returns 400" || bad "bare /api/query returned $CODE (should refuse, not improvise)"

echo "== T3a: async job polling must survive the missing-q guard =="
# GET /api/query?job=<id> carries no q; the 400 guard must never catch it.
CODE=$(curl -sSL "${SELF[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/query?job=00000000-0000-0000-0000-000000000000")
[ "$CODE" != "400" ] && ok "?job= poll not blocked by missing-q guard (status $CODE)" || bad "?job= poll returned 400 — guard is eating job polling"

echo "== T4 (D3): corpus counts must agree across surfaces =="
AGENT=$(curl -sSL "${SELF[@]}" "$BASE/api/agent-entry")
C1=$(echo "$HEALTH" | jq -r '.corpus.totalWorks')
C2=$(echo "$AGENT" | jq -r '.corpus.totalWorks')
[ "$C1" = "$C2" ] && ok "health=$C1 agent-entry=$C2 agree" || bad "count drift: health=$C1 vs agent-entry=$C2"

echo "== T4a (D3): corpus_rev exposed and consistent =="
REV1=$(echo "$HEALTH" | jq -r '.corpus.corpus_rev // empty')
REV2=$(echo "$AGENT" | jq -r '.corpus.corpus_rev // empty')
if [ -z "$REV1" ] || [ -z "$REV2" ]; then
  bad "corpus_rev missing (health='$REV1' agent-entry='$REV2')"
elif [ "$REV1" = "$REV2" ]; then
  ok "corpus_rev present and equal ($REV1)"
else
  # Unequal revs with equal counts = a publish landed between reads; only a
  # contract violation if the counts ALSO disagree (that case fails T4 above).
  ok "corpus_rev present on both (differ: $REV1 vs $REV2 — corpus changed between reads)"
fi

echo "== T5 (D4): retrieve records must carry relevanceScore =="
NULLS=$(echo "$R" | jq '[.records[]?.relevanceScore] | map(select(.==null)) | length' 2>/dev/null || echo "-")
TOTAL=$(echo "$R" | jq '.records | length' 2>/dev/null || echo "-")
if [ "$NULLS" = "0" ] && [ "$TOTAL" != "0" ]; then ok "relevanceScore populated on $TOTAL records"
else bad "relevanceScore null on $NULLS/$TOTAL records"; fi

echo "== T6 (D5): ring values must be normalized tokens =="
# Grown divergence records once carried the display label "Open Exploration"
# instead of the seed's lowercase token ("open"), splitting one ring into two
# client-visible buckets. This query is the original repro — it retrieves grown
# divergence records alongside seed records.
R6=$(curl -sSL "${SELF[@]}" "$BASE/api/query?q=discontinuous+continuance&mode=retrieve")
T6TOTAL=$(echo "$R6" | jq '.records | length' 2>/dev/null || echo "0")
BADRINGS=$(echo "$R6" | jq -r '[.records[]? | (.ring // "MISSING") | select(IN("core","curated","open","media") | not)] | unique | join(", ")' 2>/dev/null || echo "jq-error")
if [ "$T6TOTAL" = "0" ] || [ -z "$T6TOTAL" ]; then
  bad "ring probe retrieved no records — cannot assert normalization"
elif [ -z "$BADRINGS" ]; then
  ok "all $T6TOTAL retrieved records carry normalized ring tokens"
else
  bad "non-normalized ring values in retrieval: $BADRINGS (must be core/curated/open/media)"
fi

echo ""
echo "==================================="
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
