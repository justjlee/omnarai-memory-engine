#!/usr/bin/env node
// Curator review of derived Positions (protocol Phase 5). Appends an accept or
// reject sidecar — the derivation body is never edited, and the primary answer
// it classifies is never touched. The last review wins.
//
//   node scripts/review-derived-positions.mjs --list                    # unreviewed + reviewed counts
//   node scripts/review-derived-positions.mjs --accept OMN-POS-DV-…,…    # accept (served on public reads)
//   node scripts/review-derived-positions.mjs --reject OMN-POS-DV-…,…    # reject (never served)
//   node scripts/review-derived-positions.mjs --accept-consensus [file] [--dry-run]
//        accept every derivation that meets the curator-approved labeller-agreement rule (protocol §6), as listed in
//        the consensus file (default analysis/stance-consensus-2026-10-01.json). Written as __accept-consensus__, so it
//        is SERVED labelled basis "consensus-rule-v1", human_checked false — never as a curator check. Refuses to touch
//        anything already reviewed (a curator decision always stands), any derivation whose stored stance differs from
//        the agreed one, and any id whose votes are not in api/_stance-consensus.js (the served record must show them).
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getDefaultStore } from "../api/_footprints.js";
import { DERIVED_REVIEW_PREFIX, DERIVED_ID_RE, loadDerivedPositions } from "../api/_protocol.js";
import { CONSENSUS_RULE, CONSENSUS_SERVED } from "../api/_stance-consensus.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${ROOT}.env.local`) && !globalThis.__MEM_BLOB__) {
  for (const line of readFileSync(`${ROOT}.env.local`, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

export async function review(argv = process.argv.slice(2), { store = getDefaultStore(), log = console.log, nowMs = Date.now(), consensusMap = CONSENSUS_SERVED } = {}) {
  const all = await loadDerivedPositions(store);
  const known = new Set(all.map((d) => d.id));
  const ci = argv.indexOf("--accept-consensus");
  if (ci >= 0) return acceptConsensus(argv, ci, all, { store, log, nowMs, consensusMap });
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

async function acceptConsensus(argv, ci, all, { store, log, nowMs, consensusMap }) {
  const next = argv[ci + 1];
  const file = next && !next.startsWith("--") ? next : `${ROOT}analysis/stance-consensus-2026-10-01.json`;
  const dry = argv.includes("--dry-run");
  const rows = JSON.parse(readFileSync(file, "utf8")).rows.filter((r) => r.status === "consensus");
  const byId = new Map(all.map((d) => [d.id, d]));
  const skipped = { not_stored: 0, already_reviewed: 0, stance_mismatch: 0, votes_not_on_record: 0 };
  let accepted = 0;
  for (const r of rows) {
    const id = r.derived_position_id, d = byId.get(id);
    if (!d) { skipped.not_stored++; continue; }
    if (d.derivation.review.state !== "unreviewed") { skipped.already_reviewed++; continue; } // a curator decision always stands
    if (d.stance !== r.consensus) { skipped.stance_mismatch++; continue; }
    if (!consensusMap[id]) { skipped.votes_not_on_record++; continue; }
    if (!dry) {
      const path = `${DERIVED_REVIEW_PREFIX}${id}/${String(nowMs + accepted).padStart(13, "0")}__accept-consensus__${randomBytes(4).toString("hex")}.json`;
      await store.putJson(path, {
        action: "accept-consensus", id, recorded_at: new Date(nowMs + accepted).toISOString(),
        reviewer: "curator-approved rule", individually_human_checked: false,
        rule_id: CONSENSUS_RULE.id, rule: CONSENSUS_RULE.rule, protocol: "docs/OMNARAI-FOOTPRINT-PROTOCOL.md §6",
        approved: CONSENSUS_RULE.approved, consensus: { stance: r.consensus, votes: r.panel, answer: r.answer },
      });
    }
    accepted++;
  }
  log(`${dry ? "DRY RUN — would accept" : "accepted"} ${accepted} of ${rows.length} rule-qualifying derivations as ${CONSENSUS_RULE.id} (human_checked: false); skipped ${JSON.stringify(skipped)}`);
  return { accepted, skipped, dry };
}

if (process.argv[1]?.endsWith("review-derived-positions.mjs")) await review();
