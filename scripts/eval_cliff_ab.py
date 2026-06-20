#!/usr/bin/env python3
"""
Relevance-cliff A/B (offline, deterministic, zero API spend).

Compares retrieval BASELINE (floor only) vs CLIFF (floor + relative cliff) at the
*production* per-type policy (λ/floor/cliff/minKeep mirrored from api/query.js
RETRIEVAL_POLICIES) over the 25 gold queries, using the cached query embeddings
from eval_retrieval.py. Reuses that harness's cosine / mmr / metric functions so
the retrieval math matches the engine exactly. Corpus is normalized in-memory via
the ingest schema guard so author/ring diversity reflects post-deploy state.

Usage:  python scripts/eval_cliff_ab.py
"""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ev = _load("eval_retrieval", ROOT / "scripts" / "eval_retrieval.py")
ing = _load("ingest_incremental", ROOT / "scripts" / "ingest-incremental.py")

# Production policy — mirrors api/query.js RETRIEVAL_POLICIES.
POLICIES = {
    "identity":   {"lambda": 0.25, "floor": 0.25, "cliff": 0.55, "minKeep": 4, "mmr": True},
    "bridge":     {"lambda": 0.22, "floor": 0.25, "cliff": 0.55, "minKeep": 4, "mmr": True},
    "narrative":  {"lambda": 0.32, "floor": 0.28, "cliff": 0.62, "minKeep": 3, "mmr": False},
    "conceptual": {"lambda": 0.45, "floor": 0.28, "cliff": 0.66, "minKeep": 3, "mmr": False},
    "technical":  {"lambda": 0.50, "floor": 0.32, "cliff": 0.70, "minKeep": 3, "mmr": False},
}
TOP_K = 6


def mmr_with_stop(eligible, vectors, lam, k, min_keep, stop):
    """MMR that STOPS early once the best marginal score is <= `stop` and we
    already hold >= min_keep — i.e. don't pad with records MMR itself rates as
    more redundant than relevant. stop=None disables (== ev.mmr_retrieval)."""
    if len(eligible) <= k:
        return list(eligible)
    unselected = list(eligible)
    selected = [unselected.pop(max(range(len(unselected)),
                                   key=lambda i: unselected[i]["similarity"]))]
    while len(selected) < k and unselected:
        best_score, best_idx = -float("inf"), 0
        for i, doc in enumerate(unselected):
            vec = vectors.get(doc["id"])
            if vec is None:
                continue
            max_sim = max((ev.cosine(vec, vectors[s["id"]])
                           for s in selected if vectors.get(s["id"])), default=0.0)
            sc = lam * doc["similarity"] - (1 - lam) * max_sim
            if sc > best_score:
                best_score, best_idx = sc, i
        if stop is not None and best_score <= stop and len(selected) >= min_keep:
            break
        selected.append(unselected.pop(best_idx))
    return selected


def retrieve(qvec, corpus, vectors, policy, use_cliff=False, mmr_stop=None):
    """Score → floor → (cliff) → MMR/sort. Mirrors api/query.js findRelevantSemantic."""
    scored = []
    for entry in corpus:
        vec = vectors.get(entry["id"])
        if vec is None:
            continue
        sim = ev.cosine(qvec, vec)
        if sim > policy["floor"]:
            scored.append({**entry, "similarity": sim})
    if not scored:
        return []

    ranked = sorted(scored, key=lambda x: x["similarity"], reverse=True)
    if use_cliff:
        top = ranked[0]["similarity"]
        thresh = top * policy["cliff"]
        keep = min(policy["minKeep"], len(ranked))
        ranked = [r for i, r in enumerate(ranked) if i < keep or r["similarity"] >= thresh]

    if policy["mmr"] and len(ranked) > TOP_K:
        return mmr_with_stop(ranked, vectors, policy["lambda"], TOP_K,
                             policy["minKeep"], mmr_stop)
    return ranked[:TOP_K]


def score(docs, vectors, qtype):
    rel = ev.mean_similarity(docs)
    div = ev.intra_list_diversity(docs, vectors)
    auth = ev.author_diversity(docs)
    ring = ev.ring_diversity(docs)
    comp = ev.composite(rel, div, auth, ring, qtype)
    return rel, div, auth, ring, comp


def main():
    corpus = json.loads((ROOT / "public" / "data" / "corpus.json").read_text())
    for r in corpus:                      # post-deploy state: guard-normalized
        ing.normalize_record(r)
    emb = json.loads((ROOT / "public" / "data" / "embeddings.json").read_text())
    vectors = emb.get("vectors", emb)
    qvecs = json.loads((ROOT / "scripts" / "eval_query_embeddings.json").read_text())

    # Four arms. mmr_stop=0.0 → stop when best marginal MMR score is non-positive.
    ARMS = {
        "baseline":  dict(use_cliff=False, mmr_stop=None),
        "cliff":     dict(use_cliff=True,  mmr_stop=None),
        "mmrstop":   dict(use_cliff=False, mmr_stop=0.0),
        "both":      dict(use_cliff=True,  mmr_stop=0.0),
    }
    agg = {}  # qtype -> arm -> [ (n, rel, div, auth, ring, comp), ... ]
    for q in ev.QUERIES:
        qvec = qvecs.get(q["id"])
        if qvec is None:
            continue
        pol = POLICIES[q["type"]]
        for arm, kw in ARMS.items():
            docs = retrieve(qvec, corpus, vectors, pol, **kw)
            agg.setdefault(q["type"], {}).setdefault(arm, []).append((len(docs), *score(docs, vectors, q["type"])))

    def mean(rows, i):
        return sum(r[i] for r in rows) / len(rows)

    print("=== PER-TYPE MEANS — n / relevance / diversity / composite, by arm ===\n")
    overall = {a: 0.0 for a in ARMS}
    nrows = 0
    for qtype in ["identity", "bridge", "conceptual", "narrative", "technical"]:
        if qtype not in agg:
            continue
        n = len(agg[qtype]["baseline"])
        nrows += n
        print(f"{qtype.upper()}  (n={n} queries)")
        print(f"  {'arm':<10}{'n':<7}{'relevance':<12}{'diversity':<12}{'composite':<12}")
        for arm in ARMS:
            rows = agg[qtype][arm]
            overall[arm] += mean(rows, 5) * n
            print(f"  {arm:<10}{mean(rows,0):<7.1f}{mean(rows,1):<12.3f}{mean(rows,2):<12.3f}{mean(rows,5):<12.4f}")
        print()

    print("=== OVERALL composite (mean across 25 queries) ===")
    base = overall["baseline"] / nrows
    for arm in ARMS:
        v = overall[arm] / nrows
        print(f"  {arm:<10}{v:.4f}   (Δ vs baseline {v - base:+.4f})")


if __name__ == "__main__":
    main()
