#!/usr/bin/env node
// Persistent tension identity — build the DERIVED identity map for the Atlas. Spec: docs/TENSION-IDENTITY.md.
// Reads an Atlas jsonl, embeds each tension's two claims (OpenAI text-embedding-3-small @ 512d, like the corpus), links sightings into
// tensions with scripts/lib/tension-identity-core.mjs, and writes a derived artifact. Writes NOTHING to the live store, the Atlas, or
// the corpus; the output is labelled `derived-unreviewed`.
//
//   node scripts/tension-identity.mjs --env <path-to-.env.local>                    # build + write analysis/tension-identity-v0.json
//   node scripts/tension-identity.mjs --env <…> --tau 0.80                          # override the null-calibrated threshold
//   node scripts/tension-identity.mjs --dry                                         # counts + embedding cost only, no network
//   node scripts/tension-identity.mjs --env <…> --prior analysis/tension-identity-v0.json   # freeze existing ids, assign only new sightings
//
// THRESHOLD RULE (fixed before looking at any result): tau = the 99th percentile of the orientation-aware similarity between two tensions
// of the SAME record, which I assumed were different fault lines. That assumption turned out to be only partly true (the adjudication run
// found within-record tensions that restate one axis), so this tau is a CONSERVATIVE baseline, not a calibrated one — it is why the
// embedding-only map finds almost no recurrence. It was NOT tuned to maximise recurrence.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedCached, MODEL, DIMS } from "./lib/tension-embed.mjs";
import {
  SCHEMA, EVIDENCE_STATUS, sha256, sightingsFromRecords, unit, pairSim, assign, withinRecordSims, quantile, summarize,
} from "./lib/tension-identity-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const SOURCE = flag("--source", "atlas/data/atlas-v1.1.0.jsonl");
const OUT = flag("--out", "analysis/tension-identity-v0.json");
const AUDIT = flag("--audit", "analysis/tension-identity-audit-v0.md");
const CACHE = flag("--cache", path.join(os.tmpdir(), "omnarai-tension-embed-cache.json"));

const raw = fs.readFileSync(path.join(ROOT, SOURCE), "utf8");
const records = raw.trim().split("\n").map((l) => JSON.parse(l));
const sightings = sightingsFromRecords(records);
const texts = [...new Set(sightings.flatMap((s) => [s.claim_a, s.claim_b]))];
console.log(`source ${SOURCE}: ${records.length} records, ${sightings.length} sightings, ${texts.length} distinct claim texts`);
if (DRY) { console.log(`dry run — would embed ${texts.length} texts (~${Math.round(texts.join(" ").length / 4)} tokens, well under $0.01)`); process.exit(0); }

// ── embeddings (cached by sha256 of text) ────────────────────────────────────
const emb = await embedCached(texts, { cachePath: CACHE, envFile: flag("--env", path.join(ROOT, ".env.local")) });
const vecs = new Map(sightings.map((s) => [s.sighting_id, { a: unit(emb.get(s.claim_a)), b: unit(emb.get(s.claim_b)) }]));

// ── threshold from the within-record null (conservative baseline; see header) ───────────────────────────────────
const nullSims = withinRecordSims(sightings, vecs);
const q = (p) => +quantile(nullSims, p).toFixed(4);
const tau = flag("--tau") ? Number(flag("--tau")) : q(0.99);
console.log(`within-record pairs: ${nullSims.length}; similarity q50=${q(0.5)} q95=${q(0.95)} q99=${q(0.99)} max=${q(1)}; tau=${tau}${flag("--tau") ? " (override)" : " (q99 rule)"}`);

// ── assign ───────────────────────────────────────────────────────────────────
let prior = [];
const PRIOR = flag("--prior");
if (PRIOR) {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, PRIOR), "utf8"));
  prior = p.tensions.flatMap((t) => t.sightings.map((s) => ({ sighting_id: s.sighting_id, tension_id: t.tension_id, swap: s.swap, sim_to_tension: s.sim_to_tension, founded: s.founded })));
  console.log(`prior: ${prior.length} frozen sightings from ${PRIOR}`);
}
const { assignments } = assign(sightings, vecs, { tau, prior });
const groups = summarize(sightings, assignments);

// ── indicators (reported, not tuned against) ─────────────────────────────────
const legacy = (() => {
  const key = (s) => `${[s.voice_a, s.voice_b].sort().join("--")}__${(s.topic || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`.slice(0, 120);
  const m = new Map(); for (const s of sightings) (m.get(key(s)) || m.set(key(s), new Set()).get(key(s))).add(s.record_id);
  return { distinct_keys: m.size, keys_in_more_than_one_record: [...m.values()].filter((r) => r.size > 1).length };
})();
const recurring = groups.filter((g) => new Set(g.ms.map((m) => m.record_id)).size > 1);
const byGroup = new Map(); for (const r of records) (byGroup.get(r.question_group) || byGroup.set(r.question_group, []).get(r.question_group)).push(r);
const tensionOf = new Map(assignments.map((a) => [a.sighting_id, a.tension_id]));
let rq = 0, rqHit = 0;
for (const rs of byGroup.values()) {
  if (rs.length < 2) continue;
  const ord = [...rs].sort((x, y) => String(x.captured_at).localeCompare(String(y.captured_at)) || x.id.localeCompare(y.id));
  const earlier = new Set(); ord[0].tensions.forEach((_, i) => earlier.add(tensionOf.get(`${ord[0].id}#${i}`)));
  ord.slice(1).forEach((r) => r.tensions.forEach((_, i) => { rq++; if (earlier.has(tensionOf.get(`${r.id}#${i}`))) rqHit++; }));
}
const sizes = groups.map((g) => g.ms.length);
const indicators = {
  sightings: sightings.length, tensions: groups.length,
  tensions_seen_in_more_than_one_record: recurring.length,
  sightings_in_recurring_tensions: recurring.reduce((n, g) => n + g.ms.length, 0),
  largest_tension_sightings: Math.max(...sizes),
  legacy_string_key: legacy,
  reasked_question_recall: { later_record_tensions: rq, linked_to_earlier_record_of_same_question: rqHit, share: rq ? +(rqHit / rq).toFixed(3) : null,
    note: "soft indicator only — a re-asked question need not reproduce the same fault lines" },
  within_record_null: { pairs: nullSims.length, q50: q(0.5), q95: q(0.95), q99: q(0.99), max: q(1) },
};
console.log(JSON.stringify(indicators, null, 1));

// ── write artifact ───────────────────────────────────────────────────────────
const sight = (m) => ({
  sighting_id: m.sighting_id, record_id: m.record_id, captured_at: m.captured_at,
  voice_on_side_a: m.swap ? m.voice_b : m.voice_a, voice_on_side_b: m.swap ? m.voice_a : m.voice_b,
  swap: m.swap, topic: m.topic, status: m.status, founded: m.founded, sim_to_tension: m.sim_to_tension == null ? null : +m.sim_to_tension.toFixed(4),
});
const artifact = {
  schema: SCHEMA, evidence_status: EVIDENCE_STATUS,
  warning: "DERIVED and UNREVIEWED. A tension_id is a similarity judgement that sightings are the same disagreement, not a ruling. Never cite as established recurrence until reviewed.",
  built_at: new Date().toISOString(),
  source: { file: SOURCE, sha256: sha256(raw), records: records.length },
  method: { embedding: `${MODEL}@${DIMS}`, linkage: "average, chronological, incremental", cannot_link: "same record", orientation: "swap-aware",
    tau, tau_rule: flag("--tau") ? "override" : "q99 of within-record pair similarity (conservative baseline)" },
  indicators,
  tensions: groups.map((g) => ({
    tension_id: g.tension_id, founded_by: g.ms[0].sighting_id, first_seen: g.ms[0].captured_at, last_seen: g.ms[g.ms.length - 1].captured_at,
    n_sightings: g.ms.length, n_records: new Set(g.ms.map((m) => m.record_id)).size,
    side_a: { claim: g.ms[0].claim_a, voice: g.ms[0].voice_a }, side_b: { claim: g.ms[0].claim_b, voice: g.ms[0].voice_b },
    sightings: g.ms.map(sight),
  })),
};
fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(artifact, null, 1) + "\n");
console.log(`wrote ${OUT} (${artifact.tensions.length} tensions)`);

// ── audit sample for curator review (deterministic) ──────────────────────────
const bySid = new Map(sightings.map((s) => [s.sighting_id, s]));
const linked = assignments.filter((a) => !a.founded).sort((x, y) => sha256("audit|" + x.sighting_id).localeCompare(sha256("audit|" + y.sighting_id))).slice(0, 25);
const lines = [`# Tension-identity audit sample (derived-unreviewed)`, ``,
  `Source \`${SOURCE}\` · tau=${tau} · ${new Date().toISOString().slice(0, 10)}. Each item: is the LATER sighting the same underlying disagreement as the FOUNDING one? Mark Y / N / ?.`, ``];
linked.forEach((a, i) => {
  const s = bySid.get(a.sighting_id), f = bySid.get(groups.find((g) => g.tension_id === a.tension_id).ms[0].sighting_id);
  const sa = a.swap ? [s.claim_b, s.claim_a] : [s.claim_a, s.claim_b];
  lines.push(`## ${i + 1}. sim ${a.sim_to_tension.toFixed(3)} — \`${f.sighting_id}\` ⟵ \`${s.sighting_id}\`${a.swap ? " (sides swapped)" : ""}`,
    `- **Founding** — topic: ${f.topic}`, `  - A (${f.voice_a}): ${f.claim_a}`, `  - B (${f.voice_b}): ${f.claim_b}`,
    `- **Later** — topic: ${s.topic}`, `  - A: ${sa[0]}`, `  - B: ${sa[1]}`, `- Verdict: `, ``);
});
fs.writeFileSync(path.join(ROOT, AUDIT), lines.join("\n") + "\n");
console.log(`wrote ${AUDIT} (${linked.length} linked pairs to review)`);
