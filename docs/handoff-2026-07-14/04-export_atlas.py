#!/usr/bin/env python3
"""
export_atlas.py — Divergence Atlas -> validated JSONL for HuggingFace staging.

ARCHITECTURAL RULE (non-negotiable, SESSION-BRIEF §4.2):
  Reads the CANONICAL DIVERGENCE STORE directly. Never the retrieval layer.
  Retrieval defects (bleed D3, drift D2) must not be able to touch record fidelity.

CLAUDE CODE: before running —
  1. Set CANONICAL_STORE below to the true store (file/table/collection) and
     document HERE why it is canonical (this header is the D2 legibility artifact).
  2. Confirm field names against divergence-delta.schema.json in the repo.
  3. Determine the OMN-L vs OMN-D series semantics from code; fill SERIES_MEANING.

Baseline at 2026-07-14 (live MCP browse): 110 records, series OMN-L / OMN-D,
5 answers + 3-4 tensions typical, stale-model-version flags present.
"""

import json
import hashlib
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------- CONFIG
CANONICAL_STORE = Path("REPLACE_ME")   # <- the ONE source of truth. Document why.
SERIES_MEANING = {"L": "TBD_FROM_CODE", "D": "TBD_FROM_CODE"}
SCHEMA_PATH    = Path("divergence-delta.schema.json")
OUT_DIR        = Path("atlas")
DATASET_VERSION = "1.0.0"

# Attribution identities allowed in records; any OTHER personal-name-like token
# in curator-authored fields triggers review. (Answers are verbatim model output
# and are swept but expected to be clean of project-personal names.)
ALLOWED_IDENTITIES = {"xz", "Omnai", "Claude | xz", "Claude", "GPT-4o", "Gemini",
                      "Grok", "DeepSeek", "Perplexity", "Meta AI", "Vail-3"}
PII_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),          # emails
    re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"), # US phone shapes
    # CLAUDE CODE: add the project's personal-name denylist here from repo config,
    # never hardcode names into a staged file.
]

# ---------------------------------------------------------------- HELPERS
def load_schema_validator():
    try:
        import jsonschema
    except ImportError:
        sys.exit("pip install jsonschema --break-system-packages")
    schema = json.loads(SCHEMA_PATH.read_text())
    return lambda rec: jsonschema.validate(rec, schema)

def question_group_key(question: str) -> str:
    """Stable grouping key so re-runs of the same question link together.
    Normalization is for GROUPING ONLY — exported text stays byte-for-byte."""
    norm = re.sub(r"\s+", " ", question.strip().lower())
    return "QG-" + hashlib.sha256(norm.encode()).hexdigest()[:12]

def sweep_pii(rec: dict) -> list[str]:
    hits = []
    blob = json.dumps(rec, ensure_ascii=False)
    for pat in PII_PATTERNS:
        hits += [m.group(0) for m in pat.finditer(blob)]
    return hits

def load_canonical_records() -> list[dict]:
    """CLAUDE CODE: implement against the real store. Requirements:
       - read raw records, NO retrieval layer, NO embedding-ranked access path
       - preserve answer text byte-for-byte
       - carry through: id, question, answers[{model, model_version|'unattested',
         text}], tensions[], stale_model_version, holdform_risk?, captured_at
    """
    raise NotImplementedError("Wire to canonical store; see header rules.")

# ---------------------------------------------------------------- MAIN
def main() -> int:
    OUT_DIR.mkdir(exist_ok=True)
    validate = load_schema_validator()
    records = load_canonical_records()
    store_count = len(records)

    groups = defaultdict(list)
    exported, excluded, review = [], [], []

    for rec in records:
        rec.setdefault("dataset_version", DATASET_VERSION)
        rec["question_group"] = question_group_key(rec["question"])
        rec["id_series"] = ("L" if rec["id"].startswith("OMN-L")
                            else "D" if rec["id"].startswith("OMN-D")
                            else "unknown")
        for ans in rec.get("answers", []):
            ans.setdefault("model_version", "unattested")  # never infer (§4.4)

        pii = sweep_pii(rec)
        if pii:
            review.append({"id": rec["id"], "hits": pii})

        try:
            validate(rec)
        except Exception as e:  # exclude-and-log, NEVER silently drop (§3.2)
            excluded.append({"id": rec.get("id", "?"), "reason": str(e)[:500]})
            continue

        groups[rec["question_group"]].append(rec["id"])
        exported.append(rec)

    out = OUT_DIR / f"atlas-v{DATASET_VERSION}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for rec in exported:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    (OUT_DIR / "excluded.log").write_text(
        "\n".join(json.dumps(x) for x in excluded) or "# none\n")
    (OUT_DIR / "review-needed.log").write_text(
        "\n".join(json.dumps(x) for x in review) or "# none\n")

    manifest = {
        "dataset_version": DATASET_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "canonical_store": str(CANONICAL_STORE),
        "store_count": store_count,
        "exported_count": len(exported),          # V1: must equal store_count
        "excluded_count": len(excluded),          #     unless exclusions listed
        "review_needed_count": len(review),
        "question_groups": len(groups),
        "multi_run_groups": sum(1 for v in groups.values() if len(v) > 1),
        "series_meaning": SERIES_MEANING,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
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
