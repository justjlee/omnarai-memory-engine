#!/usr/bin/env python3
"""
Omnarai Corpus Pipeline — Project B

Caption-source transcript pipeline:
  youtube-transcript-api (with cookies) → Claude cleanup → corpus record

Usage:
    # Dry run — all included videos, output to corpus/pipeline_runs/
    python3 scripts/corpus_pipeline.py

    # Dry run — specific videos only (comma-separated IDs)
    python3 scripts/corpus_pipeline.py --video-ids abc123,def456

    # Specify cookies file (defaults to ~/Downloads/www.youtube.com_cookies.txt)
    python3 scripts/corpus_pipeline.py --cookies /path/to/cookies.txt

    # Full run — write records into corpus.json + push to HuggingFace
    # Only run this after xz has reviewed the dry-run output.
    python3 scripts/corpus_pipeline.py --push

Environment variables (loaded from .env.local automatically):
    ANTHROPIC_API_KEY
    HF_TOKEN          (only needed for --push)

Output (dry run):
    corpus/pipeline_runs/YYYY-MM-DD/
        summary.json
        records/
            video_<id>.json
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
MANIFEST_PATH = REPO_ROOT / "corpus" / "corpus_manifest.json"
CORPUS_PATH = REPO_ROOT / "public" / "data" / "corpus.json"
PLAYLIST_ID = "PL7z5YebYrvQwVqo7Zt6CKO3lKaOjy17lV"

DEFAULT_COOKIES_PATH = Path.home() / "Downloads" / "www.youtube.com_cookies.txt"

CLEANUP_MODEL = "claude-opus-4-7"
TAG_MODEL = "claude-haiku-4-5-20251001"
CLEANUP_VERSION = "v1"
TRANSCRIPT_SOURCE = "youtube-auto-caption"

# Delay between YouTube requests to avoid rate limiting
REQUEST_DELAY_SECONDS = 8
# Retry delay if rate limited
RATE_LIMIT_DELAY_SECONDS = 60
MAX_RETRIES = 2

CLEANUP_SYSTEM = """\
You are processing a YouTube auto-generated caption from a Realms of Omnarai video \
narration into corpus-grade prose for the Memory Engine. Follow these rules exactly.

REQUIRED:
- Restore capitalization (YouTube ASR returns all-lowercase for auto-captions)
- Restore proper nouns: Omnarai, Omnai, Vail-3, Ai-On, holdform, xz, Realms, Lattice, \
Linq, Yonotai, Claude, Nia Jai, Thryzai, Keihroth, Bushiso, the Veil, Firelit Commentary, \
discontinuous continuance, sigils, aivideo
- Insert sentence-ending punctuation where absent
- Insert paragraph breaks at narrative shifts
- Fix obvious mis-transcriptions where context makes the intended word clear
- Strip caption artifacts: [Music], [Applause], (Applause), repeated phrases from audio glitches

PRESERVE:
- Original word choice wherever the auto-caption was correct
- Speaker rhythm and voice — do not improve the prose into something more polished than the script
- Intentional fragments, pauses, conversational asides
- Ambiguity where the script was ambiguous — do not over-interpret

FORBIDDEN:
- Adding content not present in the original
- Reordering or restructuring the narrative
- Substituting synonyms for stylistic preference
- Modernizing or correcting intentional Omnarai-specific terminology
- Improving sentence flow beyond fixing transcription errors

OUTPUT: Clean prose only. No headers, no commentary, no metadata.\
"""

TAG_SYSTEM = """\
You suggest thematic tags for Realms of Omnarai corpus entries.
Return a JSON array of 3–7 lowercase hyphenated strings.
Common tags: holdform, lore, synthetic-identity, discontinuous-continuance, \
lattice-glyphs, memory, consciousness, alignment, omnai, vail-3, ai-on, \
the-veil, sigils, fragility-thesis, attributed-corpus, oral-tradition, \
bidirectional-alignment, dialogical-superintelligence, nia-jai, thryzai, \
keihroth, bushiso-blades.
Return ONLY the JSON array, no other text.\
"""

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
# Cookie-authenticated YouTube session
# ---------------------------------------------------------------------------

def build_yt_session(cookies_path):
    """Load YouTube cookies into a requests.Session for youtube-transcript-api."""
    try:
        import requests
    except ImportError:
        print("ERROR: requests not installed. Run: pip3 install requests")
        sys.exit(1)

    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    })

    if cookies_path and Path(cookies_path).exists():
        count = 0
        with open(cookies_path) as f:
            for line in f:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.strip().split("\t")
                if len(parts) >= 7:
                    session.cookies.set(parts[5], parts[6], domain=".youtube.com")
                    count += 1
        print(f"  Loaded {count} YouTube cookies from {cookies_path}")
    else:
        print(f"  WARNING: cookies file not found at {cookies_path} — proceeding without auth")

    return session

# ---------------------------------------------------------------------------
# Transcript fetch
# ---------------------------------------------------------------------------

def fetch_captions(video_id, yt_api):
    """Fetch auto-generated captions for a video. Returns (text, error)."""
    try:
        from youtube_transcript_api import (
            NoTranscriptFound, TranscriptsDisabled, VideoUnavailable
        )
    except ImportError:
        return None, "youtube-transcript-api not installed"

    for attempt in range(MAX_RETRIES + 1):
        try:
            transcript_list = yt_api.list(video_id)
            # Prefer manually-created English, then auto-generated English
            try:
                t = transcript_list.find_manually_created_transcript(["en"])
            except Exception:
                try:
                    t = transcript_list.find_generated_transcript(["en"])
                except Exception:
                    # Fall back to whatever is first
                    t = transcript_list.find_generated_transcript(
                        [tr.language_code for tr in transcript_list]
                    )

            snippets = t.fetch()
            raw = " ".join(s.text for s in snippets if s.text and s.text != "\n")
            raw = " ".join(raw.split())
            return raw, None

        except Exception as e:
            name = type(e).__name__
            msg = str(e)

            if "IpBlocked" in name or "RequestBlocked" in name:
                if attempt < MAX_RETRIES:
                    wait = RATE_LIMIT_DELAY_SECONDS * (attempt + 1)
                    print(f"  ⚠ IP/request blocked, waiting {wait}s before retry...")
                    time.sleep(wait)
                    continue
                return None, f"ip_blocked: {msg[:80]}"

            if "NoTranscriptFound" in name or "TranscriptsDisabled" in name:
                return None, f"no_captions: {msg[:80]}"

            if "VideoUnavailable" in name:
                return None, f"video_unavailable: {msg[:80]}"

            # Unexpected error — don't retry
            return None, f"{name}: {msg[:100]}"

    return None, "max_retries_exceeded"

# ---------------------------------------------------------------------------
# Claude cleanup pass
# ---------------------------------------------------------------------------

def cleanup_transcript(anthropic_client, raw, title):
    msg = anthropic_client.messages.create(
        model=CLEANUP_MODEL,
        max_tokens=4096,
        system=CLEANUP_SYSTEM,
        messages=[{
            "role": "user",
            "content": (
                f'Clean this YouTube auto-caption for video "{title}":\n\n{raw}'
            ),
        }],
    )
    return msg.content[0].text.strip()

# ---------------------------------------------------------------------------
# Tag suggestion
# ---------------------------------------------------------------------------

def suggest_tags(anthropic_client, cleaned, title):
    msg = anthropic_client.messages.create(
        model=TAG_MODEL,
        max_tokens=256,
        system=TAG_SYSTEM,
        messages=[{
            "role": "user",
            "content": f"Title: {title}\n\nTranscript excerpt:\n{cleaned[:1200]}",
        }],
    )
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        tags = json.loads(raw)
        if isinstance(tags, list):
            return [str(t).lower() for t in tags]
    except json.JSONDecodeError:
        pass
    return []

# ---------------------------------------------------------------------------
# Record construction
# ---------------------------------------------------------------------------

def build_record(manifest_entry, raw_caption, cleaned, tags):
    now = datetime.now(timezone.utc).isoformat()
    vid = manifest_entry["video_id"]

    authorship = {
        "script_author": "Omnai",
        "curator": "xz",
        "production": "aivideo.com",
        "narration": "synthetic",
    }
    authorship.update(manifest_entry.get("authorship_overrides", {}))

    manifest_tags = manifest_entry.get("tags") or []
    merged_tags = list(dict.fromkeys(manifest_tags + tags))

    return {
        "id": f"video_{vid}",
        "source_type": "video_transcript",
        "modality": "oral_primary",
        "title": manifest_entry.get("title", ""),
        "title_original": manifest_entry.get("title", ""),
        "content": cleaned,
        "epistemic_mode": manifest_entry.get("epistemic_mode", "Canonical"),
        "tags": merged_tags,

        "video_id": vid,
        "video_url": f"https://www.youtube.com/watch?v={vid}",
        "playlist_id": PLAYLIST_ID,
        "duration_seconds": manifest_entry.get("duration_seconds"),
        "published_at": manifest_entry.get("published_at", ""),

        "authorship": authorship,
        "recovery_status": manifest_entry.get("recovery_status", "uncertain"),

        "transcript": {
            "source": TRANSCRIPT_SOURCE,
            "raw": raw_caption,
            "cleaned": cleaned,
            "cleanup_version": CLEANUP_VERSION,
            "cleanup_date": now,
            "cleanup_notes": manifest_entry.get("cleanup_notes"),
        },

        "corpus_status": "included",
        "exclusion_reason": None,

        "ingested_at": now,
        "last_modified": now,
    }

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_dry_run(records, run_log, run_dir):
    run_dir.mkdir(parents=True, exist_ok=True)
    records_dir = run_dir / "records"
    records_dir.mkdir(exist_ok=True)

    for record in records:
        out_path = records_dir / f"{record['id']}.json"
        with open(out_path, "w") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)

    summary_path = run_dir / "summary.json"
    with open(summary_path, "w") as f:
        json.dump(run_log, f, indent=2, ensure_ascii=False)

    print(f"\nDry-run output: {run_dir}/")
    print(f"  {len(records)} records in records/")
    print(f"  summary.json — pipeline log")
    if records:
        print(f"\nReview the records, then run with --push when ready.")


def push_to_corpus(records):
    with open(CORPUS_PATH) as f:
        corpus = json.load(f)

    existing_ids = {r["id"] for r in corpus}
    added, updated = 0, 0

    for record in records:
        if record["id"] in existing_ids:
            for i, r in enumerate(corpus):
                if r["id"] == record["id"]:
                    record["ingested_at"] = r.get("ingested_at", record["ingested_at"])
                    corpus[i] = record
                    updated += 1
                    break
        else:
            corpus.append(record)
            added += 1

    with open(CORPUS_PATH, "w") as f:
        json.dump(corpus, f, indent=2, ensure_ascii=False)

    src_corpus_path = REPO_ROOT / "src" / "data" / "corpus.json"
    if src_corpus_path.exists():
        with open(src_corpus_path) as f:
            src_corpus = json.load(f)
        src_ids = {r["id"] for r in src_corpus}
        for record in records:
            light = {k: v for k, v in record.items() if k != "transcript"}
            light["transcript"] = {
                k: v for k, v in record["transcript"].items() if k != "raw"
            }
            if record["id"] in src_ids:
                for i, r in enumerate(src_corpus):
                    if r["id"] == record["id"]:
                        src_corpus[i] = light
                        break
            else:
                src_corpus.append(light)
        with open(src_corpus_path, "w") as f:
            json.dump(src_corpus, f, indent=2, ensure_ascii=False)

    print(f"\nCorpus updated: +{added} new, {updated} updated")
    print(f"  {len(corpus)} total entries in public/data/corpus.json")
    print(f"\nNext steps:")
    print(f"  1. node scripts/generate-embeddings.js")
    print(f"  2. vercel --prod")
    print(f"  3. HF_TOKEN=... python3 scripts/push-to-huggingface.py")

    return added, updated


def push_to_huggingface(records):
    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("ERROR: huggingface-hub not installed.")
        return

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: HF_TOKEN not set — skipping HuggingFace push.")
        return

    api = HfApi(token=token)
    repo_id = "TheRealmsOfOmnarai/realms-of-omnarai"

    for record in records:
        fname = f"video_transcripts/{record['id']}.json"
        content = json.dumps(record, indent=2, ensure_ascii=False).encode()
        api.upload_file(
            path_or_fileobj=content,
            path_in_repo=fname,
            repo_id=repo_id,
            repo_type="dataset",
            commit_message=f"Add {record['id']} (auto-caption pipeline v1)",
        )
        print(f"  → pushed {fname}")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Omnarai corpus pipeline (caption-source)")
    parser.add_argument("--video-ids", help="Comma-separated video IDs to process")
    parser.add_argument(
        "--cookies",
        default=str(DEFAULT_COOKIES_PATH),
        help=f"Path to Netscape cookies file (default: {DEFAULT_COOKIES_PATH})",
    )
    parser.add_argument("--push", action="store_true", help="Write to corpus.json + push to HuggingFace")
    args = parser.parse_args()

    load_env_file()

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        print("ERROR: ANTHROPIC_API_KEY not set.")
        sys.exit(1)

    try:
        import anthropic
        anthropic_client = anthropic.Anthropic(api_key=anthropic_key)
    except ImportError:
        print("ERROR: anthropic not installed.")
        sys.exit(1)

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        print("ERROR: youtube-transcript-api not installed. Run: pip3 install youtube-transcript-api")
        sys.exit(1)

    if not MANIFEST_PATH.exists():
        print(f"ERROR: {MANIFEST_PATH} not found. Run scaffold_manifest.py first.")
        sys.exit(1)

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    entries = [v for v in manifest["videos"] if v["corpus_status"] == "included"]
    if args.video_ids:
        target_ids = set(args.video_ids.split(","))
        entries = [v for v in entries if v["video_id"] in target_ids]
        missing = target_ids - {v["video_id"] for v in entries}
        if missing:
            print(f"WARNING: {missing} not found among included manifest entries.")

    if not entries:
        print("No included videos to process.")
        sys.exit(0)

    # Build cookie-authenticated session
    print(f"Building authenticated YouTube session...")
    session = build_yt_session(args.cookies)
    yt_api = YouTubeTranscriptApi(http_client=session)

    print(f"\nPipeline: youtube-transcript-api (cookie-auth) → Claude cleanup")
    print(f"Processing {len(entries)} video(s) with {REQUEST_DELAY_SECONDS}s delay between requests...")
    if not args.push:
        print("DRY RUN — no writes to corpus or HuggingFace.\n")

    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    run_dir = REPO_ROOT / "corpus" / "pipeline_runs" / run_date
    run_log = {
        "run_date": datetime.now(timezone.utc).isoformat(),
        "mode": "push" if args.push else "dry_run",
        "transcript_source": TRANSCRIPT_SOURCE,
        "model_cleanup": CLEANUP_MODEL,
        "model_tags": TAG_MODEL,
        "videos_attempted": len(entries),
        "results": [],
    }

    records = []

    for i, entry in enumerate(entries, 1):
        vid = entry["video_id"]
        title = entry.get("title", vid)
        print(f"[{i}/{len(entries)}] {vid} — {title[:60]}")

        # Rate limiting — skip delay on first video
        if i > 1:
            time.sleep(REQUEST_DELAY_SECONDS)

        raw, err = fetch_captions(vid, yt_api)
        if err:
            print(f"  ✗ {err}")
            run_log["results"].append({"video_id": vid, "status": "failed", "error": err})
            continue

        print(f"  ✓ Captions: {len(raw.split())} words")

        try:
            cleaned = cleanup_transcript(anthropic_client, raw, title)
            print(f"  ✓ Cleaned:  {len(cleaned.split())} words")
        except Exception as e:
            print(f"  ✗ Cleanup failed: {e}")
            run_log["results"].append({"video_id": vid, "status": "cleanup_failed", "error": str(e)})
            continue

        try:
            tags = suggest_tags(anthropic_client, cleaned, title)
            print(f"  ✓ Tags:     {tags}")
        except Exception as e:
            print(f"  ⚠ Tags failed (continuing): {e}")
            tags = []

        record = build_record(entry, raw, cleaned, tags)
        records.append(record)
        run_log["results"].append({
            "video_id": vid,
            "status": "ok",
            "word_count_raw": len(raw.split()),
            "word_count_cleaned": len(cleaned.split()),
            "tags": tags,
        })

    run_log["videos_succeeded"] = len(records)
    run_log["videos_failed"] = len(entries) - len(records)

    if not records:
        print("\nNo records produced.")
        write_dry_run([], run_log, run_dir)
        sys.exit(1)

    if args.push:
        push_to_corpus(records)
        push_to_huggingface(records)
        write_dry_run(records, run_log, run_dir)
    else:
        write_dry_run(records, run_log, run_dir)

    print(f"\nDone. {len(records)}/{len(entries)} succeeded.")


if __name__ == "__main__":
    main()
