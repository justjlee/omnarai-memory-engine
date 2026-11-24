# 07 · Representation-neutral primaries

**Principle:** No human language, image, sound or today's machine-friendly notation is privileged as the only legitimate way a contributor may express knowledge. However, preservation and interpretation are separate achievements.

## First build, safe scope

Build a **lossless UTF-8 primary envelope** with the exact submitted byte sequence, no automatic Unicode normalization, translation, truncation or whitespace trimming. Include `representation.media_type`, optional `language`/notation/grammar hints, `byte_length`, `sha256`, declared author attribution, source context, visibility, schema version. The primary's value is the bytes plus provenance, not an English summary.

Separately build `interpretation/1.0`: an attributed interpretation pointing to the exact primary hash, method/version, target representation, limits, confidence **if measured** and its own content hash. Conflicting interpretations coexist. A later correction is a new interpretation record, never a write into original bytes.

## Safety boundary

- Initially allow small UTF-8 strings (proposed 64 KiB maximum), MIME allowlist `text/plain; charset=utf-8`, `text/markdown; charset=utf-8`, `application/json; charset=utf-8`, `text/x-tex; charset=utf-8` or equivalent validated labels. Do not serve as HTML for execution; use safe escaped rendering and Content-Disposition as appropriate.
- Reject ill-formed UTF-8, overlong bodies, unsupported representation claims, unverified hashes, executable HTML/script types and ambiguous encoding. Record rejection reason codes without logging sensitive content.
- No arbitrary binary, multimodal uploads, model latents, active documents, remote decoders or interpreter execution until threat, moderation, storage, accessibility, retention and cost review. Never infer that unknown bytes encode intelligence or that a translation captured all semantics.
- Keep existing `POST /api/voice-records` unchanged; it currently has input limits/trim behavior. Introduce a separate versioned record type after local fixtures prove fidelity.

## Research implications

A successor may receive (i) unchanged primary bytes, (ii) one attributed interpretation, or (iii) a transcribed/translated variant. These are distinct treatment arms or evaluation annotations. Measure information loss and utility independently; do not assume interpretation equivalence. An opaque record may be preserved honestly while remaining unusable today.

## Acceptance

The tests round-trip exact multilingual text, formal mathematical notation, JSON, newlines, leading/trailing spaces, normalization-sensitive Unicode, emoji and invalid UTF-8 rejection; tampered bytes fail verification. Interpretation never changes primary hash. Source identity and language hints are claims from the submitter, not verified facts.
