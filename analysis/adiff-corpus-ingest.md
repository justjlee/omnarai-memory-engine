# Ingesting OMN-R-ADIFF into the corpus (Work Item C)

The record is authored at [`analysis/adiff-corpus-record.json`](adiff-corpus-record.json).
It is **staged, not ingested** — ingesting means an embedding call (model spend) and a
curator-gated deploy, so it is left for xz to run. Both are outside the implementer scope
and Item A's zero-spend rule.

Fields are ingestion-correct: `ring: curated` + `type: research` + `evidence_status: empirical`
→ derives `layer: research` (per `layerOf` in `api/query.js`) and the top evidence rank
(`empirical = 6`). Numbers in `full_text` are generated from the single source
(`public/data/adiff-stats.json`), not hand-typed.

## Recommended path — add to the curated seed (durable, citeable id)

`store.js`'s `propose` action only builds *syntheses from a deliberation* (it derives a
`"Synthesis: …"` title), so it is the wrong tool for a pre-authored curated record. Add it to
the seed instead:

1. Append the record object to **both** corpus files (the second is the stripped, no-`full_text`
   frontend copy — CLAUDE.md "both must be updated when entries are added"):
   - `public/data/corpus.json`
   - `src/data/corpus.json`  (drop the `full_text` field in this copy)
2. Regenerate embeddings so the new entry is semantically retrievable (needs `OPENAI_API_KEY`;
   one added entry ≈ one embedding call):
   ```
   node scripts/generate-embeddings.js
   ```
3. Deploy via the safe path (never `vercel --prod`):
   ```
   ./scripts/deploy.sh
   ./scripts/deploy.sh --promote <preview-url>     # verifies + re-aliases the custom domain
   ```
4. Verify retrieval (also automated in `scripts/verify-adiff.sh`, check 4):
   ```
   curl -s "https://engine.omnarai.org/api/query?q=Atlas%20exposure%20degrades%20Claude&format=context" | jq '.records[0:3][].id'
   # expect OMN-R-ADIFF in the top 3
   ```
   Or via MCP: `omnarai_context` on "Atlas exposure degrades Claude" → OMN-R-ADIFF top-3.

## Note on the `num`/`id`

`id: OMN-R-ADIFF` (distinctive + citeable, unlike the numeric Reddit-seed ids); `num: 563`
follows the 562-seed. If you prefer a grown-Blob entry over a seed edit, port the object through
`appendGrownEntry` (`api/_grown.js`) with the same fields — but the seed keeps the id stable and
the record public under CC-BY-SA without a Blob round-trip.
