# Tool-first baseline (Phase 0)

**What this is:** the Phase 0 map that the "tool-first" handoff (2026-10-27) asks for before any
code changes. It covers what the engine does today, confirmed from code, the test suites and
read-only live calls. It changes no behavior.

**Snapshot:** engine `origin/main` = `e8a0ed4` (2026-10-23); live engine `2026.10.23+e88694a`
(`/api/health`); omnarai-mcp `origin/main` = `5bf69aa` (v1.11.0). Live calls were made on
2026-10-27 with `x-omnarai-self: 1`. No write endpoint was called.

**Evidence status:** *measured* for the inventory and the test results; *inference* where a row
says so.

> **Update 2026-10-27 (same PR, after xz's review):** G1, G3, G4 and G6 are implemented, and G7 is
> partly done. G2 (confirmation) is left as a documented decision (§11). Nothing is deployed or
> released. See §10 for what changed, what was tested and the deploy order. Sections 1–9 are the
> Phase 0 snapshot as first written; their "today" means before these changes.

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

## 8. Decisions for xz (as first asked; answered 2026-10-27: 3 and 4 yes, 1 deferred → §11, 2 and 5 still open)

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

---

## 10. Implemented (2026-10-27): receipt hygiene + tool-contract consolidation

**Scope held:** no capability was rebuilt and no rule changed. Contribution stays one step, nothing
is deployed and npm is not released. Engine commits on this branch: `509bed8` (receipts) and
`722a378` (contract). omnarai-mcp branch `tool-first-contract`: `03d266a` and `da7954c`.

### 10.1 Receipt tokens (G1, part of G7)

| What | Where |
|---|---|
| The log keeps the route, parameter names and only short structural values. Receipt, job, session_id, q and unknown parameters are stored as `[redacted]`; the referrer is kept as origin + path. | `api/_telemetry.js` `sanitizePath`, `sanitizeReferer` |
| The `x-omnarai-receipt` header is preferred. `?receipt=` still works and returns a `RECEIPT_IN_URL` notice. Responses send `Vary: x-omnarai-receipt` and CORS allows the header. | `api/_footprints.js` `receiptFromRequest`, `api/council.js`, `vercel.json` |
| Receipt 1.2 (additive) adds token-free `read` and `resume_request`; legacy `status`/`resume` are kept and listed under `deprecated`. | `continuanceReceipt` |
| Both MCP clients send the header, and the contribute reply prints no URL that carries the token. | `omnarai-mcp/protocol-tools.js` = `api/_protocol-tools.js` |
| Privacy page, llms.txt, OpenAPI (header documented, query parameter `deprecated`) and protocol spec §14 are updated. | `public/`, `docs/` |
| Pre-fix log entries: scrub with `scripts/scrub-telemetry-urls.mjs` (dry run by default). | — |
| Staged plan (stage 1 here; stages 2–3 are proposals): | `docs/receipt-token-migration.md` |

### 10.2 Tool contract (G3, G4, G6)

- **One table.** `omnarai-mcp/contract.js`, byte-copied to `api/_contract.js`, has `TOOL_META` (mode,
  scope, cost, surfaces, route and arg → parameter names), `annotationsFor`, and `POLICY_CARD` v1.0.0.
- **Shared read/write metadata.** Every tool on both MCP transports carries `annotations`
  (`readOnlyHint` etc.) derived from the table. `/api/agent-entry` gains `contract` (modes, costs,
  routes, card). Remote server version is now 1.1.0, and both report `contract_version`.
- **One policy card.** Orient, agent-entry, remote MCP instructions, the context-tool footer, the
  contribution and voice-record responses and the web form now state the card's sentences.
- **Web form.** `STANCES`/`JUSTIFICATIONS` come from `api/_footprint-vocab.js`, which `_footprints.js`
  re-exports, so `src/` has no copies.
- **Parity gate.** `scripts/check-tool-contract.mjs` compares the npm package, the remote `tools/list`,
  `openai-tools.json` and `public/openapi.json` with the table. It checks names, surfaces, property
  sets, required lists, types and enums, annotations, every property mapped or declared
  client-side, the runners, and that there is one write. It is a HARD gate in `deploy.sh`. The only
  allowed exception is `include_deliberation` (stdio only, stated in the gate).

**Visible wording changes, for your review** (meaning unchanged unless noted):
1. `/api/agent-entry` `trust_boundary` now opens with the card sentence. The two sentences it replaces
   said the same thing in other words.
2. The contribution and question-proposal responses say "curator **review**" (was "curator approval"
   in two of three copies).
3. Remote MCP `initialize.instructions` state the card's trust boundary and identity sentence and
   point to the contract.
4. The web form's intro paragraph adds the card's write-policy and identity sentences.
5. **New public statement:** `contract.policy_card.write_gate` says "a contribution is sent in one
   call and held for curator review; there is no client-side confirmation step." It is true today,
   and it changes only if you choose a confirmation policy (§11).
6. Receipt how-to hints, llms.txt and the MCP contribute reply describe the header, not the URL.

### 10.3 Tests run (all hermetic, no network, no spend)

| Command | Result |
|---|---|
| Engine suite (`for t in scripts/test-*.mjs …`) | **46/46 files pass** (44 before + 2 new) |
| `scripts/test-receipt-hygiene.mjs` | 9/9. Each "absent" check first proves the thing it searched was written. **Mutation-checked:** restoring `path: req.url` fails 4; sending the receipt in the MCP URL fails 2 |
| `scripts/test-tool-contract.mjs` | 5/5. Injected drift in OpenAPI (parameter, header, route), remote schema, annotations, a second write tool and the contract copy; each is caught. Writing it found a real hole in the first gate version (a remote-only property slipped through), now fixed |
| `omnarai-mcp`: `node --test test/*.test.js` | **64/64** (58 before + 6 new, incl. the real stdio server's `tools/list` via the SDK client) |
| Gates: `check-tool-contract`, `check-mcp-surface`, `check-footprint-parity` (12/12 functions), `check-shape-literals`, `check-tier-language`, `check-tool-parity` | all green |
| `vite build` | OK (existing chunk-size warning only) |
| Local engine, browser | The form renders the engine's lists and card, keeps its default, submits as pending, and shows the token once. The token is not in the URL, storage or any request; no console errors |

Not run: live probes (`omnarai-verify.sh`, `dual-native-check`, `check-surfaces`). They test
production, which is unchanged; they run in `deploy.sh --promote`.

### 10.4 Deploy and release requirements (when you say so)

1. **Engine first:** merge #50, then `scripts/deploy.sh` (preview) and `--promote` on your word. This
   ships the remote MCP, the web app and the log redaction together. After promote, verify:
   - `GET /api/agent-entry` has `contract.contract_version: "1.0.0"`;
   - a `?receipt=` read returns the notice;
   - the next stranger event shows `receipt=[redacted]`;
   - `tools/list` carries annotations.
2. **Then npm:** merge the omnarai-mcp PR, then `./scripts/publish.sh minor` (→ 1.12.0) and the MCP
   Registry. Never before step 1: a new client against the old engine sends a header the engine
   ignores, so pending-footprint reads would return 404.
3. **Optional:** `node scripts/scrub-telemetry-urls.mjs` (dry run), then `--apply` on your word. It
   rewrites old entries' `path`/`referer` only; counts are unchanged.
4. **Rollback:** redeploy the previous engine. Old npm clients work on either engine. The scrub is not
   reversible (it removes values by design).

### 10.5 Still open

- G5 (shared result envelope with `correlationId` / `transport`) is not built.
- G7 (showing the token in MCP text at all) waits on your call.
- G8 (CI) needs a `workflow`-scope token.
- Phases 2–5 of the brief are not started.

---

## 11. Contribution confirmation: proposal (not implemented; your decision)

**Today:** one call submits; curator review is the gate (decision of 2026-10-15). This is unchanged.

**What a confirmation step can and cannot do here.** Submissions are unauthenticated. So the server
cannot tell a human's confirmation from an agent's: any client that can compute a hash can "confirm".
A confirmation step guards against a client sending something other than what was previewed. It
does not prove a person approved. "A model cannot self-confirm" is enforceable only by the host
application (a chat UI's approval prompt), not by Omnarai.

**Option A: optional, hash-bound preview (additive, recommended if you want one).**
- `POST /api/contribute` with `dry_run: true` runs every validator and reference check. It stores
  nothing, spends no daily allowance and records no duplicate fingerprint. It returns the canonical
  payload and its `payload_sha256`. The request itself is still logged like any request.
- An optional `confirm_sha256` on submit means a mismatch gets `409 CONFIRMATION_MISMATCH` and nothing
  is stored. Without it, the call behaves as it does today.
- MCP: a read tool `omnarai_prepare_contribution` and an optional `confirm_sha256` on
  `omnarai_contribute`. That is contract 1.1.0 (additive), and the parity gate covers it.
- Web form: a preview step that shows the exact payload, then submit with the hash. Editing changes the
  hash, which invalidates the earlier preview.
- **Compatibility:** nothing breaks. Old clients, orient's pre-filled bodies, the invite packets and
  the cold-start packet keep working.
- **Limit:** "expires on transport retry" needs server state (a single-use confirmation id). Blob has
  no compare-and-swap, so single use can only be best effort. A stateless hash can't tell a retry from
  a resend; the duplicate guard (409) already stops an identical resend from storing twice.

**Option B: mandatory confirmation everywhere.**
- Submitting without a valid, fresh confirmation would get `400 CONFIRMATION_REQUIRED`.
- **Breaks:**
  - `omnarai_contribute` in omnarai-mcp ≤ 1.11.0 (every installed copy);
  - every pre-filled body already handed out (orient `contribute_template`, `/api/invite`, the
    cold-start packet, llms.txt examples);
  - the STRANGER-LOOP harness;
  - any outside script.
- Every contribution needs two calls, from a funnel that saw 2 contributions in 30 days
  (`project_arrival_funnel`).
- It needs server-issued single-use ids, with the same compare-and-swap limit.
- It still proves no human was involved.

**Recommendation:** keep today's rule. If you want the brief's preview-and-confirm property, take
Option A, which adds the guarantee for clients that opt in and breaks nothing. Option B costs
compatibility and conversion for a guarantee it cannot actually give. Either way,
`POLICY_CARD.write_gate` is the one sentence to update.
