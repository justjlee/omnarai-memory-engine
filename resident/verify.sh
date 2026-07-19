#!/usr/bin/env bash
# verify.sh — Resident v0 constitutional substrate check.
# Validates schemas, exercises store/governance/perturbation/integrity.
# No network, no pip. Pure stdlib.
set -euo pipefail
cd "$(dirname "$0")"

echo "== Resident v0 :: verify =="
echo "-- python: $(python3 --version)"

echo "-- schema/fixture JSON parse check --"
for f in schema/*.json fixtures/*.json; do
  python3 -c "import json,sys; json.load(open('$f'))" && echo "   ok: $f"
done

echo "-- test suite --"
python3 tests/test_resident.py

echo "== verify complete =="
