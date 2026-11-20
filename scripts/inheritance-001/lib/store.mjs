// Inheritance study 001 — append-only record store with a hash-chained event log.
//
// Every record is sealed (its sha256 covers its body) and written ONCE: re-putting identical bytes is a no-op, putting a
// different body under an existing id throws. Each write appends an event {seq, kind, id, record_sha256, prev, sha256}
// whose own hash chains to the previous event, so deleting, reordering or editing any record after the fact is
// detectable from the log alone (verifyChain). Corrections are new records, never edits.
//
// Two backends with the same interface:
//   createMemoryLabStore()            — the offline runner; exported to files by exportRun()
//   createBlobLabStore({put, list})   — Vercel Blob under research/inheritance-001/<study>/ ONLY, write-once
//                                       (no allowOverwrite). Tested against the in-memory Blob; never pointed at
//                                       production in this pass. It cannot write memory/grown.json, footprints/ or any
//                                       other namespace: the path is built here from a validated kind + id.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RECORD_KINDS, isSealedIntact, sha256, canonicalJSON, IntegrityError } from "./canon.mjs";

export const BLOB_NAMESPACE = "research/inheritance-001/";
const ID_RE = /^IS1-[A-Z]+(-[A-Za-z0-9]+){1,4}$/;

export class RecordConflictError extends Error {
  constructor(kind, id) { super(`RECORD_CONFLICT ${kind}/${id}: a different body already exists; records are write-once`); this.code = "RECORD_CONFLICT"; }
}

function chainEvent(prev, seq, kind, record) {
  const ev = { seq, kind, id: record.id, record_sha256: record.sha256, prev: prev ? prev.sha256 : null };
  return { ...ev, sha256: sha256(ev) };
}
export function verifyChain(events, records = null) {
  const problems = [];
  let prev = null;
  events.forEach((ev, i) => {
    // eslint-disable-next-line no-unused-vars
    const { sha256: h, ...rest } = ev;
    if (ev.seq !== i) problems.push(`event ${i}: seq ${ev.seq}`);
    if (ev.prev !== (prev ? prev.sha256 : null)) problems.push(`event ${i}: broken link`);
    if (h !== sha256(rest)) problems.push(`event ${i}: hash mismatch`);
    if (records) {
      const r = records.get(`${ev.kind}/${ev.id}`);
      if (!r) problems.push(`event ${i}: ${ev.kind}/${ev.id} missing`);
      else if (r.sha256 !== ev.record_sha256 || !isSealedIntact(r)) problems.push(`event ${i}: ${ev.kind}/${ev.id} altered`);
    }
    prev = ev;
  });
  if (records) for (const k of records.keys()) if (!events.some((e) => `${e.kind}/${e.id}` === k)) problems.push(`${k}: record with no event`);
  return problems;
}

function check(kind, record) {
  if (!RECORD_KINDS.includes(kind)) throw new Error(`UNKNOWN_RECORD_KIND ${kind}`);
  if (!ID_RE.test(record?.id || "")) throw new Error(`INVALID_RECORD_ID ${record?.id}`);
  if (!isSealedIntact(record)) throw new IntegrityError("RECORD_INTEGRITY", `${kind}/${record.id}`);
}

export function createMemoryLabStore() {
  const records = new Map();
  const events = [];
  return {
    put(kind, record) {
      check(kind, record);
      const key = `${kind}/${record.id}`;
      const cur = records.get(key);
      if (cur) { if (cur.sha256 === record.sha256) return record; throw new RecordConflictError(kind, record.id); }
      records.set(key, record);
      events.push(chainEvent(events.at(-1), events.length, kind, record));
      return record;
    },
    get: (kind, id) => records.get(`${kind}/${id}`) || null,
    list: (kind) => [...records.entries()].filter(([k]) => k.startsWith(`${kind}/`)).map(([, v]) => v),
    events: () => events.slice(),
    records: () => new Map(records),
    verify: () => verifyChain(events, records),
  };
}

export function createBlobLabStore({ put, list, fetchImpl = (...a) => fetch(...a), studyId }) {
  if (!/^IS1-STUDY-[A-Z0-9-]{3,60}$/.test(studyId || "")) throw new Error("INVALID_STUDY_ID");
  const base = `${BLOB_NAMESPACE}${studyId}/`;
  const pathOf = (kind, id) => `${base}${kind}/${id}.json`;
  return {
    namespace: base,
    async put(kind, record) {
      check(kind, record);
      const path = pathOf(kind, record.id);
      if (!path.startsWith(BLOB_NAMESPACE)) throw new Error("NAMESPACE_ESCAPE");
      try {
        await put(path, JSON.stringify(record), { access: "public", addRandomSuffix: false, contentType: "application/json" });
      } catch (e) {
        const existing = (await list({ prefix: path })).blobs?.find((b) => b.pathname === path);
        if (!existing) throw e;
        const body = await (await fetchImpl(`${existing.url}?ts=${Date.now()}`, { cache: "no-store" })).json();
        if (body?.sha256 === record.sha256) return record;
        throw new RecordConflictError(kind, record.id);
      }
      return record;
    },
    async list(kind) {
      const r = await list({ prefix: `${base}${kind}/` });
      return Promise.all((r.blobs || []).map(async (b) => (await fetchImpl(`${b.url}?ts=${Date.now()}`, { cache: "no-store" })).json()));
    },
  };
}

// ── Files: one directory per run, deterministic bytes ────────────────────────────────────────────────────────────────
const jsonl = (xs) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "");
const pretty = (x) => JSON.stringify(x, null, 2) + "\n";
export const FILES = {
  study: "study.json", plan: "plan.json", task_family: "families.json", task: "tasks.public.jsonl", artifact: "artifacts.jsonl",
  evaluation: "evaluations.jsonl", snapshot: "snapshot.json", trial: "trials.jsonl", run: "runs.json", ablation: "ablations.json",
  report: "summary.json", events: "events.ndjson",
};
const ARRAY_JSON = new Set(["task_family", "snapshot", "run", "ablation"]);

// Write a store's public records. Sealed task parts and raw outputs go ONLY to `sealedDir` (never into the public set).
export function exportRun(store, outDir, { plan = null, sealed = null, sealedDir = null } = {}) {
  mkdirSync(outDir, { recursive: true });
  for (const kind of ["study", "task_family", "task", "artifact", "evaluation", "snapshot", "trial", "run"]) {
    const xs = store.list(kind).sort((a, b) => a.id.localeCompare(b.id));
    const f = join(outDir, FILES[kind]);
    if (kind === "study") writeFileSync(f, pretty(xs[0] || null));
    else if (ARRAY_JSON.has(kind)) writeFileSync(f, pretty(xs));
    else writeFileSync(f, jsonl(kind === "trial" ? store.list(kind) : xs)); // trials keep execution order
  }
  writeFileSync(join(outDir, FILES.events), jsonl(store.events()));
  if (plan) writeFileSync(join(outDir, FILES.plan), pretty(plan));
  if (sealed && sealedDir) {
    mkdirSync(sealedDir, { recursive: true });
    writeFileSync(join(sealedDir, "README.txt"), "SEALED SIDE of an offline demo run: synthetic task answers, hidden checks, canaries and raw mock outputs.\nThese are fixtures, not a sealed benchmark. A real study keeps this directory outside the repository.\n");
    writeFileSync(join(sealedDir, "tasks.sealed.jsonl"), jsonl(sealed.tasks));
    writeFileSync(join(sealedDir, "raw-outputs.jsonl"), jsonl(sealed.outputs));
  }
}

const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);

export function loadRun(outDir) {
  const records = new Map();
  const add = (kind, xs) => { for (const x of xs.filter(Boolean)) records.set(`${kind}/${x.id}`, x); };
  add("study", [readJson(join(outDir, FILES.study))]);
  for (const kind of ["task_family", "snapshot", "run"]) add(kind, readJson(join(outDir, FILES[kind])) || []);
  for (const kind of ["task", "artifact", "evaluation", "trial"]) add(kind, readJsonl(join(outDir, FILES[kind])));
  return { records, events: readJsonl(join(outDir, FILES.events)), plan: readJson(join(outDir, FILES.plan)), list: (kind) => [...records.entries()].filter(([k]) => k.startsWith(`${kind}/`)).map(([, v]) => v) };
}

// Tamper check for an exported run directory: every record intact, every record in the chain, chain unbroken.
export function verifyRunDir(outDir) {
  const run = loadRun(outDir);
  const problems = verifyChain(run.events, run.records);
  if (run.plan && run.records.size) {
    const study = run.list("study")[0];
    // eslint-disable-next-line no-unused-vars
    const { plan_sha256: _p, ...planBody } = run.plan;
    if (study && study.plan_sha256 !== sha256(canonicalJSON(planBody))) problems.push("plan.json differs from the plan the study froze");
    if (run.plan.plan_sha256 !== study?.plan_sha256) problems.push("plan.json's own plan_sha256 differs from the study's");
  }
  return { ok: problems.length === 0, problems, counts: Object.fromEntries(["task", "artifact", "evaluation", "snapshot", "trial"].map((k) => [k, run.list(k).length])) };
}

export const listDirs = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
