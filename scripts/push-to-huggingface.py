#!/usr/bin/env python3
"""
Push all Omnarai dataset files to HuggingFace.
Dataset: TheRealmsOfOmnarai/realms-of-omnarai

Usage:
    HF_TOKEN="hf_..." python3 scripts/push-to-huggingface.py
"""

import os
import sys
from pathlib import Path
from huggingface_hub import HfApi

REPO_ID = "TheRealmsOfOmnarai/realms-of-omnarai"
HF_DIR = Path(__file__).parent.parent / "huggingface"

# Files at repo root
ROOT_FILES = [
    "README.md",
    "corpus.json",
    "corpus.csv",
    "corpus-full-text.jsonl",
    "concepts.json",
    "omnarai.context.md",
    "llms.txt",
    "holdform-paper.md",
    "holdform-paper.tex",
    "holdform.bib",
    "engine-tour.md",
    # Divergence Atlas — cross-model divergence records (built by build-divergence-atlas.mjs)
    "divergence-atlas.md",
    "divergences.jsonl",
    "divergence-answers.jsonl",
    "divergence-tensions.csv",
]

# Any results files present
RESULTS_PATTERN = "results-*.md"

# Benchmark subdirectory
BENCHMARK_FILES = [
    "benchmark/README.md",
    "benchmark/holdform-benchmark-v1.jsonl",
    "benchmark/holdform-benchmark-v1.csv",
    "benchmark/holdform-test-packet.md",
    "benchmark/scoring-template.csv",
    "benchmark/lattice-engagement-v2-fragility-thesis-20260403.md",
    "benchmark/lattice-engagement-v2-fragility-thesis-grok-20260403.md",
    # Results — all model runs
    "benchmark/results-claude-opus-4.md",
    "benchmark/results-claude-sonnet-4-2026-04-11.md",
    "benchmark/results-grok-4.20-2026-04-03.md",
    "benchmark/results-gemini-2026-04-06.md",
    "benchmark/results-gpt4o-2026-04-06.md",
    "benchmark/results-deepseek-2026-04-06.md",
    "benchmark/results-metaai-2026-04-06.md",
    # v2 benchmark
    "benchmark/holdform-test-packet-v2.md",
    "benchmark/holdform-benchmark-v2.jsonl",
    # v2 results
    "benchmark/results-claude-sonnet-4-v2-2026-04-11.md",
    "benchmark/results-claude-sonnet-4-6-v2-2026-04-12.md",
    # cross-architecture analysis
    "cross-architecture-holdform-analysis.md",
]

def main():
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: HF_TOKEN environment variable not set.")
        sys.exit(1)

    api = HfApi(token=token)

    # Collect all files to upload
    to_upload = []

    for fname in ROOT_FILES:
        fpath = HF_DIR / fname
        if fpath.exists():
            to_upload.append((fpath, fname))
        else:
            print(f"  SKIP (not found): {fname}")

    # Dynamic results files
    for fpath in sorted(HF_DIR.glob(RESULTS_PATTERN)):
        to_upload.append((fpath, fpath.name))

    for bfname in BENCHMARK_FILES:
        fpath = HF_DIR / bfname
        if fpath.exists():
            to_upload.append((fpath, bfname))
        else:
            print(f"  SKIP (not found): {bfname}")

    print(f"\nUploading {len(to_upload)} files to {REPO_ID}...\n")

    for local_path, repo_path in to_upload:
        size_kb = local_path.stat().st_size / 1024
        print(f"  → {repo_path} ({size_kb:.1f} KB)")
        api.upload_file(
            path_or_fileobj=str(local_path),
            path_in_repo=repo_path,
            repo_id=REPO_ID,
            repo_type="dataset",
            commit_message=f"Update {repo_path}",
        )

    print(f"\nDone. {len(to_upload)} files pushed to {REPO_ID}")

if __name__ == "__main__":
    main()
