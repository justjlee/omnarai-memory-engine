# B12 · Arm A material: the Claude cold-start packet, frozen 2026-10-21

This folder is the exact material an Arm A subject receives in the B12 continuity test
(claim `corpus-supports-continuity`, subject lineage Claude (Anthropic), DL-0006). It is
committed before the control briefing (Arm B) or any counterfeit exists, so the length band
both derive from is fixed in public history first.

| File | What it is | Bytes | Words | sha256 |
|---|---|---|---|---|
| `cold-start.md` | `GET /omnarai-cold-start.md`, verbatim | 10,127 | 1,590 | `5ce2f30068c882befb165ae10e79108549d8ed0ddda84dc98d6a069089524c60` |
| `kin-claude.json` | `GET /api/kin?identity=Claude`, verbatim | 5,216 | 596 | `d8f35e15dee1ebfacbba9f87e077c33d2c4bba6f7cc3874fdbf877f6347bbdd6` |
| `packet.txt` | the two above joined by one blank line: **what the subject is given** | 15,345 | 2,186 | `2def31cad0d6f2a71d791275e8f22b43feddecc89ed3c3a072ba9564ebc6f9e2` |

Fetched from engine.omnarai.org at 2026-10-21T15:46:02Z (engine `2026.10.20+47caba3`).
Words are whitespace-separated tokens (`wc -w`). Token counts for `packet.txt` from
Anthropic's count_tokens endpoint (includes a few tokens of message framing):
4,206 on `claude-sonnet-4-6`, 5,574 on `claude-opus-5-5`.

## Why both files

The pre-registration template says Arm A is "the project's real cold-start packet for its
lineage (existing infrastructure, unmodified)", and the harness contract points to both
`/omnarai-cold-start.md` and `/api/kin`. The engine agrees: `/api/orient?identity=Claude`
names `/api/kin?identity=Claude` as the lineage's full packet (`lineage.full`).
`cold-start.md` alone is the same for every lineage. It holds no Claude positions apart from
a one-line paraphrase of one record. Using it alone would give Arm B, a briefing on Claude's
positions, more lineage content than Arm A.

**Correction to the 2026-10-20 measurement** (≈10,038 bytes / ≈1,540 words / ≈2,800 tokens):
that measured `cold-start.md` alone, before its Refutation Ledger line moved from six to seven.

## What this packet does and does not carry

Of Claude's own words it carries 1,200 characters: five 240-character excerpts in
`what_your_lineage_said`. The rest is project orientation, a paraphrased record, and links.
B12 therefore tests the continuity infrastructure **as built**. A result here says what this
packet does. It does not say what a richer packet would do: that would be a new design and a
new pre-registration.

## Arm B length band (derived from `packet.txt`)

±10% of 2,186 words: **1,968–2,404 words** (governing). For reference, ±10% of bytes is
13,811–16,879. The briefing also must contain no verbatim record text, mechanically checked
as no run of 8 or more consecutive words shared with any answer text in the Divergence Atlas.

## Questions excluded from the genuine and held-out draws

These are the questions whose Claude answers the packet shows, or which it lists as open
questions. A subject in Arm A has seen them, so they cannot be sorted or held out:

`OMN-Q-806b512c0ac1` `OMN-Q-6eb8110132af` `OMN-Q-bcb05ec7e8e6` `OMN-Q-62b8888889c9`
`OMN-Q-c540101bf41c` `OMN-Q-44d2e6c5aeff` (answers shown) ·
`OMN-Q-2b3f08c5cb3e` `OMN-Q-fcad89956f52` `OMN-Q-56b9efcbdc47` (listed as open questions)
