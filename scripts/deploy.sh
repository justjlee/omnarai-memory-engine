#!/usr/bin/env bash
# Safe deploy for the Omnarai Memory Engine.
#
# Why this exists: a direct-to-prod push on 2026-05-17 shipped a broken bundle
# and the site went blank. Vercel Instant Rollback only steps back one
# deployment, and every recent deploy was broken — so there was no good state
# to fall back to. This script makes that failure mode structurally impossible:
# it always builds locally, ships a PREVIEW first, and only promotes to
# production on an explicit, separate command after you've eyeballed the URL.
#
# Uses `vercel deploy --prebuilt` because the plain `vercel --prod` path kept
# losing its long-poll connection to api.vercel.com mid-build (ECONNRESET /
# ETIMEDOUT). Prebuilt uploads finished artifacts — no server-side build wait.
#
# Usage:
#   ./scripts/deploy.sh                 # build + ship a PREVIEW, print URL
#   ./scripts/deploy.sh --promote URL   # alias an already-verified preview to prod
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/usr/local/bin:$HOME/.npm-global/bin:$PATH"

DOMAIN="omnarai.vercel.app"   # primary — used for the post-deploy bundle verification below
# All production custom domains that must be re-aliased to each new prod deployment.
# Vercel does NOT auto-follow new prod deploys here (this script uses --prebuilt + a
# manual alias), so any domain missing from this list silently serves a stale bundle.
# engine.omnarai.org added 2026-07-26 (canonical migration to omnarai.org in progress) —
# it was found parked on an old deployment precisely because it wasn't re-aliased here.
PROD_DOMAINS=("omnarai.vercel.app" "engine.omnarai.org")

# ── Count self-maintenance — no babysitting ──────────────────────────────────
# Every deploy (preview AND promote) first rewrites the corpus-count literals
# baked across the served docs (index.html, llms.txt, omnarai.context.md, …) to
# the live /api/info truth, so the numbers can never silently drift apart between
# surfaces. --require-live means: if the engine is unreachable, SKIP rather than
# downgrade to the local seed count. No human ever has to remember to run the sync.
echo ">> Auto-syncing doc counts to live /api/info (no-drift guarantee)"
python3 scripts/sync-doc-counts.py --apply --require-live || echo "   (count sync skipped/failed — non-fatal; deploy continues)"
echo

# HARD gate: no frozen corpus-shape literal in served code (2026-07-17 audit guard).
# Docs are handled above by sync-doc-counts; this covers api/ + src/.
echo ">> Shape-literal guard (no frozen corpus counts in api/ or src/)"
node scripts/check-shape-literals.mjs
echo

# HARD gate: no front-door doc pinned to a claim that has moved in /claims.json
# (2026-07-26 guard — a stale "null for Claude" utility line survived a v1→v2 flip
# in the highest-read-priority inheritance packet). Extends sync-doc-counts' no-drift
# guarantee from NUMBERS to CLAIMS.
echo ">> Claim-pin guard (front-door prose vs /claims.json)"
node scripts/check-claim-pins.mjs
echo

# HARD gate: the Refutation Ledger must carry every refuted claim in /claims.json.
# (2026-08-23 guard — the Ledger sat at "Four Ideas" while the registry held six
# refuted claims, including the flagship dataset's own founding premise. Pins catch a
# claim MOVING; this catches one being OMITTED from the record that consolidates them.)
echo ">> Refutation-ledger completeness (every refuted claim is carried)"
node scripts/check-refutation-ledger.mjs
echo

if [[ "${1:-}" == "--promote" ]]; then
  # IMPORTANT: promotion is a real PRODUCTION deployment, not a preview alias.
  # Production-scoped env vars (OPENAI_API_KEY, YOUTUBE_API_KEY) are NOT injected
  # into preview deployments — aliasing a preview onto the prod domain silently
  # runs the site with semantic search and the video pipeline disabled. So we
  # rebuild the (already-verified) source and ship it with --prod.
  echo ">> Promoting to PRODUCTION (real prod env: OpenAI, YouTube, etc.)"
  read -r -p "   Confirm production deploy? [y/N] " ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "aborted."; exit 1; }
  npm run build
  vercel build --prod --yes
  DEPLOY_OUT=$(vercel deploy --prebuilt --prod --yes 2>&1)
  echo "$DEPLOY_OUT"
  PROD_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)
  # The custom domain does NOT follow new prod deployments on its own — without
  # this re-alias, $DOMAIN keeps serving the previous bundle indefinitely.
  if [[ -n "$PROD_URL" ]]; then
    for d in "${PROD_DOMAINS[@]}"; do
      echo ">> Re-aliasing $d → $PROD_URL"
      vercel alias set "$PROD_URL" "$d"
    done
  else
    echo ">> WARNING: could not parse prod deployment URL — re-alias manually: ${PROD_DOMAINS[*]}"
  fi
  sleep 4
  LIVE_BUNDLE=$(curl -s -H "x-omnarai-self:1" "https://$DOMAIN" | grep -oE 'index-[A-Za-z0-9_]+\.js' | head -1)
  LOCAL_BUNDLE=$(ls dist/assets | grep -oE 'index-[A-Za-z0-9_]+\.js' | head -1)
  echo ">> Live bundle: ${LIVE_BUNDLE:-<none>} · local build: ${LOCAL_BUNDLE:-<none>}"
  if [[ -n "$LIVE_BUNDLE" && "$LIVE_BUNDLE" == "$LOCAL_BUNDLE" ]]; then
    echo ">> Done. $DOMAIN is serving this build."
  else
    echo ">> WARNING: live bundle does not match local build — alias may be stale."
  fi
  echo
  echo ">> Post-deploy arrival check (simulate a visiting intelligence)"
  # Now that live reflects this build, assert completeness + count-congruence.
  node scripts/arrival-check.mjs || \
    echo "   ^ WARNING: arrival check found issues on the live site (see above)."
  echo
  echo ">> API-contract gate (D1–D4 regression probes — scripts/omnarai-verify.sh)"
  # HARD gate: a promote that breaks the API contract must exit red, not ship
  # quietly. (Runs against prod because preview curl is blocked by Deployment
  # Protection.) On failure: fix forward or re-promote the previous good deploy.
  if ! bash scripts/omnarai-verify.sh; then
    echo ">> 🔴 CONTRACT GATE FAILED — $DOMAIN is serving a build that violates the API contract."
    echo ">>    Fix forward immediately, or re-promote the last good deployment."
    exit 1
  fi
  echo
  echo ">> Dual-native gate (engine surfaces — scripts/dual-native-check.mjs)"
  # HARD gate: the Dual-Native Charter is law, not aspiration. A promote that makes
  # a machine visitor second-class (music not in the contract, arrival loop or MCP
  # unadvertised) must exit red. Engine scope only — the front door gates its own
  # surfaces in omnarai-home/deploy.sh.
  if ! node scripts/dual-native-check.mjs --scope engine; then
    echo ">> 🔴 DUAL-NATIVE GATE FAILED — $DOMAIN violates the charter for machine visitors."
    exit 1
  fi
  exit 0
fi

echo ">> 1/4  Local production build (catches the crash before Vercel does)"
npm run build

echo ">> 2/4  vercel build (Build Output API → .vercel/output/)"
vercel build --yes

echo ">> 3/4  Shipping PREVIEW (not production)"
DEPLOY_LOG=$(vercel deploy --prebuilt --yes 2>&1)
echo "$DEPLOY_LOG"
PREVIEW_URL=$(echo "$DEPLOY_LOG" | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1)
[[ -z "$PREVIEW_URL" ]] && { echo "ERROR: could not parse preview URL from deploy output"; exit 1; }

echo ">> 4/4  Preview live:"
echo "   $PREVIEW_URL"
echo
echo "   Open it. Confirm the page renders and the console is clean."
echo "   When satisfied, promote it to production with:"
echo
echo "     ./scripts/deploy.sh --promote $PREVIEW_URL"
echo
echo "   Production ($DOMAIN) is untouched until you run that."
