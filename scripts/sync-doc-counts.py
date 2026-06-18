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
CORE = CURATED = OPEN = None
_SRC = "live /api/info"
try:
    with urllib.request.urlopen("https://omnarai.vercel.app/api/info", timeout=8) as r:
        info = json.loads(r.read())
    WORKS = int(info["corpus"]["totalWorks"])
    WORDS = int(info["corpus"]["totalWords"])
    NODES = int(info["conceptGraph"].get("nodes", NODES))
    EDGES = int(info["conceptGraph"].get("edges", EDGES))
    rings = info["corpus"].get("rings", {})
    CORE, CURATED, OPEN = rings.get("core"), rings.get("curated"), rings.get("open")
except Exception as e:
    CORPUS = json.loads((BASE / "public/data/corpus.json").read_text())
    WORKS = len(CORPUS)
    WORDS = sum(int(r.get("wordCount", 0) or 0) for r in CORPUS)
    _SRC = f"LOCAL fallback (live unreachable: {e}) — undercounts grown blob"
WORDS_K = round(WORDS / 1000)

# Ring-breakdown patterns (only added when live rings are known — local fallback
# can't supply them). These are the literals that silently drifted to 113/182/3.
_RING_SUBS = []
if None not in (CORE, CURATED, OPEN):
    _RING_SUBS = [
        (r"(\*\*Core Canon\*\* \()\d+( works\))", rf"\g<1>{CORE}\g<2>"),
        (r"(### Core Canon \()\d+( works total)", rf"\g<1>{CORE}\g<2>"),
        (r"(\*\*Curated Expansions\*\* \()\d+( works\))", rf"\g<1>{CURATED}\g<2>"),
        (r"(### Curated Expansions \()\d+( works total)", rf"\g<1>{CURATED}\g<2>"),
        (r"(\*\*Open Exploration\*\* \()\d+( works\))", rf"\g<1>{OPEN}\g<2>"),
        (r"(### Open Exploration \()\d+( works total)", rf"\g<1>{OPEN}\g<2>"),
    ]
# "live engine serves N" appears in both context.md and llms.txt and drifted to 565.
_SERVES = (r"(live engine serves )\d+", rf"\g<1>{WORKS}")

# index.html ring breakdown uses a plain "Core Canon (N works)" form (no bold,
# no "total") — distinct from the context.md patterns above.
_INDEX_RING_SUBS = []
if None not in (CORE, CURATED, OPEN):
    _INDEX_RING_SUBS = [
        (r"(Core Canon \()\d+( works\))", rf"\g<1>{CORE}\g<2>"),
        (r"(Curated Expansions \()\d+( works\))", rf"\g<1>{CURATED}\g<2>"),
        (r"(Open Exploration \()\d+( works\))", rf"\g<1>{OPEN}\g<2>"),
    ]

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
        # phrasings that drifted to 565/523K (changelog + footer prose):
        (r"308 → \*\*\d+ works\*\* \(~[\d,]+K words\)",
         f"308 → **{WORKS} works** (~{WORDS_K}K words)"),
        (r"corpus growth to \d+ works \(~[\d,]+K words\)",
         f"corpus growth to {WORKS} works (~{WORDS_K}K words)"),
        _SERVES,
        *_RING_SUBS,
    ]),
    (BASE / "public/llms.txt", [
        (r"\*\*Current corpus:\*\* [\d,]+ works \(~[\d.]+K words\)",
         f"**Current corpus:** {WORKS} works (~{WORDS_K}K words)"),
        (r"`/data/concepts\.json` \(\d+ nodes, \d+ edges\)",
         f"`/data/concepts.json` ({NODES} nodes, {EDGES} edges)"),
        _SERVES,
    ]),
    # Cold-start packet — pasted whole into network-isolated models; a stale
    # count here is the worst place for one (it's the model's only source).
    (BASE / "public/omnarai-cold-start.md", [
        (r"\b\d{3,} works\b", f"{WORKS} works"),
    ]),
    # The landing page / front door — meta description, OG card, hero copy, and
    # the ring breakdown. This is the first surface an arriving mind reads.
    (BASE / "index.html", [
        (r"\b\d[\d,]* attributed works", f"{WORKS} attributed works"),
        (r"~[\d,]+k words", f"~{WORDS_K}k words"),
        # body copy is deliberately ROUNDED ("~528,000"), keep it rounded (the "~"
        # signals approximate) — don't force the exact 528,208.
        (r"~[\d,]{4,} words", f"~{WORDS_K * 1000:,} words"),
        (r"\b\d+-node, \d+-edge", f"{NODES}-node, {EDGES}-edge"),
        *_INDEX_RING_SUBS,
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
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if any literal is stale (drift gate; writes nothing)")
    ap.add_argument("--require-live", action="store_true",
                    help="refuse to write unless counts came from live /api/info "
                         "(prevents auto-apply from downgrading to a stale local seed count)")
    args = ap.parse_args()

    # Safety for unattended use (deploy auto-sync): if we fell back to the local
    # seed (live engine unreachable), the count UNDERCOUNTS the grown blob. Writing
    # it would silently downgrade every surface. Refuse rather than corrupt.
    if args.apply and args.require_live and _SRC.startswith("LOCAL"):
        print(f"  --require-live: live /api/info unreachable ({_SRC}). "
              f"Skipping write to avoid downgrading counts. Docs left untouched.\n")
        return

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

    if args.check and total_changes:
        if _SRC.startswith("LOCAL"):
            print("  --check INCONCLUSIVE: live /api/info unreachable; not failing.\n")
            return
        print(f"  DRIFT GATE FAILED: {total_changes} file(s) carry stale counts "
              f"vs {_SRC}. Run with --apply, commit, then redeploy.\n")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
