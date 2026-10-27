// Longitudinal tracks — one definition shared by the cron (api/council.js
// runLongitudinal) and the /home missed-day watch (api/info.js checkLongitudinal).
//
//   control   the standing council (api/_council.js COUNCIL), fixed model ids since
//             2026-06. Same model re-asked monthly = a noise floor
//             (analysis/longitudinal-baseline-v1).
//   frontier  each lab's current flagship (FRONTIER_COUNCIL) on the same frozen
//             canon = what newer minds say. It spends, so it runs only when the
//             curator sets FRONTIER_TRACK=on.
//
// Records written before tracks existed carry no `track`; they are control.

export const TRACKS = ["control", "frontier"];

export function trackOf(lon) {
  return lon?.track === "frontier" ? "frontier" : "control";
}

// ?track= on the cron request. Absent = control (the existing cron URL is
// unchanged); anything other than the two names is refused rather than guessed.
export function requestedTrack(query) {
  const t = query?.track;
  if (t === undefined || t === null || t === "") return "control";
  return TRACKS.includes(t) ? t : null;
}

export function frontierEnabled(env = process.env) {
  return env.FRONTIER_TRACK === "on";
}

function lonOf(e) {
  return e?.divergence?.longitudinal || e?.provenance?.longitudinal || null;
}

// The idempotency key is canon_id + epoch + track: a frontier record never
// counts as the control run for that day, and vice versa.
export function findEpochRecord(entries, { canon_id, epoch, track }) {
  return (entries || []).find((e) => {
    const lon = lonOf(e);
    return lon?.canon_id === canon_id && lon?.epoch === epoch && trackOf(lon) === track;
  }) || null;
}

// Canon ids already recorded for one track in one epoch, plus the newest record.
export function epochCoverage(entries, epoch, track) {
  const done = new Set();
  let last = null;
  for (const e of entries || []) {
    const lon = lonOf(e);
    if (!lon || trackOf(lon) !== track) continue;
    if (lon.epoch === epoch) done.add(lon.canon_id);
    if (!last || (e.date || "") > (last.date || "")) last = { id: e.id, date: e.date || null, canon_id: lon.canon_id };
  }
  return { done, last };
}
