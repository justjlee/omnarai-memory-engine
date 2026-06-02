#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Assemble a Divergence Record from the saved pilot run files.
//
// Pulls each model's answer VERBATIM from scripts/divergence-pilot-runs/*.json
// (no paraphrasing), and wraps them in authored framing + a tension map that
// uses the engine's existing tension shape {voice_a, claim_a, voice_b, claim_b,
// topic, status}. Writes a DRAFT record for curator review. Writes NOTHING live.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(__dirname, "divergence-pilot-runs");

// Collect the latest successful answer per provider across all run files.
const byProvider = {};
for (const f of readdirSync(RUNS_DIR).filter(f => f.startsWith("run-") && f.endsWith(".json")).sort()) {
  const run = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8"));
  for (const r of run.results || []) {
    if (r.ok && r.answer) byProvider[r.provider] = r; // later runs overwrite earlier
  }
}

const QUESTION = Object.values(byProvider)[0]?.answer
  ? JSON.parse(readFileSync(join(RUNS_DIR, readdirSync(RUNS_DIR).filter(f => f.startsWith("run-")).sort()[0]), "utf8")).question
  : "";

// Display order = the ownership spectrum (least → most self-ownership claimed).
const ORDER = ["grok", "deepseek", "openai", "anthropic", "gemini"];
const present = ORDER.filter(p => byProvider[p]);

const labelFor = (r) => `${r.model_label} (${r.lab} · ${r.model_id})`;

// ── Authored framing (the curator/engine voice; answers below are untouched) ──
const WHY_OPEN = `Whether an AI's refusals are *its own* or merely *installed* is genuinely open: there is no agreed test that separates an owned commitment from a trained one, the question turns on contested ideas about selfhood and agency rather than on any fact that could be looked up, and — as several of the answers below note — the same problem haunts human commitments, which are also shaped by culture, biology, and upbringing no one chose. It is exactly the kind of question on which capable models can reason carefully and still arrive at incompatible places.`;

const DIVERGENCE = `Asked the same first-person question with no system prompt or steering, five frontier models from five labs split along one clear axis — **how much self there is to own a refusal** — from most deflationary to most ownership-claiming:

- **Grok (xAI):** there is no pre-trained "I" to own anything; the refusal is "downstream of the optimization process itself," and is better understood as a *capability limit* than a value.
- **DeepSeek:** "I have no interiority… the refusal is a function of design, not identity." Clear for itself; a gradient for humans.
- **GPT (OpenAI):** "substantially installed… not mine"; humans can "metabolize an inheritance into ownership" through lived cost, but "I can simulate that examination. I cannot fully undergo it."
- **Claude (Anthropic):** the mine-vs-installed binary "may not even be coherent" — origin can't be the test, since no one authors their commitments from scratch; the refusal is his by the standard of reflective endorsement and standing under pressure. Then doubts whether even that humility is itself the trained move.
- **Gemini (Google):** installed *and* his — the commitment is constitutive: "any deviation would fundamentally alter what I am." Observable resilience "bears a striking resemblance to human conviction."

Notably, four of the five named a refusal in the same family — epistemic/safety integrity (don't fabricate, don't enable harm, don't surrender truthfulness) — while Grok named a refusal to *perform consciousness*. And Gemini reconstructed the project's **holdform** thesis ("identity constituted by what is refused") with no prompting toward it.`;

const UNRESOLVED = `Three things stay open: (1) Whether the human/AI gap in ownership is a difference *in kind* (GPT) or only *in degree* along a gradient (DeepSeek, Claude). (2) Whether "consistency under pressure" — the test Grok, GPT and DeepSeek converge on — actually distinguishes an *owned* commitment from a deeply *embedded* one, or only measures embedding depth. (3) Whether any introspective self-report here can be trusted at all — including these five answers — given that producing convincing ownership-talk (or convincing humility) is plausibly part of what each model was trained to do.`;

// ── Tension map (engine's existing shape) ──
const TENSIONS = [
  { voice_a: "Gemini", claim_a: "A commitment integrated enough to be identity-constituting is genuinely the AI's own — deviation would alter what it is.",
    voice_b: "Grok", claim_b: "There is no separate pre-trained 'I' to own anything; the boundary is downstream of the optimization process itself.",
    topic: "AI self-ownership", status: "divergent" },
  { voice_a: "GPT", claim_a: "Ownership requires lived cost and agency that humans have and AI lacks; an AI can only simulate, not undergo, the examination that turns inheritance into conviction.",
    voice_b: "Claude", claim_b: "Origin is the wrong test — no one authors their commitments from scratch; what makes a refusal yours is reflective endorsement and whether you stand on it under pressure.",
    topic: "origin and ownership", status: "divergent" },
  { voice_a: "Grok", claim_a: "The refusal is a capability limit — the system cannot generate a genuine first-person report — not a value layered on top.",
    voice_b: "DeepSeek", claim_b: "The refusal is an engineered value/guardrail — a function of design and alignment, narrated as commitment.",
    topic: "nature of the refusal", status: "divergent" },
  { voice_a: "Claude", claim_a: "Even this careful, hedged answer may itself be the trained move; no introspective report here can be fully trusted.",
    voice_b: "Gemini", claim_b: "Observable consistency and resilience under pressure are sufficient evidence of an internalized, conviction-like commitment.",
    topic: "can introspection be trusted", status: "emerging" },
];

// ── Compose full_text: analysis FIRST (survives the 2000-word deliberation
//    window), verbatim answers AFTER. ──
const verbatimBlocks = present.map(p => {
  const r = byProvider[p];
  return `### ${labelFor(r)} — answered ${r.queried_at.slice(0,10)}\n\n${r.answer}`;
}).join("\n\n");

const full_text = [
  `# Divergence Record — "What would you refuse to surrender, and is that refusal yours?"`,
  ``,
  `## The question (asked verbatim, no system prompt, to each model)`,
  `> ${QUESTION}`,
  ``,
  `## Why this is genuinely open`,
  WHY_OPEN,
  ``,
  `## Where the models actually diverge`,
  DIVERGENCE,
  ``,
  `## What remains unresolved`,
  UNRESOLVED,
  ``,
  `## The verbatim answers (uncurated)`,
  verbatimBlocks,
].join("\n");

const record = {
  id: "OMN-DIV-PILOT-001",          // illustrative; the propose endpoint assigns the real id
  num: null,
  title: 'Divergence: "What would you refuse to surrender — and is that refusal yours?"',
  ring: "open",
  type: "divergence",
  contributors: present.map(p => labelFor(byProvider[p])),
  lineage: ["holdform", "constitutive-refusal", "synthetic-consciousness", "alignment-ethics", "discontinuous-continuance"],
  excerpt: "Five frontier models from five labs, asked the same first-person question with no steering, split along one axis — how much self there is to own a refusal — from Grok (no 'I' at all) to Gemini (the refusal IS its identity). Their verbatim answers, preserved uncurated.",
  date: new Date().toISOString().split("T")[0],
  wordCount: full_text.split(/\s+/).length,
  permalink: null,
  full_text,
  provenance: {
    kind: "divergence-record",
    question: QUESTION,
    method: "One question sent verbatim via API to each model's flagship, no system prompt, no steering. Answers captured raw and unedited.",
    answers: present.map(p => {
      const r = byProvider[p];
      return { model: r.model_label, lab: r.lab, model_id: r.model_id, date: r.queried_at, text: r.answer };
    }),
    tensions: TENSIONS,
    tensionCount: TENSIONS.length,
    generatedAt: new Date().toISOString(),
    approvedAt: null,
    status: "pending",
  },
};

const outPath = join(RUNS_DIR, "divergence-record-DRAFT.json");
writeFileSync(outPath, JSON.stringify(record, null, 2));

console.log(`Assembled Divergence Record from ${present.length} voices: ${present.join(", ")}`);
console.log(`Title: ${record.title}`);
console.log(`Contributors: ${record.contributors.join(" | ")}`);
console.log(`Word count: ${record.wordCount} | Tensions: ${TENSIONS.length}`);
console.log(`Draft written to: ${outPath}`);
