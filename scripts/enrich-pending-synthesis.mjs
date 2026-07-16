#!/usr/bin/env node
// Enrich divergence records whose interpretive layer never ran. The longitudinal
// cron commits the verbatim answers first and, when it hits the 60s Hobby wall,
// falls back to a `pending` synthesis with tensions:[] (council.js §"Deadline
// discipline"). Those primaries are real and divergent — only the NAMING of the
// split is missing. This re-runs synthesizeCouncil() over the stored answers
// (locally, no function wall), writes the tensions + deliberation card back onto
// the grown entry, refreshes the record's "Cross-model deliberation" prose, and
// clears the synthesis_pending flag.
//
// Backs up grown.json locally first. Idempotent (a record with tensions and no
// pending flag is skipped). Targets ALL pending records; there is currently one
// (OMN-L1784135876336, 2026-07-15).
//
//   node scripts/enrich-pending-synthesis.mjs           # enrich all pending
//   node scripts/enrich-pending-synthesis.mjs --dry     # preview, no write
//   node scripts/enrich-pending-synthesis.mjs --id OMN-L...  # scope to one record

import { list, put } from "@vercel/blob";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { synthesizeCouncil } from "../api/_council.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local AFTER imports: the blob client and Anthropic client both read
// their creds at call time (synthesizeCouncil constructs `new Anthropic()` inside
// the function), so env only needs to be present before the first call below.
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const onlyId = (() => { const i = args.indexOf("--id"); return i >= 0 ? args[i + 1] : null; })();

const { blobs } = await list({ prefix: "memory/grown.json" });
if (!blobs.length) { console.error("no memory/grown.json blob found"); process.exit(1); }
const grown = await (await fetch(blobs[0].url, { cache: "no-store" })).json();

// local backup before mutating the live canonical store
const bdir = join(__dirname, "..", "..", "omnarai-backups", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(bdir, { recursive: true });
writeFileSync(join(bdir, "grown.json"), JSON.stringify(grown, null, 2));
console.log(`backup → ${join(bdir, "grown.json")}\n`);

const needsEnrich = (e) => {
  if (e.type !== "divergence" || !e.divergence) return false;
  if (onlyId) return e.id === onlyId;
  const answers = e.divergence.answers || [];
  const tensions = e.divergence.tensions || [];
  const pending = !!e.divergence.longitudinal?.synthesis_pending;
  return answers.length >= 2 && (pending || tensions.length === 0);
};

const targets = grown.entries.filter(needsEnrich);
console.log(`${targets.length} record(s) to enrich${onlyId ? ` (scoped to ${onlyId})` : ""}\n`);

let changed = 0;
for (const e of targets) {
  const d = e.divergence;
  const question = d.question || e.excerpt;
  // stored answers drop the transient `ok` flag; synthesizeCouncil filters on it.
  const answers = (d.answers || []).map((a) => ({ ...a, ok: true }));
  process.stdout.write(`  · ${e.id} — synthesizing over ${answers.length} answers… `);

  let synthesis;
  try {
    // No 60s function wall here — give the map room so it can't truncate.
    synthesis = await synthesizeCouncil(question, answers, { maxTokens: 4096 });
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    continue;
  }
  console.log(`${synthesis.tensions.length} tensions`);
  synthesis.tensions.forEach((t) => console.log(`      – ${t.topic}: ${t.voice_a} ⟂ ${t.voice_b} [${t.status}]`));
  if (DRY) continue;

  d.tensions = synthesis.tensions;
  d.deliberation_card = synthesis.deliberation_card;
  e.deliberation_card = synthesis.deliberation_card;
  if (d.longitudinal) delete d.longitudinal.synthesis_pending;

  // replace the pending placeholder with the real deliberation prose
  if (e.full_text && synthesis.narrative) {
    const marker = "## Cross-model deliberation";
    const i = e.full_text.indexOf(marker);
    if (i >= 0) e.full_text = e.full_text.slice(0, i) + `${marker}\n\n${synthesis.narrative}`;
  }
  changed++;
}

if (DRY) {
  console.log(`\n(dry run — no write)`);
} else if (changed) {
  grown.updatedAt = new Date().toISOString();
  await put("memory/grown.json", JSON.stringify(grown), {
    access: "public", addRandomSuffix: false, contentType: "application/json",
  });
  console.log(`\n✓ enriched ${changed} record(s) → memory/grown.json rewritten`);
} else {
  console.log(`\nno changes`);
}
