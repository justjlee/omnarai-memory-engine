#!/usr/bin/env node
// The crux check: the registered verifier ("crux-reask") for the Open Work problem on the certified intervention split.
// Rules: scripts/lib/crux-core.mjs (fixed before any run; every receipt carries their sha256).
//
//   node scripts/crux-check.mjs plan --text-file <proposal.md> | --footprint <OMN-FP-…> [--base <engine>]     $0
//   node scripts/crux-check.mjs baseline --out <dir> --yes --env-file <keys> [--env-file <more keys>]   (15 calls)
//   node scripts/crux-check.mjs run --out <dir> --footprint <OMN-FP-…> --claim-event <OMN-WE-…> [--problem <OMN-WORK-…>]
//                                   --yes --env-file <keys>                         one proposal or elimination (30 calls)
//   node scripts/crux-check.mjs score --out <dir>                                    rescore saved replies offline, $0
//
// Paid modes refuse without --yes, without provider keys in --env-file, and without a reservation on the engine's
// shared $ ledger (scripts/budget-preflight.mjs --reserve, which needs BLOB_READ_WRITE_TOKEN in the same file). Every
// reply is saved verbatim (replies.jsonl) before anything is scored. A run writes receipt.json (sealed, verifier-receipt
// /1.0); the curator records it with scripts/open-work-curator.mjs record-receipt. Nothing here writes to the engine.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as X from "./lib/crux-core.mjs";
import { seal, mintReceiptId, validateReceipt } from "../api/_work.js";
import { hashFootprint } from "../api/_footprints.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Library (exported for tests; no I/O beyond the injected callModel) ─────────────────────────────────
/** Ask every panel model `runs` times. callModel(member, {system, user, cap}) → {ok, text, cost_usd, refusal?, usage?}. */
export async function askPanel({ callModel, prompt, runs = X.RULES.runs_per_cell, onReply = () => {} }) {
  const decisions = {};
  let cost = 0;
  await Promise.all(X.PANEL.map(async (m) => {
    const ds = [];
    for (let i = 0; i < runs; i++) {
      const r = await callModel({ model_id: m.model_id, provider: m.provider }, { system: X.SYSTEM, user: prompt, cap: X.RULES.max_output_tokens });
      const d = r?.ok ? X.parseDecision(r.text) : X.UNCLEAR;
      cost += r?.cost_usd || 0;
      ds.push(d);
      onReply({ label: m.label, model_id: m.model_id, run: i + 1, ok: Boolean(r?.ok), decision: d, text: r?.text || "", truncated: r?.truncated ?? null, refusal: r?.refusal ?? null, resolved_model: r?.resolved ?? null, usage: r?.usage ?? null, cost_usd: r?.cost_usd ?? 0 });
    }
    decisions[m.label] = ds;
  }));
  return { decisions, cost_usd: cost };
}

/** One check: the premise stipulated true and false. An elimination tests its candidate's text. */
export async function runCheck({ callModel, proposal, candidateText = null, baseline = null, onReply = () => {} }) {
  const premise = proposal.kind === "elimination" ? candidateText : proposal.crux;
  if (!premise) throw new Error("no premise to test (an elimination needs the candidate's text)");
  if (proposal.kind === "advance" && !baseline) throw new Error("an advance is scored against a baseline: run `baseline` first");
  const [T, F] = await Promise.all([
    askPanel({ callModel, prompt: X.stipulatedPrompt(premise, true), onReply: (r) => onReply({ ...r, condition: "if_true" }) }),
    askPanel({ callModel, prompt: X.stipulatedPrompt(premise, false), onReply: (r) => onReply({ ...r, condition: "if_false" }) }),
  ]);
  const cells = Object.fromEntries(X.LABELS.map((l) => [l, { if_true: T.decisions[l], if_false: F.decisions[l] }]));
  const score = proposal.kind === "elimination" ? X.scoreElimination({ cells }) : X.scoreAdvance(proposal, { baseline, cells });
  return { premise, cells, score, cost_usd: T.cost_usd + F.cost_usd };
}

/** The sealed verifier receipt for one scored check. */
export function sealedReceipt(score, ctx, bytes = randomBytes(4)) {
  const body = { ...X.receiptBody(score, ctx), id: mintReceiptId(Date.parse(ctx.executedAt), bytes) };
  const errors = validateReceipt(body);
  if (errors.length) throw new Error(`receipt invalid: ${errors.join("; ")}`);
  return seal(body);
}

/** A public footprint as served (/api/footprints?id=): strip projection fields and check its hash before use. */
export function verifiedFootprint(served) {
  const { href, position, ...body } = served || {}; void href; void position;
  if (!body.integrity?.content_sha256 || hashFootprint(body) !== body.integrity.content_sha256) throw new Error("footprint hash does not match its body: refusing to test it");
  return body;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const base = (val("--base") || "https://engine.omnarai.org").replace(/\/$/, "");
  const outDir = val("--out");
  const today = new Date().toISOString().slice(0, 10);
  const say = (...a) => console.log(...a);
  const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1) + "\n");

  async function getJson(url) {
    const r = await fetch(url, { headers: { accept: "application/json", "x-omnarai-self": "1" } });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  }
  async function loadProposal() {
    if (val("--text-file")) return { text: fs.readFileSync(val("--text-file"), "utf8"), footprint: null };
    const id = val("--footprint");
    if (!id) throw new Error("pass --footprint <OMN-FP-…> (an ADMITTED footprint) or --text-file <file>");
    const fp = verifiedFootprint((await getJson(`${base}/api/footprints?id=${encodeURIComponent(id)}`)).footprint);
    return { text: fp.content.answer, footprint: fp };
  }
  async function priceTable() {
    const { priceOf } = await import("./lib/utility-v2-core.mjs");
    return Object.fromEntries(X.PANEL.map((m) => [m.model_id, priceOf(m.model_id, today)]));
  }
  // --env-file may be given more than once (the provider keys and the private-store token can live in different
  // files); the first file that names a key wins. The budget ledger is private storage (DL-0043), so a reservation
  // needs PRIVATE_BLOB_READ_WRITE_TOKEN as well as BLOB_READ_WRITE_TOKEN.
  const KEY_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY", "BLOB_READ_WRITE_TOKEN", "PRIVATE_BLOB_READ_WRITE_TOKEN"];
  const envFiles = argv.flatMap((a, i) => (a === "--env-file" && argv[i + 1] ? [argv[i + 1]] : []));
  async function keysFrom(files) {
    const KEYS = {};
    if (!files.length) return KEYS;
    const { envValue } = await import("./lib/env-value.mjs");
    for (const file of files) {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
        if (m && KEY_NAMES.includes(m[1]) && !KEYS[m[1]]) KEYS[m[1]] = envValue(m[2]);
      }
    }
    return KEYS;
  }
  function reserve(usd, label, KEYS) {
    if (!KEYS.BLOB_READ_WRITE_TOKEN || !KEYS.PRIVATE_BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN and PRIVATE_BLOB_READ_WRITE_TOKEN are needed (from any --env-file) to reserve on the shared ledger, so nothing is spent");
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/budget-preflight.mjs"), "--reserve", String(Math.ceil(usd * 100) / 100), "--label", label], { stdio: "inherit", env: { ...process.env, BLOB_READ_WRITE_TOKEN: KEYS.BLOB_READ_WRITE_TOKEN, PRIVATE_BLOB_READ_WRITE_TOKEN: KEYS.PRIVATE_BLOB_READ_WRITE_TOKEN }, cwd: ROOT });
    if (r.status !== 0) throw new Error("the shared ledger refused the reservation: nothing spent");
  }
  async function paidRunner(KEYS) {
    if (!argv.includes("--yes")) throw new Error("paid mode: add --yes (and --env-file <keys>) to spend; nothing was called");
    if (!outDir) throw new Error("pass --out <dir>");
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY"]) if (!KEYS[k]) throw new Error(`missing ${k} in --env-file`);
    fs.mkdirSync(outDir, { recursive: true });
    const { createRunner } = await import("./lib/utility-v2-run.mjs");
    return createRunner({ runDir: outDir, keys: KEYS, log: () => {} });
  }
  const replyLog = (file) => (r) => fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...r }) + "\n");

  (async () => {
    if (mode === "plan") {
      const { text } = await loadProposal();
      const p = X.parseProposal(text);
      if (!p.ok) { say(`Not a valid proposal: ${p.errors.join("; ")}\nExpected the LAST \`\`\`json block to be:\n${JSON.stringify(X.PROPOSAL_TEMPLATE, null, 2)}\nor {"eliminate": <candidate index>}`); process.exitCode = 2; return; }
      const prices = await priceTable();
      const runs = X.RULES.runs_per_cell;
      say(`Proposal kind: ${p.kind}${p.kind === "elimination" ? ` (candidate ${p.candidate})` : `\nPremise: ${p.crux}`}`);
      say(`Rules ${X.CRUX_RULES_VERSION} · sha256 ${X.RULES_SHA256}`);
      say(`System prompt:\n${X.SYSTEM}\n\nPrompt (premise TRUE):\n${X.stipulatedPrompt(p.kind === "elimination" ? `<candidate ${p.candidate}>` : p.crux, true)}`);
      say(`\nCalls: ${X.PANEL.length} models × 2 stipulations × ${runs} = ${X.PANEL.length * 2 * runs}; worst case $${X.worstCaseUsd({ calls: 2 * runs, prices }).toFixed(3)} at ${today} prices. A baseline (if not yet run): ${X.PANEL.length * runs} calls, worst case $${X.worstCaseUsd({ calls: runs, prices }).toFixed(3)}.`);
      return;
    }
    if (mode === "baseline") {
      const KEYS = await keysFrom(envFiles);
      const runner = await paidRunner(KEYS);
      const prices = await priceTable();
      reserve(X.worstCaseUsd({ calls: X.RULES.runs_per_cell, prices }), "crux-check baseline (Open Work)", KEYS);
      const r = await X_askBaseline(runner);
      const split = X.baselineSplit(r.decisions);
      writeJson(path.join(outDir, "baseline.json"), { rules_version: X.CRUX_RULES_VERSION, rules_sha256: X.RULES_SHA256, at: new Date().toISOString(), decisions: r.decisions, split, cost_usd: r.cost_usd });
      say(`Baseline: ${split.per_model.map((m) => `${m.label} ${m.decision}${m.stable ? "" : " (unstable)"}`).join(" · ")}\nToday's panel ${split.split ? "STILL SPLITS" : "does NOT split"} (${split.rule}). Spent ~$${r.cost_usd.toFixed(3)}.`);
      return;
    }
    if (mode === "run") {
      const KEYS = await keysFrom(envFiles);
      const claimEvent = val("--claim-event");
      if (!claimEvent) throw new Error("pass --claim-event <OMN-WE-…>: the claim this receipt is about");
      const { text, footprint } = await loadProposal();
      if (!footprint) throw new Error("a receipt needs the ADMITTED footprint (--footprint), not a text file");
      const proposal = X.parseProposal(text);
      if (!proposal.ok) throw new Error(`not a valid proposal: ${proposal.errors.join("; ")}`);
      let candidateText = null;
      if (proposal.kind === "elimination") {
        const problem = val("--problem");
        if (!problem) throw new Error("an elimination needs --problem <OMN-WORK-…> to read its candidate's text");
        candidateText = (await getJson(`${base}/api/open-work?id=${encodeURIComponent(problem)}`)).problem?.success_contract?.candidates?.[proposal.candidate];
        if (!candidateText) throw new Error(`the problem has no candidate ${proposal.candidate}`);
      }
      const baselineFile = val("--baseline") || path.join(outDir || ".", "baseline.json");
      const baseline = proposal.kind === "advance" ? JSON.parse(fs.readFileSync(baselineFile, "utf8")).decisions : null;
      const runner = await paidRunner(KEYS);
      const prices = await priceTable();
      reserve(X.worstCaseUsd({ calls: 2 * X.RULES.runs_per_cell, prices }), `crux-check ${proposal.kind} ${footprint.id} (Open Work)`, KEYS);
      writeJson(path.join(outDir, "proposal.json"), { footprint_id: footprint.id, content_sha256: footprint.integrity.content_sha256, claim_event_id: claimEvent, proposal, candidate_text: candidateText });
      const res = await runCheck({ callModel: runner.callModel, proposal, candidateText, baseline, onReply: replyLog(path.join(outDir, "replies.jsonl")) });
      runner.saveSpend();
      writeJson(path.join(outDir, "cells.json"), { premise: res.premise, cells: res.cells });
      writeJson(path.join(outDir, "score.json"), res.score);
      const receipt = sealedReceipt(res.score, { claimEventId: claimEvent, footprintId: footprint.id, contentSha256: footprint.integrity.content_sha256, executedAt: new Date().toISOString(), costUsd: res.cost_usd, runId: path.basename(outDir) });
      writeJson(path.join(outDir, "receipt.json"), receipt);
      say(`Result: ${res.score.result.toUpperCase()}. ${res.score.reasons.join("; ")}. Spent ~$${res.cost_usd.toFixed(3)}.\nRecord it: node scripts/open-work-curator.mjs record-receipt <OMN-WORK-…> ${claimEvent} ${path.join(outDir, "receipt.json")} --yes`);
      return;
    }
    if (mode === "score") {
      if (!outDir) throw new Error("pass --out <dir> (with proposal.json and cells.json)");
      const { proposal } = JSON.parse(fs.readFileSync(path.join(outDir, "proposal.json"), "utf8"));
      const { cells } = JSON.parse(fs.readFileSync(path.join(outDir, "cells.json"), "utf8"));
      const baseline = proposal.kind === "advance" ? JSON.parse(fs.readFileSync(val("--baseline") || path.join(outDir, "baseline.json"), "utf8")).decisions : null;
      const score = proposal.kind === "elimination" ? X.scoreElimination({ cells }) : X.scoreAdvance(proposal, { baseline, cells });
      say(JSON.stringify(score, null, 1));
      return;
    }
    say(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).join("\n"));
    process.exitCode = mode ? 2 : 0;
  })().catch((err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });

  async function X_askBaseline(runner) {
    const r = await askPanel({ callModel: runner.callModel, prompt: X.baselinePrompt(), onReply: replyLog(path.join(outDir, "replies.jsonl")) });
    runner.saveSpend();
    return r;
  }
}
