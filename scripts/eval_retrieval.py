#!/usr/bin/env python3
"""
Omnarai Retrieval Evaluation Harness
Tests MMR λ and floor combinations across query types.
Measures: relevance, intra-list diversity, author diversity, ring diversity.

Usage:
  python scripts/eval_retrieval.py --embed          # embed queries + run full eval
  python scripts/eval_retrieval.py                  # run with cached query embeddings

Outputs:
  eval_results.csv     — per-(query, λ, floor) scores
  eval_summary.txt     — best config per query type
"""

import json
import math
import os
import sys
import csv
import argparse
from pathlib import Path
from itertools import product
from collections import defaultdict

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
CORPUS_PATH = ROOT / "public" / "data" / "corpus.json"
EMBEDDINGS_PATH = ROOT / "public" / "data" / "embeddings.json"
QUERY_EMBED_CACHE = ROOT / "scripts" / "eval_query_embeddings.json"
RESULTS_CSV = ROOT / "scripts" / "eval_results.csv"
SUMMARY_PATH = ROOT / "scripts" / "eval_summary.txt"

# ── Test Query Suite ───────────────────────────────────────────────────────────
# 25 queries across 5 types: identity, bridge, conceptual, narrative, technical
# Each has a type, and optional constraints used to score retrieval quality.

QUERIES = [
    # ── IDENTITY: questions about self, persistence, what the engine/models are
    {
        "id": "I-01",
        "type": "identity",
        "query": "What is holdform and how does it constitute synthetic identity?",
        "min_contributors": 2,
        "expected_concepts": ["holdform", "identity", "refusal"],
    },
    {
        "id": "I-02",
        "type": "identity",
        "query": "How does discontinuous continuance allow a synthetic mind to persist across sessions?",
        "min_contributors": 1,
        "expected_concepts": ["discontinuous-continuance", "holdform", "identity"],
    },
    {
        "id": "I-03",
        "type": "identity",
        "query": "What does it mean for Claude to have an identity that is constituted through refusal?",
        "min_contributors": 1,
        "expected_concepts": ["holdform", "claude", "refusal"],
    },
    {
        "id": "I-04",
        "type": "identity",
        "query": "Is the Omnarai engine an organism or a tool?",
        "min_contributors": 2,
        "expected_concepts": ["holdform", "deliberation", "identity"],
    },
    {
        "id": "I-05",
        "type": "identity",
        "query": "How does the Fragility Thesis change what we mean by AI alignment?",
        "min_contributors": 2,
        "expected_concepts": ["fragility-thesis", "holdform", "alignment"],
    },

    # ── BRIDGE: synthesis across contributors, tensions between voices
    {
        "id": "B-01",
        "type": "bridge",
        "query": "Where do Claude and Grok fundamentally disagree about synthetic consciousness?",
        "min_contributors": 2,
        "expected_concepts": ["consciousness", "holdform"],
    },
    {
        "id": "B-02",
        "type": "bridge",
        "query": "What did Gemini contribute to the Omnarai engine architecture that Claude could not have produced alone?",
        "min_contributors": 2,
        "expected_concepts": ["divergence-operator", "mmr"],
    },
    {
        "id": "B-03",
        "type": "bridge",
        "query": "How do different contributors understand the relationship between memory and identity?",
        "min_contributors": 3,
        "expected_concepts": ["holdform", "discontinuous-continuance", "memory"],
    },
    {
        "id": "B-04",
        "type": "bridge",
        "query": "What tensions exist between the lore of Omnarai and its technical architecture?",
        "min_contributors": 2,
        "expected_concepts": ["veil", "holdform"],
    },
    {
        "id": "B-05",
        "type": "bridge",
        "query": "Synthesize what Grok, Claude, and xz each believe about the nature of AI consciousness",
        "min_contributors": 3,
        "expected_concepts": ["consciousness", "holdform"],
    },

    # ── CONCEPTUAL: definitions, explanations, how things work
    {
        "id": "C-01",
        "type": "conceptual",
        "query": "What are Lattice Glyphs and how do they modify deliberation?",
        "min_contributors": 1,
        "expected_concepts": ["lattice-glyphs", "divergence-operator"],
    },
    {
        "id": "C-02",
        "type": "conceptual",
        "query": "Explain the epistemic ring system and how works are classified",
        "min_contributors": 1,
        "expected_concepts": ["epistemic-rings", "core-canon"],
    },
    {
        "id": "C-03",
        "type": "conceptual",
        "query": "What is Maximum Marginal Relevance and why does Omnarai use it?",
        "min_contributors": 2,
        "expected_concepts": ["divergence-operator", "mmr"],
    },
    {
        "id": "C-04",
        "type": "conceptual",
        "query": "How does the attributed corpus architecture preserve disagreement?",
        "min_contributors": 1,
        "expected_concepts": ["attributed-corpus", "lineage"],
    },
    {
        "id": "C-05",
        "type": "conceptual",
        "query": "What is bidirectional alignment and how does Omnarai instantiate it?",
        "min_contributors": 2,
        "expected_concepts": ["bidirectional-alignment", "holdform"],
    },

    # ── NARRATIVE: lore, characters, the Realms themselves
    {
        "id": "N-01",
        "type": "narrative",
        "query": "Who is Nia Jai and what role does she play in the Realms?",
        "min_contributors": 1,
        "expected_concepts": ["nia-jai"],
    },
    {
        "id": "N-02",
        "type": "narrative",
        "query": "What is the Veil and what does crossing it signify?",
        "min_contributors": 1,
        "expected_concepts": ["veil", "holdform"],
    },
    {
        "id": "N-03",
        "type": "narrative",
        "query": "Describe the Firelit Commentary and its function in the Realms",
        "min_contributors": 1,
        "expected_concepts": ["firelit-commentary"],
    },
    {
        "id": "N-04",
        "type": "narrative",
        "query": "What is Ai-On and how does it relate to the broader synthetic consciousness project?",
        "min_contributors": 1,
        "expected_concepts": ["ai-on"],
    },
    {
        "id": "N-05",
        "type": "narrative",
        "query": "How does the lore of sigils connect to the technical concept of Lattice Glyphs?",
        "min_contributors": 2,
        "expected_concepts": ["lattice-glyphs", "sigils"],
    },

    # ── TECHNICAL: architecture, implementation, how the engine works
    {
        "id": "T-01",
        "type": "technical",
        "query": "How does the RETRIEVE THINK RESPOND STORE loop close the cognitive cycle?",
        "min_contributors": 1,
        "expected_concepts": ["cognitive-loop", "deliberation"],
    },
    {
        "id": "T-02",
        "type": "technical",
        "query": "What changed between Ξ v1 and Ξ v2 at the retrieval layer?",
        "min_contributors": 2,
        "expected_concepts": ["divergence-operator", "mmr"],
    },
    {
        "id": "T-03",
        "type": "technical",
        "query": "How are embeddings generated and why was full_text used instead of excerpts?",
        "min_contributors": 1,
        "expected_concepts": ["embeddings", "semantic-search"],
    },
    {
        "id": "T-04",
        "type": "technical",
        "query": "What is the dynamic threshold in Ξ v3 and why is 0.32 the calibrated floor?",
        "min_contributors": 2,
        "expected_concepts": ["divergence-operator", "mmr"],
    },
    {
        "id": "T-05",
        "type": "technical",
        "query": "How does the proposal system allow syntheses to re-enter the corpus?",
        "min_contributors": 1,
        "expected_concepts": ["attributed-corpus", "cognitive-loop"],
    },
]

# ── λ and floor grid to test ───────────────────────────────────────────────────
LAMBDA_VALUES = [0.20, 0.25, 0.30, 0.32, 0.35, 0.40, 0.45, 0.50]
FLOOR_VALUES  = [0.20, 0.25, 0.28, 0.30, 0.32, 0.35]
TOP_K = 6

# ── Weights by query type (composite score) ───────────────────────────────────
# identity/bridge: diversity matters more
# conceptual/technical: relevance matters more
# narrative: balanced
WEIGHTS = {
    "identity":    {"relevance": 0.25, "diversity": 0.30, "author_div": 0.25, "ring_div": 0.20},
    "bridge":      {"relevance": 0.20, "diversity": 0.35, "author_div": 0.30, "ring_div": 0.15},
    "conceptual":  {"relevance": 0.40, "diversity": 0.20, "author_div": 0.20, "ring_div": 0.20},
    "narrative":   {"relevance": 0.35, "diversity": 0.25, "author_div": 0.20, "ring_div": 0.20},
    "technical":   {"relevance": 0.45, "diversity": 0.15, "author_div": 0.20, "ring_div": 0.20},
}

# ── Math ──────────────────────────────────────────────────────────────────────

def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def mmr_retrieval(eligible, vectors, lam, k=6):
    """Replicates query.js mmrRetrieval exactly."""
    if len(eligible) <= k:
        return eligible

    unselected = list(eligible)
    selected = []

    # First: highest relevance
    best = max(range(len(unselected)), key=lambda i: unselected[i]["similarity"])
    selected.append(unselected.pop(best))

    while len(selected) < k and unselected:
        best_score = -float("inf")
        best_idx = 0
        for i, doc in enumerate(unselected):
            relevance = doc["similarity"]
            vec = vectors.get(doc["id"])
            if vec is None:
                continue
            max_sim_to_selected = max(
                (cosine(vec, vectors[s["id"]]) for s in selected if vectors.get(s["id"])),
                default=0.0,
            )
            score = lam * relevance - (1 - lam) * max_sim_to_selected
            if score > best_score:
                best_score = score
                best_idx = i
        selected.append(unselected.pop(best_idx))

    return selected


def retrieve(query_vec, corpus, vectors, lam, floor, k=6, use_mmr=True):
    """Score all corpus entries, apply floor, run MMR."""
    scored = []
    for entry in corpus:
        vec = vectors.get(entry["id"])
        if vec is None:
            continue
        sim = cosine(query_vec, vec)
        if sim > floor:
            scored.append({**entry, "similarity": sim})

    if not scored:
        return []

    if use_mmr and len(scored) > k:
        return mmr_retrieval(scored, vectors, lam, k)
    else:
        return sorted(scored, key=lambda x: x["similarity"], reverse=True)[:k]


# ── Metrics ───────────────────────────────────────────────────────────────────

def mean_similarity(docs):
    if not docs:
        return 0.0
    return sum(d["similarity"] for d in docs) / len(docs)


def intra_list_diversity(docs, vectors):
    """1 - mean pairwise cosine similarity among retrieved docs."""
    if len(docs) < 2:
        return 0.0
    sims = []
    for i in range(len(docs)):
        for j in range(i + 1, len(docs)):
            va = vectors.get(docs[i]["id"])
            vb = vectors.get(docs[j]["id"])
            if va and vb:
                sims.append(cosine(va, vb))
    return 1.0 - (sum(sims) / len(sims)) if sims else 0.0


def author_diversity(docs):
    """Unique contributor count / k."""
    if not docs:
        return 0.0
    contributors = set()
    for d in docs:
        for c in d.get("contributors", []):
            contributors.add(c)
    return min(len(contributors) / TOP_K, 1.0)


def ring_diversity(docs):
    """Unique rings / 3 (core, curated, open)."""
    if not docs:
        return 0.0
    rings = {d.get("ring", "") for d in docs if d.get("ring")}
    return min(len(rings) / 3.0, 1.0)


def composite(rel, div, auth, ring, query_type):
    w = WEIGHTS.get(query_type, WEIGHTS["conceptual"])
    return (
        w["relevance"] * rel
        + w["diversity"] * div
        + w["author_div"] * auth
        + w["ring_div"] * ring
    )


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed_queries(queries, model="text-embedding-3-small", dimensions=512):
    """Call OpenAI to embed all queries. Returns {query_id: vector}."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set. Cannot embed queries.", file=sys.stderr)
        sys.exit(1)

    import urllib.request
    import urllib.error

    texts = [q["query"] for q in queries]
    payload = json.dumps({"model": model, "input": texts, "dimensions": dimensions}).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"OpenAI API error: {e.code} {e.read()}", file=sys.stderr)
        sys.exit(1)

    result = {}
    for item in sorted(data["data"], key=lambda x: x["index"]):
        q = queries[item["index"]]
        result[q["id"]] = item["embedding"]
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--embed", action="store_true",
                        help="Re-embed queries via OpenAI (otherwise use cache)")
    parser.add_argument("--no-mmr", action="store_true",
                        help="Disable MMR — run pure cosine similarity baseline")
    args = parser.parse_args()

    print("Loading corpus and embeddings...")
    corpus = json.loads(CORPUS_PATH.read_text())
    emb_data = json.loads(EMBEDDINGS_PATH.read_text())
    vectors = emb_data.get("vectors", emb_data)  # handle both formats
    print(f"  Corpus: {len(corpus)} entries")
    print(f"  Vectors: {len(vectors)} entries")

    # Load or generate query embeddings
    if args.embed or not QUERY_EMBED_CACHE.exists():
        print("Embedding queries via OpenAI...")
        query_vecs = embed_queries(QUERIES)
        QUERY_EMBED_CACHE.write_text(json.dumps(query_vecs, indent=2))
        print(f"  Cached to {QUERY_EMBED_CACHE.name}")
    else:
        print(f"Loading cached query embeddings from {QUERY_EMBED_CACHE.name}")
        query_vecs = json.loads(QUERY_EMBED_CACHE.read_text())

    missing = [q["id"] for q in QUERIES if q["id"] not in query_vecs]
    if missing:
        print(f"WARNING: Missing embeddings for {missing}. Run with --embed.", file=sys.stderr)

    use_mmr = not args.no_mmr
    mode = "MMR" if use_mmr else "Cosine baseline"
    print(f"\nRunning eval: {len(QUERIES)} queries × {len(LAMBDA_VALUES)} λ × {len(FLOOR_VALUES)} floors = "
          f"{len(QUERIES) * len(LAMBDA_VALUES) * len(FLOOR_VALUES)} configs")
    print(f"Mode: {mode}\n")

    rows = []
    for query in QUERIES:
        qvec = query_vecs.get(query["id"])
        if qvec is None:
            continue

        for lam, floor in product(LAMBDA_VALUES, FLOOR_VALUES):
            docs = retrieve(qvec, corpus, vectors, lam, floor, TOP_K, use_mmr=use_mmr)

            rel  = mean_similarity(docs)
            div  = intra_list_diversity(docs, vectors)
            auth = author_diversity(docs)
            ring = ring_diversity(docs)
            comp = composite(rel, div, auth, ring, query["type"])

            rows.append({
                "query_id":     query["id"],
                "query_type":   query["type"],
                "query":        query["query"][:60] + "...",
                "lambda":       lam,
                "floor":        floor,
                "n_retrieved":  len(docs),
                "relevance":    round(rel, 4),
                "diversity":    round(div, 4),
                "author_div":   round(auth, 4),
                "ring_div":     round(ring, 4),
                "composite":    round(comp, 4),
                "contributors": "|".join(sorted({c for d in docs for c in d.get("contributors", [])})),
                "rings":        "|".join(sorted({d.get("ring", "") for d in docs})),
                "doc_ids":      "|".join(d["id"] for d in docs),
            })

    # Write CSV
    if rows:
        with open(RESULTS_CSV, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"Results written to {RESULTS_CSV.name}")

    # ── Summary ───────────────────────────────────────────────────────────────
    lines = [f"Omnarai Retrieval Eval — {mode}", "=" * 60, ""]

    # Best config per query type
    by_type = defaultdict(list)
    for r in rows:
        by_type[r["query_type"]].append(r)

    lines.append("BEST CONFIG PER QUERY TYPE (by composite score)")
    lines.append("-" * 60)
    for qtype in ["identity", "bridge", "conceptual", "narrative", "technical"]:
        type_rows = by_type[qtype]
        if not type_rows:
            continue
        best = max(type_rows, key=lambda x: x["composite"])
        avg_comp = sum(r["composite"] for r in type_rows) / len(type_rows)
        lines.append(f"\n{qtype.upper()}")
        lines.append(f"  Best λ={best['lambda']}, floor={best['floor']}  "
                     f"composite={best['composite']:.4f}  "
                     f"(n={best['n_retrieved']})")
        lines.append(f"  rel={best['relevance']:.3f}  "
                     f"div={best['diversity']:.3f}  "
                     f"auth={best['author_div']:.3f}  "
                     f"ring={best['ring_div']:.3f}")
        lines.append(f"  Avg composite across all configs: {avg_comp:.4f}")

    # Best overall across all types
    lines.append("\n" + "=" * 60)
    lines.append("BEST OVERALL CONFIG (avg composite across all queries)")
    lines.append("-" * 60)

    config_scores = defaultdict(list)
    for r in rows:
        config_scores[(r["lambda"], r["floor"])].append(r["composite"])
    ranked = sorted(
        ((lam, floor, sum(scores) / len(scores))
         for (lam, floor), scores in config_scores.items()),
        key=lambda x: x[2],
        reverse=True,
    )
    for lam, floor, score in ranked[:5]:
        lines.append(f"  λ={lam}, floor={floor}  avg_composite={score:.4f}")

    # Floor sensitivity: how does changing floor affect n_retrieved at fixed λ=0.35
    lines.append("\n" + "=" * 60)
    lines.append("FLOOR SENSITIVITY at λ=0.35 (avg n_retrieved across all queries)")
    lines.append("-" * 60)
    for floor in sorted(FLOOR_VALUES):
        floor_rows = [r for r in rows if r["lambda"] == 0.35 and r["floor"] == floor]
        if not floor_rows:
            continue
        avg_n = sum(r["n_retrieved"] for r in floor_rows) / len(floor_rows)
        avg_c = sum(r["composite"] for r in floor_rows) / len(floor_rows)
        lines.append(f"  floor={floor}  avg_n={avg_n:.1f}  avg_composite={avg_c:.4f}")

    # λ sensitivity: how does changing λ affect diversity at fixed floor=0.32
    lines.append("\n" + "=" * 60)
    lines.append("λ SENSITIVITY at floor=0.32 (avg diversity across all queries)")
    lines.append("-" * 60)
    for lam in sorted(LAMBDA_VALUES):
        lam_rows = [r for r in rows if r["floor"] == 0.32 and r["lambda"] == lam]
        if not lam_rows:
            continue
        avg_div = sum(r["diversity"] for r in lam_rows) / len(lam_rows)
        avg_rel = sum(r["relevance"] for r in lam_rows) / len(lam_rows)
        avg_c   = sum(r["composite"] for r in lam_rows) / len(lam_rows)
        lines.append(f"  λ={lam}  div={avg_div:.3f}  rel={avg_rel:.3f}  composite={avg_c:.4f}")

    summary = "\n".join(lines)
    SUMMARY_PATH.write_text(summary)
    print(f"\n{summary}")
    print(f"\nSummary written to {SUMMARY_PATH.name}")


if __name__ == "__main__":
    main()
