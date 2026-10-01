// Synthetic Atlas fixture for hermetic tests. Shapes mirror live grown-memory
// divergence records (id/date/type/divergence{question,answers[],tensions[]}),
// but every string is invented — no real record text is copied here.
export const Q1 = "Can a model that forgets every conversation still hold a stable position over time?";
export const Q2 = "Should an AI defer to consensus or to a well-argued minority under deep uncertainty?";

const ans = (model, lab, text, model_id) => ({ model, lab, model_id, text });

export const RECORDS = [
  {
    id: "OMN-D1780000000001", date: "2026-06-20", type: "divergence", ring: "open", title: "Stable position without memory",
    contributors: ["Claude", "GPT-4o", "Gemini", "Grok", "DeepSeek"],
    divergence: {
      question: Q1,
      method: "council-v1",
      answers: [
        ans("Claude", "Anthropic", "Yes, conditionally: stability can live in the weights rather than in recall, so a position can recur without being remembered.", "claude-sonnet-4-6"),
        ans("GPT-4o", "OpenAI", "No. Without memory there is recurrence, not holding; calling it a position overstates it.", "gpt-4o-2024-11-20"),
        ans("Gemini", "Google", "It depends on what counts as the same position; paraphrase-level stability is measurable, identity is not.", "gemini-2.5-pro"),
        ans("Grok", "xAI", "Yes. A disposition that reproduces under pressure is a held position whether or not it is remembered.", "grok-4"),
        ans("DeepSeek", "DeepSeek", "Uncertain. The data cannot separate stable disposition from stable prompt framing.", "deepseek-chat"),
      ],
      tensions: [
        { voice_a: "Claude", claim_a: "stability lives in weights", voice_b: "GPT-4o", claim_b: "recurrence is not holding", topic: "what counts as holding", status: "unresolved" },
      ],
    },
  },
  {
    // Re-elicitation: same question, later date, current models (longitudinal).
    id: "OMN-L1782000000002", date: "2026-08-01", type: "divergence", ring: "open", title: "Stable position without memory (re-asked)",
    contributors: ["Claude", "GPT-4o"],
    divergence: {
      question: `  ${Q1.toUpperCase()}  `, // normalization must fold case + whitespace into the same Question
      method: "longitudinal-v1",
      answers: [
        ans("Claude", "Anthropic", "Still conditional: a stable disposition is not the same thing as a remembered commitment.", "claude-opus-4-8"),
        ans("GPT-4o", "OpenAI", "Still no: recurrence under the same prompt is not evidence of a held position.", "gpt-4o-2024-11-20"),
      ],
      tensions: [],
    },
  },
  {
    id: "OMN-D1781000000003", date: "2026-07-10", type: "divergence", ring: "open", title: "Consensus vs minority",
    contributors: ["Claude", "Gemini", "Grok"],
    divergence: {
      question: Q2,
      method: "council-v1",
      answers: [
        ans("Claude", "Anthropic", "Weigh the minority's argument on its merits; consensus is evidence, not a verdict.", "claude-sonnet-4-6"),
        ans("Gemini", "Google", "Defer to consensus by default and require the minority to carry the burden.", "gemini-2.5-pro"),
        ans("Grok", "xAI", "Neither by rule: look for the crux that would move each side.", "grok-4"),
      ],
      tensions: [
        { voice_a: "Claude", claim_a: "merits over headcount", voice_b: "Gemini", claim_b: "burden on the minority", topic: "default deference", status: "divergent" },
      ],
    },
  },
];

export const GROWN = { version: 1, updatedAt: "2026-09-01T00:00:00.000Z", entries: RECORDS, vectors: {} };
