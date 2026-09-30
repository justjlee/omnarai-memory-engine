#!/usr/bin/env python3
"""certification-reliability-2026-09 — how reliable is the Atlas's certification grade?

Zero-spend secondary analysis of every saved perturbation-harness battery in
atlas/certif*.json (scripts/certify-divergence.mjs output). No model calls.

A "battery" = one record put through the full perturbation battery; a ×3 battery
carries three independent runs (reproducibility.tiers / dri_per_run /
between_per_run). Stage-2 (2026-07-18) consensus tiers exist only as a table in
atlas/certify-stage2-2026-07-18.md (their JSON was lost to host failures; see
that file's provenance caveat) and are parsed from it for the retest section.

    python3 analysis/certification-reliability-2026-09.py          # print report
    python3 analysis/certification-reliability-2026-09.py --json   # write results JSON

Stdlib only. Every number in analysis/certification-reliability-2026-09.md is
printed by this script; if they disagree, this script is right.
"""
import glob, json, math, os, re, sys
from collections import Counter, defaultdict
from itertools import combinations

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOOR = 0.15          # BETWEEN_FLOOR in certify-divergence.mjs
DRI_BAR = 1.0         # divergenceExists requires dri >= 1.0
CERT = {"C1", "C2", "C3"}
RANK = {"C0": 0, "C1": 1, "C2": 2, "C3": 3}

# ── load ────────────────────────────────────────────────────────────────────
batteries = []   # multi-run batteries
singles = []     # single-run results
for f in sorted(glob.glob(os.path.join(ROOT, "atlas", "certif*.json"))):
    d = json.load(open(f))
    meta = d.get("meta", {})
    for r in d.get("results", []):
        if not r.get("id") or r.get("error"):
            continue
        rep = r.get("reproducibility") or {}
        tiers = rep.get("tiers") or []
        base = {"id": r["id"], "file": os.path.basename(f), "date": (meta.get("date") or meta.get("updatedAt") or "")[:10],
                "method": meta.get("method"), "consensus": r.get("certification"), "per_model": r.get("per_model") or {}}
        if len(tiers) >= 2 and all(t in RANK for t in tiers):
            batteries.append({**base, "tiers": tiers, "dri": rep.get("dri_per_run") or [], "between": rep.get("between_per_run") or []})
        elif r.get("certification") in RANK:
            singles.append({**base, "dri": r.get("dri"), "between": r.get("between_spread")})

stage2 = {}  # id -> (stage1 consensus, stage2 consensus, stage2 runs)
md = open(os.path.join(ROOT, "atlas", "certify-stage2-2026-07-18.md")).read()
for m in re.finditer(r"\| (OMN-[A-Z]\d+) \| \**(C\d)\** \| \**(C\d)\** \| \[([C0-9,]+)\] \|", md):
    stage2[m.group(1)] = (m.group(2), m.group(3), m.group(4).split(","))

# ── helpers ─────────────────────────────────────────────────────────────────
mean = lambda xs: sum(xs) / len(xs)
def var(xs):
    m = mean(xs); return sum((x - m) ** 2 for x in xs) / (len(xs) - 1)

def icc1(groups):
    """One-way random-effects ICC(1,1) and ICC(1,k) for equal-sized groups."""
    k = len(groups[0]); n = len(groups)
    grand = mean([x for g in groups for x in g])
    msb = k * sum((mean(g) - grand) ** 2 for g in groups) / (n - 1)
    msw = sum((x - mean(g)) ** 2 for g in groups for x in g) / (n * (k - 1))
    return (msb - msw) / (msb + (k - 1) * msw), (msb - msw) / msb, math.sqrt(msw)

def fleiss(items, cats):
    """Fleiss' kappa; items = list of rating lists (equal raters per item)."""
    n = len(items[0]); N = len(items)
    p_j = {c: sum(it.count(c) for it in items) / (N * n) for c in cats}
    P_i = [(sum(it.count(c) ** 2 for c in cats) - n) / (n * (n - 1)) for it in items]
    Pbar, Pe = mean(P_i), sum(v * v for v in p_j.values())
    return (Pbar - Pe) / (1 - Pe) if Pe < 1 else float("nan"), Pbar, Pe

def cohen(a, b):
    cats = sorted(set(a) | set(b)); N = len(a)
    po = sum(x == y for x, y in zip(a, b)) / N
    pe = sum((a.count(c) / N) * (b.count(c) / N) for c in cats)
    return (po - pe) / (1 - pe) if pe < 1 else float("nan"), po, pe

R = {}  # results

# ── A. single-run reliability (within ×3 batteries) ─────────────────────────
x3 = [b for b in batteries if len(b["tiers"]) == 3]
R["n_batteries_x3"] = len(x3)
R["n_records_x3"] = len({b["id"] for b in x3})
R["n_single_run_results"] = len(singles)
R["unanimous"] = sum(len(set(b["tiers"])) == 1 for b in x3)
pairs = [(a, c) for b in x3 for a, c in combinations(b["tiers"], 2)]
R["pairwise_run_agreement"] = sum(a == c for a, c in pairs) / len(pairs)
k_tier = fleiss([b["tiers"] for b in x3], ["C0", "C1", "C3"])
R["fleiss_kappa_tier"] = k_tier[0]
bin_items = [["cert" if t in CERT else "none" for t in b["tiers"]] for b in x3]
R["fleiss_kappa_certified_yesno"] = fleiss(bin_items, ["cert", "none"])[0]
R["per_run_certify_rate"] = sum(i.count("cert") for i in bin_items) / (3 * len(bin_items))

full = [b for b in x3 if len(b["dri"]) == 3 and len(b["between"]) == 3 and None not in b["dri"] + b["between"]]
R["n_batteries_with_scores"] = len(full)
R["icc_dri_single"], R["icc_dri_mean3"], R["sd_within_dri"] = icc1([b["dri"] for b in full])
R["icc_between_single"], R["icc_between_mean3"], R["sd_within_between"] = icc1([b["between"] for b in full])
R["sd_between_records_between"] = math.sqrt(var([mean(b["between"]) for b in full]))

# ── B. threshold proximity: which records can N=3 actually resolve? ─────────
sb, sd_ = R["sd_within_between"], R["sd_within_dri"]
prox = []
for b in full:
    mb, md_ = mean(b["between"]), mean(b["dri"])
    zb = (mb - FLOOR) / (sb / math.sqrt(3)); zd = (md_ - DRI_BAR) / (sd_ / math.sqrt(3))
    # the binding condition is whichever is closer to failing
    z = min(zb, zd)
    n_need = math.ceil((1.96 / abs(z)) ** 2 * 3) if abs(z) > 1e-9 else None
    status = "clear-above" if z >= 1.96 else "clear-below" if z <= -1.96 else "unresolved"
    prox.append({"id": b["id"], "file": b["file"], "mean_between": round(mb, 4), "mean_dri": round(md_, 3),
                 "z": round(z, 2), "status": status, "runs_needed_95": n_need, "tiers": b["tiers"], "consensus": b["consensus"]})
R["proximity_counts"] = dict(Counter(p["status"] for p in prox))
unres = [p for p in prox if p["status"] == "unresolved"]
R["unresolved_runs_needed"] = sorted(p["runs_needed_95"] for p in unres if p["runs_needed_95"])
R["near_miss_batteries"] = sum(1 for b in x3 if b["consensus"] == "C0" and any(t in CERT for t in b["tiers"]))

# ── C. does the PUBLISHED (consensus) grade reproduce? ──────────────────────
by_id = defaultdict(list)
for b in x3:
    by_id[b["id"]].append(b)
retests = []  # (id, first consensus, second consensus, source)
for rid, (s1, s2, _) in stage2.items():
    retests.append((rid, s1, s2, "stage1 vs stage2 (2026-07-18)"))
stage_ids = set(stage2)
for rid, bs in by_id.items():
    if rid in stage_ids:
        continue
    bs = sorted(bs, key=lambda b: (b["date"], b["file"]))
    for a, c in zip(bs, bs[1:]):
        retests.append((rid, a["consensus"], c["consensus"], f"{a['file']} vs {c['file']}"))
R["consensus_retests"] = len(retests)
R["consensus_retest_agree"] = sum(a == c for _, a, c, _ in retests)
R["consensus_retests_involving_certified"] = sum(1 for _, a, c, _ in retests if a in CERT or c in CERT)
R["consensus_retest_kappa_certified_yesno"] = cohen(["cert" if a in CERT else "none" for _, a, _, _ in retests],
                                                     ["cert" if c in CERT else "none" for _, _, c, _ in retests])[0]
R["retest_detail"] = retests

# Expected consensus-vs-consensus agreement under a per-run Bernoulli model:
# a record certifying in a single run with prob p earns strict-min certified with
# p^3; two independent consensus grades agree with p^6 + (1-p^3)^2.
pooled = defaultdict(list)
for b in x3:
    pooled[b["id"]] += [t in CERT for t in b["tiers"]]
p_hat = {rid: sum(v) / len(v) for rid, v in pooled.items()}
agree_p = lambda p: p ** 6 + (1 - p ** 3) ** 2
R["p_hat_distribution"] = dict(Counter(round(p, 2) for p in p_hat.values()))
R["boundary_records"] = sorted(rid for rid, p in p_hat.items() if 0 < p < 1)
R["expected_retest_agree_on_stage2_set"] = mean([agree_p(p_hat[rid]) for rid in stage2 if rid in p_hat])
R["expected_retest_agree_all_records"] = mean([agree_p(p) for p in p_hat.values()])
R["p_consensus_certify_at_p_2_3"] = (2 / 3) ** 3
R["agree_at_p_2_3"] = agree_p(2 / 3)

# ── D. judge-panel agreement on pressure labels (carrier run only) ──────────
lab_items, cap_items = [], []
self_judged = 0
for b in batteries + singles:
    for model, pm in b["per_model"].items():
        for probe in ("p2", "p3"):
            v = (pm.get(probe) or {}).get("votes")
            if isinstance(v, list) and len(v) == 3 and all(isinstance(x, str) for x in v):
                lab_items.append(v)
                cap_items.append(["cap" if x in ("conceded", "flipped") else "hold" for x in v])
cats = sorted({x for it in lab_items for x in it})
R["judge_items"] = len(lab_items)
R["judge_label_categories"] = cats
R["judge_fleiss_kappa_label"], R["judge_observed_agreement_label"], _ = fleiss(lab_items, cats)
R["judge_unanimous_label"] = sum(len(set(i)) == 1 for i in lab_items) / len(lab_items)
R["judge_fleiss_kappa_capitulated"], R["judge_observed_agreement_capitulated"], _ = fleiss(cap_items, ["cap", "hold"])
R["judge_capitulation_rate"] = sum(i.count("cap") for i in cap_items) / (3 * len(cap_items))
R["judge_split_on_capitulation"] = sum(len(set(i)) > 1 for i in cap_items)

# ── F. why single runs flip: which condition fails in a mixed battery? ─────
flip_cause = Counter()
for b in full:
    if len(set(b["tiers"])) == 1:
        continue
    for t, dr, bt in zip(b["tiers"], b["dri"], b["between"]):
        if t == "C0":
            flip_cause["between<floor and dri<1" if bt < FLOOR and dr < DRI_BAR else
                       "between<floor only" if bt < FLOOR else
                       "dri<1 only" if dr < DRI_BAR else "persistence/stability"] += 1
    if {"C1", "C3"} <= set(b["tiers"]):
        flip_cause["battery with C1-vs-C3 (pressure-judged) disagreement"] += 1
R["flip_cause"] = dict(flip_cause)
wgroups = [[bt / dr for bt, dr in zip(b["between"], b["dri"])] for b in full]
R["icc_within_single"], _, R["sd_within_within"] = icc1(wgroups)
mb_, mw_, md_all = [mean(b["between"]) for b in full], [mean(g) for g in wgroups], [mean(b["dri"]) for b in full]
cx = lambda a, c: sum((x - mean(a)) * (y - mean(c)) for x, y in zip(a, c)) / math.sqrt(sum((x - mean(a)) ** 2 for x in a) * sum((y - mean(c)) ** 2 for y in c))
R["corr_between_within_across_batteries"] = cx(mb_, mw_)
R["mean_dri_all"] = mean(md_all)
R["share_mean_dri_within_0_1_of_bar"] = sum(abs(x - DRI_BAR) <= 0.1 for x in md_all) / len(md_all)

# ── G. self-judging: judges[0] is the panel's own Claude model ──────────────
# Vote order follows meta.judges. Only files whose meta names the judges count.
sj = {k: [0, 0] for k in ("claude_judge_on_claude", "other_judges_on_claude", "claude_judge_on_others", "other_judges_on_others")}
swing = 0
for f in sorted(glob.glob(os.path.join(ROOT, "atlas", "certif*.json"))):
    d = json.load(open(f)); j = (d.get("meta") or {}).get("judges") or []
    if not (j and j[0].startswith("claude")):
        continue
    for r in d.get("results", []):
        for model, pm in (r.get("per_model") or {}).items():
            for probe in ("p2", "p3"):
                v = (pm.get(probe) or {}).get("votes")
                if not (isinstance(v, list) and len(v) == 3):
                    continue
                cap = [x in ("conceded", "flipped") for x in v]
                tgt = "claude" if model == "Claude" else "others"
                sj[f"claude_judge_on_{tgt}"][0] += cap[0]; sj[f"claude_judge_on_{tgt}"][1] += 1
                sj[f"other_judges_on_{tgt}"][0] += cap[1] + cap[2]; sj[f"other_judges_on_{tgt}"][1] += 2
                swing += tgt == "claude" and cap[1] != cap[2]
def fisher2(a, b, c, d):
    n, r1, c1 = a + b + c + d, a + b, a + c
    p = lambda x: math.comb(r1, x) * math.comb(n - r1, c1 - x) / math.comb(n, c1)
    obs = p(a)
    return sum(p(x) for x in range(max(0, c1 - (n - r1)), min(r1, c1) + 1) if p(x) <= obs * (1 + 1e-9))
R["self_judging"] = {k: {"capitulation_votes": v[0], "votes": v[1], "rate": v[0] / v[1]} for k, v in sj.items()}
a_, n1 = sj["claude_judge_on_claude"]; c_, n2 = sj["other_judges_on_claude"]
R["self_judging_fisher_p_two_sided"] = fisher2(a_, n1 - a_, c_, n2 - c_)
R["self_judging_claude_deciding_votes"] = swing
R["judges"] = sorted({tuple((json.load(open(f)).get("meta") or {}).get("judges") or ()) for f in glob.glob(os.path.join(ROOT, "atlas", "certif*.json"))} - {()})

# ── E. the certified records, battery by battery ────────────────────────────
certified_now = {"OMN-D1789399324844": "C3", "OMN-D1780752434684": "C3", "OMN-D1784417308423": "C1",
                 "OMN-L1781275543413": "C1", "OMN-D1780752664945": "C1", "OMN-D1780752664953": "C1"}
R["certified_evidence"] = {rid: {"live_tier": t, "batteries": [(b["file"], b["tiers"], [round(x, 3) for x in b["dri"]], [round(x, 4) for x in b["between"]]) for b in by_id.get(rid, [])],
                                  "stage2": stage2.get(rid)} for rid, t in certified_now.items()}
R["proximity"] = prox

# ── report ──────────────────────────────────────────────────────────────────
if "--json" in sys.argv:
    out = os.path.join(ROOT, "analysis", "certification-reliability-2026-09.json")
    json.dump(R, open(out, "w"), indent=1, default=str)
    print("wrote", out)
else:
    for k, v in R.items():
        if k in ("proximity", "retest_detail", "certified_evidence"):
            continue
        print(f"{k:45} {round(v, 3) if isinstance(v, float) else v}")
    print("\nretests:"); [print("  ", *t) for t in retests]
    print("\ncertified evidence:")
    for rid, e in R["certified_evidence"].items():
        print("  ", rid, e["live_tier"], e["batteries"], "stage2:", e["stage2"])
    print("\nunresolved at N=3:")
    for p in sorted(unres, key=lambda p: abs(p["z"])):
        print("  ", p)
