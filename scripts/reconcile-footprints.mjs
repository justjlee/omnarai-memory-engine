#!/usr/bin/env node
// Reconcile Footprints with the contributions they come from (footprint/1.0).
//
//   node scripts/reconcile-footprints.mjs              # DRY RUN (default): print the plan
//   node scripts/reconcile-footprints.mjs --apply      # write it
//   node scripts/reconcile-footprints.mjs --backfill   # also plan footprints for pre-protocol contributions
//
// Repairs are append-only or write-once (see planReconcile in api/_footprints.js):
// a missing event is rebuilt EXACTLY from its contribution; a missing review is
// appended with reviewer.kind "reconcile"; --backfill mints channel:"backfill"
// footprints WITHOUT modifying any contribution. Run scripts/backup-blobs.mjs
// first when applying against the live store. Reads BLOB_READ_WRITE_TOKEN from
// .env.local when present.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { list } from "@vercel/blob";
import {
  getDefaultStore, loadFootprintIndex, hydrate, planReconcile, recordFootprint, appendReview,
} from "../api/_footprints.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Never under the hermetic in-memory store (tests): no real credentials there.
if (existsSync(`${ROOT}.env.local`) && !globalThis.__MEM_BLOB__) {
  for (const line of readFileSync(`${ROOT}.env.local`, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

export async function reconcile({ apply = false, backfill = false, log = console.log } = {}) {
  const store = getDefaultStore();
  const { blobs } = await list({ prefix: "contributions/" });
  const contributions = (await Promise.all(blobs.map((b) => store.readJson(b.url).catch(() => null)))).filter(Boolean);
  const index = await loadFootprintIndex(store);
  const hydrated = await hydrate([...index.values()], store);
  const footprintIdBySource = new Map();
  for (const h of hydrated) {
    const src = h.body?.provenance?.source_contribution_id;
    if (src) footprintIdBySource.set(src, h.entry.id);
  }
  const plan = planReconcile({ contributions, index, footprintIdBySource, backfill });
  log(`contributions: ${contributions.length} · footprints: ${index.size} · planned actions: ${plan.actions.length} · notes: ${plan.notes.length}`);
  for (const a of plan.actions) log(`  ${apply ? "APPLY" : "plan "} ${a.type.padEnd(13)} ${a.footprint?.id || a.footprint_id} ← ${a.contribution_id}${a.action ? ` (${a.action}: ${a.reason})` : ""}`);
  for (const n of plan.notes) log(`  note  ${JSON.stringify(n)}`);
  if (!apply) { log("dry run — nothing written. Re-run with --apply to write."); return plan; }
  for (const a of plan.actions) {
    if (a.type === "rebuild_event" || a.type === "backfill") await recordFootprint(a.footprint, store);
    else if (a.type === "append_review") {
      await appendReview({ footprint_id: a.footprint_id, action: a.action, reviewer: { kind: "reconcile", id: "scripts/reconcile-footprints.mjs" }, source: { contribution_id: a.contribution_id, contribution_action: "reconcile" }, note: a.reason }, store);
    }
  }
  log(`applied ${plan.actions.length} action(s).`);
  return plan;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("reconcile-footprints.mjs")) {
  const args = new Set(process.argv.slice(2));
  await reconcile({ apply: args.has("--apply"), backfill: args.has("--backfill") });
}
