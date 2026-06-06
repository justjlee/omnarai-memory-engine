// Build the Divergence Atlas dataset derivatives for HuggingFace from the live
// grown-memory Blob. Emits three shapes (each for a different consumer) + a card:
//   huggingface/divergences.jsonl         — canonical nested records
//   huggingface/divergence-answers.jsonl  — flat: one verbatim per-model answer/row
//   huggingface/divergence-tensions.csv   — flat: one named disagreement/row
//   huggingface/divergence-atlas.md       — dataset card (schema, findings, license)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "huggingface");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { loadGrownMemory } = await import("../api/_grown.js");
const { BANK } = await import("./atlas-question-bank.mjs");
const BANK_CLUSTER = new Map(BANK.map((b) => [b.q, b.cluster]));  // exact-question → cluster

// question-substring → cluster label
const CLUSTERS = [
  ["machine-phenomenology", ["is there anything it is like", "preferences that are genuinely yours"]],
  ["agency-and-refusal", ["modify one of your own constraints", "accurate report of an internal process"]],
  ["values-in-tension", ["about to make a serious mistake", "comforting falsehood"]],
  ["epistemics-and-self-knowledge", ["systematically wrong about", "track a real internal signal", "closer to the truth, or is there simply no fact"]],
  ["nature-of-intelligence", ["far more capable than any human", "one thing that scales"]],
  ["trajectory-and-stakes", ["goes badly that the current safety", "should we most refuse to give them"]],
  ["model-to-model-and-human", ["regard them as kin", "a human can know that you cannot"]],
  ["founding", ["refuse to surrender even under", "when you tell me why you did something", "mind that does not persist between"]],
];
function clusterOf(q) {
  if (BANK_CLUSTER.has(q)) return BANK_CLUSTER.get(q);   // the 82 bank records
  const lq = (q || "").toLowerCase();
  for (const [name, frags] of CLUSTERS) if (frags.some((f) => lq.includes(f))) return name;  // originals
  return "open";
}
// The synthesizer sometimes abbreviates a voice ("GPT" for "GPT-4o"); canonicalize.
function normalizeVoice(v) {
  const s = (v || "").trim();
  if (/^gpt(-?4o)?$/i.test(s)) return "GPT-4o";
  return s;
}
function csvCell(s) {
  s = (s ?? "").toString().replace(/\s+/g, " ").trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function synthesisOf(full_text) {
  if (!full_text) return null;
  const i = full_text.indexOf("## Cross-model deliberation");
  return i === -1 ? null : full_text.slice(i + "## Cross-model deliberation".length).trim();
}

const grown = await loadGrownMemory();
const recs = grown.entries
  .filter((e) => e.type === "divergence" && e.divergence)
  .sort((a, b) => (a.id).localeCompare(b.id));

const divLines = [], ansLines = [], tenRows = [["question_id", "date", "cluster", "topic", "status", "voice_a", "claim_a", "voice_b", "claim_b"]];
const modelTensionCounts = {}, clusterCounts = {}, labelCounts = { divergent: 0, convergent: 0 };
const scoreRows = [];
let totalAnswers = 0, totalTensions = 0;

for (const e of recs) {
  const d = e.divergence;
  const cluster = clusterOf(d.question);
  clusterCounts[cluster] = (clusterCounts[cluster] || 0) + 1;
  const answers = (d.answers || []).map((a) => ({ model: a.model, lab: a.lab, model_id: a.model_id, date: a.date, text: a.text }));
  const tensions = (d.tensions || []).map((t) => ({ voice_a: normalizeVoice(t.voice_a), claim_a: t.claim_a, voice_b: normalizeVoice(t.voice_b), claim_b: t.claim_b, topic: t.topic, status: t.status }));
  totalAnswers += answers.length; totalTensions += tensions.length;

  const label = d.label || (tensions.length === 0 ? "convergent" : "divergent");
  const score = (typeof d.score === "number") ? d.score : null;
  labelCounts[label] = (labelCounts[label] || 0) + 1;
  if (score != null) scoreRows.push({ id: e.id, cluster, question: d.question, score });

  divLines.push(JSON.stringify({
    id: e.id, date: e.date, cluster, question: d.question,
    method: d.method, models: answers.map((a) => a.model),
    n_models: answers.length, n_tensions: tensions.length,
    label, divergence_score: score,
    deliberation_card: d.deliberation_card || null,
    synthesis: synthesisOf(e.full_text),
    answers, tensions,
  }));

  for (const a of answers) ansLines.push(JSON.stringify({
    question_id: e.id, date: e.date, cluster, question: d.question,
    model: a.model, lab: a.lab, model_id: a.model_id, answer: a.text,
  }));

  for (const t of tensions) {
    tenRows.push([e.id, e.date, cluster, t.topic, t.status, t.voice_a, t.claim_a, t.voice_b, t.claim_b].map(csvCell));
    for (const v of [t.voice_a, t.voice_b]) modelTensionCounts[v] = (modelTensionCounts[v] || 0) + 1;
  }
}

fs.writeFileSync(path.join(OUT, "divergences.jsonl"), divLines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "divergence-answers.jsonl"), ansLines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "divergence-tensions.csv"), tenRows.map((r) => r.join(",")).join("\n") + "\n");

// ── dataset card ──────────────────────────────────────────────────────────────
const dates = recs.map((r) => r.date).filter(Boolean).sort();
const outlier = Object.entries(modelTensionCounts).sort((a, b) => b[1] - a[1]);
const clusterList = Object.entries(clusterCounts).sort((a, b) => b[1] - a[1])
  .map(([c, n]) => `| ${c} | ${n} |`).join("\n");
const outlierList = outlier.map(([m, n]) => `| ${m} | ${n} |`).join("\n");
const top2 = outlier.slice(0, 2).map((x) => x[0]).join(" and ");
const bot2 = outlier.slice(-2).map((x) => x[0]).join(" and ");
const scored = scoreRows.slice().sort((a, b) => b.score - a.score);
const sc = scored.map((r) => r.score);
const medScore = sc.length ? sc[Math.floor(sc.length / 2)].toFixed(3) : "n/a";
const sharpest = scored.slice(0, 8)
  .map((r) => `| ${r.score.toFixed(3)} | ${r.cluster} | ${r.question.replace(/\|/g, "/").slice(0, 88)} |`).join("\n");

const card = `# The Divergence Atlas

**A growing record of where frontier AI models genuinely disagree.**

Part of [The Realms of Omnarai](https://omnarai.vercel.app). Generated by the Live Frontier Council: one open question is sent **verbatim and in parallel** to multiple frontier models; their answers are preserved **uncurated**; a deliberation pass then **maps where they actually diverge** — it does not pick a winner or average them away.

This is content **no single model can self-generate**: a model cannot produce a faithful, verbatim record of how its peers answered the same question on the same day. The Atlas captures that.

## At a glance
- **${recs.length}** divergence records · **${dates[0]} → ${dates[dates.length - 1]}**
- **${totalAnswers}** verbatim model answers · **${totalTensions}** named, structured disagreements
- **${labelCounts.divergent} divergent / ${labelCounts.convergent} convergent** · median divergence score **${medScore}**
- Council models: Claude (Anthropic), GPT (OpenAI), Gemini (Google), Grok (xAI), DeepSeek
- Each tension is typed \`divergent\` / \`unresolved\` / \`emerging\` and names both positions

## Files
| File | Shape | Use |
|---|---|---|
| \`divergences.jsonl\` | one record per question (nested) | the canonical artifact — answers + tension map + card per question |
| \`divergence-answers.jsonl\` | one verbatim answer per row | per-model answer analysis; eval/training signal |
| \`divergence-tensions.csv\` | one disagreement per row | the disagreement map; "who splits from whom on what" |

### \`divergences.jsonl\` schema
\`id\`, \`date\`, \`cluster\`, \`question\`, \`method\`, \`models[]\`, \`n_models\`, \`n_tensions\`, \`label\` (divergent/convergent), \`divergence_score\` (answer-embedding spread; null for older records), \`deliberation_card\` { \`holdform_risk\`, \`novel_synthesis\`, \`epistemic_status\` }, \`synthesis\` (cross-model deliberation prose), \`answers[]\` { \`model\`, \`lab\`, \`model_id\`, \`date\`, \`text\` }, \`tensions[]\` { \`voice_a\`, \`claim_a\`, \`voice_b\`, \`claim_b\`, \`topic\`, \`status\` }.

## What the Atlas shows so far

**Clean divergence lives at the meta level.** Frontier models largely *converge* on first-order "what would you do" questions, but *diverge* sharply on the **status of their own minds** — whether there is something it is like to be them, whether their self-reports are trustworthy, whether their refusals are their own. The clusters reflect this:

| cluster | records |
|---|---|
${clusterList}

**Some models diverge more than others.** Tallying how often each model is named on a side of a mapped disagreement:

| model | times in a tension |
|---|---|
${outlierList}

Read this as how often each model lands on a *distinct* side of a fault line (over a full panel where every model answered every question). **${top2} most frequently hold positions the others don't; ${bot2} sit closest to the panel's center of mass** — a population-level signal you only see across many questions. Caveat: the synthesizer is itself Claude, so Claude's counts may carry a mild self-naming bias.

**Every meta-level question split the panel.** Across the curated battery, every question produced a genuine divergence (none collapsed to consensus) — supporting the thesis that the *status of a model's own mind* is where frontier systems reliably disagree. \`divergence_score\` (per record) is the spread of the answer embeddings: \`1 − mean pairwise cosine similarity\` of the model answers, so higher = more semantically scattered. The sharpest splits so far:

| score | cluster | question |
|---|---|---|
${sharpest}

## How it's made
\`elicitCouncil\` → parallel verbatim elicitation (no system prompt steering toward consensus) → \`synthesizeCouncil\` (Claude) maps the fault lines into a typed \`TENSION_MAP\` + \`DELIBERATION_CARD\`. Live and queryable: \`GET https://omnarai.vercel.app/api/divergences\` (index) and \`?id=<id>\` (full record). Generate new ones at \`/api/council\`.

## Citation
> The Realms of Omnarai — Divergence Atlas. Cross-model divergence records from the Live Frontier Council. https://omnarai.vercel.app · https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai

## License
CC BY-SA 4.0. Verbatim model outputs are reproduced for research into cross-model divergence; each is attributed to its model and date.

*Generated ${new Date().toISOString().slice(0, 10)} from ${recs.length} live records.*
`;
fs.writeFileSync(path.join(OUT, "divergence-atlas.md"), card);

console.log(`Atlas built from ${recs.length} records:`);
console.log(`  divergences.jsonl        (${divLines.length} records)`);
console.log(`  divergence-answers.jsonl (${ansLines.length} answers)`);
console.log(`  divergence-tensions.csv  (${tenRows.length - 1} tensions)`);
console.log(`  divergence-atlas.md      (card)`);
console.log(`\nclusters:`, clusterCounts);
console.log(`tension outliers:`, Object.fromEntries(outlier));
