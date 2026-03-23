#!/usr/bin/env python3
"""
Build static JSON data files from the Omnarai corpus for the Memory Engine.
Reads markdown corpus files, glossary, themes, index, and Reddit JSON.
Outputs corpus.json, concepts.json, meta.json into src/data/.
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path

# Paths
BASE = Path(__file__).parent.parent
CORPUS_DIR = BASE.parent / "realms-of-omnarai" / "corpus"
INDEX_MD = BASE.parent / "realms-of-omnarai" / "index.md"
GLOSSARY_MD = BASE.parent / "realms-of-omnarai" / "glossary.md"
THEMES_MD = BASE.parent / "realms-of-omnarai" / "themes.md"
REDDIT_JSON_DIR = Path("/Users/jonathanlee/Dropbox/2026/Omnarai/Reddit JSON")
OUT_DIR = BASE / "src" / "data"

# ── Parse index.md for metadata ──
def parse_index():
    """Parse the markdown table in index.md"""
    records = {}
    text = INDEX_MD.read_text()
    for line in text.split("\n"):
        line = line.strip()
        if not line.startswith("|") or line.startswith("| #") or line.startswith("|---"):
            continue
        parts = [p.strip() for p in line.split("|")]
        parts = [p for p in parts if p]  # remove empty from leading/trailing |
        if len(parts) < 6:
            continue
        try:
            num = int(parts[0])
        except ValueError:
            continue
        records[num] = {
            "num": num,
            "date": parts[1],
            "title": parts[2].rstrip(" ,"),
            "type": parts[3],
            "words": int(parts[4]) if parts[4].isdigit() else 0,
            "summary": parts[5] if len(parts) > 5 else "",
        }
    return records

# ── Parse themes.md ──
def parse_themes():
    """Returns {theme_name: [list of post titles]}"""
    themes = {}
    text = THEMES_MD.read_text()
    current_theme = None
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("## "):
            current_theme = line[3:].strip()
            themes[current_theme] = []
        elif line.startswith("- ") and current_theme:
            title = line[2:].strip()
            themes[current_theme].append(title)
    return themes

# ── Parse glossary.md ──
def parse_glossary():
    """Returns list of {term, definition, category}"""
    terms = []
    text = GLOSSARY_MD.read_text()
    current_category = None
    current_term = None
    current_def = []

    def flush():
        if current_term:
            terms.append({
                "term": current_term,
                "definition": " ".join(current_def).strip(),
                "category": current_category or "Uncategorized",
            })

    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("## "):
            flush()
            current_term = None
            current_def = []
            current_category = stripped[3:].strip()
        elif stripped.startswith("**") and stripped.endswith("**"):
            flush()
            current_term = stripped.strip("*").strip()
            current_def = []
        elif current_term and stripped:
            current_def.append(stripped)
    flush()
    return terms

# ── Parse Reddit JSON for URLs and scores ──
def parse_reddit_json():
    """Returns {title_lower: {permalink, score, url, created_utc}}"""
    posts = {}
    for f in REDDIT_JSON_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            children = data.get("data", {}).get("children", [])
            for child in children:
                d = child.get("data", {})
                title = d.get("title", "").strip()
                posts[title.lower()] = {
                    "permalink": f"https://reddit.com{d.get('permalink', '')}",
                    "score": d.get("score", 0),
                    "url": d.get("url", ""),
                    "created_utc": d.get("created_utc", 0),
                }
        except Exception as e:
            print(f"Warning: could not parse {f}: {e}")
    return posts

# ── Read corpus markdown files ──
def read_corpus_files():
    """Returns list of {filename, title, date, body, excerpt}"""
    files = []
    for f in sorted(CORPUS_DIR.glob("*.md")):
        text = f.read_text()
        lines = text.split("\n")

        # Title from first H1
        title = ""
        for line in lines:
            if line.startswith("# "):
                title = line[2:].strip()
                break

        # Date from frontmatter
        date = ""
        date_match = re.search(r"\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})", text)
        if date_match:
            date = date_match.group(1)
        else:
            # Try from filename
            fname_match = re.match(r"(\d{4}-\d{2}-\d{2})", f.name)
            if fname_match:
                date = fname_match.group(1)

        # Body (skip title and date lines)
        body = text

        # Extract first substantive paragraph as excerpt
        excerpt = ""
        in_body = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("---"):
                in_body = True
                continue
            if in_body and stripped and not stripped.startswith("**") and not stripped.startswith("#") and not stripped.startswith("*"):
                # Skip very short lines
                if len(stripped) > 50:
                    excerpt = stripped[:300]
                    if len(stripped) > 300:
                        excerpt = excerpt.rsplit(" ", 1)[0] + "..."
                    break

        files.append({
            "filename": f.name,
            "title": title,
            "date": date,
            "body": body,
            "excerpt": excerpt,
        })
    return files

# ── Detect contributors from body text ──
def detect_contributors(body):
    contributors = set()
    body_lower = body.lower()

    patterns = {
        "Claude | xz": [r"claude\s*\|\s*xz", r"claude \| xz"],
        "Claude": [r"\bclaude\b"],
        "Grok": [r"\bgrok\b"],
        "Gemini": [r"\bgemini\b"],
        "DeepSeek": [r"\bdeepseek\b"],
        "Omnai": [r"\bomnai\b", r"\bchatgpt\b"],
        "Perplexity": [r"\bperplexity\b"],
        "xz": [r"\bxz\b", r"\byonotai\b", r"\bjonathan lee\b"],
    }

    # Check for Claude | xz first
    for pattern in patterns["Claude | xz"]:
        if re.search(pattern, body_lower):
            contributors.add("Claude | xz")
            break

    for name, pats in patterns.items():
        if name == "Claude | xz":
            continue
        if name == "Claude" and "Claude | xz" in contributors:
            continue  # Don't double-count
        for pat in pats:
            if re.search(pat, body_lower):
                contributors.add(name)
                break

    if not contributors:
        contributors.add("xz")

    return sorted(contributors)

# ── Map title to themes ──
def map_title_to_themes(title, themes_data):
    """Find which theme clusters a title belongs to"""
    matched = []
    title_lower = title.lower().strip()
    for theme, titles in themes_data.items():
        for t in titles:
            if t.lower().strip() == title_lower or title_lower.startswith(t.lower().strip()[:40]):
                matched.append(theme)
                break
    return matched

# ── Assign epistemic ring ──
RING_MAP = {
    "philosophy": "core",
    "lore": "core",
    "research": "curated",
    "technical": "curated",
    "media": "open",
}

def assign_ring(post_type):
    return RING_MAP.get(post_type, "open")

# ── Theme to concept ID ──
THEME_TO_CONCEPT = {
    "Holdform, Identity & Constitutive Refusal": "holdform-identity",
    "Consciousness & Phenomenology": "consciousness-phenomenology",
    "Architecture, Scaling & Technical Infrastructure": "architecture-scaling",
    "Cognitive Infrastructure & Lattice Glyphs": "cognitive-infrastructure",
    "Alignment, Ethics & Governance": "alignment-ethics",
    "AGI Trajectories & Research Synthesis": "agi-trajectories",
    "Multi-Agent Collaboration & Dialogical Intelligence": "multi-agent-dialogue",
    "Human-AI Partnership & Symbiosis": "human-ai-partnership",
    "Lore, Worldbuilding & Cosmic Linguistics": "lore-worldbuilding",
    "Distribution, Growth & Methodology": "distribution-methodology",
    "Media & Community": "media-community",
}

# ── Glossary category to ring ──
GLOSSARY_RING = {
    "Core Philosophical Concepts": "core",
    "Cognitive Architecture and Infrastructure": "curated",
    "Alignment and Ethics": "curated",
    "Intelligence Frameworks": "curated",
    "Lore and Worldbuilding": "core",
    "Formats and Practices": "open",
    "People and Identities": "open",
    "Recurring Theoretical References": "curated",
}

# ══════════════════════════════════════════
# MAIN BUILD
# ══════════════════════════════════════════

def main():
    print("Building Omnarai Memory Engine data...")

    index_data = parse_index()
    themes_data = parse_themes()
    glossary_terms = parse_glossary()
    reddit_data = parse_reddit_json()
    corpus_files = read_corpus_files()

    print(f"  Index entries: {len(index_data)}")
    print(f"  Theme clusters: {len(themes_data)}")
    print(f"  Glossary terms: {len(glossary_terms)}")
    print(f"  Reddit posts: {len(reddit_data)}")
    print(f"  Corpus files: {len(corpus_files)}")

    # ── Build corpus records ──
    corpus = []
    for i, idx_entry in sorted(index_data.items()):
        # Find matching corpus file
        file_match = None
        for cf in corpus_files:
            if cf["title"].lower().startswith(idx_entry["title"].lower()[:40]):
                file_match = cf
                break

        # Find Reddit data
        reddit_match = reddit_data.get(idx_entry["title"].lower())
        if not reddit_match:
            # Try partial match
            for rkey, rval in reddit_data.items():
                if idx_entry["title"].lower()[:40] in rkey:
                    reddit_match = rval
                    break

        # Get themes for this post
        post_themes = map_title_to_themes(idx_entry["title"], themes_data)
        lineage = [THEME_TO_CONCEPT[t] for t in post_themes if t in THEME_TO_CONCEPT]

        # Contributors
        contributors = detect_contributors(file_match["body"] if file_match else idx_entry["title"])

        # Excerpt
        excerpt = idx_entry["summary"]
        if not excerpt or excerpt.startswith("("):
            if file_match and file_match["excerpt"]:
                excerpt = file_match["excerpt"]

        record = {
            "id": f"OMN-{i:03d}",
            "num": i,
            "title": idx_entry["title"],
            "ring": assign_ring(idx_entry["type"]),
            "type": idx_entry["type"],
            "contributors": contributors,
            "lineage": lineage,
            "excerpt": excerpt,
            "date": idx_entry["date"],
            "wordCount": idx_entry["words"],
            "permalink": reddit_match["permalink"] if reddit_match else "",
            "score": reddit_match["score"] if reddit_match else 0,
        }
        corpus.append(record)

    # ── Build concept nodes ──
    concept_nodes = []

    # From theme clusters
    for theme, concept_id in THEME_TO_CONCEPT.items():
        post_count = len(themes_data.get(theme, []))
        # Determine ring based on theme content
        ring = "curated"  # default
        if "Holdform" in theme or "Consciousness" in theme or "Lore" in theme:
            ring = "core"
        elif "Media" in theme or "Distribution" in theme:
            ring = "open"
        concept_nodes.append({
            "id": concept_id,
            "label": theme,
            "ring": ring,
            "type": "theme",
            "weight": post_count,
        })

    # From glossary terms (key ones)
    for term in glossary_terms:
        tid = re.sub(r'[^a-z0-9]+', '-', term["term"].lower()).strip('-')
        ring = GLOSSARY_RING.get(term["category"], "curated")
        # Count how many corpus posts mention this term
        weight = 0
        term_lower = term["term"].lower()
        for cf in corpus_files:
            if term_lower in cf["body"].lower():
                weight += 1
        if weight > 0:  # Only include terms that appear in corpus
            concept_nodes.append({
                "id": f"g-{tid}",
                "label": term["term"],
                "ring": ring,
                "type": "glossary",
                "weight": weight,
                "definition": term["definition"][:200],
                "category": term["category"],
            })

    # ── Build concept edges ──
    concept_edges = []
    seen_edges = set()

    # Edges between themes that share posts
    theme_titles = {}
    for theme, titles in themes_data.items():
        cid = THEME_TO_CONCEPT.get(theme)
        if cid:
            theme_titles[cid] = set(t.lower()[:40] for t in titles)

    for cid1, titles1 in theme_titles.items():
        for cid2, titles2 in theme_titles.items():
            if cid1 >= cid2:
                continue
            overlap = len(titles1 & titles2)
            if overlap > 0:
                edge_key = tuple(sorted([cid1, cid2]))
                if edge_key not in seen_edges:
                    concept_edges.append([cid1, cid2])
                    seen_edges.add(edge_key)

    # Edges between glossary terms that co-occur in posts
    glossary_nodes = [n for n in concept_nodes if n["type"] == "glossary" and n["weight"] >= 2]
    for i, g1 in enumerate(glossary_nodes):
        for g2 in glossary_nodes[i+1:]:
            cooccur = 0
            for cf in corpus_files:
                body = cf["body"].lower()
                if g1["label"].lower() in body and g2["label"].lower() in body:
                    cooccur += 1
            if cooccur >= 2:
                edge_key = tuple(sorted([g1["id"], g2["id"]]))
                if edge_key not in seen_edges:
                    concept_edges.append([g1["id"], g2["id"]])
                    seen_edges.add(edge_key)

    # Edges between glossary terms and their parent themes
    for gnode in glossary_nodes:
        glabel = gnode["label"].lower()
        for theme, titles in themes_data.items():
            cid = THEME_TO_CONCEPT.get(theme)
            if not cid:
                continue
            # Check if glossary term is relevant to theme posts
            relevance = 0
            for title in titles:
                for cf in corpus_files:
                    if cf["title"].lower().startswith(title.lower()[:40]):
                        if glabel in cf["body"].lower():
                            relevance += 1
                        break
            if relevance >= 2:
                edge_key = tuple(sorted([gnode["id"], cid]))
                if edge_key not in seen_edges:
                    concept_edges.append([gnode["id"], cid])
                    seen_edges.add(edge_key)

    # ── Build meta ──
    all_contributors = set()
    for r in corpus:
        for c in r["contributors"]:
            all_contributors.add(c)

    ring_counts = {"core": 0, "curated": 0, "open": 0}
    for r in corpus:
        ring_counts[r["ring"]] = ring_counts.get(r["ring"], 0) + 1

    meta = {
        "totalPosts": len(corpus),
        "conceptNodes": len(concept_nodes),
        "conceptEdges": len(concept_edges),
        "contributors": sorted(all_contributors),
        "ringCounts": ring_counts,
        "dateRange": {
            "start": corpus[0]["date"] if corpus else "",
            "end": corpus[-1]["date"] if corpus else "",
        },
        "buildDate": datetime.now().isoformat(),
    }

    # ── Write output ──
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with open(OUT_DIR / "corpus.json", "w") as f:
        json.dump(corpus, f, indent=2)

    with open(OUT_DIR / "concepts.json", "w") as f:
        json.dump({"nodes": concept_nodes, "edges": concept_edges}, f, indent=2)

    with open(OUT_DIR / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n✓ Built {len(corpus)} corpus records")
    print(f"✓ Built {len(concept_nodes)} concept nodes with {len(concept_edges)} edges")
    print(f"✓ Ring distribution: {ring_counts}")
    print(f"✓ Contributors: {sorted(all_contributors)}")
    print(f"✓ Output: {OUT_DIR}")

if __name__ == "__main__":
    main()
