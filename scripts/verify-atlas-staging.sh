#!/bin/bash
# Verify a STAGED Divergence Atlas export against the canonical store and the live API.
#
#   ./scripts/verify-atlas-staging.sh [staging-dir]   # default: huggingface/staging/atlas-2026-07-14
#
# NOTE ON PROVENANCE: the 2026-07-14 session brief referenced a check suite V1–V8 defined
# in a handoff file (05-verify-atlas.sh) that does not exist in this repo (SESSION-LOG.md R0).
# These checks (SA-1..SA-7) are this session's own definitions — objective properties of the
# staged artifact, verifiable without the missing spec. If 05-verify-atlas.sh surfaces, map
# V1–V8 onto these rather than assuming equivalence.
#
# Requires: scripts/.grown-snapshot.json (run `node scripts/dump-grown.mjs` first) + network
# for the one live-API cross-check (sent with the x-omnarai-self header).
set -u
DIR="${1:-huggingface/staging/atlas-2026-07-14}"
cd "$(dirname "$0")/.." || exit 1

FAIL=0
check() { # name, exit-code, detail
  if [ "$2" -eq 0 ]; then echo "  PASS  $1"; else echo "  FAIL  $1 — $3"; FAIL=1; fi
}

echo "Verifying staged Atlas in $DIR"

# SA-1 — files exist and are non-empty
missing=""
for f in divergences.jsonl divergence-answers.jsonl divergence-tensions.csv divergence-atlas.md atlas-build-manifest.json; do
  [ -s "$DIR/$f" ] || missing="$missing $f"
done
[ -z "$missing" ]; check "SA-1 files present and non-empty" $? "missing:$missing"

python3 - "$DIR" <<'PY'
import json, sys, csv, re, urllib.request

d = sys.argv[1]
fails = []
def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f" — {detail}"))
    if not ok: fails.append(name)

recs = [json.loads(l) for l in open(f"{d}/divergences.jsonl") if l.strip()]
ids = [r["id"] for r in recs]

# SA-2 — record count, id uniqueness, series purity (OMN-D only; no OMN-L / OMN-DD leakage)
impure = [i for i in ids if not re.fullmatch(r"OMN-D\d+", i)]
check("SA-2 100 unique OMN-D records, no series leakage",
      len(recs) == 100 and len(set(ids)) == 100 and not impure,
      f"n={len(recs)} unique={len(set(ids))} impure={impure[:3]}")

# SA-3 — cross-file consistency + referential integrity
answers = [json.loads(l) for l in open(f"{d}/divergence-answers.jsonl") if l.strip()]
tensions = list(csv.DictReader(open(f"{d}/divergence-tensions.csv")))
idset = set(ids)
check("SA-3 answers/tensions match records and reference real ids",
      len(answers) == sum(r["n_models"] for r in recs)
      and len(tensions) == sum(r["n_tensions"] for r in recs)
      and all(a["question_id"] in idset for a in answers)
      and all(t["question_id"] in idset for t in tensions),
      f"answers={len(answers)} vs {sum(r['n_models'] for r in recs)}; tensions={len(tensions)} vs {sum(r['n_tensions'] for r in recs)}")

# SA-4 — canonical-store equivalence: exactly the store's OMN-D records, questions verbatim
store = json.load(open("scripts/.grown-snapshot.json"))["entries"]
store_d = {e["id"]: e for e in store if e.get("type") == "divergence" and e.get("divergence") and re.fullmatch(r"OMN-D\d+", e["id"])}
same_ids = set(store_d) == idset
same_q = all(store_d[r["id"]]["divergence"]["question"] == r["question"] for r in recs) if same_ids else False
check("SA-4 export == canonical store OMN-D set, questions verbatim",
      same_ids and same_q,
      f"store={len(store_d)} export={len(idset)} symdiff={sorted(set(store_d) ^ idset)[:4]}")

# SA-5 — certification passthrough matches the store; C1 record present
cert_store = {i: e["divergence"].get("certification") for i, e in store_d.items()}
cert_ok = all(r.get("certification") == cert_store[r["id"]] for r in recs)
c1 = [r for r in recs if (r.get("certification") or {}).get("tier") == "C1"]
check("SA-5 certification blocks verbatim from store (1 × C1 present)",
      cert_ok and len(c1) == 1 and c1[0]["id"] == "OMN-D1780757185044",
      f"cert_match={cert_ok} c1={[r['id'] for r in c1]}")

# SA-6 — live-API cross-check on the certified record (view must agree with the export)
try:
    req = urllib.request.Request(
        "https://omnarai.vercel.app/api/divergences?id=OMN-D1780757185044",
        headers={"x-omnarai-self": "1"})
    live = json.load(urllib.request.urlopen(req, timeout=30))
    exp = c1[0] if c1 else {}
    ok = (live.get("certification", {}).get("tier") == "C1"
          and live.get("question") == exp.get("question")
          and [a["text"] for a in live.get("answers", [])] == [a["text"] for a in exp.get("answers", [])])
    check("SA-6 live API agrees with export on the certified record", ok, "live/export mismatch")
except Exception as e:
    check("SA-6 live API agrees with export on the certified record", False, f"unreachable: {e}")

# SA-7 — card states the computed counts and carries no unresolved placeholders
card = open(f"{d}/divergence-atlas.md").read()
n_ans, n_ten = len(answers), len(tensions)
check("SA-7 card counts match data; no {VERIFY:} placeholders",
      f"**{len(recs)}** divergence records" in card
      and f"**{n_ans}** verbatim model answers" in card
      and f"**{n_ten}** named, structured disagreements" in card
      and "{VERIFY" not in card,
      "card text out of sync with data")

sys.exit(1 if fails else 0)
PY
[ $? -eq 0 ] || FAIL=1

if [ $FAIL -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "CHECKS FAILED"; exit 1; fi
