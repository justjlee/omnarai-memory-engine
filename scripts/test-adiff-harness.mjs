// The architecture-differential harness must be runnable by a stranger and must never spend
// money silently. Before this test the repro script needed the operator's private Blob token
// (spend ledger + the grown-memory store) and had no --help, no cost consent and no way to
// read the public Atlas. These tests make NO network calls and spend NOTHING: dummy keys, and
// every path asserted here exits before the first model call.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-adiff-harness.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HERMETIC = fileURLToPath(new URL("./lib/register-mem-blob.mjs", import.meta.url));
// A stranger's environment: no BLOB_READ_WRITE_TOKEN, no .env.local, only what is passed here.
// The harness reads ROOT/.env.local by itself, so in the operator's checkout the child used to pick
// up the real ledger token and keys, take the operator path, and reserve $2 on the LIVE spend ledger
// per case (nine phantom "study" markers on 2026-10-14). ADIFF_NO_ENV_FILE=1 makes it a stranger.
// The child also runs under the hermetic loader, so a regression that reaches the network or Blob
// fails fast instead of spending; MEM_BLOB_KEEP_ENV=1 keeps the dummy keys the loader would strip.
const strangerEnv = (env = {}) => ({ PATH: process.env.PATH, HOME: process.env.HOME, ADIFF_NO_ENV_FILE: "1", MEM_BLOB_KEEP_ENV: "1", ...env });
const run = (args, env = {}) =>
  spawnSync(process.execPath, ["--import", HERMETIC, "scripts/utility-test-prereg.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: strangerEnv(env),
  });

const DUMMY_KEYS = {
  ANTHROPIC_API_KEY: "dummy", OPENAI_API_KEY: "dummy", GEMINI_API_KEY: "dummy", XAI_API_KEY: "dummy", DEEPSEEK_API_KEY: "dummy",
};

test("--help works with no keys, no .env.local and no network, and states the limits", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  for (const must of [
    "baseline", "placebo", "treatment",
    "No single run licenses",
    "--yes",
    "BLOB_READ_WRITE_TOKEN",
    "refutation-ledger",
  ]) assert.ok(r.stdout.includes(must), `--help mentions: ${must}`);
  assert.match(r.stdout, /NOT a test of your\s+own documents/);
  assert.ok(!/Omnarai improves reasoning[^"]/.test(r.stdout.replace(/"Omnarai improves reasoning"/g, "")), "never asserts the general claim");
});

test("without a spend ledger and without --yes it prints the estimate and refuses to spend (exit 2)", () => {
  const r = run(["--smoke", "1"], { ...DUMMY_KEYS, CONSUMER_MODEL: "Claude" });
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /no shared ledger/);
  assert.match(r.stderr, /refusing to spend without consent/);
  assert.match(r.stderr, /est\. up to ~\$\d+/);
});

test("--yes alone is not enough for a consumer with no key: it fails before any spend, naming the cause", () => {
  const keys = { ...DUMMY_KEYS };
  delete keys.ANTHROPIC_API_KEY;
  const r = run(["--smoke", "1", "--yes"], { ...keys, CONSUMER_MODEL: "Claude" });
  assert.notEqual(r.status, 0);
  assert.ok(!/\[spend\]/.test(r.stderr), "no spend step reached");
  assert.match(`${r.stdout}${r.stderr}`, /consumer Claude needs ANTHROPIC_API_KEY/);
});

test("the blind panel cannot shrink below the registered minimum (needs >=2 judges + a paraphraser)", () => {
  const r = run(["--smoke", "1", "--yes"], { ANTHROPIC_API_KEY: "dummy", OPENAI_API_KEY: "dummy", CONSUMER_MODEL: "Claude" });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /need >=2 judges|held-out paraphraser/);
});

test("the stranger run is sealed: a path that would reach the network fails fast instead of spending", () => {
  const r = run(["--smoke", "1", "--yes", "--atlas", "https://engine.omnarai.org"], { ...DUMMY_KEYS, CONSUMER_MODEL: "Claude" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no shared ledger/, "never the operator ledger path");
  assert.match(r.stderr, /hermetic: network blocked/);
});

test("repro wrapper: --help runs offline and the old .env.local synthesis is gone", async () => {
  const r = spawnSync("bash", ["repro/adiff-repro.sh", "--help"], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: strangerEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NO PRIVATE STORE NEEDED/);
  const src = (await import("node:fs")).readFileSync(`${ROOT}repro/adiff-repro.sh`, "utf8");
  assert.ok(!/CREATED_ENV/.test(src), "no longer writes a temporary .env.local");
});
