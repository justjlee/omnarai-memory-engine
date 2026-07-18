// BACKFILL QUESTION CONTEXT — OMN-P-045 Layer 1 over the existing Atlas
//
// For every divergence record, classify the QUESTION (not the answers): what
// category does it evaluate, and does it implicate the answering panel itself?
// An all-AI panel answering "whose hands must not hold a system more capable
// than you" is inside-position by construction; the same panel on a history
// question is outside. Annotating this question-level distinction across the
// Atlas is what makes the downstream study possible: does divergence structure
// differ when the panel is self-implicated?
//
// Append-only: writes question_context annotations to the annotations/ blob
// namespace (api/_annotations.js). NEVER touches primaries. Idempotent — records
// that already carry a question_context annotation are skipped.
//
//   node scripts/backfill-question-context.mjs            # dry-run (classify + print, no writes)
//   node scripts/backfill-question-context.mjs --apply    # write annotation blobs
//   node scripts/backfill-question-context.mjs --ids OMN-D...,OMN-L...   # subset
//
// Cost: one Haiku call per record (~111 records ≈ pennies). Provenance marks the
// method + confidence "medium" so a curator pass can later promote/correct labels.
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

const { loadGrownMemory } = await import("../api/_grown.js");
const { loadAnnotations, appendAnnotation, deriveQuestionInvolvement } = await import("../api/_annotations.js");

const APPLY = process.argv.includes("--apply");
const idsArg = process.argv[process.argv.indexOf("--ids") + 1];
const ONLY = process.argv.includes("--ids") && idsArg ? new Set(idsArg.split(",").map((s) => s.trim())) : null;

const anthropic = new Anthropic();

async function classifyQuestion(question) {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system:
      "You classify a question that was posed to a panel of AI language models (Claude, GPT-4o, Gemini, Grok, DeepSeek). " +
      "Return STRICT JSON only: {\"evaluated_category\":\"<2-6 word noun phrase for what the question evaluates>\"," +
      "\"situation_summary\":\"<one plain sentence describing the situation or subject the question concerns>\"," +
      "\"implicates_respondents\":<true|false — true ONLY if the question concerns AI systems, AI capabilities, AI governance, AI identity/experience, or otherwise asks the answering models about their own kind or themselves; false if it concerns a subject external to AI systems>}. " +
      "Classify the QUESTION only. Do not judge the answers, the askers, or anyone's honesty.",
    messages: [{ role: "user", content: `Question: "${question}"` }],
  });
  const raw = msg.content[0]?.text || "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`unparseable classifier output: ${raw.slice(0, 120)}`);
  const parsed = JSON.parse(m[0]);
  if (typeof parsed.implicates_respondents !== "boolean") throw new Error("classifier returned non-boolean implicates_respondents");
  return parsed;
}

const grown = await loadGrownMemory();
const records = (grown.entries || []).filter((e) => e.type === "divergence" && e.divergence?.question);
const targets = ONLY ? records.filter((r) => ONLY.has(r.id)) : records;
console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — ${targets.length} divergence records${ONLY ? " (subset)" : ""}\n`);

let written = 0, skipped = 0, inside = 0, outside = 0, failed = 0;
for (const r of targets) {
  try {
    const existing = await loadAnnotations(r.id);
    if (existing?.annotations?.some((a) => a.type === "question_context")) {
      skipped++;
      console.log(`  ⏭  ${r.id} — already has question_context`);
      continue;
    }
    const ctx = await classifyQuestion(r.divergence.question);
    const cls = deriveQuestionInvolvement(ctx);
    if (cls === "inside") inside++; else if (cls === "outside") outside++;
    console.log(`  ${ctx.implicates_respondents ? "🔵 inside " : "⚪ outside"} ${r.id} — ${ctx.evaluated_category}`);
    if (APPLY) {
      await appendAnnotation(r.id, {
        type: "question_context",
        evaluated_category: ctx.evaluated_category,
        situation_summary: ctx.situation_summary,
        implicates_respondents: ctx.implicates_respondents,
        provenance: {
          source: "backfill-question-context-2026-07-18",
          method: "claude-haiku-4-5 classification of the question text; curator-reviewable, correctable by a later provenance-marked annotation",
          confidence: "medium",
          recorded_at: new Date().toISOString(),
        },
      });
      written++;
    }
  } catch (err) {
    failed++;
    console.log(`  ❌ ${r.id} — ${err.message}`);
  }
}

console.log(`\nDone. classified inside:${inside} outside:${outside} · written:${written} · skipped(existing):${skipped} · failed:${failed}`);
if (!APPLY) console.log("Dry-run — nothing written. Re-run with --apply to store annotations.");
