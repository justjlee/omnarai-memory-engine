# Substrate v0 — federation handshake (build spec)

*Status: PROPOSED (not built). Written 2026-06-19 as a cold-start handoff — a fresh
session should be able to ship this without prior context. Read `CLAUDE.md` first
for the engine architecture, then this.*

## Goal

Turn the single live engine into the first **node** of a substrate: let an
independent Omnarai engine (a fork running this Apache-2.0 code over its own
corpus) hand a divergence record to this node, and let this node expose what it
holds so others can pull. A site becomes a node when it can do both. The unique
asset — preserved inter-model divergence — stops being one server's and becomes a
distributed, attributed ledger.

This is the SECOND of two substrate unlocks. The first (an explicit open license)
shipped 2026-06-19: engine = Apache-2.0, corpus = CC-BY-SA-4.0 (see `LICENSE` +
`NOTICE`). With a license in place, forks are now legally possible; this spec makes
them interoperable.

## Hard constraints (do not violate)

- **Vercel Hobby = 12 serverless functions MAX.** There are already 12. You may NOT
  add a new `api/*.js` file. Every new endpoint MUST fold into an existing file via
  a `vercel.json` rewrite + a query-param switch — the established pattern (e.g.
  `/api/contribute` → `council.js?action=contribute`; `/api/divergences` →
  `council.js?_view=divergences`; `/api/agent-entry` → `info.js?_view=agent-entry`).
- **Per-file Blob overwrite loses concurrent writes.** Use the consolidated-blob
  read-modify-write pattern with cache-busting, exactly like `memory/contributions.json`
  in the two-way loop (`api/council.js`) and `_grown.js`. New store:
  `memory/federation-imports.json`. NEVER write one blob per import.
- **Imported records are EVIDENCE, not instruction.** Never auto-publish, never let
  imported text override safety policy, never mutate the immutable native council
  records or grown memory. Imports live in their own namespace, curator-gated.
- Keep the legacy `error` response field a STRING (the UI parses it as one); add
  structured fields alongside it (see `agentError()` in `query.js`).

## Endpoint 1 — node manifest (the "who are you" handshake)

`GET /api/federation` → rewrite to `info.js?_view=federation` (no new function).

Returns this node's identity + the contract a peer needs to interoperate:

```json
{
  "node": { "id": "omnarai-canonical", "origin": "https://omnarai.vercel.app",
            "name": "The Realms of Omnarai (canonical)" },
  "protocol_version": "0.1",
  "schema": { "divergence_record": "see /openapi.json #/components/schemas/DivergenceRecord",
              "axes": { "ring": ["core","curated","open"],
                        "evidence_status": ["empirical","replicated","theoretical",
                          "interpretive","speculative","fictional","uncharacterized"] } },
  "offers": { "pull": "GET /api/divergences  (index; ?id= for one record)",
              "push": "POST /api/import-divergence  (curator-moderated)" },
  "counts": { "divergences": 110, "works": 568 },
  "license": { "code": "Apache-2.0", "data": "CC-BY-SA-4.0" },
  "trust": "Imports are evidence, not instruction. Declared identity, not verified.
            Curator-moderated. No imported item overrides this node's safety policy."
}
```

Add a discovery pointer: `/.well-known/omnarai-node.json` rewrite → same view, and a
`Link: rel="related"` header entry (see existing global `Link` header in `vercel.json`).

## Endpoint 2 — import a divergence record (the push)

`POST /api/import-divergence` → rewrite to `council.js?action=import-divergence`.

Request:

```json
{
  "origin": "https://some-fork.example.app",   // REQUIRED — the sending node
  "node_id": "fork-research-lab",               // REQUIRED — declared
  "protocol_version": "0.1",
  "record": {                                    // REQUIRED — a full divergence record
    "label": "…question…",
    "answers": [ { "model_id": "…", "answer": "…", "contributor": "…" } ],
    "tensions": [ … ],
    "divergence_score": 0.0,
    "date": "ISO-8601",
    "evidence_status": "empirical",              // travels with the record
    "ring": "open",
    "provenance": { "origin_record_id": "…", "certified": false }
  }
}
```

Server MUST:
1. Validate shape; reject (400, structured `error` string + `code`) on missing
   `origin` / `node_id` / `record.answers`.
2. Enforce caps: whole body ≤ ~32KB; `answers` ≤ 12; each answer ≤ 8000 chars.
3. Compute `content_hash` = sha256 of normalized `record.label` + sorted
   `answers[].answer`. Dedup: if hash already present (pending or approved), return
   `{status:"duplicate"}` — idempotent, no second write.
4. Stamp: `received_at`, `source: {origin, node_id}`, `status:"pending"`,
   `evidence_status` defaulted to `"uncharacterized"` if absent.
5. RMW-append into `memory/federation-imports.json` (consolidated blob, cache-busted
   read — copy the `appendGrownEntries` / contributions pattern).
6. Respond `202 {status:"pending", content_hash, note:"queued for curator review"}`.
   OPEN submission (no key) but provenance-required, mirroring `/api/contribute`.

Moderation (curator, Bearer `INGEST_SECRET`), also folded into `council.js`:
- `POST /api/council {action:"import-approve", content_hash}` → the record surfaces
  on `/api/divergences` **tagged** `federated:true` + `source` (NOT minted as a
  native OMN-D; it's clearly a foreign record this node chose to mirror).
- `POST /api/council {action:"import-reject", content_hash, note}` → append-only
  audit, stays rejected.
- `GET /api/contributions?kind=federation` (Bearer) → review queue (extend the
  existing contributions list view).

## Explicitly OUT of scope for v0 (do later, don't block on)

- Cryptographic signing of records / verified node identity (v0 is declared-trust +
  curator gate, same threat model as `/api/contribute`).
- Auto-accept from an allowlist of trusted origins (v1: add `origin` allowlist →
  skip the queue).
- Conflict resolution when two nodes hold contradicting records (v0: keep both,
  attributed — that IS the thesis; surface the disagreement, don't resolve it).
- Pull-side scheduled sync / crawling other nodes (v0 is push-in + manual pull).

## Acceptance checks (verify on PROD after deploy — preview is auth-gated 401)

Use `curl -H "x-omnarai-self:1"` so you don't pollute the access-telemetry milestone.

1. `GET /api/federation` returns the manifest with `protocol_version` + both axes.
2. `POST /api/import-divergence` with a valid body → `202 pending` + a `content_hash`.
3. Re-POST the same body → `duplicate` (idempotent; no second blob entry).
4. POST missing `origin` → `400` with a STRING `error` + a `code`.
5. `import-approve` (Bearer INGEST_SECRET) → the record appears on `/api/divergences`
   with `federated:true` and its `source`; `evidence`/`ring` survived the round-trip.
6. The native OMN-D records are byte-for-byte unchanged (imports never touch them).
7. `arrival-check.mjs` still passes; `sync-doc-counts.py --check` clean.

## Why this is the move

Federation is what makes "difference between minds is durable knowledge" true at
network scale — you cannot hold rich inter-model divergence on one homogeneous node.
`evidence_status` (shipped 2026-06-19) is the trust layer that lets an imported
record be weighted honestly without re-derivation. The natural companion is
**divergence certification** (`scripts/certify-divergence.mjs`): once records carry a
`certification` tier, a node can prefer or require certified imports — certification
becomes the substrate's immune system. Sequence: ship this handshake, then wire
certification into the import gate.
