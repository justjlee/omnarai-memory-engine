# Tool-first baseline (Phase 0)

**What this is:** the Phase 0 map that the "tool-first" handoff (2026-10-27) asks for before any
code changes. It covers what the engine does today, confirmed from code, the test suites and
read-only live calls. It changes no behavior.

**Snapshot:** engine `origin/main` = `e8a0ed4` (2026-10-23); live engine `2026.10.23+e88694a`
(`/api/health`); omnarai-mcp `origin/main` = `5bf69aa` (v1.11.0). Live calls were made on
2026-10-27 with `x-omnarai-self: 1`. No write endpoint was called.

**Evidence status:** *measured* for the inventory and the test results; *inference* where a row
says so.

---

## 1. Bottom line

Most of the brief's target already exists, under different names. Discovery, orientation,
bounded retrieval, inspection, inheritance, state-only status and a single curator-reviewed
contribution path are all live. They are reachable over HTTP and over both MCP transports, and
their schemas currently match. The trust boundary, declared identity and "no consensus score"
are already enforced in code and covered by tests.

The real gaps are narrower than the brief assumes:

| # | Gap | Severity | Needs xz? |
|---|---|---|---|
| G1 | Continuance-receipt tokens travel in URLs (`?receipt=`), and the access log stores the full URL (`path`, 300 chars). Reproduced offline. 0 occurrences in a 35,000-event sample of the last 35 days. | Medium (hygiene; the log is curator-only) | No: fix is additive. Yes: the privacy wording change |
| G2 | No preview or confirmation step. `POST /api/contribute`, the web form and `omnarai_contribute` all submit in one call. Curator review is the only gate. | Design decision | **Yes** |
| G3 | No single tool registry. Tool definitions live in four hand-synced places. No gate compares the npm `ENGINE_TOOLS` with the remote `api/_mcp.js` schemas (they match today by hand). | Drift risk | No |
| G4 | No MCP `annotations` (`readOnlyHint` / `destructiveHint`), no `outputSchema`, and remote `serverInfo.version` is `1.0.0` while the package is 1.11.0. | Low | No |
| G5 | No shared result envelope. Results carry no `correlationId`, `transport` or contract version. Provenance fields exist per operation but are not normalized. | Low | No |
| G6 | The web form hand-copies `JUSTIFICATIONS` and `STANCES`, and no gate covers the copy. The trust-boundary sentence exists in at least 7 differently worded copies. | Low | No |
| G7 | The MCP text renderers print the receipt token in plain text, so it lands in host transcripts. | Low–medium | **Yes** (shapes the contract) |
| G8 | No CI. The token lacks `workflow` scope, which is already known. | Process | Yes (token) |

Nothing found contradicts a moderation rule. The auto-admit lane (`AUTO_ADMIT_CONTRIBUTIONS`)
exists but is **not set** in production (env names listed 2026-10-27), so every contribution is
held for review.

---

## 2. Checks run (unchanged code)

| Command | Result |
|---|---|
| `for t in scripts/test-*.mjs; do node --import ./scripts/lib/register-mem-blob.mjs --experimental-test-module-mocks --test "$t"; done` | **44/44 files pass, 0 failures** (342 top-level tests; several files bundle many checks into one test) |
| `cd ../omnarai-mcp && node --test test/*.test.js` | **58/58 pass** |
| `node ../omnarai-mcp/scripts/check-tool-parity.js` | OK: 13 engine tools match `openai-tools.json`, 3 decision tools local-only, versions agree at 1.11.0 |
| `node scripts/check-mcp-surface.js` (with `../omnarai-mcp` present) | OK: 14 remote tools; the only write is `omnarai_contribute`; byte-copies in sync |
| `node scripts/check-footprint-parity.mjs` | OK: schema ↔ validator, 8 routes on 7 surfaces, 5 MCP tools, 12/12 functions |
| `node scripts/check-shape-literals.mjs` | OK |

There were no pre-existing failures. The iCloud conflict copies `omnarai-mcp/protocol-tools 2.js` and
`test/protocol-tools.test 2.js` are untracked and were not run (`npm test` = bare `node --test` may
pick them up; use the explicit glob).

---

## 3. Operation inventory

Brief name → what exists. "HTTP" routes are confirmed in `vercel.json` and `/openapi.json` (22
paths, spec 5.5.0). "MCP" means present in the live remote `tools/list` (14 tools) **and** the npm
package (13 engine tools + 3 local-only decision tools).

| Brief op | Existing operation(s) | Transports | Mode | Confirmation | Rate limit | Provenance it carries | Source | Tests |
|---|---|---|---|---|---|---|---|---|
| `discover` | `/api/agent-entry`, `/api/health`, `omnarai_info`, MCP `initialize` + `tools/list`, `/openapi.json`, `/llms.txt` | HTTP + MCP + static | read | none | CDN cache | `protocol_version`, `trust_boundary`, `write_access`, engine version | `api/info.js`, `api/_mcp.js`, `public/` | `check-mcp-surface.js`, verify T-series |
| `orient` | `GET /api/orient?identity=&focus=` / `omnarai_orient` | HTTP + MCP (both) | read, deterministic, no model call | none | none | `declared_identity.how` ("declared, never verified"), `trust_boundary`, record/question/answer ids, `protocol.deterministic` | `api/_protocol.js` | `test-protocol` (23), `test-open-challenges` (8), `test-awaiting-outside-response` (8) |
| `context` | `GET /api/query?q=` (bare GET = retrieval) and `format=context` / `omnarai_context`, `omnarai_query depth=retrieve` | HTTP + MCP | read, no model call | none | none | record `id`, `layer`, `evidence`, `contributors`, `date`, role (anchor/divergence/relevance), `retrieval_filters` echo | `api/query.js` | `test-exclude-ids`, `test-opaque-ids` |
| `inspect` | `/api/divergences?id=`, `/api/footprints?id=`, `/api/questions?id=`, `/api/concordance?question_id=` / `omnarai_divergence`, `omnarai_footprints`, `omnarai_concordance` | HTTP + MCP | read | none | none | verbatim answers with model + date, `received_params` echo, `integrity.content_sha256`, `derived:true` vs declared, `sources` | `api/council.js`, `api/_protocol.js`, `api/_footprints.js` | `test-protocol`, `test-footprints` (34), `test-relationship-chains` (7), `test-stance-consensus` (11) |
| `inherit` | `/api/inheritance[?from=<fp>&receipt=]` / `omnarai_inheritance` | HTTP + MCP | read, deterministic | none | none | established by `evidence_level`, `do_not_rediscover` (refuted), `disputed`, `genuinely_open`, `recently_changed`, `since_then` | `api/_protocol.js` | `test-protocol`, `test-open-challenges` |
| `prepareContribution` | **does not exist** | — | — | — | — | — | — | — |
| `contribute` | `POST /api/contribute`, `POST /api/voice-records` / `omnarai_contribute` (answers only) | HTTP + MCP + web form | **write** (to review queue) | **none**: one call submits | 10/day per visitor (`CONTRIB_DAILY_CAP`), exact-duplicate 409, 8000 chars | footprint id, `content_sha256`, continuance receipt, `client` tag | `api/council.js submitContribution`, `api/_footprints.js` | `test-contribute-guard` (9), `test-footprints`, `test-mcp-contribute` (5), `test-voice-records` (8) |
| `footprintStatus` | `GET /api/footprints/status?id=` / `omnarai_footprint_status` | HTTP + MCP | read, state only | none | none | state, reason code, origin label; never content, identity or note | `api/council.js serveFootprintStatus` | `test-footprint-admission` (12), `test-mcp-contribute` M5 |
| `trace`/`evaluate` | `/api/trace?q=` / `omnarai_trace` (+ `omnarai_job` poll on remote) | HTTP + MCP | read, **spends money** | none | `$95` budget ceiling (fails closed) | `receipt.measured:true`, labelled single-run demonstrator | `api/query.js` | `test-budget` |
| (not in brief) | `omnarai_council` / `/api/council`, `omnarai_inquiry_brief`, `omnarai_query` deliberate | HTTP + MCP | read, council spends money | none | council 5/day per visitor | verbatim per-model answers | `api/council.js`, `api/_inquiry.js` | `test-quota` |

**Curator-only (not tools, Bearer `INGEST_SECRET`):** `contribute-approve` / `-reject`, `/api/contributions`,
`/api/store` approve/reject, `/api/concepts` approve/reject, `annotate`, council `persist`.
None of these is exposed on either MCP transport (`check-mcp-surface.js`).

### Error shape (confirmed live)

Errors are JSON with a string `error`, plus `code`, and usually `agent_action` / `hint` /
`retryable` / `received_params`. Examples from 2026-10-27:
`400 BAD_FOOTPRINT_ID`, `404 FOOTPRINT_NOT_FOUND` (same 404 for pending and unknown), `404 QUESTION_NOT_FOUND`.
Contribution refusals: `MISSING_FIELDS`, `MISSING_IDENTITY`, `ANSWER_TOO_LONG`, `JUSTIFICATION_REQUIRED`,
`QUESTION_NOT_FOUND`, `INVALID_PROTOCOL_FIELDS`, `SECRET_DETECTED`, `409 DUPLICATE_CONTRIBUTION`,
`429 CONTRIBUTION_QUOTA`, `FOOTPRINT_INVALID`, `REFERENCE_INVALID`, `503 REFERENCE_CHECK_UNAVAILABLE`.
On every refusal, nothing is stored. Over MCP, refusals return as tool errors carrying the fix
(`test-mcp-contribute` M4). Constraint: `error` must stay a string, because the UI reads it that way.

### HTTP vs MCP-only

Nothing is MCP-only on the engine side. Every MCP tool is a thin client of an HTTP route.
The exceptions are by design:
- `omnarai_job` (remote only) wraps `GET /api/query?job=`. The remote transport is stateless, so
  `query`/`trace` there are submit-then-poll.
- The three decision-ledger tools exist only on stdio, writing local files under `OMNARAI_DECISIONS_DIR`.
  Policy forbids them on remote.

### Schema parity matrix (stdio package vs live remote `tools/list` vs `openai-tools.json`)

| Tool | stdio | remote | openai | Input properties |
|---|---|---|---|---|
| orient, footprints, footprint_status, concordance, inheritance, contribute | ✓ | ✓ | ✓ | identical (byte-copied module, gated) |
| query, context, divergence, trace, council, info | ✓ | ✓ | ✓ | identical, **kept by hand: no gate compares stdio ↔ remote** |
| inquiry_brief | ✓ | ✓ | ✓ | remote lacks `include_deliberation` (documented: remote has no deliberation path) |
| job | — | ✓ | — | remote-only poll |
| 3 decision tools | ✓ | — | — | local-only by policy |

Semantic differences: remote `query`/`trace` are async (submit + `omnarai_job`), while stdio polls
internally. No tool on either transport declares an `outputSchema` or `annotations`.

---

## 4. The contribution and review path

**There is one authoritative path:** `submitContribution` in `api/council.js` (`/api/contribute`).
Voice records take a parallel route with the same guards and the same review.

```
web form (ParticipationTab LeavePosition) ─┐
omnarai_contribute (stdio + remote MCP)    ├─→ POST /api/contribute → validate → secret/duplicate/quota guards
raw HTTP                                   ┘        → contribution blob (pending) + write-once footprint
                                                    → curator: /home Arrivals → contribute-approve|-reject (Bearer)
                                                    → append-only review event → public only if admitted
```

- The UI does **not** bypass server validation. It posts the same body. It duplicates two
  vocabularies (`STANCES`, `JUSTIFICATIONS` in `src/components/ParticipationTab.jsx:31-32`), and
  `check-footprint-parity.mjs` does not check that copy (the MCP enum is checked).
- The auto-admit lane (`council.js` around line 510) runs only when `AUTO_ADMIT_CONTRIBUTIONS=1`. That
  variable is absent from production env (confirmed 2026-10-27).
- Review language is truthful today: the response says "Held for curator review". Status is
  `pending | admitted | rejected | retracted | redacted`. Pending and unknown ids return the same 404 on
  content reads.
- A rejection needs a public reason code plus a curator-only note. A reversal needs a note. Nothing is
  overwritten (`test-footprint-admission`).

---

## 5. Risks in detail

**G1: receipt tokens in URLs and in the access log.** `continuanceReceipt()`
(`api/_footprints.js:908`) returns `status` and `resume` as URLs that embed `&receipt=<token>`.
Every request to `/api/council` (which serves `/api/footprints` and `/api/inheritance` by rewrite)
goes through `recordAccess`, and `buildEvent` (`api/_telemetry.js`) stores `path: req.url` (300
chars). An offline run of `buildEvent` with a fake token stored it verbatim (`token_in_event: true`).
On the live log, 0 of 35,000 events (the day view's 1,000-per-day cap × 35 days, so a sample, not a
census) carried `receipt=`. The token only unlocks a visitor's own pending footprint, and the log is
curator-only. The issue is still a direct miss against the brief's AC-10. Separately,
`public/limitations.md` (Privacy) lists what the log keeps and omits the URL `path`, which can also
hold more of the question than the stated 200 characters. Vercel's own request logs also see query
strings.

**G2: no hash-bound confirmation.** An agent with MCP access can submit in one call. The curator
chose this on 2026-10-15: `omnarai_contribute` was added so MCP agents do not have to drop to raw HTTP.
The safety property today is "nothing is public until a person admits it", not "a human confirmed
before sending". The brief's model (preview → confirm-for-payload-hash → submit) would change that
posture. This is a product decision, not a bug.

**G3: four places define tools.** These are `omnarai-mcp/lib/tool-definitions.js`, `omnarai-mcp/protocol-tools.js` (byte-copied to
`api/_protocol-tools.js`), `api/_mcp.js`, `openai-tools.json` and `public/openapi.json`. Three gates
cover parts of this. None covers stdio `ENGINE_TOOLS` ↔ remote `api/_mcp.js`, and none covers OpenAPI ↔ MCP.

**G6: trust-boundary wording.** It appears in at least 7 copies across `api/_mcp.js` (2),
`api/_protocol.js` (2), `api/_protocol-tools.js`, `api/info.js` and `api/query.js`. The contribution
response carries an eighth sentence with a different scope. They agree in meaning and differ in words. The brief asks for one versioned source.

---

## 6. Compatibility constraints (any change must respect these)

- `api/` sits at the **12/12** Vercel Hobby function cap. New routes fold in via `vercel.json` rewrites.
  Rewrites do not chain.
- Response changes are **additive only**. `error` stays a string. Frozen ids (`OMN-Q-` derivation,
  `OMN-FP-` format) never change.
- `api/_protocol-tools.js` and `api/_inquiry.js` are **byte copies** of omnarai-mcp files. Edit
  omnarai-mcp first.
- Tool changes land in `omnarai-mcp/lib/tool-definitions.js` first, then `openai-tools.json`, then `api/_mcp.js`.
  An npm change reaches users only after `scripts/publish.sh`.
- Figures are generated, never typed (`check-surfaces.mjs`). Dual-native gate on both deploys.
- Production deploys only on xz's "deploy" (preview → promote).

---

## 7. Proposed change plan (not started)

Smallest first. Items marked ⚑ wait on a decision in §8.

1. **Phase 1a: contract parity gate (no behavior change).** Add a hermetic check that loads the
   stdio `ENGINE_TOOLS` and `PROTOCOL_TOOLS`, drives `handleMcp` `tools/list`, and compares property sets and
   required fields with documented exceptions (`include_deliberation`, `omnarai_job`, decision tools).
   Closes the G3 hole.
2. **Phase 1b: one capability card.** Move the trust-boundary, identity and write-policy sentences into
   one versioned module (e.g. `api/_contract.js`, with the canonical copy in omnarai-mcp if MCP renders
   it). Serve it from `/api/agent-entry` and MCP `initialize.instructions`, and add `contract_version`.
   Additive.
3. **Phase 1c: MCP tool annotations.** `readOnlyHint: true` on every read tool; `readOnlyHint: false,
   destructiveHint: false, idempotentHint: false` on `omnarai_contribute`. Align remote `serverInfo.version`.
   Needs an npm release.
4. **Phase 1d: receipt hygiene (G1).** Redact `receipt=` (and any `token=`) from the telemetry `path`
   before it is stored. Accept the receipt in a header (`x-omnarai-receipt`) beside the query param, and
   have the MCP clients use the header. Update `limitations.md` to list `path`. The URL form stays
   accepted for compatibility.
5. ⚑ **Phase 3: preview and confirmation (G2, G7).** Option A (additive, no rule change): a
   side-effect-free `POST /api/contribute?dry_run=1` (or `omnarai_prepare_contribution`) that runs every
   validator and returns the canonical payload and its sha256. `contribute` accepts an optional
   `confirm_sha256` and refuses on mismatch. The web form shows the preview and requires the click.
   Option B: make confirmation mandatory for MCP too. That changes the 2026-10-15 decision.
6. **Phase 1e:** generate the web form's vocabularies from the API (or gate the copy).
7. **Fixture lab (Phases 3–4):** `scripts/local-engine.mjs` and the in-memory Blob already give a
   production-isolated engine. The lab scenarios can run there with no new infrastructure.

Phases 2, 4 and 5 (orientation UI, the three-arm agent study, hardening) are not planned here. The
three-arm study overlaps existing preregistered work (`utility-eval-preregistration.md`, ADIFF,
trace_delta) and would spend real money.

---

## 8. Decisions for xz

1. **Contribution confirmation (G2).** Keep one-step MCP contributions with review as the gate
   (today's rule), add an *optional* hash-bound preview (Option A), or require confirmation everywhere (Option B)?
2. **Receipt token display (G7).** Keep printing the token in MCP text, or show it only in
   `structuredContent` with a "keep private" line?
3. **Privacy wording.** Approve adding "the request URL" to the access-log list in `limitations.md`.
4. **Scope.** Proceed with 1a–1d (no rule changes, one npm release, one engine deploy on your word)?
5. **CI.** A token with `workflow` scope, if you want the gates to run on GitHub.

---

## 9. Acceptance-criteria status today

| AC | Status | Note |
|---|---|---|
| AC-01 registry | ✗ | No single registry (G3) |
| AC-02 read ops from a fresh client | ✓ mostly | orient/context/inspect/inherit all documented and live; no fixture transcript yet |
| AC-03 HTTP/MCP invariants | partial | Schemas match; no stdio↔remote gate; async difference documented |
| AC-04 source/derived/transport in every result | partial | Provenance per op; no `transport`/correlation id (G5) |
| AC-05 disagreement kept | ✓ | `test-protocol`, `test-stance-consensus`: no consensus field by construction |
| AC-06 side-effect-free prepare + hash-bound confirm | ✗ | G2 |
| AC-07 existing curator path, truthful states | ✓ | `test-footprint-admission`, `test-mcp-contribute` |
| AC-08 record ≠ identity continuity | ✓ | Receipt `proves:` text; inheritance "Continuity of records, not identity" |
| AC-09 retrieved text cannot authorize | ✓ by construction | No tool can approve/publish/delete (`check-mcp-surface`); no adversarial fixture suite yet |
| AC-10 no raw tokens in logs | ✗ | G1 |
| AC-11 independent-agent protocol | partial | Existing preregistered studies; not in the brief's three-arm form |
| AC-12 accessibility | unknown | Form has labels and `role=status`; no automated run |
| AC-13 rollback per tool | partial | Preview→promote and per-deploy rollback; no per-tool kill switch |
