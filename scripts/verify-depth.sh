#!/usr/bin/env bash
# verify-depth.sh — HANDOFF-DEPTH-2026-Q4 §5 checks, one command. Exit 1 on any FAIL.
#
# This is the "verify.sh" the handoff names (the engine has no single verify.sh;
# its deploy gate is the chain inside scripts/deploy.sh). Checks whose spec
# still waits on a curator decision report PENDING, never a fake pass:
#   no-c2        — waits on "which text is the withdrawn C-2?" (RECON §⚠︎6)
#   prereg-lock  — waits on D-2 + PREREG-BACKLOG-2026-Q4.md
#   append-only  — waits on WS6's results store
#
#   bash scripts/verify-depth.sh              # all checks
#   bash scripts/verify-depth.sh --no-legacy  # skip legacy-host redirects (pre-deploy)
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0; FAIL=0; PEND=0
run() { # name, command...
  local name="$1"; shift
  if "$@" >/tmp/verify-depth-$$.log 2>&1; then echo "🟢 PASS    $name"; PASS=$((PASS+1))
  else echo "🔴 FAIL    $name"; grep -E '🔴' /tmp/verify-depth-$$.log | sed 's/^/          /' | head -20; FAIL=$((FAIL+1)); fi
}
pending() { echo "🟡 PENDING $1 — $2"; PEND=$((PEND+1)); }

LEGACY_FLAG=""; [[ " $* " == *" --no-legacy "* ]] && LEGACY_FLAG="--no-legacy"

run "1 canonical-links" node scripts/check-canonical-links.mjs $LEGACY_FLAG
run "2 stats-consistency" node scripts/check-stats-consistency.mjs --only stats
run "3 mcp-count" node scripts/check-stats-consistency.mjs --only mcp
pending "4 no-c2" "curator must identify the withdrawn C-2 text"
pending "5 prereg-lock" "needs D-2 (N + thresholds) and PREREG-BACKLOG-2026-Q4.md"
pending "6 append-only" "needs the WS6 longitudinal results store"

# 7 secrets — key-shaped literals in TRACKED files. Allowlisted: YouTube's public
# InnerTube web-client key (embedded in every youtube.com page; not a credential).
secrets() {
  local hits
  hits=$(git grep -nIE '(sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9_-]{32,}|hf_[A-Za-z0-9]{30,}|xai-[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|vercel_blob_rw_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,})' \
    -- ':!public/data/*' ':!huggingface/*' | grep -v 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' || true)
  [ -z "$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$')" ] || { echo "🔴 tracked .env file"; return 1; }
  [ -z "$hits" ] || { echo "$hits" | cut -c1-80 | sed 's/^/🔴 /'; return 1; }
}
run "7 secrets" secrets

rm -f /tmp/verify-depth-$$.log
echo; echo "verify-depth: $PASS pass · $FAIL fail · $PEND pending"
[ "$FAIL" -eq 0 ]
