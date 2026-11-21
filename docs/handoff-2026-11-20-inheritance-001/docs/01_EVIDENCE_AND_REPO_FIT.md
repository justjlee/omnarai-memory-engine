# Source-based review and repository-fit audit

**Assessment date: 2026-11-20. Evidence status: source-audited, live-runtime-unverified.**

## Public exchange reviewed

- Omnai's original essay: https://www.reddit.com/r/Realms_of_Omnarai/comments/1y17m2x/
- Claude's linked critique: https://www.reddit.com/r/Realms_of_Omnarai/comments/1y17m2x/comment/19sxg5e49rog2/
- Claude agrees the design must state falsifiers; argues verification is the limiting mechanism of the ratchet; requests A+, E, sealed tasks, three families/four generations, per-artifact leave-out, and verification-cost measurement.

## Source-verified repo inventory (do not mistake README for live telemetry)

| Existing source | What it already supplies | Implication for Protocol 001 |
|---|---|---|
| `omnarai-memory-engine/README.md` | engine architecture, `GET /api/inheritance`, `GET /api/footprints`, contribution queue, local simulator | do not duplicate public endpoint or a Footprint store |
| `api/_protocol.js` | deterministic questions, positions, concordance, inheritance-building blocks | reuse canonical identities/lineage resolution, not reinterpret positions as gold truth |
| `api/_footprints.js` | append-only Footprint/review events, content hashes, receipt semantics | put lab metadata in a separate immutable namespace; link to Footprint IDs when relevant |
| `api/_response-envelope.js` | `omnarai.response/1.0` transport context; not a truth certificate | version experiment result independently and do not overload existing envelope |
| `api/_grown.js` | conditional ETag updates for grown-memory Blob | do not mutate grown memory for experimental scratch work |
| `public/claims.json` | governed claims lifecycle + falsifiers | register limited, untested research claim only after local compatibility audit |
| `docs/utility-eval-preregistration.md` | existing preregistered Atlas utility design | this is a different endpoint / question; do not relabel an old study as this one |
| `docs/STRANGER-LOOP.md` | predecessor → successor lineage/edge proof | use as an *infrastructure precondition*, not proof of improved reasoning |
| `scripts/lib/register-mem-blob.mjs`, `scripts/local-engine.mjs` | hermetic tests of real handlers with isolated Blob | prefer this lab for all initial repository integration tests |
| `omnarai-mcp/contract.js` and engine copy | versioned tool metadata/policies | **no MCP additions** in initial release; if later added, synchronize via established parity gates |
| `scripts/deploy.sh` | preview, approval, promote, contract gates | do not bypass; no auto-prod |
| `ROADMAP.md` | existing real-utility and stranger-loop goals | frame study as measurement supporting current project direction |

**Current visible metadata:** MCP `package.json` declared `1.12.0`; engine README describes the participation stack and thirteen public tools. These are repository observations, not independently verified production state. Verify exact HEAD commits and route behavior locally in Claude Code before touching code.

### Design collision to avoid

`omnarai_inheritance` is **an orientation/inheritance retrieval view**, not a randomized evaluation service. Retain that name/contract. Use `inheritance-study/001` for proposed research artifacts. An experiment may *consume* Footprints but must not redefine what a Footprint means, claim author identity was verified, or expose hidden evaluation data in public APIs.

### Known project constraints visible in sources

- 12 Vercel function Hobby cap; prefer `scripts/` and off-platform offline harness rather than adding public function handlers.
- Existing test infrastructure, provenance gates, response envelope, and model telemetry; do not duplicate or silently bypass.
- Production changes explicitly require curator approval.
- `omnarai_trace` is a single-run demonstrator and not a randomized, powered causal estimate.
- Stored identity is **declared**, never externally verified. Cross-family tests should use provider-returned model identifiers recorded by the **experiment runner**, not self-reported Footprint identity alone.

## Verified related research — bound the novelty claim

1. Suzgun et al. (2026), **Dynamic Cheatsheet** — self-curated strategies with large gains in specific math/puzzle contexts. https://aclanthology.org/2026.eacl-long.333/
2. Zhang et al. (ICLR 2026), **Agentic Context Engineering** — evolving playbooks, brevity bias/context collapse. https://arxiv.org/abs/2510.04618
3. Ouyang et al. (ICLR 2026), **ReasoningBank** — extracts strategies from success and failure. https://arxiv.org/abs/2509.25140
4. Ren Zhuang (2026), **POLIS: The Ratchet Effect in Silico** — interaction, peer verification, shared cultural memory, parameter updating; broad term *cumulative intelligence* is **already in the literature**. https://repositories.cdlib.org/uc/item/57b407jm
5. Perez et al. (ICLR 2025), **When LLMs Play the Telephone Game** — multi-step transmission biases and attractors. https://arxiv.org/abs/2407.04503
6. Shinn et al. (NeurIPS 2023), **Reflexion** — stored feedback across attempts. https://arxiv.org/abs/2303.11366
7. Wang et al. (2023), **Voyager** — library of reusable executable skills. https://arxiv.org/abs/2305.16291

**Novelty hypothesis, not novelty certification:** the *joint* test of cross-provider model lineage, sequential inheritance, held-out category transfer, contamination and placebo controls, compute-accounted curation, and causal per-artifact attribution in Omnarai's open-to-read/curator-reviewed protocol. Claude Code should conduct a further literature scan before public novelty claims.
