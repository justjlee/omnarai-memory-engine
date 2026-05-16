#!/usr/bin/env bash
# Omnarai corpus pipeline launcher.
# Reads credentials from .env.local, then passes all args to corpus_pipeline.py.
#
# Usage:
#   ./scripts/run_pipeline.sh                          # dry run, all 260 included videos
#   ./scripts/run_pipeline.sh --video-ids abc123       # dry run, specific video
#   ./scripts/run_pipeline.sh --push                   # full run (write + HuggingFace)

set -e
cd "$(dirname "$0")/.."

# Load .env.local into the shell environment
if [[ -f .env.local ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    # Strip surrounding double or single quotes
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    export "$key"="$val"
  done < .env.local
fi

exec python3 scripts/corpus_pipeline.py "$@"
