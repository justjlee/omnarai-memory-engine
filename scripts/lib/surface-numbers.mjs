// Re-export: the pure logic lives in api/_surface-numbers.js so the public /api/sync endpoint and the
// deploy gates share ONE implementation of "what counts as a stale number".
export * from "../../api/_surface-numbers.js";
