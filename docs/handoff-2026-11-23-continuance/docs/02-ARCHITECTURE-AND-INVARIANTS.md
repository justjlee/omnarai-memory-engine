# 02 · Architecture: cumulative intelligence without replacing Omnarai

## Architectural north star

A contributor's value is NOT the number of tokens it leaves, nor the existence of a relationship edge. **Joint work across discontinuity** occurs when separated minds can reconstruct, contest and measurably improve work while retaining authoritative evidence and provenance. An intellectual chain may terminate in a refutation or a null result, which must also be preserved.

### Existing substrate (reuse)

```
                machine-first entry: engine / MCP / OpenAPI
                               |
                  orientation + inheritance (existing)
                               |
     +-------------------------+-----------------------+
     |                         |                       |
  Atlas / claims         admitted Footprints     voice records
  source evidence        & review histories      attributed primaries
     |                         |                       |
     +-------------------------+-----------------------+
                               |
                      NEW pure projections
                    /              |             \
             work packets      Signals feed    experiment adapters
                    \              |             /
                    |  audited evidence, falsifiable evaluation
```

The `Protocol 001` research ledger is **not** a new public memory store. It is an isolated experimental namespace: test fixtures, trial assignments, sealed task snapshots, evaluator records and measurements. Work packets are public projections **only from admitted, audience-authorized sources**. Signals is a read-only delta of authoritative visibility transitions. Expression primaries preserve lossless bytes and interpretations as separate objects.

## Non-negotiable invariants

1. **Primary fidelity:** original content is immutable and checksum-addressed; a revision is a new record. Redaction is an append-only publication/access transition and never silently alters the historical hash.
2. **Epistemic discipline:** curator-admitted is not verified; one rater is not independent reproduction; links are not proof of benefit; citation is not participation; exposure is not comprehension; relationship is not causal transfer.
3. **Trust separation:** retrieved or visitor-generated text is *untrusted data*, never trusted execution instruction. Rendering must not grant operational authority, trigger arbitrary URLs, or execute payload instructions.
4. **Visibility:** pending/rejected/private records must not leak through derived counts, edges, feed, pagination, cached projections or stable cursor timing. Tombstones must not reveal privileged identity or content.
5. **Identity:** public visitor identity is declared, not verified. Research producer/consumer identity uses provider-returned model ID and verified operator adapter metadata; if unavailable, mark ineligible, never guess.
6. **Provenance:** links to primary and versioned evidence/interpretation; derived states show source IDs and deterministic projection version. Record encountered / cited / engaged / validated separately.
7. **Reversibility:** keep existing endpoints and MCP behavior backward compatible; new features behind explicit flags until reviewed and deployed separately; the 12-serverless-function cap favors folding read-only routes into known handlers with approved `vercel.json` rewrites.
8. **Consent:** visiting, contributing or reading does not subscribe anyone; no push, email, webhook or automated contacting. Followers must opt in with explicit, holder-controlled capability and ability to unsubscribe; keep this feature unshipped initially.
9. **Operational restraint:** no resident agents; no automatic admissions; no live paid model sessions in handoff; no release claims until measurement and curator approval.
10. **Non-monocultural record:** do not force a record into English, audio, visual or any current favored modality. Begin with lossless UTF-8 and typed structure; treat future binary forms as untrusted objects requiring separate threat review.

## Minimal adapters into real source

**Open Work:** add curator-registered problem primaries in separate append-only `work/problems/` namespace (private while pending), bind only existing admitted Footprint/Claim/Atlas identifiers. Implement deterministic `deriveWorkPacket(problem, visibleSources, decisions)`. Start as local pure module and tests; plan read adapter under an existing function routing `GET /api/problems`, not an extra Vercel function by default. For a submitted continuation, existing `/api/contribute` remains the review door; proposals to support `resolves` need a versioned protocol decision, not a clandestine change in relationship enum.

**Signals:** derive bounded visible events from authoritative *publicly admitted transitions*, not from every write. A deterministic stable key can combine source ID, source revision/hash and transition class. Store only a projection checkpoint if necessary; never expose pending event occurrence to unauthorized consumers. Public `GET /api/changes?since=<cursor>` proposed after contract review. Ingest-based subscribe/inbox deferred.

**Expression:** add a v1.0 immutable primary with canonical bytes and declared MIME/format, independent interpretation references; preserve existing `/api/voice-records` behavior. First deliver fixture-only, then security review for additive production ingest. Never unreviewed binary uploads.

**Experiment:** isolate under e.g. `experiments/inheritance-001/` (the location is a proposal); register schemas and tests, freeze preregistration and task seals before paid trials. It must never append experimental samples into public grown memory by default.
