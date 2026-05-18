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

DOMAIN="omnarai.vercel.app"

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
  vercel deploy --prebuilt --prod --yes
  sleep 4
  LIVE_BUNDLE=$(curl -s "https://$DOMAIN" | grep -oE 'index-[A-Za-z0-9]+\.js' | head -1)
  echo ">> Live bundle now: ${LIVE_BUNDLE:-<none>}"
  echo ">> Done. Verify https://$DOMAIN — semantic search + videos should work."
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
