#!/usr/bin/env node
// Thin wrapper (2026-10-14). The audit lives in api/_surface-audit.js — ONE implementation shared with the
// public /api/sync tracker — and scripts/check-surfaces.mjs renders it. This file only keeps the old
// invocation (and the weekly scheduled task that calls it) working, restricted to the "stats" layer.
//   node scripts/check-stats-consistency.mjs [--scope front|engine|hf|all] [--verbose] [--json]
process.env.OMNARAI_AUDIT_LAYERS = "stats";
await import("./check-surfaces.mjs");
