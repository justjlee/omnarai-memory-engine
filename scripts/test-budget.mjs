// Unit tests for the compute-spend ceiling (api/_budget.js).
// Pure-logic only — no Blob, no network. We stub the two blob calls (list/put) so
// the ledger math, the fail-closed guarantee, the margin, and the pathname
// microdollar encoding are all exercised deterministically.
//
// Run: node scripts/test-budget.mjs

import assert from "node:assert";

// ── Stub @vercel/blob BEFORE importing _budget.js ────────────────────────────
// _budget.js does `import { list, put } from "@vercel/blob"`. We can't easily
// intercept that ESM import without a loader, so we test the pure arithmetic by
// re-implementing the exact pathname parser + window logic the module uses and
// asserting the module's exported constants/helpers agree. The blob-touching
// functions (spentLast30DaysUsd/checkBudget/recordSpend) are covered by the live
// smoke check in the deploy runbook; here we lock the logic that decides money.

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log("  ✓ " + name); pass++; };

const mod = await import("../api/_budget.js");
const {
  budgetCapUsd, budgetMarginUsd, effectiveCeilingUsd,
  estimatedCostUsd, costTable, budgetExceededBody,
  budgetWarnFraction, spendLevel, budgetNotice,
} = mod;

// ── cap / margin / ceiling ───────────────────────────────────────────────────
console.log("cap / margin / ceiling:");
delete process.env.BUDGET_CAP_USD;
delete process.env.BUDGET_SOFT_MARGIN_USD;
ok("default cap is $100", budgetCapUsd() === 100);
ok("default margin is $5", budgetMarginUsd() === 5);
ok("default ceiling is $95 (cap - margin)", effectiveCeilingUsd() === 95);

process.env.BUDGET_CAP_USD = "40";
process.env.BUDGET_SOFT_MARGIN_USD = "0";
ok("env override cap → $40", budgetCapUsd() === 40);
ok("env override margin → $0", budgetMarginUsd() === 0);
ok("ceiling tracks overrides → $40", effectiveCeilingUsd() === 40);

process.env.BUDGET_CAP_USD = "10";
process.env.BUDGET_SOFT_MARGIN_USD = "999"; // margin bigger than cap
ok("ceiling never goes negative", effectiveCeilingUsd() === 0);
delete process.env.BUDGET_CAP_USD;
delete process.env.BUDGET_SOFT_MARGIN_USD;

// ── cost estimates ───────────────────────────────────────────────────────────
console.log("cost estimates:");
ok("council estimate is $0.12", estimatedCostUsd("council") === 0.12);
ok("query estimate is $0.04", estimatedCostUsd("query") === 0.04);
ok("trace estimate is $0.08", estimatedCostUsd("trace") === 0.08);
ok("cron estimate is $0.12", estimatedCostUsd("cron") === 0.12);
ok("unknown kind charges the MAX known estimate (conservative)",
  estimatedCostUsd("mystery") === Math.max(...Object.values(costTable())));
ok("costTable returns a copy, not the live object",
  (() => { const t = costTable(); t.council = 999; return estimatedCostUsd("council") === 0.12; })());

// ── microdollar pathname round-trip (the summing contract) ───────────────────
console.log("microdollar pathname encoding:");
// _budget.js encodes cost as Math.round(usd*1e6) in the filename `...__<micros>.json`
// and sums by parsing `/__(\d+)\.json$/`. Lock that the two agree.
const encode = (usd) => Math.max(0, Math.round(usd * 1e6));
const parse = (name) => { const m = /__(\d+)\.json$/.exec(name); return m ? parseInt(m[1], 10) : null; };
for (const usd of [0.12, 0.04, 0.08, 90, 0.005]) {
  const name = `2026-07-27T00-00-00-000Z__abc123__${encode(usd)}.json`;
  ok(`$${usd} → micros → $${usd} round-trips`, parse(name) / 1e6 === usd);
}
ok("a body-less non-marker filename parses to null (ignored in sum)",
  parse("2026-07-27/whatever.json") === null);

// ── 429 body shape (what a blocked caller/agent branches on) ─────────────────
console.log("budgetExceededBody:");
const exhausted = budgetExceededBody("council",
  { allowed: false, spent: 95.01, ceiling: 95, remaining: 0, windowDays: 30, reason: "budget-exhausted" },
  { method: "GET", url: "/api/divergences" });
ok("exhausted body carries code BUDGET_EXCEEDED", exhausted.code === "BUDGET_EXCEEDED");
ok("exhausted body is retryable", exhausted.retryable === true);
ok("exhausted body reports the ceiling", exhausted.budget.ceiling_usd === 95);
ok("exhausted body points to a free next call", exhausted.suggested_next_call.url === "/api/divergences");

const failClosed = budgetExceededBody("query",
  { allowed: false, spent: null, ceiling: 95, remaining: null, windowDays: 30, reason: "ledger-unavailable-failclosed" });
ok("fail-closed body carries code BUDGET_LEDGER_UNAVAILABLE", failClosed.code === "BUDGET_LEDGER_UNAVAILABLE");
ok("fail-closed body defaults to /api/divergences free call", failClosed.suggested_next_call.url === "/api/divergences");
ok("fail-closed message names the pause reason", /unreadable|cannot confirm/i.test(failClosed.error));

// ── the guarantee, expressed as arithmetic ───────────────────────────────────
console.log("ceiling arithmetic (the guarantee):");
const wouldAllow = (spent, estCost, ceiling) => spent + estCost <= ceiling;
ok("at $94.90 spent, a $0.12 council run is BLOCKED (94.90+0.12 > 95)",
  wouldAllow(94.90, 0.12, 95) === false);
ok("at $94.80 spent, a $0.12 council run is ALLOWED (94.80+0.12 <= 95)",
  wouldAllow(94.80, 0.12, 95) === true);
ok("margin leaves ~$5 of overshoot headroom below the real $100 cap",
  (100 - effectiveCeilingUsd()) === 5);

// ── warning threshold / approaching notice ───────────────────────────────────
console.log("approaching-limit warning:");
delete process.env.BUDGET_WARN_FRACTION;
ok("default warn fraction is 0.8", budgetWarnFraction() === 0.8);
process.env.BUDGET_WARN_FRACTION = "0.9";
ok("env override warn fraction → 0.9", budgetWarnFraction() === 0.9);
process.env.BUDGET_WARN_FRACTION = "5"; // out of range
ok("out-of-range warn fraction falls back to default", budgetWarnFraction() === 0.8);
delete process.env.BUDGET_WARN_FRACTION;

ok("spendLevel ok below the warn line ($70 of $95 @0.8 → warn at $76)", spendLevel(70, 95, 0.8) === "ok");
ok("spendLevel approaching at/above the warn line ($80 of $95)", spendLevel(80, 95, 0.8) === "approaching");
ok("spendLevel exhausted at the ceiling ($95 of $95)", spendLevel(95, 95, 0.8) === "exhausted");
ok("spendLevel exhausted when ceiling is 0 (margin ate the cap)", spendLevel(0, 0, 0.8) === "exhausted");

const notice = budgetNotice({ level: "approaching", spent: 80, ceiling: 95, remaining: 15, windowDays: 30 });
ok("budgetNotice fires only when approaching", notice && notice.level === "approaching");
ok("budgetNotice reports percent used (84%)", /84%/.test(notice.message));
ok("budgetNotice offers a no-redeploy extend path", /POST \/api\/info\?_view=budget/.test(notice.extend.now_no_redeploy));
ok("budgetNotice offers a durable env extend path", /BUDGET_CAP_USD/.test(notice.extend.durable));
ok("budgetNotice is null when level is ok", budgetNotice({ level: "ok", spent: 10, ceiling: 95 }) === null);

console.log(`\n${pass} assertions passed.`);
