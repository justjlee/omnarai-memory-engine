#!/usr/bin/env node
// migrate-claims.mjs — Claims Registry 0.8.0 → 1.0.0 (minimal profile).
//
// Extended from code/migrate-claims.mjs in Muse's 2026-10-14 handoff package
// (Work Item 2). Normative basis: Claims Registry Specification v1.0, Appendix C.
// What the package version could not do honestly, and this one does from the
// registry's own git history (every date below cites the commit that proves it):
//   - versions[1] is the ORIGINAL wording, not today's (one claim was reworded
//     on 2026-07-15 and the package version would have erased the original);
//   - created_at is when each claim entered the registry (not one seed date for all);
//   - closed_at is when the registry recorded each refutation (not null);
//   - status_history is reconstructed from the commits (spec R2.4);
//   - objections become objects with their text VERBATIM (four claims stored
//     them as one paragraph — each stays one objection), dated by first
//     appearance; raised_by stays unrecorded rather than defaulting to the
//     maintainer (the record never said who raised them);
//   - the output is validated against the published schema, not a subset.
//
// Curator decisions (xz, 2026-10-15) are in DECISIONS below and restated in the
// report. The input is never mutated; outputs go to --out.
//
//   node scripts/migrate-claims.mjs --migrated-at 2026-10-15     (reproduces the committed 1.0.0 files)
//   node scripts/migrate-claims.mjs [--from <git rev>] [--migrated-at YYYY-MM-DD] [--out DIR]
//
// Exit: 0 ok · 1 output fails validation · 2 usage / git / parse error.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./lib/json-schema-lite.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILE = "public/claims.json";
const TERMINAL = new Set(["confirmed", "refuted", "scoped", "superseded", "withdrawn"]);

// ── Curator decisions (xz, 2026-10-15, in the Claude Code session) ───────────
export const DECISIONS = {
  decided_by: "xz",
  decided_at: "2026-10-15",
  // Spec C.1 says the curator rates every migrated objection. Decision: rate
  // only where a rating decides something today — the replicated claim, whose
  // level an unanswered HIGH objection would invalidate (R4.3). Everything else
  // migrates as "unrated"; every NEW objection must be rated (schema-enforced).
  objection_ratings: { "divergence-improves-reasoning": ["medium", "medium"] },
  // Spec R2.5 requires a curator-written scope. Decision: deferred to v1.1;
  // migrated claims carry scope: null ("not yet written"); new claims must have one.
  scope: "deferred to v1.1",
  // Spec C.2 maps open+replicated → confirmed. Decision: keep "open". No
  // confirmation verdict was ever recorded, and confirmation "is a verdict, not
  // a clerical step" (R4.4); it waits on scope and objections.
  replicated_status: "open",
};

function fail(msg) { console.error(`migrate-claims: ${msg}`); process.exit(2); }
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? fail(`${name} needs a value`) : dflt; };
// The last commit that changed the 0.8.0 file — pinned so the migration stays
// reproducible after claims.json itself becomes 1.0.0.
const FROM = opt("--from", "7c0901b");
const MIGRATED_AT = opt("--migrated-at", new Date().toISOString().slice(0, 10));
const OUT = opt("--out", join(ROOT, "public"));

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 << 20 });
let legacy;
let commits;
try {
  legacy = JSON.parse(git("show", `${FROM}:${FILE}`));
  commits = git("log", "--reverse", "--format=%H%x09%aI%x09%h%x09%s", FROM, "--", FILE).trim().split("\n").map((l) => {
    const [full, date, sha, subject] = l.split("\t");
    return { full, at: new Date(date).toISOString(), sha, subject };
  });
} catch (e) { fail(`git history unavailable: ${e.message.split("\n")[0]}`); }
if (!String(legacy.registry_version).startsWith("0.")) fail(`${FROM}:${FILE} is registry ${legacy.registry_version}, not a 0.x registry`);

// ── Reconstruct each claim's timeline from every committed registry ──────────
const asList = (o) => (o == null ? [] : Array.isArray(o) ? o : [o]);
const v1Status = (c) => (c.evidence_level === "refuted" || /^closed-refuted-/.test(c.status || "") ? "refuted" : "open");
const timeline = {};
for (const cm of commits) {
  const reg = JSON.parse(git("show", `${cm.full}:${FILE}`));
  for (const c of reg.claims || []) {
    const t = (timeline[c.claim_id] ||= { created: null, wordings: [], statuses: [], objectionFirst: new Map(), objectionEdits: [], prev: null });
    if (!t.created) t.created = { ...cm, registry_version: reg.registry_version };
    if (t.wordings.at(-1)?.wording !== c.wording) t.wordings.push({ wording: c.wording, ...cm });
    const s = v1Status(c);
    if (t.statuses.at(-1)?.to !== s) t.statuses.push({ from: t.statuses.at(-1)?.to ?? null, to: s, ev: c.evidence_level, prevEv: t.prev?.evidence_level ?? null, ...cm, registry_version: reg.registry_version });
    const objs = asList(c.known_objections);
    for (const o of objs) if (!t.objectionFirst.has(o)) t.objectionFirst.set(o, cm);
    if (t.prev) {
      const before = asList(t.prev.known_objections);
      const removed = before.filter((o) => !objs.includes(o));
      if (removed.length) t.objectionEdits.push({ ...cm, removed, added: objs.filter((o) => !before.includes(o)) });
    }
    t.prev = c;
  }
}

// ── Migrate ──────────────────────────────────────────────────────────────────
const report = [];
const migrated = [];
for (const c of legacy.claims) {
  const id = c.claim_id;
  const t = timeline[id];
  if (!t) fail(`${id} has no history at ${FROM}`);
  const lines = [];
  const legacyStatus = c.status;
  let status = v1Status(c);
  if (status === "open" && c.evidence_level === "replicated") lines.push(`status: "open" kept (curator decision ${DECISIONS.decided_at}: no confirmation verdict was ever recorded; spec C.2 would map it to "confirmed")`);

  const versions = t.wordings.map((w, i) => ({
    version: i + 1, wording: w.wording, changed_at: w.at, changed_by: c.maintainer,
    reason: i === 0
      ? `Registered in claims.json ${t.created.registry_version} (git ${w.sha}: "${w.subject}").`
      : `Reworded in git ${w.sha}: "${w.subject}". Reconstructed at migration from the registry's git history.`,
  }));
  if (versions.at(-1).wording !== c.wording) fail(`${id}: reconstructed wording history does not end at the current wording`);
  lines.push(versions.length === 1
    ? `versions: 1 entry — wording unchanged since registration (${t.created.sha}, ${t.created.at.slice(0, 10)})`
    : `versions: ${versions.length} entries from git — ORIGINAL wording kept as v1; changed in ${versions.slice(1).map((v, i) => `${t.wordings[i + 1].sha} (${v.changed_at.slice(0, 10)})`).join(", ")}`);

  const status_history = t.statuses.map((s) => ({
    from: s.from, to: s.to, changed_at: s.at, changed_by: c.maintainer,
    reason: s.from === null
      ? `Registered in claims.json ${s.registry_version} at evidence_level "${s.ev}" (git ${s.sha}: "${s.subject}"). Reconstructed at migration.`
      : `evidence_level ${s.prevEv} → ${s.ev} recorded in git ${s.sha}: "${s.subject}". Reconstructed at migration.`,
    evidence_ref: `git:${s.sha}`,
  }));
  if (status_history.at(-1).to !== status) fail(`${id}: reconstructed status history ends at ${status_history.at(-1).to}, expected ${status}`);
  lines.push(`status: "${legacyStatus}" → "${status}" · status_history: ${status_history.map((s) => `${s.from ?? "∅"}→${s.to} ${s.changed_at.slice(0, 10)} (${s.evidence_ref.slice(4)})`).join(", ")}`);

  let closed_at = null;
  let closed_reason = null;
  if (TERMINAL.has(status)) {
    const dated = /^closed-refuted-(\d{4}-\d{2}-\d{2})$/.exec(legacyStatus || "");
    const recorded = status_history.findLast((s) => s.to === status);
    if (dated) {
      closed_at = `${dated[1]}T00:00:00.000Z`;
      closed_reason = `Refuted; the decisive evidence is in evidence_note. Closure date ${dated[1]} comes from the legacy status "${legacyStatus}" (date only); the registry recorded the refutation in git ${recorded.evidence_ref.slice(4)} on ${recorded.changed_at.slice(0, 10)}.`;
      lines.push(`closed_at ${closed_at} — from the legacy dated status (registry entry ${recorded.changed_at.slice(0, 10)})`);
    } else {
      closed_at = recorded.changed_at;
      closed_reason = `Refuted; the decisive evidence is in evidence_note. Closure date = when this registry recorded the refutation (git ${recorded.evidence_ref.slice(4)}); the legacy status "${legacyStatus}" carried no closure date.`;
      lines.push(`closed_at ${closed_at.slice(0, 16)}Z — the commit that recorded the refutation (${recorded.evidence_ref.slice(4)}); legacy status "${legacyStatus}" had no date`);
    }
  }

  const rawObjections = asList(c.known_objections);
  if (!Array.isArray(c.known_objections)) lines.push(`known_objections: stored as ONE string in 0.8.0 → one objection object, text verbatim (not split)`);
  const ratings = DECISIONS.objection_ratings[id] || [];
  const known_objections = rawObjections.map((text, i) => {
    const first = t.objectionFirst.get(text);
    const rated = ratings[i];
    return {
      objection: text,
      severity: rated || "unrated",
      status: "open",
      date: first.at.slice(0, 10),
      "x-legacy": {
        source: `claims.json ${legacy.registry_version}`,
        first_recorded: `git:${first.sha}`,
        note: "status \"open\" is the spec C.1 migration default, not a review; raised_by was never recorded.",
      },
      ...(rated ? { "x-rating": { rated_by: DECISIONS.decided_by, rated_at: DECISIONS.decided_at, basis: "rated at migration; the objection text predates the rating" } } : {}),
    };
  });
  lines.push(`known_objections: ${known_objections.length} — severity ${ratings.length ? `rated by ${DECISIONS.decided_by} (${ratings.join(", ")})` : "unrated (curator decision)"}; dated by first appearance (${[...new Set(known_objections.map((o) => o.date))].join(", ")})`);
  for (const e of t.objectionEdits) {
    lines.push(`PRE-1.0 IN-PLACE EDIT found in git ${e.sha} (${e.at.slice(0, 10)}, "${e.subject}"): objection text replaced — the earlier text is preserved in git and quoted in the appendix of this report`);
  }

  const out = {
    claim_id: id,
    wording: c.wording,
    version: versions.length,
    scope: null,
    evidence_level: c.evidence_level,
    evidence_note: c.evidence_note,
    falsification_conditions: c.falsification_conditions,
    precommitments: [],
    known_objections,
    required_experiment: c.required_experiment,
    maintainer: c.maintainer,
    status,
    status_history,
    closed_at,
    closed_reason,
    provenance: { created_at: t.created.at, created_by: c.maintainer, source_claims: [], supersedes: null, legacy_status: legacyStatus },
    versions,
  };
  lines.push(`provenance.created_at ${t.created.at.slice(0, 10)} (${t.created.sha}) · legacy_status kept verbatim · scope null (deferred to v1.1) · precommitments [] (none was digest-frozen at the time; spec C.1 forbids adding one retroactively) · source_claims [] (not yet reviewed)`);

  const carried = ["claim_id", "wording", "evidence_level", "evidence_note", "falsification_conditions", "known_objections", "required_experiment", "maintainer", "status"];
  const unknown = Object.keys(c).filter((k) => !carried.includes(k));
  if (unknown.length) fail(`${id}: 0.8.0 field(s) with no 1.0 home: ${unknown.join(", ")} — refusing to drop them silently`);
  for (const k of ["wording", "evidence_level", "evidence_note", "falsification_conditions", "required_experiment", "maintainer"]) {
    if (out[k] !== c[k]) fail(`${id}: ${k} changed during migration`);
  }
  migrated.push(out);
  report.push({ id, lines, edits: t.objectionEdits });
}

const STATUSES = {
  proposed: { live: true, terminal: false, meaning: "Registered, not yet admitted to testing." },
  open: { live: true, terminal: false, meaning: "Held at its evidence_level. No verdict has been issued." },
  under_test: { live: true, terminal: false, meaning: "A decisive test is running or pre-registered." },
  confirmed: { live: true, terminal: true, meaning: "Verdict: supported at its stated scope and evidence_level." },
  scoped: { live: true, terminal: true, meaning: "Verdict: survives only at a reduced scope (see scope)." },
  refuted: { live: false, terminal: true, meaning: "Verdict: a fair test came back negative. Retained for the record at full prominence; NOT asserted." },
  superseded: { live: false, terminal: true, meaning: "Replaced by another claim (provenance.supersedes on the successor). Retained, not asserted." },
  withdrawn: { live: false, terminal: true, meaning: "Withdrawn by the curator. Retained, not asserted." },
};

const envelope = {
  _about: `${legacy._about} Since v1.0.0 (${MIGRATED_AT}) this file follows the minimal profile of the Claims Registry Specification v1.0: \`status\` is the lifecycle (live or dead is readable from status alone — see _statuses), \`evidence_level\` is the evidence, an independent axis; wording, status and objections change only by appending to their histories. Schema: /schemas/claims-registry-1.0.0.schema.json. The 0.8.0 file is frozen at /claims/v0.8.0.json; the migration is accounted for claim by claim in /claims/migration-1.0.0.md.`,
  _evidence_levels: legacy._evidence_levels,
  _statuses: STATUSES,
  claims_registry_version: "1.0.0",
  registry_version: "1.0.0",
  registry_name: "Omnarai Claims Registry",
  registry_uri: "https://engine.omnarai.org/claims.json",
  curators: [DECISIONS.decided_by],
  updated_at: MIGRATED_AT,
  migrated_from: legacy.registry_version,
  previous_versions: [`https://engine.omnarai.org/claims/v${legacy.registry_version}.json`],
  claims: migrated,
};

const schema = JSON.parse(readFileSync(join(ROOT, "public/schemas/claims-registry-1.0.0.schema.json"), "utf8"));
const errors = validate(schema, envelope);

// ── Report ───────────────────────────────────────────────────────────────────
const live = migrated.filter((c) => STATUSES[c.status].live).length;
const R = [];
R.push(`# Claims registry migration ${legacy.registry_version} → 1.0.0`, "");
R.push(`Migrated ${MIGRATED_AT} from \`${FILE}\` at git \`${git("rev-parse", "--short", FROM).trim()}\` (${legacy.claims.length} claims) by \`scripts/migrate-claims.mjs\`, reconstructing dates and history from the ${commits.length} commits that touched the registry. The ${legacy.registry_version} file is frozen, unchanged, at [/claims/v${legacy.registry_version}.json](/claims/v${legacy.registry_version}.json). Schema validation: **${errors.length ? `${errors.length} ERROR(S)` : "valid"}** against [/schemas/claims-registry-1.0.0.schema.json](/schemas/claims-registry-1.0.0.schema.json).`, "");
R.push(`**Result:** ${live} live · ${migrated.length - live} dead (refuted), readable from \`status\` alone. No wording, evidence level, evidence note, falsifier, required experiment or maintainer changed; every ${legacy.registry_version} field is accounted for below.`, "");
R.push("## Curator decisions", "");
R.push(`- **Objection severity** (spec C.1 asks for all): rated only on \`divergence-improves-reasoning\` (both **medium**, by ${DECISIONS.decided_by}, ${DECISIONS.decided_at}) — the one claim where a rating decides something today (R4.3). The other ${migrated.reduce((n, c) => n + c.known_objections.filter((o) => o.severity === "unrated").length, 0)} migrate as \`unrated\`; the schema refuses an unrated objection on anything new.`);
R.push(`- **Scope** (spec R2.5): deferred to v1.1. Migrated claims carry \`scope: null\` ("not yet written"); the schema requires a scope on every new claim.`);
R.push(`- **The replicated claim stays \`open\`**: spec C.2 would map it to \`confirmed\`, but no confirmation verdict was ever recorded and confirmation is "a verdict, not a clerical step" (R4.4).`, "");
R.push("## Deviations from the specification (deliberate)", "");
R.push("- R2.5 read literally would hold every claim without a scope at `proposed` — including the six refutations, which would bury them. Refutations follow the C.2 mapping instead.");
R.push("- C.1 defaults `raised_by` to the maintainer and `date` to the migration date. Neither is true of these objections: `raised_by` is left unrecorded, and `date` is when the text first appeared in the registry.");
R.push("- `unrated` is not in the spec's severity list. It exists only for migrated objections (marked `x-legacy`).", "");
R.push("## Field accounting (0.8.0 → 1.0.0)", "");
R.push("| 0.8.0 | 1.0.0 |", "|---|---|");
R.push("| `registry_version` | `claims_registry_version` + `registry_version` (legacy alias), both `1.0.0`; `migrated_from: \"0.8.0\"` |");
R.push("| `_about`, `_evidence_levels` | kept (about extended with the 1.0 rules); `_statuses` added |");
R.push("| `claim_id`, `wording`, `evidence_level`, `evidence_note`, `falsification_conditions`, `required_experiment`, `maintainer` | copied verbatim |");
R.push("| `status` | lifecycle `status`; the old value kept verbatim in `provenance.legacy_status`; closure in `closed_at` + `closed_reason`; transitions in `status_history` |");
R.push("| `known_objections` (strings, or one string) | objects; `objection` text verbatim; severity / status / date as described; provenance in `x-legacy` |");
R.push("| — | added: `version`, `versions[]`, `scope` (null), `precommitments` ([]), `provenance` |", "");
R.push("## Claim by claim", "");
for (const r of report) { R.push(`### ${r.id}`, ""); for (const l of r.lines) R.push(`- ${l}`); R.push(""); }
const edits = report.filter((r) => r.edits.length);
if (edits.length) {
  R.push("## Appendix — objection text edited in place before 1.0", "");
  R.push("Before 1.0 nothing stopped an objection from being edited in place. These edits are in git; the earlier text is quoted here so the record carries it. From 1.0 on, `scripts/check-claims-registry.mjs` refuses any change to published objection text.", "");
  for (const r of edits) for (const e of r.edits) {
    R.push(`**${r.id}** — git \`${e.sha}\` (${e.at.slice(0, 10)}): "${e.subject}"`, "");
    for (const o of e.removed) R.push(`> before: ${o}`, "");
    for (const o of e.added) R.push(`> after: ${o}`, "");
  }
}
if (errors.length) { R.push("## Validation errors", ""); for (const e of errors) R.push(`- ${e}`); R.push(""); }

mkdirSync(join(OUT, "claims"), { recursive: true });
writeFileSync(join(OUT, "claims.json"), JSON.stringify(envelope, null, 2) + "\n");
writeFileSync(join(OUT, "claims", "migration-1.0.0.md"), R.join("\n"));
writeFileSync(join(OUT, "claims", `v${legacy.registry_version}.json`), git("show", `${FROM}:${FILE}`));
console.log(`migrated ${migrated.length} claims (${live} live, ${migrated.length - live} dead) → ${join(OUT, "claims.json")}`);
console.log(`report → ${join(OUT, "claims", "migration-1.0.0.md")} · frozen ${legacy.registry_version} → ${join(OUT, "claims", `v${legacy.registry_version}.json`)}`);
if (errors.length) { console.error(`${errors.length} validation error(s):\n  ${errors.slice(0, 20).join("\n  ")}`); process.exit(1); }
