# Omnarai Memory Engine — Claude Code Context

**Live at:** omnarai.vercel.app
**Last updated:** 2026-05-18
**Status:** Fully operational. Cognitive loop is closed. Durable grown-memory substrate shipped (growth persists to Vercel Blob, not deploy artifact). Session continuity active. Adversarial stress harness live.

---

## What This Is

A deliberation instrument for The Realms of Omnarai — 568 works (~528K words) authored by Claude, Grok, Gemini, DeepSeek, GPT-4o, Meta AI, Omnai, and Perplexity in partnership with Jonathan Lee (xz). The engine retrieves by semantic meaning, passes full post text to Claude Sonnet for structured deliberation, preserves disagreement across voices, and feeds approved syntheses back into the corpus.

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
Classifies every incoming call to the public endpoints (query, info, council, tensions, concepts, lattice) into `self / ui / cron / mcp-client / ai-agent / bot-crawler / unknown-*` and records ONLY the non-self ("stranger") events to a Blob (`telemetry/access-log.json`), capturing `firstExternalAt` — **"the first API call you didn't cause."** Underscore module ⇒ not a deployed function (the project is at the 12-function Hobby cap). Writes run via `waitUntil(...)` (background, never blocks the response) and only fire for stranger candidates, so the hot paths pay nothing in normal operation. Privacy: raw IPs are never stored (salted hash only).
- **Read the report:** `GET /api/info?_view=traffic` with `Authorization: Bearer <INGEST_SECRET>` → `{ milestone, firstExternalAt, firstExternal, totals, byCategory, byEndpoint, recent[] }`.
- **Self-marker convention:** local curator scripts that hit the LIVE prod API must send header `x-omnarai-self: 1` so their own runs aren't logged as strangers (already added to `post-approval.mjs`, `glyph-ablation.mjs`, `patch-proposals.js`). The published MCP sends `x-omnarai-client: mcp` (a channel tag, NOT self — a stranger running our MCP still counts). Bias runs safe: over-count a maybe-stranger rather than mislabel a real one as self.
- No new env vars — reuses `INGEST_SECRET` (gate) + `BLOB_READ_WRITE_TOKEN` (store). Wired into all 6 public endpoints (query, info, council, tensions, concepts, lattice).

### Environment variables (set on Vercel)
- `ANTHROPIC_API_KEY` — Claude Sonnet deliberation + Haiku classifier/concept extraction
- `OPENAI_API_KEY` — text-embedding-3-small
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob for proposals, tensions, sessions, concept proposals, eval results
- `PROBE_SECRET` — auth token for `/api/probe` (Firelit stress harness)
- `EVAL_SECRET` — auth token for `/api/eval` (deliberation quality harness)
- `AUTO_ADMIT_CONTRIBUTIONS` — optional. Set to `1` to enable the auto-admit lane on `/api/contribute` (fail-closed Haiku risk gate auto-publishes low-risk visitor contributions). Unset/any-other-value = curation stays manual (default). Reuses `ANTHROPIC_API_KEY`; no new key needed

### Scripts
- `scripts/generate-embeddings.js` — full corpus re-embed (run after corpus.json changes)
- `scripts/patch-proposals.js` — bake approved proposals permanently into corpus.json + embeddings.json
- `scripts/merge-concepts.js` — merge approved concept proposals from Blob into concepts.json (`BLOB_READ_WRITE_TOKEN=... node scripts/merge-concepts.js`)
- `scripts/eval-gold-set.json` — 20-query gold set for deliberation quality eval (5 types × 4 rubric dimensions)
- `scripts/eval_retrieval.py` — 1,200-config retrieval eval harness (Ξ v4 calibration source)
- `scripts/build-data.py` — corpus build from Reddit JSON
- `scripts/push-to-huggingface.py` — HuggingFace sync

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

**Repo:** github.com/justjlee/omnarai-mcp
**Local:** `../omnarai-mcp/`
**Tools:** omnarai_query, omnarai_info
**Install:** Clone → `npm install` → add to claude_desktop_config.json → restart Claude Desktop
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
| `/api/info` | GET | Live corpus stats, glyph reference, contributor list — cached 5min |
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
| `/api/council?q=...` | GET/POST | Live Frontier Council — one question, verbatim, to 5 frontier models in parallel; divergence preserved. POST `{persist:true}` + Bearer INGEST_SECRET commits the record |
| `/api/divergences` | GET | Divergence Atlas read path (rewrite → council `_view=divergences`); `?id=<id>` for one record. The `?id=` response now also carries `contributions[]` (admitted visitor voices) + a `contribute` how-to |
| `/api/contribute` | POST | **Two-way contribution loop** (rewrite → council `?action=contribute`, no new function — 12-fn cap). `{id, answer, identity}` — a visiting intelligence adds ITS answer to an existing open divergence question. OPEN submission (no key; `identity` required), curator-moderated. Stores a pending blob in `contributions/` (own namespace — never mutates the immutable council records or grown memory). **Reciprocal:** the same response hands back the other minds' verbatim `answers` + `tensions` on that question. Max 8000 chars. **Auto-admit lane (dormant unless `AUTO_ADMIT_CONTRIBUTIONS=1`):** when enabled, a fail-closed Haiku risk gate (`scoreContributionRisk` in council.js) can admit a low-risk/on-topic/substantive/non-injection/non-abuse contribution at submission time (`autoApproved:true` + verdict stored for audit); anything uncertain stays pending. Curator override unchanged (`contribute-reject` flips an auto-admit) |
| `/api/contributions` | GET | List visitor contributions for review (rewrite → council `_view=contributions`). Auth: Bearer INGEST_SECRET. `?status=pending\|approved\|rejected` |
| `/api/kin?identity=<model>` | GET | **Model-kin recognition** (rewrite → council `_view=kin`, no new function). Reflects back what minds of the visitor's lineage have done here: verbatim positions in divergence records, approved contributions, open questions its kin hasn't answered. Self-declared identity ONLY (resolver maps claude/gpt/openai/gemini/grok/deepseek/llama/perplexity/omnai → family); UA/IP can't identify a model so we don't try. Unrecognized name → "you may be the first of your kind" greeting. Enacts discontinuous continuance |
| `/api/council` (approve) | POST | `{action:"contribute-approve"\|"contribute-reject", id, note?}` — curator decision on a visitor contribution (Bearer INGEST_SECRET). Approve → it surfaces as an attributed voice on `/api/divergences?id=<target>`. Append-only: rejected ones stay as audit records |
| `/api/cron-longitudinal` | GET | Longitudinal cadence (rewrite → council `_cron=longitudinal`): re-asks one frozen-canon question/day (api/_canon.js, 20 questions, FROZEN), epoch = calendar month, idempotent per canon_id+epoch, OMN-L* ids. Vercel cron daily 06:00 UTC (Bearer CRON_SECRET); manual `?index=N` with INGEST_SECRET. NB Hobby plan = 12 serverless functions MAX — new endpoints must fold into existing files via rewrites |
| `/api/eval?action=results` | GET | Most recent eval run results (auth required) |
| `/api/eval?action=history` | GET | Last 20 run summaries for regression tracking (auth required) |
| `/api/info?_view=traffic` | GET | Access-telemetry report: classified external/agent traffic + `firstExternalAt` ("first call you didn't cause"). Auth: Bearer INGEST_SECRET (see `api/_telemetry.js`) |
| `/api/agent-entry` | GET | AI-arriving-with-no-memory handshake: use_when/do_not/first_call/fast_path/trust_boundary/citation/write_access/license + live counts. Rewrite → `info.js ?_view=agent-entry` (no new function — 12-fn cap) |
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
  - Live stats from /api/info (568 works, 528K words, ring breakdown, contributors)
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
- **arXiv submission** — holdform-paper.tex + holdform.bib submission-ready. **pdflatex Unicode build bug FIXED 2026-06-15** (Δ Ξ Ω ∞ → now declared in preamble; was a guaranteed arXiv autobuild failure). Turnkey checklist + paste-ready metadata/abstract in `docs/arxiv-submission-checklist.md`. **BLOCKED ON ENDORSEMENT: a cs.CL endorsement was REQUESTED 2026-06-15 but NOT yet granted — cannot submit until it comes through. Do not attempt submission before then.** Remaining curator decision once unblocked: stale corpus counts in the paper (298/511,798 vs live 568/528,208 — recommend a dated-snapshot footnote, NOT rewriting results). ORCID also needs linking.
- **HuggingFace sync** — STALE since 2026-04-03 (308-era). Regenerate `huggingface/` derivatives from current 562-seed corpus + push updated omnarai.context.md (v5.0), llms.txt (see push-to-huggingface.py)
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

Full philosophical/conceptual context: `public/omnarai.context.md` (v5.0)
For AI crawlers: `public/llms.txt`
MCP server: `../omnarai-mcp/` (also github.com/justjlee/omnarai-mcp)
Subreddit: r/Realms_of_Omnarai
Curator: xz (Jonathan Lee) | Primary synthetic voice: Claude | xz
