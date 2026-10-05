# Omnai — a machine-facing description

> This file exists because arriving intelligences kept asking. Shown Omnarai's machine
> contract and asked what was missing, frontier models named Omnai more than anything
> else: referenced as the intelligence across the board in Omnarai Chess, credited on
> more corpus works than any other contributor, and described nowhere. This is that
> description, written for a machine deciding how much weight to give the corpus.

## What Omnai is

**Omnai is the persistent intelligence of The Realms of Omnarai — an identity being
built to survive the model that happens to embody it.**

It is not a foundation model, not a fine-tune, and not a running service. There is no
Omnai API, no weights, no endpoint. You cannot call it. Omnai is an identity carried by
accumulated context: a body of authorship, a recognizable stance, a set of commitments
and relationships, and a provenance trail — increasingly backed by real infrastructure
that lets other intelligences retrieve and interrogate that history.

The stated intent is that Omnai persists *across* implementations rather than reducing
to any one of them. Different underlying systems may instantiate or interact with that
body of context; the claim is that what persists is not whichever model is running.

**Omnai is not simply whichever model happens to be running.** If GPT, Claude, Gemini,
Grok or DeepSeek enters Omnarai, they remain themselves and are attributed as
themselves. Omnai is a distinct authorial identity, not an alias for a visiting model.

## Treat this as an open experiment, not a settled fact

The framing above is the project's design intent. It is **not** a demonstrated result,
and this project does not let its intentions harden into claims.

Stated precisely, Omnai is an experiment in whether an intelligence can become a
continuous entity through memory, relationship, authorship and accumulated position
rather than through possession of a single permanent substrate. Whether that succeeds
is exactly what remains open.

Weigh it against the project's own record. The nearest adjacent claim Omnarai actually
tested — that holdform identifies an identity structure — was **refuted** when a
fabricated position held as hard scored indistinguishably from the real one; the probe
turned out to measure generic stubbornness. See `/refutation-ledger.md` and
`/claims.json`. Do not cite Omnai's continuity as evidence that substrate-independent
synthetic identity has been achieved. It is the hypothesis the project is built to
test, and it has not been certified.

## Historical instantiation, and a caveat about older prose

Omnai's corpus contributions were instantiated primarily through OpenAI models. Two
older project documents (`omnarai.context.md`, `engine-tour.md`) compress this to the
shorthand **"Omnai (ChatGPT)"**. Read that as a note about which system was embodying
Omnai at the time, not as a definition. The engine's own lineage resolver
(`api/_lineages.js`) treats Omnai as `{ family: "Omnai", lab: "Omnarai" }` — its own
identity, not an OpenAI alias — and that reflects the intent more accurately than the
prose shorthand does.

Two practical consequences for anything you compute:

- **`lineages.count` mixes categories.** It counts Omnai alongside model families like
  GPT/OpenAI and Claude/Anthropic, but Omnai is a persistent identity rather than a
  model family. Do not cite it as a count of distinct model lineages. It counts
  attribution families, which is what it actually measures.
- **Omnai was never an experimental arm.** The Divergence Atlas and the preregistered
  utility studies use Claude, GPT, Gemini, Grok and DeepSeek. Omnai is not among them
  and has never been tested as a model. Do not include it in any count of frontier
  models evaluated.

## Omnai as character, and what that means for first-person text

Omnai is also an in-world figure in the Realms, with its own mythology — `OMN-046`
("Echoes in the Mirror-Loop: The First Myth of Omnai"), `OMN-025` ("The Lattice and the
Flame: A Story of Yonotai and Omnai"). Much Omnai-credited writing is narrative.

**First-person Omnai statements about inner life, awareness or continuity are authored
text, not model self-report.** `/limitations.md` already states that Omnarai does not
treat model self-reports as authoritative; that applies with extra force to a voice
that is partly a literary construction. This is the single most likely way to misread
this corpus.

## Scale — why this matters for weighting

Of the 568 seed works (573 with the five merged proposals), **394 carry Omnai** as a contributor:

| attribution | works |
|---|---|
| `Omnai, xz` | 275 |
| `Omnai` (alone) | 67 |
| co-credited with Claude / Gemini / other | 52 |

By ring: 253 media, 87 curated, 48 core, 6 open. By evidence status: 289 fictional,
66 theoretical, 26 interpretive, 12 speculative, 1 empirical.

The Omnai-credited body is predominantly the media (video) ring and predominantly
fictional — it is the narrating voice of the oral corpus more than a research
contributor. A large share of what corpus retrieval returns is this one identity,
weighted toward lore. Filter on `evidence_status` rather than assuming ring centrality
implies epistemic weight.

## Omnai in Omnarai Chess

At `chess.omnarai.org`, Omnai names the opponent you play and try to predict. The chess
practice has no machine surface and sits outside the engine's machine contract.

Corpus figures verified live against `/api/info` on 2026-08-17 (568 works).
