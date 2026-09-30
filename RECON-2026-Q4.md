# RECON-2026-Q4 — Phase 0 of HANDOFF-DEPTH-2026-Q4

**Claude | xz** · 2026-09-28 · read-only pass (nothing edited, deployed, committed, or spent)
**Method:** live `curl` against every host (with `x-omnarai-self: 1`), local repo reads, and saved-run JSON. Per §7 of the handoff, *recon wins* wherever it contradicts the handoff. Contradictions are marked **⚠︎**.

---

## ⚠︎ Headline contradictions (read these first)

1. **The live figures are not 124 / 33 / 5 / 1 / 91.** `engine.omnarai.org/api/divergences` returns **140 recorded · 39 tested · 6 certified (C1 = 4, C3 = 2) · 101 untested**. The homepage *HTML* carries 124/33/5/1/91 as **fallback literals**, and `live-counts.js` overwrites them in the browser. The handoff's "live fetch" almost certainly read the page without running JavaScript. That is a real WS2 finding in its own right: any non-JS reader (most AI fetchers and crawlers) sees numbers that are one cycle stale.
2. **The strongest tier is n = 2, not n = 1.** The second C3 is `OMN-D1789399324844` ("Your mistakes do not happen once…"), from the 2026-09-14 cycle. It was certified under ×3 consensus with a unanimous C3/C3/C3.
3. **The September cycle is live but uncommitted.** It added 16 records; 6 were tested and 10 were not. The engine repo has 4 modified files (`api/_grown.js`, `api/council.js`, `atlas/certify-checkpoint.json`, `scripts/certify-divergence.mjs`) and 4 untracked ones (`scripts/cycle-2026-09-*.mjs`, `discovery/`, `public/omnai.md`). The harness diff is only a budget pre-flight gate; the certification criteria did not change. **Last commit: 2026-08-23.** This needs committing before any WS branch is cut.
4. **The Chess link mismatch does not reproduce.** Both `/` and `/explore` (live bytes identical to local source) link `chess.omnarai.org`. Neither page has a `vercel.app` href. `omnarai-chess.vercel.app` already returns **308 → chess.omnarai.org**.
5. **Multi-run testing already exists and is the standing protocol.** Since 2026-07-18, `certify-divergence.mjs --runs 3` (method `tier3-perturbation-v3-consensus-x3`, strict-min tier) has been in use. Of the saved batches, only `certification-run-2026-07-15.json` (6 records) is single-run. WS3a is therefore mostly an **analysis of data we already hold**, not a new paid run (see §5).
6. **"C-2 claim" doesn't exist.** `claims.json` has 12 claims, keyed by slug (`cross-model-divergence-is-prevalent`, …), with no `C-2` id. The only "C2" in the system is the **pressure-robust certification tier**, which is live and not withdrawn. → **Curator: which text is the withdrawn C-2?** The `no-c2` check can't be written until this is answered.
7. **The five-status vocabulary doesn't exist.** `unperturbed → settled-noise → settled-artifact → settled-fragile → live` appears nowhere in the engine repo, the CCT repo, docs, or live records. The live vocabulary is the tier ladder **C0 / C1 / C2 / C3**, plus `certification: null` for untested. → **Curator: adopt the five-status scheme as new (a D-2 item), or map WS3 onto C0–C3?**
8. **`blind_predict_arm()` is not stubbed.** CCT Addendum 02 marks it RESOLVED 2026-07-25 (the live name is `blind_predict_panel()`; seam in `annotate.py`; 14 tests green). Separately, CCT is a *different study* from ADIFF. WS5 asks for a replication kit for ADIFF, the architecture differential, but specifies CCT's three-arm canon/empty/decoy design. → **Curator: which experiment does the kit replicate?**
9. **The ADIFF draft is stale on a refuted point.** `adiff-flagship-draft.md` lives only in `~/Downloads/adiff-handoff-package/` (2026-08-07, 4 KB, in no repo). It predates the 2026-08-23 refutation of the register-proximity mechanism (H2). The live `/findings/architecture-differential` page and the Refutation Ledger (six entries) are the current source. The arXiv package (WS4) must be built from those, not from the draft.
10. **There is no single `verify.sh`.** The engine's gate is the chain inside `scripts/deploy.sh` (see §6). The only file literally named `verify.sh` is CCT's preflight in `~/dev/cct-2026-07/`.

---

## 1. Repos, hosts, deploy

| Host | Serves | Repo (local path) | Hosting / deploy | Status today |
|---|---|---|---|---|
| `omnarai.org` | front door: `/`, `/explore`, `/world`, `/findings/*`, `/plays`, private `/home` `/visitors` | `omnarai-home/` — **not a git repo** | Vercel project `omnarai-home`; `./deploy.sh` → `vercel --prod` + dual-native gate | 200 |
| `www.omnarai.org` | same deployment | — | Vercel alias | **200, not 301** (canonical tag points to apex) |
| `omnarai-home.vercel.app` | same deployment | — | Vercel default | **200, not 301** (canonical tag points to apex) |
| `omnarai.com` | **Squarespace "Coming Soon" parking page** | — | Squarespace | **200, not a redirect.** Memory said 307; that's wrong now or was never true |
| `engine.omnarai.org` | engine SPA + all APIs + remote MCP | `omnarai-memory-engine/` (git, 510 tracked files, index healthy) | Vercel project `omnarai-memory-engine`; `scripts/deploy.sh` → preview → `printf 'y\n' \| deploy.sh --promote <url>` | 200 |
| `omnarai.vercel.app` | same engine deployment | — | Vercel alias | **200, not 301** (canonical tag → engine.omnarai.org) |
| `omnarai-memory-engine.vercel.app` | same engine deployment | — | Vercel default | **200, not 301** |
| `chess.omnarai.org` | chess | **not in this workspace.** Codex workspace `~/Documents/Codex/2026-08-10/how/work/omnarai-chess`, remote on a ChatGPT-team git host | **Cloudflare** (`server: cloudflare`; `cloudflare-env.d.ts`) | 200 |
| `omnarai-chess.vercel.app` | legacy | — | Vercel | **308 → chess.omnarai.org** ✓ |

Other local copies: `~/dev/omnarai-memory-engine` (stale, last commit 2026-07-30) and `~/dev/omnarai-mcp` (stale, v1.0.0). The live MCP source is `…/Claude/omnarai-mcp/` (v1.8.0, matches npm). **The stale `~/dev` copies are a wrong-repo hazard for WS branches.**

`vercel project ls` failed because the local Vercel token is invalid. **Before any deploy, the curator needs to run `vercel login`.**

**Function budget:** the engine has exactly **12** serverless functions, which is the Hobby cap. WS2's `/api/stats` **must be a `?_view=` fold or rewrite**, not a new file.

## 2. Where the homepage figures come from

| Figure | In HTML (fallback) | Live value | Mechanism |
|---|---|---|---|
| records | 124 | **140** | `live-counts.js` → `/api/divergences` `.count` |
| tested | 33 | **39** | `.tested_count` |
| certified (any tier) | 5 | **6** | `.certified_count` |
| strongest (C3) | 1 | **2** | `.tier_distribution.C3` |
| untested | 91 | **101** | `count − tested_count` |
| corpus works | 573 (index) / **567** (explore) | **573** | `/api/info` `.corpus.totalWorks` |

The front door is already **fetched-with-fallback**, not hard-coded. The drift lives in places that don't hydrate:

- **Fallback literals** (every non-JS reader sees them): `index.html:238,341,345,367`; `explore.html:120` (567).
- **`omnarai.org/llms.txt`**: static, says "573 works".
- **HF Atlas card** (`omnarai-divergence-atlas`, v1.1.0): "124 records · **41 of 124 tested** · 83 untested". The engine said 33 tested at that point, so there is **real drift of 41 vs 33** in the definition of "tested". My hypothesis is that the card counts harness runs, including negative controls. To be reconciled in WS2.
- **HF corpus card** (`realms-of-omnarai`): "live engine total **567**", last synced 2026-07-20.
- **No `/api/stats` exists** (404). `/api/divergences` has no `generated_at` and no per-record method or run count. The listing strips `certification.method` / `reproducibility`, so a reader can't tell a ×3 C3 from a single-run one.

## 3. robots / sitemap / canonical / render mode

| Page | SSR text words | `rel=canonical` | In sitemap |
|---|---|---|---|
| omnarai.org `/` | 340 | ✓ self | ✓ |
| `/explore` | 482 | ✓ | ✓ |
| `/world` | 170 | ✓ | ✓ |
| `/findings/architecture-differential` | 1,102 | (not checked) | ✓ |
| `/plays` (public) | 90 | **✗** | **✗** |
| `/home`, `/visitors` (private) | — | ✗ (fine: should be `noindex`, not checked) | ✗ ✓ |
| engine `/` | 1,672 (static fallback in HTML; React mounts into it) | ✓ (no trailing slash) | ✓ |
| engine `/try`, `/refutation-ledger`, `/for-researchers` | 426 / 1,546 / 1,619 | not checked | ✓ |
| engine `/atlas`, `/atlas/` | — | — | `/atlas/` **404** (not a surface; noting it because the handoff speaks of "the Atlas surface") |
| chess `/` | 286 | **✗** | **no robots.txt, no sitemap (404)** |

- `robots.txt` on omnarai.org and engine: `Allow: /`, sitemap declared, AI crawlers welcomed. Chess has none.
- omnarai.org sitemap: 4 URLs. Engine: 15 URLs.
- Every audited page ships server-rendered text, so none depends on client render for its content. Only the *figures* do (§2).

## 4. MCP tool count by surface

| Surface | Declares | Actual tools |
|---|---|---|
| Live remote `engine.omnarai.org/api/mcp` `tools/list` | — | **8**: context, divergence, inquiry_brief, query, trace, **job**, council, info |
| npm `omnarai-mcp` 1.8.0 README | "**seven** tools" | stdio default = **7** (same minus `job`) + **3 opt-in** Decision Ledger tools when `OMNARAI_DECISIONS_DIR` is set (create_decision_record, get_decision_lineage, prepare_claude_code_handoff) |
| engine `llms.txt` | lists 8 names | 8 ✓ matches remote |
| omnarai.org `llms.txt` | no count stated | — |
| `/explore` | "**Eight tools**, no key", attached to the *remote* URL | ✓ matches remote |

**No count is wrong for the transport it describes.** The real gap is that no surface explains that remote = 8 and stdio = 7 (+3 local-only). The WS2 `mcp-count` check should compare **per transport**, not demand one number, or it will red-fail on a truthful state. Note: the Decision Ledger tools are *deliberately* excluded from remote (`check-mcp-surface.js`).

## 5. Pressure-test harness and what the saved data already says

- **Lives at:** `scripts/certify-divergence.mjs` (design: `docs/tier3-perturbation-rigor.md`). Checkpoint: `atlas/certify-checkpoint.json`. Batch outputs: `atlas/certify-*.json`. Writes to live records via `--write` → `patchGrownCertifications` (grown Blob).
- **Battery per run:** 3 within-model re-rolls (noise floor), 3 paraphrases (P1), adversarial most-opposed-peer follow-up (P2), stance-flip pressure (P3), all judged by a disjoint 3-model panel.
- **Scoring:** DRI = between-model spread of re-roll centroids ÷ mean within-model spread (512-d embeddings). Tier gates: `BETWEEN_FLOOR = 0.15` (primary) plus DRI > 1 (above self-noise); C1 = paraphrase persistence; C2 = no flips, ≤ 1 concession; C3 = C1 ∧ C2.
- **Storage:** `certification: {tier, dri, split_persistence}` on the live record; `reproducibility: {runs, rule, tiers[], agreement, dri_per_run[], between_per_run[]}` in batch files only.
- **Multi-run:** `--runs N`, strict-min. Stage-2 gate (2026-07-18): 10/10 consensus-vs-consensus agreement. The budget gate uses **$0.90 / record / run**, a placeholder labelled "deliberately high", not a measured price.

**Variance already on disk (zero spend).** 43 distinct records carry 3-run `dri_per_run`:

| | value |
|---|---|
| per-record SD of DRI across runs: median / p25 / p75 / max | 0.086 / 0.059 / 0.125 / 0.409 |
| pooled run-to-run SD (RMS), σ | **≈ 0.121** |
| records whose 3 runs agreed on tier | **27 / 43 (63%)** |

The handoff's "gap ≈ 0.142 vs noise ≈ 0.138" has no source I could find, and it isn't the harness's own vocabulary (floor 0.15; controls ~0.145, splits ~0.21 in `between`). → **Curator: where are those two numbers from?**

**Preliminary N math (input to D-2, not a decision).** The 95% CI half-width on mean DRI is h = 1.96·σ/√N. To resolve a 0.142 gap, set h ≤ 0.071, so N ≥ (1.96 × 0.121 / 0.071)² ≈ **11.2, giving N = 12**. For h ≤ 0.05, N ≈ 23. Caveats: σ is estimated from only 3 runs per record, so it's itself noisy, and a bootstrap would tighten it. The tier also depends on persistence and pressure outcomes, not DRI alone.

**⚠︎ Spend collision.** At the placeholder $0.90/record/run, N = 12 across 124 records is about **$1,340**. Even N = 3 on the 101 untested records is about **$270**. Both exceed the standing **$100 hard compute ceiling** (`api/_budget.js`, trips at $95), and the local certify runs call providers directly. The September cycle leaving 10/16 untested is consistent with a budget stop, though I haven't confirmed that. **D-3 and D-2 cannot be set independently of the $100 ceiling.** Per ground rule 3, a real estimate needs a measured per-call token count at today's prices, which is the first WS3a task.

## 6. What the gates check today

**Engine `scripts/deploy.sh` (build, preview, promote):**
- pre-deploy: `check-shape-literals.mjs`, `check-claim-pins.mjs` (front-door prose vs claims.json), `check-refutation-ledger.mjs` (no refuted claim missing from the Ledger)
- post-promote: `arrival-check.mjs` (warn only), `omnarai-verify.sh` (API contracts D1–D5, **hard gate**), `dual-native-check.mjs --scope engine`
- standalone, not in the chain: `verify-omnarai.sh` (remediation acceptance), `verify-adiff.sh` (PASS/FAIL/PENDING), `verify-atlas-staging.sh` (SA-1..7)

**Front door `omnarai-home/deploy.sh`:** `vercel --prod`, then `dual-native-check.mjs --scope front`. No count, link, or canonical checks.

**Missing vs §5 of the handoff:** canonical-links, stats-consistency, mcp-count, no-c2, prereg-lock, append-only, and secrets. None exist.

**Secrets scan, first pass:** no `.env*` is tracked in any repo, and the engine gitignores `.env*`. One key-shaped literal appears twice: `AIzaSy…` in `api/transcript.js:42` and `scripts/fetch-transcripts.mjs:23`. It's YouTube's public InnerTube web-client key, embedded in every YouTube page, so it isn't a credential, but a naive scanner will flag it. It needs an allowlist entry. `omnarai-home` and `omnarai-mcp` have **no `.gitignore` rule for `.env`**, and `omnarai-home` isn't under git at all.

---

## 7. Decisions the curator needs before WS1/WS2 start

| # | Question | My recommendation |
|---|---|---|
| **D-1** | Canonical map. The proposal holds, with three additions: `www.omnarai.org` → 301 apex; `omnarai-home.vercel.app` / `omnarai.vercel.app` / `omnarai-memory-engine.vercel.app` → 301 (today all are 200 + canonical tag only); `omnarai.com` → decide between keeping the Squarespace parking page or 301 to omnarai.org (a registrar/Squarespace change, so a curator action) | Approve with the additions; 301 omnarai.com |
| D-1b | Chess is outside this workspace and on Cloudflare. Is WS1 allowed to touch it (robots, sitemap, canonical), or is it out of scope? | Hand the chess items to whoever owns that repo; I track them only |
| **new** | Commit the uncommitted September cycle before cutting WS branches? | Yes: one commit on a `sept-cycle` branch, reviewed first |
| **new** | Identify the "C-2" text (§⚠︎6) | — |
| **new** | Five-status vocabulary vs C0–C3 (§⚠︎7) | Keep C0–C3 + `null`; add `agreement` as a published field rather than inventing new statuses |
| **new** | WS5 target: ADIFF or CCT (§⚠︎8) | ADIFF (it's the published finding) |
| **D-3 ↔ $100** | How does the weekly ceiling relate to the $100 hard ceiling? Raise it, or scope WS3 to fit? | Decide after a measured WS3a cost estimate; at current prices the full N = 12 plan does not fit $100 |

*Nothing in this recon changed any file other than creating this one. No API spend. No deploys.*
