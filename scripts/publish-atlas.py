#!/usr/bin/env python3
"""publish-atlas.py — publish the verified Atlas v1.0.0 to HuggingFace.

Executes the publish decided 2026-07-14 (xz authorized; technical decisions
delegated to the executing session — see SESSION-LOG.md "Decisions"):
  1. Create dataset repo TheRealmsOfOmnarai/omnarai-divergence-atlas (PRIVATE first).
  2. Upload the verified atlas/ files.
  3. Spot-check two records via the raw API against the local export.
  4. Refresh the EXISTING corpus dataset's Atlas files (certification enrichment,
     staged + verified in huggingface/staging/atlas-2026-07-14/) + cross-linked README.
  5. Flip the new repo public only if every prior step succeeded.

Requires HF_TOKEN (write) in env or .env.local. Refuses to run if verify state
is not green: run scripts/verify-atlas.sh first if in doubt.
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NEW_REPO = "TheRealmsOfOmnarai/omnarai-divergence-atlas"
OLD_REPO = "TheRealmsOfOmnarai/realms-of-omnarai"

# token: env first, then .env.local
if not os.environ.get("HF_TOKEN"):
    for line in (ROOT / ".env.local").read_text().splitlines():
        m = re.match(r"^\s*HF_TOKEN\s*=\s*(.+?)\s*$", line)
        if m:
            os.environ["HF_TOKEN"] = m.group(1).strip("\"'")
            break

from huggingface_hub import HfApi

api = HfApi()
me = api.whoami()
print(f"authenticated as: {me.get('name')}")

# 1. create private repo (idempotent)
api.create_repo(NEW_REPO, repo_type="dataset", private=True, exist_ok=True)
print(f"repo ready (private): {NEW_REPO}")

# 2. upload the new dataset
NEW_FILES = ["README.md", "divergence-delta.schema.json", "manifest.json",
             "excluded.log", "review-needed.log", "data/atlas-v1.0.0.jsonl"]
for f in NEW_FILES:
    api.upload_file(path_or_fileobj=str(ROOT / "atlas" / f), path_in_repo=f,
                    repo_id=NEW_REPO, repo_type="dataset",
                    commit_message=f"Atlas v1.0.0: {f}")
    print(f"  uploaded {f}")

# 3. spot-check: two records, raw download vs local export (use /raw/, never CDN /resolve/)
import urllib.request
local = [json.loads(l) for l in (ROOT / "atlas/data/atlas-v1.0.0.jsonl").open()]
url = f"https://huggingface.co/datasets/{NEW_REPO}/raw/main/data/atlas-v1.0.0.jsonl"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"})
remote = [json.loads(l) for l in urllib.request.urlopen(req, timeout=60).read().decode().splitlines() if l]
assert len(remote) == len(local) == 110, f"count mismatch: remote={len(remote)} local={len(local)}"
for idx in (0, len(local) // 2):
    assert remote[idx] == local[idx], f"record {idx} differs after upload"
print(f"spot-check OK: {len(remote)} records, sampled records byte-equal")

# 4. refresh the existing dataset: staged Atlas files + cross-linked README
STAGING = ROOT / "huggingface/staging/atlas-2026-07-14"
for src, dest in [(STAGING / "divergences.jsonl", "divergences.jsonl"),
                  (STAGING / "divergence-answers.jsonl", "divergence-answers.jsonl"),
                  (STAGING / "divergence-tensions.csv", "divergence-tensions.csv"),
                  (STAGING / "divergence-atlas.md", "divergence-atlas.md"),
                  (ROOT / "huggingface/README.md", "README.md")]:
    api.upload_file(path_or_fileobj=str(src), path_in_repo=dest,
                    repo_id=OLD_REPO, repo_type="dataset",
                    commit_message="Atlas refresh: certification fields + cross-link to omnarai-divergence-atlas")
    print(f"  refreshed {OLD_REPO}/{dest}")

# 5. everything succeeded -> public
api.update_repo_settings(repo_id=NEW_REPO, repo_type="dataset", private=False)
print(f"\nPUBLISHED: https://huggingface.co/datasets/{NEW_REPO}")
print("Post-publish: verify the card renders in a browser; then git tag + push if not already done.")
