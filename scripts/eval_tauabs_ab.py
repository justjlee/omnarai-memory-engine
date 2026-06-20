#!/usr/bin/env python3
"""
Absolute-relevance gate (P3) A/B — offline, deterministic, zero API spend.

Compares the CURRENT production retrieval (floor + relative cliff + minKeep, MMR
per type) against the same pipeline PLUS the P3 hard absolute gate `tauAbs`
(anchor-exempt) over the 25 gold queries, using cached query embeddings. Reuses
eval_cliff_ab.py / eval_retrieval.py so the retrieval math matches the engine
exactly. Reports composite, mean relevance, and mean panel size per type, plus how
many low-similarity records the gate removed.

Usage:  python scripts/eval_tauabs_ab.py
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


cc = _load("eval_cliff_ab", ROOT / "scripts" / "eval_cliff_ab.py")
ev, ing = cc.ev, cc.ing

# Per-type tauAbs — mirrors api/query.js RETRIEVAL_POLICIES (P3, broad-only config).
TAU_ABS = {"identity": 0.40, "bridge": 0.40, "narrative": 0.42, "conceptual": 0.28, "technical": 0.32}
TOP_K = cc.TOP_K


def retrieve_tau(qvec, corpus, vectors, policy, tau_abs):
    """Current prod pipeline (floor + cliff + minKeep + MMR) with the P3 absolute
    gate applied: the anchor (rank 0) is exempt; every other record must clear
    tau_abs AND the existing cliff/minKeep logic."""
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
    top = ranked[0]["similarity"]
    thresh = top * policy["cliff"]
    keep = min(policy["minKeep"], len(ranked))
    ranked = [r for i, r in enumerate(ranked)
              if i == 0 or (r["similarity"] >= tau_abs and (i < keep or r["similarity"] >= thresh))]
    if policy["mmr"] and len(ranked) > TOP_K:
        return cc.mmr_with_stop(ranked, vectors, policy["lambda"], TOP_K, policy["minKeep"], None)
    return ranked[:TOP_K]


# Candidate tauAbs configs to sweep (per-type). The goal: raise relevance + gate the
# documented broad-query noise (bridge must stay ≥0.40 to drop the 0.396 admissions)
# WITHOUT regressing the overall composite (precision types over-prune at high tauAbs).
CONFIGS = {
    "v1 (.40/.40/.42/.45/.48)": {"identity": .40, "bridge": .40, "narrative": .42, "conceptual": .45, "technical": .48},
    "uniform-0.40":             {"identity": .40, "bridge": .40, "narrative": .40, "conceptual": .40, "technical": .40},
    "uniform-0.38":             {"identity": .38, "bridge": .38, "narrative": .38, "conceptual": .38, "technical": .38},
    "uniform-0.36":             {"identity": .36, "bridge": .36, "narrative": .36, "conceptual": .36, "technical": .36},
    "broad.40/prec.38":         {"identity": .40, "bridge": .40, "narrative": .40, "conceptual": .38, "technical": .38},
    "broad.40/prec.36":         {"identity": .40, "bridge": .40, "narrative": .38, "conceptual": .36, "technical": .36},
    # broad-only: gate the diversity types (where over-padding noise occurs); leave
    # precision types at their floor (no extra gate — cliff already handles them).
    "broad-only .40":           {"identity": .40, "bridge": .40, "narrative": .42, "conceptual": .28, "technical": .32},
    "broad.40/narr.42/prec.36": {"identity": .40, "bridge": .40, "narrative": .42, "conceptual": .36, "technical": .36},
}


def main():
    corpus = json.loads((ROOT / "public" / "data" / "corpus.json").read_text())
    for r in corpus:
        ing.normalize_record(r)
    emb = json.loads((ROOT / "public" / "data" / "embeddings.json").read_text())
    vectors = emb.get("vectors", emb)
    qvecs = json.loads((ROOT / "scripts" / "eval_query_embeddings.json").read_text())

    queries = [q for q in ev.QUERIES if qvecs.get(q["id"]) is not None]
    nq = len(queries)

    def mean(rows, i):
        return sum(r[i] for r in rows) / len(rows)

    # Baseline: current prod (cliff, no tauAbs).
    base_rows = {}
    for q in queries:
        docs = cc.retrieve(qvecs[q["id"]], corpus, vectors, cc.POLICIES[q["type"]], use_cliff=True, mmr_stop=None)
        base_rows.setdefault(q["type"], []).append((len(docs), *cc.score(docs, vectors, q["type"])))
    base_overall = sum(mean(base_rows[t], 5) * len(base_rows[t]) for t in base_rows) / nq
    base_rel = sum(mean(base_rows[t], 1) * len(base_rows[t]) for t in base_rows) / nq

    print(f"BASELINE cliff(prod): composite={base_overall:.4f}  relevance={base_rel:.4f}  (n={nq})\n")
    print(f"{'config':<26}{'composite':<12}{'Δcomp':<10}{'relevance':<12}{'Δrel':<10}{'avgPanel':<9}{'minPanel'}")
    for name, taus in CONFIGS.items():
        agg = {}
        panels = []
        for q in queries:
            docs = retrieve_tau(qvecs[q["id"]], corpus, vectors, cc.POLICIES[q["type"]], taus[q["type"]])
            panels.append(len(docs))
            agg.setdefault(q["type"], []).append((len(docs), *cc.score(docs, vectors, q["type"])))
        comp = sum(mean(agg[t], 5) * len(agg[t]) for t in agg) / nq
        rel = sum(mean(agg[t], 1) * len(agg[t]) for t in agg) / nq
        print(f"{name:<26}{comp:<12.4f}{comp-base_overall:<+10.4f}{rel:<12.4f}{rel-base_rel:<+10.4f}{sum(panels)/len(panels):<9.1f}{min(panels)}")


if __name__ == "__main__":
    main()
