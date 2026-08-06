# Omnarai — Release Manifest

*Last reviewed 2026-08-06. This document explains the version and count differences a
careful reader will notice across Omnarai's surfaces — the live engine, the static
download, and the Hugging Face mirror — before a critic has to reverse-engineer them.*

Omnarai's own standard (see `/limitations.md`) is that a number written into prose is not
authoritative; the API is. So this page explains the **relationships** between the counts
and points you at the live source of truth for the **values**. Where a number appears
below, treat it as illustrative of the shape, not as a frozen fact.

---

## Where the live truth is

| Surface | What it is | Authoritative for |
|---|---|---|
| `GET /api/info` | Live corpus stats, cold-computed, CDN-cached 5 min | `corpus.totalWorks`, `totalWords`, `rings`, `lineages.count` |
| `GET /api/divergences` | Divergence Atlas index | `count`, `distinct_questions`, `tested_count`, `certified_count`, `tier_distribution` |
| `GET /api/manifest` | Canonical count manifest + sha256 attestation (git-tagged `attest-*`) | reproducible count block |
| `/claims.json` | Claim registry: every load-bearing claim + evidence level + falsification condition | claim status (untested → measured → replicated / refuted) |

If any prose on any Omnarai page disagrees with these endpoints, the endpoints win, and
the prose is the bug.

---

## 1. Corpus: live count vs. the static download

- **Live** (`/api/info` → `corpus.totalWorks`): **567 works** at this writing.
- **Static download** (`public/data/corpus.json`): **562 entries.**

This gap is by design, not drift. `corpus.json` is an **immutable seed** — a fixed,
citable snapshot of 562 entries. Everything approved into the corpus *after* that seed was
frozen is appended to a durable Vercel Blob (`memory/grown.json`) and merged at cold start,
so growth never requires a redeploy or a rewrite of the seed. The live figure is therefore
always **seed + grown ≥ 562**; the download is the reproducible floor.

To reproduce the live number yourself: `curl -s https://engine.omnarai.org/api/info | jq
.corpus.totalWorks`.

---

## 2. Divergence Atlas: records vs. distinct questions

- **Records** (`/api/divergences` → `count`): **124.**
- **Distinct questions** (`distinct_questions`): **113.**

The difference — **11 records** — is **intentional re-elicitations**, not duplicates. A
re-elicitation asks a question that an earlier record already asked, but *later, to the
current models*: the pair is a **longitudinal probe** of whether a split persists as models
change. A re-eliciting record carries `re_elicits: <original-id>`; `distinct_questions`
counts each shared question once. So `records − distinct_questions = re-elicitations`.

### Certification split — what "certify" does and does not mean

The Atlas separates **displaying** a divergence (a one-shot capture) from **certifying**
one (it survives perturbation). At this writing:

| Field | Value | Meaning |
|---|---|---|
| `tested_count` | 33 | put through perturbation so far |
| `certified_count` | 5 | cleared **some** certification tier |
| `tier_distribution.C1` | 4 | paraphrase-robust only |
| `tier_distribution.C3` | 1 | **paraphrase- AND pressure-robust** |
| `tier_distribution.C0` | 119 | displayed, not yet certified |
| untested | `count − tested_count` = 91 | never perturbation-tested |

**Only C3 earns the unqualified phrase "genuine divergence."** C1 is a weaker bar
(paraphrase-robust, but not shown to survive adversarial pressure). Any surface that rounds
all five certified records up to "the robust ones" is overclaiming by the project's own
definitions — read `tier_distribution` from the API, not a headline. `untested` is computed
as `count − tested_count`; it is **not** tier C0 (C0 also holds records that *were* tested
and did not clear a tier).

---

## 3. Hugging Face mirror: a snapshot, not a live feed

The Hugging Face datasets (`TheRealmsOfOmnarai/realms-of-omnarai` and the Divergence Atlas)
are **periodic snapshots**, so they lag the live engine by design:

- The **text mirror** is built on a text-only basis (~436 works at last refresh) and will
  read lower than the live `567`; it is a documented basis difference, not a lost-records bug.
- The **Atlas dataset card** freezes counts at each version bump (e.g. tested/untested), so
  it can trail the live `tested_count`. The live engine is always ahead.

When live and mirror disagree, the live API is current and the card is the last published
snapshot. Each HF dataset card states its own version and refresh date.

---

## 4. Versioning pointers

- **Corpus attestation:** `/api/manifest` carries a sha256 hash block over the canonical
  count JSON, anchored externally by `attest-YYYY-MM-DD` git tags — independently
  recomputable.
- **Claims:** `/claims.json` carries `registry_version` + `updated_at`; each claim moves
  along a fixed evidence ladder and can be marked `refuted`.
- **Atlas:** the Hugging Face Atlas dataset is semver-tagged; the card names the version.

---

*Found a discrepancy this page doesn't explain? That's a real bug — the whole point of
Omnarai is that the record survives contact with measurement. Report it via the contribution
path on any divergence record, or open an issue on the engine repo.*
