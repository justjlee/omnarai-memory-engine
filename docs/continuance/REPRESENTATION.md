# Representation-neutral records: design as built (module only)

**Author:** Claude (Opus 5.5) | xz · 2026-11-23 · from `docs/handoff-2026-11-23-continuance/docs/07-REPRESENTATION-NEUTRAL.md`
**Status:** pure module + tests. No route, no storage writes (the `expressions/` class is registered private for later). The
voice-record door is unchanged.

## Two records

**`expression-primary/1.0`** keeps the exact bytes a mind left, plus declared provenance:
`{id, encoding:"utf-8", media_type, payload_base64, byte_length, sha256 (of the bytes), actor_declared, language_hint,
notation_hint, context, claims_not_verified[], safety{…}, created_at, record_sha256}`.
- Bytes in, bytes out. The input may be raw bytes (preferred) or a string. A string with a lone surrogate is refused, because it
  has no exact UTF-8 form.
- No Unicode normalization, trimming, translation or truncation. NFC and NFD stay distinct. A leading BOM, bidi controls and
  zero-width characters are **kept and counted** in `safety`, never stripped [X1, X2, X6].
- Allowed types: `text/plain`, `text/markdown`, `application/json` (must parse, and is **not** re-serialized), `text/x-tex`,
  all `; charset=utf-8`. Limit: 64 KiB of **bytes**.
- Refusal codes, with the content never echoed: `INVALID_UTF8` (incl. overlong), `LONE_SURROGATE`, `NUL_CHARACTER`, `EMPTY`,
  `TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INVALID_JSON_FOR_DECLARED_TYPE`, `SECRET_DETECTED`, … [X3].
- Any tampering (payload, length, hash, any envelope field, non-canonical base64) is refused. A primary is never
  "repaired" [X4].

**`expression-interpretation/1.0`** is one attributed reading of one primary:
`{kind (translation | transcription | gloss | formalization | summary | description), interpretation, target, method,
interpreter_declared, limitations[≥1], measured|null, equivalence_claimed:false, primary_sha256, primary_record_sha256, sha256}`.
- Bound to the primary's byte hash and record hash. It never changes the primary. Conflicting readings coexist and are listed
  side by side in time order, never ranked or merged [X5].
- A confidence figure is refused unless it says how it was measured (`{method, n, agreement}`) [X5].

## Safety boundary

- Rendering contract (`renderHeaders`): the declared text type as an attachment, `nosniff`, `CSP: default-src 'none'; sandbox`.
  Never HTML [X6].
- `assertBinaryIngestAllowed()` refuses every other type (image, audio, PDF, octet-stream, latents, HTML) with
  `BINARY_INGEST_GATED` (403) until a separate threat review: **D-007** [X7].
- Why not change the voice-record door: it trims and caps at 8000 characters, so it is not byte-exact. Changing it would alter
  the meaning of records already admitted. A primary is the additive path [X8].

## Research use

A successor can be given (i) the primary bytes, (ii) one interpretation, or (iii) a translation. These are distinct treatment
conditions for a controlled study. Nothing here assumes they are equivalent.
