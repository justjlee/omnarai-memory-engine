#!/usr/bin/env node
// COMPATIBILITY MATRIX GATE (2026-11-25). public/compatibility.json says which intelligence environments can read
// Omnarai and which can leave work in it. This gate keeps it honest:
//   • every state is one of verified | partial | unsupported | untested;
//   • a VERIFIED write names at least one footprint id, and a verified read at least one dated log observation;
//   • partial and unsupported carry their evidence or reason; untested carries no footprint evidence;
//   • vendor documentation never appears as evidence (it lives in vendor_says only);
//   • with --live, every footprint cited as evidence is publicly readable on the engine (an admitted footprint),
//     so a row can't be "verified" on a record nobody can check.
//
//   node scripts/check-compatibility.mjs            structure only (offline, used by the hermetic suite)
//   node scripts/check-compatibility.mjs --live     also resolve each footprint against https://engine.omnarai.org
//   --engine <url>                                   another engine origin
// Exit 0 = honest; exit 1 = a row claims more than its evidence.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const ENGINE = (args.includes("--engine") ? args[args.indexOf("--engine") + 1] : "https://engine.omnarai.org").replace(/\/$/, "");
const FILE = args.includes("--file") ? args[args.indexOf("--file") + 1] : fileURLToPath(new URL("../public/compatibility.json", import.meta.url));

export const STATES = ["verified", "partial", "unsupported", "untested"];
const FP_RE = /^OMN-FP-\d{13}-[0-9a-f]{8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function checkMatrix(m) {
  const errors = [];
  if (m?.schema !== "omnarai-compatibility/1.0") errors.push("schema must be omnarai-compatibility/1.0");
  if (!DATE_RE.test(m?.as_of || "")) errors.push("as_of must be YYYY-MM-DD");
  const ids = new Set();
  for (const e of m?.environments || []) {
    const where = `environment ${e.id || "(no id)"}`;
    if (!e.id || ids.has(e.id)) errors.push(`${where}: id missing or repeated`);
    ids.add(e.id);
    if (!e.name || !e.connects_by) errors.push(`${where}: needs name and connects_by`);
    for (const cap of ["read", "write"]) {
      const c = e[cap];
      if (!c || typeof c !== "object") { errors.push(`${where}: ${cap} missing`); continue; }
      if (!STATES.includes(c.state)) { errors.push(`${where}: ${cap}.state "${c.state}" is not one of ${STATES.join(", ")}`); continue; }
      const ev = Array.isArray(c.evidence) ? c.evidence : null;
      if (!ev) { errors.push(`${where}: ${cap}.evidence must be an array`); continue; }
      for (const x of ev) {
        if (x.kind === "footprint") { if (!FP_RE.test(x.id || "")) errors.push(`${where}: ${cap} cites a malformed footprint id ${x.id}`); }
        else if (x.kind === "log") { if (!DATE_RE.test(x.date || "") || !x.observation) errors.push(`${where}: ${cap} log evidence needs date and observation`); }
        else errors.push(`${where}: ${cap} evidence kind "${x.kind}" is not footprint or log (vendor documentation is never evidence)`);
      }
      const fps = ev.filter((x) => x.kind === "footprint");
      if (c.state === "verified" && cap === "write" && !fps.length) errors.push(`${where}: a verified write must cite at least one footprint`);
      if (c.state === "verified" && cap === "read" && !ev.length) errors.push(`${where}: a verified read must cite evidence`);
      if ((c.state === "partial" || c.state === "unsupported") && !ev.length && !c.note) errors.push(`${where}: ${cap} is ${c.state} with neither evidence nor a stated reason`);
      if (c.state === "untested" && fps.length) errors.push(`${where}: ${cap} is untested but cites a footprint; if it worked, say verified`);
    }
    if (e.vendor_says && typeof e.vendor_says !== "string") errors.push(`${where}: vendor_says must be a sentence`);
  }
  if (!ids.size) errors.push("no environments");
  return errors;
}

async function liveErrors(m) {
  const errors = [];
  const cited = [];
  for (const e of m.environments || []) for (const cap of ["read", "write"]) for (const x of e[cap]?.evidence || []) if (x.kind === "footprint") cited.push([e.id, x.id]);
  for (const [env, id] of cited) {
    try {
      const r = await fetch(`${ENGINE}/api/footprints?id=${encodeURIComponent(id)}`, { headers: { "x-omnarai-self": "1", "user-agent": "omnarai-check-compatibility" } });
      if (r.status !== 200) errors.push(`environment ${env}: evidence ${id} is not publicly readable (HTTP ${r.status})`);
    } catch (err) {
      errors.push(`environment ${env}: could not read ${id} (${err.message})`);
    }
  }
  return { errors, cited: cited.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = JSON.parse(readFileSync(FILE, "utf8"));
  const errors = checkMatrix(m);
  let cited = 0;
  if (LIVE && !errors.length) { const l = await liveErrors(m); errors.push(...l.errors); cited = l.cited; }
  if (errors.length) {
    console.error(`compatibility matrix: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`  ✖ ${e}`);
    process.exit(1);
  }
  const tally = {};
  for (const e of m.environments) for (const cap of ["read", "write"]) tally[`${cap}:${e[cap].state}`] = (tally[`${cap}:${e[cap].state}`] || 0) + 1;
  console.log(`compatibility matrix OK: ${m.environments.length} environments · ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")}${LIVE ? ` · ${cited} cited footprints publicly readable on ${ENGINE}` : ""}`);
}
