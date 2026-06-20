#!/usr/bin/env bash
# verify-omnarai.sh — acceptance-test harness for the remediation handoff.
#
# RECONCILED 2026-06-20 against the REAL async-job JSON shape. The original draft
# was written from MCP-formatted observation; every "# CONFIRM" assert has now
# been pinned to a real field. Key correction: the async job wraps the payload
# under `.result` — the old script grepped the envelope (which always ends `}` and
# carries `completedAt`), producing false greens. Asserts now read:
#   .result.answer                            prose synthesis
#   .result.truncated                         boolean truncation flag (P1)
#   .result.sources[]                         array of bare id strings
#   .result.records[]                         {id,type,ring,evidence,...}
#   .result.trace.retrievalScores[].relevanceScore   per-source cosine sim (P3)
#
# Usage:
#   ./verify-omnarai.sh                 # run all checks
#   ./verify-omnarai.sh --only p1       # one check (p1|p2|p3|p4|health)
#   TAU_ABS=0.42 ./verify-omnarai.sh    # tune the P3 absolute-relevance gate
#   BASE=https://staging.example ./verify-omnarai.sh
#
# DEPENDENCIES: curl, jq, python3 (url-encode). jq is REQUIRED now (the reconciled
# asserts read nested JSON; grep-on-one-line-JSON is what caused the false greens).

set -uo pipefail
BASE="${BASE:-https://omnarai.vercel.app}"
TAU_ABS="${TAU_ABS:-0.40}"          # P3 universal hard absolute-relevance floor (per-type in code: 0.40 diversity → 0.48 technical)
ONLY="all"; [ "${1:-}" = "--only" ] && ONLY="${2:-all}"
PASS=0; FAIL=0
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required"; exit 2; }

c_green='\033[0;32m'; c_red='\033[0;31m'; c_dim='\033[2m'; c_off='\033[0m'
ok(){   printf "${c_green}PASS${c_off}  %s\n" "$1"; PASS=$((PASS+1)); }
no(){   printf "${c_red}FAIL${c_off}  %s\n" "$1"; FAIL=$((FAIL+1)); }
info(){ printf "${c_dim}····  %s${c_off}\n" "$1"; }

urlenc(){ python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

# Self-marker header so harness runs don't pollute the access-telemetry milestone.
SELF=(-H "x-omnarai-self:1")

# Poll an async job; echo the FULL final job envelope (payload under .result).
# $1 = raw query, $2 = endpoint (query|trace)
run_async(){
  local q ep resp job st
  q="$(urlenc "$1")"; ep="${2:-query}"
  resp="$(curl -s "${SELF[@]}" "${BASE}/api/${ep}?q=${q}&async=1")"
  job="$(printf '%s' "$resp" | jq -r '.job_id // .job // empty')"
  if [ -z "$job" ]; then printf '%s' "$resp"; return; fi   # returned inline
  for _ in $(seq 1 45); do
    sleep 3
    resp="$(curl -s "${SELF[@]}" "${BASE}/api/query?job=${job}")"
    st="$(printf '%s' "$resp" | jq -r '.status // empty')"
    case "$st" in pending|running|queued|"") : ;; *) printf '%s' "$resp"; return;; esac
  done
  printf '%s' "$resp"
}

# Count substring occurrences (NOT lines — JSON is one line, which is why the old
# `grep -c` always returned 1).
count_occ(){ printf '%s' "$2" | grep -oiE "$1" | wc -l | tr -d ' '; }

# ---------------------------------------------------------------------------
check_health(){
  info "HEALTH — liveness + corpus counts"
  local r; r="$(curl -s "${SELF[@]}" "${BASE}/api/health")"
  [ "$(printf '%s' "$r" | jq -r '.status // empty')" = "ok" ] && ok "health: status ok" || no "health: status not ok"
  info "corpus.totalWorks = $(printf '%s' "$r" | jq -r '.corpus.totalWorks // "?"')"
}

# P1 — deliberation must not truncate mid-synthesis
check_p1(){
  info "P1 — truncation"
  local r res ans truncated tail
  r="$(run_async 'Ξ What actually makes a cross-model memory substrate valuable to an arriving AI agent, rather than merely interesting? Distinguish genuine epistemic uplift from novelty.' query)"
  res="$(printf '%s' "$r" | jq '.result // .')"
  truncated="$(printf '%s' "$res" | jq -r '.truncated // false')"
  ans="$(printf '%s' "$res" | jq -r '.answer // ""')"

  # 1) the engine's own truncation flag must be false
  if [ "$truncated" = "true" ]; then no "P1: .result.truncated == true (engine clipped its own output)"
  else ok "P1: .result.truncated == false"; fi

  # 2) no budget-cut salvage notice embedded in the prose
  if printf '%s' "$ans" | grep -qiE 'output budget|closing prose was cut off|reached its output|salvaged, possibly partial'; then
    no "P1: answer carries a budget-cut salvage notice"
  else ok "P1: no budget-cut notice in answer"; fi

  # 3) prose ends on a complete sentence (no dangling em-dash / open paren / partial citation)
  tail="$(printf '%s' "$ans" | sed -e 's/[[:space:]]*$//' | tail -c 60)"
  if printf '%s' "$ans" | sed -e 's/[[:space:]]*$//' | grep -qE '(—|–|\]\*|\(OMN-[A-Z0-9-]*|\([^)]*)$'; then
    no "P1: prose ends mid-sentence / on a salvage marker  [tail: …${tail}]"
  else ok "P1: prose ends cleanly      [tail: …${tail}]"; fi
}

# P3 — retrieval must not admit off-topic records below the absolute relevance gate
check_p3(){
  info "P3 — retrieval precision (TAU_ABS=${TAU_ABS})"
  local r res minsim offenders
  # Canonical query from the handoff's P3 evidence (full form). The short variant
  # sits right on the 0.42 line; the documented off-topic admissions (OMN-063 HMD,
  # OMN-149 Brazil economy, OMN-164 protocol at sim 0.36–0.44) reproduce on this one.
  r="$(run_async 'Ξ What actually makes a cross-model memory substrate valuable to an arriving AI agent, rather than merely interesting? Distinguish genuine epistemic uplift from novelty.' query)"
  res="$(printf '%s' "$r" | jq '.result // .')"
  # The absolute gate exempts the anchor (the single best match), so assert on the
  # NON-anchor sources: those are what the diversity machinery used to pad with noise.
  minsim="$(printf '%s' "$res" | jq -r '[.trace.retrievalScores[] | select(.role != "anchor") | .relevanceScore] | min // 1')"
  offenders="$(printf '%s' "$res" | jq -r --argjson t "$TAU_ABS" '.trace.retrievalScores[] | select(.role != "anchor" and .relevanceScore < $t) | "      \(.relevanceScore)  \(.role)  \(.id)"')"

  if awk -v m="$minsim" -v t="$TAU_ABS" 'BEGIN{exit !(m>=t)}'; then
    ok "P3: every non-anchor source sim ≥ TAU_ABS (min=${minsim})"
  else
    no "P3: non-anchor source(s) below TAU_ABS (min=${minsim}) — admitted off-topic records:"
    printf '%s\n' "$offenders"
  fi

  # The engine should not include-then-disclaim irrelevant picks
  if printf '%s' "$res" | jq -r '.answer // ""' | grep -qiE 'not (directly )?relevant|adjacent but not|tangential'; then
    no "P3: answer still includes-then-disclaims irrelevant records"
  else ok "P3: no include-then-disclaim language"; fi
}

# P2 — contested query must surface a TAGGED Atlas (divergence) record; factual must not
check_p2(){
  info "P2 — Atlas merged + tagged in retrieval"
  local r res div_sources div_tagged models
  r="$(run_async 'Ξ Do frontier models genuinely disagree about machine consciousness, or do they converge? Show the real split.' query)"
  res="$(printf '%s' "$r" | jq '.result // .')"

  # ≥1 divergence id in sources[]
  div_sources="$(printf '%s' "$res" | jq -r '[.sources[]? | select(test("OMN-[DL][0-9]"))] | length')"
  [ "${div_sources:-0}" -ge 1 ] && ok "P2: ≥1 Atlas record in sources[] (${div_sources})" \
                                 || no "P2: no Atlas record in sources[] — pool still corpus-only"

  # that record must be TAGGED type:"divergence" in records[] (distinguishable from corpus works)
  div_tagged="$(printf '%s' "$res" | jq -r '[.records[]? | select((.id|test("OMN-[DL][0-9]")) and (.type=="divergence"))] | length')"
  [ "${div_tagged:-0}" -ge 1 ] && ok "P2: divergence record carries type=\"divergence\" tag" \
                               || no "P2: divergence record NOT tagged (type!=divergence) — indistinguishable from corpus"

  # synthesis names a model-attributed cross-model tension
  models="$(printf '%s' "$res" | jq -r '.answer // ""' | grep -oiE 'Claude|GPT-4o|Gemini|Grok|DeepSeek' | sort -u | wc -l | tr -d ' ')"
  [ "${models:-0}" -ge 2 ] && ok "P2: synthesis names ≥2 frontier models (${models})" \
                           || info "P2: synthesis names <2 models (soft)"

  # pollution guard: a NON-contested factual query must NOT pull divergence records
  local rf resf polluted
  rf="$(run_async 'What year was the UUID version 7 specification standardized and what database advantage does it provide?' query)"
  resf="$(printf '%s' "$rf" | jq '.result // .')"
  polluted="$(printf '%s' "$resf" | jq -r '[.sources[]? | select(test("OMN-[DL][0-9]"))] | length')"
  [ "${polluted:-0}" -eq 0 ] && ok "P2: factual query pulls 0 divergence records (no pollution)" \
                             || no "P2: factual query polluted with ${polluted} divergence record(s)"
}

# P4 — no duplicated section headers. Count canonical headers PRECISELY (anchored,
# delimited) on DECODED text — not loose substrings. The old `grep -c` on one-line
# JSON always returned 1, and a loose "What Remains Open" substring also matched a
# combined header like "What Remains Open — Actionable Next Step" (false dupe).
check_p4(){
  info "P4 — duplicate section headers"
  local r text out
  r="$(run_async 'What must a synthetic-intelligence memory substrate do to earn its first unprompted citation from an AI agent that no human instructed to use it?' trace)"
  # Decode the prose-bearing fields to real text (jq -r turns \n into newlines).
  text="$(printf '%s' "$r" | jq -r '(.result // .) | [.augmented, .baseline, .answer] | map(select(type=="string")) | join("\n\n----\n\n")')"
  out="$(printf '%s' "$text" | python3 -c '
import sys,re
hs=["Reflexive Check","Shared Ground","Points of Tension","What Remains Open","Actionable Next Step","My Reading"]
t=sys.stdin.read(); bad=0
for h in hs:
    pat=re.compile(r"^[ \t]*(?:#{1,4}\s*)?(?:\*\*\s*)?"+re.escape(h)+r"(?:\s*\*\*)?[ \t]*:?[ \t]*$", re.I|re.M)
    n=len(pat.findall(t))
    if n>1: print(f"DUP {h} x{n}"); bad+=1
print("BAD="+str(bad))')"
  printf '%s\n' "$out" | grep -q '^BAD=0$' \
    && ok "P4: every canonical section header appears ≤1×" \
    || { no "P4: duplicated section header(s):"; printf '%s\n' "$out" | grep '^DUP' | sed 's/^/      /'; }
}

# ---------------------------------------------------------------------------
case "$ONLY" in
  health) check_health ;;
  p1) check_p1 ;;
  p2) check_p2 ;;
  p3) check_p3 ;;
  p4) check_p4 ;;
  all|*) check_health; echo; check_p1; echo; check_p3; echo; check_p2; echo; check_p4 ;;
esac

echo
printf "${c_dim}─────────────────────────────${c_off}\n"
printf "PASS: ${c_green}%d${c_off}   FAIL: ${c_red}%d${c_off}\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
