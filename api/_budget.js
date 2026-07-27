// ── Hard compute-spend ceiling ────────────────────────────────────────────────
// A guaranteed cap on real model spend, measured over a ROLLING 30-day window.
// The council (5 frontier calls/run) is the front-page primary action, and the
// deliberation + trace + longitudinal-cron paths all spend too. This module is
// the guarantee the curator asked for: "I don't want my compute costs to exceed
// $100 in any rolling 30-day period" — traffic may still CALL a spending action,
// but once the window's spend would cross the ceiling the action stops being
// actionable and the caller is pointed at the free, already-captured Atlas.
//
// Design constraints, and how this file answers them:
//
//  1. NO read-modify-write. Vercel Blob has no CAS; a consolidated dollar counter
//     would silently drop concurrent increments — and for a BUDGET, a dropped
//     increment means under-counting, i.e. OVER-spending. So spend is recorded as
//     one marker blob per run, and the dollar amount is encoded IN THE PATHNAME
//     (microdollars). Summing the window is therefore a LIST + parse of pathnames
//     — no body fetches, exact under concurrency, same discipline as _quota.js.
//
//  2. FAIL CLOSED — the opposite of _quota.js. The daily-cap ledger fails OPEN
//     (a blob outage must never block a visitor from the flagship action; the
//     worst case is a recoverable bill). This ledger IS the bill guard, so if it
//     cannot PROVE we are under budget, it must refuse to spend. An outage that
//     makes us blind is exactly when an unbounded spend could run away.
//
//  3. Record the ESTIMATE, not the measured token cost. Per-run costs are
//     conservative, rounded-UP flat estimates. Charging our own ledger the
//     estimate (which is >= the real per-run cost) guarantees the real provider
//     bill lands at or below what the ledger believes we spent — the safe
//     direction. Measuring actual tokens would track more precisely but could
//     under-record when a run comes in cheap, drifting us toward the real cap.
//
//  4. A margin below the stated cap. Blob is not transactional, so N runs can all
//     read "under budget" at once and each spend. Stopping at (cap - margin)
//     leaves headroom for that overshoot: at ~$0.12/run a $5 margin absorbs ~40
//     simultaneous runs before the true $100 could be touched. The unbypassable
//     floor is still provider-side spend limits — this is the graceful layer.

import { list, put } from "@vercel/blob";

const PREFIX = "budget/spend/";
const CONFIG_KEY = "budget/config.json"; // runtime override — adjust the cap without a redeploy
const DEFAULT_CAP_USD = 100;
const DEFAULT_MARGIN_USD = 5; // stop at cap - margin, to absorb concurrent overshoot
const DEFAULT_WARN_FRACTION = 0.8; // "approaching" once spend crosses this share of the ceiling
const WINDOW_DAYS = 30;

// Conservative, rounded-UP per-run estimates (see constraint 3). Keyed by the
// spending "kind" each call site declares. An unknown kind charges the max known
// estimate rather than $0 — the safe default.
const COST_USD = {
  council: 0.12, // 5 frontier members + synthesis pass + moderation gate
  cron: 0.12, //    the daily longitudinal council run (same shape as council)
  trace: 0.08, //   baseline + augmented + delta = 3 Sonnet passes
  query: 0.04, //   one Sonnet deliberation (+ Haiku classifier)
};

export function budgetCapUsd() {
  const n = parseFloat(process.env.BUDGET_CAP_USD || "");
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
}

export function budgetMarginUsd() {
  const n = parseFloat(process.env.BUDGET_SOFT_MARGIN_USD || "");
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MARGIN_USD;
}

export function budgetWarnFraction() {
  const n = parseFloat(process.env.BUDGET_WARN_FRACTION || "");
  return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_WARN_FRACTION;
}

export function effectiveCeilingUsd() {
  return Math.max(0, budgetCapUsd() - budgetMarginUsd());
}

// ── Runtime-adjustable override (extend/adjust without a redeploy) ────────────
// A single operator-set config blob. Precedence at read time: this override >
// env vars > built-in defaults. Env stays the durable floor (survives an override
// reset); the override is the "raise the ceiling NOW during a surge" lever. RMW is
// safe here — it's a single operator writing occasionally, never concurrent runs.
export async function readBudgetConfig() {
  try {
    const { blobs } = await list({ prefix: CONFIG_KEY });
    if (!blobs.length) return {};
    const res = await fetch(`${blobs[0].url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return {};
    const cfg = await res.json();
    return cfg && typeof cfg === "object" ? cfg : {};
  } catch {
    return {};
  }
}

export async function writeBudgetConfig(patch) {
  const current = await readBudgetConfig();
  const next = { ...current };
  // Only accept well-formed numbers; ignore junk so a bad write can't disable the cap.
  if (Number.isFinite(patch?.cap_usd) && patch.cap_usd > 0) next.cap_usd = patch.cap_usd;
  if (Number.isFinite(patch?.margin_usd) && patch.margin_usd >= 0) next.margin_usd = patch.margin_usd;
  if (Number.isFinite(patch?.warn_fraction) && patch.warn_fraction > 0 && patch.warn_fraction < 1) next.warn_fraction = patch.warn_fraction;
  next.updated_at = new Date().toISOString();
  await put(CONFIG_KEY, JSON.stringify(next), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return next;
}

// Clear the override so resolution falls back to env/defaults. Writes an empty
// config (no cap/margin/warn keys) rather than deleting, so a stale CDN read can
// never resurrect an old cap.
export async function resetBudgetConfig() {
  await put(CONFIG_KEY, JSON.stringify({ updated_at: new Date().toISOString() }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return {};
}

// Merge the override over env/defaults. Never throws — a config read failure
// falls back to env/defaults, which are always safe (they can only be MORE
// conservative than an override that raised the cap).
export async function resolveBudgetConfig() {
  const cfg = await readBudgetConfig();
  const cap = Number.isFinite(cfg.cap_usd) && cfg.cap_usd > 0 ? cfg.cap_usd : budgetCapUsd();
  const margin = Number.isFinite(cfg.margin_usd) && cfg.margin_usd >= 0 ? cfg.margin_usd : budgetMarginUsd();
  const warnFraction = Number.isFinite(cfg.warn_fraction) && cfg.warn_fraction > 0 && cfg.warn_fraction < 1
    ? cfg.warn_fraction : budgetWarnFraction();
  const overridden = ["cap_usd", "margin_usd", "warn_fraction"].some((k) => Number.isFinite(cfg[k]));
  return { cap, margin, ceiling: Math.max(0, cap - margin), warnFraction, source: overridden ? "override" : "env", updatedAt: cfg.updated_at || null };
}

export async function resolvedCeilingUsd() {
  return (await resolveBudgetConfig()).ceiling;
}

// Pure — the "approaching" logic, exported for tests. Returns ok | approaching |
// exhausted for a given spend against a ceiling.
export function spendLevel(spent, ceiling, warnFraction = DEFAULT_WARN_FRACTION) {
  if (!(ceiling > 0)) return "exhausted";
  if (spent >= ceiling) return "exhausted";
  if (spent >= ceiling * warnFraction) return "approaching";
  return "ok";
}

export function estimatedCostUsd(kind) {
  const c = COST_USD[kind];
  if (Number.isFinite(c)) return c;
  // Unknown kind → charge the most expensive known estimate (conservative).
  return Math.max(...Object.values(COST_USD));
}

export function costTable() {
  return { ...COST_USD };
}

// The set of UTC day-strings inside the rolling window: today plus the previous
// (WINDOW_DAYS - 1) days. Day-bucket granularity means the summed window spans
// between 29 and 30 full days of data — the extra partial day is included, which
// is the conservative (stop-sooner) direction.
function windowDaySet() {
  const set = new Set();
  const now = Date.now();
  for (let i = 0; i < WINDOW_DAYS; i++) {
    set.add(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  return set;
}

// Sum spend (USD) inside the rolling window by LISTing marker blobs and parsing
// the microdollar amount out of each pathname. THROWS on a list failure — the
// caller (checkBudget) turns that into a fail-closed refusal.
export async function spentLast30DaysUsd() {
  const days = windowDaySet();
  let micros = 0;
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs || []) {
      // pathname: budget/spend/<YYYY-MM-DD>/<ts>__<rand>__<micros>.json
      const parts = b.pathname.split("/");
      const day = parts[2];
      if (!days.has(day)) continue;
      const m = /__(\d+)\.json$/.exec(parts[parts.length - 1] || "");
      if (m) micros += parseInt(m[1], 10);
    }
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  return micros / 1e6;
}

/**
 * Guard for one spending action. Call BEFORE spending.
 * Returns { allowed, spent, estCost, projected, cap, margin, ceiling, remaining,
 *           windowDays, reason }.
 * On ANY ledger error, returns allowed:false (constraint 2 — fail closed).
 */
export async function checkBudget(kind) {
  const { cap, margin, ceiling, warnFraction } = await resolveBudgetConfig();
  const estCost = estimatedCostUsd(kind);
  try {
    const spent = await spentLast30DaysUsd();
    const projected = spent + estCost;
    const allowed = projected <= ceiling;
    const level = allowed ? spendLevel(spent, ceiling, warnFraction) : "exhausted";
    if (level === "approaching") {
      // Surfaces in Vercel logs while spending near the ceiling — the passive notice.
      console.warn(`[budget] APPROACHING ceiling: $${spent.toFixed(2)} of $${ceiling.toFixed(2)} spent (30d). Raise it via POST /api/info?_view=budget or BUDGET_CAP_USD.`);
    }
    return {
      allowed, spent, estCost, projected, cap, margin, ceiling, level, warnFraction,
      remaining: Math.max(0, ceiling - spent),
      windowDays: WINDOW_DAYS,
      reason: allowed ? null : "budget-exhausted",
    };
  } catch {
    return {
      allowed: false, spent: null, estCost, projected: null, cap, margin, ceiling, level: "unknown", warnFraction,
      remaining: null, windowDays: WINDOW_DAYS,
      reason: "ledger-unavailable-failclosed",
    };
  }
}

// The "limit is approaching" notice — attached to a spending endpoint's SUCCESS
// response when level === "approaching", so the operator sees it in-band. Tells
// them where they stand and, per the request, how to extend or adjust.
export function budgetNotice(budget) {
  if (!budget || budget.level !== "approaching") return null;
  const pct = budget.ceiling > 0 ? Math.round((budget.spent / budget.ceiling) * 100) : 100;
  return {
    level: "approaching",
    message: `Compute budget is ${pct}% used for the rolling ${budget.windowDays}-day window ($${budget.spent.toFixed(2)} of $${budget.ceiling.toFixed(2)}). Live model spend pauses at the ceiling.`,
    spent_usd: budget.spent,
    ceiling_usd: budget.ceiling,
    remaining_usd: budget.remaining,
    extend: {
      now_no_redeploy: "POST /api/info?_view=budget {\"cap_usd\": <new $ cap>} with Bearer INGEST_SECRET — effective immediately.",
      durable: "Set BUDGET_CAP_USD (and optionally BUDGET_SOFT_MARGIN_USD / BUDGET_WARN_FRACTION) in the environment; survives an override reset.",
    },
  };
}

/**
 * Record that a spend happened. Call AFTER a successful run (a failed run that
 * produced nothing the caller got value from spent little and should not be
 * charged — same reasoning as _quota.js's recordCouncilRun). Never throws: a
 * lost marker under-counts by one run (~$0.12), which the margin absorbs.
 */
export async function recordSpend(kind, { usd } = {}) {
  const cost = Number.isFinite(usd) ? usd : estimatedCostUsd(kind);
  const micros = Math.max(0, Math.round(cost * 1e6));
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${PREFIX}${day}/${stamp}__${rand}__${micros}.json`;
  try {
    await put(key, JSON.stringify({ at: now.toISOString(), kind, usd: cost }), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return true;
  } catch {
    return false;
  }
}

// Read surface for the curator / verification (never throws). Backs
// GET /api/info?_view=budget.
export async function budgetStatus() {
  const { cap, margin, ceiling, warnFraction, source, updatedAt } = await resolveBudgetConfig();
  try {
    const spent = await spentLast30DaysUsd();
    const level = spendLevel(spent, ceiling, warnFraction);
    return {
      ok: true, spent, cap, margin, ceiling,
      remaining: Math.max(0, ceiling - spent),
      level, // ok | approaching | exhausted
      warn_at_usd: +(ceiling * warnFraction).toFixed(2),
      warn_fraction: warnFraction,
      config_source: source, // "override" (live-adjusted) or "env" (default/env)
      config_updated_at: updatedAt,
      windowDays: WINDOW_DAYS,
      costs: costTable(),
      adjust: {
        extend_now: "POST /api/info?_view=budget {\"cap_usd\": <n>, \"margin_usd\"?: <n>, \"warn_fraction\"?: <0-1>} with Bearer INGEST_SECRET — no redeploy.",
        reset_override: "POST /api/info?_view=budget {\"reset\": true} — fall back to env/defaults.",
      },
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), cap, margin, ceiling, windowDays: WINDOW_DAYS };
  }
}

// The 429 body a blocked spending endpoint returns. Shared so council / query /
// cron speak the same shape, and so an agent can branch on `code`. `freeCall` is
// the specific free alternative for the endpoint that was blocked.
export function budgetExceededBody(kind, budget, freeCall) {
  const isFailClosed = budget.reason === "ledger-unavailable-failclosed";
  return {
    error: isFailClosed
      ? "Spending is paused: the budget ledger is unreadable, so the engine cannot confirm it is under its compute ceiling and will not spend until it can."
      : `Compute budget reached for the rolling ${budget.windowDays}-day window (ceiling $${budget.ceiling.toFixed(2)}). Live model spend is paused until spend ages out of the window.`,
    code: isFailClosed ? "BUDGET_LEDGER_UNAVAILABLE" : "BUDGET_EXCEEDED",
    agent_action:
      "This is a hard, guaranteed compute-cost ceiling, not a per-visitor rate limit — it protects the operator from an unbounded bill. Everything already captured is free and uncapped: read the stored Divergence Atlas at GET /api/divergences (or /api/divergences/search?q=...), and use the free retrieval layer at GET /api/query?q=...&mode=retrieve.",
    retryable: true,
    budget: {
      window_days: budget.windowDays,
      ceiling_usd: budget.ceiling,
      spent_usd: budget.spent,
      remaining_usd: budget.remaining,
      reason: budget.reason,
    },
    suggested_next_call: freeCall || { method: "GET", url: "/api/divergences" },
  };
}
