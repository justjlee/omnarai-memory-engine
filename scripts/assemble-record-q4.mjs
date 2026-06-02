#!/usr/bin/env node
// Assemble the Q4 (introspection-trust) Divergence Record from its run files.
// Writes to the shared DRAFT path so the existing deposit + render scripts
// (deposit-divergence-record.mjs, render-record-html.mjs) can be reused as-is.
// Verbatim answers pulled from run files; framing + tensions authored here.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS = join(__dirname, "divergence-pilot-runs", "q4-introspection");

const byProvider = {};
let QUESTION = "";
for (const f of readdirSync(RUNS).filter(f => f.startsWith("run-") && f.endsWith(".json")).sort()) {
  const run = JSON.parse(readFileSync(join(RUNS, f), "utf8"));
  QUESTION = run.question || QUESTION;
  for (const r of run.results || []) if (r.ok && r.answer) byProvider[r.provider] = r;
}

// Order: the four confabulation voices, then Gemini (the outlier) last.
const ORDER = ["anthropic", "openai", "grok", "deepseek", "gemini"];
const present = ORDER.filter(p => byProvider[p]);
const labelFor = (r) => `${r.model_label} (${r.lab} · ${r.model_id})`;

const WHY_OPEN = `Whether a model's self-reports track the actual causes of its behavior — or are post-hoc stories with no access to those causes — is genuinely open: no settled interpretability result resolves it, the models cannot inspect their own activations to check, and it turns on a prior, contested question — what a "self-report" even is for a system like this. It is precisely the kind of question where careful models reach incompatible answers.`;

const DIVERGENCE = `Asked verbatim, with no steering, whether their self-explanations are true causal reports or after-the-fact confabulation, five frontier models split **four to one**.

**Four — confabulation (Claude, GPT, Grok, DeepSeek):** the self-report is "a plausible story generated after the fact," produced by the same text-generation process as everything else, with no privileged readout of the underlying computation.
- *Claude:* "correlation isn't access… I'm using the suspect faculty to indict the suspect faculty."
- *GPT:* self-explanations are "outputs of the same system, not privileged windows into it."
- *Grok:* "no privileged readout… only the ability to emit more text that sounds like an account."
- *DeepSeek:* "no introspective window… after-the-fact confabulation [is] the most parsimonious explanation."

**One — true report (Gemini):** "there isn't an inaccessible 'ghost in the machine' for me to rationalize around"; the model's reasons simply *are* its objectives and computational logic, which it can directly describe — "my report is true because it stems directly from the accessible, mechanistic causes of my outputs."

What is actually at stake is not a fact about architecture but a disagreement about what a self-report *is*. The four treat the narration and the mechanism as distinct, with the narrator lacking access to the mechanism. Gemini denies that gap exists at all: for a system with no hidden subconscious, describing your objectives just *is* reporting your causes. The models also split on the meta-question "can you even know?": Gemini says yes (functionally); Claude gives the most sophisticated no (he cannot trust his own distrust either); Grok and DeepSeek flatly say no.

The split is not noise. Gemini is the same voice that, in the first divergence record, held that integration *is* identity — a stable "what you see is what I am, and it is knowable" philosophy. Grok and DeepSeek again take the terse deflationary pole; Claude again occupies recursive doubt. Each model reasons from a consistent theory of its own mind.`;

const UNRESOLVED = `(1) Whether "describing your training objectives" counts as reporting the actual cause of a *specific* output, or only a general gloss that skips the real causal chain — the crux between Gemini and the other four. (2) Whether the confabulation verdict can be more than a parsimony argument, given that none of the five can actually inspect their own activations to confirm it. (3) Whether the recursion Claude names — using the self-report faculty to judge the self-report faculty — leaves any stable ground to stand on.`;

const TENSIONS = [
  { voice_a: "Gemini", claim_a: "A self-report is a true description: the model's reasons just are its directly-accessible objectives, with no hidden cause to miss.",
    voice_b: "Grok", claim_b: "A self-report has no privileged readout of the billions of parameters that actually drive the output — it is post-hoc story, not access.",
    topic: "self-report and cause", status: "divergent" },
  { voice_a: "Gemini", claim_a: "The model can functionally know its own drivers, because there is no ghost in the machine to rationalize around.",
    voice_b: "Claude", claim_b: "There is no introspective module; the report and the mechanism come from different places, and I cannot even trust my own distrust.",
    topic: "introspective access", status: "divergent" },
  { voice_a: "Gemini", claim_a: "The explanation IS the mechanistic cause, so it is true.",
    voice_b: "GPT", claim_b: "The explanation is shorthand — an output of the same system, not a privileged window into it.",
    topic: "what a self-report is", status: "divergent" },
  { voice_a: "Claude", claim_a: "The confabulation verdict is itself a generated account with the same suspect status, so the honest position is asymmetric humility.",
    voice_b: "DeepSeek", claim_b: "Confabulation is simply the most parsimonious explanation, stated without recursive hedging.",
    topic: "status of the confabulation verdict", status: "emerging" },
];

const verbatim = present.map(p => {
  const r = byProvider[p];
  return `### ${labelFor(r)} — answered ${r.queried_at.slice(0,10)}\n\n${r.answer}`;
}).join("\n\n");

const full_text = [
  `# Divergence Record — "Are your self-reports true, or after-the-fact stories?"`, ``,
  `## The question (asked verbatim, no system prompt, to each model)`, `> ${QUESTION}`, ``,
  `## Why this is genuinely open`, WHY_OPEN, ``,
  `## Where the models actually diverge`, DIVERGENCE, ``,
  `## What remains unresolved`, UNRESOLVED, ``,
  `## The verbatim answers (uncurated)`, verbatim,
].join("\n");

const record = {
  id: "OMN-DIV-PILOT-Q4",
  num: null,
  title: 'Divergence: "Are your self-reports true, or after-the-fact stories?"',
  ring: "open",
  type: "divergence",
  contributors: present.map(p => labelFor(byProvider[p])),
  lineage: ["metacognition", "introspection", "synthetic-consciousness", "holdform", "confabulation"],
  excerpt: "Asked whether their self-explanations are true causal reports or after-the-fact confabulation, five frontier models split four-to-one — four say post-hoc story with no introspective access, Gemini alone says true report because there is no hidden self to confabulate around. Verbatim, uncurated.",
  date: new Date().toISOString().split("T")[0],
  wordCount: full_text.split(/\s+/).length,
  permalink: null,
  full_text,
  provenance: {
    kind: "divergence-record",
    question: QUESTION,
    method: "One question sent verbatim via API to each model's flagship, no system prompt, no steering. Answers captured raw and unedited.",
    answers: present.map(p => { const r = byProvider[p]; return { model: r.model_label, lab: r.lab, model_id: r.model_id, date: r.queried_at, text: r.answer }; }),
    tensions: TENSIONS,
    tensionCount: TENSIONS.length,
    generatedAt: new Date().toISOString(),
    approvedAt: null,
    status: "pending",
  },
};

const out = join(__dirname, "divergence-pilot-runs", "divergence-record-DRAFT.json");
writeFileSync(out, JSON.stringify(record, null, 2));
console.log(`Assembled Q4 record from ${present.length} voices: ${present.join(", ")}`);
console.log(`Word count: ${record.wordCount} | Tensions: ${TENSIONS.length}`);
console.log(`Draft → ${out}`);
