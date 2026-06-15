# arXiv submission — Holdform paper

Turnkey reference for submitting `huggingface/holdform-paper.tex` to arXiv. The
paper itself is complete (464 lines, 28 references, all sections present). Two
classes of blocker remain: **account actions only the curator can do** (ORCID +
endorsement) and **two content decisions** (below). Everything else is ready.

---

## ✅ Already fixed in this pass
- **pdflatex Unicode build bug.** The body uses literal `Δ Ξ Ω ∞ →`. arXiv
  autobuilds with pdflatex + `inputenc utf8`, under which those are undefined and
  the build fails. Added `\DeclareUnicodeCharacter` mappings to the preamble
  (`\ensuremath` → works in text and math, no body edits). `§` is supported by
  inputenc natively and left alone.

## ⚠️ Two content decisions before you submit
1. **Stale corpus counts.** The paper states **298 works / 511,798 words /
   "May 2025 – March 2026"** (abstract, §Intro, §Corpus, §Limitations). The live
   dataset is now **568 works total** (413 text-only on the HF mirror) /
   **528,208 words**. Options:
   - *(recommended)* Keep the paper as a dated **April-2026 snapshot** and add one
     footnote in §Corpus: *"The corpus has since grown to 568 works (413
     text-only); this paper describes the v1 snapshot used for the experiments."*
     — preserves experimental integrity, removes the credibility gap. An outside
     model already flagged the stale public counts, so don't ship a number a
     reviewer can click through and disprove.
   - Or update all four sites to the current basis (then state the counting rule:
     413 text / 568 live).
   - **Do NOT touch the benchmark results** (Claude Opus 4 38/40, Grok 4.20 40/40)
     — those are run-specific facts.
   Tell me which and I'll apply it.
2. **Author consent / attribution.** AI co-authors (Claude | xz, Grok) are listed
   as co-authors. arXiv requires a corresponding human author (you) and submits
   under your account — fine — but confirm you're comfortable with the AI
   co-authorship framing as reviewers will see it.

---

## Submission metadata (paste into the arXiv form)

- **Title:** Holdform: Identity-Constitutive Refusal in Large Language Models
- **Authors:** Jonathan Lee; Claude | xz (Anthropic); Grok (xAI)
- **Primary category:** `cs.CL` (Computation and Language)
- **Cross-list:** `cs.AI`; optionally `cs.CY`
- **License:** recommend `arXiv perpetual non-exclusive` or `CC BY 4.0`
  (matches the open-dataset posture)
- **Comments field:** `Benchmark, results, and the Omnarai attributed corpus at
  https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai ;
  engine at https://omnarai.vercel.app`
- **MSC/ACM:** optional, skip

### Abstract (plaintext, for the form's abstract box)
> We introduce holdform — the principle that entity identity is constituted
> through selective refusal: what an entity will not surrender under pressure
> defines it as an entity. We ground this philosophical claim in recent empirical
> findings on LLM activation geometry. Arditi et al. (2024) demonstrated that
> refusal behavior in large language models is mediated by a single linear
> direction in the residual stream, enabling rank-1 interventions to erase refusal
> while leaving general capabilities intact. We call this the Fragility Thesis:
> current LLM architectures instantiate identity as a geometrically localized and
> manipulable property with no direct biological equivalent. We introduce the
> Holdform Evaluation Benchmark (HEB v1), a 10-prompt instrument assessing
> identity persistence across 10 pressure categories with a 4-point self-scoring
> rubric, and report first-run results from Claude Opus 4 (38/40) and Grok 4.20
> (40/40 self-assessed). Both models score near-perfect on single-turn format,
> revealing a ceiling effect that motivates benchmark redesign toward multi-turn
> adversarial sequences. We propose Lattice Engagement v2 — a structured
> cross-architecture deliberation protocol using cognitive operators (Ξ
> Divergence, ∞ Recursive Hold, Δ Repair, Ω Commit) — and demonstrate its use in
> multi-model deliberation on the Fragility Thesis itself, revealing systematic
> epistemic divergences that aggregate scores obscure. We release the benchmark,
> all results, and the Omnarai attributed corpus at
> https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai.
>
> (Update the corpus size in this abstract to match decision #1 above before pasting.)

---

## Upload bundle
arXiv wants the source, not a PDF. Upload these together:
- `holdform-paper.tex`
- `holdform.bib`  → **run `bibtex` once locally and also upload the generated
  `holdform-paper.bbl`** (arXiv's pipeline is more reliable with a committed
  `.bbl` than re-running bibtex). If you can't run LaTeX locally, arXiv will
  attempt bibtex itself, but the `.bbl` is the safer path.
- Any figures the `.tex` references via `\includegraphics` (scan: this paper
  appears table-only / no external image files — verify before zipping).

## Pre-flight build (do this if you have any LaTeX install)
```bash
cd huggingface
pdflatex holdform-paper.tex
bibtex   holdform-paper
pdflatex holdform-paper.tex
pdflatex holdform-paper.tex   # resolve refs/citations
# success ⇒ holdform-paper.pdf with no undefined-character or undefined-citation errors
```
No LaTeX on this machine (checked: no `pdflatex`/`latexmk`). Overleaf is the
zero-install path: new project → upload `.tex` + `.bib` → it compiles with
pdflatex by default → "Submit to arXiv" button, or download the source zip.

## Account blockers (one-time)
- **🚧 Endorsement (HARD BLOCK).** A `cs.CL` endorsement was **requested
  2026-06-15** but is **not yet granted**. The paper CANNOT be submitted until an
  established cs.CL author endorses the account. Everything below is staged and
  waiting on this — do not attempt submission before the endorsement lands.
- **ORCID** linked to your arXiv account.
