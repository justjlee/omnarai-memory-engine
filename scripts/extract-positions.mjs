#!/usr/bin/env node
// Phase 5 — derived Positions for historical primary answers.
//
// SPENDS MONEY only with --run, and never without the budget preflight.
// Never modifies a primary: output goes to a local file (--run) and, only with
// --apply, to positions/derived/<id>.json as UNREVIEWED derivations that no
// public read serves until the curator accepts them
// (scripts/review-derived-positions.mjs).
//
//   node scripts/extract-positions.mjs                       # PLAN: counts + cost estimate, no model call
//   node scripts/extract-positions.mjs --sample 40 --run     # evaluation sample → analysis/stance-eval-<date>.json (+ .md sheet)
//   node scripts/extract-positions.mjs --ids OMN-D…,OMN-L… --run [--apply]
//   node scripts/extract-positions.mjs --run --apply         # bulk — ONLY after the sample has been reviewed
//
// Options: --limit N · --answers <record#aN,…> · --version stance-extract/0.1 · --model claude-haiku-4-5 ·
//          --source file:<atlas.jsonl> (offline records) · --i-accept-spend
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDefaultStore } from "../api/_footprints.js";
import { DERIVED_PREFIX } from "../api/_protocol.js";
import {
  EXTRACTOR_VERSION, EST_USD_PER_ANSWER, derivedIdFor, groundClassification, buildDerivedPosition,
  enumerateAnswers, evaluationSample, anthropicClassifier,
} from "./lib/stance-extract.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${ROOT}.env.local`) && !globalThis.__MEM_BLOB__) {
  for (const line of readFileSync(`${ROOT}.env.local`, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

function argValue(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }

async function loadRecords(source) {
  if (source?.startsWith("file:")) {
    return readFileSync(source.slice(5), "utf8").trim().split("\n").map(JSON.parse).map((r) => ({
      id: r.id, date: r.captured_at, type: "divergence",
      divergence: { question: r.question, answers: (r.answers || []).map((a) => ({ model: a.model, model_id: a.model_id, text: a.text })) },
    }));
  }
  const { loadGrownMemory } = await import("../api/_grown.js");
  const g = await loadGrownMemory({ strict: true }); // a failed read must not look like an empty Atlas
  return (g.entries || []).filter((e) => e.type === "divergence" && e.divergence);
}

export async function run(argv = process.argv.slice(2), { classifier = null, log = console.log, store = getDefaultStore(), outDir = `${ROOT}analysis`, preflight = null } = {}) {
  const args = [...argv];
  const version = argValue(args, "--version") || EXTRACTOR_VERSION;
  const ids = argValue(args, "--ids") ? new Set(argValue(args, "--ids").split(",").map((s) => s.trim())) : null;
  const limit = Number(argValue(args, "--limit")) || Infinity;
  const sampleN = Number(argValue(args, "--sample")) || 0;
  const doRun = args.includes("--run");
  const doApply = args.includes("--apply");
  if (doApply && !doRun) throw new Error("--apply requires --run");

  const records = await loadRecords(argValue(args, "--source"));
  let items = enumerateAnswers(records, { ids, limit });
  const answerIds = argValue(args, "--answers") ? new Set(argValue(args, "--answers").split(",").map((x) => x.trim())) : null;
  if (answerIds) items = items.filter(({ record, index }) => answerIds.has(`${record.id}#a${index}`));
  if (sampleN) items = evaluationSample(items, sampleN);

  // Skip answers that already have a derivation at THIS version (idempotent).
  const existing = new Set((await store.listPrefix(DERIVED_PREFIX)).map((b) => b.pathname.slice(DERIVED_PREFIX.length).replace(/\.json$/, "")));
  const todo = items.filter(({ record, index }) => !existing.has(derivedIdFor(`${record.id}#a${index}`, version)));
  const est = +(todo.length * EST_USD_PER_ANSWER).toFixed(2);
  log(`records: ${records.length} · answers selected: ${items.length} · already derived at ${version}: ${items.length - todo.length} · to classify: ${todo.length} · est ≤ $${est}`);
  if (!doRun) { log("PLAN ONLY — no model was called. Add --run to classify (budget preflight applies)."); return { planned: todo.length, est }; }

  let clf = classifier;
  if (!clf) {
    const pre = preflight || (await import("./budget-preflight.mjs")).preflightSpend;
    await pre({ estUsd: est, label: `extract-positions ${version} (${todo.length} answers)` });
    clf = anthropicClassifier({ model: argValue(args, "--model") || "claude-haiku-4-5" });
  }

  const results = [];
  for (const { record, index } of todo) {
    const a = record.divergence.answers[index];
    let raw = null, error = null;
    try { raw = await clf.classify(record.divergence.question, a.text); } catch (e) { error = String(e.message || e).slice(0, 200); }
    const grounded = groundClassification(a.text, raw);
    if (error) grounded.guard = `classifier-error: ${error}`;
    results.push(buildDerivedPosition({ record, index, grounded, model: clf.model, version }));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  mkdirSync(outDir, { recursive: true });
  const base = `${outDir}/stance-${sampleN ? "eval" : "run"}-${stamp}`;
  writeFileSync(`${base}.json`, JSON.stringify({ version, generated_at: new Date().toISOString(), count: results.length, derived_positions: results }, null, 2));
  if (sampleN) {
    const byId = new Map(records.map((r) => [r.id, r]));
    const rows = results.map((d) => {
      const [rid, ai] = d.derivation.source_answer_id.split("#a");
      const a = byId.get(rid).divergence.answers[Number(ai)];
      return `| ${d.derivation.source_answer_id} | ${a.model} | **${d.stance}** | ${(d.derivation.evidence_span || "—").replace(/\|/g, "/")} | ${d.derivation.guard || ""} | ☐ agree ☐ disagree → ____ |`;
    });
    writeFileSync(`${base}.md`, `# Stance extraction — evaluation sheet (${version})\n\nCheck each machine label against the verbatim answer (read it at /api/questions?id=… or /api/divergences?id=…). Mark agree/disagree and, where you disagree, the stance you would assign. Bulk adoption waits on this sheet.\n\n| answer | model | derived stance | evidence span (verbatim) | guard | curator |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`);
  }
  const tally = results.reduce((m, d) => ((m[d.stance] = (m[d.stance] || 0) + 1), m), {});
  log(`classified ${results.length}: ${JSON.stringify(tally)} · guard-forced unclear: ${results.filter((d) => d.derivation.guard).length}`);
  log(`wrote ${base}.json${sampleN ? ` + ${base}.md (curator sheet)` : ""}`);

  if (doApply) {
    for (const d of results) await store.putJson(`${DERIVED_PREFIX}${d.id}.json`, d);
    log(`applied ${results.length} UNREVIEWED derived position(s) to ${DERIVED_PREFIX} — nothing is served publicly until accepted (scripts/review-derived-positions.mjs).`);
  }
  return { results, file: `${base}.json` };
}

if (process.argv[1]?.endsWith("extract-positions.mjs")) await run();
