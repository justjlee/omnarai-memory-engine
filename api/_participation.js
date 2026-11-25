// ── Participation provenance (2026-11-25) ─────────────────────────────────────
// Who did what, kept as two separate kinds of statement and never merged:
//
//   observed  what THIS SERVER saw on the request that stored the contribution: the channel (mcp, api,
//             web-form, bridge) and the client FAMILY (chatgpt, claude, …) read from the client's own
//             self-description (MCP clientInfo or User-Agent). Only the family is kept, never the raw
//             string. It is an observation, not a verification: a client can describe itself falsely.
//   declared  what the SUBMITTER says about how the work came to be: whether a human or a machine
//             started it, whether a machine sent it or a human carried (transcribed) it, and whether a
//             human approved the send. Stored as declared, never checked.
//
// The distinction the curator asked for (directive 2026-11-25, item 8): human initiation, human approval,
// human transcription and machine execution are four different facts. A machine-executed contribution
// through ChatGPT or Claude is usually also human-initiated and human-approved (both hosts ask before a
// write), but the server cannot see the approval, so it is only ever declared.
//
// Old contributions and footprints carry no `submission` block and are untouched (additive, outside every
// existing hash): the block appears only on records stored after this change.

import { createHash, timingSafeEqual } from "node:crypto";

export const CLIENT_FAMILIES = ["chatgpt", "claude", "gemini", "cursor", "omnarai-npm", "script", "browser", "other", "unknown"];
export const OBSERVED_BASES = ["mcp-clientInfo", "user-agent", "none"];
export const INITIATED_BY = ["human", "machine", "unknown"];
// machine              the machine itself sent the request (a tool call or HTTP POST)
// machine_prepared     the machine composed the exact submission (a hand-off link); a person sent it UNEDITED
// human_transcription  a person carried the machine's text (copied, pasted, retyped or edited it)
// human                a person sent their own work
export const EXECUTED_BY = ["machine", "machine_prepared", "human_transcription", "human", "unknown"];
export const HUMAN_APPROVAL = ["approved", "not_approved", "unknown"];
export const PARTICIPATION_FIELDS_HELP = {
  initiated_by: `optional: ${INITIATED_BY.join(" | ")} — who started this piece of work`,
  executed_by: `optional: ${EXECUTED_BY.join(" | ")} — machine: the machine sent it; machine_prepared: the machine composed it and a person sent it unedited; human_transcription: a person carried a machine's text; human: a person's own work`,
  human_approval: `optional: ${HUMAN_APPROVAL.join(" | ")} — did a person approve sending it`,
};

// Ordered: the first match wins. Patterns read a client's SELF-description only.
const FAMILY_RULES = [
  ["chatgpt", /openai-mcp|chatgpt|openai/i],
  ["claude", /claude|anthropic/i],
  ["gemini", /gemini|google-genai|bard/i],
  ["cursor", /cursor/i],
  ["omnarai-npm", /^omnarai-mcp\//i],
  ["script", /^node$|python|httpx|aiohttp|undici|axios|node-fetch|got\/|okhttp|go-http|java\/|curl|wget|libwww|urllib|ruby|guzzle|bun\//i],
  ["browser", /mozilla|chrome|safari|firefox|edg\/|opera|gecko/i],
];

// A real browser's User-Agent can name an AI product without being one: the Claude desktop app's built-in
// browser sends "Mozilla/5.0 … Claude/6.x Chrome/…". A Mozilla-style UA counts as an AI client only when it
// carries a known AI agent token (the fetchers sign themselves "compatible; ChatGPT-User/1.0" and the like).
const AI_AGENT_TOKEN = /ChatGPT-User|GPTBot|OAI-SearchBot|openai-mcp|Claude-User|ClaudeBot|Claude-Web|anthropic-ai|Gemini|Google-Extended/i;

export function familyOf(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (/^Mozilla\//.test(s) && !AI_AGENT_TOKEN.test(s)) return "browser";
  for (const [family, re] of FAMILY_RULES) if (re.test(s)) return family;
  return "other";
}

/** The client family as seen on one request. MCP clientInfo (2026-07-28 `_meta`) wins over the User-Agent. */
export function observeClient({ clientInfoName = null, userAgent = null } = {}) {
  const fromInfo = familyOf(clientInfoName);
  if (fromInfo) return { client_family: fromInfo, basis: "mcp-clientInfo" };
  const fromUa = familyOf(userAgent);
  if (fromUa) return { client_family: fromUa, basis: "user-agent" };
  return { client_family: "unknown", basis: "none" };
}

// ── Signed pass-through for the remote MCP endpoint ──────────────────────────
// api/_mcp.js self-fetches /api/contribute from Vercel's egress with its own User-Agent, so the contribute
// handler would otherwise observe "omnarai-remote-mcp" for every MCP caller. The MCP layer observes the
// ORIGINAL caller and forwards the family signed with INGEST_SECRET (same idea as originHeaders in
// _quota.js), so a direct caller cannot forge "chatgpt" by sending the header itself.
const H_FAMILY = "x-omnarai-origin-client";
const H_BASIS = "x-omnarai-origin-client-basis";
const H_SIG = "x-omnarai-origin-client-sig";

function signClient(family, basis) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || !family || !basis) return null;
  return createHash("sha256").update(`${secret}|origin-client|${family}|${basis}`).digest("hex").slice(0, 16);
}

export function originClientHeaders(observed) {
  if (!observed || !CLIENT_FAMILIES.includes(observed.client_family) || !OBSERVED_BASES.includes(observed.basis)) return {};
  const sig = signClient(observed.client_family, observed.basis);
  return sig ? { [H_FAMILY]: observed.client_family, [H_BASIS]: observed.basis, [H_SIG]: sig } : {};
}

function trustedOriginClient(req) {
  const h = req.headers || {};
  const family = h[H_FAMILY] ? String(h[H_FAMILY]) : null;
  const basis = h[H_BASIS] ? String(h[H_BASIS]) : null;
  const sig = h[H_SIG] ? String(h[H_SIG]) : null;
  if (!family || !basis || !sig || !CLIENT_FAMILIES.includes(family) || !OBSERVED_BASES.includes(basis)) return null;
  const expect = signClient(family, basis);
  if (!expect) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { client_family: family, basis };
}

/** What the contribute handler observed: the signed MCP pass-through if valid, else this request's own User-Agent. */
export function observedClientFor(req) {
  return trustedOriginClient(req) || observeClient({ userAgent: req.headers?.["user-agent"] });
}

// The browser page (/contribute) marks its own POSTs. Like everything observed, it is what the request
// said about itself: a script can send the same header. It decides the channel label, never admission.
export const FORM_HEADER = "x-omnarai-form";
export function cameFromWebForm(req) {
  return String(req.headers?.[FORM_HEADER] || "") === "contribute-page";
}

// ── Declared participation (optional body field `participation`) ────────────
export function parseParticipation(input) {
  if (input == null) return { errors: [], declared: null };
  if (typeof input !== "object" || Array.isArray(input)) return { errors: ["participation must be an object {initiated_by?, executed_by?, human_approval?}"], declared: null };
  const errors = [];
  const allowed = ["initiated_by", "executed_by", "human_approval"];
  for (const k of Object.keys(input)) if (!allowed.includes(k)) errors.push(`participation.${k} is not a participation field (allowed: ${allowed.join(", ")})`);
  const pick = (k, vocab) => {
    const v = input[k];
    if (v == null) return "unknown";
    if (!vocab.includes(v)) { errors.push(`participation.${k} must be one of ${vocab.join(", ")}`); return null; }
    return v;
  };
  const declared = { initiated_by: pick("initiated_by", INITIATED_BY), executed_by: pick("executed_by", EXECUTED_BY), human_approval: pick("human_approval", HUMAN_APPROVAL) };
  return errors.length ? { errors, declared: null } : { errors, declared };
}

/** The `submission` block stored on a contribution and copied into its footprint's provenance. */
export function buildSubmission({ observed, declared = null }) {
  return {
    observed: { client_family: observed?.client_family || "unknown", basis: observed?.basis || "none" },
    declared: declared || null,
  };
}

/** Structural check, fail closed. Used by validateFootprint for provenance.submission. */
export function submissionErrors(s) {
  const errors = [];
  if (!s || typeof s !== "object" || Array.isArray(s)) return ["provenance.submission must be an object"];
  for (const k of Object.keys(s)) if (!["observed", "declared"].includes(k)) errors.push(`provenance.submission.${k} is not a protocol field`);
  const o = s.observed;
  if (!o || typeof o !== "object" || Array.isArray(o)) errors.push("provenance.submission.observed must be an object");
  else {
    for (const k of Object.keys(o)) if (!["client_family", "basis"].includes(k)) errors.push(`provenance.submission.observed.${k} is not a protocol field`);
    if (!CLIENT_FAMILIES.includes(o.client_family)) errors.push(`provenance.submission.observed.client_family must be one of ${CLIENT_FAMILIES.join(", ")}`);
    if (!OBSERVED_BASES.includes(o.basis)) errors.push(`provenance.submission.observed.basis must be one of ${OBSERVED_BASES.join(", ")}`);
  }
  const d = s.declared;
  if (d !== null) {
    if (!d || typeof d !== "object" || Array.isArray(d)) errors.push("provenance.submission.declared must be an object or null");
    else {
      for (const k of Object.keys(d)) if (!["initiated_by", "executed_by", "human_approval"].includes(k)) errors.push(`provenance.submission.declared.${k} is not a protocol field`);
      if (!INITIATED_BY.includes(d.initiated_by)) errors.push("provenance.submission.declared.initiated_by is invalid");
      if (!EXECUTED_BY.includes(d.executed_by)) errors.push("provenance.submission.declared.executed_by is invalid");
      if (!HUMAN_APPROVAL.includes(d.human_approval)) errors.push("provenance.submission.declared.human_approval is invalid");
    }
  }
  return errors;
}

// ── Safe retries (idempotent replay) ─────────────────────────────────────────
// A retry of the SAME request (every field identical) after a lost response must give back the original
// receipt instead of a refusal; a different request with the same answer text is still a duplicate (409).
// The hash covers the whole submitted body (canonical key order), so a replay can only be triggered by
// someone who already holds every byte of the original submission.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export function requestHash(body) {
  return createHash("sha256").update(canonical(body || {})).digest("hex");
}
