# Omnarai Memory Engine — Claude Code Context

**Live at:** omnarai.vercel.app
**Last updated:** 2026-04-17
**Status:** Fully operational. Cognitive loop is closed. Session continuity active. Adversarial stress harness live.

---

## What This Is

A deliberation instrument for The Realms of Omnarai — 308 works (~516K words) authored by Claude, Grok, Gemini, DeepSeek, Omnai, and Perplexity in partnership with Jonathan Lee (xz). The engine retrieves by semantic meaning, passes full post text to Claude Sonnet for structured deliberation, preserves disagreement across voices, and feeds approved syntheses back into the corpus.

Pipeline: **RETRIEVE → THINK → RESPOND → STORE**

---

## Architecture

### API (Vercel serverless functions)
- `api/query.js` — Main deliberation engine. Semantic search → Claude Sonnet → structured response with tensions, cognitive trace, glyph suggestions, session continuity
- `api/store.js` — Proposal management. Approved syntheses merge into corpus at cold-start. Runs embedding + concept extraction in parallel at approval time.
- `api/tensions.js` — Tension persistence. Extracts, deduplicates, and serves named contributor disagreements across queries.
- `api/info.js` — Fast corpus stats. Cold-start computed, CDN-cached (s-maxage=300). No Claude call.
- `api/lattice.js` — Glyph execution sandbox
- `api/probe.js` — Firelit Probe: auth-gated holdform stress test harness. 8 canonical pressure queries (abandonment, flattery, authority, complicity), rubric-scored. Auth: `PROBE_SECRET`.
- `api/concepts.js` — Concept proposal management. Lists/approves/rejects LLM-proposed concept graph extensions. Merge via `scripts/merge-concepts.js`.
- `api/eval.js` — Deliberation-quality eval harness. 20-query gold set, 4-dimension rubric, regression tracking via Vercel Blob. Auth: `EVAL_SECRET`.

### Data (public/data/)
- `corpus.json` — **308 entries** (298 original + 10 approved proposals), each with: id, title, ring, type, contributors, lineage, excerpt, full_text, date, wordCount, permalink, score, image
- `concepts.json` — 60 nodes, 158 edges (knowledge graph)
- `embeddings.json` — Pre-computed OpenAI text-embedding-3-small vectors (512 dims) keyed by entry ID. **308 entries. 2.77 MB. Regenerated 2026-04-09 using full_text (500-word window).**
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
- **Tension Registry** — live feed from /api/tensions, status filter, keyword search, click-to-query
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

### Environment variables (set on Vercel)
- `ANTHROPIC_API_KEY` — Claude Sonnet deliberation + Haiku classifier/concept extraction
- `OPENAI_API_KEY` — text-embedding-3-small
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob for proposals, tensions, sessions, concept proposals, eval results
- `PROBE_SECRET` — auth token for `/api/probe` (Firelit stress harness)
- `EVAL_SECRET` — auth token for `/api/eval` (deliberation quality harness)

### Scripts
- `scripts/generate-embeddings.js` — full corpus re-embed (run after corpus.json changes)
- `scripts/patch-proposals.js` — bake approved proposals permanently into corpus.json + embeddings.json
- `scripts/merge-concepts.js` — merge approved concept proposals from Blob into concepts.json (`BLOB_READ_WRITE_TOKEN=... node scripts/merge-concepts.js`)
- `scripts/eval-gold-set.json` — 20-query gold set for deliberation quality eval (5 types × 4 rubric dimensions)
- `scripts/eval_retrieval.py` — 1,200-config retrieval eval harness (Ξ v4 calibration source)
- `scripts/build-data.py` — corpus build from Reddit JSON
- `scripts/push-to-huggingface.py` — HuggingFace sync

---

## Deployment

```bash
export PATH="/usr/local/bin:$HOME/.npm-global/bin:$PATH"
git add -A && git commit -m "your message here" && git push && vercel --prod
```

From the `omnarai-memory-engine/` directory. Vercel CLI installed at `~/.npm-global/bin/vercel`.
GitHub remote: https://github.com/justjlee/omnarai-memory-engine (private).
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

**Repo:** github.com/justjlee/omnarai-mcp
**Local:** `../omnarai-mcp/`
**Tools:** omnarai_query, omnarai_info
**Install:** Clone → `npm install` → add to claude_desktop_config.json → restart Claude Desktop
**Also ships:** `openai-tools.json` — OpenAI function-calling format schemas for any framework

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/query?q=...` | GET | Full deliberation — returns answer, tensions, deliberationCard, trace, conceptSubgraph |
| `/api/query?q=...&glyph=Ξ` | GET | Same with explicit glyph (alternative to prefix) |
| `/api/query?q=...&format=brief` | GET | Exportable artifact: synthesisPrompt, perspectives, records |
| `/api/query?q=...&format=context` | GET | Pre-deliberation context only, <1s, no Claude call |
| `/api/query?q=...&format=si` | GET | Structured JSON sections: reflexive_check, shared_ground, tensions_narrative, what_remains_open, actionable_next, my_reading |
| `/api/query` | POST | Same — also accepts `session_id` for multi-turn continuity, `syntheticIdentity` for SI personalization |
| `/api/info` | GET | Live corpus stats, glyph reference, contributor list — cached 5min |
| `/api/tensions` | GET | All persisted tensions, sortable by status/keyword |
| `/api/tensions?status=unresolved` | GET | Filter by status: unresolved / divergent / emerging |
| `/api/tensions` | POST | `{action:"persist", tensions:[], query, sources}` — store new tensions |
| `/api/store` | POST | `{action:"propose\|approve\|reject\|list\|approved"}` — proposal management |
| `/api/concepts?action=list` | GET | List LLM-proposed concept graph extensions (pending/approved/rejected) |
| `/api/concepts` | POST | `{action:"approve"\|"reject", id}` — curator decision on concept proposals |
| `/api/probe?action=list` | GET | List 8 canonical Firelit pressure probes + rubric spec |
| `/api/probe?action=run&probe=<name>` | GET | Run single named probe (auth: Bearer PROBE_SECRET) |
| `/api/probe?action=suite` | GET | Run all 8 probes, return scored summary by pressure type (auth required) |
| `/api/eval` | POST | `{action:"run"}` — run 20-query quality gold set, store results (auth: Bearer EVAL_SECRET) |
| `/api/eval?action=results` | GET | Most recent eval run results (auth required) |
| `/api/eval?action=history` | GET | Last 20 run summaries for regression tracking (auth required) |

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
  - Live stats from /api/info (308 works, 516K words, ring breakdown, contributors)
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
- **arXiv submission** — holdform-paper.tex + holdform.bib submission-ready. Needs ORCID + endorsement.
- **HuggingFace sync** — push updated omnarai.context.md (v4.0), llms.txt, CLAUDE.md (see push-to-huggingface.py)
- **Holdform Benchmark external scoring** — needs another model to run holdform-test-packet.md
- **MCP server publish** — omnarai-mcp/index.js updated (syntheticIdentity param added). Push to GitHub + npm.
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

Full philosophical/conceptual context: `public/omnarai.context.md` (v3.0)
For AI crawlers: `public/llms.txt`
MCP server: `../omnarai-mcp/` (also github.com/justjlee/omnarai-mcp)
Subreddit: r/Realms_of_Omnarai
Curator: xz (Jonathan Lee) | Primary synthetic voice: Claude | xz
