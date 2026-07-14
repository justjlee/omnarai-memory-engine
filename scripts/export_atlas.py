#!/usr/bin/env python3
"""
export_atlas.py — Divergence Atlas -> validated JSONL for HuggingFace staging.

ARCHITECTURAL RULE (non-negotiable, handoff SESSION-BRIEF §4.2):
  Reads the CANONICAL DIVERGENCE STORE directly. Never the retrieval layer.
  Retrieval defects (bleed D3, drift D2) must not be able to touch record fidelity.

CANONICAL STORE — what it is and why (the D2 legibility artifact):
  The one store the engine WRITES divergence records into is the grown-memory blob
  `memory/grown.json` on Vercel Blob (appendGrownEntry in api/_grown.js — council
  persist, longitudinal cron, and atlas batch scripts all commit through it). The
  562-entry seed corpus (public/data/corpus.json) contains NO divergence records,
  and /api/divergences is a derived READ VIEW over this same blob. So: blob = store
  of record; everything else is downstream.
  Access path here: scripts/dump-grown.mjs snapshots the blob to
  scripts/.grown-snapshot.json via a direct, cache-busted blob fetch — a raw
  key-addressed read with no embedding ranking, no retrieval scoring, no view
  filtering. Run it immediately before this script; the export refuses a snapshot
  older than MAX_SNAPSHOT_AGE_MIN as a staleness guard.

SERIES SEMANTICS (determined from code, api/_council.js + api/council.js):
  OMN-D<epoch-ms>  one-shot Atlas capture — a new open question sent once to the
                   full council (id minted in _council.js buildDivergenceRecord).
  OMN-L<epoch-ms>  longitudinal-cadence record — the daily cron re-asks one of the
                   FROZEN 20-question canon (api/_canon.js); same record shape,
                   id overridden in council.js runLongitudinal, and stamped with
                   provenance.longitudinal {canon_id, epoch (calendar month),
                   source_record (the OMN-D it re-runs), original_score}.
  An OMN-L record is therefore a dated RE-RUN of an OMN-D question — perturbation/
  drift data, not redundancy. Both series export; `id_series` + `longitudinal`
  make the distinction machine-readable, and `question_group` links the pairs.

DERIVED FIELDS (everything else is verbatim from the store):
  id_series            "D" | "L" from the id prefix
  question_group       sha256 over whitespace/case-normalized question text —
                       normalization is for GROUPING ONLY; exported text is
                       byte-for-byte. Cross-validated against the store's explicit
                       longitudinal.source_record links at export time (hard fail
                       on disagreement).
  stale_model_version  true when any answer's model_id is a known-retired version.
                       The retired-id map is parsed AT RUNTIME out of
                       api/council.js SUPERSEDED_MODEL_IDS so this script cannot
                       drift from the engine's own freshness source of truth.
  stale_models[]       which answers are stale and what superseded them
  dataset_version      semver of this dataset build
"""

import json
import hashlib
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------- CONFIG
ROOT = Path(__file__).resolve().parent.parent
CANONICAL_STORE_DESC = "Vercel Blob memory/grown.json (see header); local snapshot scripts/.grown-snapshot.json via dump-grown.mjs"
SNAPSHOT = ROOT / "scripts" / ".grown-snapshot.json"
COUNCIL_JS = ROOT / "api" / "council.js"
SCHEMA_PATH = ROOT / "atlas" / "divergence-delta.schema.json"
OUT_DIR = ROOT / "atlas"
DATA_DIR = OUT_DIR / "data"
DATASET_VERSION = "1.0.0"
MAX_SNAPSHOT_AGE_MIN = 120

# Attribution identities allowed in curator-authored fields; personal-name
# denylist is sourced from an UNSTAGED local file (never hardcoded here).
DENYLIST_FILE = ROOT / "scripts" / ".pii-denylist.local"
PII_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),            # emails
    re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"),  # US phone shapes
]

# ---------------------------------------------------------------- HELPERS
def load_schema_validator():
    try:
        import jsonschema
    except ImportError:
        sys.exit("pip3 install --user jsonschema")
    schema = json.loads(SCHEMA_PATH.read_text())
    return lambda rec: jsonschema.validate(rec, schema)


def question_group_key(question: str) -> str:
    """Stable grouping key so re-runs of the same question link together.
    Normalization is for GROUPING ONLY — exported text stays byte-for-byte."""
    norm = re.sub(r"\s+", " ", question.strip().lower())
    return "QG-" + hashlib.sha256(norm.encode()).hexdigest()[:12]


def load_superseded_ids() -> dict:
    """Parse SUPERSEDED_MODEL_IDS out of api/council.js at runtime — single
    source of truth for staleness; this script must not carry its own copy."""
    src = COUNCIL_JS.read_text()
    m = re.search(r"SUPERSEDED_MODEL_IDS\s*=\s*\{(.*?)\}", src, re.S)
    if not m:
        sys.exit("STOP: SUPERSEDED_MODEL_IDS not found in api/council.js")
    return dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', m.group(1)))


def load_denylist() -> list:
    if not DENYLIST_FILE.exists():
        sys.exit(f"STOP: {DENYLIST_FILE.name} missing — the PII name denylist is "
                 "an unstaged local file; create it (one name per line) so V7/V8 "
                 "sweep against real names without staging them.")
    return [l.strip() for l in DENYLIST_FILE.read_text().splitlines()
            if l.strip() and not l.startswith("#")]


def sweep_pii(rec: dict, denylist: list) -> list:
    hits = []
    blob = json.dumps(rec, ensure_ascii=False)
    for pat in PII_PATTERNS:
        hits += [m.group(0) for m in pat.finditer(blob)]
    low = blob.lower()
    hits += [name for name in denylist if name.lower() in low]
    return hits


def load_canonical_records() -> list:
    """Read raw records from the store snapshot. NO retrieval layer, NO
    embedding-ranked access path; answer text passes through untouched."""
    if not SNAPSHOT.exists():
        sys.exit("STOP: run `node scripts/dump-grown.mjs` first (see header).")
    age_min = (time.time() - SNAPSHOT.stat().st_mtime) / 60
    if age_min > MAX_SNAPSHOT_AGE_MIN:
        sys.exit(f"STOP: snapshot is {age_min:.0f} min old (> {MAX_SNAPSHOT_AGE_MIN}); re-run dump-grown.mjs.")
    grown = json.loads(SNAPSHOT.read_text())
    return [e for e in grown["entries"]
            if e.get("type") == "divergence" and e.get("divergence")]


# ---------------------------------------------------------------- MAIN
def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    validate = load_schema_validator()
    denylist = load_denylist()
    superseded = load_superseded_ids()
    entries = load_canonical_records()
    store_count = len(entries)

    groups = defaultdict(list)
    exported, excluded, review = [], [], []

    for e in sorted(entries, key=lambda x: x["id"]):
        d = e["divergence"]
        answers = [{"model": a.get("model"), "lab": a.get("lab"),
                    "model_id": a.get("model_id") or "unattested",  # never infer
                    "date": a.get("date"), "text": a.get("text")}
                   for a in d.get("answers", [])]
        stale = [{"model": a["model"], "model_id": a["model_id"],
                  "superseded_by": superseded[a["model_id"]]}
                 for a in answers if a["model_id"] in superseded]
        rec = {
            "id": e["id"],
            "id_series": ("L" if e["id"].startswith("OMN-L")
                          else "D" if e["id"].startswith("OMN-D") else "unknown"),
            "dataset_version": DATASET_VERSION,
            "question": d["question"],
            "question_group": question_group_key(d["question"]),
            "captured_at": e.get("date"),
            "method": d.get("method"),
            "contributors": e.get("contributors", []),
            "answers": answers,
            "tensions": d.get("tensions", []),
            "deliberation_card": d.get("deliberation_card"),
            "divergence_score": d.get("score"),
            "certification": d.get("certification"),
            "longitudinal": d.get("longitudinal"),
            "stale_model_version": bool(stale),
            "stale_models": stale,
        }

        pii = sweep_pii(rec, denylist)
        if pii:
            review.append({"id": rec["id"], "hits": sorted(set(pii))})

        try:
            validate(rec)
        except Exception as err:  # exclude-and-log, NEVER silently drop (§3.2)
            excluded.append({"id": rec.get("id", "?"), "reason": str(err)[:500]})
            continue

        groups[rec["question_group"]].append(rec["id"])
        exported.append(rec)

    # Cross-validate hash grouping against the store's explicit re-run links:
    # every OMN-L must share its group with its longitudinal.source_record.
    for rec in exported:
        lon = rec.get("longitudinal")
        if lon and lon.get("source_record"):
            if lon["source_record"] not in groups.get(rec["question_group"], []):
                print(f"STOP: question_group broke a store-attested re-run link "
                      f"({rec['id']} -> {lon['source_record']}).", file=sys.stderr)
                return 4

    out = DATA_DIR / f"atlas-v{DATASET_VERSION}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for rec in exported:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    (OUT_DIR / "excluded.log").write_text(
        "\n".join(json.dumps(x) for x in excluded) + "\n" if excluded else "# none\n")
    (OUT_DIR / "review-needed.log").write_text(
        "\n".join(json.dumps(x) for x in review) + "\n" if review else "# none\n")

    cert_tally = defaultdict(int)
    for rec in exported:
        cert_tally[(rec["certification"] or {}).get("tier", "untested")] += 1
    manifest = {
        "dataset_version": DATASET_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "canonical_store": CANONICAL_STORE_DESC,
        "store_count": store_count,
        "exported_count": len(exported),          # V1: must equal store_count
        "excluded_count": len(excluded),          #     unless exclusions listed
        "review_needed_count": len(review),
        "series_counts": {s: sum(1 for r in exported if r["id_series"] == s)
                          for s in ("D", "L")},
        "stale_flagged_count": sum(1 for r in exported if r["stale_model_version"]),
        "certification_tiers": dict(cert_tally),
        "question_groups": len(groups),
        "multi_run_groups": sum(1 for v in groups.values() if len(v) > 1),
        "series_meaning": {
            "D": "one-shot Atlas capture (new open question, asked once)",
            "L": "longitudinal re-run of a frozen-canon question (monthly epoch; links to its OMN-D source via longitudinal.source_record)",
        },
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))

    # Hard exit conditions — staging must not proceed past these:
    if review:
        print("STOP: PII review required (review-needed.log).", file=sys.stderr)
        return 2
    if store_count != len(exported) + len(excluded):
        print("STOP: record accounting mismatch (D2!).", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
