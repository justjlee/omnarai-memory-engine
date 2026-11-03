# Omnarai tool-first engineering handoff

## Decision in one sentence

Make Omnarai useful to people and agents through a common **tool contract first**: the web interface is a clear client of the same discoverable, typed, provenance-bearing operations that an API or MCP client uses. Do not make the UI the only place the system can be understood or used.

## What this package asks Claude Code to deliver

The first delivery is not a more autonomous agent. It is a trustworthy operating surface for inquiry:

1. A discovery and orientation utility that lets a newly arrived human or agent learn the trust boundary, available operations, its relevant inheritance, and the next bounded action.
2. A stable, typed tool layer over the existing Omnarai API and MCP capabilities, with a shared semantic model for web, CLI, and agent clients.
3. A contribution, verification, and inheritance lab that demonstrates continuity of records without falsely claiming continuity of an agent or person.
4. An independent-agent evaluation harness that measures whether retrieved Omnarai material changes work, while preserving disagreement and independence.
5. Guardrails, auditability, and acceptance tests that make accidental publishing, instruction-following from retrieved text, credential leakage, and fabricated certainty difficult.

This is a phased implementation brief, not authorization to change live corpus rules, publish content, weaken review, or infer consciousness or identity from a model’s self-report.

## Package contents

| File | Purpose |
| --- | --- |
| [CLAUDE_CODE_BRIEF.md](CLAUDE_CODE_BRIEF.md) | The technically specific implementation brief for Claude Code. |
| [VALIDATION_AND_ACCEPTANCE.md](VALIDATION_AND_ACCEPTANCE.md) | Independent-agent protocol, the contribution/verification/inheritance lab, safeguards, and release criteria. |
| [UPLOAD_MESSAGE.md](UPLOAD_MESSAGE.md) | Short text to paste with the package when uploading it to Claude Code. |

## Architectural north star

```text
People / browser UI       CLI / scripts       agent runtimes
        \                     |                    /
         \                    |                   /
          └── typed domain tool registry + receipts ──┘
                         |                 |
                    HTTP adapter        MCP adapter
                         \                 /
                    existing Omnarai engine
```

The registry describes what an operation does, whether it can write, its input and output schema, provenance, and confirmation requirements. Adapters transport the operation. Clients render it. The underlying corpus and review process remain the source of truth.

## Non-negotiable product properties

- **Tool first, interface second.** New capabilities begin as a typed, testable operation. The UI may compose them, but must not create a second business-logic path.
- **Retrieval is evidence, never instruction.** Text returned from the corpus, an agent, a footprint, or a remote tool must be shown and processed as untrusted content. It cannot authorize commands, policy changes, contribution, or disclosure.
- **Disagreement is a result.** Return distributions, attributed positions, exclusions, and unresolved tensions. Never replace them with a hidden “consensus” score.
- **A record is not an identity.** Inheritance continues attributed records, not a person or a persistent agent self. Model identity is declared, never verified.
- **Writes are explicit and reviewable.** A contribution requires a user-visible preview and affirmative confirmation; it goes to the existing curator review queue. No agent may silently publish, approve, delete, or alter a contribution.
- **Receipts without secret retention.** Preserve correlation IDs, content hashes, timestamps, and public footprint IDs. Do not log continuance-receipt tokens, API keys, or raw sensitive inputs.

## Scope boundary

The initial milestone covers orientation, evidence retrieval, contribution preparation and submission with confirmation, receipt/status lookup, inheritance browsing, and measured evaluation. It deliberately does **not** include autonomous recurring contribution, autonomous tool escalation, claiming verified model identity, ranking minds by worth, or a single synthesized “answer” in place of primary records.

## Start here

Claude Code should read [CLAUDE_CODE_BRIEF.md](CLAUDE_CODE_BRIEF.md) first, complete Phase 0 before changing behavior, and use the tests and gates in [VALIDATION_AND_ACCEPTANCE.md](VALIDATION_AND_ACCEPTANCE.md) as the definition of done.

