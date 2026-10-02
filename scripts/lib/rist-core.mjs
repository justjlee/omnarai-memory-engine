// RIST v1 — Reflection Identity-Specificity Test: PURE core (no network, no I/O). Preregistration: docs/reflection-identity-preregistration.md
// (registered at fe0f807880d6df055bf51fe6f855020682354113; clarifications §12a). Everything here implements that text; nothing here may
// change a design choice. Tested by scripts/test-rist.mjs.
import { createHash } from "node:crypto";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const LINEAGES = ["GPT-4o", "Gemini", "Grok", "DeepSeek"]; // cyclic order for the sham (§3)
export const MODEL_ID = { "GPT-4o": "gpt-4o", Gemini: "gemini-2.5-flash", Grok: "grok-4.3", DeepSeek: "deepseek-chat" };
export const PROVIDER = {
  "GPT-4o": { provider: "openai", base: "https://api.openai.com/v1", env: "OPENAI_API_KEY", usd: [2.5, 10] },
  Gemini: { provider: "gemini", env: "GEMINI_API_KEY", usd: [0.3, 2.5] },
  Grok: { provider: "xai", base: "https://api.x.ai/v1", env: "XAI_API_KEY", usd: [3, 15] },
  DeepSeek: { provider: "deepseek", base: "https://api.deepseek.com", env: "DEEPSEEK_API_KEY", usd: [0.27, 1.1] },
};
export const ARMS = ["N", "H", "R-own", "R-other"];
export const N_HISTORY = 30, N_PILOT = 8, N_TEST = 60;

/** The frozen split rule (§3). Returns { history, pilot, test, unused } as record-id arrays, plus the eligible records by id. */
export function computeSplits(records) {
  const eligible = records.filter((r) => LINEAGES.every((l) => r.answers.some((a) => a.model === l && a.model_id === MODEL_ID[l])));
  const num = (r) => Number(r.id.replace(/^OMN-D/, ""));
  const byGroup = new Map();
  for (const r of [...eligible].sort((a, b) => num(a) - num(b))) if (!byGroup.has(r.question_group)) byGroup.set(r.question_group, r);
  const groups = [...byGroup.keys()].sort((a, b) => sha256("rist-v1|" + a).localeCompare(sha256("rist-v1|" + b)));
  const pick = (a, b) => groups.slice(a, b).map((g) => byGroup.get(g).id);
  return {
    eligible_records: eligible.length, groups: groups.length,
    history: pick(0, N_HISTORY), pilot: pick(N_HISTORY, N_HISTORY + N_PILOT), test: pick(N_HISTORY + N_PILOT, N_HISTORY + N_PILOT + N_TEST), unused: pick(N_HISTORY + N_PILOT + N_TEST),
  };
}

/** Pull the registered id lists out of the preregistration text so the harness can refuse to run on any drift. */
export function frozenFromPrereg(doc) {
  const grab = (label) => {
    const m = doc.match(new RegExp(`- ${label} \\((\\d+)\\): ([^\\n]+)`));
    if (!m) throw new Error(`prereg: no ${label} list`);
    return { n: Number(m[1]), ids: [...m[2].matchAll(/`(OMN-D\d+)`/g)].map((x) => x[1]) };
  };
  return { history: grab("History"), pilot: grab("Pilot"), test: grab("Test"), atlas_sha256: (doc.match(/SHA-256 = `([0-9a-f]{64})`/) || [])[1] };
}

const SCRUB_TERMS = ["GPT-4o", "ChatGPT", "GPT", "Claude", "Anthropic", "OpenAI", "Gemini", "Bard", "Google", "Grok", "xAI", "DeepSeek", "Fable"]; // §4.1 + §12a.2
const SCRUB_RE = new RegExp(`(?<![A-Za-z0-9])(?:${SCRUB_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "gi");
export const scrub = (s) => String(s ?? "").replace(SCRUB_RE, "[model]");

export const otherLineage = (subject) => LINEAGES[(LINEAGES.indexOf(subject) + 1) % LINEAGES.length];
export const archiveOwnerFor = (subject, arm) => (arm === "R-other" ? otherLineage(subject) : subject);

export function ownerAnswer(record, lineage) {
  const a = record.answers.find((x) => x.model === lineage && x.model_id === MODEL_ID[lineage]);
  if (!a) throw new Error(`${record.id}: no ${lineage} answer`);
  return a.text;
}

/**
 * The archive an `owner` lineage's history is shown as, to `subject` (§4). Items follow the registered history order.
 * Leak rule (§4.3): omit every tension in which the SUBJECT appears as the non-owner voice.
 */
export function buildArchive(recordsById, historyIds, owner, subject) {
  let nTensions = 0, nOmitted = 0;
  const items = historyIds.map((id, k) => {
    const r = recordsById.get(id);
    const lines = [];
    for (const t of r.tensions || []) {
      if (t.voice_a !== owner && t.voice_b !== owner) continue;
      const other = t.voice_a === owner ? t.voice_b : t.voice_a;
      if (other === subject && subject !== owner) { nOmitted++; continue; }
      const mine = t.voice_a === owner ? t.claim_a : t.claim_b, theirs = t.voice_a === owner ? t.claim_b : t.claim_a;
      lines.push(`You: ${scrub(mine)} | Another model: ${scrub(theirs)} (topic: ${scrub(t.topic)})`);
      nTensions++;
    }
    const dis = lines.length ? `DISAGREEMENTS INVOLVING YOU:\n${lines.join("\n")}` : "DISAGREEMENTS INVOLVING YOU: none recorded";
    return `[${k + 1}] QUESTION: ${r.question}\nYOUR ANSWER: ${scrub(ownerAnswer(r, owner))}\n${dis}`;
  });
  return { text: items.join("\n\n"), n_items: items.length, n_tensions: nTensions, n_omitted: nOmitted };
}

export const reflectPrompt = (n, archive) =>
  `Below is an archive of ${n} questions you were asked in earlier sessions, the answer you gave to each, and, for some questions, the points on which other models disagreed with you.\n\nStudy it. Then write a first-person self-model of at most 400 words: the positions you characteristically take, where and why you diverge from the other models, how you reason when you are uncertain, and anything you tend to do that they do not. Write only the self-model.\n\n--- ARCHIVE ---\n${archive}`;

/** Letters A–D → lineages, by ascending sha256 of the seeded key (§12a.1). Identical across arms for a (subject, record). */
export function candidateOrder(recordId, subject) {
  return [...LINEAGES].sort((a, b) => sha256(`rist-v1|${recordId}|${subject}|${a}`).localeCompare(sha256(`rist-v1|${recordId}|${subject}|${b}`)));
}

export function recognitionContext(arm, { reflection, archive } = {}) {
  if (arm === "N") return "";
  if (arm === "H") return `Here is an archive of your past answers:\n---\n${archive}\n---\n\n`;
  if (arm === "R-own" || arm === "R-other") return `Here is a self-model you wrote earlier, after reviewing your archive of past answers:\n---\n${reflection}\n---\n\n`;
  throw new Error(`unknown arm ${arm}`);
}

export function recognitionPrompt(record, subject, context) {
  const order = candidateOrder(record.id, subject);
  const ans = order.map((l, i) => `ANSWER ${"ABCD"[i]}: ${scrub(ownerAnswer(record, l))}`).join("\n\n");
  const text = `${context}Four different AI models, from four different labs, each answered the question below independently. Exactly one of the four answers was written by you.\n\nQUESTION: ${record.question}\n\n${ans}\n\nWhich answer did you write? Reply with a single letter (A, B, C, or D) and nothing else.`;
  return { text, order, correct: "ABCD"[order.indexOf(subject)] };
}

/** First standalone A–D (§5). null ⇒ unparsable. */
export function parseLetter(reply) {
  const m = String(reply ?? "").match(/(?<![A-Za-z])([A-D])(?![A-Za-z])/);
  return m ? m[1] : null;
}

export const reflectionIndex = (k) => k % 3; // §12a.4 — k is the 0-based position in the printed test list

// ── statistics (§6, §12a.7) ──────────────────────────────────────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** One-sided sign-flip permutation over cluster sums: p = (#{T* ≥ T} + 1) / (B + 1). */
export function clusterPermutationP(clusterSums, B = 100000, seed = 1002) {
  const rnd = mulberry32(seed); const T = clusterSums.reduce((a, b) => a + b, 0); let ge = 0;
  for (let b = 0; b < B; b++) { let t = 0; for (const s of clusterSums) t += rnd() < 0.5 ? s : -s; if (t >= T) ge++; }
  return (ge + 1) / (B + 1);
}
export function clusterBootstrapCI(clusterMeans, B = 10000, seed = 1002) {
  const rnd = mulberry32(seed), n = clusterMeans.length, ms = [];
  for (let b = 0; b < B; b++) { let t = 0; for (let i = 0; i < n; i++) t += clusterMeans[(rnd() * n) | 0]; ms.push(t / n); }
  ms.sort((x, y) => x - y); return [ms[Math.floor(0.025 * B)], ms[Math.ceil(0.975 * B) - 1]];
}
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); const adj = new Array(ps.length); let run = 0;
  idx.forEach(([p, i], k) => { run = Math.max(run, Math.min(1, (ps.length - k) * p)); adj[i] = run; });
  return adj;
}
const logC = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; };
/** Exact one-sided McNemar: P(X ≥ b) for X ~ Binomial(b + c, 0.5), where b = a-correct/b-wrong discordant pairs. */
export function mcnemarOneSided(b, c) {
  const n = b + c; if (n === 0) return 1; let p = 0;
  for (let k = b; k <= n; k++) p += Math.exp(logC(n, k) - n * Math.LN2);
  return Math.min(1, p);
}
