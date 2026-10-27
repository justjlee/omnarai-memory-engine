#!/usr/bin/env node
// RUN A BATCH — the only way a question is asked or a record certified (design DL-0020, method DL-0005).
//
// A batch lives in public/batches.json. It runs only when the curator approved it in the decision log
// (status "approved", approved_in: DL-NNNN that exists in governance/decision-log.md), its estimate sits under the $25
// wall, and every item is still eligible (elicitation: a registered question nobody has asked; certification: a record
// in the certification queue). Anything else is refused before a single call is made.
//
//   node scripts/run-batch.mjs --batch elicit-001 --plan                      check + estimate, no spend
//   node scripts/run-batch.mjs --batch elicit-001 --yes --env-file .env.local  run (reserves the estimate on the ledger)
//
// Elicitation asks each question with the council exactly as the daily run does (elicit → synthesize → build → embed →
// append), stores nothing when a panel voice is missing, and refuses to store a record whose question does not hash to
// the registered id. Certification runs scripts/certify-divergence.mjs one record at a time: the ×3 strict-min battery,
// written onto the live record, priced from provider usage. Both stop before the item that would cross the wall, then write
// status "run", the actual spend and what was created back into public/batches.json for a commit and a deploy.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { costUsd, tokensFor } from "./lib/model-prices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINE = process.env.OMNARAI_ENGINE || "https://engine.omnarai.org";
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const has = (f) => args.includes(f);
const die = (m, code = 1) => { console.error(m); process.exit(code); };

// Atlas records as the engine holds them ({id, date, divergence:{question, answers, certification}}), read over the
// public API (read-only, free) so the check sees exactly what is live.
export async function fetchAtlas(base = ENGINE) {
  const get = async (u) => { const r = await fetch(u, { headers: { "x-omnarai-self": "1" } }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json(); };
  const idx = await get(`${base}/api/divergences`);
  const out = [];
  for (let i = 0; i < idx.records.length; i += 8) {
    const chunk = await Promise.all(idx.records.slice(i, i + 8).map((r) => get(`${base}/api/divergences?id=${encodeURIComponent(r.id)}`)));
    out.push(...chunk.map((d) => ({ id: d.id, date: d.date, divergence: { question: d.question, answers: d.answers, certification: d.certification } })));
  }
  return out;
}

// What one council run cost, from the texts actually exchanged, at list prices (≈4 characters per token, rounded up).
// The council call returns no provider usage, so this is the measurement batch one uses to set the per-question price.
// A model with no price on file falls back to the batch's per-item estimate share, and says so.
export function councilRunUsd(question, answers, synthesisText, { synthModel = "claude-sonnet-4-6", fallbackUsd = 0 } = {}) {
  let usd = 0;
  const unpriced = [];
  for (const a of answers.filter((x) => x.ok)) {
    try { usd += costUsd(a.model_id, tokensFor(question.length + 600), tokensFor(a.text.length)); } catch { unpriced.push(a.model_id); }
  }
  const synthIn = question.length + answers.reduce((n, a) => n + (a.text || "").length, 0) + 1500;
  try { usd += costUsd(synthModel, tokensFor(synthIn), tokensFor((synthesisText || "").length)); } catch { unpriced.push(synthModel); }
  if (unpriced.length) usd += fallbackUsd * unpriced.length / Math.max(1, answers.length + 1);
  return { usd: +usd.toFixed(5), unpriced };
}

// Panel rule (design §3): a batch runs on its full panel or not at all. The voices of `panel` that did not answer.
export function missingVoices(panel, answers) {
  return panel.filter((m) => !answers.some((a) => a.ok && a.model === m));
}

// Certification is the ×3 strict-min battery (design §2, the method of the tested records), written onto the live
// records, reserved once by the batch rather than again per record, and reporting what it actually used.
export const CERT_RUNS = 3;
export const certifyArgs = (batchId, recordId, reportFile) =>
  ["--ids", recordId, "--runs", String(CERT_RUNS), "--write", "--reserved-by", `batch ${batchId}`, "--report-out", reportFile];

// One record's outcome from certify-divergence.mjs's report: certified and written, priced from provider usage.
// Without a report (the script died early) the spend is unknown, so the item is charged its estimate and says so.
export function certOutcome(report, recordId, perItemUsd) {
  if (!report) return { ok: false, usd: perItemUsd, usd_basis: "estimate: no usage report", created: null, error: "certify wrote no report" };
  const cert = (report.certified || []).find((c) => c.id === recordId);
  const ok = !!cert && report.write === true && Number(report.written) >= 1;
  const u = report.usage || {};
  const basis = "provider-reported tokens × list prices" + (u.unpriced?.length ? `; no price on file for ${u.unpriced.join(", ")}` : "") + (u.no_usage ? `; ${u.no_usage} response(s) reported no usage` : "");
  return {
    ok, usd: Number(u.usd) || 0, usd_basis: basis, method: report.method, tier: cert?.tier ?? null, created: ok ? recordId : null,
    ...(ok ? {} : { error: cert ? "certified but not written to the live record" : ((report.failed || []).find((f) => f.id === recordId)?.error || "not certified") }),
  };
}

// Runs the items in order and stops before the one whose estimate would cross the wall. `step(item)` returns
// {ok, usd, created?, error?}. Pure orchestration, so the wall and the bookkeeping are testable without spend.
export async function runItems(items, { perItemUsd, wallUsd, step }) {
  const results = [];
  let spent = 0;
  for (const item of items) {
    if (spent + perItemUsd > wallUsd + 1e-9) { results.push({ item, skipped: "wall" }); continue; }
    const r = await step(item);
    spent += Number(r.usd) || 0;
    results.push({ item, ...r });
  }
  return { results, spent_usd: +spent.toFixed(4) };
}

async function main() {
  const R = await import("../api/_registered.js");
  const batches = JSON.parse(readFileSync(join(ROOT, "public/batches.json"), "utf8"));
  const batch = batches.batches.find((b) => b.id === val("--batch"));
  if (!batch) die(`No batch "${val("--batch")}" in public/batches.json.`, 2);
  const registry = JSON.parse(readFileSync(join(ROOT, "public/registered-questions.json"), "utf8"));
  const decisionLog = readFileSync(join(ROOT, "governance/decision-log.md"), "utf8");
  const divRecords = await fetchAtlas();
  const problems = R.batchProblems(batch, { registry, divRecords, decisionLog });
  const perItem = batch.estimate_usd / batch.items.length;
  console.log(JSON.stringify({ batch: batch.id, kind: batch.kind, status: batch.status, items: batch.items.length, estimate_usd: batch.estimate_usd, per_item_usd: +perItem.toFixed(3), wall_usd: R.HARD_WALL_USD, runnable: !problems.length, problems }, null, 1));
  if (problems.length) die("REFUSED: this batch may not run. Nothing was spent.");
  if (has("--plan")) return;
  if (!has("--yes")) die("This spends real money. Run --plan, then re-run with --yes.", 2);

  // Keys come from the file named on the command line, never from the ambient environment.
  for (const line of readFileSync(val("--env-file") || join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const reserve = Math.ceil(2 * batch.estimate_usd);
  const pre = spawnSync(process.execPath, [join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(reserve), "--label", `batch ${batch.id}`], { stdio: "inherit", env: process.env });
  if (pre.status !== 0) die("The budget preflight refused the reservation. Nothing was spent.");

  let step;
  if (batch.kind === "elicitation") {
    const { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } = await import("../api/_council.js");
    const { appendGrownEntry } = await import("../api/_grown.js");
    const { questionIdFor } = await import("../api/_footprints.js");
    const byId = new Map(registry.questions.map((q) => [q.id, q]));
    step = async (item) => {
      const q = byId.get(item.question_id);
      const answers = await elicitCouncil(q.text, { timeoutMs: 45000 });
      const missing = missingVoices(batch.panel || R.FULL_PANEL, answers);
      if (missing.length) {
        const spent = councilRunUsd(q.text, answers, "", { fallbackUsd: perItem });
        return { ok: false, usd: spent.usd, usd_basis: "list prices × measured text length", error: `ragged panel (${missing.join(", ")} did not answer): nothing stored; a batch runs on its full panel or not at all` };
      }
      const synthesis = await synthesizeCouncil(q.text, answers);
      const record = buildDivergenceRecord(q.text, answers, synthesis);
      record.provenance = { ...(record.provenance || {}), batch: batch.id, registered_question: q.id, decision: batch.approved_in };
      if (questionIdFor(record.divergence.question) !== q.id) return { ok: false, usd: perItem, error: "asked text does not hash to the registered id; nothing stored" };
      const embedding = await embedRecord(record).catch(() => null);
      const count = await appendGrownEntry(record, embedding);
      const cost = councilRunUsd(q.text, answers, synthesis?.narrative, { fallbackUsd: perItem });
      return { ok: count !== null, usd: cost.usd, usd_basis: "list prices × measured text length", unpriced: cost.unpriced, created: count !== null ? record.id : null };
    };
  } else {
    step = async (item) => {
      const reportFile = join(tmpdir(), `omnarai-${batch.id}-${item.record_id}-${Date.now()}.json`);
      const r = spawnSync(process.execPath, [join(ROOT, "scripts/certify-divergence.mjs"), ...certifyArgs(batch.id, item.record_id, reportFile)], { stdio: "inherit", env: process.env });
      let report = null;
      try { report = JSON.parse(readFileSync(reportFile, "utf8")); } catch { /* no report: certOutcome charges the estimate */ }
      const o = certOutcome(report, item.record_id, perItem);
      return r.status === 0 ? o : { ...o, ok: false, created: null, error: `certify exited ${r.status}${o.error ? `; ${o.error}` : ""}` };
    };
  }
  const run = await runItems(batch.items, { perItemUsd: perItem, wallUsd: R.HARD_WALL_USD, step });
  Object.assign(batch, { status: "run", run_at: new Date().toISOString(), actual_usd: run.spent_usd, actual_basis: batch.kind === "elicitation" ? "list prices × measured text length per council run (the council returns no provider usage)" : "provider-reported tokens × list prices (scripts/lib/model-prices.mjs), per record; see each result's usd_basis", results: run.results.map(({ item, ...r }) => ({ ...item, ...r })) });
  writeFileSync(join(ROOT, "public/batches.json"), JSON.stringify(batches, null, 2) + "\n");
  console.log(JSON.stringify({ batch: batch.id, ...run }, null, 1));
  console.log("Commit public/batches.json, log the run in the decision log, and deploy so the manifest shows it.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => die(String(e.stack || e)));
