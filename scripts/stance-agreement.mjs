#!/usr/bin/env node
// Phase 5 gate: is the derived-stance labelling robust to WHO labels it?
//
// The 833 derived positions (analysis/stance-run-2026-09-30.json, stance-extract/0.2) were all
// labelled by ONE model (claude-haiku-4-5). docs/OMNARAI-FOOTPRINT-PROTOCOL.md §6 and the Phase 5 plan
// say bulk adoption waits on a sample "checked by curator / multiple models". Nothing was ever
// checked, and a single Anthropic labeller reading answers by Claude, GPT, Gemini, Grok and DeepSeek
// could be biased in ways nobody can see (e.g. reading its own lineage more charitably).
//
// This re-labels a seeded, lineage-stratified sample with OTHER labellers using the IDENTICAL
// extractor prompt and the IDENTICAL grounding guard, then reports: agreement and Cohen's kappa vs the
// original, Fleiss' kappa across all labellers, per-stance and per-answer-lineage agreement, a
// self-lineage test (does a labeller agree more with the original on answers from its own lineage?), and
// the answers where labellers disagree (the ones a human most needs to look at).
//
// It NEVER writes to the Blob store and never modifies a derived position. Output is a local report.
// SPENDS MONEY (≈ $1–2 for 100 answers × 4 labellers). PLAN mode (default) prints the estimate.
//
//   node scripts/stance-agreement.mjs                                  # plan: sample + cost, no model call
//   ANTHROPIC_API_KEY=… OPENAI_API_KEY=… GEMINI_API_KEY=… DEEPSEEK_API_KEY=… \
//     node scripts/stance-agreement.mjs --run --yes --per-lineage 20 --out /tmp/stance-agreement.json
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EXTRACTION_SYSTEM, extractionUserMessage, groundClassification } from "./lib/stance-extract.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const RUN = args.includes("--run"), YES = args.includes("--yes");
const DERIVED = val("--derived", `${ROOT}analysis/stance-run-2026-09-30.json`);
const BASE = (val("--base", "https://engine.omnarai.org")).replace(/\/+$/, "");
const PER = Number(val("--per-lineage", 20));
const OUT = val("--out");
const MD = val("--md");
const LABELLERS = (val("--labellers", "claude-haiku-4-5,gpt-4o,gemini-2.5-flash,deepseek-chat,claude-sonnet-4-6")).split(",").map((s) => s.trim());
const MAIN_LINEAGES = ["anthropic-claude", "openai-gpt", "google-gemini", "xai-grok", "deepseek"];
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROVIDERS = {
  "gpt-4o": { lineage: "openai-gpt", provider: "openai", env: "OPENAI_API_KEY", usd: [2.5, 10] },
  "gemini-2.5-flash": { lineage: "google-gemini", provider: "gemini", env: "GEMINI_API_KEY", usd: [0.3, 2.5] },
  "deepseek-chat": { lineage: "deepseek", provider: "deepseek", env: "DEEPSEEK_API_KEY", usd: [0.27, 1.1] },
  "claude-sonnet-4-6": { lineage: "anthropic-claude", provider: "anthropic", env: "ANTHROPIC_API_KEY", usd: [3, 15] },
  // The ORIGINAL labeller, run again: a control. If claude-haiku-4-5 disagrees with ITSELF at temperature 0, label
  // disagreement says little about lineage and a lot about how unstable single-answer stance labelling is.
  "claude-haiku-4-5": { lineage: "anthropic-claude", provider: "anthropic", env: "ANTHROPIC_API_KEY", usd: [1, 5] },
  "grok-4.3": { lineage: "xai-grok", provider: "xai", env: "XAI_API_KEY", usd: [3, 15] },
};

async function fetchJSON(url) { const r = await fetch(url, { headers: { "x-omnarai-self": "1" } }); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json(); }

async function classify(label, question, answer) {
  const P = PROVIDERS[label]; const key = process.env[P.env];
  const user = extractionUserMessage(question, answer);
  for (let t = 0; t < 4; t++) {
    let res, data, text;
    if (P.provider === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: label, max_tokens: 400, temperature: 0, system: EXTRACTION_SYSTEM, messages: [{ role: "user", content: user }] }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2500 * (t + 1)); continue; }
      data = await res.json(); if (data.error) throw new Error(data.error.message);
      text = data.content?.[0]?.text || "";
    } else if (P.provider === "gemini") {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${label}:generateContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0, maxOutputTokens: 2000 } }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2500 * (t + 1)); continue; }
      data = await res.json(); if (data.error) throw new Error(data.error.message);
      text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    } else {
      const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[P.provider];
      res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: label, temperature: 0, max_tokens: 400, messages: [{ role: "system", content: EXTRACTION_SYSTEM }, { role: "user", content: user }] }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2500 * (t + 1)); continue; }
      data = await res.json(); if (data.error) throw new Error(data.error.message || "provider error");
      text = data.choices?.[0]?.message?.content || "";
    }
    try { return JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch { return null; }
  }
  throw new Error("retries exhausted");
}

// ── statistics ───────────────────────────────────────────────────────────────
function cohenKappa(a, b) {
  const n = a.length; if (!n) return null;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
function fleissKappa(rows) { // rows: array of arrays of labels (same raters per row)
  const N = rows.length, n = rows[0].length;
  const cats = [...new Set(rows.flat())];
  const Pi = rows.map((r) => (cats.reduce((s, c) => { const k = r.filter((x) => x === c).length; return s + k * (k - 1); }, 0)) / (n * (n - 1)));
  const Pbar = Pi.reduce((s, x) => s + x, 0) / N;
  const pj = cats.map((c) => rows.reduce((s, r) => s + r.filter((x) => x === c).length, 0) / (N * n));
  const Pe = pj.reduce((s, p) => s + p * p, 0);
  return Pe === 1 ? 1 : (Pbar - Pe) / (1 - Pe);
}
const pct = (x) => (x == null ? "n/a" : `${(100 * x).toFixed(0)}%`);

// ── sample ───────────────────────────────────────────────────────────────────
const derived = JSON.parse(readFileSync(DERIVED, "utf8")).derived_positions;
const byLineage = new Map();
for (const d of derived) { const l = d.actor.lineage_id; if (!MAIN_LINEAGES.includes(l)) continue; (byLineage.get(l) || byLineage.set(l, []).get(l)).push(d); }
const sample = [];
for (const l of MAIN_LINEAGES) {
  const arr = (byLineage.get(l) || []).slice().sort((a, b) => sha256(a.primary_text_ref).localeCompare(sha256(b.primary_text_ref)));
  sample.push(...arr.slice(0, PER));
}
const avgChars = 1500 * 4; // ≈ the extractor's 1.3k-token request
const estUsd = LABELLERS.reduce((s, l) => s + sample.length * ((avgChars / 4) * PROVIDERS[l].usd[0] + 220 * PROVIDERS[l].usd[1]) / 1e6, 0);
console.log(`sample: ${sample.length} derived positions (${PER} per lineage, seeded by answer-id hash) from ${derived.length}`);
console.log(`labellers: ${LABELLERS.join(", ")}  → est. up to ~$${estUsd.toFixed(2)}`);
if (!RUN) { console.log("PLAN only. Add --run --yes to spend."); process.exit(0); }
if (!YES) { console.error("Refusing to spend without --yes."); process.exit(2); }
for (const l of LABELLERS) if (!process.env[PROVIDERS[l].env]) { console.error(`missing ${PROVIDERS[l].env} for ${l}`); process.exit(1); }

// ── answer text, verified identical to what the original labeller saw ─────────
const recCache = new Map();
async function answerFor(d) {
  const [recId, idx] = d.primary_text_ref.split("#a");
  if (!recCache.has(recId)) recCache.set(recId, await fetchJSON(`${BASE}/api/divergences?id=${encodeURIComponent(recId)}`));
  const rec = recCache.get(recId);
  const a = rec.answers?.[Number(idx)];
  return { question: rec.question, text: a?.text || "", ok: a && sha256(a.text || "") === d.derivation.source_text_sha256 };
}
const items = [];
for (const d of sample) { const a = await answerFor(d); if (a.ok) items.push({ d, ...a }); }
console.log(`answer text verified identical (sha256) for ${items.length}/${sample.length}`);

// ── label ────────────────────────────────────────────────────────────────────
const labels = {}; // labeller → Map(ref → grounded)
let done = 0, errors = 0;
async function labelAll(label) {
  const m = new Map(); labels[label] = m;
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < items.length) {
      const it = items[i++];
      try { const raw = await classify(label, it.question, it.text); m.set(it.d.primary_text_ref, groundClassification(it.text, raw)); }
      catch (e) { errors++; m.set(it.d.primary_text_ref, { stance: "unclear", guard: "labeller-error", error: String(e.message).slice(0, 100) }); }
      done++;
    }
  }));
}
await Promise.all(LABELLERS.map(labelAll));
console.log(`labelled ${done} (errors ${errors})`);

// ── analyse ──────────────────────────────────────────────────────────────────
const ref = (it) => it.d.primary_text_ref;
const orig = items.map((it) => it.d.stance);
const report = { run_at: new Date().toISOString(), extractor: "stance-extract/0.2 prompt + grounding guard, identical for every labeller", original_labeller: "claude-haiku-4-5", n: items.length, per_lineage: PER, labellers: {}, fleiss_kappa_all: null, robust: {}, contested: [] };
for (const L of LABELLERS) {
  const lab = items.map((it) => labels[L].get(ref(it)).stance);
  const agree = lab.filter((x, i) => x === orig[i]).length / items.length;
  const perLin = {};
  for (const lin of MAIN_LINEAGES) { const idx = items.map((it, i) => (it.d.actor.lineage_id === lin ? i : -1)).filter((i) => i >= 0); perLin[lin] = idx.length ? idx.filter((i) => lab[i] === orig[i]).length / idx.length : null; }
  const own = PROVIDERS[L].lineage;
  const ownIdx = items.map((it, i) => (it.d.actor.lineage_id === own ? i : -1)).filter((i) => i >= 0);
  const otherIdx = items.map((_, i) => i).filter((i) => !ownIdx.includes(i));
  const rate = (idx) => (idx.length ? idx.filter((i) => lab[i] === orig[i]).length / idx.length : null);
  const dist = {}; lab.forEach((x) => (dist[x] = (dist[x] || 0) + 1));
  const guarded = items.filter((it) => labels[L].get(ref(it)).guard).length;
  report.labellers[L] = { raw_agreement_with_original: agree, cohen_kappa_vs_original: cohenKappa(orig, lab), agreement_by_answer_lineage: perLin, own_lineage_agreement: rate(ownIdx), other_lineage_agreement: rate(otherIdx), own_lineage_n: ownIdx.length, stance_distribution: dist, grounding_guard_triggered: guarded };
}
// Coarse groups: do labellers at least agree on the KIND of stance? (directional / qualified / other)
const GROUP = { support: "directional", oppose: "directional-opp", conditional: "qualified", mixed: "qualified", uncertain: "qualified", reframe: "other", abstain: "other", unclear: "other" };
const coarse = (x) => GROUP[x] || "other";
const rows = items.map((it) => [it.d.stance, ...LABELLERS.map((L) => labels[L].get(ref(it)).stance)]);
report.fleiss_kappa_all = fleissKappa(rows);
report.coarse_note = "groups: directional=support, directional-opp=oppose (kept apart so a support↔oppose flip is never hidden), qualified=conditional|mixed|uncertain, other=reframe|abstain|unclear";
for (const L of LABELLERS) {
  const lab = items.map((it) => labels[L].get(ref(it)).stance);
  report.labellers[L].coarse_agreement_with_original = items.filter((_, i) => coarse(lab[i]) === coarse(orig[i])).length / items.length;
  report.labellers[L].coarse_cohen_kappa = cohenKappa(orig.map(coarse), lab.map(coarse));
}
report.fleiss_kappa_coarse = fleissKappa(rows.map((r) => r.map(coarse)));
// confusion of the original label vs the consensus of the OTHER labellers (plurality), to see where the disagreement lives
const conf = {};
rows.forEach((r) => { const others = r.slice(1); const cnt = {}; others.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1)); const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]; const k = `${r[0]} → ${top}`; conf[k] = (conf[k] || 0) + 1; });
report.original_vs_plurality_of_others = Object.fromEntries(Object.entries(conf).sort((a, b) => b[1] - a[1]));
report.items = items.map((it, i) => ({ answer: ref(it), lineage: it.d.actor.lineage_id, model_id: it.d.actor.model_id, original: rows[i][0], labels: Object.fromEntries(LABELLERS.map((L, j) => [L, { stance: rows[i][j + 1], confidence: labels[L].get(ref(it)).confidence ?? null, guard: labels[L].get(ref(it)).guard || null, span: labels[L].get(ref(it)).evidence_span || null, rationale: labels[L].get(ref(it)).rationale || null }])), original_span: it.d.derivation.evidence_span, question: it.question }));
const origDist = {}; orig.forEach((x) => (origDist[x] = (origDist[x] || 0) + 1)); report.original_distribution = origDist;
const nRaters = LABELLERS.length + 1;
const topCount = rows.map((r) => Math.max(...[...new Set(r)].map((c) => r.filter((x) => x === c).length)));
report.robust = { all_agree: topCount.filter((c) => c === nRaters).length, at_least_n_minus_1_agree: topCount.filter((c) => c >= nRaters - 1).length, majority_agree: topCount.filter((c) => c > nRaters / 2).length, no_majority: topCount.filter((c) => c <= nRaters / 2).length, of: items.length };
// directional-vs-not coarse agreement (the distinction Concordance leans on most)
const DIR = new Set(["support", "oppose"]);
report.coarse_support_oppose_flips = items.filter((it, i) => { const set = new Set(rows[i].filter((x) => DIR.has(x))); return set.size > 1; }).length;
report.contested = items.map((it, i) => ({ answer: ref(it), lineage: it.d.actor.lineage_id, labels: Object.fromEntries([["claude-haiku-4-5 (original)", rows[i][0]], ...LABELLERS.map((L, j) => [L, rows[i][j + 1]])]), agreeing: topCount[i], span: it.d.derivation.evidence_span, question: it.question }))
  .filter((x) => x.agreeing <= nRaters - 2).sort((a, b) => a.agreeing - b.agreeing).slice(0, 40);

console.log(`\nFleiss kappa across ${nRaters} labellers: ${report.fleiss_kappa_all.toFixed(2)}`);
for (const L of LABELLERS) { const r = report.labellers[L]; console.log(`${L.padEnd(18)} agree ${pct(r.raw_agreement_with_original)}  kappa ${r.cohen_kappa_vs_original?.toFixed(2)}  own-lineage ${pct(r.own_lineage_agreement)} (n=${r.own_lineage_n}) vs other ${pct(r.other_lineage_agreement)}`); }
console.log(`coarse (directional/opposed/qualified/other) Fleiss kappa: ${report.fleiss_kappa_coarse.toFixed(2)}; per labeller coarse agreement: ${LABELLERS.map((L) => `${L} ${pct(report.labellers[L].coarse_agreement_with_original)}`).join(", ")}`);
console.log(`robust: all agree ${report.robust.all_agree}/${items.length}; >= n-1 agree ${report.robust.at_least_n_minus_1_agree}; majority ${report.robust.majority_agree}; no majority ${report.robust.no_majority}; support↔oppose conflicts ${report.coarse_support_oppose_flips}`);
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
if (MD) {
  const L = ["# Derived-stance cross-labeller check", "", `${items.length} answers, ${nRaters} labellers (original: claude-haiku-4-5). Fleiss kappa ${report.fleiss_kappa_all.toFixed(2)}.`, "", "| answer | lineage | labels | agree | evidence span |", "|---|---|---|---|---|"];
  for (const c of report.contested) L.push(`| ${c.answer} | ${c.lineage} | ${Object.entries(c.labels).map(([k, v]) => `${k.split(" ")[0]}: **${v}**`).join(" · ")} | ${c.agreeing}/${nRaters} | ${(c.span || "—").replace(/\|/g, "/").slice(0, 160)} |`);
  writeFileSync(MD, L.join("\n"));
}
