#!/usr/bin/env python3
"""
Recompute the corpus/concept counts that are hand-hardcoded across the
AI-facing docs and bump every known literal in one shot.

The ordeal this removes: context.md, llms.txt, for-researchers.html, CLAUDE.md
and the MCP repo each embed the corpus size in prose, in ~3 different
phrasings each. After an ingest they all silently go stale.

Authoritative numbers are computed from the freshly-built local data:
  works  = public/data/corpus.json length
  words  = sum of wordCount (Reddit) — matches the /api/info basis
  nodes/edges = public/data/concepts.json

Default: dry-run (prints the unified diff it WOULD apply). --apply writes.
Anything that doesn't match a known pattern is reported, never guessed at.
"""

import argparse
import json
import re
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent.parent
MCP = BASE.parent / "omnarai-mcp"
CONCEPTS = json.loads((BASE / "public/data/concepts.json").read_text())

# Authoritative source = live /api/info: it is, by definition, the number a
# visiting intelligence actually sees (seed + grown-blob entries). Local
# corpus.json alone undercounts by the grown delta. Fall back to local +
# warn if the engine is unreachable.
NODES = len(CONCEPTS.get("nodes", []))
EDGES = len(CONCEPTS.get("edges", []))
_SRC = "live /api/info"
try:
    with urllib.request.urlopen("https://omnarai.vercel.app/api/info", timeout=8) as r:
        info = json.loads(r.read())
    WORKS = int(info["corpus"]["totalWorks"])
    WORDS = int(info["corpus"]["totalWords"])
    NODES = int(info["conceptGraph"].get("nodes", NODES))
    EDGES = int(info["conceptGraph"].get("edges", EDGES))
except Exception as e:
    CORPUS = json.loads((BASE / "public/data/corpus.json").read_text())
    WORKS = len(CORPUS)
    WORDS = sum(int(r.get("wordCount", 0) or 0) for r in CORPUS)
    _SRC = f"LOCAL fallback (live unreachable: {e}) — undercounts grown blob"
WORDS_K = round(WORDS / 1000)

# (path, [(regex, replacement), ...]) — patterns are deliberately specific.
TARGETS = [
    (BASE / "public/omnarai.context.md", [
        (r"\*\*Corpus:\*\* [\d,]+ works \(~[\d.]+K words\)",
         f"**Corpus:** {WORKS} works (~{WORDS_K}K words)"),
        (r"The knowledge graph has \d+ concept nodes and \d+ edges",
         f"The knowledge graph has {NODES} concept nodes and {EDGES} edges"),
        (r"The full corpus contains [\d,]+ works",
         f"The full corpus contains {WORKS} works"),
        (r"d3-force graph of \d+ concept nodes and \d+ edges",
         f"d3-force graph of {NODES} concept nodes and {EDGES} edges"),
    ]),
    (BASE / "public/llms.txt", [
        (r"\*\*Current corpus:\*\* [\d,]+ works \(~[\d.]+K words\)",
         f"**Current corpus:** {WORKS} works (~{WORDS_K}K words)"),
        (r"`/data/concepts\.json` \(\d+ nodes, \d+ edges\)",
         f"`/data/concepts.json` ({NODES} nodes, {EDGES} edges)"),
    ]),
    (BASE / "public/for-researchers.html", [
        (r"\d[\d,]* works · [\d,]+ words",
         f"{WORKS} works · {WORDS:,} words"),
        (r"concept graph · \d+ nodes \d+ edges",
         f"concept graph · {NODES} nodes {EDGES} edges"),
        (r"\d[\d,]* attributed works across",
         f"{WORKS} attributed works across"),
    ]),
    (BASE / "CLAUDE.md", [
        (r"Realms of Omnarai — [\d,]+ works \(~[\d.]+K words\)",
         f"Realms of Omnarai — {WORKS} works (~{WORDS_K}K words)"),
        (r"Live stats from /api/info \([\d,]+ works, [\d.]+K words",
         f"Live stats from /api/info ({WORKS} works, {WORDS_K}K words"),
    ]),
    (MCP / "index.js", [
        (r"\b\d[\d,]*-work corpus", f"{WORKS}-work corpus"),
        (r"against the \d[\d,]*-work corpus", f"against the {WORKS}-work corpus"),
        (r"- \d[\d,]* works, [\d,]+ words", f"- {WORKS} works, {WORDS:,} words"),
    ]),
    (MCP / "openai-tools.json", [
        (r"\b\d[\d,]*-work corpus", f"{WORKS}-work corpus"),
    ]),
    (MCP / "README.md", [
        (r"\b\d[\d,]*-work multi-intelligence research corpus",
         f"{WORKS}-work multi-intelligence research corpus"),
        (r"\b\d[\d,]*-work multi-intelligence corpus",
         f"{WORKS}-work multi-intelligence corpus"),
        (r"\ba \d[\d,]*-work corpus", f"a {WORKS}-work corpus"),
        (r"\*\*Corpus:\*\* [\d,]+ works \([^)]*\), [\d,]+ words[^\n]*",
         f"**Corpus:** {WORKS} works (seed + engine-generated syntheses), {WORDS:,} words, May 2025–present"),
    ]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    print(f"Authoritative ({_SRC}): {WORKS} works · {WORDS:,} words · "
          f"{NODES} nodes · {EDGES} edges\n")
    total_changes = 0
    for path, subs in TARGETS:
        if not path.exists():
            print(f"  SKIP (missing): {path}")
            continue
        text = orig = path.read_text()
        hits = []
        for pat, repl in subs:
            new, n = re.subn(pat, repl, text)
            if n:
                hits.append(f"    {pat[:50]}… ×{n}")
                text = new
        if text != orig:
            total_changes += 1
            rel = path.relative_to(BASE.parent)
            print(f"  {'WRITE' if args.apply else 'WOULD CHANGE'}: {rel}")
            for h in hits:
                print(h)
            if args.apply:
                path.write_text(text)
        # else: silent — file already current
    if total_changes == 0:
        print("  All doc counts already current.")
    elif not args.apply:
        print(f"\n  {total_changes} file(s) would change. Re-run with --apply.")
    print()


if __name__ == "__main__":
    main()
