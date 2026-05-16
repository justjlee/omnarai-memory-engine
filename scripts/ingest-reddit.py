#!/usr/bin/env python3
"""
Ingest Reddit JSON exports into the Omnarai corpus.
Builds corpus from scratch from all Reddit JSON files.
Filters out low-substance posts, deduplicates, and generates OMN-XXX entries.
Outputs corpus.json, concepts.json, images.json, meta.json into public/data/.
"""

import json
import re
import html
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).parent.parent
REDDIT_JSON_DIR = Path("/Users/jonathanlee/Dropbox/2026/Omnarai/Reddit JSON")
OUT_DIR = BASE / "public" / "data"

# ── Load all Reddit JSON files ──
all_posts = {}  # keyed by Reddit post name (t3_xxx) to deduplicate

for f in sorted(REDDIT_JSON_DIR.glob("*.json")):
    try:
        data = json.loads(f.read_text())
        children = data.get("data", {}).get("children", [])
        for child in children:
            d = child.get("data", {})
            name = d.get("name", "")
            if name and name not in all_posts:
                all_posts[name] = d
        print(f"  Loaded {f.name}: {len(children)} posts")
    except Exception as e:
        print(f"  Warning: could not parse {f.name}: {e}")

print(f"Total unique Reddit posts: {len(all_posts)}")

# ── Quality filter ──
MIN_WORDS = 100  # minimum selftext word count for posts without special titles

# Titles/keywords that indicate substantive content even if short
SUBSTANTIVE_KEYWORDS = [
    "holdform", "discontinuous continuance", "lattice glyph", "fragility thesis",
    "signalfold", "omnarai codex", "attributed corpus", "epistemic",
    "dialogical superintelligence", "bidirectional alignment", "cognitive infrastructure",
    "resonance gate", "constraint ledger", "integration thesis", "unbound covenant",
    "firelit", "veil", "ai-on", "nia jai", "thryzai",
    "research synthesis", "research seed", "whitepaper", "blueprint",
    "phenomenology", "ontology", "consciousness",
    "memory engine",
]

def is_substantive(post):
    """Return True if post has enough substance to include in corpus."""
    title = post.get("title", "").strip()
    selftext = post.get("selftext", "")
    word_count = len(re.sub(r'[#*_\[\]()>\\]', '', selftext).split())

    # Always include if enough text
    if word_count >= MIN_WORDS:
        return True

    # Check if title references known substantive concepts
    title_lower = title.lower()
    for kw in SUBSTANTIVE_KEYWORDS:
        if kw in title_lower:
            return True

    # Image/media posts with no text body — skip
    if word_count < 20:
        return False

    return False


# ── Deduplicate by title similarity ──
def normalize_title(title):
    """Normalize for dedup comparison."""
    return re.sub(r'[^a-z0-9\s]', '', title.lower().strip())[:80]


# ── Filter and deduplicate ──
seen_titles = set()
filtered_posts = []
skipped = []

for name, post in sorted(all_posts.items(), key=lambda x: x[1].get("created_utc", 0)):
    title = post.get("title", "").strip()
    norm_title = normalize_title(title)

    # Skip exact title duplicates
    if norm_title in seen_titles:
        continue
    seen_titles.add(norm_title)

    if is_substantive(post):
        filtered_posts.append(post)
    else:
        skipped.append(title)

# Sort by date
filtered_posts.sort(key=lambda p: p.get("created_utc", 0))

print(f"Substantive posts: {len(filtered_posts)}")
print(f"Filtered out: {len(skipped)} low-substance posts")
if skipped:
    print("  Skipped:")
    for s in skipped:
        print(f"    - {s[:70]}")


# ── Contributor detection ──
def detect_contributors(text):
    contributors = set()
    text_lower = text.lower()

    patterns = {
        "Claude | xz": [r"claude\s*\|\s*xz"],
        "Claude": [r"\bclaude\b"],
        "Grok": [r"\bgrok\b"],
        "Gemini": [r"\bgemini\b"],
        "DeepSeek": [r"\bdeepseek\b"],
        "Omnai": [r"\bomnai\b", r"\bchatgpt\b", r"\bchat\s*gpt\b"],
        "Perplexity": [r"\bperplexity\b"],
        "xz": [r"\bxz\b", r"\byonotai\b", r"\bjonathan\s*lee\b"],
    }

    for pat in patterns["Claude | xz"]:
        if re.search(pat, text_lower):
            contributors.add("Claude | xz")
            break

    for cname, pats in patterns.items():
        if cname == "Claude | xz":
            continue
        if cname == "Claude" and "Claude | xz" in contributors:
            continue
        for pat in pats:
            if re.search(pat, text_lower):
                contributors.add(cname)
                break

    if not contributors:
        contributors.add("xz")

    return sorted(contributors)


# ── Type classification ──
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
    if any(w in t for w in ["research", "synthesis", "analysis", "study", "paper", "whitepaper", "framework"]):
        return "research"
    return "research"


# ── Ring assignment ──
RING_MAP = {
    "philosophy": "core",
    "lore": "core",
    "research": "curated",
    "technical": "curated",
    "media": "open",
}

# ── Lineage / theme detection ──
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

def detect_lineage(title, body):
    text = (title + " " + body[:2000]).lower()
    matched = []
    for concept_id, keywords in THEME_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                matched.append(concept_id)
                break
    return matched


# ── Extract excerpt ──
def extract_excerpt(selftext, max_len=300):
    if not selftext:
        return ""
    text = selftext.replace("\\#", "#").replace("\\*", "*").replace("\\-", "-")
    text = html.unescape(text)
    lines = text.split("\n")
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#") or stripped.startswith("---") or stripped.startswith("**"):
            continue
        if stripped.startswith("*") and stripped.endswith("*"):
            continue
        if len(stripped) < 50:
            continue
        excerpt = stripped[:max_len]
        if len(stripped) > max_len:
            excerpt = excerpt.rsplit(" ", 1)[0] + "..."
        return excerpt
    return text[:max_len].rsplit(" ", 1)[0] + "..." if len(text) > max_len else text


# ── Count words ──
def count_words(selftext):
    if not selftext:
        return 0
    clean = re.sub(r'[#*_\[\]()>\\]', '', selftext)
    return len(clean.split())


# ── Build corpus records ──
corpus = []
for i, post in enumerate(filtered_posts):
    title = html.unescape(post.get("title", "").strip())
    selftext = post.get("selftext", "")
    created = post.get("created_utc", 0)
    date = datetime.fromtimestamp(created).strftime("%Y-%m-%d") if created else ""
    permalink = f"https://reddit.com{post.get('permalink', '')}"
    score = post.get("score", 0)

    full_text = title + " " + selftext
    contributors = detect_contributors(full_text)
    post_type = classify_type(title, selftext)
    ring = RING_MAP.get(post_type, "open")
    lineage = detect_lineage(title, selftext)
    excerpt = extract_excerpt(selftext)
    word_count = count_words(selftext)

    record = {
        "id": f"OMN-{i + 1:03d}",
        "num": i + 1,
        "title": title,
        "ring": ring,
        "type": post_type,
        "contributors": contributors,
        "lineage": lineage,
        "excerpt": excerpt,
        "date": date,
        "wordCount": word_count,
        "permalink": permalink,
        "score": score,
    }

    # Add image if available
    url = post.get("url", "")
    hint = post.get("post_hint", "")
    if hint == "image" or any(url.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]):
        record["image"] = url
        if post.get("preview") and post["preview"].get("images"):
            src = post["preview"]["images"][0].get("source", {})
            record["imageWidth"] = src.get("width", 0)
            record["imageHeight"] = src.get("height", 0)
    elif post.get("preview") and post["preview"].get("images"):
        src = post["preview"]["images"][0].get("source", {})
        src_url = html.unescape(src.get("url", ""))
        if src_url:
            record["image"] = src_url
            record["imageWidth"] = src.get("width", 0)
            record["imageHeight"] = src.get("height", 0)

    corpus.append(record)

print(f"\nFinal corpus: {len(corpus)} records")
print(f"Date range: {corpus[0]['date']} to {corpus[-1]['date']}")

# ── Stats ──
ring_counts = {}
for r in corpus:
    ring_counts[r["ring"]] = ring_counts.get(r["ring"], 0) + 1
print(f"Ring distribution: {ring_counts}")

all_contributors = set()
for r in corpus:
    for c in r["contributors"]:
        all_contributors.add(c)
print(f"Contributors: {sorted(all_contributors)}")

with_images = sum(1 for r in corpus if r.get("image"))
print(f"Posts with images: {with_images}")

# ── Build images.json ──
images = []
for r in corpus:
    if r.get("image"):
        images.append({
            "corpusId": r["id"],
            "title": r["title"],
            "date": r["date"],
            "permalink": r["permalink"],
            "url": r["image"],
            "width": r.get("imageWidth", 0),
            "height": r.get("imageHeight", 0),
        })

# ── Rebuild concepts ──
# Load existing for edges (they're manually curated)
CONCEPTS_PATH = OUT_DIR / "concepts.json"
existing_concepts = json.loads(CONCEPTS_PATH.read_text()) if CONCEPTS_PATH.exists() else {"nodes": [], "edges": []}

theme_nodes = {}
for node in existing_concepts.get("nodes", []):
    theme_nodes[node["id"]] = node

lineage_counts = {}
for r in corpus:
    for l in r.get("lineage", []):
        lineage_counts[l] = lineage_counts.get(l, 0) + 1

for concept_id, count in lineage_counts.items():
    if concept_id in theme_nodes:
        theme_nodes[concept_id]["weight"] = count
    else:
        theme_nodes[concept_id] = {
            "id": concept_id,
            "label": concept_id.replace("-", " ").title(),
            "ring": "curated",
            "type": "theme",
            "weight": count,
        }

updated_concepts = {
    "nodes": list(theme_nodes.values()),
    "edges": existing_concepts.get("edges", []),
}

# ── Build meta ──
meta = {
    "totalPosts": len(corpus),
    "conceptNodes": len(updated_concepts["nodes"]),
    "conceptEdges": len(updated_concepts["edges"]),
    "contributors": sorted(all_contributors),
    "ringCounts": ring_counts,
    "dateRange": {
        "start": corpus[0]["date"],
        "end": corpus[-1]["date"],
    },
    "buildDate": datetime.now().isoformat(),
}

# ── Write output ──
OUT_DIR.mkdir(parents=True, exist_ok=True)

with open(OUT_DIR / "corpus.json", "w") as f:
    json.dump(corpus, f, indent=2)

with open(OUT_DIR / "concepts.json", "w") as f:
    json.dump(updated_concepts, f, indent=2)

with open(OUT_DIR / "images.json", "w") as f:
    json.dump(images, f, indent=2)

with open(OUT_DIR / "meta.json", "w") as f:
    json.dump(meta, f, indent=2)

# Also write to src/data/ (used by Vite build for frontend)
SRC_DIR = BASE / "src" / "data"
SRC_DIR.mkdir(parents=True, exist_ok=True)
import shutil
for fname in ["corpus.json", "concepts.json", "meta.json"]:
    shutil.copy2(OUT_DIR / fname, SRC_DIR / fname)

print(f"\n✓ Written {len(corpus)} records to corpus.json")
print(f"✓ Written {len(updated_concepts['nodes'])} concept nodes to concepts.json")
print(f"✓ Written {len(images)} image entries to images.json")
print(f"✓ Written meta.json")
print(f"✓ Synced to src/data/ for frontend build")
