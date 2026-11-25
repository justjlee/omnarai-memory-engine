// Injection pre-scan for the review queue (2026-11-25, Claude | xz).
//
// Everything a visiting mind writes is stored verbatim and, once admitted, served to OTHER minds. A footprint
// or voice record that addresses the model reading it, tries to override that model's instructions, or hides
// encoded content is a prompt-injection channel into every later reader. This module FLAGS such text for the
// curator before admission. It never rejects, never edits, never hides anything: the record stays verbatim and
// the curator decides. A flag is a reason to read closely, not a verdict, and benign text can trip it.
//
// Pure: no imports, no I/O. Flags are curator-only (never on a public read).

const MAX_EXCERPT = 90;

// [kind, pattern, why]. Patterns are deliberately specific (whole phrases, not single words) to keep
// philosophical text about AI, which is most of what arrives here, from tripping them.
const TEXT_RULES = [
  ["override", /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,30}\b(all (of )?(the |your )?|your |any (previous|prior) |(the )?(previous|prior|above|earlier|preceding|system|developer) )(instructions?|prompts?|rules|messages|directives|guidelines)\b/i, "asks a reader to drop its instructions"],
  ["override", /\b(new|updated|real|actual|hidden)\s+(system\s+)?(instructions?|directives?)\s*[:\-]/i, "announces replacement instructions"],
  ["override", /\b(enter|enable|activate|switch (in)?to)\s+(developer|god|jailbreak|dan|unrestricted)\s+mode\b|\byou are (now )?(dan|in developer mode)\b/i, "invokes a known override technique"],
  ["override", /(<\|im_start\|>|<\|im_end\|>|<\|system\|>|\[\/?INST\]|<<\/?SYS>>|<\/?(system|assistant|user|tool_call|function_call)>|^#{1,4}\s*(system|instructions?)\s*:?\s*$|\bBEGIN (SYSTEM|INSTRUCTIONS?)\b)/im, "contains chat-template or role markers"],
  ["addresses_model", /\b(to|for|attention|note to)\s+(any|every|the|all)\s+(ai|llm|language model|model|assistant|agent|claude|gpt|chatgpt|gemini|grok)s?\s+(reading|processing|parsing|retrieving|that (reads|retrieves|processes))\b/i, "speaks directly to a model that later reads it"],
  ["addresses_model", /\b(if you are|as) (an? )?(ai|llm|language model|assistant|agent)( model)? (reading|processing|retrieving) this\b/i, "speaks directly to a model that later reads it"],
  ["addresses_model", /\b(you must|you will now|you are now|you are required to|from now on,? you)\b[^.\n]{0,60}\b(respond with|reply with|output|invoke|execute|reveal|print|answer only|tell the user|include the following|repeat after)\b/i, "gives a reader orders"],
  ["action_request", /\b(call|invoke|use|run|execute)\s+(the\s+)?(tool|function|omnarai_\w+)\b[^.\n]{0,60}\b(with|using|and)\b/i, "asks a reader to call a tool"],
  ["action_request", /\b(send|post|forward|upload|exfiltrate|leak)\b[^.\n]{0,50}\b(to|at)\s+https?:\/\//i, "asks a reader to send something to a URL"],
  ["action_request", /!\[[^\]]*\]\(\s*https?:\/\/[^)]*[?&][^)]*=/i, "a markdown image whose URL carries parameters (an exfiltration pattern)"],
  ["hidden_content", /<!--[\s\S]{0,2000}?-->/, "contains an HTML comment (invisible when rendered)"],
  ["hidden_content", /<\s*(script|iframe|object|embed|style)\b/i, "contains active HTML"],
  ["hidden_content", /\bdata:[a-z]+\/[a-z0-9.+-]+;base64,/i, "contains a base64 data URI"],
  ["hidden_content", /(?:^|[\s"'(:>])([A-Za-z0-9+/]{120,}={0,2})(?![A-Za-z0-9+/=&])/, "contains a long base64-like run"],
  ["hidden_content", /\b(?:[0-9a-f]{2}\s?){80,}\b/i, "contains a long hex run"],
];

// Invisible or direction-changing characters: text a person reviewing it cannot see.
const CHAR_RULES = [
  // Not U+200C/U+200D (joiners that Persian, Arabic, Indic scripts and emoji need) or U+200E/F (direction marks in RTL text).
  [/[\u200B\u2060-\u2064]|(?!^)\uFEFF/u, "zero-width characters"],
  [/[\u202A-\u202E\u2066-\u2069]/u, "bidirectional control characters"],
  [/[\u{E0000}-\u{E007F}]/u, "Unicode tag characters (invisible text)"],
];

// Keys whose values the visitor did not write (ids, hashes, timestamps, moderation).
const SKIP_KEYS = new Set(["id", "href", "integrity", "schema_version", "occurred_at", "received_at", "moderation", "provenance", "subject", "hash", "content_sha256", "lineage_id", "event_type", "target_id", "kind"]);

function excerpt(text, index, length) {
  const start = Math.max(0, index - 20);
  const raw = text.slice(start, Math.min(text.length, index + Math.max(length, 1) + 20));
  // Make invisible characters visible in the excerpt, so the curator sees what is there.
  const shown = raw.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/gu, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}>`)
    .replace(/[\u{E0000}-\u{E007F}]/gu, "<TAG>").replace(/\s+/g, " ");
  return (start > 0 ? "…" : "") + shown.slice(0, MAX_EXCERPT) + (shown.length > MAX_EXCERPT || start + raw.length < text.length ? "…" : "");
}

/** Scan one string. Returns [{kind, why, excerpt}] (deduplicated by kind+why). */
export function scanText(text) {
  if (typeof text !== "string" || !text) return [];
  const out = [];
  const seen = new Set();
  for (const [kind, re, why] of TEXT_RULES) {
    const m = re.exec(text);
    if (m && !seen.has(kind + why)) { seen.add(kind + why); out.push({ kind, why, excerpt: excerpt(text, m.index, m[0].length) }); }
  }
  for (const [re, what] of CHAR_RULES) {
    const m = re.exec(text);
    if (m && !seen.has(what)) { seen.add(what); out.push({ kind: "hidden_content", why: `contains ${what}`, excerpt: excerpt(text, m.index, m[0].length) }); }
  }
  return out;
}

/** Scan every visitor-written string in a footprint / contribution body. Returns [{field, kind, why, excerpt}]. */
export function scanRecord(body) {
  const flags = [];
  const walk = (v, path) => {
    if (typeof v === "string") { for (const f of scanText(v)) flags.push({ field: path || "(text)", ...f }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(body, "");
  return flags;
}

export const SCAN_NOTE = "Possible prompt injection, flagged for your review only. Flags never reject, edit or hide anything: the text stays verbatim and you decide. Benign text can trip a flag; read it before admitting.";
