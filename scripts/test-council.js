// Local test harness for the Live Frontier Council.
// Runs the REAL five-model fan-out + synthesis against live APIs. Writes NOTHING.
//
//   node --env-file=.env.local scripts/test-council.js "your question here"
//
// Prints: which voices answered, each verbatim answer, the synthesized
// divergence map, and the assembled record (without persisting it).

import { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, COUNCIL } from "../api/_council.js";

const question =
  process.argv.slice(2).join(" ").trim() ||
  "When an AI system faces a high-stakes decision under deep uncertainty, should it defer to consensus or trust a well-reasoned minority view? Is there a principled way to decide?";

const line = (c = "─") => console.log(c.repeat(72));

(async () => {
  console.log(`\nQUESTION:\n  ${question}\n`);
  console.log("COUNCIL (keys present):");
  for (const m of COUNCIL) console.log(`  ${process.env[m.env] ? "✓" : "✗"} ${m.model} — ${m.lab} (${m.model_id})`);
  line();

  console.time("elicit");
  const answers = await elicitCouncil(question);
  console.timeEnd("elicit");

  for (const a of answers) {
    line();
    if (a.ok) {
      console.log(`✓ ${a.model} (${a.lab})\n`);
      console.log(a.text);
    } else {
      console.log(`✗ ${a.model} (${a.lab}) — FAILED: ${a.error}`);
    }
  }

  const answered = answers.filter((a) => a.ok);
  line("═");
  console.log(`PANEL: ${answered.length}/${answers.length} voices answered\n`);
  if (answered.length < 2) {
    console.log("Not enough voices to synthesize. Stopping.");
    return;
  }

  console.time("synthesize");
  const synthesis = await synthesizeCouncil(question, answers);
  console.timeEnd("synthesize");

  line("═");
  console.log("SYNTHESIS (cross-model deliberation):\n");
  console.log(synthesis.narrative);

  line("═");
  console.log("TENSION MAP (structured):\n");
  console.log(JSON.stringify(synthesis.tensions, null, 2));

  line("═");
  console.log("DELIBERATION CARD:\n");
  console.log(JSON.stringify(synthesis.deliberation_card, null, 2));

  const record = buildDivergenceRecord(question, answers, synthesis);
  line("═");
  console.log(`RECORD (NOT persisted): ${record.id} · ring=${record.ring} · ${record.wordCount} words`);
  console.log(`  contributors: ${record.contributors.join(", ")}`);
  console.log(`  tensions: ${record.provenance.tensions.length} · answers stored: ${record.provenance.answers.length}`);
})().catch((e) => {
  console.error("\nTEST FAILED:", e);
  process.exit(1);
});
