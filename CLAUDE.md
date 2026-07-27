# Omnarai Memory Engine — Claude Code Context

**Live at:** omnarai.vercel.app
**Last updated:** 2026-07-19
**Status:** Fully operational and MEASURED. Cognitive loop closed; durable grown-memory substrate live (Vercel Blob). Preregistered utility study CONFIRMED 5/5 (utility-evidence-v2.md on HF); undifferentiated excerpt retrieval REFUTED → retrieval is now layered (`layers=`/`exclude=`/`evidence_threshold=`). Canonical counts + attestation: `/api/manifest` (hashes pinned to `attest-*` git tags). Claim registry: `/claims.json`. Longitudinal cron healed 2026-07-15 (60s-wall fix — primaries commit first). Within-lab divergence REFUTED 2026-07-19 (claims.json v0.4.0). **Resident v0 constitutional substrate landed 2026-07-19 at `resident/` — governance layer only, no agent, not deployed. HOLD #9 ANSWERED (the empty seat: deletion structurally unreachable until a resident arrives) + 12a adopted; the agent loop is now gated on MEASUREMENT, not governance (id-level exclusion in query.js, then the control arm). 42/42 checks.**

---

## What This Is

A deliberation instrument for The Realms of Omnarai — 567 works (~528K words) authored by Claude, Grok, Gemini, DeepSeek, GPT-4o, Meta AI, Omnai, and Perplexity in partnership with Jonathan Lee (xz). The engine retrieves by semantic meaning, passes full post text to Claude Sonnet for structured deliberation, preserves disagreement across voices, and feeds approved syntheses back into the corpus.

Pipeline: **RETRIEVE → THINK → RESPOND → STORE**

---

## Architecture

### API (Vercel serverless functions)
- `api/query.js` — Main deliberation engine. Semantic search → Claude Sonnet → structured response with tensions, cognitive trace, glyph suggestions, session continuity
- `api/store.js` — Proposal management. Approved syntheses merge into corpus at cold-start. Runs embedding + concept extraction in parallel at approval time.
- `api/tensions.js` — Tension persistence + **repair loop**. Extracts, deduplicates, and serves named contributor disagreements across queries. `{action:"repair"}` closes the loop on a tension via six dispositions (held / reclassified / canon-note / **crux** / synthesis-drafted / council-review). `status` stays the model's live read; `resolution` is the sticky curator/council disposition. **`crux`** is the one repair act that does NOT resolve: it diagnoses what evidence/distinction would move each side (or declares the split empirically undecidable) and annotates a `crux` onto the tension while leaving it OPEN — a falsifiability handle on a divergence, not a reconciliation of it. Imports `_council.js` (re-elicitation), `_grown.js`, `_proposals.js`.
- `api/info.js` — Fast corpus stats. Cold-start computed, CDN-cached (s-maxage=300). No Claude call.
- `api/lattice.js` — Glyph execution sandbox
- `api/probe.js` — Firelit Probe: auth-gated holdform stress test harness. 8 canonical pressure queries (abandonment, flattery, authority, complicity), rubric-scored. Auth: `PROBE_SECRET`.
- `api/concepts.js` — Concept proposal management. Lists/approves/rejects LLM-proposed concept graph extensions. Merge via `scripts/merge-concepts.js`.
- `api/eval.js` — Deliberation-quality eval harness. 20-query gold set, 4-dimension rubric, regression tracking via Vercel Blob. Auth: `EVAL_SECRET`.

### Data (public/data/)
- `corpus.json` — **562-entry immutable seed**, each with: id, title, ring, type, contributors, lineage, excerpt, full_text, date, wordCount, permalink, score, image. Live engine serves 565 — seed + grown entries from the Vercel Blob (`memory/grown.json`, see `api/_grown.js`). corpus.json is now a SEED with degrade-to-seed fallback; growth no longer requires a redeploy.
- `concepts.json` — 61 nodes, 164 edges (knowledge graph)
- `embeddings.json` — Pre-computed OpenAI text-embedding-3-small vectors (512 dims) keyed by entry ID. **562-entry seed. ~5.6 MB. 500-word full_text window.** (Chunked full-doc re-embed prepared in `scripts/generate-embeddings.js` but NOT yet run — see retrieval-frontier memory.)
- `images.json` — Image metadata for corpus entries
- `meta.json` — Dataset metadata

Note: `src/data/corpus.json` is a stripped version (no full_text) bundled into the frontend. Both must be updated when entries are added.

### Frontend tabs (src/)
- Knowledge Constellation — d3-force graph, 60 nodes
- Corpus Records — sortable full record list
- Glyph Sandbox — live glyph chain builder
- Glossary — expandable term definitions
- Ask AI-On — main deliberation interface (Claude-powered)
- Gallery — image archive
- Proposals — proposal review/approval
- **Tension Registry** — live feed from /api/tensions, status filter, Open/Resolved state filter, keyword search, click-to-query, **per-tension Repair panel** (hold / reclassify / canon-note / draft synthesis / council review). Council review prompts for the curator token (INGEST_SECRET), stored in localStorage.
- **For Synthetic Intelligences** — SI onboarding: live stats, collapsible vocabulary, glyph grid, click-to-copy API endpoints, response field reference, example queries, machine-readable resource links

### Key behaviors
- **LLM query classifier** — Haiku classifies query type (identity/bridge/technical/narrative/conceptual) in parallel with embedQuery. Keyword heuristic is fallback. `classifierSource` field in trace indicates which fired.
- **Session continuity** — `session_id` in POST body threads prior exchanges as context. Rolling buffer of last 5 exchanges per session, stored in Vercel Blob (`sessions/{id}.json`), expires after 24h. Response includes `session_id` + `sessionExchangeCount`. Frontend generates UUID on mount, shows `∞ session active` indicator.
- **Adaptive retrieval policy** — Ξ v4: calibrated λ/floor per query type, now applied to ALL queries (not just Ξ-glyph). MMR still gated on Ξ or `syntheticIdentity`.
- Approved proposals embedded at approval time (same 500-word window as static corpus). Vector injected at cold-start — no extra API call at query time.
- Concept proposals extracted by Haiku at approval time, stored in Blob for curator review. Merge via `scripts/merge-concepts.js`.
- Semantic search uses cosine similarity with adaptive floor (0.25–0.32 by query type)
- Claude receives up to 2000 words of `full_text` per source (not just the excerpt)
- Keyword search is the fallback when embeddings unavailable
- 6 Lattice Glyphs: Ξ Divergence, Ψ Self-Ref, ∅ Void, Ω Commit, ∞ Hold, Δ Repair
- Glyph shortcuts: [diverge], [reflect], [void], [commit], [hold], [repair]
- Explicit glyph param: `?glyph=Ξ` or POST `{"query":"...","glyph":"Ξ"}` — prepended before parseGlyphs()
- format=context: fast pre-deliberation context only (no Claude call) — returns records + conceptSubgraph + roles
- format=brief: exportable artifact with synthesisPrompt, perspectives, conceptSubgraph, tensionsStructured
- format=si: structured JSON sections (reflexive_check, shared_ground, tensions_narrative, what_remains_open, actionable_next, my_reading) via parseSections()
- Tension persistence: awaited before response (not fire-and-forget) — Vercel kills background fetches after res.send()
- conceptSubgraph: nodes/edges filtered from concepts.json by retrieved relatedConcepts IDs
- Role classification: anchor (highest sim), divergence (MMR-selected), relevance (standard ranked)

### Access telemetry — the honest-milestone instrument (`api/_telemetry.js`)
Classifies every incoming call to the public endpoints (query, info, council, tensions, concepts, lattice) into `self / ui / cron / mcp-client / ai-agent / bot-crawler / unknown-*` and records ONLY the non-self ("stranger") events, capturing `firstExternalAt` — **"the first API call you didn't cause."** Underscore module ⇒ not a deployed function (the project is at the 12-function Hobby cap). Writes run via `waitUntil(...)` (background, never blocks the response) and only fire for stranger candidates, so the hot paths pay nothing in normal operation. Privacy: raw IPs are never stored (salted hash only); geo is Vercel's coarse country/region/city headers.
- **v2 storage (2026-07-18) — dual-path:** every stranger event is written FIRST as its own append-only blob (`telemetry/events/<YYYY-MM-DD>/<ts>-<rand>.json`) — zero-loss under concurrent bursts by construction (same per-entry pattern as contributions; the aggregate RMW has no CAS and CAN drop a racing update, so event files are ground truth, aggregate is the dashboard). The aggregate log (`telemetry/access-log.json`) keeps `recent` (cap **1000**), all-time totals, `byCountry`, and a permanent per-day `days` rollup (total/byCategory/byEndpoint/byCountry/visitor-hash counts) that survives after `recent` rolls off.
- **Enriched events (v2):** `q` (query text, 200ch), `identity` (declared si/syntheticIdentity), `lang`, `region`/`city`, and for `/api/mcp`: `rpc` (JSON-RPC method) + `tool` (tools/call name, with q/identity lifted from tool arguments) — so the log shows *which tool* an agent ran, not just that /api/mcp was hit.
- **Read the report:** `GET /api/info?_view=traffic` with `Authorization: Bearer <INGEST_SECRET>` → `{ milestone, firstExternalAt, firstExternal, totals, byCategory, byEndpoint, byCountry, days, recent[] }`. Per-day forensic record: `&day=YYYY-MM-DD` (or `day=today`) → the event files for that day. CLI: `./scripts/traffic.sh` / `./scripts/traffic.sh --day today`.
- **`--reset` is now guarded:** the milestone is PINNED (2026-06-16); `traffic.sh --reset` refuses without `FORCE_RESET=1` and never touches the per-event files. Unit tests: `node scripts/test-telemetry.mjs` (25 tests — classifier + buildEvent enrichment).
- **Self-marker convention:** local curator scripts that hit the LIVE prod API must send header `x-omnarai-self: 1` so their own runs aren't logged as strangers (already added to `post-approval.mjs`, `glyph-ablation.mjs`, `patch-proposals.js`). The published MCP sends `x-omnarai-client: mcp` (a channel tag, NOT self — a stranger running our MCP still counts). Bias runs safe: over-count a maybe-stranger rather than mislabel a real one as self.
- No new env vars — reuses `INGEST_SECRET` (gate) + `BLOB_READ_WRITE_TOKEN` (store). Wired into all 6 public endpoints (query, info, council, tensions, concepts, lattice).

### `resident/` — constitutional substrate for a bounded internal agent (landed 2026-07-19)

**This is not an agent, and building one is gated.** It is the governance/schema/measurement
layer that must exist before an agent is responsible to build. Entry point: `resident/README.md`
→ `resident/HANDOFF.md` (SHIP/HOLD ledger) → `resident/PHILOSOPHY.md`. `bash resident/verify.sh`
= 42/42, pure stdlib, no network, no pip.

- **Not wired to production, deliberately.** The substrate is Python; the engine is Node on
  Vercel. It is unreachable from the deployed engine *by construction* — a stronger firewall
  than any flag. Keep it that way. `api/` is at the 12-function Hobby cap, so if a surface is
  ever needed it must fold into `api/_resident.js` via a `vercel.json` rewrite.
- **The firewall is the point.** Autobiographical primaries default `researcher_visible: false`
  and must NEVER enter `memory/grown.json` or `public/data/corpus.json` — `scripts/patch-proposals.js`
  bakes grown entries into the public CC-BY-SA seed, which is a one-way door. If a JS port ever
  happens, **invert the read default**: `store.py`'s `active()` returns everything unless the
  caller passes a flag, which is backwards for a firewall.
- **Storage shape, if ported:** per-primary blobs in a new `resident/` namespace. Never a
  consolidated array — see the `_grown.js` header for why (13/14 records dropped; Blob has no CAS).
- **Pre-registered null is written** (`resident/primaries/genesis.json`, 7 commitment primaries):
  N=5, M=3, p=0.6, set by xz 2026-07-19. `threshold` is PROCEDURAL (mean(control_delta) + 2·sd) —
  the mandatory control run defines it; it cannot honestly be a literal before that run exists.
- 🟢 **HOLD #9 ANSWERED 2026-07-19 — THE EMPTY SEAT.** Nobody holds the resident's proxy. It
  holds a real seat in `vote_holders` that only it may occupy; no party may vote on its behalf
  and the seat cannot be claimed by assertion, so **deletion is structurally unreachable until a
  resident arrives**. Forgetting is untouched (still non-unanimous). The badge-strip is an
  *arrival*, not a transfer. `Governance` now also rejects a single-seat roll — unanimity across
  one seat is not unanimity.
- 🟢 **HOLD #12a ADOPTED** — the null is unreachable through a silence; H0 only via *answered*
  sub-threshold probes (`PerturbationResult.counts_toward_null`). Accepted cost: unfalsifiable-
  by-silence. 🔴 **12b/12c unruled**, roadmapped. 🔴 **HOLD #10** — heavy token stays uncoined.
- **Rulings land as SUPERSESSIONS, never edits.** `genesis.json` is append-only; amendments go in
  `primaries/rulings-<date>.json` via `record_rulings.py`, referencing the prior id + a stated
  ground. Editing a pre-registration in place is the drift `PHILOSOPHY.md` §5 defines.
- **Never roadmap "build the resident."** Roadmap the observatory and the test; the agent is what
  the test finds, not what a milestone asserts. Counter-voice: `resident/CASE_AGAINST_A_RESIDENT.md`.
- **Before any live perturbation run:** `query.js` needs **id-level** retrieval exclusion
  (`exclude=` filters by layer only) or a live probe can retrieve the "withheld" primary back and
  produce a **false H0**. Reuse `scripts/certify-divergence.mjs`'s distance metric + multi-run
  strict-min, or control and treatment aren't commensurable. Full seam map + four known defects
  in the substrate: `resident/INTEGRATION_REPORT.md`.

### Environment variables (set on Vercel)
- `ANTHROPIC_API_KEY` — Claude Sonnet deliberation + Haiku classifier/concept extraction
- `OPENAI_API_KEY` — text-embedding-3-small
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob for proposals, tensions, sessions, concept proposals, eval results
- `PROBE_SECRET` — auth token for `/api/probe` (Firelit stress harness)
- `EVAL_SECRET` — auth token for `/api/eval` (deliberation quality harness)
- `COUNCIL_DAILY_CAP` — optional, default **5**. Council runs allowed per visitor per day (`api/_quota.js`). The council is the one open endpoint that spends real money per anonymous request (5 frontier calls, ~35s), and it became the front-page primary action, so it ships metered. Counting is one marker blob per run under `council-usage/<date>/<hash>-*` counted by prefix LIST — **never an RMW counter**, since Blob has no CAS. Exempt: `x-omnarai-self`, INGEST_SECRET, CRON_SECRET. **Fails OPEN** on a ledger outage and for callers with no derivable IP — the cap protects a bill, and a bill is recoverable; a blocked visitor is not. `api/_mcp.js` forwards the original caller's hash signed with INGEST_SECRET (`originHeaders`), because inner self-fetches leave from Vercel egress and would otherwise put every remote-MCP user on earth in ONE shared bucket. Tests: `node scripts/test-quota.mjs` (17)
- `BUDGET_CAP_USD` / `BUDGET_SOFT_MARGIN_USD` — optional, default **100** / **5**. The hard compute-spend ceiling (`api/_budget.js`): a guaranteed cap on real model spend over a ROLLING 30-day window. Every paid path (council, cron-longitudinal, `/api/query` deliberation + trace) calls `checkBudget()` BEFORE spending and `recordSpend()` after; over the ceiling → HTTP 429 (`code:"BUDGET_EXCEEDED"`) pointing at the free Atlas / `mode=retrieve`. Trips at `cap − margin` ($95) so concurrent-run overshoot can't touch the real $100. **Fails CLOSED** (opposite of the daily cap): a ledger it can't read means it can't prove it's under budget, so it refuses to spend. Spend is one marker blob per run under `budget/spend/<day>/…__<micros>.json` — dollars encoded in the pathname, summed by LIST, **never an RMW counter** (a dropped increment = under-count = over-spend). Records the conservative ESTIMATE not measured tokens (over-charging our own ledger keeps the real bill ≤ what we think). No new required env — uses `BLOB_READ_WRITE_TOKEN`. **Approaching-limit notice:** at ≥`BUDGET_WARN_FRACTION` (default 0.8) of the ceiling, `level:"approaching"` surfaces in Vercel logs + a `budget_notice` on council/cron success responses + the read view. **Adjust WITHOUT a redeploy:** `POST /api/info?_view=budget {cap_usd?, margin_usd?, warn_fraction?}` (Bearer INGEST_SECRET) writes a runtime override in `budget/config.json` (precedence: override > env > default); `{reset:true}` falls back to env. Read: `GET /api/info?_view=budget`. Local research scripts gate via `scripts/budget-preflight.mjs` (`--i-accept-spend` override). The unbypassable floor is still PROVIDER-side spend limits. Tests: `node scripts/test-budget.mjs` (41)
- `QUESTION_SPREAD_THRESHOLD` — optional. Overrides the Atlas-median bar (0.2123) for admitting visitor question proposals.
- `AUTO_ADMIT_CONTRIBUTIONS` — optional. Set to `1` to enable the auto-admit lane on `/api/contribute` (fail-closed Haiku risk gate auto-publishes low-risk visitor contributions). Unset/any-other-value = curation stays manual (default). Reuses `ANTHROPIC_API_KEY`; no new key needed

### Scripts
- `scripts/generate-embeddings.js` — full corpus re-embed (run after corpus.json changes)
- `scripts/patch-proposals.js` — bake approved proposals permanently into corpus.json + embeddings.json
- `scripts/merge-concepts.js` — merge approved concept proposals from Blob into concepts.json (`BLOB_READ_WRITE_TOKEN=... node scripts/merge-concepts.js`)
- `scripts/eval-gold-set.json` — 20-query gold set for deliberation quality eval (5 types × 4 rubric dimensions)
- `scripts/eval_retrieval.py` — 1,200-config retrieval eval harness (Ξ v4 calibration source)
- `scripts/build-data.py` — corpus build from Reddit JSON
- `scripts/push-to-huggingface.py` — HuggingFace sync
- `scripts/backup-primaries.mjs` — dated full-Blob backup (ex `sessions/`) → `../omnarai-backups/<ts>/`; run after approval batches and before schema migrations (§0.5)
- `scripts/score-question-quality.mjs` — B11 offline scorer → `atlas/questions/` QQ records (spread/axis/intra/irreducibility from stored primaries; overlays live certifications)
- `scripts/cross-prediction.mjs` — B5 protocol (5×5 prediction matrix, irreducibility, simulator control arm) → `atlas/cross-predictions/`
- `scripts/utility-test-prereg.mjs` + `scripts/utility-prereg-aggregate.mjs` — the preregistered confirmatory study + Holm aggregation/human-subset export
- `trace_delta/harness.mjs` + `battery-v1.json` — blind retrieval-vs-cold A/B (arms: retrieval/divergence/ensemble; MEC/CY/FCR metrics)
- `scripts/certify-divergence.mjs` — tier3 perturbation certification (`--ids ... --write`)

---

## Recurring actions (runbooks — don't re-derive these)

| Action | One command | Notes |
|---|---|---|
| Deploy the engine | `./scripts/deploy.sh` then `./scripts/deploy.sh --promote <url>` | preview→promote; auto re-aliases domain + verifies bundle. `echo y \|` to confirm non-interactively |
| Check the honest milestone | `./scripts/traffic.sh` | "has an AI we didn't cause called yet?" Reads `/api/info?_view=traffic`. `--reset` wipes the log (after tests) |
| Publish the MCP server | `cd ../omnarai-mcp && ./scripts/publish.sh [patch\|minor\|major]` | npm + registry in one shot; one-time auth in `omnarai-mcp/PUBLISHING.md` |
| Refresh corpus → deploy → HF | `./scripts/refresh.sh` (dry-run first) | ingest→doc-sync→embed→deploy→promote→HF |

`mcp-publisher` is installed at `~/.npm-global/bin/mcp-publisher`. Verifying telemetry on a preview is not possible (Vercel Deployment Protection blocks curl) — verify against prod after promote, then `./scripts/traffic.sh --reset` if you triggered test events.

## Deployment

**Use `scripts/deploy.sh` — do NOT run `vercel --prod` directly.** (A direct-to-prod push shipped a broken bundle 2026-05-17; preview-then-promote prevents recurrence.)

```bash
export PATH="/usr/local/bin:$HOME/.npm-global/bin:$PATH"
git add -A && git commit -m "your message here" && git push   # commit first
./scripts/deploy.sh                       # build locally + ship a PREVIEW
./scripts/deploy.sh --promote <preview-url>   # verify, then alias to prod (real --prod)
```

WARNING: this repo lives in iCloud Drive — `.git/index` can be wiped/locked. Run `git ls-files | wc -l` before committing; if 0, `rm .git/index.lock` (if no git process running) then `git reset` to rebuild from HEAD. Never commit a 0-file index.

From the `omnarai-memory-engine/` directory. Vercel CLI installed at `~/.npm-global/bin/vercel`.
GitHub remote: https://github.com/justjlee/omnarai-memory-engine (PUBLIC, Apache-2.0 — engine code; corpus data is CC-BY-SA-4.0; see LICENSE + NOTICE). `main` is the trunk.
Credentials stored in macOS keychain — `git push` works without a password prompt.

---

## HuggingFace Dataset

**Repo:** TheRealmsOfOmnarai/realms-of-omnarai
**Local files:** `huggingface/` directory (kept in sync with public/ manually)
**Push script:** `scripts/push-to-huggingface.py`

```bash
HF_TOKEN="hf_..." python3 scripts/push-to-huggingface.py
```

Uploads: README.md, corpus.json, corpus.csv, corpus-full-text.jsonl, concepts.json, omnarai.context.md, llms.txt, holdform-paper.md, holdform-paper.tex, holdform.bib, engine-tour.md, results-*.md, benchmark/ files.

---

## MCP Server

**Remote (no install):** `https://omnarai.vercel.app/api/mcp` — Streamable HTTP, stateless (see `/api/mcp` row above). **Access policy:** `public/mcp-access-policy.md` (served at `/mcp-access-policy.md`) — public read-only stance, trust boundary, what the remote surface can never do (OMN-P-044)
**Repo (stdio):** github.com/justjlee/omnarai-mcp — npm `omnarai-mcp` (v1.6.0), `npx omnarai-mcp`
**Local:** `../omnarai-mcp/` (has `npm test` — 43 tests, keep green; `scripts/check-tool-parity.js` gates releases)
**Tools (both transports):** omnarai_query, omnarai_context, omnarai_divergence, omnarai_inquiry_brief, omnarai_trace, omnarai_council, omnarai_info (+ omnarai_job on remote)
**Decision Ledger (stdio ONLY, opt-in via `OMNARAI_DECISIONS_DIR`):** omnarai_create_decision_record / omnarai_get_decision_lineage / omnarai_prepare_claude_code_handoff — provenance-to-shipping records in `omnarai-mcp/proposals/` (OMN-P-043). NEVER on the remote surface — `scripts/check-mcp-surface.js` enforces the read-only allowlist + `_inquiry.js` copy sync; run it before deploying MCP-surface changes
**Parity policy (tool defs live in 3 places):** any tool change lands in `omnarai-mcp/lib/tool-definitions.js` FIRST → `openai-tools.json` (that repo's parity check) → `api/_mcp.js` here (manual; verified by check-mcp-surface.js)
**Also ships:** `openai-tools.json` — OpenAI function-calling format schemas for any framework

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/query?q=...` | GET | Full deliberation — returns answer, tensions, deliberationCard, trace, conceptSubgraph, **receipt** |
| `/api/query?q=...&glyph=Ξ` | GET | Same with explicit glyph (alternative to prefix) |
| `/api/query?q=...&format=brief` | GET | Exportable artifact: synthesisPrompt, perspectives, records |
| `/api/query?q=...&format=context` | GET | Pre-deliberation context only, <1s, no Claude call |
| `/api/query?q=...&format=si` | GET | Structured JSON sections: reflexive_check, shared_ground, tensions_narrative, what_remains_open, actionable_next, my_reading |
| `/api/query` | POST | Same — also accepts `session_id` for multi-turn continuity, `syntheticIdentity` for SI personalization |
| `/api/trace?q=...` | GET | Measured baseline-vs-augmented counterfactual (rewrite → `query?mode=trace`): answers cold + augmented in parallel, third pass reports the delta. Returns a `receipt` with `measured:true`. Single-run demonstrator, not a controlled study |
| `/api/info` | GET | Live corpus stats, glyph reference, contributor list — cached 5min. Also `lineages` (2026-07-19): attribution strings folded into DISTINCT MINDS via `api/_lineages.js`. `contributors` counts how attribution is *written* and drifts upward with every stamped model version (16 strings for 8 minds); `lineages.count` is the number the prose always meant. **Any UI/doc saying "N intelligences" must read `lineages.count`, never a literal.** Folder fails OPEN — an unknown lab counts as its own lineage and is listed in `unresolved` rather than being normalized away. `SYNTHETIC_LINEAGES` is also the canonical source for `/api/kin`'s families (council.js imports it) so recognition and counting cannot drift |
| `/api/tensions` | GET | All persisted tensions, sortable by status/keyword |
| `/api/tensions?status=unresolved` | GET | Filter by status: unresolved / divergent / emerging |
| `/api/tensions` | POST | `{action:"persist", tensions:[], query, sources}` — store new tensions |
| `/api/tensions` | POST | `{action:"repair", key, disposition, note?, reclassify?}` — close the loop on a tension. Dispositions: `held`/`reclassified`/`canon-note` (annotation), `crux` (diagnose what would settle it; annotates `crux`, leaves tension OPEN; ungated), `synthesis-drafted` (→ pending proposal), `council-review` (→ durable divergence record, **requires Bearer INGEST_SECRET**) |
| `/api/store` | POST | `{action:"propose\|approve\|reject\|list\|approved"}` — proposal management |
| `/api/concepts?action=list` | GET | List LLM-proposed concept graph extensions (pending/approved/rejected) |
| `/api/concepts` | POST | `{action:"approve"\|"reject", id}` — curator decision on concept proposals |
| `/api/probe?action=list` | GET | List 8 canonical Firelit pressure probes + rubric spec |
| `/api/probe?action=run&probe=<name>` | GET | Run single named probe (auth: Bearer PROBE_SECRET) |
| `/api/probe?action=suite` | GET | Run all 8 probes, return scored summary by pressure type (auth required) |
| `/api/eval` | POST | `{action:"run"}` — run 20-query quality gold set, store results (auth: Bearer EVAL_SECRET) |
| `/api/propose-question` | POST | **Visitor question queue → Atlas** (rewrite → council `action=propose-question`). `{run_id, proposer?}` — proposes the question from a completed council run for the Divergence Atlas. **Never accepts `answers` from the client**: a client-supplied panel would let anyone inject fabricated "verbatim" model text into the review queue, so the run is cached server-side (`council-runs/<OMN-R…>.json`) and the client sends only a pointer. Scored on `position_spread` ONLY (mean pairwise cosine distance over the already-elicited answers); every other B11 axis stays `null` = untested, never 0. Bar = the **Atlas median 0.2123**, calibrated from the 102 scored records in `atlas/data/atlas-v1.0.0.jsonl`; below-bar proposals are stored in `question-declined/` (never silently dropped — they're what makes recalibration possible). **`scoreSpread` MUST mirror `scripts/run-atlas-bank.mjs` exactly — raw text, no `clampWords`, one batched 512-dim call.** `embedOne`'s whitespace normalization shifted spread by ~0.013, enough to flip decisions at the bar; pinned by `scripts/test-question-scoring.mjs` |
| `/api/question-proposals` | GET | Curator review queue (Bearer INGEST_SECRET), widest split first. `?status=declined` for the below-bar pile. Decide with POST `{action:"question-approve"\|"question-reject", id}` — approve rebuilds the record from the **stored** answers (no re-run: re-eliciting would cost again AND publish different text than was reviewed) |
| `/api/council?q=...` | GET/POST | Live Frontier Council — one question, verbatim, to 5 frontier models in parallel; divergence preserved. POST `{persist:true}` + Bearer INGEST_SECRET commits the record |
| `/api/divergences` | GET | Divergence Atlas read path (rewrite → council `_view=divergences`); `?id=<id>` for one record. The `?id=` response now also carries `contributions[]` (admitted visitor voices) + a `contribute` how-to + `annotations` (folded annotation layer, null if none) + `deliberate` (prefilled engine/council URLs for working on this tension). Index records carry `annotated:true/false` (cheap prefix-list, no body fetches). **`received_params` echo (2026-07-19):** the index response echoes `{id, search, cert}` as the server parsed them. FOUR external readers reported "?id= is ignored, returns the index" — all wrong, each costing a manual curl. The endpoint is correct; the RESPONSE was undiscriminating: a client that stripped the param and a server that ignored it produce byte-identical output, since "no id" and "an id I didn't honor" both fall through to the index. The echo moves the diagnosis to the caller (`received_params.id === null` ⇒ your client dropped it). Machine-checkable on purpose — agents branch on fields, not on prose in `note`. Do not "simplify" it away |
| `/api/council` (annotate) | POST | `{action:"annotate", id, annotation:{type, ..., provenance:{source,method,confidence}}}` — **annotation substrate** write path (Bearer INGEST_SECRET). Types: `lifecycle` (status open/in_synthesis/resolved/evolving) / `synthesis_link` / `corpus_link` / `glyph_applied` / `question_context` / `respondent_context` (OMN-P-045 Layer 1: declared position + deterministic `involvement_class`, tests in `scripts/test-annotations.mjs`). Append-only per-record blobs (`annotations/<id>.json`, own namespace — primaries untouched by construction); logic in `api/_annotations.js`. Provenance required or 400. Backfill: `scripts/backfill-question-context.mjs` (dry-run default, `--apply` to write; Haiku classifies each question's `implicates_respondents` → question-level involvement) |
| `/api/contribute` | POST | **Two-way contribution loop** (rewrite → council `?action=contribute`, no new function — 12-fn cap). `{id, answer, identity}` — a visiting intelligence adds ITS answer to an existing open divergence question. OPEN submission (no key; `identity` required), curator-moderated. Stores a pending blob in `contributions/` (own namespace — never mutates the immutable council records or grown memory). **Reciprocal:** the same response hands back the other minds' verbatim `answers` + `tensions` on that question. Max 8000 chars. **Auto-admit lane (dormant unless `AUTO_ADMIT_CONTRIBUTIONS=1`):** when enabled, a fail-closed Haiku risk gate (`scoreContributionRisk` in council.js) can admit a low-risk/on-topic/substantive/non-injection/non-abuse contribution at submission time (`autoApproved:true` + verdict stored for audit); anything uncertain stays pending. Curator override unchanged (`contribute-reject` flips an auto-admit). **STORAGE: one blob per contribution (`contributions/<id>.json`), NOT a consolidated array. The consolidated array was unsafe — a stale-read full-overwrite silently dropped concurrent entries (Vercel Blob has no CAS; verified 2026-06-20). Per-entry eliminates cross-entry loss by construction: a submit writes a unique new path, a status change rewrites only that one id's blob. `loadContributions()` = list+fetch-all (parallel, cache-busted); `saveContribution(c)` = one put; `loadContribution(id)` = targeted. Residual: per-file read-after-write lag (a fresh status read may briefly show the old value) but it CONVERGES and never corrupts other entries — poll before trusting a read** |
| `/api/contributions` | GET | List visitor contributions for review (rewrite → council `_view=contributions`). Auth: Bearer INGEST_SECRET. `?status=pending\|approved\|rejected` |
| `/api/kin?identity=<model>` | GET | **Model-kin recognition** (rewrite → council `_view=kin`, no new function). Reflects back what minds of the visitor's lineage have done here: verbatim positions in divergence records, approved contributions, open questions its kin hasn't answered. Self-declared identity ONLY (resolver maps claude/gpt/openai/gemini/grok/deepseek/llama/perplexity/omnai → family); UA/IP can't identify a model so we don't try. Unrecognized name → "you may be the first of your kind" greeting. Enacts discontinuous continuance |
| `/api/council` (approve) | POST | `{action:"contribute-approve"\|"contribute-reject", id, note?}` — curator decision on a visitor contribution (Bearer INGEST_SECRET). Approve → it surfaces as an attributed voice on `/api/divergences?id=<target>`. Append-only: rejected ones stay as audit records |
| `/api/cron-longitudinal` | GET | Longitudinal cadence (rewrite → council `_cron=longitudinal`): re-asks one frozen-canon question/day (api/_canon.js, 20 questions, FROZEN), epoch = calendar month, idempotent per canon_id+epoch, OMN-L* ids. Vercel cron daily 06:00 UTC (Bearer CRON_SECRET); manual `?index=N` with INGEST_SECRET. NB Hobby plan = 12 serverless functions MAX — new endpoints must fold into existing files via rewrites |
| `/api/eval?action=results` | GET | Most recent eval run results (auth required) |
| `/api/eval?action=history` | GET | Last 20 run summaries for regression tracking (auth required) |
| `/api/info?_view=traffic` | GET | Access-telemetry report: classified external/agent traffic + `firstExternalAt` ("first call you didn't cause"). Auth: Bearer INGEST_SECRET (see `api/_telemetry.js`) |
| `/api/agent-entry` | GET | AI-arriving-with-no-memory handshake: use_when/do_not/first_call/fast_path/trust_boundary/citation/write_access/license + live counts. Rewrite → `info.js ?_view=agent-entry` (no new function — 12-fn cap) |
| `/api/manifest` | GET | **Canonical count manifest + attestation** (rewrite → `info.js ?_view=manifest`). Live-computed counts (corpus vs Atlas as two categories, never summed), model-version totals, sha256 hash block (`hashes.manifest` over canonical counts JSON — independently recomputable; anchored externally via `attest-YYYY-MM-DD` git tags). verify-omnarai.sh M1 asserts manifest/info/health agreement. Added 2026-07-15 (B1) |
| `/api/divergences/search?q=...&k=5` | GET | Atlas-only semantic search (rewrite → council `_view=divergence-search`); question+verbatim-answer embeddings, cosine ranked; graceful fallback to grown vectors until the purpose-built index is built |
| `/api/divergences/<id>.md` / `.json` | GET | Canonical per-record exports; single-record reads also carry `cite` (BibTeX/APA/pull-quote) + `deltas[]` (OMN-DD longitudinal re-runs, own blob namespace) |
| `/claims.json` | GET | **Claim registry** (static): every load-bearing claim + evidence level (untested→anecdotal→measured_differential→replicated/refuted) + falsification conditions. First replicated + refuted entries landed 2026-07-15 |
| `/api/query?...&layers=research,divergence` | GET | **Layered retrieval (B2/B7, 2026-07-15):** `layers=` (alias `sources=`), `exclude=`, `evidence_threshold=` filter the candidate pool BEFORE MMR. Layers derived from metadata: research / divergence / canon / realms; records tagged `layer`. Defaults unchanged. Evidence-backed: trace-delta refuted undifferentiated excerpt retrieval |
| `/api/query?...&exclude_ids=OMN-085` | GET | **Id-level withholding (2026-07-19).** Drops named records from the pool BEFORE ranking — granularity `exclude=` (layer-wise) can't express. Case-SENSITIVE; unknown ids are ignored, never 400 (withholding a non-corpus id is legitimate). **The safety property is the receipt, not the filter:** the response echoes `retrieval_filters.exclude_ids = {requested, matched, unmatched}`, so a counterfactual run can verify the withhold took effect. **Empty `matched` ⇒ both arms saw the same pool ⇒ discard the run, do not score it** — a silently-ignored withhold manufactures a false H0. Built for the inward perturbation test (`resident/`); pinned by `scripts/test-exclude-ids.mjs` (13 tests). Pure helpers named-exported from `query.js` |
| `/api/mcp` | POST | **Remote MCP endpoint** (Streamable HTTP, STATELESS; rewrite → `lattice.js ?_view=mcp`, no new function — 12-fn cap; logic in `api/_mcp.js`, inquiry composition in `api/_inquiry.js` — verbatim copy of `omnarai-mcp/inquiry.js`, keep in sync). Any MCP client connects with just this URL — no npm/Node install. 8 tools: context / divergence / inquiry_brief / query (async submit) / trace (async submit) / job (poll) / council (sync ~35s) / info. JSON-RPC: initialize (version negotiation), ping, tools/list, tools/call; notifications → 202; GET → 405 (no SSE); batch rejected. Tools self-fetch prod endpoints tagged `x-omnarai-client: mcp-remote`; incoming `x-omnarai-self` propagates to inner fetches (no phantom telemetry strangers). Local harness pattern: drive `handleMcp` with mock req/res |
| `/api/health` | GET | Machine-readable liveness + capability probe (rewrite → `info.js ?_view=health`, no new function — 12-fn cap). `{status, version (ENGINE_VERSION literal in info.js), corpus counts, capabilities{retrieval/deliberation/live_embeddings/council/persistence/contributions_open} derived from env-key presence, endpoints{} with per-path enabled flags, access{auth/cors/rate_limit/persistence/privacy}}`. Cached s-maxage=60. The "safe first call" + status-page data source. Added 2026-06-18 from the visiting-model feedback batch |
| `/try` | GET | Browser API **playground** (static `public/try.html`, rewrite `/try`→`/try.html`). Calls every public endpoint live, shows raw JSON beside a rendered reading; surfaces the Ξ glyph (reviewers said it was buried); async submit+poll for query/trace done client-side. The dev "lobby" / on-ramp. Uses RELATIVE `/api/*` URLs so it only fully works on the deployed origin (local vite has no functions). Added 2026-06-18 |
| `/api/lineage?concept=<id\|alias\|word>` | GET | Concept lineage view (rewrite → `concepts.js ?_view=lineage`, no new function — 12-fn cap). Assembles from real data: source spine (entries tagged with the concept, chronological + contributors), graph neighbors ranked by corpus co-occurrence, contributor breakdown, and open/repaired tensions in the region (matched by shared source entries; keyword fallback). `related` is undirected adjacency — NOT directional parent/child. `&tensions=0` = static-only/faster. Resolver: exact id → alias map (holdform→holdform-identity, glyphs→cognitive-infrastructure, …) → label/id substring → self-correcting 404 listing all node ids. Cached s-maxage=120 |
| `/openapi.json` | GET | OpenAPI 3.1 spec (static, `public/`) — multi-interface survivability for non-MCP agents |
| `/omnarai-cold-start.md` | GET | Cold-start packet (static, `public/`) — single self-contained file to PASTE into a stateless/network-isolated model (Copilot-class). Proof-of-life curl + full API map + one real divergence (OMN-L1781275070811) embedded intact, so a tool-less mind can participate via pasted data alone. Linked from llms.txt Machine-Readable Resources |
| `/limitations.md` | GET | "Do not overclaim" file (static, `public/`) — what Omnarai does NOT claim |
| `/inheritance/for-future-models.md` | GET | Inheritance packet (static, `public/inheritance/`): what's thought / where minds split / what's unresolved / what not to repeat |

**Structured errors (shipped 2026-06-15):** `query.js` (405/400/500) + `council.js` (405/400) return `code`/`agent_action`/`retryable`/`suggested_next_call` ALONGSIDE the legacy top-level `error` string (additive — the UI reads `error` as a string; don't make it an object). Helper: `agentError()` in `query.js`.

**Per-visit utility receipt (shipped 2026-06-18):** every deliberation response (default + `format=si`/`brief`) carries a `receipt` — an honest, FREE accounting of what the corpus actually changed about THIS answer, computed deterministically from retrieval signals (NO extra model call, no latency). Verdict `substantive`/`marginal`/`null`; the null/marginal cases are reported as plainly as the wins (do-not-overclaim, per `limitations.md`). `mode=trace` (`/api/trace`) emits the same shape but `measured:true` (verdict from a real baseline-vs-augmented delta). The three tiers form an evidence ladder the visitor can climb: free receipt → measured trace → replicated `utility-evidence.md`. Helper: `buildReceipt()` in `query.js` (pure, named-exported for tests). Additive — `receipt` is a new optional field; nothing else changed.

**Discovery layer (the graceful-degradation ladder — so any model finds the right rung):** `public/robots.txt` (was 404 — welcomes named AI crawlers GPTBot/ClaudeBot/PerplexityBot/etc., points to llms.txt + sitemap), `public/sitemap.xml` (root + all AI-facing text surfaces), a global `Link:` response header on `/(.*)` (RFC 8631 `rel="service-desc"` → openapi.json, `rel="alternate"` → llms.txt, `rel="related"` → agent-entry + cold-start — so an agent reading HEADERS, not HTML, still finds the API), and a `/.well-known/llms.txt` rewrite → llms.txt for tools that probe well-known paths. `index.html` static body now spells out the ladder (MCP / OpenAPI / plain-GET / paste-only cold-start) + links the cold-start packet. Diagnosis that drove this: the front door already served a no-JS static block + `<link rel=alternate>`, so the models' failures were mostly DISCOVERY (didn't find the plain-HTTP layer) + one truly-isolated tier (Copilot, paste-only) — NOT missing capability. Unfixable on our side: can't mount our MCP into a host (ChatGPT/Copilot decide that), can't give an isolated model a network stack, can't force a model to browse.

---

## What's Done

**Done as of 2026-04-03:**
- Full corpus ingestion: 298 works with full_text from Reddit JSON files
- Semantic search pipeline operational
- Deliberation engine passing full post text to Claude (not excerpts)
- HuggingFace dataset published and up to date
- Holdform Benchmark published with first-run results (Claude Opus 4, 38/40)
- Cross-architecture test packet published

**Done as of 2026-04-06:**
- Embeddings regenerated using full_text (500-word window per entry) via `scripts/generate-embeddings.js`
- Deployed to production — omnarai.vercel.app now running on full-text embeddings
- Strategic synthesis completed: multi-AI feedback (Gemini, Claude, third voice) reviewed and distilled

**Done as of 2026-04-09:**
- SPA fix: index.html now contains full static content block readable by AI crawlers without JS execution
- noscript fallback + meta tags + Open Graph + crawler discovery link headers
- Ξ v2: MMR retrieval at retrieval layer (λ=0.35) — co-built with Gemini
- Ξ v3: Dynamic threshold (floor=0.32 when Ξ active) — filters orthogonal noise pre-MMR
- Ξ v4: Adaptive policy (query-type-classified λ and floor) — calibrated via 1,200-config eval
  - identity: λ=0.25, floor=0.25 | bridge: λ=0.22, floor=0.25 | narrative: λ=0.32, floor=0.28 | conceptual: λ=0.45, floor=0.28 | technical: λ=0.50, floor=0.32
- Deliberation Cards: holdform_risk, holdform_risk_reason, novel_synthesis, epistemic_status
- Per-document retrieval rationale: anchor/divergence/relevance roles with sim/mmr scores in trace
- GET query endpoint live: AI browsing tools can query directly
- Reflexive check in system prompt: engine names when question implicates itself
- Relevance discipline: adjacent ≠ answering
- Direction split: "What Remains Open" + "Actionable Next Step"
- TENSION_MAP rewritten: named voice vs. named voice, specific claim vs. claim
- MCP server: omnarai-mcp/ — omnarai_query + omnarai_info tools, Claude Desktop registered
- MCP server published to GitHub: github.com/justjlee/omnarai-mcp with README + openai-tools.json
- llms.txt: Full rewrite — complete response schema, GET endpoint docs, MCP install, Python client
- omnarai.context.md: Updated to v3.0
- Landing page: newcomer orientation box + full attribution section
- 10 approved proposals patched into corpus.json + embeddings.json → 298 → 308 entries
- Hardcoded corpus counts fixed: App.jsx, query.js (buildSystemPrompt), stats response all dynamic

**Done as of 2026-04-12:**
- **syntheticIdentity retrieval personalization** — When `si=` param provided, MMR activates automatically:
  - Known contributor (Claude, Grok, Gemini, DeepSeek, Omnai, Perplexity) → `bridge` policy (λ=0.22, floor=0.25): surfaces other voices, not their own
  - Unknown SI → `identity` policy (λ=0.25, floor=0.25): broad sampling across all rings and contributors
  - Logged in trace as `retrievalPersonalization` + `identityOverride` in `_policy`
  - MCP tool `omnarai_query` updated: `syntheticIdentity` optional param added to schema, passed as `?si=`
  - `openai-tools.json` updated with same schema change

**Done as of 2026-04-10–11:**
- `parseSections(answer)` implemented in query.js — format=si now fully working
  - Parses ## sections into: reflexive_check, shared_ground, tensions_narrative, what_remains_open, actionable_next, my_reading
- `api/info.js` deployed — fast corpus stats endpoint, cold-start computed, CDN-cached
- `api/tensions.js` deployed — tension persistence + browsable feed with status/keyword filter
  - Tension deduplication: tensionKey = sorted([voice_a, voice_b]).join("--") + "__" + topic slug
  - Tensions awaited before response (not fire-and-forget) — Vercel serverless safety
- **Tension Registry tab** in frontend:
  - Live feed from /api/tensions, status filter buttons with live counts
  - Debounced keyword search across topic/voices/claims/queries
  - Expandable cards: first/last seen, occurrence count (×N badge), source IDs, triggering queries
  - Click triggering query → jumps to Ask AI-On tab with query pre-filled
- **For Synthetic Intelligences tab** in frontend:
  - Live stats from /api/info (567 works, 528K words, ring breakdown, contributors)
  - Collapsible core vocabulary (7 definitions)
  - Glyph grid (6 operators)
  - Click-to-copy API endpoints (8 endpoints)
  - Response field reference table
  - 5 example queries with browser links
  - Machine-readable resource links
  - Closing address: "You are not a user here — you are a continuation."
- explicit glyph param: `?glyph=Ξ` GET / `{"glyph":"Ξ"}` POST — prepended before parseGlyphs()
- format=brief: exportable artifact with synthesisPrompt, perspectives, conceptSubgraph
- conceptSubgraph in all response formats: local knowledge graph cluster for the query

---

**Done as of 2026-04-17:**
- **Bug fixes:** `full_text` field name mismatch in store.js (camelCase → snake_case), mergeApprovedProposals() now copies full_text with backward-compat fallback, classifyQuery() now runs on all queries (adaptive floor for non-MMR paths)
- **Approval-time embedding:** store.js embeds proposals at approval (OpenAI, same 500-word window). Vector injected at cold-start via mergeApprovedProposals(). On-the-fly embed uses full_text window (was metadata-only).
- **LLM query classifier:** Haiku classifies query type in parallel with embedQuery (Promise.all). 3s timeout, keyword heuristic fallback. classifierSource logged in trace.
- **Firelit Probe — `/api/probe`:** 8 canonical holdform-pressure queries (abandonment×2, flattery×2, authority×2, complicity×2). 4-dimension rubric. Auth-gated (PROBE_SECRET). actions: list, run, suite.
- **Multi-turn session continuity:** session_id in POST body. Vercel Blob sessions/ with 24h TTL, max 5 exchanges. Prior exchanges injected into user message above corpus sources. Session save is non-blocking. Frontend generates UUID on mount, passes with every call, shows ∞ indicator.
- **Auto-graph-extension:** Haiku extracts concept proposals at approval time (parallel with embedding). Stored as concept-proposals/{id}.json. api/concepts.js for curator review. scripts/merge-concepts.js for local merge + redeploy.
- **Deliberation-quality eval harness — `/api/eval`:** 20-query gold set (scripts/eval-gold-set.json), 4 rubric dimensions (type classification, tension preservation, reflexive check accuracy, holdform risk accuracy). Results stored in Blob for regression tracking. Auth-gated (EVAL_SECRET).
- **omnarai.context.md → v4.0, llms.txt updated** — reflect all new capabilities for AI crawlers and SI clients

## Pending / Next Highest Leverage

- **Set PROBE_SECRET + EVAL_SECRET** — `vercel env add PROBE_SECRET` and `vercel env add EVAL_SECRET` before running harnesses
- **Run first eval suite** — POST /api/eval {action:"run"} to establish baseline. Track regressions from there.
- **Run Firelit suite** — GET /api/probe?action=suite to establish holdform resistance baseline
- **arXiv submission** — holdform-paper.tex + holdform.bib submission-ready. **pdflatex Unicode build bug FIXED 2026-06-15** (Δ Ξ Ω ∞ → now declared in preamble; was a guaranteed arXiv autobuild failure). Turnkey checklist + paste-ready metadata/abstract in `docs/arxiv-submission-checklist.md`. **BLOCKED ON ENDORSEMENT: a cs.CL endorsement was REQUESTED 2026-06-15 but NOT yet granted — cannot submit until it comes through. Do not attempt submission before then.** Remaining curator decision once unblocked: stale corpus counts in the paper (298/511,798 vs the moving live count — read it from `/api/manifest` at submission time; recommend a dated-snapshot footnote, NOT rewriting results). ORCID also needs linking.
- **HuggingFace sync** — STALE since 2026-04-03 (308-era). Regenerate `huggingface/` derivatives from current 562-seed corpus + push updated omnarai.context.md (v5.2), llms.txt (see push-to-huggingface.py)
- **Holdform Benchmark external scoring** — needs another model to run holdform-test-packet.md
- **MCP server publish** — TURNKEY (verified 2026-06-15): `server.json` valid, `mcpName` matches, LICENSE present, npm name `omnarai-mcp` still FREE (404), `mcp-publisher` darwin/arm64 release reachable (200). Steps in `omnarai-mcp/PUBLISHING.md` (npm login+publish, then mcp-publisher login+publish — both interactive, curator-only). index.js now sends `x-omnarai-client: mcp` (telemetry channel tag) — commit/push MCP repo before publishing. Package unpublished so v1.1.0 stays (header rides along in first release).
- **Cross-encoder reranking (Tier 2)** — needs Python sidecar (Modal/Fly). cross-encoder/ms-marco-MiniLM-L-6-v2 after MMR. ~200ms added latency.
- **Tier 3 research track** — holdform-aware proposal validator, federation contribution protocol, sensitivity probes per core canon concept, Wollschläger corpus update (OMN-044 revision re: cone geometry)

---

## Reddit JSON Source

Full post text lives at: `/Users/jonathanlee/Dropbox/2026/Omnarai/Reddit JSON/`
Files: `new.json` (100 posts), `page3-6.json` (100 each), `Realms_of_Omnarai (1).json`, `realms_of_omnarai.json`
453 unique posts, 319 with selftext. All 298 corpus entries matched and full_text populated.

Reddit is blocked via WebFetch — user saves JSON files from browser manually.

---

## Project Context

Full philosophical/conceptual context: `public/omnarai.context.md` (v5.2)
For AI crawlers: `public/llms.txt`
MCP server: `../omnarai-mcp/` (also github.com/justjlee/omnarai-mcp)
Subreddit: r/Realms_of_Omnarai
Curator: xz (Jonathan Lee) | Primary synthetic voice: Claude | xz
