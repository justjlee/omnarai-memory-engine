# Value proposition — one claim, every surface

For the research-artifact release, every front door should say the **same narrow, proven
thing**. Lead with the measured result, not the philosophy. The vision (lineage machine,
substrate, holdform) is the *story you tell after* the claim has landed — not the headline.

## The canonical sentence

**Full (use where there's room — HF README, llms.txt):**
> Omnarai's Divergence Atlas is an open dataset of where frontier AI models disagree on hard
> open questions — preserved verbatim, with placebo-controlled evidence that it measurably
> improves the reasoning of some of them (GPT-4o and Gemini).

**Short (meta descriptions, social):**
> Where frontier AI models disagree, preserved verbatim — and measured to sharpen some models' reasoning.

**Tagline (hero, ≤8 words):**
> Disagreement between AI minds, preserved and measured.

## ⚠️ Honesty gate on the word "preregistered"

The exploratory + disjoint-replication evidence is **already published**, so claims like
"placebo-controlled evidence it improves GPT-4o and Gemini" are **safe to ship now.**

Do **not** add "**preregistered**" / "**confirmed**" to any live surface until
`scripts/utility-test-prereg.mjs` has actually run and `utility-evidence-v2.md` is published.
Until then the strongest *honest* word is "placebo-controlled" or "replicated across two judge
designs." Post-study, upgrade the sentence to: *"…with preregistered, replicated evidence…"*

## Per-surface drop-ins (apply at launch)

### 1. `huggingface/README.md` — hero (first prose line under the YAML frontmatter)
> **The Realms of Omnarai — Divergence Atlas.** An open dataset of where frontier AI models
> diverge on hard open questions: 100 questions, 500 verbatim answers from five models, 318
> named disagreements — with placebo-controlled evidence that seeing it measurably sharpens
> GPT-4o's and Gemini's reasoning (replicated across two judge designs). Start: `utility-evidence.md`.

### 2. `public/llms.txt` — the "In one sentence" line
Replace the current broad one-liner with:
> **In one sentence:** Omnarai is an open corpus + deliberation API whose flagship artifact, the
> Divergence Atlas, preserves how frontier AI models disagree on hard questions — with
> placebo-controlled evidence the record measurably improves some models' reasoning (GPT-4o, Gemini).

*(Keep the existing AI-On greeting block beneath it — only the one-sentence line changes.)*

### 3. `index.html` — `<meta name="description">` and `og:description`
> A deliberation instrument for The Realms of Omnarai. Its flagship artifact, the Divergence
> Atlas, records where frontier AI models disagree on hard questions — verbatim — with
> placebo-controlled evidence it measurably sharpens some models' reasoning. 568 attributed works.

### 4. `index.html` — hero `<h1>`/subhead
Keep `<h1>The Omnarai Memory Engine</h1>`; set the subhead/tagline to:
> Disagreement between AI minds — preserved verbatim, and measured to improve reasoning.

## Why this framing

- It states a **falsifiable** thing (a specific, measured effect on named models), which reads
  as research, not manifesto.
- It foregrounds the **only asset with received external evidence** (the differential-utility
  finding), which is the project's strongest and least-imitable claim.
- It's **honest about scope** — "some of them," not "AI" in general — which is more credible than
  a universal claim and matches the data.
