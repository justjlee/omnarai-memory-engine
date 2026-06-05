// Mint one divergence record from the live council and COMMIT it to the durable
// grown-memory blob (the same blob production reads). Uses the exact production
// write path: elicit → synthesize → buildDivergenceRecord → embedRecord →
// appendGrownEntry. Run against the shared prod blob via BLOB_READ_WRITE_TOKEN.
//
//   node --env-file=.env.local scripts/mint-founding-record.js "question" [--commit]
//
// Without --commit it previews only (no write). With --commit it writes.

import { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } from "../api/_council.js";
import { appendGrownEntry } from "../api/_grown.js";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const question = args.filter((a) => a !== "--commit").join(" ").trim();
if (!question) { console.error("Provide a question."); process.exit(1); }

const line = (c = "─") => console.log(c.repeat(72));

const answers = await elicitCouncil(question);
console.log("PANEL:", answers.map((a) => `${a.model}:${a.ok ? "✓" : "✗"}`).join("  "));
const answered = answers.filter((a) => a.ok);
if (answered.length < 2) { console.error("Not enough voices."); process.exit(1); }

const synthesis = await synthesizeCouncil(question, answers);
const record = buildDivergenceRecord(question, answers, synthesis);

line("═");
console.log(record.full_text);
line("═");
console.log("TENSIONS:");
for (const t of record.provenance.tensions)
  console.log(`• ${t.voice_a} vs ${t.voice_b} — "${t.topic}" [${t.status}]`);
console.log("\nRECORD:", record.id, "| ring:", record.ring, "| words:", record.wordCount,
            "| contributors:", record.contributors.join(", "));
line("═");

if (!commit) {
  console.log("PREVIEW ONLY — not committed. Re-run with --commit to write.");
  process.exit(0);
}

const embedding = await embedRecord(record);
const total = await appendGrownEntry(record, embedding);
if (total === null) { console.error("WRITE FAILED — record not committed."); process.exit(1); }
console.log(`✅ COMMITTED ${record.id} to grown memory.`);
console.log(`   retrievable: ${Boolean(embedding)} | total grown entries now: ${total}`);
