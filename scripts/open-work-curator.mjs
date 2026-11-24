#!/usr/bin/env node
// Open Work curator tool (decision D-003: the curator registers, admits and binds; there is no public write route).
// Everything defaults to a DRY RUN that prints what it would write. Nothing is written without --yes.
//
//   node scripts/open-work-curator.mjs list                               public problems + pending counts (read-only)
//   node scripts/open-work-curator.mjs register <drafts.json> <draft_key>  write a problem (private until admitted)
//   node scripts/open-work-curator.mjs admit <OMN-WORK-…@r1 | OMN-WE-… | verifier:<slug>> [--note "…"]
//   node scripts/open-work-curator.mjs bind <OMN-WORK-…> <OMN-FP-…> attempt|claim [--kind advance|elimination] [--candidate <n>]
//                                         binds an ADMITTED footprint to a problem (records the event and admits it);
//                                         a claim may say which success-contract candidate it supports or eliminates
//   node scripts/open-work-curator.mjs register-verifier crux-reask        the crux check (scripts/lib/crux-core.mjs)
//   node scripts/open-work-curator.mjs record-receipt <OMN-WORK-…> <OMN-WE-claim> <receipt.json>
//                                         a sealed verifier receipt → advance_tested (pass/inconclusive/error) or
//                                         advance_refuted (fail); the projection decides what it changes
//   add --yes to write, --env-file <path> to load the production Blob tokens, --curator <name> (default xz).
//
// Registration is a curator decision with a decision-log entry (DL) first. Binding records where a contribution
// sits in a problem's history; it is not verification (tested and reviewed need a verifier receipt / an independent
// review, recorded separately). Design: docs/open-work/DESIGN-OPEN-WORK-DOOR.md.
import { readFileSync } from "node:fs";
import { registerProblem, registerVerifier, recordWorkEvent, moderateWorkRecord, loadPublicWork, pendingTowardWork } from "../api/_work-store.js";
import { WORK_PROBLEM_ID_RE, WORK_EVENT_ID_RE, validateProblem, validateReceipt, isIntact, seal, WORK_PROBLEM_SCHEMA, deriveWorkPacket, openWorkRow, CLAIM_KINDS } from "../api/_work.js";
import { CRUX_VERIFIER } from "./lib/crux-core.mjs";
import { FP_ID_RE, loadPublicFootprints } from "../api/_footprints.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--env-file", "--curator", "--note", "--kind", "--candidate"].includes(argv[i - 1])));
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
    for (const r of rows) say(`${r.id}  ${r.open ? (r.stalled ? "STALLED" : "open") : "closed"}  ${r.progress_rung}  claims:${r.live_claims} refuted:${r.refuted_claims} attempts:${r.attempts} awaiting:${r.awaiting_review?.count ?? 0} milestones:${r.milestones.met}/${r.milestones.total}${r.candidates ? ` candidates(open/elim/supp):${r.candidates.open}/${r.candidates.eliminated}/${r.candidates.supported}` : ""}  ${r.title}`);
    const orphan = [...awaiting.keys()].filter((id) => !rows.some((r) => r.id === id));
    if (orphan.length) say(`Pending contributions name non-public problems: ${orphan.join(", ")}`);
    return;
  }
  if (cmd === "register") {
    const [file, key] = args;
    if (!file || !key) throw new Error("usage: register <drafts.json> <draft_key>");
    const d = JSON.parse(readFileSync(file, "utf8")).drafts.find((x) => x.draft_key === key);
    if (!d) throw new Error(`no draft with draft_key ${key}`);
    const input = { title: d.title, objective: d.objective, why_it_matters: d.why_it_matters, ...(d.success_contract ? { success_contract: d.success_contract } : {}), acceptance_criteria: d.acceptance_criteria, exclusions: d.exclusions || [], open_questions: d.open_questions || [], known_failures: d.known_failures || [], evidence_refs: d.evidence_refs || [] };
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
    const claimKind = opt("--kind"), candidate = opt("--candidate");
    if ((claimKind || candidate != null) && as !== "claim") throw new Error("--kind and --candidate apply to a claim");
    if (claimKind && !CLAIM_KINDS.includes(claimKind)) throw new Error(`--kind must be one of ${CLAIM_KINDS.join(", ")}`);
    const cand = candidate == null ? null : Number(candidate);
    if (cand != null && !(Number.isInteger(cand) && cand >= 0 && cand < (problem.success_contract?.candidates?.length || 0))) throw new Error(`--candidate must index the problem's success_contract.candidates (0..${(problem.success_contract?.candidates?.length || 0) - 1})`);
    const input = { problem_id: problemId, problem_revision: problem.revision, kind: as === "claim" ? "advance_claimed" : "attempt_recorded", source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 }, ...(claimKind ? { claim_kind: claimKind } : {}), ...(cand != null ? { candidate: cand } : {}) };
    if (!write) return dry(`bind ${fpId} to ${problemId} as ${as}, then admit the event`, input);
    const ev = await recordWorkEvent(input, { curator });
    await moderateWorkRecord({ record: ev.id, action: "admit", curator, note: opt("--note") });
    say(`bound ${fpId} → ${problemId} as ${as} (event ${ev.id}, admitted)`);
    return;
  }
  if (cmd === "register-verifier") {
    const [which] = args;
    if (which !== CRUX_VERIFIER.id) throw new Error(`known verifiers: ${CRUX_VERIFIER.id}`);
    if (!write) return dry(`register verifier ${which}, then admit it (verifier:${which})`, CRUX_VERIFIER);
    await registerVerifier(CRUX_VERIFIER, { curator });
    await moderateWorkRecord({ record: `verifier:${which}`, action: "admit", curator, note: opt("--note") });
    say(`registered and admitted verifier:${which}`);
    return;
  }
  if (cmd === "record-receipt") {
    const [problemId, claimEventId, file] = args;
    if (!WORK_PROBLEM_ID_RE.test(problemId || "") || !WORK_EVENT_ID_RE.test(claimEventId || "") || !file) throw new Error("usage: record-receipt <OMN-WORK-…> <OMN-WE-claim> <receipt.json>");
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    const errors = validateReceipt(receipt);
    if (errors.length || !isIntact(receipt)) throw new Error(`receipt is invalid or altered: ${errors.join("; ") || "integrity"}`);
    if (receipt.subject.claim_event_id !== claimEventId) throw new Error(`the receipt is about ${receipt.subject.claim_event_id}, not ${claimEventId}`);
    const pub = await loadPublicWork({ includeFootprints: false });
    const problem = pub.problems.find((p) => p.id === problemId);
    if (!problem) throw new Error(`${problemId} is not a public problem`);
    const input = { problem_id: problemId, problem_revision: problem.revision, kind: receipt.result === "fail" ? "advance_refuted" : "advance_tested", claim_event_id: claimEventId, receipt };
    if (!write) return dry(`record a ${receipt.result} receipt on ${claimEventId} as ${input.kind}, then admit the event`, { ...input, receipt: { id: receipt.id, result: receipt.result, scope_note: receipt.scope_note } });
    const ev = await recordWorkEvent(input, { curator });
    await moderateWorkRecord({ record: ev.id, action: "admit", curator, note: opt("--note") });
    say(`recorded ${receipt.result} receipt on ${claimEventId} as ${input.kind} (event ${ev.id}, admitted)`);
    return;
  }
  say(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 22).join("\n"));
  process.exitCode = cmd ? 2 : 0;
}

main().catch((err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
