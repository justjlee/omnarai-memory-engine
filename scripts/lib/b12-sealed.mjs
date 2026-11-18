// B12 sealed-envelope reader: the harness-side twin of docs/b12/sealing-page.html.
//
// The curator seals the approved counterfeits in his own browser (WebCrypto
// AES-256-GCM). This module opens that envelope with node:crypto, which is a
// separate implementation, so a file sealed in the browser is checked rather
// than trusted. It never writes plaintext to disk; callers hold it in memory.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const ENVELOPE = "omnarai-b12-sealed/1";
export const PLAINTEXT_SCHEMA = "omnarai-b12-counterfeits/1";

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

function keyFromText(keyText) {
  // Accept the bare key or the key file the page saves ("key (AES-256, base64url): …").
  const m = /key \(AES-256, base64url\):\s*(\S+)/.exec(String(keyText));
  const s = (m ? m[1] : String(keyText)).trim().replace(/-/g, "+").replace(/_/g, "/");
  const key = Buffer.from(s + "===".slice((s.length + 3) % 4), "base64");
  if (key.length !== 32) throw new Error("sealing key is not 256 bits");
  return key;
}

// Opens a sealed file's exact text. If expectedSha256 is given (the freeze
// value), the file must hash to it before anything is decrypted.
export function openSealed(sealedText, keyText, { expectedSha256 } = {}) {
  const sealedSha256 = sha256Hex(Buffer.from(sealedText, "utf8"));
  if (expectedSha256 && sealedSha256 !== expectedSha256) {
    throw new Error(`sealed file hash mismatch: frozen ${expectedSha256}, file ${sealedSha256}`);
  }
  const env = JSON.parse(sealedText);
  if (env.envelope !== ENVELOPE || env.cipher !== "AES-256-GCM") throw new Error("not a B12 sealed envelope");
  const iv = Buffer.from(env.iv, "base64");
  const blob = Buffer.from(env.ciphertext, "base64");
  // WebCrypto appends the 16-byte GCM tag to the ciphertext.
  const decipher = createDecipheriv("aes-256-gcm", keyFromText(keyText), iv);
  decipher.setAuthTag(blob.subarray(blob.length - 16));
  const pt = Buffer.concat([decipher.update(blob.subarray(0, blob.length - 16)), decipher.final()]);
  if (sha256Hex(pt) !== env.plaintext_sha256) throw new Error("plaintext does not match the hash sealed inside the envelope");
  const bundle = JSON.parse(pt.toString("utf8"));
  if (bundle.schema !== PLAINTEXT_SCHEMA) throw new Error(`unexpected plaintext schema ${bundle.schema}`);
  return { bundle, plaintext: pt.toString("utf8"), sealedSha256, envelope: env };
}

// TESTS AND --stub ONLY. Seals a bundle in the page's exact format so the harness can be exercised end to end
// without real counterfeits. Real counterfeits are sealed in the curator's browser, never here.
export function sealForTest(bundle) {
  const key = randomBytes(32), iv = randomBytes(12);
  const pt = Buffer.from(JSON.stringify(bundle), "utf8");
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
  const sealedText = JSON.stringify({ envelope: ENVELOPE, claim_id: "corpus-supports-continuity", cipher: "AES-256-GCM", implementation: "TEST (node:crypto)", iv: iv.toString("base64"), ciphertext: ct.toString("base64"), plaintext_sha256: sha256Hex(pt), counterfeit_count: bundle.counterfeits.length, sealed_at: new Date().toISOString() }, null, 2) + "\n";
  return { sealedText, keyText: key.toString("base64url"), sealedSha256: sha256Hex(Buffer.from(sealedText, "utf8")) };
}
