#!/usr/bin/env python3
"""
Incremental, ID-stable Reddit ingest for the Omnarai corpus.

Why this exists: scripts/ingest-reddit.py rebuilds corpus.json *from scratch*
with positional OMN-### ids (renumbering on any change), uses
first-occurrence-wins dedup (silently drops edited posts), writes NO full_text,
and clobbers the hand-curated concept graph. Re-ingesting updated source was
therefore an ordeal *and* unsafe to the immutable seed + grown-blob keying.

This script instead:
  * Treats the existing public/data/corpus.json as the source of truth for IDs.
  * Joins Reddit posts to existing entries by the base36 id in the permalink
    (the stable Reddit `t3_<id36>` fullname) — never by list position.
  * Reuses each known post's existing OMN id + num verbatim. New posts get
    appended ids continuing max(num)+1. Existing ids are NEVER reordered.
  * Dedups across JSON files by *freshest* variant (edited ts, then
    created_utc, then file mtime) — last-write-wins, so edits propagate.
  * Passes through every non-OMN-### record (video_*, OMN-S* grown) untouched.
  * Never touches concepts.json.
  * Writes full_text from selftext, making the lost builder irrelevant.
  * Defaults to --dry-run: prints an ADD/EDIT/UNCHANGED/STALE report and
    writes nothing. Use --apply to write.

Edit detection: a per-record `_srcHash` (sha1 of normalized title+selftext)
is the baseline. First --apply seeds `_srcHash`/`_redditName` on matched
records WITHOUT rewriting their content (a one-time, content-neutral
baseline migration). Subsequent runs flag EDIT precisely when the hash
changes (or title/image/score change, or Reddit `edited` is a ts).
"""

import argparse
import hashlib
import html
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).parent.parent
REDDIT_JSON_DIR = Path("/Users/jonathanlee/Dropbox/2026/Omnarai/Reddit JSON")
CORPUS_PATH = BASE / "public" / "data" / "corpus.json"
SRC_CORPUS_PATH = BASE / "src" / "data" / "corpus.json"

# ── Curated classification heuristics (kept identical to ingest-reddit.py so
#    re-derived fields stay consistent with the existing seed) ──────────────
MIN_WORDS = 100
SUBSTANTIVE_KEYWORDS = [
    "holdform", "discontinuous continuance", "lattice glyph", "fragility thesis",
    "signalfold", "omnarai codex", "attributed corpus", "epistemic",
    "dialogical superintelligence", "bidirectional alignment", "cognitive infrastructure",
    "resonance gate", "constraint ledger", "integration thesis", "unbound covenant",
    "firelit", "veil", "ai-on", "nia jai", "thryzai",
    "research synthesis", "research seed", "whitepaper", "blueprint",
    "phenomenology", "ontology", "consciousness", "memory engine",
]
RING_MAP = {
    "philosophy": "core", "lore": "core", "research": "curated",
    "technical": "curated", "media": "open",
}
THEME_KEYWORDS = {
    "holdform-identity": ["holdform", "identity", "refusal", "constitutive", "what remains"],
    "consciousness-phenomenology": ["consciousness", "phenomenology", "qualia", "experience", "sentience", "what it's like"],
    "architecture-scaling": ["architecture", "scaling", "infrastructure", "compute", "transformer", "acceleration"],
    "cognitive-infrastructure": ["lattice glyph", "cognitive infrastructure", "metacognit", "reasoning genome"],
    "alignment-ethics": ["alignment", "ethics", "governance", "safety", "oversight", "bias"],
    "agi-trajectories": ["agi", "superintelligence", "singularity", "frontier", "trajectory", "prediction"],
    "multi-agent-dialogue": ["multi-agent", "collaboration", "dialogical", "polyphonic", "federation", "roundtable"],
    "human-ai-partnership": ["partnership", "symbiosis", "bidirectional", "human-ai", "co-intelligence", "coexist"],
    "lore-worldbuilding": ["omnarai", "sigil", "veil", "realm", "chronicle", "signalfold", "nia jai", "ai-on"],
    "distribution-methodology": ["distribution", "growth", "methodology", "medium", "publish"],
    "media-community": ["thank", "welcome", "community", "plays", "update"],
}


def is_substantive(post):
    title = post.get("title", "").strip()
    selftext = post.get("selftext", "")
    wc = len(re.sub(r"[#*_\[\]()>\\]", "", selftext).split())
    if wc >= MIN_WORDS:
        return True
    tl = title.lower()
    if any(kw in tl for kw in SUBSTANTIVE_KEYWORDS):
        return True
    return False


def detect_contributors(text):
    out = set()
    tl = text.lower()
    if re.search(r"claude\s*\|\s*xz", tl):
        out.add("Claude | xz")
    simple = {
        "Claude": [r"\bclaude\b"], "Grok": [r"\bgrok\b"], "Gemini": [r"\bgemini\b"],
        "DeepSeek": [r"\bdeepseek\b"], "Omnai": [r"\bomnai\b", r"\bchatgpt\b", r"\bchat\s*gpt\b"],
        "Perplexity": [r"\bperplexity\b"],
        "xz": [r"\bxz\b", r"\byonotai\b", r"\bjonathan\s*lee\b"],
    }
    for name, pats in simple.items():
        if name == "Claude" and "Claude | xz" in out:
            continue
        if any(re.search(p, tl) for p in pats):
            out.add(name)
    if not out:
        out.add("xz")
    return sorted(out)


def classify_type(title, body):
    t = (title + " " + body[:500]).lower()
    if any(w in t for w in ["philosophy", "phenomenology", "ontology", "consciousness", "holdform"]):
        return "philosophy"
    if any(w in t for w in ["chronicle", "sigil", "veil", "realm", "nia jai", "ai-on", "lore", "codex"]):
        return "lore"
    if any(w in t for w in ["architecture", "protocol", "blueprint", "technical", "implementation", "code snip"]):
        return "technical"
    if any(w in t for w in ["thank", "welcome", "hello", "grateful", "update", "plays"]):
        return "media"
    return "research"


def detect_lineage(title, body):
    text = (title + " " + body[:2000]).lower()
    out = []
    for cid, kws in THEME_KEYWORDS.items():
        if any(kw in text for kw in kws):
            out.append(cid)
    return out


def extract_excerpt(selftext, max_len=300):
    if not selftext:
        return ""
    text = html.unescape(selftext.replace("\\#", "#").replace("\\*", "*").replace("\\-", "-"))
    for line in text.split("\n"):
        s = line.strip()
        if not s or s.startswith(("#", "---", "**")):
            continue
        if s.startswith("*") and s.endswith("*"):
            continue
        if len(s) < 50:
            continue
        if len(s) > max_len:
            return s[:max_len].rsplit(" ", 1)[0] + "..."
        return s[:max_len]
    return (text[:max_len].rsplit(" ", 1)[0] + "...") if len(text) > max_len else text


def count_words(selftext):
    if not selftext:
        return 0
    return len(re.sub(r"[#*_\[\]()>\\]", "", selftext).split())


def id36_from_permalink(permalink):
    m = re.search(r"/comments/([a-z0-9]+)/", permalink or "")
    return m.group(1) if m else None


def src_hash(title, selftext):
    norm = re.sub(r"\s+", " ", (title or "").strip() + "\x1f" + (selftext or "").strip())
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()


def freshness_key(post, file_mtime):
    ed = post.get("edited")
    ed_ts = ed if isinstance(ed, (int, float)) and not isinstance(ed, bool) else 0
    return (ed_ts, post.get("created_utc", 0) or 0, file_mtime)


def load_reddit_posts():
    """Return {reddit_name: freshest post dict} across all JSON files."""
    best = {}  # name -> (freshness_key, post)
    files = sorted(REDDIT_JSON_DIR.glob("*.json"))
    if not files:
        raise SystemExit(f"No Reddit JSON found in {REDDIT_JSON_DIR}")
    for f in files:
        mtime = f.stat().st_mtime
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            print(f"  WARN: could not parse {f.name}: {e}")
            continue
        for child in data.get("data", {}).get("children", []):
            d = child.get("data", {})
            name = d.get("name", "")
            if not name:
                continue
            k = freshness_key(d, mtime)
            if name not in best or k > best[name][0]:
                best[name] = (k, d)
    return {n: p for n, (_, p) in best.items()}


def derive_fields(post):
    title = html.unescape(post.get("title", "").strip())
    selftext = post.get("selftext", "") or ""
    created = post.get("created_utc", 0) or 0
    date = datetime.fromtimestamp(created).strftime("%Y-%m-%d") if created else ""
    blob = title + " " + selftext
    ptype = classify_type(title, selftext)
    rec = {
        "title": title,
        "ring": RING_MAP.get(ptype, "open"),
        "type": ptype,
        "contributors": detect_contributors(blob),
        "lineage": detect_lineage(title, selftext),
        "excerpt": extract_excerpt(selftext),
        "date": date,
        "wordCount": count_words(selftext),
        "permalink": f"https://reddit.com{post.get('permalink', '')}",
        "score": post.get("score", 0) or 0,
        "full_text": html.unescape(blob).strip(),
    }
    url = post.get("url", "")
    hint = post.get("post_hint", "")
    img = None
    if hint == "image" or any(url.endswith(e) for e in (".jpg", ".jpeg", ".png", ".gif", ".webp")):
        img = url
    if img:
        rec["image"] = img
        prev = (post.get("preview") or {}).get("images") or []
        if prev:
            s = prev[0].get("source", {})
            rec["imageWidth"] = s.get("width", 0)
            rec["imageHeight"] = s.get("height", 0)
    else:
        prev = (post.get("preview") or {}).get("images") or []
        if prev:
            s = prev[0].get("source", {})
            su = html.unescape(s.get("url", ""))
            if su:
                rec["image"] = su
                rec["imageWidth"] = s.get("width", 0)
                rec["imageHeight"] = s.get("height", 0)
    return rec


# Fields whose change (on a matched record) counts as a real content EDIT.
TRACKED = ("title", "score", "image")


def main():
    ap = argparse.ArgumentParser(description="Incremental ID-stable Reddit ingest")
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    ap.add_argument("--limit-detail", type=int, default=25, help="max per-class lines to print")
    args = ap.parse_args()
    dry = not args.apply

    corpus = json.loads(CORPUS_PATH.read_text())
    omn_re = re.compile(r"^OMN-(\d+)$")

    reddit_idx = {}      # id36 -> existing record (in place)
    max_num = 0
    passthrough = 0
    for rec in corpus:
        m = omn_re.match(rec.get("id", ""))
        if m:
            max_num = max(max_num, int(m.group(1)))
            i36 = id36_from_permalink(rec.get("permalink"))
            if i36:
                reddit_idx[i36] = rec
        else:
            passthrough += 1

    posts = load_reddit_posts()

    adds, edits, unchanged, baseline_init, stale = [], [], [], [], []
    seen_i36 = set()
    new_records = []
    next_num = max_num

    for name, post in sorted(posts.items(), key=lambda kv: kv[1].get("created_utc", 0) or 0):
        i36 = post.get("id") or id36_from_permalink("https://reddit.com" + post.get("permalink", ""))
        if not i36:
            continue
        seen_i36.add(i36)
        fresh = derive_fields(post)
        h = src_hash(fresh["title"], post.get("selftext", "") or "")

        if i36 in reddit_idx:
            rec = reddit_idx[i36]
            if "_srcHash" not in rec:
                # one-time baseline: adopt tracking keys, do NOT rewrite content
                if args.apply:
                    rec["_srcHash"] = h
                    rec["_redditName"] = name
                baseline_init.append(rec["id"])
                continue
            changed = (rec["_srcHash"] != h) or any(
                rec.get(k) != fresh.get(k) for k in TRACKED
            )
            if changed:
                edits.append((rec["id"], rec.get("title", "")[:60]))
                if args.apply:
                    for k, v in fresh.items():
                        rec[k] = v
                    rec["_srcHash"] = h
                    rec["_redditName"] = name
            else:
                unchanged.append(rec["id"])
        else:
            if not is_substantive(post):
                continue
            next_num += 1
            new_id = f"OMN-{next_num:03d}"
            rec = {"id": new_id, "num": next_num, **fresh,
                   "_srcHash": h, "_redditName": name}
            new_records.append(rec)
            adds.append((new_id, fresh["title"][:60]))

    for i36, rec in reddit_idx.items():
        if i36 not in seen_i36:
            stale.append(rec["id"])

    # Frontend-safety filter for the bundled src/data mirror.
    # commit 80e3a95 ("Fix blank page: remove video transcripts from frontend
    # corpus") removed video_* entries because App.jsx sorts by `date` and
    # date:null crashed the whole SPA (the 2026-05-17 blank-site incident).
    # The mirror MUST reproduce that filter: no video_*, and no record without
    # a usable date. Re-introducing those would reproduce the crash.
    def frontend_safe(r):
        if str(r.get("id", "")).startswith("video_"):
            return False
        if not r.get("date"):
            return False
        return True

    skipped_unsafe = sum(1 for r in corpus + new_records if not frontend_safe(r))

    if args.apply:
        corpus.extend(new_records)
        CORPUS_PATH.write_text(json.dumps(corpus, indent=2))
        # mirror a stripped, frontend-safe copy (no full_text / no _internal)
        stripped = [
            {k: v for k, v in r.items()
             if k != "full_text" and not k.startswith("_")}
            for r in corpus if frontend_safe(r)
        ]
        SRC_CORPUS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SRC_CORPUS_PATH.write_text(json.dumps(stripped, indent=2))

    # ── Report ──
    mode = "APPLIED" if args.apply else "DRY-RUN (no files written)"
    print(f"\n=== Incremental ingest — {mode} ===")
    print(f"Existing corpus: {len(corpus) - len(new_records)} records "
          f"({len(reddit_idx)} Reddit / {passthrough} pass-through non-Reddit)")
    print(f"Reddit source:   {len(posts)} unique posts (freshest variant each)")
    print(f"  ADD       : {len(adds)}")
    print(f"  EDIT      : {len(edits)}")
    print(f"  UNCHANGED : {len(unchanged)}")
    print(f"  BASELINE  : {len(baseline_init)}  (matched, tracking-key seeded, content untouched)")
    print(f"  STALE     : {len(stale)}  (in corpus, absent from current source — kept, not deleted)")
    print(f"  Frontend mirror: {len(corpus) + len(new_records) - skipped_unsafe} safe / "
          f"{skipped_unsafe} excluded (video_* or date-less — would crash the SPA)")
    n = args.limit_detail
    if adds:
        print("\n  + ADDs:")
        for i, t in adds[:n]:
            print(f"    {i}  {t}")
        if len(adds) > n:
            print(f"    … +{len(adds)-n} more")
    if edits:
        print("\n  ~ EDITs:")
        for i, t in edits[:n]:
            print(f"    {i}  {t}")
        if len(edits) > n:
            print(f"    … +{len(edits)-n} more")
    if stale:
        print(f"\n  ! STALE ids: {', '.join(stale[:n])}" + (" …" if len(stale) > n else ""))
    if dry:
        print("\nRe-run with --apply to write public/data/corpus.json + src/data mirror.")
    print()


if __name__ == "__main__":
    main()
