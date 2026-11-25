#!/usr/bin/env python3
"""Longitudinal baseline v1 — the analysis preregistered in docs/longitudinal-baseline-preregistration.md (commit ca60368).

Reads snapshot.json (sha256 checked), applies the preregistered exclusions, computes TF-IDF cosine similarities, and writes
results.json. Standard library only:  python3 -I analysis/longitudinal-baseline-v1/analyze.py
"""
import hashlib, json, math, os, re, statistics
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT_SHA256 = "127a05a613c1ee9504ccb0e8f3ae0a0e1bc8f59e5adb9669108dbeb9fec04b70"
PREREG_COMMIT = "ca6036881a6e7a055fbcb0cfbb7a978e5622364a"
EPOCHS = {"2026-06": "J", "2026-09": "S", "2026-10": "O"}
CLAUDE_J, CLAUDE_S = "claude-sonnet-4-20250514", "claude-sonnet-4-6"
U = ["gpt-4o", "gemini-2.5-flash", "grok-4.3"]
ALIAS = "deepseek-chat"


def load():
    raw = open(os.path.join(HERE, "snapshot.json"), "rb").read()
    got = hashlib.sha256(raw).hexdigest()
    if got != SNAPSHOT_SHA256:
        raise SystemExit(f"snapshot sha256 {got} != preregistered {SNAPSHOT_SHA256}")
    return json.loads(raw)["records"]


def select(records):
    """{epoch: {question_id: {model_id: text}}} after the preregistered exclusions."""
    chosen = {}
    for r in sorted(records, key=lambda r: r["id"]):  # smaller id first → the earlier duplicate wins
        ep = EPOCHS.get(r["date"][:7])
        if ep is None:  # the single 2026-07 verification run
            continue
        chosen.setdefault((ep, r["question_id"]), r)
    out = defaultdict(dict)
    for (ep, q), r in chosen.items():
        out[ep][q] = {a["model_id"]: a["text"] for a in r["answers"] if (a.get("text") or "").strip()}
    return out


def tokens(text):
    return re.findall(r"[a-z]+", text.lower())


def build_vectors(data):
    docs = [t for ep in data.values() for q in ep.values() for t in q.values()]
    n = len(docs)
    df = Counter()
    for d in docs:
        df.update(set(tokens(d)))
    idf = {w: math.log((1 + n) / (1 + c)) + 1 for w, c in df.items()}
    cache = {}

    def vec(text):
        if text not in cache:
            tf = Counter(tokens(text))
            v = {w: (1 + math.log(c)) * idf[w] for w, c in tf.items()}
            norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
            cache[text] = {w: x / norm for w, x in v.items()}
        return cache[text]

    return vec, n


def sim(vec, a, b):
    va, vb = vec(a), vec(b)
    if len(va) > len(vb):
        va, vb = vb, va
    return sum(x * vb.get(w, 0.0) for w, x in va.items())


def five(xs):
    xs = sorted(xs)
    if not xs:
        return None
    q = statistics.quantiles(xs, n=4) if len(xs) >= 2 else [xs[0]] * 3
    return {"n": len(xs), "min": round(xs[0], 4), "q1": round(q[0], 4), "median": round(q[1], 4), "q3": round(q[2], 4),
            "max": round(xs[-1], 4)}


def sign_p(k, n):
    """One-sided sign test P(X >= k), X ~ Binomial(n, 0.5)."""
    return sum(math.comb(n, i) for i in range(k, n + 1)) / 2 ** n


def main():
    data = select(load())
    vec, n_docs = build_vectors(data)
    J, S, O = data["J"], data["S"], data["O"]

    # ── H1 ──
    h1_rows = []
    for q in sorted(set(J) & set(S)):
        if CLAUDE_J not in J[q] or CLAUDE_S not in S[q]:
            continue
        u_vals = [sim(vec, J[q][m], S[q][m]) for m in U if m in J[q] and m in S[q]]
        if not u_vals:
            continue
        sc = sim(vec, J[q][CLAUDE_J], S[q][CLAUDE_S])
        su = statistics.mean(u_vals)
        sd = sim(vec, J[q][ALIAS], S[q][ALIAS]) if ALIAS in J[q] and ALIAS in S[q] else None
        h1_rows.append({"question_id": q, "self_claude": round(sc, 4), "self_U_mean": round(su, 4), "u_models": len(u_vals),
                        "d": round(su - sc, 4), "self_deepseek_alias": None if sd is None else round(sd, 4)})
    k = sum(1 for r in h1_rows if r["d"] > 0)
    n1 = len(h1_rows)
    h1_verdict = "supported" if k >= 9 else ("suggestive" if k >= 7 else "not supported")

    # ── H2 ──
    h2_pairs, per_model = [], defaultdict(lambda: [0, 0])
    for q in sorted(set(S) & set(O)):
        for m, text_o in O[q].items():
            if m not in S[q]:
                continue
            peers = [mm for mm in S[q] if mm != m]
            if not peers:
                continue
            s_self = sim(vec, text_o, S[q][m])
            s_cross = statistics.mean(sim(vec, text_o, S[q][mm]) for mm in peers)
            win = s_self > s_cross
            h2_pairs.append({"question_id": q, "model_id": m, "self": round(s_self, 4), "cross": round(s_cross, 4), "self_wins": win})
            per_model[m][0] += win
            per_model[m][1] += 1
    rate = sum(p["self_wins"] for p in h2_pairs) / len(h2_pairs)
    h2_verdict = "supported" if rate >= 0.75 else ("partial" if rate > 0.60 else "not supported")

    # ── descriptive: noise floor ──
    floor_SO = {m: five([sim(vec, O[q][m], S[q][m]) for q in set(S) & set(O) if m in S[q] and m in O[q]])
                for m in sorted({m for q in O.values() for m in q})}
    floor_JS = {m: five([sim(vec, J[q][m], S[q][m]) for q in set(J) & set(S) if m in J[q] and m in S[q]]) for m in U + [ALIAS]}
    floor_JS["claude (id changed)"] = five([r["self_claude"] for r in h1_rows])

    # ── descriptive: between-model spread per epoch ──
    def spread(ep_data):
        out = {}
        for q, ans in ep_data.items():
            ms = sorted(ans)
            pairs = [sim(vec, ans[a], ans[b]) for i, a in enumerate(ms) for b in ms[i + 1:]]
            if pairs:
                out[q] = {"models": len(ms), "mean_pairwise": round(statistics.mean(pairs), 4)}
        return out
    sp = {ep: spread(data[ep]) for ep in ("J", "S", "O")}

    def spread_change(a, b):
        common = sorted(set(sp[a]) & set(sp[b]))
        diffs = [sp[b][q]["mean_pairwise"] - sp[a][q]["mean_pairwise"] for q in common]
        return {"questions": len(common), "median_change": round(statistics.median(diffs), 4) if diffs else None,
                "rose": sum(d > 0 for d in diffs), "fell": sum(d < 0 for d in diffs)}

    # all within-epoch cross-model similarities, for scale
    cross_all = [v["mean_pairwise"] for ep in sp.values() for v in ep.values()]

    results = {
        "preregistration": {"file": "docs/longitudinal-baseline-preregistration.md", "commit": PREREG_COMMIT},
        "snapshot_sha256": SNAPSHOT_SHA256,
        "documents_in_idf": n_docs,
        "questions_per_epoch": {ep: len(v) for ep, v in data.items()},
        "H1": {"prediction": "d(q) = self_U - self_claude > 0", "questions": n1, "d_positive": k,
               "sign_test_one_sided_p": round(sign_p(k, n1), 4) if n1 else None,
               "median_self_claude": round(statistics.median(r["self_claude"] for r in h1_rows), 4),
               "median_self_U": round(statistics.median(r["self_U_mean"] for r in h1_rows), 4),
               "rule": ">=9 of 10 supported; 7-8 suggestive; <=6 not supported", "verdict": h1_verdict, "rows": h1_rows},
        "H2": {"prediction": "self > cross", "pairs": len(h2_pairs), "self_wins": sum(p["self_wins"] for p in h2_pairs),
               "rate": round(rate, 4), "rule": ">=75% supported; 61-74% partial; <=60% not supported", "verdict": h2_verdict,
               "per_model": {m: {"self_wins": w, "pairs": t, "rate": round(w / t, 4)} for m, (w, t) in sorted(per_model.items())},
               "pairs_detail": h2_pairs},
        "descriptive": {
            "noise_floor_S_to_O_one_month": floor_SO,
            "self_similarity_J_to_S_three_months": floor_JS,
            "within_epoch_cross_model_mean_pairwise": five(cross_all),
            "between_model_spread_change": {"J_to_S": spread_change("J", "S"), "S_to_O": spread_change("S", "O")},
            "spread_per_epoch": sp,
        },
    }
    with open(os.path.join(HERE, "results.json"), "w") as f:
        json.dump(results, f, indent=1)
        f.write("\n")
    print(json.dumps({k: v for k, v in results.items() if k not in ("H1", "H2", "descriptive")}, indent=1))
    print("H1", {k: v for k, v in results["H1"].items() if k != "rows"})
    for r in h1_rows:
        print("   ", r)
    print("H2", {k: v for k, v in results["H2"].items() if k != "pairs_detail"})
    print("floor S->O", json.dumps(floor_SO, indent=0))
    print("J->S", json.dumps(floor_JS, indent=0))
    print("cross within epoch", five(cross_all))
    print("spread change", results["descriptive"]["between_model_spread_change"])


if __name__ == "__main__":
    main()
