#!/usr/bin/env bash
# adiff-repro.sh — reproduce the architecture-differential utility finding.
#
# This runs the REAL preregistered eval harness (scripts/utility-test-prereg.mjs) — the
# same three arms (baseline / placebo / Atlas-treatment), the same blind judge panel, the
# same statistics that produced utility-evidence-v2.md — in its SMALLEST HONEST
# configuration, so it finishes in minutes instead of ~2 hours.
#
# WHY NOT "one model pair": the eval's validity rests on a BLIND JUDGE PANEL that is
# disjoint from the consumer under test and from the held-out paraphraser. Collapsing it to
# a single model pair removes the panel and measures something different (no majority vote,
# self-scoring). So the minimal honest unit still needs the consumer + a held-out
# paraphraser + >=2 blind judges — i.e. >=4 of the 5 provider keys. We do not ship a
# simplified script that measures something else (see HANDOFF-ADIFF-2026-08 repro requirement).
#
# WHAT IT REPRODUCES: the machinery end-to-end and the per-item direction on a small sample.
# It does NOT reproduce the full n=25/cell significance (35-126 for Claude) — that is the full
# run: drop --smoke, budget ~$40-90 and ~2h. Numbers here will be noisy at this sample size.
#
# USAGE:
#   export ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... XAI_API_KEY=... DEEPSEEK_API_KEY=...
#   bash repro/adiff-repro.sh                 # consumer=Claude (the finding), 1 base question/cell
#   ADIFF_CONSUMER=GPT-4o bash repro/adiff-repro.sh   # reproduce a POSITIVE tier instead
#   ADIFF_SMOKE=2 bash repro/adiff-repro.sh   # 2 base questions/cell (slower)
#
# Env knobs: ADIFF_CONSUMER (default Claude), ADIFF_SMOKE (default 1), ADIFF_PREFLIGHT=0 to skip.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CONSUMER="${ADIFF_CONSUMER:-Claude}"
SMOKE="${ADIFF_SMOKE:-1}"

echo "== adiff-repro =="
echo "repo: $ROOT"
echo "consumer under test: $CONSUMER    smoke sample: $SMOKE base question(s)/cell"
echo

# ── key check (need >=4 of 5; the consumer's own key is mandatory) ─────────────────────────
declare -a KEYS=(ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY XAI_API_KEY DEEPSEEK_API_KEY)
consumer_key_for() { case "$1" in
  Claude) echo ANTHROPIC_API_KEY;; GPT-4o) echo OPENAI_API_KEY;; Gemini) echo GEMINI_API_KEY;;
  Grok) echo XAI_API_KEY;; DeepSeek) echo DEEPSEEK_API_KEY;; *) echo "";; esac; }
present=0; missing=()
for k in "${KEYS[@]}"; do
  if [ -n "${!k:-}" ]; then present=$((present+1)); else missing+=("$k"); fi
done
ck="$(consumer_key_for "$CONSUMER")"
if [ -z "${!ck:-}" ]; then
  echo "ERROR: consumer '$CONSUMER' needs \$$ck, which is not set." >&2; exit 2
fi
if [ "$present" -lt 4 ]; then
  echo "ERROR: found $present/5 provider keys; the blind panel needs >=4." >&2
  echo "       missing: ${missing[*]}" >&2
  echo "       set them in your shell (export KEY=...) and re-run." >&2
  exit 2
fi
[ "$present" -lt 5 ] && echo "note: $present/5 keys present (missing: ${missing[*]-none}); running with a reduced panel."

# ── the harness reads ./.env.local; synthesize one from the exported keys IF absent ────────
CREATED_ENV=0
if [ ! -f .env.local ]; then
  echo "no .env.local found — writing a temporary one from your exported keys (removed on exit)."
  for k in "${KEYS[@]}"; do [ -n "${!k:-}" ] && echo "$k=${!k}" >> .env.local; done
  CREATED_ENV=1
  trap 'if [ "$CREATED_ENV" = 1 ]; then rm -f .env.local; fi' EXIT
fi

# ── verify keys reach every role before spending on the full smoke (1 call/role) ───────────
if [ "${ADIFF_PREFLIGHT:-1}" = 1 ]; then
  echo; echo "-- preflight (1 call per role) --"
  CONSUMER_MODEL="$CONSUMER" node scripts/utility-test-prereg.mjs --preflight
fi

# ── the real run, minimized ────────────────────────────────────────────────────────────────
echo; echo "-- smoke run: real 3-arm eval, blind panel, $SMOKE base Q/cell --"
START=$(date +%s)
CONSUMER_MODEL="$CONSUMER" node scripts/utility-test-prereg.mjs --smoke "$SMOKE"
END=$(date +%s)

OUT="/tmp/utility_prereg_${CONSUMER}.json"
echo
echo "== done in $((END-START))s =="
echo "output: $OUT"
echo
echo "EXPECTED OUTPUT SHAPE (same schema as the published huggingface/utility/utility-prereg-${CONSUMER}.json):"
cat <<'SHAPE'
  {
    "meta":  { "consumer": {...}, "paraphraser": {...}, "judges": [...], "run_date": "..." },
    "cells": { "700__v0": [ { "id", "overall":"treatment|placebo|tie",
                              "panelVote": {"treatment":N,"placebo":N},
                              "verdicts":[...], "robust":{...},
                              "transcripts":{"question","original","placebo","treatment",...} } ],
               "700__v1": [...], ..., "1500__v2": [...] },
    "cellSummaries": [ { "key", "n", "T", "P", "tie", "sign_p_two_sided", ... } ]
  }
  # For Claude at the full sample, pooled P >> T (placebo beats Atlas): the negative effect.
  # At --smoke sample sizes the sign is directional and noisy, not significant.
SHAPE
echo
echo "If your numbers disagree with ours, we want the disagreement. File it against the"
echo "Refutation Ledger: https://engine.omnarai.org/refutation-ledger.md"
