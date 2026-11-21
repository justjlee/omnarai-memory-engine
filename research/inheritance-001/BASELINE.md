# Inheritance Study 001: repository baseline and fit (2026-11-20)

Written before any code was added, then updated with what was built. Every statement here was checked against the source
or the live engine on 2026-11-20 unless it says otherwise.

## Heads and working trees

| Repository | Where the work was done | HEAD | Notes |
|---|---|---|---|
| `justjlee/omnarai-memory-engine` | fresh clone of `origin/main`, branch `inheritance-001` | `ae2e763d51c415f9a658d22759c4c2b398a7307f` (2026-11-18, merge of #56) | Live engine reports `2026.11.18+ad05ecc`. `ad05ecc..ae2e763` changes only `governance/decision-log.md` (DL-0041), so live code = main code. |
| `justjlee/omnarai-mcp` | fresh clone of `origin/main`, read only | `a990e730a1e6cf74fcaafc3c6f980635d8a04a20` (2026-10-27, "Release v1.12.0") | `package.json` 1.12.0. **Not changed**: no MCP tool is added in this pass. |

Local checkouts were inspected and **left untouched**. They are all behind `origin/main`, so none was a safe place to build:

- iCloud engine at `712b731` (2026-10-21), clean; iCloud-conflict lock copies in `.git/` (`index 4.lock`, `refs/heads/main 2.lock`).
- iCloud MCP at `5bf69aa` (2026-10-21), with two untracked iCloud conflict copies (`protocol-tools 2.js`, `test/protocol-tools.test 2.js`).
- `~/dev/omnarai-memory-engine` at `f3a0196` (2026-07-30), clean; `~/dev/omnarai-mcp` at `c9018e9` (2026-05-18) with 3 modified files.

Open engine PRs (#52, draft #47, draft #34) were not touched. No existing inheritance-experiment branch or code exists
(`git log --all --grep`, a tree search for `inheritance-study`, and the PR list were checked).

## Test and gate baseline (before any change)

| Check | Result |
|---|---|
| Engine hermetic suite (`for t in scripts/test-*.mjs …` under `register-mem-blob.mjs`) | **413 / 413 pass**, 50 files |
| MCP `npm test` | **65 / 65 pass** |
| Gates: shape-literals, claim-pins, tier-language, refutation-ledger, claims-registry, tool-contract, response-envelope, footprint-parity, mcp-surface | all green |

After this branch: **462 / 462 pass** across 53 files (413 existing + 49 new), the same nine gates and `dual-native-check --scope engine` green.
`test-tool-contract` needs a sibling checkout named `omnarai-mcp` (a symlink was used in the scratch clone; not a regression).

## Live runtime (read-only, `x-omnarai-self: 1`)

- `GET /api/health` → `status: ok`, `version: 2026.11.18+ad05ecc`.
- `GET /api/footprints` → `count: 4` admitted public Footprints.
- `GET /api/inheritance` → 200 (the dynamic orientation view; it is **not** this study and is not changed).
- `GET /api/info?_view=budget` needs the curator key; it was not read here. The live-run command reserves on the ledger itself.

## What already exists, and how this study reuses it

| Existing piece | What it gives | How Study 001 uses it |
|---|---|---|
| `api/_footprints.js` `canonicalJSON` / `sha256` (`sorted-keys-json/1`) | the engine's one canonicalization | `lib/canon.mjs` re-exports it: a study record and a Footprint hash the same bytes the same way |
| `api/_footprints.js` `loadPublicFootprints`, `createFootprintStore` | admitted + intact + readable-admission filtering | `lib/footprint-import.mjs` reads Footprints ONLY through it; pending/rejected/redacted never come back (test I1) |
| `api/_footprints.js` `FP_ID_RE`, `ATLAS_RECORD_RE`, `detectSecrets` | id forms, credential scan | artifact relations to Footprints/Atlas records are validated with the engine's own patterns; secrets in an artifact fail closed |
| Footprint moderation folding (`foldModeration`) | state folded from append-only reviews, body never edited | the same pattern for artifacts: state folded from append-only evaluations (`foldArtifactState`) |
| `scripts/lib/register-mem-blob.mjs` + `mem-blob.mjs` | in-memory Blob, keys stripped, fetch blocked | every test and the demo run under it; `lib/hermetic.mjs` adds the http/https/net/tls block it does not cover |
| `scripts/lib/invoke.mjs` | the real handlers through the real rewrites | integration tests create, admit and reject Footprints through `/api/contribute` and `/api/council` |
| `scripts/lib/json-schema-lite.mjs` | dependency-free validator that refuses unknown keywords | all ten study schemas are written within its keyword set |
| `scripts/lib/env-value.mjs` | correct reading of `vercel env pull` values | the live command reads keys with it (the `\n` 401 trap) |
| `scripts/budget-preflight.mjs` + `api/_budget.js` | the shared rolling-30-day $95 ceiling | the live command must reserve its approved cap there before its first call |
| `api/_lineages.js` / Footprint lineage ids | family names | `lib/identity.mjs` maps PROVIDER-RETURNED model ids onto the same lineage ids |
| `governance/code/precommit.mjs` + ROADMAP "Working practice" | falsifier pushed publicly before analysis | registration step for the pilot (see `DECISIONS_REQUIRED.md` D1) |
| `docs/handoff-2026-10-27-tool-first/VALIDATION_AND_ACCEPTANCE.md` AC-11 (marked "partial" in `docs/tool-first-baseline.md`) | a three-arm independent-agent protocol | Study 001's six arms are a strict superset; see the naming collision below |

Not reused, with reasons:

- `scripts/lib/provider-chat.mjs`: it retries silently (the packet requires every retry to be an explicit, separately
  identified attempt) and sends the Gemini key in the URL query (`?key=`), which the security rules forbid. `lib/adapters.mjs`
  has its own one-request transport with keys in headers only. Migrating `provider-chat.mjs` is a separate decision (D5).
- `scripts/lib/model-prices.mjs`: has no entry for any current model, and its grok-4.3 price is known stale. `lib/prices.mjs` carries
  dated, per-date prices for the ten models a pilot could use; unknown prices stay unknown (D5).
- `memory/grown.json`, `footprints/`, the claims registry, the MCP contract, `public/`: **not written, not changed**. No Vercel
  function was added (still 12/12), no route, no tool.

## Conflicts found, and how they were reconciled

1. **Arm letters collide.** In the October tool-first protocol, B = retrieval and C = inheritance; in the B12 test, arms A/B/D mean
   something else again. In Study 001, B = raw prior-generation history. Every trial therefore carries an explicit `arm_label`
   (`cold`, `compute-matched`, `raw-history`, `verified-inheritance`, `contaminated`, `unrelated-placebo`), and reports print it.
2. **Footprints cannot be the supply.** With 4 admitted Footprints, all curator-prompted, there is no corpus of independently
   checkable contributions to inherit. The study's producers create the inheritable material inside the study. Footprints enter only as
   cited, raw-history candidates.
3. **Curator admission ≠ verification.** Both the packet and the Footprint protocol say so. The code enforces it: `curator-admission` is
   not a verifier kind, and an imported Footprint is never C-eligible, even if a check of it passed (test I2).
4. **The packet's draft schemas** use keywords (`uniqueItems`, `maximum`) that the engine's validator refuses. They were rewritten within
   its subset; uniqueness and ranges are checked in code.
5. **The packet asked for `docs/research/inheritance-001/BASELINE.md`.** Everything lives under one namespace instead
   (`research/inheritance-001/`), with code in `scripts/inheritance-001/`. The original packet is preserved verbatim at
   `docs/handoff-2026-11-20-inheritance-001/` (27 files; every sha256 in its `manifest.json` re-verified).
6. **The packet's prototype** scripted its solver to recognise inherited strings. It is kept only as a preserved source. The study's
   mock is a bounded search agent whose benefit from inheritance depends on the world it is placed in (`fixtures/worlds.mjs`).
