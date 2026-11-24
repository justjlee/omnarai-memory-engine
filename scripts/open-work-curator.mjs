#!/usr/bin/env node
// Open Work curator tool (decision D-003: the curator registers, admits and binds; there is no public write route).
// Everything defaults to a DRY RUN that prints what it would write. Nothing is written without --yes.
//
//   node scripts/open-work-curator.mjs list                               public problems + pending counts (read-only)
//   node scripts/open-work-curator.mjs register <drafts.json> <draft_key>  write a problem (private until admitted)
//   node scripts/open-work-curator.mjs admit <OMN-WORK-…@r1 | OMN-WE-… | verifier:<slug>> [--note "…"]
//   node scripts/open-work-curator.mjs bind <OMN-WORK-…> <OMN-FP-…> attempt|claim
//                                         binds an ADMITTED footprint to a problem (records the event and admits it)
//   add --yes to write, --env-file <path> to load the production Blob tokens, --curator <name> (default xz).
//
// Registration is a curator decision with a decision-log entry (DL) first. Binding records where a contribution
// sits in a problem's history; it is not verification (tested and reviewed need a verifier receipt / an independent
// review, recorded separately). Design: docs/open-work/DESIGN-OPEN-WORK-DOOR.md.
import { readFileSync } from "node:fs";
import { registerProblem, recordWorkEvent, moderateWorkRecord, loadPublicWork, pendingTowardWork } from "../api/_work-store.js";
import { WORK_PROBLEM_ID_RE, validateProblem, seal, WORK_PROBLEM_SCHEMA, deriveWorkPacket, openWorkRow } from "../api/_work.js";
import { FP_ID_RE, loadPublicFootprints } from "../api/_footprints.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--env-file", "--curator", "--note"].includes(argv[i - 1])));
const [cmd, ...args] = positional;
const write = flag("--yes");
const curator = opt("--curator", "xz");

const envFile = opt("--env-file");
if (envFile) {
  // Minimal loader: KEY=VALUE lines; surrounding quotes and a literal trailing \n are stripped (vercel env pull quirk).
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/\\n$/, "");
  }
}

const say = (...a) => console.log(...a);
const dry = (what, body) => { say(`DRY RUN (add --yes to write): ${what}`); say(JSON.stringify(body, null, 2)); };

async function main() {
  if (cmd === "list") {
    const pub = await loadPublicWork();
    const awaiting = await pendingTowardWork();
    const rows = pub.problems.map((problem) => openWorkRow(deriveWorkPacket({ problem, events: pub.events.filter((e) => e.problem_id === problem.id), publicFootprints: pub.publicFootprints, verifiers: pub.verifiers }), { awaiting: awaiting.get(problem.id) || null }));
    if (!rows.length) say("No public problem.");
    for (const r of rows) say(`${r.id}  ${r.open ? (r.stalled ? "STALLED" : "open") : "closed"}  ${r.progress_rung}  claims:${r.live_claims} refuted:${r.refuted_claims} attempts:${r.attempts} awaiting:${r.awaiting_review?.count ?? 0}  ${r.title}`);
    const orphan = [...awaiting.keys()].filter((id) => !rows.some((r) => r.id === id));
    if (orphan.length) say(`Pending contributions name non-public problems: ${orphan.join(", ")}`);
    return;
  }
  if (cmd === "register") {
    const [file, key] = args;
    if (!file || !key) throw new Error("usage: register <drafts.json> <draft_key>");
    const d = JSON.parse(readFileSync(file, "utf8")).drafts.find((x) => x.draft_key === key);
    if (!d) throw new Error(`no draft with draft_key ${key}`);
    const input = { title: d.title, objective: d.objective, why_it_matters: d.why_it_matters, acceptance_criteria: d.acceptance_criteria, exclusions: d.exclusions || [], open_questions: d.open_questions || [], known_failures: d.known_failures || [], evidence_refs: d.evidence_refs || [] };
    // Validate exactly what would be stored before anything is written (an example id stands in for the minted one).
    const preview = seal({ schema: WORK_PROBLEM_SCHEMA, id: "OMN-WORK-0000000000000-00000000", revision: 1, supersedes_revision: null, ...input, registered_by: { kind: "curator", id: curator }, registered_at: new Date().toISOString() });
    const errors = validateProblem(preview);
    if (errors.length) throw new Error(`draft fails validation: ${errors.join("; ")}`);
    if (!write) return dry(`register problem "${d.title}" (private until admitted)`, input);
    const p = await registerProblem(input, { curator });
    say(`registered ${p.id} r${p.revision} (PRIVATE). Publish it with: admit ${p.id}@r1`);
    return;
  }
  if (cmd === "admit") {
    const [record] = args;
    if (!record) throw new Error("usage: admit <record>");
    if (!write) return dry(`admit ${record} (makes it public)`, { record, action: "admit", curator, note: opt("--note") });
    await moderateWorkRecord({ record, action: "admit", curator, note: opt("--note") });
    say(`admitted ${record}`);
    return;
  }
  if (cmd === "bind") {
    const [problemId, fpId, as] = args;
    if (!WORK_PROBLEM_ID_RE.test(problemId || "") || !FP_ID_RE.test(fpId || "") || !["attempt", "claim"].includes(as)) throw new Error("usage: bind <OMN-WORK-…> <OMN-FP-…> attempt|claim");
    const pub = await loadPublicWork({ includeFootprints: false });
    const problem = pub.problems.find((p) => p.id === problemId);
    if (!problem) throw new Error(`${problemId} is not a public problem`);
    const fp = (await loadPublicFootprints()).publicBodies.find((f) => f.id === fpId);
    if (!fp) throw new Error(`${fpId} is not an ADMITTED footprint: admit the contribution first (Arrivals panel or contribute-approve)`);
    const input = { problem_id: problemId, problem_revision: problem.revision, kind: as === "claim" ? "advance_claimed" : "attempt_recorded", source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 } };
    if (!write) return dry(`bind ${fpId} to ${problemId} as ${as}, then admit the event`, input);
    const ev = await recordWorkEvent(input, { curator });
    await moderateWorkRecord({ record: ev.id, action: "admit", curator, note: opt("--note") });
    say(`bound ${fpId} → ${problemId} as ${as} (event ${ev.id}, admitted)`);
    return;
  }
  say(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 14).join("\n"));
  process.exitCode = cmd ? 2 : 0;
}

main().catch((err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
