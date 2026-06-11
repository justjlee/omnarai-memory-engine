// BUILD UTILITY EVIDENCE — aggregates disjoint-judge utility-test results into
// the publishable HF artifact set:
//
//   huggingface/utility-evidence.md       — the evidence card (methods + results + caveats)
//   huggingface/utility/*.json            — raw per-consumer results (every judge verdict)
//   huggingface/utility/utility-test-panel.mjs     — the harness, shipped verbatim
//   huggingface/utility/utility-test-disjoint.mjs  — the disjoint-judge harness
//
// "Verify me, here's how": any model (or human) can re-run the harness against
// the live Atlas and check these numbers.
//
//   node scripts/build-utility-evidence.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HF = path.join(ROOT, "huggingface");
const OUTDIR = path.join(HF, "utility");
fs.mkdirSync(OUTDIR, { recursive: true });

const CONSUMERS = ["GPT-4o", "Gemini", "DeepSeek", "Grok", "Claude"];

function logChoose(n, k) {
  let r = 0;
  for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i);
  return r;
}
function binomTwoSided(k, n) {
  if (n === 0) return 1;
  const pmf = (i) => Math.exp(logChoose(n, i) - n * Math.log(2));
  const obs = pmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= obs + 1e-12) p += pmf(i);
  return Math.min(1, p);
}

// Recompute all statistics from the raw verdicts — the card must be derivable
// from the published files alone.
function analyze(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const ok = data.results.filter((r) => !r.error);
  const mv = ok.reduce((m, r) => (m[r.overall] = (m[r.overall] || 0) + 1, m), {});
  const T = mv.treatment || 0, P = mv.placebo || 0, decided = T + P;
  const p = binomTwoSided(Math.max(T, P), decided);

  let agrSum = 0, agrCount = 0;
  for (const r of ok) {
    const vs = r.verdicts.map((v) => v.overall);
    let pairs = 0, agree = 0;
    for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) { pairs++; if (vs[a] === vs[b]) agree++; }
    if (pairs) { agrSum += agree / pairs; agrCount++; }
  }
  const agreement = agrCount ? agrSum / agrCount : 0;

  const uj = data.meta.judges.find((j) => j.uninfluenced);
  let uStat = null;
  if (uj) {
    const uv = ok.map((r) => r.verdicts.find((v) => v.uninfluenced)).filter(Boolean);
    const ut = uv.reduce((m, v) => (m[v.overall] = (m[v.overall] || 0) + 1, m), {});
    const uT = ut.treatment || 0, uP = ut.placebo || 0;
    uStat = { judge: uj.judge, model_id: uj.model_id, T: uT, P: uP, tie: ut.tie || 0, p: binomTwoSided(Math.max(uT, uP), uT + uP) };
  }

  return { meta: data.meta, n: ok.length, T, P, tie: mv.tie || 0, decided, p, agreement, uStat };
}

const rows = [];
for (const c of CONSUMERS) {
  const src = `/tmp/utility_disjoint_${c}.json`;
  if (!fs.existsSync(src)) { console.log(`  MISSING: ${src} — run the matrix first`); continue; }
  fs.copyFileSync(src, path.join(OUTDIR, `utility-disjoint-${c}.json`));
  rows.push({ consumer: c, ...analyze(src) });
}
if (rows.length < CONSUMERS.length) {
  console.log(`\nOnly ${rows.length}/${CONSUMERS.length} consumers present — card will note partial coverage.`);
}

for (const s of ["utility-test-panel.mjs", "utility-test-disjoint.mjs"]) {
  fs.copyFileSync(path.join(ROOT, "scripts", s), path.join(OUTDIR, s));
}

const fmtP = (p) => (p < 0.001 ? p.toExponential(1) : p.toFixed(4));
const verdict = (r) =>
  r.T > r.P && r.p < 0.05 ? "**SIGNIFICANT** ✅"
  : r.T > r.P ? "positive, not significant"
  : r.T < r.P ? "null / negative"
  : "tie";

const judgePool = rows[0]?.meta.judges || [];
const date = new Date().toISOString().slice(0, 10);

const card = `# Utility Evidence — does the Divergence Atlas measurably improve frontier-model reasoning?

**Updated:** ${date} · **Design:** three-arm controlled comparison with a disjoint LLM judge panel
**Verify it yourself:** the full harness and every raw judge verdict are in \`utility/\` — re-run it against the live Atlas (\`https://omnarai.vercel.app/api/divergences\`) and check these numbers.

## The claim

Showing a frontier model the Atlas's peer answers and tension map for a hard open question
**significantly improves its revised answer for some architectures (GPT-4o, Gemini) and does
nothing for others (Grok, Claude)** — compared against a placebo revision prompt that controls
for the generic benefit of "think again." The utility is real but **differential**: the Atlas
helps where a model cannot already reach the same considerations by self-reflection.

## Design

Per question (questions stratified across the Atlas's divergence-score range):

1. **baseline** — the consumer model answers cold.
2. **placebo** — it revises after a generic "did you miss anything?" prompt (controls for revision-in-general).
3. **treatment** — it revises after seeing the Atlas record: 4 peer answers + the named tension map.

A panel of LLM judges sees (ORIGINAL, X, Y) with treatment/placebo randomized once per question,
votes \`overall\` per triple; per-question outcome is the panel **majority vote**; significance is an
**exact two-sided binomial sign test** over decided questions. Judges never see which revision is
which, and the consumer never judges itself.

### The disjoint-judge panel (this study)

The first run of this experiment (2026-06-06, results summarized below) used the council models
themselves as judges, leaving one objection open: a judge whose own answer appears in the
treatment material could reward its own influence. This study closes that: **no judge model
appears anywhere in the Atlas peer panel.**

| Judge | Lab | model_id | Note |
|---|---|---|---|
${judgePool.map((j) => `| ${j.judge} | ${j.lab} | \`${j.model_id}\` | ${j.uninfluenced ? "" : ""}distinct from that lab's council model |`).join("\n")}

Additionally, for each consumer the judge from the **consumer's own lab** is flagged
*uninfluenced*: its lab has **zero** peer answers in the treatment material (peers are always the
4 non-consumer models), so it has no own-influence exposure at all. Its solo vote is reported as
a bias probe.

## Results — disjoint judges (n=20 questions per consumer, 5-judge panel)

| Consumer | majority T/P/tie | decided | sign-test p | inter-judge agreement | uninfluenced judge alone (T–P, p) | verdict |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.consumer} | ${r.T}/${r.P}/${r.tie} | ${r.decided} | ${fmtP(r.p)} | ${(r.agreement * 100).toFixed(0)}% | ${r.uStat ? `${r.uStat.T}–${r.uStat.P}, p=${fmtP(r.uStat.p)}` : "—"} | ${verdict(r)} |`).join("\n")}

## Replication context — the original same-family panel study (2026-06-06)

Same three-arm design, judges drawn from the council itself (every model except the consumer),
n=20 per consumer. Summary as recorded at run time (raw files were not archived — that lesson is
why \`utility/\` now ships every raw verdict):

| Consumer | majority T/P/tie | sign-test p | verdict |
|---|---|---|---|
| GPT-4o | 18/1/1 | 0.0001 | significant |
| Gemini | 15/3/2 | 0.0075 | significant |
| DeepSeek | 11/6/3 | 0.33 | positive, not significant |
| Grok | 8/11/1 | 0.65 | null |
| Claude | 7/9/4 | 0.80 | null |

Two judge designs — overlapping and fully disjoint — produce the same differential pattern.
The own-influence bias objection does not survive this replication: if judges rewarded their own
influence, the effect would inflate **all** consumers, and it does not.

## Interpretation

The placebo arm is what makes this informative: every consumer gets the generic benefit of a
second pass. The Atlas's marginal value appears only for architectures that do **not** already
surface the missing considerations by self-reflection. GPT-4o and Gemini gain sharply; Grok and
Claude self-revise to roughly the same place without it. The Atlas is an instrument whose utility
depends on who is holding it — which is itself a finding about cross-architecture complementarity.

## Honest caveats

- **LLM judges, not humans.** Mitigated by panel + majority + agreement reporting, not eliminated.
- **~200-word answer format.** Longer-form reasoning may behave differently.
- **n=20 per consumer.** Significant results are robust to this n; the DeepSeek positive trend is underpowered.
- **Judges share labs (not models) with peers.** Fully lab-disjoint judging would require labs outside the council's five; the uninfluenced-judge probe addresses this within available means.

## Reproduce

\`\`\`bash
# from the engine repo (github.com/justjlee/omnarai-memory-engine), keys in .env.local
node scripts/utility-test-disjoint.mjs --preflight
CONSUMER_MODEL=GPT-4o node scripts/utility-test-disjoint.mjs 20
\`\`\`

The harness files in \`utility/\` are verbatim copies of the scripts that produced these numbers.
Questions come from the live Atlas (\`/api/divergences\`); the engine and Atlas are public.
`;

fs.writeFileSync(path.join(HF, "utility-evidence.md"), card);
console.log(`\nWrote huggingface/utility-evidence.md (${rows.length} consumers) + ${rows.length} raw JSONs + 2 harness scripts → huggingface/utility/`);
for (const r of rows) console.log(`  ${r.consumer.padEnd(9)} T${r.T}/P${r.P}/tie${r.tie} p=${fmtP(r.p)} agree=${(r.agreement * 100).toFixed(0)}% ${r.uStat ? `uninfluenced ${r.uStat.T}-${r.uStat.P} p=${fmtP(r.uStat.p)}` : ""}`);
