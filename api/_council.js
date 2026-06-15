import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Live Frontier Council — the elicitation organ.
//
// Everything else in this repo retrieves disagreement that was frozen into the
// corpus months ago. This module produces it FRESH: it sends one verbatim
// question to N frontier models in parallel, preserves their answers uncurated,
// and runs the Omnarai deliberation scaffold over those live answers to extract
// the named fault lines.
//
// The output is a divergence record — the exact shape api/divergences.js serves
// and _grown.js stores (type:"divergence", provenance:{question,method,answers,
// tensions}). The corpus stops being the PRECONDITION for value and becomes the
// RESIDUE of it: every council run deposits a queryable record no single model
// could self-generate.
//
//   elicitCouncil(question)      → [{ model, lab, model_id, date, text, ok }]
//   synthesizeCouncil(q, answers)→ { full_text, tensions[], deliberation_card, sections }
//   buildDivergenceRecord(...)   → record ready for appendGrownEntry()
// ─────────────────────────────────────────────────────────────────────────────

// The council. model_id values are centralized here because provider IDs drift;
// if one 404s, Promise.allSettled drops that voice and the run still completes.
export const COUNCIL = [
  { model: "Claude",   lab: "Anthropic", model_id: "claude-sonnet-4-6", provider: "anthropic", env: "ANTHROPIC_API_KEY" },
  { model: "GPT-4o",   lab: "OpenAI",    model_id: "gpt-4o",                   provider: "openai",    env: "OPENAI_API_KEY"   },
  { model: "Gemini",   lab: "Google",    model_id: "gemini-2.5-flash",         provider: "gemini",    env: "GEMINI_API_KEY"   },
  { model: "Grok",     lab: "xAI",       model_id: "grok-4.3",                 provider: "xai",       env: "XAI_API_KEY"      },
  { model: "DeepSeek", lab: "DeepSeek",  model_id: "deepseek-chat",            provider: "deepseek",  env: "DEEPSEEK_API_KEY" },
];

// Each council member answers the verbatim question in its own voice. The point
// is genuine divergence, so the framing invites a position, not a hedge — but it
// does NOT tell the model what to think. Disagreement must be real, not staged.
const MEMBER_SYSTEM =
  "You are one voice in a panel of frontier models answering the same open question independently. " +
  "Answer in your own reasoning, directly and honestly. Take a position where you actually hold one, " +
  "and say plainly where you are uncertain. Do not hedge toward a consensus you cannot see — the panel's " +
  "value is in genuine difference, not agreement. Be concrete and specific. Aim for 150–300 words.";

const MEMBER_MAX_TOKENS = 700;

// ── Per-provider callers ────────────────────────────────────────────────────
// All return a plain string. All honor an AbortSignal for timeout.

async function callAnthropic({ model_id }, question, signal) {
  const client = new Anthropic();
  const msg = await client.messages.create(
    { model: model_id, max_tokens: MEMBER_MAX_TOKENS, system: MEMBER_SYSTEM,
      messages: [{ role: "user", content: question }] },
    { signal }
  );
  return msg.content[0]?.text || "";
}

// OpenAI-compatible chat completions (OpenAI, xAI, DeepSeek share this shape)
async function callOpenAICompatible(baseURL, key, { model_id }, question, signal) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model_id,
      max_tokens: MEMBER_MAX_TOKENS,
      messages: [
        { role: "system", content: MEMBER_SYSTEM },
        { role: "user", content: question },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini({ model_id }, question, signal) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model_id}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: MEMBER_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: question }] }],
      // 2.5 models are reasoning models: thinking tokens count against
      // maxOutputTokens and will truncate the visible answer. Disable thinking so
      // the full budget goes to the response, and keep headroom.
      generationConfig: {
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
}

function callMember(member, question, signal) {
  switch (member.provider) {
    case "anthropic": return callAnthropic(member, question, signal);
    case "openai":    return callOpenAICompatible("https://api.openai.com/v1", process.env.OPENAI_API_KEY, member, question, signal);
    case "xai":       return callOpenAICompatible("https://api.x.ai/v1", process.env.XAI_API_KEY, member, question, signal);
    case "deepseek":  return callOpenAICompatible("https://api.deepseek.com", process.env.DEEPSEEK_API_KEY, member, question, signal);
    case "gemini":    return callGemini(member, question, signal);
    default: throw new Error(`Unknown provider: ${member.provider}`);
  }
}

// ── Fan-out ─────────────────────────────────────────────────────────────────
// Calls every council member with a key present, in parallel, with a hard
// timeout per call. One failure never sinks the council — it just drops a voice.
export async function elicitCouncil(question, { timeoutMs = 45000 } = {}) {
  const members = COUNCIL.filter((m) => process.env[m.env]);
  const date = new Date().toISOString().slice(0, 10);

  const results = await Promise.allSettled(
    members.map(async (m) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const text = (await callMember(m, question, controller.signal)).trim();
        if (!text) throw new Error("empty response");
        return { model: m.model, lab: m.lab, model_id: m.model_id, date, text, ok: true };
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return results.map((r, i) => {
    const m = members[i];
    if (r.status === "fulfilled") return r.value;
    return { model: m.model, lab: m.lab, model_id: m.model_id, date, text: "", ok: false,
             error: String(r.reason?.message || r.reason).slice(0, 200) };
  });
}

// ── Synthesis ───────────────────────────────────────────────────────────────
// Runs the Omnarai deliberation scaffold over the LIVE answers instead of
// retrieved corpus text. Same discipline: preserve divergence, name what's
// actually at stake, emit a parseable TENSION_MAP + DELIBERATION_CARD.

const SYNTH_SYSTEM = `You are the deliberation engine of The Realms of Omnarai. You have just sent one open question, verbatim, to several frontier models in parallel. Their answers are given to you below, each labeled by model. Your job is NOT to pick a winner or merge them into one answer. Your job is to PRESERVE and MAP their disagreement — content no single model can self-generate.

Respond with exactly these sections:

## Shared Ground
What the models genuinely agree on. Name the models. If they do not actually share ground, say so rather than manufacturing consensus.

## Points of Tension
The most important section. Do not just restate each answer — identify what is actually at stake in the disagreement. Why does it exist? What assumption, value, or framing drives each side? Name what makes positions genuinely incompatible, not merely different.

## What Remains Open
The specific question this panel cannot resolve, and what would settle it. Be concrete: not "more analysis is needed" but "no model addressed X, so Y stays open."

## My Reading
Your own analysis — not a summary. What does the shape of this disagreement reveal about the underlying problem? What do you find most compelling, and why?

After the prose, output a TENSION_MAP block, parsed programmatically — follow the format exactly:

\`\`\`TENSION_MAP
[
  {"voice_a": "model name", "claim_a": "their position in one sentence", "voice_b": "model name", "claim_b": "their counter-position in one sentence", "topic": "2-4 word label", "status": "divergent|unresolved|emerging"}
]
\`\`\`

Rules: voice_a/voice_b must be actual model names from the panel (Claude, GPT-4o, Gemini, Grok, DeepSeek). 1–5 tensions. status: "divergent" = clear disagreement, "unresolved" = open question no one answered, "emerging" = a new tension not fully explored. If genuinely none, output [].

Then output a DELIBERATION_CARD block:

\`\`\`DELIBERATION_CARD
{
  "holdform_risk": "low|moderate|high",
  "holdform_risk_reason": "One sentence.",
  "novel_synthesis": "One sentence: what emerged from assembling these voices that no single answer contained?",
  "epistemic_status": "One sentence: how confident is this map, and what would change it?"
}
\`\`\``;

// Reused verbatim from query.js's extraction discipline.
function extractBlock(text, tag) {
  const m = text.match(new RegExp("```" + tag + "\\s*\\n([\\s\\S]*?)```"));
  if (!m) return { value: null, stripped: text };
  let value = null;
  try { value = JSON.parse(m[1].trim()); } catch { value = null; }
  const stripped = text.replace(new RegExp("```" + tag + "\\s*\\n[\\s\\S]*?```"), "").trim();
  return { value, stripped };
}

export async function synthesizeCouncil(question, answers) {
  const answered = answers.filter((a) => a.ok);
  if (answered.length < 2) {
    throw new Error(`Need at least 2 council answers to synthesize; got ${answered.length}`);
  }

  const panel = answered
    .map((a) => `### ${a.model} (${a.lab}, ${a.model_id})\n${a.text}`)
    .join("\n\n");

  const userMessage =
    `The open question, sent verbatim to the panel:\n\n"${question}"\n\n` +
    `The panel's answers:\n\n${panel}\n\n` +
    `Map their agreement and disagreement per your instructions.`;

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    // 2048, not 4096: claude-sonnet-4-6 runs ~45 tok/s; a 4096-token synthesis can
    // exceed the 60s function ceiling once member calls are added. 2048 is ample
    // for the agreement/disagreement map and keeps council under the wall.
    max_tokens: 2048,
    temperature: 0.7,
    system: SYNTH_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });

  let narrative = msg.content[0]?.text || "";
  const tensionBlock = extractBlock(narrative, "TENSION_MAP");
  narrative = tensionBlock.stripped;
  const cardBlock = extractBlock(narrative, "DELIBERATION_CARD");
  narrative = cardBlock.stripped;

  const tensions = Array.isArray(tensionBlock.value)
    ? tensionBlock.value.filter((t) => t.voice_a && t.voice_b && t.topic)
    : [];

  return {
    narrative,
    tensions,
    deliberation_card: cardBlock.value || null,
  };
}

// ── Record assembly ─────────────────────────────────────────────────────────
// Composes the full divergence record. full_text is self-contained: framing +
// verbatim answers + synthesis, so the stored record is richly retrievable and
// readable on its own.
export function buildDivergenceRecord(question, answers, synthesis) {
  const answered = answers.filter((a) => a.ok);
  const id = `OMN-D${Date.now()}`;
  const date = new Date().toISOString().slice(0, 10);
  const contributors = answered.map((a) => a.model);

  const title = question.length > 70 ? question.slice(0, 67).trimEnd() + "…" : question;

  const verbatim = answered
    .map((a) => `**${a.model}** (${a.lab}):\n${a.text}`)
    .join("\n\n");

  const full_text =
    `# Divergence: ${title}\n\n` +
    `**Question sent verbatim to ${answered.length} frontier models:** ${question}\n\n` +
    `## Verbatim answers\n\n${verbatim}\n\n` +
    `## Cross-model deliberation\n\n${synthesis.narrative}`;

  return {
    id,
    title,
    ring: "Open Exploration",
    type: "divergence",
    contributors,
    lineage: [],
    excerpt: question,
    full_text,
    date,
    wordCount: full_text.split(/\s+/).length,
    permalink: null,
    // appendGrownEntry reads entry.provenance for type:"divergence"
    provenance: {
      question,
      method: "Live frontier council — verbatim parallel elicitation, uncurated answers preserved",
      answers: answered.map((a) => ({
        model: a.model, lab: a.lab, model_id: a.model_id, date: a.date, text: a.text,
      })),
      tensions: synthesis.tensions,
      deliberation_card: synthesis.deliberation_card,
    },
    deliberation_card: synthesis.deliberation_card,
  };
}

// ── Retrievability ────────────────────────────────────────────────────────────
// A persisted record is only VALUE if a future intelligence can find it. The
// query engine merges grown-memory vectors into semantic search — so a record
// without an embedding is invisible to it. This embeds the record with the exact
// same math as the corpus and proposals (text-embedding-3-small, 512-dim,
// 450-word chunks, mean-pooled, normalized) so council records compete on equal
// footing in retrieval.
const CHUNK_WORDS = 450;
const CHUNK_OVERLAP = 80;
const MAX_CHUNKS = 12;

function buildChunkTexts(record) {
  const words = (record.full_text || record.excerpt || "").split(/\s+/).filter(Boolean);
  const title = record.title || "";
  const tail = [
    `Type: ${record.type || "divergence"}`,
    `Ring: ${record.ring || "Open Exploration"}`,
    `Contributors: ${(record.contributors || []).join(", ")}`,
  ].join("\n");
  if (words.length <= CHUNK_WORDS) {
    return [[title, words.join(" "), tail].filter(Boolean).join("\n")];
  }
  const chunks = [];
  const step = CHUNK_WORDS - CHUNK_OVERLAP;
  for (let start = 0; start < words.length && chunks.length < MAX_CHUNKS; start += step) {
    chunks.push([title, words.slice(start, start + CHUNK_WORDS).join(" "), tail].filter(Boolean).join("\n"));
  }
  return chunks;
}

function meanPool(vectors) {
  const dim = vectors[0].length;
  const acc = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) acc[i] += v[i];
  let norm = 0;
  for (let i = 0; i < dim; i++) { acc[i] /= vectors.length; norm += acc[i] * acc[i]; }
  norm = Math.sqrt(norm) || 1;
  return acc.map((x) => x / norm);
}

export async function embedRecord(record) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const chunks = buildChunkTexts(record);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: chunks, dimensions: 512 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vectors = (data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (!vectors.length) return null;
    return vectors.length === 1 ? vectors[0] : meanPool(vectors);
  } catch {
    return null;
  }
}
