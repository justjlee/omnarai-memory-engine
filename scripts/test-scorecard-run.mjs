// The scheduled scorecard run (2026-11-25), end to end with the network stubbed: scripts/scorecard.mjs
// really runs; scripts/lib/scorecard-fetch-stub.mjs answers every fetch and records every POST.
//   node --test scripts/test-scorecard-run.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function run(mode, extraEnv = {}, args = ["--publish", "--carry-forward", "--days", "8"]) {
  const dir = mkdtempSync(join(tmpdir(), "sc-run-"));
  const out = join(dir, "posts.jsonl");
  const env = { PATH: process.env.PATH, HOME: dir, STUB_MODE: mode, STUB_OUT: out, INGEST_SECRET: "test-ingest", TELEMETRY_READ_SECRET: "test-tele", GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "42", GITHUB_REPOSITORY: "justjlee/omnarai-memory-engine", GITHUB_SERVER_URL: "https://github.com", ...extraEnv };
  let code = 0;
  try { execFileSync(process.execPath, ["--import", "./scripts/lib/scorecard-fetch-stub.mjs", "scripts/scorecard.mjs", ...args], { cwd: root, env, stdio: "pipe" }); } catch (e) { code = e.status; }
  const posts = existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { code, posts };
}

test("[R1] a scheduled run publishes, tagged with its source and run, carrying forward what CI cannot see", () => {
  const { code, posts } = run("ok");
  assert.equal(code, 0);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/api/info?_view=scorecard");
  const sc = posts[0].body;
  assert.equal(sc.schema, "scorecard/1");
  assert.equal(sc.source, "github-actions");
  assert.equal(sc.run_url, "https://github.com/justjlee/omnarai-memory-engine/actions/runs/42");
  const repo = sc.endorsements.github.repos.find((r) => r.name === "omnarai-memory-engine");
  assert.equal(repo.views_14d, 40, "GitHub traffic carried forward");
  assert.equal(repo.traffic_carried_from, "2026-11-20T00:00:00.000Z");
  assert.deepEqual(sc.milestones.internal, [{ label: "private one", date: "2026-11-01" }]);
  assert.deepEqual(sc.carried_forward.fields.sort(), ["github traffic (omnarai-memory-engine)", "private milestones"]);
  assert.equal(sc.goal.footprints_admitted, 4);
});

test("[R2] unreadable telemetry: nothing is published; the failure is recorded with time, reason and run link", () => {
  const { code, posts } = run("front-down");
  assert.equal(code, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/api/info?_view=scorecard-run");
  assert.equal(posts[0].body.ok, false);
  assert.match(posts[0].body.reason, /front-door telemetry unreadable for all 8 days/);
  assert.equal(posts[0].body.run_url, "https://github.com/justjlee/omnarai-memory-engine/actions/runs/42");
});

test("[R3] missing secrets: exits non-zero and cannot (and does not) write anything", () => {
  const { code, posts } = run("ok", { INGEST_SECRET: "", TELEMETRY_READ_SECRET: "" });
  assert.equal(code, 1);
  assert.equal(posts.length, 0);
});

test("[R4] without --publish a failure is only printed (local runs never write)", () => {
  const { code, posts } = run("front-down", {}, ["--days", "8"]);
  assert.equal(code, 1);
  assert.equal(posts.length, 0);
});
