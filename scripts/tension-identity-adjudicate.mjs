#!/usr/bin/env node
// Persistent tension identity — adjudicated links. Spec: docs/TENSION-IDENTITY.md §4.
// Embedding similarity alone cannot tell "same recurring fault line" (0.53–0.57 in the Atlas) from "same topic, different split" (0.60+),
// so similarity only GENERATES CANDIDATES. A three-model panel decides, under the unanimity rule the protocol already uses for derived
// stances (scripts/stance-consensus.mjs): a pair is LINKED iff all three judges answer "same" with the same orientation. A judge that
// errors or returns an unparsable answer ABSTAINS (not a vote); fewer than 3 votes ⇒ "insufficient", never a link.
//
// RULES FIXED BEFORE THE RUN (2026-10-02): candidates = cross-record pairs with orientation-aware similarity ≥ 0.50 (chosen after
// eyeballing the top-300 pairs; recall below 0.50 is NOT measured). Panel = claude-haiku-4-5, gemini-2.5-flash, deepseek-chat.
// Judges see ONLY the two claim pairs: no voices, records, questions or topics; each disagreement's sides are shown in a seeded random
// order and the orientation is mapped back. Within-record pairs (two tensions of the SAME record) are mixed in as an unlabelled
// control. NOTE (found after the first run): they are NOT reliably distinct — five voices yield overlapping pairwise tensions, so the same axis can
// appear twice in one record. The linked share therefore mixes panel over-linking with genuine within-record redundancy and cannot be read as a false-link rate.
//
//   node scripts/tension-identity-adjudicate.mjs --dry                      # candidate/control counts + cost estimate, no network
//   node scripts/tension-identity-adjudicate.mjs --env <.env.local>         # run (resumable via --votes), write links + identity map
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedCached, loadEnv, MODEL, DIMS } from "./lib/tension-embed.mjs";
import {
  SCHEMA, EVIDENCE_STATUS, sha256, sightingsFromRecords, unit, pairSim, assignByLinks, linkKey, summarize,
} from "./lib/tension-identity-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const SOURCE = flag("--source", "atlas/data/atlas-v1.1.0.jsonl");
const CAND = Number(flag("--cand", "0.50"));
const N_CONTROL = Number(flag("--controls", "80"));
const VOTES = flag("--votes", path.join(os.tmpdir(), "omnarai-tension-votes.json"));
const LINKS_OUT = flag("--links-out", "analysis/tension-identity-links-v0.json");
const OUT = flag("--out", "analysis/tension-identity-v1.json");
const AUDIT = flag("--audit", "analysis/tension-identity-audit-v1.md");
const ENV = flag("--env", path.join(ROOT, ".env.local"));
const CONCURRENCY = Number(flag("--concurrency", "6"));

export const PANEL = [
  { label: "claude-haiku-4-5", provider: "anthropic", env: "ANTHROPIC_API_KEY", usd: [1, 5] },
  { label: "gemini-2.5-flash", provider: "gemini", env: "GEMINI_API_KEY", usd: [0.3, 2.5] },
  { label: "deepseek-chat", provider: "deepseek", env: "DEEPSEEK_API_KEY", usd: [0.27, 1.1] },
];
export const SYSTEM = `You compare two disagreements that were extracted from separate conversations between AI models. Each disagreement is a pair of opposing claims. Decide whether they are the SAME underlying disagreement: the same fault line, such that a holder of Side X in the first would hold the corresponding side in the second, ignoring wording, examples, and the question that prompted each. Be strict: sharing a topic is not enough; both sides must correspond. Reply with JSON only.`;
export const userMessage = (d1, d2) => `DISAGREEMENT 1
Side X: ${d1[0]}
Side Y: ${d1[1]}

DISAGREEMENT 2
Side X: ${d2[0]}
Side Y: ${d2[1]}

Return: {"relation": "same" | "partial" | "different", "orientation": "aligned" | "swapped" | null, "reason": "<one sentence>"}
- same: both sides correspond (X1~X2 and Y1~Y2, or X1~Y2 and Y1~X2).
- partial: only one side corresponds, or they share a topic but split along different lines.
- different: unrelated.
- orientation: "aligned" if X1 corresponds to X2, "swapped" if X1 corresponds to Y2; null unless relation is "same".`;

// ── data, vectors, pairs ─────────────────────────────────────────────────────
const raw = fs.readFileSync(path.join(ROOT, SOURCE), "utf8");
const records = raw.trim().split("\n").map((l) => JSON.parse(l));
const sightings = sightingsFromRecords(records);
const texts = [...new Set(sightings.flatMap((s) => [s.claim_a, s.claim_b]))];
const emb = await embedCached(texts, { cachePath: flag("--cache", path.join(os.tmpdir(), "omnarai-tension-embed-cache.json")), envFile: ENV });
const vecs = new Map(sightings.map((s) => [s.sighting_id, { a: unit(emb.get(s.claim_a)), b: unit(emb.get(s.claim_b)) }]));
const byId = new Map(sightings.map((s) => [s.sighting_id, s]));

const cross = [], within = [];
for (let i = 0; i < sightings.length; i++) for (let j = i + 1; j < sightings.length; j++) {
  const r = pairSim(vecs.get(sightings[i].sighting_id), vecs.get(sightings[j].sighting_id));
  if (r.sim < CAND) continue;
  const p = { key: linkKey(sightings[i].sighting_id, sightings[j].sighting_id), x: sightings[i].sighting_id, y: sightings[j].sighting_id, sim: +r.sim.toFixed(4) };
  (sightings[i].record_id === sightings[j].record_id ? within : cross).push(p);
}
cross.sort((p, q) => q.sim - p.sim || (p.key < q.key ? -1 : 1));
const controls = within.sort((p, q) => sha256("ctl|" + p.key).localeCompare(sha256("ctl|" + q.key))).slice(0, N_CONTROL).map((p) => ({ ...p, control: true }));
const pairs = [...cross.map((p) => ({ ...p, control: false })), ...controls];
const estUsd = pairs.length * PANEL.reduce((s, m) => s + (380 * m.usd[0] + 90 * m.usd[1]) / 1e6, 0);
console.log(`candidates (cross-record, sim ≥ ${CAND}): ${cross.length}; within-record controls: ${controls.length} (of ${within.length} within-record pairs ≥ ${CAND}); judge calls: ${pairs.length * PANEL.length}; est. cost ≈ $${estUsd.toFixed(2)}`);
if (DRY) process.exit(0);

// ── judging (resumable) ──────────────────────────────────────────────────────
loadEnv(ENV, PANEL.map((m) => m.env));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(m, user) {
  const key = process.env[m.env]; if (!key) throw new Error(`no ${m.env}`);
  for (let t = 0; t < 4; t++) {
    let res, data;
    if (m.provider === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: m.label, max_tokens: 300, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: user }] }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2500 * (t + 1)); continue; }
      data = await res.json(); if (data.error) throw new Error(data.error.message); return data.content?.[0]?.text || "";
    }
    if (m.provider === "gemini") {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.label}:generateContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0, maxOutputTokens: 2000 } }) });
      if (res.status === 429 || res.status >= 500) { await sleep(2500 * (t + 1)); continue; }
      data = await res.json(); if (data.error) throw new Error(data.error.message); return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    }
    res = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: m.label, temperature: 0, max_tokens: 300, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }) });
    if (res.status === 429 || res.status >= 500) { await sleep(2500 * (t + 1)); continue; }
    data = await res.json(); if (data.error) throw new Error(data.error.message || "provider error"); return data.choices?.[0]?.message?.content || "";
  }
  throw new Error("retries exhausted");
}
// Tolerant parse: judges sometimes return valid JSON cut off inside the free-text `reason` (Gemini did on 87 of 725 calls). `relation` and
// `orientation` come BEFORE `reason`, so they are recovered from the text when strict parsing fails. A "same" with no recoverable
// orientation stays unparsable (abstains). Applied identically to every judge; added after the first run, so it is logged as a method fix.
export const parse = (text) => {
  try { const j = JSON.parse((text.match(/\{[\s\S]*\}/) || ["{}"])[0]); if (["same", "partial", "different"].includes(j.relation)) return j; } catch { /* fall through */ }
  const rel = text.match(/"relation"\s*:\s*"(same|partial|different)"/);
  if (!rel) return null;
  const ori = text.match(/"orientation"\s*:\s*(?:"(aligned|swapped)"|null)/);
  if (rel[1] === "same" && !ori) return null;
  return { relation: rel[1], orientation: ori && ori[1] ? ori[1] : null, reason: ((text.match(/"reason"\s*:\s*"([\s\S]*)/) || [])[1] || "").slice(0, 300), recovered: true };
};
// seeded presentation: which disagreement is "1", and whether each one's sides are flipped; mapped back after judging
const present = (p) => {
  const h = sha256("present|" + p.key); const b = (k) => parseInt(h[k], 16) & 1;
  const first = b(0) ? p.y : p.x, second = b(0) ? p.x : p.y;
  const f1 = b(1), f2 = b(2);
  const side = (id, f) => { const s = byId.get(id); return f ? [s.claim_b, s.claim_a] : [s.claim_a, s.claim_b]; };
  return { user: userMessage(side(first, f1), side(second, f2)), flips: f1 ^ f2 };
};

let store = {}; try { store = JSON.parse(fs.readFileSync(VOTES, "utf8")); } catch { /* fresh */ }
let reparsed = 0;
for (const [k, v] of Object.entries(store)) if (v.error === "unparsable" && v.raw) { const j = parse(v.raw); if (j) { store[k] = { relation: j.relation, orientation: j.orientation ?? null, reason: j.reason || "", recovered: true }; reparsed++; } }
if (reparsed) console.log(`re-parsed ${reparsed} stored unparsable votes with the tolerant parser`);
const tasks = pairs.flatMap((p) => PANEL.map((m) => ({ p, m }))).filter(({ p, m }) => !store[`${p.key}::${m.label}`]);
console.log(`judging ${tasks.length} calls (${pairs.length * PANEL.length - tasks.length} cached)`);
let done = 0, errors = 0;
async function worker() {
  while (tasks.length) {
    const { p, m } = tasks.shift(); const { user } = present(p);
    let rec;
    try { const text = await call(m, user); const j = parse(text); rec = j ? { relation: j.relation, orientation: j.orientation ?? null, reason: String(j.reason || "").slice(0, 300) } : { error: "unparsable", raw: text.slice(0, 200) }; }
    catch (e) { errors++; rec = { error: String(e.message).slice(0, 160) }; }
    store[`${p.key}::${m.label}`] = rec;
    if (++done % 60 === 0) { fs.writeFileSync(VOTES, JSON.stringify(store)); console.log(`  ${done} judged, ${errors} errors`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
fs.writeFileSync(VOTES, JSON.stringify(store));

// ── consensus ────────────────────────────────────────────────────────────────
function verdict(p) {
  const { flips } = present(p);
  const votes = PANEL.map((m) => ({ judge: m.label, ...(store[`${p.key}::${m.label}`] || { error: "missing" }) }));
  const cast = votes.filter((v) => v.relation);
  if (cast.length < PANEL.length) return { status: "insufficient", votes };
  if (cast.every((v) => v.relation === "same") && cast.every((v) => v.orientation === cast[0].orientation) && cast[0].orientation) {
    const judgedSwapped = cast[0].orientation === "swapped";
    return { status: "linked", swap: judgedSwapped !== !!flips, votes };
  }
  if (cast.every((v) => v.relation === "different")) return { status: "different", votes };
  return { status: "contested", votes };
}
const results = pairs.map((p) => ({ ...p, ...verdict(p) }));
const tally = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const crossR = results.filter((r) => !r.control), ctl = results.filter((r) => r.control);
const judgeStats = PANEL.map((m) => {
  const per = (rs) => { const c = rs.map((r) => r.votes.find((v) => v.judge === m.label)).filter((v) => v?.relation); return { n: c.length, same: c.filter((v) => v.relation === "same").length }; };
  return { judge: m.label, cross: per(crossR), control: per(ctl), errors: results.filter((r) => !r.votes.find((v) => v.judge === m.label)?.relation).length };
});
const summary = { cross_candidates: tally(crossR), controls: tally(ctl), control_linked_share: ctl.length ? +(ctl.filter((r) => r.status === "linked").length / ctl.length).toFixed(3) : null, judge_stats: judgeStats };
console.log(JSON.stringify(summary, null, 1));

fs.writeFileSync(path.join(ROOT, LINKS_OUT), JSON.stringify({
  schema: "omnarai.tension-identity-links/v0", evidence_status: EVIDENCE_STATUS, built_at: new Date().toISOString(),
  source: { file: SOURCE, sha256: sha256(raw) }, embedding: `${MODEL}@${DIMS}`, candidate_threshold: CAND,
  panel: PANEL.map((m) => m.label), rule: "linked iff all 3 judges say same with identical orientation; errors abstain; <3 votes ⇒ insufficient",
  system_prompt: SYSTEM, summary, pairs: results,
}, null, 1) + "\n");
console.log(`wrote ${LINKS_OUT}`);

// ── identity map from adjudicated links ──────────────────────────────────────
const links = new Map(crossR.filter((r) => r.status === "linked").map((r) => [r.key, { swap: r.swap }]));
const { assignments } = assignByLinks(sightings, links);
const groups = summarize(sightings, assignments);
const recurring = groups.filter((g) => new Set(g.ms.map((m) => m.record_id)).size > 1);
const indicators = {
  sightings: sightings.length, tensions: groups.length, tensions_seen_in_more_than_one_record: recurring.length,
  sightings_in_recurring_tensions: recurring.reduce((n, g) => n + g.ms.length, 0), largest_tension_sightings: Math.max(...groups.map((g) => g.ms.length)),
  largest_tension_records: Math.max(...groups.map((g) => new Set(g.ms.map((m) => m.record_id)).size)),
};
console.log(JSON.stringify(indicators, null, 1));
const sight = (m) => ({ sighting_id: m.sighting_id, record_id: m.record_id, captured_at: m.captured_at, voice_on_side_a: m.swap ? m.voice_b : m.voice_a, voice_on_side_b: m.swap ? m.voice_a : m.voice_b, swap: m.swap, topic: m.topic, status: m.status, founded: m.founded, link_share: m.link_share });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify({
  schema: SCHEMA, evidence_status: EVIDENCE_STATUS,
  warning: "DERIVED and UNREVIEWED. A tension_id is the unanimous judgement of a three-model panel that sightings are the same disagreement, not a ruling. Never cite as established recurrence until reviewed.",
  built_at: new Date().toISOString(), source: { file: SOURCE, sha256: sha256(raw), records: records.length },
  method: { candidates: `${MODEL}@${DIMS}, cross-record, orientation-aware similarity ≥ ${CAND}`, adjudication: "3-model unanimous panel (see links file)", linkage: "chronological, link-share ≥ 0.5, cannot-link same record, tied orientation ⇒ new tension" },
  indicators,
  tensions: groups.map((g) => ({ tension_id: g.tension_id, founded_by: g.ms[0].sighting_id, first_seen: g.ms[0].captured_at, last_seen: g.ms[g.ms.length - 1].captured_at,
    n_sightings: g.ms.length, n_records: new Set(g.ms.map((m) => m.record_id)).size,
    side_a: { claim: g.ms[0].claim_a, voice: g.ms[0].voice_a }, side_b: { claim: g.ms[0].claim_b, voice: g.ms[0].voice_b }, sightings: g.ms.map(sight) })),
}, null, 1) + "\n");
console.log(`wrote ${OUT}`);

// audit: 25 linked (deterministic), plus every contested pair at sim ≥ 0.60 (most informative disagreements)
const audit = ["# Tension-identity v1 audit sample (derived-unreviewed)", "", `Panel: ${PANEL.map((m) => m.label).join(", ")}. Mark Y / N / ? — is the later sighting the same underlying disagreement as the founder?`, ""];
const linkedPairs = crossR.filter((r) => r.status === "linked").sort((a, b) => sha256("audit|" + a.key).localeCompare(sha256("audit|" + b.key))).slice(0, 25);
linkedPairs.forEach((r, i) => { const a = byId.get(r.x), b = byId.get(r.y); audit.push(`## L${i + 1}. sim ${r.sim} — \`${r.x}\` ~ \`${r.y}\`${r.swap ? " (swapped)" : ""}`, `- ${a.topic}: A: ${a.claim_a} / B: ${a.claim_b}`, `- ${b.topic}: A: ${b.claim_a} / B: ${b.claim_b}`, `- Verdict: `, ""); });
audit.push("## Contested at sim ≥ 0.60 (panel did not agree)", "");
crossR.filter((r) => r.status === "contested" && r.sim >= 0.6).slice(0, 15).forEach((r, i) => { const a = byId.get(r.x), b = byId.get(r.y); audit.push(`### C${i + 1}. sim ${r.sim} — votes: ${r.votes.map((v) => `${v.judge.split("-")[0]}=${v.relation || "∅"}`).join(", ")}`, `- A: ${a.claim_a} / B: ${a.claim_b}`, `- A: ${b.claim_a} / B: ${b.claim_b}`, `- Verdict: `, ""); });
fs.writeFileSync(path.join(ROOT, AUDIT), audit.join("\n") + "\n");
console.log(`wrote ${AUDIT}`);
