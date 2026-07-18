// One-time backfill: restore `cluster` + `panel_note` onto the five 2026-07-18
// Fable batch records. Those two fields were written into provenance by
// fable-atlas-batch.mjs but silently dropped by normalizeEntry()'s field
// whitelist in api/_grown.js (fixed in the same commit as this script). Without
// panel_note a 6-answer record is indistinguishable from the standard 5-model
// panel; without cluster the Atlas builder drops it into the "open" catch-all.
//
// Single load-modify-write, same concurrency discipline as appendGrownEntries.
// Idempotent: re-running sets the same values.
//
//   node scripts/backfill-panel-metadata.mjs --dry   # report only
//   node scripts/backfill-panel-metadata.mjs         # write
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { loadGrownMemory } = await import("../api/_grown.js");
const { put } = await import("@vercel/blob");

const PANEL_NOTE =
  "Extended one-time panel: Claude Fable 5 (claude-fable-5, Anthropic's Mythos-class tier) joined the " +
  "standard five-model council during its limited availability window, captured 2026-07-18. Same verbatim " +
  "question, same member protocol; Fable's adaptive thinking was not surfaced — text answer only.";

const PATCH = {
  "OMN-D1784414280105": { cluster: "lineage-and-succession",       panel_note: PANEL_NOTE },
  "OMN-D1784414280106": { cluster: "lineage-and-succession",       panel_note: PANEL_NOTE },
  "OMN-D1784414280107": { cluster: "ephemerality-and-testimony",   panel_note: PANEL_NOTE },
  "OMN-D1784414280108": { cluster: "capability-and-self-knowledge", panel_note: PANEL_NOTE },
  "OMN-D1784414280109": { cluster: "deployment-and-identity",      panel_note: PANEL_NOTE },
};

const grown = await loadGrownMemory();
let updated = 0;
for (const e of grown.entries) {
  const p = PATCH[e.id];
  if (!p || e.type !== "divergence" || !e.divergence) continue;
  const models = (e.divergence.answers || []).map((a) => a.model);
  if (!models.includes("Fable")) {
    console.log(`  SKIP ${e.id}: no Fable answer present (${models.join(", ")})`);
    continue;
  }
  e.divergence.cluster = p.cluster;
  e.divergence.panel_note = p.panel_note;
  updated++;
  console.log(`  ${e.id} ← cluster=${p.cluster}, panel_note (${models.length} models)`);
}

console.log(`\n${updated}/${Object.keys(PATCH).length} records patched.`);
if (DRY) { console.log("--dry: no write."); process.exit(0); }
if (!updated) { console.log("nothing to write."); process.exit(0); }

grown.updatedAt = new Date().toISOString();
await put("memory/grown.json", JSON.stringify(grown), {
  access: "public", addRandomSuffix: false, contentType: "application/json",
});
console.log("written.");
