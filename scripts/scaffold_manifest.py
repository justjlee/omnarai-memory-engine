#!/usr/bin/env python3
"""
Scaffold or update corpus_manifest.json from the YouTube playlist.

Run this whenever you want to sync the manifest with the current playlist state:
- New videos appear in the playlist → added to manifest as pending_review
- Removed videos → logged as a warning, not auto-removed from manifest

Usage:
    python3 scripts/scaffold_manifest.py

Environment variables (loaded from .env.local automatically):
    YOUTUBE_API_KEY

Output:
    corpus/corpus_manifest.json   (created or updated in place)
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

PLAYLIST_ID = "PL7z5YebYrvQwVqo7Zt6CKO3lKaOjy17lV"
REPO_ROOT = Path(__file__).parent.parent
MANIFEST_PATH = REPO_ROOT / "corpus" / "corpus_manifest.json"

# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------

def load_env_file():
    for candidate in [REPO_ROOT / ".env.local", REPO_ROOT / ".env"]:
        if candidate.exists():
            with open(candidate) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    val = val.strip().strip('"').strip("'")
                    if key.strip() not in os.environ:
                        os.environ[key.strip()] = val
            break

# ---------------------------------------------------------------------------
# YouTube playlist fetch
# ---------------------------------------------------------------------------

def fetch_playlist_videos(api_key):
    """Return list of dicts with video metadata, in playlist order."""
    try:
        from googleapiclient.discovery import build
    except ImportError:
        print("ERROR: google-api-python-client not installed.")
        print("Run: pip install -r scripts/requirements-pipeline.txt")
        sys.exit(1)

    youtube = build("youtube", "v3", developerKey=api_key)
    videos = []
    page_token = None

    while True:
        req = youtube.playlistItems().list(
            part="snippet,contentDetails",
            playlistId=PLAYLIST_ID,
            maxResults=50,
            pageToken=page_token,
        )
        resp = req.execute()

        for item in resp.get("items", []):
            s = item["snippet"]
            title = s.get("title", "")
            if title in ("Deleted video", "Private video"):
                continue
            videos.append({
                "video_id": s["resourceId"]["videoId"],
                "title": title,
                "position": s.get("position", 0),
                "published_at": s.get("publishedAt", ""),
            })

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    # Fetch durations in batches of 50
    video_ids = [v["video_id"] for v in videos]
    durations = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i+50]
        req = youtube.videos().list(part="contentDetails", id=",".join(batch))
        resp = req.execute()
        for item in resp.get("items", []):
            durations[item["id"]] = _parse_duration(item["contentDetails"]["duration"])

    for v in videos:
        v["duration_seconds"] = durations.get(v["video_id"])

    return sorted(videos, key=lambda v: v["position"])


def _parse_duration(iso_duration):
    """Parse ISO 8601 duration (PT1M30S) to seconds."""
    import re
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso_duration)
    if not m:
        return None
    h, mi, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + s

# ---------------------------------------------------------------------------
# Manifest read/write
# ---------------------------------------------------------------------------

def load_manifest():
    if MANIFEST_PATH.exists():
        with open(MANIFEST_PATH) as f:
            return json.load(f)
    return {
        "version": "1.0",
        "playlist_id": PLAYLIST_ID,
        "last_updated": "",
        "videos": [],
    }


def save_manifest(manifest):
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    manifest["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"\nManifest written to {MANIFEST_PATH}")

# ---------------------------------------------------------------------------
# Reconcile
# ---------------------------------------------------------------------------

def reconcile(manifest, playlist_videos):
    existing = {v["video_id"]: v for v in manifest["videos"]}
    playlist_ids = {v["video_id"] for v in playlist_videos}

    added = 0
    for pv in playlist_videos:
        vid = pv["video_id"]
        if vid not in existing:
            manifest["videos"].append({
                "video_id": vid,
                "title": pv["title"],
                "position": pv["position"],
                "published_at": pv["published_at"],
                "duration_seconds": pv["duration_seconds"],
                "corpus_status": "pending_review",
                "recovery_status": "uncertain",
                "authorship_overrides": {},
                "epistemic_mode": "Canonical",
                "tags": [],
                "cleanup_notes": None,
            })
            added += 1
        else:
            # Update mutable playlist metadata, preserve all corpus decisions
            existing[vid]["title"] = pv["title"]
            existing[vid]["position"] = pv["position"]
            if pv.get("duration_seconds"):
                existing[vid]["duration_seconds"] = pv["duration_seconds"]

    removed = 0
    for vid in list(existing.keys()):
        if vid not in playlist_ids:
            print(f"  WARNING: {vid} ({existing[vid].get('title','?')}) is in manifest but not in playlist.")
            print(f"           Not auto-removing — update corpus_status manually if needed.")
            removed += 1

    # Keep playlist order
    pos_map = {v["video_id"]: v["position"] for v in playlist_videos}
    manifest["videos"].sort(key=lambda v: pos_map.get(v["video_id"], 9999))

    return added, removed

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    load_env_file()

    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        print("ERROR: YOUTUBE_API_KEY not set.")
        sys.exit(1)

    print(f"Fetching playlist {PLAYLIST_ID}...")
    playlist_videos = fetch_playlist_videos(api_key)
    print(f"  {len(playlist_videos)} videos in playlist.")

    manifest = load_manifest()
    before = len(manifest["videos"])
    added, removed_warnings = reconcile(manifest, playlist_videos)

    print(f"\nReconciliation:")
    print(f"  Before: {before} manifest entries")
    print(f"  Added:  {added} new (pending_review)")
    print(f"  After:  {len(manifest['videos'])} total entries")
    if removed_warnings:
        print(f"  Warnings: {removed_warnings} videos in manifest but not in playlist (see above)")

    pending = sum(1 for v in manifest["videos"] if v["corpus_status"] == "pending_review")
    included = sum(1 for v in manifest["videos"] if v["corpus_status"] == "included")
    excluded = sum(1 for v in manifest["videos"] if v["corpus_status"] == "excluded")
    print(f"\nStatus breakdown:")
    print(f"  pending_review: {pending}")
    print(f"  included:       {included}")
    print(f"  excluded:       {excluded}")

    save_manifest(manifest)
    print(f"\nNext: open corpus/corpus_manifest.json and flip corpus_status to 'included'")
    print(f"for each video you want in the corpus. Then run corpus_pipeline.py.")


if __name__ == "__main__":
    main()
