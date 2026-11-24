// Representation-neutral primaries and interpretations (api/_expressions.js): pure, hermetic.
//
//   node --test scripts/test-expressions.mjs
//
//   [X1] exact round trip: multilingual, formal notation, JSON, whitespace, normalization forms, emoji, BOM, bidi
//   [X2] bytes in = bytes out: raw Uint8Array input survives untouched; NFC/NFD stay distinct
//   [X3] refusals with stable codes: invalid UTF-8, lone surrogate, NUL, empty, oversize, HTML type, bad JSON, secrets
//   [X4] tampering anywhere (payload, length, hash, envelope field, non-canonical base64) is refused, never repaired
//   [X5] interpretations bind to one primary's hash, coexist, never change the primary, and cannot carry unmeasured confidence
//   [X6] safety notes count controls without altering bytes; render headers never allow HTML or sniffing
//   [X7] the binary gate refuses every non-text type
//   [X8] the existing voice-record door is untouched by this module
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as X from "../api/_expressions.js";

const AT = "2026-11-23T00:00:00.000Z";
let k = 0;
const pid = () => `OMN-EXPR-1780000000000-${(++k).toString(16).padStart(8, "0")}`;
const iid = () => `OMN-INTERP-1780000000000-${(++k).toString(16).padStart(8, "0")}`;
const P = (content, extra = {}) => X.makePrimary({ id: pid(), content, actor_declared: "anonymous contributor (fixture)", created_at: AT, ...extra });

const SAMPLES = {
  bengali_with_edge_spaces: " বাংলা বাংলা ",
  chinese_arabic_newline: "中文\n عربي",
  malayalam_lambda: " മലയാളം ∞ λ(x).x  中文\n",
  formal: "∀ε>0 ∃δ>0: |x−a|<δ ⇒ |f(x)−f(a)|<ε  𝛿 + ∞ ≠ ∅",
  emoji_zwj: "👩🏽\u200D🔬 + 🧬",
  whitespace: "a\t\r\n b \u00A0\u2003",
  nfd: "e\u0301",
  nfc: "é",
  bom_first: "\uFEFFstarts with a BOM",
  bidi: "abc \u202Eevil\u202C def",
};

test("[X1] exact round trip", () => {
  for (const [name, s] of Object.entries(SAMPLES)) {
    const p = P(s);
    assert.equal(X.readPrimary(p).text, s, name);
    assert.equal(p.byte_length, Buffer.byteLength(s, "utf8"), name);
  }
  const j = P('{ "answer": 42,\n  "note": "kept as sent" }', { media_type: "application/json; charset=utf-8" });
  assert.equal(X.readPrimary(j).text, '{ "answer": 42,\n  "note": "kept as sent" }', "JSON is not re-serialized");
  const tex = P("\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", { media_type: "text/x-tex; charset=utf-8", notation_hint: "LaTeX" });
  assert.equal(X.readPrimary(tex).text, "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}");
});

test("[X2] bytes in = bytes out; normalization forms stay distinct", () => {
  const raw = new Uint8Array([0xEF, 0xBB, 0xBF, 0x61, 0xCC, 0x81, 0x0A]); // BOM, a + combining acute, LF
  const p = P(raw);
  assert.deepEqual([...X.readPrimary(p).bytes], [...raw]);
  assert.notEqual(P(SAMPLES.nfd).sha256, P(SAMPLES.nfc).sha256);
});

test("[X3] refusals carry stable codes", () => {
  const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
  assert.equal(code(() => P(new Uint8Array([0xC3, 0x28]))), "INVALID_UTF8");
  assert.equal(code(() => P(new Uint8Array([0xE0, 0x80, 0x80]))), "INVALID_UTF8", "overlong encoding");
  assert.equal(code(() => P("\uD800")), "LONE_SURROGATE");
  assert.equal(code(() => P("a\u0000b")), "NUL_CHARACTER");
  assert.equal(code(() => P("")), "EMPTY");
  assert.equal(code(() => P("a".repeat(X.MAX_PRIMARY_BYTES + 1))), "TOO_LARGE");
  assert.equal(code(() => P("ü".repeat(X.MAX_PRIMARY_BYTES / 2 + 1))), "TOO_LARGE", "the limit is bytes, not characters");
  assert.equal(code(() => P("<script>x</script>", { media_type: "text/html" })), "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(code(() => P("{bad}", { media_type: "application/json; charset=utf-8" })), "INVALID_JSON_FOR_DECLARED_TYPE");
  assert.equal(code(() => P("token sk-ant-api03-" + "x".repeat(40))), "SECRET_DETECTED");
  assert.equal(code(() => P("ok", { actor_declared: "" })), "ACTOR_REQUIRED");
  try { P(new Uint8Array([0xC3, 0x28])); } catch (e) { assert.ok(!e.message.includes("("), "the message never echoes content"); }
});

test("[X4] tamper anywhere is refused", () => {
  const p = P("hello");
  const bad = [
    { ...p, payload_base64: Buffer.from("hello!").toString("base64") },
    { ...p, byte_length: 6 },
    { ...p, sha256: "0".repeat(64) },
    { ...p, actor_declared: "someone else" },
    { ...p, language_hint: "en" },
    { ...p, media_type: "text/html" },
  ];
  for (const b of bad) assert.throws(() => X.readPrimary(b), (e) => /INTEGRITY|BAD_ENVELOPE/.test(e.code));
  const nonCanon = { ...p, payload_base64: p.payload_base64.replace(/=*$/, "") };
  assert.throws(() => X.readPrimary(nonCanon), (e) => /NON_CANONICAL_BASE64|RECORD_INTEGRITY/.test(e.code));
});

test("[X5] interpretations are separate, bound, coexisting, measured-or-silent", () => {
  const p = P("λx.x");
  const before = JSON.stringify(p);
  const mk = (interpretation, extra = {}) => X.makeInterpretation({ id: iid(), primary: p, kind: "gloss", interpretation, target: { media_type: "text/plain; charset=utf-8", language_hint: "en" }, method: { name: "human reading", version: "1" }, interpreter_declared: "reader (fixture)", limitations: ["ignores typing"], created_at: AT, ...extra });
  const a = mk("the identity function");
  const b = mk("a function returning its argument; untyped", { created_at: "2026-11-23T00:00:01.000Z" });
  assert.equal(JSON.stringify(p), before, "the primary did not change");
  assert.equal(a.primary_sha256, p.sha256);
  assert.equal(a.equivalence_claimed, false);
  assert.deepEqual(X.interpretationsOf(p, [b, a]).map((x) => x.id), [a.id, b.id], "both readings coexist, in time order");
  const other = P("something else");
  assert.throws(() => X.verifyInterpretation(a, other), /NOT_OF_THIS_PRIMARY/);
  assert.throws(() => X.verifyInterpretation({ ...a, interpretation: "edited" }, p), /INTERPRETATION_INTEGRITY/);
  assert.deepEqual(X.interpretationsOf(p, [{ ...a, interpretation: "edited" }]), [], "a tampered reading is dropped, not shown");
  assert.throws(() => mk("x", { measured: { agreement: 0.9 } }), /BAD_MEASUREMENT/, "no confidence figure without how it was measured");
  assert.ok(mk("x", { measured: { method: "3 independent readers, exact-match agreement", n: 3, agreement: 0.67 } }).measured);
  assert.throws(() => mk("x", { limitations: [] }), /LIMITATIONS_REQUIRED/);
  assert.throws(() => mk("x", { primary: { ...p, sha256: "0".repeat(64) } }), /INTEGRITY/);
});

test("[X6] safety notes and render headers", () => {
  const p = P(SAMPLES.bidi);
  assert.equal(p.safety.bidi_controls, 2);
  assert.equal(X.readPrimary(p).text, SAMPLES.bidi, "counted, not stripped");
  assert.equal(P(SAMPLES.bom_first).safety.leading_bom, true);
  const hdr = X.renderHeaders(P("<b>not html</b>", { media_type: "text/markdown; charset=utf-8" }));
  assert.equal(hdr["content-type"], "text/markdown; charset=utf-8");
  assert.equal(hdr["x-content-type-options"], "nosniff");
  assert.match(hdr["content-disposition"], /^attachment; filename="OMN-EXPR-[^"]+\.md"$/);
  assert.match(hdr["content-security-policy"], /sandbox/);
});

test("[X7] the binary gate refuses everything else", () => {
  for (const t of ["image/png", "audio/wav", "application/octet-stream", "application/x-latent", "text/html", "application/pdf"]) {
    assert.throws(() => X.assertBinaryIngestAllowed(t), (e) => e.code === "BINARY_INGEST_GATED" && e.status === 403);
  }
});

test("[X8] the voice-record door is not touched", () => {
  const src = readFileSync(new URL("../api/_expressions.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^import .*(council|voice)/m);
  assert.doesNotMatch(src, /\bput\(|_blob/);
});
