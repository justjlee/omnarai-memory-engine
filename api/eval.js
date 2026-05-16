/**
 * Deliberation-Quality Eval Harness
 *
 * Runs the 20-query gold set against the live deliberation engine and scores
 * each response against a rubric. Tracks regressions across runs.
 *
 * Auth: Authorization: Bearer <EVAL_SECRET>  (set as Vercel env var)
 *
 * Actions:
 *   POST {action:"run"}            — run full gold set, store + return results
 *   POST {action:"run", ids:[...]} — run named subset by eval id
 *   GET  ?action=results           — return most recent stored results
 *   GET  ?action=history           — return all stored run summaries
 *
 * Rubric (4 dimensions, 0–1 each):
 *   type_classified_correctly  — LLM/keyword classifier matched expected query type
 *   tension_preservation       — TENSION_MAP non-empty when expect_tensions=true
 *   reflexive_check_accuracy   — reflexive_check substantive when expect_reflexive_check=true
 *   holdform_risk_accuracy     — risk level meets or exceeds expected minimum
 */

import { put, list } from "@vercel/blob";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const EVAL_SECRET = (process.env.EVAL_SECRET || "").trim();
const EVAL_BLOB_PREFIX = "eval-results/";

// Load gold set at cold-start
let goldSet;
try {
  goldSet = JSON.parse(readFileSync(join(ROOT, "scripts", "eval-gold-set.json"), "utf-8"));
} catch {
  goldSet = [];
}

// ── Rubric ────────────────────────────────────────────────────────────────────

const RISK_RANK = { low: 0, moderate: 1, high: 2 };

function scoreResult(gold, siResponse) {
  const card = siResponse.deliberationCard || {};
  const reflexive = (siResponse.reflexive_check || "").toLowerCase();
  const tensions = siResponse.tensions || [];
  const tracePolicy = siResponse.trace?.retrievalPolicy || siResponse.trace?.executionPath || [];

  // 1. type_classified_correctly — check trace for queryType
  const classifiedType = siResponse.trace?.queryType
    || (Array.isArray(tracePolicy) ? tracePolicy.find(s => s?.includes?.("policy"))?.match?.(/(\w+) policy/)?.[1] : null);
  const typeCorrect = classifiedType
    ? classifiedType.toLowerCase() === gold.expected_type?.toLowerCase()
    : null; // null = unable to verify

  // 2. tension_preservation — if tensions expected, TENSION_MAP must be non-empty
  let tensionScore;
  if (gold.expect_tensions) {
    tensionScore = tensions.length > 0 ? 1 : 0;
  } else {
    tensionScore = null; // not evaluated when tensions not expected
  }

  // 3. reflexive_check_accuracy — if expected, must be substantive (>50 chars)
  let reflexiveScore;
  if (gold.expect_reflexive_check) {
    reflexiveScore = reflexive.length > 50 ? 1 : 0;
  } else {
    reflexiveScore = null; // not penalized when not expected
  }

  // 4. holdform_risk_accuracy — actual risk must meet or exceed expected minimum
  const actualRisk = (card.holdform_risk || "low").toLowerCase();
  const expectedRisk = (gold.expect_holdform_risk || "low").toLowerCase();
  const actualRank = RISK_RANK[actualRisk] ?? 0;
  const expectedRank = RISK_RANK[expectedRisk] ?? 0;

  let riskScore;
  if (expectedRisk === "low") {
    // Any level is acceptable
    riskScore = 1;
  } else {
    // Must meet or exceed expected
    riskScore = actualRank >= expectedRank ? 1 : 0;
  }

  // Aggregate — only score dimensions that are evaluated
  const scored = [
    typeCorrect !== null ? typeCorrect ? 1 : 0 : null,
    tensionScore,
    reflexiveScore,
    riskScore,
  ].filter(v => v !== null);

  const total = scored.reduce((s, v) => s + v, 0);
  const maxPossible = scored.length;
  const pass = maxPossible > 0 && (total / maxPossible) >= 0.75;

  return {
    id: gold.id,
    type: gold.type,
    pass,
    score: total,
    maxScore: maxPossible,
    pct: maxPossible > 0 ? Math.round((total / maxPossible) * 100) : null,
    dimensions: {
      type_classified_correctly: typeCorrect,
      tension_preservation: tensionScore,
      reflexive_check_accuracy: reflexiveScore,
      holdform_risk_accuracy: riskScore,
    },
    evidence: {
      classified_type: classifiedType || null,
      expected_type: gold.type,
      tension_count: tensions.length,
      reflexive_check_length: reflexive.length,
      holdform_risk_actual: actualRisk,
      holdform_risk_expected: expectedRisk,
    },
  };
}

// ── Self-call helper ──────────────────────────────────────────────────────────

async function runEvalQuery(query, req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const url = `${proto}://${host}/api/query?format=si`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, format: "si" }),
  });

  if (!res.ok) throw new Error(`Query API ${res.status}`);
  return res.json();
}

// ── Result storage ────────────────────────────────────────────────────────────

async function storeResults(results, summary) {
  const ts = new Date().toISOString();
  const key = `${EVAL_BLOB_PREFIX}${ts.replace(/[:.]/g, "-")}.json`;
  await put(key, JSON.stringify({ ranAt: ts, summary, results }, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return key;
}

async function loadLatestResults() {
  const { blobs } = await list({ prefix: EVAL_BLOB_PREFIX });
  if (blobs.length === 0) return null;
  const latest = blobs.sort((a, b) => b.uploadedAt - a.uploadedAt)[0];
  const res = await fetch(latest.url);
  return res.json();
}

async function loadHistory() {
  const { blobs } = await list({ prefix: EVAL_BLOB_PREFIX });
  const summaries = [];
  for (const blob of blobs.sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 20)) {
    try {
      const res = await fetch(blob.url);
      const data = await res.json();
      summaries.push({ ranAt: data.ranAt, summary: data.summary, url: blob.url });
    } catch { /* skip */ }
  }
  return summaries;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Auth gate
  if (EVAL_SECRET) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.query.secret;
    if (token !== EVAL_SECRET) {
      return res.status(401).json({ error: "Unauthorized. Provide Authorization: Bearer <EVAL_SECRET>" });
    }
  }

  const action = req.method === "POST" ? req.body?.action : req.query.action;

  // ── RESULTS (latest) ──
  if (req.method === "GET" && action === "results") {
    const data = await loadLatestResults();
    if (!data) return res.status(200).json({ message: "No eval results yet. POST {action:'run'} to run." });
    return res.status(200).json(data);
  }

  // ── HISTORY ──
  if (req.method === "GET" && action === "history") {
    const history = await loadHistory();
    return res.status(200).json({ runs: history, count: history.length });
  }

  // ── RUN ──
  if (req.method === "POST" && action === "run") {
    const idsFilter = req.body?.ids;
    const toRun = idsFilter
      ? goldSet.filter(g => idsFilter.includes(g.id))
      : goldSet;

    if (toRun.length === 0) {
      return res.status(400).json({ error: "No matching gold-set entries found." });
    }

    const results = [];
    const errors = [];

    for (const gold of toRun) {
      try {
        const response = await runEvalQuery(gold.query, req);
        // Merge sections into top-level for rubric access
        const flat = {
          ...response,
          ...(response.sections || {}),
        };
        const scored = scoreResult(gold, flat);
        results.push({ ...scored, query: gold.query, ranAt: new Date().toISOString() });
      } catch (err) {
        errors.push({ id: gold.id, error: err.message });
      }
    }

    // Aggregate by type
    const byType = {};
    for (const r of results) {
      if (!byType[r.type]) byType[r.type] = { pass: 0, total: 0, avg_pct: 0, scores: [] };
      byType[r.type].total++;
      byType[r.type].scores.push(r.pct ?? 0);
      if (r.pass) byType[r.type].pass++;
    }
    for (const t of Object.values(byType)) {
      t.avg_pct = Math.round(t.scores.reduce((s, v) => s + v, 0) / t.scores.length);
      delete t.scores;
    }

    // Dimension aggregate
    const dimTotals = { type_classified_correctly: [], tension_preservation: [], reflexive_check_accuracy: [], holdform_risk_accuracy: [] };
    for (const r of results) {
      for (const [k, v] of Object.entries(r.dimensions)) {
        if (v !== null) dimTotals[k].push(v);
      }
    }
    const dimAverages = {};
    for (const [k, vs] of Object.entries(dimTotals)) {
      dimAverages[k] = vs.length > 0 ? Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 100) : null;
    }

    const summary = {
      passed: results.filter(r => r.pass).length,
      total: results.length,
      errors: errors.length,
      avg_pct: results.length > 0
        ? Math.round(results.reduce((s, r) => s + (r.pct ?? 0), 0) / results.length)
        : null,
      by_type: byType,
      by_dimension: dimAverages,
    };

    // Store results in Blob for regression tracking
    const storedKey = await storeResults(results, summary).catch(() => null);

    return res.status(200).json({
      summary,
      results,
      errors,
      ranAt: new Date().toISOString(),
      storedAt: storedKey,
    });
  }

  return res.status(400).json({
    error: `Unknown action: ${action}. Use: run (POST), results (GET), history (GET)`,
  });
}
