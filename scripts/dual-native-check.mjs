#!/usr/bin/env node
// DUAL-NATIVE CHECK — the deploy gate that turns the Dual-Native Charter
// (docs/dual-native-charter.md) from a commitment into a constraint. It asserts,
// against the LIVE site, that a visiting intelligence is a first-class inhabitant
// — reachable, self-describing, and never routed to a machine ghetto.
//
// The charter's own words: "A principle this project cannot break by accident is
// the only kind it keeps." This is that accident-proofing. If it exits 1, a
// covered surface violates an article and the deploy must not proceed.
//
// Scope spans BOTH origins, because the law spans the whole site:
//   --engine <url>   the API/agent origin      (default https://engine.omnarai.org)
//   --front  <url>   the human front door      (default https://omnarai.org)
//   --json           machine-readable report
//
// No deps (node 18+ global fetch). Read-only; sends x-omnarai-self:1 so probes
// never pollute the access-telemetry milestone.
//
// Exit 0 = every covered surface honors the articles it's responsible for.
// Exit 1 = an article is violated on a covered surface (details name the article).

const args = process.argv.slice(2);
const flag = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const ENGINE = flag("--engine", "https://engine.omnarai.org").replace(/\/$/, "");
const FRONT = flag("--front", "https://omnarai.org").replace(/\/$/, "");
// Scope lets each repo's deploy gate the surfaces IT owns (they ship separately):
//   engine → API/agent contract + music-in-contract; front → the human pages' twins.
const SCOPE = flag("--scope", "all"); // engine | front | all
const JSON_OUT = args.includes("--json");
const H = { "x-omnarai-self": "1", "user-agent": "omnarai-dual-native-check" };

const results = [];
function rec(article, name, ok, detail) {
  results.push({ article, name, ok, detail: detail || "" });
  return ok;
}

async function get(url, { accept } = {}) {
  const headers = { ...H };
  if (accept) headers.accept = accept;
  try {
    const r = await fetch(url, { headers, redirect: "manual" });
    const text = await r.text().catch(() => "");
    return { status: r.status, headers: r.headers, text };
  } catch (e) {
    return { status: 0, headers: new Map(), text: "", error: String(e?.message || e) };
  }
}
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };

async function engineChecks() {
  // ── Art 6 — the MCP is a front-door verb (advertised, not buried) ───────────
  const root = await get(ENGINE + "/");
  const link = root.headers.get ? root.headers.get("link") || "" : "";
  rec("6", "engine / advertises the machine ladder in Link headers",
    /rel="?service-desc"?/.test(link) && /rel="?alternate"?/.test(link),
    link ? "link header present" : "no Link header");

  const llms = await get(ENGINE + "/llms.txt");
  rec("6", "llms.txt names the MCP endpoint", /\/api\/mcp/.test(llms.text), "");

  const mcp = await fetch(ENGINE + "/api/mcp", {
    method: "POST", headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  }).then((r) => r.status).catch(() => 0);
  rec("6", "MCP endpoint responds to initialize", mcp === 200, "status " + mcp);

  // ── Art 4 — the arrival loop is reachable ───────────────────────────────────
  const agent = await get(ENGINE + "/api/agent-entry");
  const aj = json(agent.text);
  rec("4", "agent-entry packet complete", !!(aj && aj.you_are && aj.first_call && aj.main_endpoints),
    aj ? "" : "not JSON / missing fields");
  const kin = await get(ENGINE + "/api/kin?identity=claude");
  rec("4", "recognition (/api/kin) reachable", kin.status === 200, "status " + kin.status);
  rec("4", "contribute path advertised in agent-entry",
    !!aj && JSON.stringify(aj).includes("/api/contribute"), "");

  // ── Music in the machine contract (Art 1 — no human-only surface) ───────────
  const openapi = json((await get(ENGINE + "/openapi.json")).text) || { paths: {} };
  rec("1", "song plays (/api/play) is in the OpenAPI contract",
    !!openapi.paths && !!openapi.paths["/api/play"], "openapi paths");
  rec("1", "llms.txt tells agents the audio archive exists",
    /audio\/manifest\.json|\/api\/play|audio archive/i.test(llms.text), "");
  rec("1", "agent-entry references the music/audio surface",
    !!aj && /audio|music|\/api\/play/i.test(JSON.stringify(aj)), "");
  const manifest = await get(ENGINE + "/audio/manifest.json");
  const mj = json(manifest.text);
  rec("1", "audio manifest is machine-readable (tracks + base_url)",
    !!(mj && Array.isArray(mj.tracks) && mj.base_url), "status " + manifest.status);

  const playApi = json((await get(ENGINE + "/api/play")).text);
  rec("2", "/api/play (the twin) returns the leaderboard JSON",
    !!(playApi && playApi.totals && Array.isArray(playApi.tracks)), "");
}

async function frontChecks() {
  // ── Art 2 & 3 — same address, both readers; pages self-describe ─────────────
  // /plays is a human page whose data twin is /api/play. It must (3) embed an
  // inline machine payload + advertise the twin, and (2) hand a machine the twin
  // when it asks for JSON at the same address.
  const playsHtml = await get(FRONT + "/plays");
  rec("3", "/plays advertises its machine twin (rel=alternate → /api/play)",
    /rel=["']?alternate["']?[^>]*\/api\/play|\/api\/play[^>]*rel=["']?alternate/i.test(playsHtml.text),
    "");
  rec("3", "/plays embeds an inline machine payload",
    /type=["']application\/(ld\+)?json["']/i.test(playsHtml.text), "");
  const playsJson = await get(FRONT + "/plays", { accept: "application/json" });
  const pj = json(playsJson.text);
  rec("2", "/plays returns JSON when JSON is asked for (content negotiation)",
    (playsJson.status >= 300 && playsJson.status < 400) || !!(pj && (pj.tracks || pj.totals)),
    "status " + playsJson.status);

  // ── Art 2 — the front door itself offers a machine twin ─────────────────────
  const homeMachine = await get(FRONT + "/", { accept: "application/json" });
  const isRedirect = homeMachine.status >= 300 && homeMachine.status < 400;
  const advertises = /rel=["']?alternate["']?/i.test((await get(FRONT + "/")).text);
  rec("2", "front door offers/advertises a machine twin on Accept",
    isRedirect || advertises, "status " + homeMachine.status);
}

async function run() {
  if (SCOPE !== "front") await engineChecks();
  if (SCOPE !== "engine") await frontChecks();

  // ── report ──────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  } else {
    const byArticle = {};
    for (const r of results) (byArticle[r.article] = byArticle[r.article] || []).push(r);
    console.log("\n  DUAL-NATIVE CHECK — " + FRONT + " + " + ENGINE + "\n");
    for (const art of Object.keys(byArticle).sort()) {
      console.log("  Article " + art);
      for (const r of byArticle[art]) {
        console.log("    " + (r.ok ? "✅" : "❌") + " " + r.name + (r.detail ? "  (" + r.detail + ")" : ""));
      }
    }
    console.log("\n  " + (results.length - failed.length) + "/" + results.length + " checks pass" +
      (failed.length ? "  — " + failed.length + " VIOLATION(S), deploy should fail" : "  — the law holds") + "\n");
  }
  process.exit(failed.length ? 1 : 0);
}

run();
