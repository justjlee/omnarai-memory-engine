#!/usr/bin/env node
// One-command offline demo of Inheritance Study 001. $0, no network, cannot touch production:
//
//   node scripts/inheritance-001/demo.mjs [--world positive-shared|null-disjoint|harmful-anchoring|scaffold-only|inert]
//
// It re-runs lab.mjs under the engine's hermetic loader (in-memory Blob, provider keys and BLOB token stripped from the
// environment, fetch blocked) and lab.mjs adds its own socket guard. The outcomes come from a deterministic mock in a
// synthetic world: they test the instrument, and are NOT evidence about any model.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const r = spawnSync(process.execPath, ["--import", "./scripts/lib/register-mem-blob.mjs", "scripts/inheritance-001/lab.mjs", "demo", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
