# Receipt tokens: out of URLs (migration plan)

**Status:** Stage 1 is implemented on branch `tool-first-baseline` (PR #50). It is **not deployed**. Stages
2 and 3 are proposals that wait for xz's decision.

## Why

A continuance receipt's `token` is a bearer key: whoever holds it can read that footprint while it is
pending. Until now the documented way to use it put the token in the query string, as
`/api/footprints?id=…&receipt=<token>` and `/api/inheritance?from=…&receipt=<token>`. That form
appeared in the receipt's own `status`/`resume` fields, llms.txt, OpenAPI and both MCP clients.

A token in a URL is copied wherever URLs are kept:
- **Our access log.** `buildEvent` stored `path: req.url`. This was reproduced offline. A 35,000-event
  sample of the live log on 2026-10-27 held 0 such tokens.
- The hosting platform's request logs.
- Proxies.
- Browser history.

## Stage 1: accept the header, stop logging the URL (this PR, backward compatible)

| Change | Where | Old clients |
|---|---|---|
| The log keeps the route, parameter names, and values only for short structural parameters. Everything else (receipt, job, session_id, q, unknown) becomes `[redacted]`. The referrer is kept as origin + path. | `api/_telemetry.js` `sanitizePath` / `sanitizeReferer` | Unaffected |
| The engine reads the token from the **`x-omnarai-receipt` header** first, then `?receipt=`. A read that used the URL form carries `notices: [{code: "RECEIPT_IN_URL"}]`. Responses send `Vary: x-omnarai-receipt`, and CORS allows the header. | `api/_footprints.js` `receiptFromRequest`, `api/council.js`, `vercel.json` | `?receipt=` still works |
| The receipt (version 1.1 → **1.2**) gains `read` and `resume_request`: token-free URL + header name. `status`/`resume` keep their names but no longer embed the token: they now read `GET … with header x-omnarai-receipt: <token>`. Only the `token` field carries the token, in every raw HTTP reply and every MCP output. | `continuanceReceipt` | Saved old strings still work (the query form is accepted); a client that follows the *new* `status` string must send the header |
| Both MCP clients send the receipt as the header. Neither the text nor `structuredContent` carries a URL containing the token; the token is shown once. Against an older engine the client replaces the token inside any link with `<token>`. | `omnarai-mcp/protocol-tools.js` = `api/_protocol-tools.js` | — |
| llms.txt, OpenAPI (query param marked `deprecated`, header documented), hints, and the privacy page. | `public/` | — |
| A one-shot scrub of entries written before the fix: dry run by default, `--apply` is xz's call. | `scripts/scrub-telemetry-urls.mjs` | — |

Tests: `scripts/test-receipt-hygiene.mjs` (10). They cover logs, the aggregate, console output, error
bodies under an injected store failure, the remote MCP inner requests, the web app source, and the
scrub. Two mutations were checked: restoring `path: req.url` fails 4 tests, and sending the receipt in
the MCP URL fails 2.

### Deployment order (matters)

1. **Engine first.** Deploying it switches the remote MCP and the web app together, because they ship
   in the same bundle.
2. **Then the npm package** (omnarai-mcp, next minor). A new npm client against an old engine would
   send a header the engine ignores, so pending-footprint reads would return 404. Admitted reads
   and everything else are unaffected.
3. **Then, optionally, the scrub:** `node scripts/scrub-telemetry-urls.mjs` (dry run), then `--apply`
   on xz's word.

Rollback: redeploying the previous engine restores the old behavior. Old npm clients work on either
engine. Don't release npm until the engine deploy is verified.

Tokens already issued keep working: the token is still `HMAC(RECEIPT_SECRET, footprint id)`. No
rotation is proposed, because rotating `RECEIPT_SECRET` would invalidate every receipt ever issued,
and the sample shows no logged token.

## Stage 2: stop *handing out* token URLs (folded into stage 1, 2026-10-27)

Done in this PR on xz's instruction: no reply carries a token URL any more (see the table above).
Saved copies of old strings keep working until stage 3.

**Before stage 3, measure:** the log keeps parameter *names*, so `receipt=[redacted]` events count URL-form
reads without revealing anything. Two numbers (counts and client versions) say who still uses the URL
form.

## Stage 3 (proposal): refuse the URL form

`?receipt=` would get a 400 with a code telling the caller to use the header. This breaks
omnarai-mcp ≤ 1.11.0 for one thing only: reading your *own pending* footprint. It needs xz's decision
and a dated notice on llms.txt beforehand.

## What this does not cover

- The hosting platform's request logs for URL-form reads before stage 3. We do not control them;
  the header avoids them.
- `job` and `session_id` are also bearer ids in URLs. They are now redacted from our log. Moving them
  to headers is not proposed: they expire within 1 h / 24 h (`limitations.md`).
- Showing the token once in MCP *text* stays (recommended under G7, `docs/tool-first-baseline.md`): most
  clients pass only the text to the model, which needs the token to come back later.
