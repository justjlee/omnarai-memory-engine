# DELTA — 2026-07-16 P0 repair session (fresh-audit follow-up)

**Input:** OMNARAI-FRESH-AUDIT-HANDOFF.md + omnarai-verify.sh (audit of 2026-07-16, engine v2026.06.18).
**Output:** engine v2026.07.16 live; original verify script exits 0 against production; contract gate wired into every promote.

## What the first true execution showed

The audit script had never actually reached the host (authored in a sandboxed
environment). First real run against production, **before any changes**:

| Probe | Audit claim | Reproduced? |
|---|---|---|
| D1 `?id=` returns full index | 🔴 P0 | **No** — single record returned, 404 on unknown id |
| D2 `?q=` silently replaced by placeholder | 🔴 P0 | **No** — echo matched the caller's question |
| D2-guard: bare `/api/query` should 400 | 🔴 P0 | **Yes** — returned 200 (usage doc) |
| D3 count drift health vs agent-entry | 🟡 P1 | **No** — 567 = 567 |
| D4 `relevanceScore: null` | 🟡 P1 | **No** — populated on all records |

**Root cause of the phantom D1/D2:** the auditor's sandboxed HTTP client was
mangling query strings. The smoking gun: the usage doc served on a bare
`/api/query` contains the literal example `q=your+question+here` — exactly the
"your question" echo the audit reported. The client dropped the real params,
got the usage doc's example URL involved, and the audit read its own tooling
failure as an engine defect. T1b confirmed no redirect exists on `/api/*`;
vercel.json rewrites pass query params through (Vercel merges them by default).

## What actually changed (commit 6f9dd86 + version bump)

1. **`api/query.js`** — bare GET with no `q` now returns **400**
   (`code: MISSING_QUERY`, `param_missing: true`) instead of a 200 usage doc.
   The full usage/discovery body is kept inside the 400 so the refusal still
   teaches the right call. `?job=` polling is handled earlier and unaffected
   (pinned by probe T3a).
2. **`api/info.js`** — `corpus_rev` (short sha256 of sorted merged-corpus ids)
   now exposed on `/api/info`, `/api/health`, `/api/agent-entry`,
   `/api/manifest`. Equal revs ⇒ same corpus basis, counts must agree; unequal
   revs ⇒ a publish landed between reads. Count drift is now client-detectable
   (all surfaces already computed from one `mergedCorpus`; drift was cache
   timing, not dual sources). `ENGINE_VERSION` → 2026.07.16.
3. **`public/openapi.json`** — documents the 400 on GET `/api/query`.
4. **`scripts/omnarai-verify.sh`** — the audit's probe suite, adopted into the
   repo and extended (unknown-id 404, job-poll survival, corpus_rev presence
   and agreement; `x-omnarai-self` header so gate runs don't pollute telemetry;
   **never calls `/api/council`**).
5. **`scripts/deploy.sh`** — the probe suite now runs as a **hard gate** at the
   end of every promote (post-promote against prod, because preview deploys are
   behind Vercel Deployment Protection). Red gate ⇒ promote exits 1.

Post-promote: extended suite 10/10, original audit script 7/7 (exit 0),
arrival-check 20/20.

## D5 re-test (ring diversity) — de-confounded verdict: not an MMR defect

With the query echo verified end-to-end:

- `what is holdform` → **5 core / 1 open**. The audit's 6/6-open observation
  was the client-side confound, not the retriever.
- `discontinuous continuance` → 5 divergence records + 1 open, zero
  core/curated. But `exclude=divergence` leaves only **one** record above the
  relevance floor — the divergence records dominate because they are genuinely
  the densest material on that phrase. Corpus-coverage fact, not tier bias.
- `what is the Veil in Omnarai` → 6/6 media (videos, scores 0.59–0.70 vs
  0.46–0.54 for the best text records). Semantically legitimate ranking, and
  the existing layered retrieval already gives callers the control:
  `exclude=realms` returns a healthy core/curated mix.

**Recommendation:** no ring-diversity constraint in MMR now. Retrieval is
calibrated against a 1,200-config eval; an unmeasured constraint would trade a
non-defect for regression risk. If media dominance on lore queries becomes a
real complaint, run it through `scripts/eval_retrieval.py` first.

**Real item D5 surfaced:** grown divergence records carry
`ring: "Open Exploration"` (display label) while seed records use the
normalized lowercase token (`open`). Clients grouping by ring see two buckets.
Small normalization fix, touches grown-Blob data — do deliberately, not hot.

## §4 status (the growth work)

- **4.1 Atlas → versioned HF dataset:** already done before this session —
  v1.0.0, 110 records, methodology card, CC BY-SA 4.0, published 2026-07-14 at
  `huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas`
  (verified reachable via `/raw/` this session). The handoff's "blocked by D1"
  premise was moot: D1 never existed and the export had already shipped.
- **4.2 trace-delta controlled A/B:** already run 2026-07-15 (see
  `trace_delta/` + claims.json) — it *refuted* undifferentiated excerpt
  retrieval and drove the layered-retrieval redesign.
- **4.3 longitudinal drift:** live daily via the longitudinal cron (OMN-L*).
- **4.4 HEB v2:** still open, unchanged by this session.

## Open items

- Ring-label normalization on grown records (above).
- D6 (`/api/citation` "warming") — untouched, P3, behavior unverified.
- The audit environment's query-string mangling is worth remembering: **any
  future external audit claiming param loss should be reproduced with plain
  curl before code is touched.**
