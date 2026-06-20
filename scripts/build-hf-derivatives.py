#!/usr/bin/env python3
"""
Regenerate the HuggingFace dataset derivatives from the live corpus.

Closes the last currency gap: huggingface/corpus.{json,csv} and
corpus-full-text.jsonl had no reproducible builder, so they silently rotted
(stuck at the 2026-04-03 / 298-entry snapshot). push-to-huggingface.py would
then publish stale data.

The HF dataset is the TEXT corpus with full_text — OMN-* records (Reddit
works + OMN-S engine syntheses). video_* entries use a different schema and
are intentionally excluded (they would corrupt the flat columns).

Outputs (into huggingface/), schema-identical to the existing dataset:
  corpus.json            indented JSON array
  corpus-full-text.jsonl one JSON object per line
  corpus.csv             16 fixed columns; list fields as Python-style
                         reprs (['a', 'b']) to match existing consumers
  concepts.json          copied from public/data
  omnarai.context.md     copied from public  (v5.0)
  llms.txt               copied from public  (v5.0)

Default: dry-run. --apply writes.
"""

import argparse
import csv
import json
import shutil
from pathlib import Path

BASE = Path(__file__).parent.parent
HF = BASE / "huggingface"
CORPUS = json.loads((BASE / "public/data/corpus.json").read_text())

# Merge live grown-memory entries (divergence records + engine syntheses that
# live in the Vercel Blob, NOT the seed corpus.json) so the HF dataset reflects
# what the engine actually serves. Refresh the snapshot first:
#   node scripts/dump-grown.mjs
_GROWN = BASE / "scripts" / ".grown-snapshot.json"
if _GROWN.exists():
    _by_id = {str(r.get("id")): r for r in CORPUS}
    for _e in json.loads(_GROWN.read_text()).get("entries", []):
        _id = str(_e.get("id"))
        _by_id[_id] = {**_by_id.get(_id, {}), **{k: v for k, v in _e.items() if v is not None}}
    CORPUS = list(_by_id.values())
    print(f"[grown] merged snapshot: corpus now {len(CORPUS)} records")

# Exact column order of the existing HF dataset — do not reorder.
# `evidence_status` (+ its provenance) are APPENDED at the end so existing column
# positions are unchanged. `ring` = project centrality; `evidence_status` = weight
# to put on the work's claims about the world (independent axis). See
# public/evidence-status.md.
COLS = ["id", "num", "title", "ring", "type", "contributors", "lineage",
        "excerpt", "date", "wordCount", "permalink", "score", "image",
        "imageWidth", "imageHeight", "full_text",
        "evidence_status", "evidence_status_source"]


# Media split (added 2026-06-19): the video_* corpus. Historically excluded
# because its native schema lacked the flat columns; the ingest schema guard now
# normalizes ring/type/contributors/lineage/excerpt onto every video record, so
# it projects cleanly onto its OWN flat schema here — an ADDITIVE split that
# leaves the text mirror (corpus.*) and its documented "423 text works" basis
# untouched. These are the `media` ring (oral/video modality).
MEDIA_COLS = ["id", "title", "ring", "type", "contributors", "lineage",
              "excerpt", "script_author", "video_id", "video_url", "playlist_id",
              "duration_seconds", "published_at", "tags", "transcript"]


def is_text_work(r):
    rid = str(r.get("id", ""))
    if rid.startswith("video_"):
        return False
    # OMN-### (Reddit) and OMN-S… (grown syntheses) are the text corpus.
    return rid.startswith("OMN-")


def is_media_work(r):
    return str(r.get("id", "")).startswith("video_")


def normalize_media(r):
    """Project a normalized video record onto the flat MEDIA_COLS schema."""
    auth = r.get("authorship") or {}
    tr = r.get("transcript") or {}
    flat = {
        "script_author": auth.get("script_author", ""),
        "video_id": r.get("video_id", ""),
        "video_url": r.get("video_url", ""),
        "playlist_id": r.get("playlist_id", ""),
        "duration_seconds": r.get("duration_seconds", 0) or 0,
        "published_at": r.get("published_at", ""),
        "tags": r.get("tags", []) or [],
        "transcript": tr.get("cleaned") or r.get("content", "") or "",
    }
    out = {}
    for c in MEDIA_COLS:
        if c in flat:
            out[c] = flat[c]
        else:
            v = r.get(c)
            out[c] = ([] if c in ("contributors", "lineage") else "") if v is None else v
    return out


def normalize(r):
    """Project a record onto the fixed HF schema (missing -> sensible blank)."""
    out = {}
    for c in COLS:
        v = r.get(c)
        if v is None:
            v = [] if c in ("contributors", "lineage") else (
                0 if c in ("num", "wordCount", "score", "imageWidth", "imageHeight")
                else "uncharacterized" if c == "evidence_status"  # honest default, matches the API
                else "")
        out[c] = v
    # grown OMN-S entries have no full_text mirror of body? fall back to excerpt
    if not out["full_text"]:
        out["full_text"] = r.get("full_text") or r.get("excerpt") or ""
    return out


def pylist(v):
    """Match the existing CSV's Python-repr list format: ['a', 'b']."""
    if isinstance(v, list):
        return "[" + ", ".join("'" + str(x).replace("'", "\\'") + "'" for x in v) + "]"
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    records = [normalize(r) for r in CORPUS if is_text_work(r)]
    with_ft = sum(1 for r in records if r["full_text"].strip())
    media = [normalize_media(r) for r in CORPUS if is_media_work(r)]

    print(f"\n=== HF derivatives — {'APPLY' if args.apply else 'DRY-RUN'} ===")
    print(f"Source corpus:        {len(CORPUS)} records")
    print(f"Text works (OMN-*):   {len(records)}  (video_* excluded from text mirror)")
    print(f"  with full_text:     {with_ft}")
    print(f"Media works (video_*):{len(media)}  (media ring — separate additive split)")
    print(f"Targets in {HF.relative_to(BASE.parent)}/:")
    print("  corpus.json  corpus-full-text.jsonl  corpus.csv")
    print("  media-corpus.jsonl  media-corpus.csv")
    print("  + concepts.json, omnarai.context.md, llms.txt (copied from public)")

    if not args.apply:
        print("\nRe-run with --apply to write.\n")
        return

    HF.mkdir(parents=True, exist_ok=True)
    (HF / "corpus.json").write_text(json.dumps(records, indent=2, ensure_ascii=False))
    with (HF / "corpus-full-text.jsonl").open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with (HF / "corpus.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLS)
        for r in records:
            w.writerow([pylist(r[c]) for c in COLS])

    # Media split — additive, separate files (does not touch the text mirror).
    with (HF / "media-corpus.jsonl").open("w", encoding="utf-8") as f:
        for r in media:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with (HF / "media-corpus.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(MEDIA_COLS)
        for r in media:
            w.writerow([pylist(r[c]) for c in MEDIA_COLS])

    for src, dst in [
        (BASE / "public/data/concepts.json", HF / "concepts.json"),
        (BASE / "public/omnarai.context.md", HF / "omnarai.context.md"),
        (BASE / "public/llms.txt", HF / "llms.txt"),
    ]:
        if src.exists():
            shutil.copy2(src, dst)

    print(f"\n✓ Wrote corpus.json ({len(records)}), corpus-full-text.jsonl, "
          f"corpus.csv, media-corpus.jsonl ({len(media)}), media-corpus.csv, "
          f"+ concepts/context/llms\n")


if __name__ == "__main__":
    main()
