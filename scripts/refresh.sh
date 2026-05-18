#!/usr/bin/env bash
# One command to bring the Omnarai corpus current after the Reddit source
# changes. Replaces the ~7-step manual ordeal with a single, dry-run-first
# pipeline. Each stage is idempotent and safe to re-run.
#
# Stages:
#   1. git-index guard      (iCloud wipes .git/index — never commit a 0-file index)
#   2. ingest-incremental   (ID-stable; edits propagate; video_* kept SPA-safe)
#   3. sync-doc-counts      (bump every hardcoded count from live /api/info)
#   4. re-embed             (optional --embed; chunked full-doc; needs OPENAI_API_KEY)
#   5. deploy               (optional --deploy; deploy.sh preview)
#   6. promote+re-alias     (optional --promote URL; the step deploy.sh forgets)
#   7. huggingface          (optional --hf; needs HF_TOKEN; derivatives still ad hoc)
#
# Usage:
#   ./scripts/refresh.sh                     # DRY-RUN everything, write nothing
#   ./scripts/refresh.sh --apply             # ingest + doc-counts (local only)
#   ./scripts/refresh.sh --apply --embed     # + chunked re-embed
#   ./scripts/refresh.sh --deploy            # + build & ship a preview
#   ./scripts/refresh.sh --promote <url>     # promote a verified preview + re-alias
#   ./scripts/refresh.sh --apply --hf        # + push HuggingFace
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:$HOME/.npm-global/bin:$PATH"

APPLY=0 EMBED=0 DEPLOY=0 HF=0 PROMOTE_URL=""
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --embed) EMBED=1 ;;
    --deploy) DEPLOY=1 ;;
    --hf) HF=1 ;;
    --promote) echo "ERROR: use --promote <url>"; exit 1 ;;
    https://*) PROMOTE_URL="$a" ;;
    *) echo "Unknown arg: $a"; exit 1 ;;
  esac
done
[[ "${*:-}" == *"--promote"* ]] && { echo "ERROR: --promote needs a URL: ./scripts/refresh.sh <preview-url>"; exit 1; }
DRY=$([[ $APPLY -eq 0 && $DEPLOY -eq 0 && -z "$PROMOTE_URL" ]] && echo 1 || echo 0)

say() { printf "\n\033[1m>> %s\033[0m\n" "$1"; }

# ── Stage 1: git-index guard (iCloud hazard) ──────────────────────────────
say "1/7  git-index guard"
N=$(git ls-files | wc -l | tr -d ' ')
if [[ "$N" -eq 0 ]]; then
  echo "  .git/index is EMPTY (iCloud corruption)."
  if [[ -f .git/index.lock ]] && ! pgrep -lf "git " | grep -qv pgrep; then
    echo "  Removing stale .git/index.lock and rebuilding index from HEAD…"
    [[ $APPLY -eq 1 || $DEPLOY -eq 1 ]] && { rm -f .git/index.lock; git reset -q; }
  fi
  echo "  -> $([[ $APPLY -eq 1 || $DEPLOY -eq 1 ]] && git ls-files | wc -l | tr -d ' ' || echo 'run with --apply to repair') files tracked"
else
  echo "  OK — $N files tracked, HEAD $(git rev-parse --short HEAD)"
fi

# ── Stage 2: incremental ingest ───────────────────────────────────────────
say "2/7  incremental ingest $([[ $APPLY -eq 1 ]] && echo '(--apply)' || echo '(dry-run)')"
python3 scripts/ingest-incremental.py $([[ $APPLY -eq 1 ]] && echo --apply)

# ── Stage 3: doc-count sync ───────────────────────────────────────────────
say "3/7  sync doc counts $([[ $APPLY -eq 1 ]] && echo '(--apply)' || echo '(dry-run)')"
python3 scripts/sync-doc-counts.py $([[ $APPLY -eq 1 ]] && echo --apply)

# ── Stage 4: re-embed (optional, costs OpenAI) ────────────────────────────
say "4/7  re-embed"
if [[ $EMBED -eq 1 && $APPLY -eq 1 ]]; then
  [[ -z "${OPENAI_API_KEY:-}" ]] && { echo "  ERROR: --embed needs OPENAI_API_KEY"; exit 1; }
  echo "  Running chunked full-doc re-embed (generate-embeddings.js)…"
  node scripts/generate-embeddings.js
  echo "  NOTE: api/store.js still embeds new proposals with a 500-word window —"
  echo "        align it if you want grown entries indexed like the static corpus."
else
  echo "  skipped (add --embed --apply; chunked re-embed, ~\$0.02, needs OPENAI_API_KEY)"
fi

# ── Stage 5: deploy preview ───────────────────────────────────────────────
say "5/7  deploy (preview)"
if [[ $DEPLOY -eq 1 ]]; then
  ./scripts/deploy.sh
  echo
  echo "  Verify the preview, then: ./scripts/refresh.sh <preview-url>"
else
  echo "  skipped (add --deploy to build + ship a preview)"
fi

# ── Stage 6: promote + RE-ALIAS (the step deploy.sh forgets) ──────────────
say "6/7  promote + re-alias"
if [[ -n "$PROMOTE_URL" ]]; then
  # Capture promote output; the new prod deployment URL is in its JSON.
  # (vercel ls / inspect parsing proved unreliable — the custom domain stayed
  #  pinned to the prior deployment. Parse the promote output directly.)
  PROMOTE_OUT=$(printf 'y\n' | ./scripts/deploy.sh --promote "$PROMOTE_URL" 2>&1)
  echo "$PROMOTE_OUT" | tail -6
  PROD_URL=$(echo "$PROMOTE_OUT" \
    | grep -oE 'https://omnarai-memory-engine-[a-z0-9]+-justjlee2-4420s-projects\.vercel\.app' \
    | tail -1)
  if [[ -n "$PROD_URL" ]]; then
    echo "  Re-aliasing omnarai.vercel.app -> $PROD_URL  (deploy.sh does NOT do this)"
    vercel alias set "$PROD_URL" omnarai.vercel.app
  else
    echo "  WARN: could not capture prod URL from promote output."
    echo "        Manually: vercel alias set <new-deployment-url> omnarai.vercel.app"
  fi
  sleep 4
  BUNDLE=$(curl -s "https://omnarai.vercel.app" | grep -oE 'index-[A-Za-z0-9]+\.js' | head -1)
  V=$(curl -s "https://omnarai.vercel.app/omnarai.context.md?cb=$RANDOM" | grep -m1 -oE 'Version:\*\* [0-9.]+')
  AGE=$(curl -sI "https://omnarai.vercel.app/omnarai.context.md" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1}/^age:/{print $2}')
  echo "  Live: bundle=${BUNDLE:-?}  context.md ${V:-?}  age=${AGE:-0} (want low)"
  curl -s "https://omnarai.vercel.app/api/info" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  /api/info works:',d['corpus']['totalWorks'])"
else
  echo "  skipped (run: ./scripts/refresh.sh <verified-preview-url>)"
fi

# ── Stage 7: HuggingFace (optional, public) ───────────────────────────────
say "7/7  huggingface"
if [[ $HF -eq 1 ]]; then
  [[ -z "${HF_TOKEN:-}" ]] && { echo "  ERROR: --hf needs HF_TOKEN"; exit 1; }
  echo "  Rebuilding huggingface/ derivatives from current corpus…"
  python3 scripts/build-hf-derivatives.py --apply
  python3 scripts/push-to-huggingface.py
else
  echo "  rebuild-only preview (no push):"
  python3 scripts/build-hf-derivatives.py
  echo "  (add --hf with HF_TOKEN to rebuild + push)"
fi

say "done — $([[ $DRY -eq 1 ]] && echo 'DRY-RUN (nothing written)' || echo 'changes applied')"
[[ $DRY -eq 1 ]] && echo "Re-run with --apply to write, then --deploy, verify, then <preview-url> to promote."
echo
