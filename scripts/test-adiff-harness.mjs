// The architecture-differential harness must be runnable by a stranger and must never spend
// money silently. Before this test the repro script needed the operator's private Blob token
// (spend ledger + the grown-memory store) and had no --help, no cost consent and no way to
// read the public Atlas. These tests make NO network calls and spend NOTHING: dummy keys, and
// every path asserted here exits before the first model call.
//
//   node scripts/test-adiff-harness.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = (args, env = {}) =>
  spawnSync(process.execPath, ["scripts/utility-test-prereg.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    // A stranger's environment: no BLOB_READ_WRITE_TOKEN, no .env.local, only what is passed here.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
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

test("repro wrapper: --help runs offline and the old .env.local synthesis is gone", async () => {
  const r = spawnSync("bash", ["repro/adiff-repro.sh", "--help"], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NO PRIVATE STORE NEEDED/);
  const src = (await import("node:fs")).readFileSync(`${ROOT}repro/adiff-repro.sh`, "utf8");
  assert.ok(!/CREATED_ENV/.test(src), "no longer writes a temporary .env.local");
});
