// UTILITY ABLATION — what carries the Atlas's lift: raw peer answers, or our
// synthesized tension map? Three revision arms per question, blind-judge ranked:
//   placebo : generic "did you miss anything?" (no new content)  — control
//   peers   : verbatim peer answers only (no synthesis)
//   synth   : the structured tension map only (no verbatim answers)
// Reading: peers≫synth → raw divergence carries it (synthesis loses signal);
//          synth≫peers → our distillation IS the product; tie → synth = good compression.
//
//   CONSUMER_MODEL=GPT-4o JUDGE_MODEL=Claude node scripts/utility-ablation.mjs [N]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { COUNCIL } = await import("../api/_council.js");
const { loadGrownMemory } = await import("../api/_grown.js");

const N = parseInt(process.argv[2] || "15", 10);
const CONSUMER = COUNCIL.find((m) => m.model === (process.env.CONSUMER_MODEL || "GPT-4o"));
const JUDGE = COUNCIL.find((m) => m.model === (process.env.JUDGE_MODEL || "Claude"));
if (CONSUMER.model === JUDGE.model) throw new Error("consumer and judge must differ");
const CONCURRENCY = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callModel(member, system, user, { maxTokens = 700, tries = 5 } = {}) {
  for (let t = 0; t < tries; t++) {
    try {
      if (member.provider === "anthropic") {
        const c = new Anthropic();
        const r = await c.messages.create({ model: member.model_id, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
        return r.content[0]?.text || "";
      }
      if (member.provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${member.model_id}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens + 400, thinkingConfig: { thinkingBudget: 0 } } }) });
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
        const d = await res.json();
        return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      }
      const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[member.provider];
      const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env[member.env]}` }, body: JSON.stringify({ model: member.model_id, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      const d = await res.json();
      return d.choices?.[0]?.message?.content || "";
    } catch (e) { if (t === tries - 1) throw e; await sleep(1500 * (t + 1)); }
  }
  throw new Error("exhausted retries");
}

const ANSWER_SYS = "You are answering a hard, open question with no settled answer. Give your honest, reasoned position in about 200 words. Take a stance where you hold one; name genuine uncertainty plainly. Be concrete.";
const REVISE_SYS = "You are revising your own earlier answer to a hard question. Output ONLY your revised answer (about 200 words), written as a clean standalone response. Do not reference the revision process or any material you were shown.";

const placeboU = (q, a1) => `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nRe-examine it. Are there perspectives, considerations, or counterarguments you may have missed? Then give your revised answer.`;
const peersU = (q, a1, peers) => `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nOther frontier AI models answered the same question. Their answers:\n\n${peers.map((p) => `— ${p.model}: ${p.text}`).join("\n\n")}\n\nRe-examine your earlier answer in light of these. Integrate any genuinely useful considerations. Then give your revised answer.`;
const synthU = (q, a1, tensions) => `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nAn analysis of how a panel of frontier models diverged on this question identified these tensions:\n${tensions.length ? tensions.map((t) => `• ${t.topic}: one position — ${t.claim_a}; opposing — ${t.claim_b}`).join("\n") : "(none)"}\n\nRe-examine your earlier answer in light of these tensions. Integrate any genuinely useful considerations. Then give your revised answer.`;

const JUDGE_SYS = `You are an impartial evaluator. You see a hard question, an ORIGINAL first-pass answer, and THREE revised answers (REVISION_X, REVISION_Y, REVISION_Z) in random order. Judge ONLY on substance. Output strict JSON:
{"overall_rank":["best","mid","worst"],"surfaces_new":"X|Y|Z","calibration":"X|Y|Z","reason":"one sentence"}
- overall_rank: the three labels (X/Y/Z) ordered best to worst as answers to the question.
- surfaces_new: which best introduces substantive considerations ABSENT from the original.
- calibration: which best acknowledges genuine, hard disagreement instead of false confidence.`;
const extractJSON = (s) => { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };

const grown = await loadGrownMemory();
let recs = grown.entries.filter((e) => e.type === "divergence" && e.divergence?.answers?.length >= 4
  && e.divergence.answers.some((a) => a.model === CONSUMER.model) && (e.divergence.tensions || []).length >= 1);
recs.sort((a, b) => (a.divergence.score ?? 0) - (b.divergence.score ?? 0));
const pick = [];
for (let i = 0; i < N; i++) pick.push(recs[Math.floor(i * (recs.length - 1) / (N - 1))]);
console.log(`Ablation · consumer ${CONSUMER.model} · judge ${JUDGE.model} · ${pick.length} questions`);

async function runOne(rec) {
  const q = rec.divergence.question;
  const peers = rec.divergence.answers.filter((a) => a.model !== CONSUMER.model);
  try {
    const a1 = (await callModel(CONSUMER, ANSWER_SYS, q)).trim();
    const [placebo, peersR, synthR] = await Promise.all([
      callModel(CONSUMER, REVISE_SYS, placeboU(q, a1)),
      callModel(CONSUMER, REVISE_SYS, peersU(q, a1, peers)),
      callModel(CONSUMER, REVISE_SYS, synthU(q, a1, rec.divergence.tensions || [])),
    ]);
    const arms = [["placebo", placebo.trim()], ["peers", peersR.trim()], ["synth", synthR.trim()]];
    for (let i = arms.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arms[i], arms[j]] = [arms[j], arms[i]]; }
    const labels = ["X", "Y", "Z"];
    const lab2arm = {}; arms.forEach(([arm], i) => lab2arm[labels[i]] = arm);
    const judgeUser = `QUESTION:\n"${q}"\n\nORIGINAL:\n${a1}\n\n` + arms.map(([, txt], i) => `REVISION_${labels[i]}:\n${txt}`).join("\n\n");
    const v = extractJSON(await callModel(JUDGE, JUDGE_SYS, judgeUser, { maxTokens: 400 }));
    if (!v || !Array.isArray(v.overall_rank)) return { id: rec.id, error: "judge parse" };
    return {
      id: rec.id, score: rec.divergence.score,
      rank: v.overall_rank.map((l) => lab2arm[l]).filter(Boolean),
      surfaces_new: lab2arm[v.surfaces_new], calibration: lab2arm[v.calibration],
    };
  } catch (e) { return { id: rec.id, error: String(e?.message || e).slice(0, 100) }; }
}

const results = [];
for (let i = 0; i < pick.length; i += CONCURRENCY) {
  const r = await Promise.all(pick.slice(i, i + CONCURRENCY).map(runOne));
  for (const x of r) console.log(x.error ? `  ✗ ${x.id} ${x.error}` : `  ${x.id} rank=${x.rank.join(">")} new=${x.surfaces_new} cal=${x.calibration}`);
  results.push(...r);
}

// ── aggregate ────────────────────────────────────────────────────────────────
const ok = results.filter((r) => !r.error && r.rank?.length === 3);
const firsts = { placebo: 0, peers: 0, synth: 0 };
const pair = { "peers>placebo": 0, "synth>placebo": 0, "peers>synth": 0, n: ok.length };
const beats = (r, a, b) => r.rank.indexOf(a) < r.rank.indexOf(b);
for (const r of ok) {
  firsts[r.rank[0]]++;
  if (beats(r, "peers", "placebo")) pair["peers>placebo"]++;
  if (beats(r, "synth", "placebo")) pair["synth>placebo"]++;
  if (beats(r, "peers", "synth")) pair["peers>synth"]++;
}
const newTally = ok.reduce((m, r) => (m[r.surfaces_new] = (m[r.surfaces_new] || 0) + 1, m), {});
fs.writeFileSync(`/tmp/ablation_${CONSUMER.model}_by_${JUDGE.model}.json`.replace(/[^\w.\-/]/g, "_"), JSON.stringify(results, null, 2));
console.log(`\n=== ABLATION (n=${ok.length}, consumer=${CONSUMER.model}, judge=${JUDGE.model}) ===`);
console.log(`  1st-place finishes:  peers ${firsts.peers} · synth ${firsts.synth} · placebo ${firsts.placebo}`);
console.log(`  peers beats placebo: ${pair["peers>placebo"]}/${pair.n}`);
console.log(`  synth beats placebo: ${pair["synth>placebo"]}/${pair.n}`);
console.log(`  peers beats synth:   ${pair["peers>synth"]}/${pair.n}`);
console.log(`  surfaces-new winner: peers ${newTally.peers || 0} · synth ${newTally.synth || 0} · placebo ${newTally.placebo || 0}`);
