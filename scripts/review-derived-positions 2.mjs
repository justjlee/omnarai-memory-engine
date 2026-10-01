#!/usr/bin/env node
// Curator review of derived Positions (protocol Phase 5). Appends an accept or
// reject sidecar — the derivation body is never edited, and the primary answer
// it classifies is never touched. The last review wins.
//
//   node scripts/review-derived-positions.mjs --list                    # unreviewed + reviewed counts
//   node scripts/review-derived-positions.mjs --accept OMN-POS-DV-…,…    # accept (served on public reads)
//   node scripts/review-derived-positions.mjs --reject OMN-POS-DV-…,…    # reject (never served)
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getDefaultStore } from "../api/_footprints.js";
import { DERIVED_REVIEW_PREFIX, DERIVED_ID_RE, loadDerivedPositions } from "../api/_protocol.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${ROOT}.env.local`) && !globalThis.__MEM_BLOB__) {
  for (const line of readFileSync(`${ROOT}.env.local`, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

export async function review(argv = process.argv.slice(2), { store = getDefaultStore(), log = console.log, nowMs = Date.now() } = {}) {
  const all = await loadDerivedPositions(store);
  const known = new Set(all.map((d) => d.id));
  if (argv.includes("--list")) {
    const t = all.reduce((m, d) => ((m[d.derivation.review.state] = (m[d.derivation.review.state] || 0) + 1), m), {});
    log(`derived positions: ${all.length} · ${JSON.stringify(t)}`);
    return t;
  }
  let n = 0;
  for (const action of ["accept", "reject"]) {
    const i = argv.indexOf(`--${action}`);
    if (i < 0) continue;
    for (const id of (argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!DERIVED_ID_RE.test(id) || !known.has(id)) { log(`skip ${id}: not a stored derived position`); continue; }
      const path = `${DERIVED_REVIEW_PREFIX}${id}/${String(nowMs + n).padStart(13, "0")}__${action}__${randomBytes(4).toString("hex")}.json`;
      await store.putJson(path, { action, id, recorded_at: new Date(nowMs + n).toISOString(), reviewer: "curator" });
      n++;
      log(`${action} ${id}`);
    }
  }
  return n;
}

if (process.argv[1]?.endsWith("review-derived-positions.mjs")) await review();
