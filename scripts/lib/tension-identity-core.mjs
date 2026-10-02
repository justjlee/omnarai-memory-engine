// Persistent tension identity — PURE core (no network, no I/O). Spec: docs/TENSION-IDENTITY.md.
//
// Problem: Atlas tensions are `{voice_a, claim_a, voice_b, claim_b, topic, status}` inside one record, with free-text `topic`. The
// existing string key (api/tensions.js `tensionKey`: sorted voices + slugged topic) links almost nothing across records, so a
// recurring disagreement looks like unrelated notes and nothing can accumulate a history.
//
// Model: a SIGHTING is one tension inside one record. A TENSION is a cluster of sightings judged to be the same underlying
// disagreement. Three properties are load-bearing:
//   1. STABLE ID   — id = hash of the FOUNDING sighting's id; later sightings never change it (append-only).
//   2. CANNOT-LINK — two sightings from the same record never share a cluster. This is a DESIGN CHOICE, not a fact: one record's pairwise
//                    tensions can restate the same axis (5 voices ⇒ overlapping pairs), so within-record redundancy is real (see
//                    docs/TENSION-IDENTITY.md §5). The choice keeps `n_records` = distinct appearances; it means such a record contributes
//                    two tensions, never one.
//   3. ORIENTATION — the same disagreement is stored with sides swapped; each member carries which of its two voices holds the
//                    cluster's A side, so per-model stance over time is recoverable.
// Everything here is DERIVED, and labelled so. It is a similarity judgement, not a ruling that two disagreements are "the same".
import { createHash } from "node:crypto";

export const SCHEMA = "omnarai.tension-identity/v0";
export const EVIDENCE_STATUS = "derived-unreviewed";
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const tensionIdFor = (founderSightingId) => "OMN-T-" + sha256("tension|" + founderSightingId).slice(0, 12);

const idNum = (id) => Number(String(id).replace(/^\D+/, "")) || 0;

/** Flatten Atlas records to sightings, in a total chronological order (captured_at, then numeric record id, then index). */
export function sightingsFromRecords(records) {
  const out = [];
  for (const r of records) {
    (r.tensions || []).forEach((t, i) => {
      out.push({
        sighting_id: `${r.id}#${i}`, record_id: r.id, index: i, captured_at: r.captured_at,
        voice_a: t.voice_a, voice_b: t.voice_b, claim_a: t.claim_a, claim_b: t.claim_b, topic: t.topic || "", status: t.status || null,
      });
    });
  }
  return out.sort((x, y) =>
    String(x.captured_at).localeCompare(String(y.captured_at)) || idNum(x.record_id) - idNum(y.record_id) || x.index - y.index);
}

export const dot = (u, v) => { let s = 0; for (let i = 0; i < u.length; i++) s += u[i] * v[i]; return s; };
export function unit(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float64Array.from(v, (x) => x / n); }

/** Orientation-aware similarity of two sightings' claim pairs. swap=true ⇒ y's sides are reversed relative to x. */
export function pairSim(x, y) {
  const direct = (dot(x.a, y.a) + dot(x.b, y.b)) / 2;
  const swapped = (dot(x.a, y.b) + dot(x.b, y.a)) / 2;
  return swapped > direct ? { sim: swapped, swap: true } : { sim: direct, swap: false };
}

const orient = (v, swap) => (swap ? { a: v.b, b: v.a } : { a: v.a, b: v.b });

/**
 * Assign every sighting to a tension, chronologically, by average linkage with the cannot-link constraint.
 *   sightings : output of sightingsFromRecords (already ordered)
 *   vecs      : Map sighting_id → {a: unit vector of claim_a, b: unit vector of claim_b}
 *   opts.tau  : join threshold on mean oriented similarity to the cluster's members
 *   opts.prior: optional frozen assignments [{sighting_id, tension_id, swap}] — those sightings keep their tension and are not
 *               revisited; only sightings absent from `prior` are assigned. This is what makes ids stable as the Atlas grows.
 * Returns { assignments: [{sighting_id, tension_id, swap, sim_to_tension|null, founded}] , tensions: Map }
 */
export function assign(sightings, vecs, { tau, prior = [] } = {}) {
  if (!(tau > 0 && tau <= 1)) throw new Error("tau must be in (0, 1]");
  const tensions = new Map(); // tension_id → { id, members: [{sighting_id, record_id, v}] , records:Set }
  const assignments = [];
  const bySighting = new Map(sightings.map((s) => [s.sighting_id, s]));
  const frozen = new Set();

  for (const p of prior) {
    const s = bySighting.get(p.sighting_id); if (!s) continue;
    frozen.add(p.sighting_id);
    let t = tensions.get(p.tension_id);
    if (!t) { t = { id: p.tension_id, members: [], records: new Set() }; tensions.set(p.tension_id, t); }
    t.members.push({ sighting_id: s.sighting_id, record_id: s.record_id, v: orient(vecs.get(s.sighting_id), p.swap) });
    t.records.add(s.record_id);
    assignments.push({ sighting_id: p.sighting_id, tension_id: p.tension_id, swap: p.swap, sim_to_tension: p.sim_to_tension ?? null, founded: !!p.founded });
  }

  for (const s of sightings) {
    if (frozen.has(s.sighting_id)) continue;
    const x = vecs.get(s.sighting_id);
    if (!x) throw new Error(`missing vectors for ${s.sighting_id}`);
    let best = null;
    for (const t of tensions.values()) {
      if (t.records.has(s.record_id)) continue; // cannot-link: same record ⇒ distinct tensions
      for (const swap of [false, true]) {
        const xo = orient(x, swap); let sum = 0;
        for (const m of t.members) sum += (dot(xo.a, m.v.a) + dot(xo.b, m.v.b)) / 2;
        const mean = sum / t.members.length;
        if (!best || mean > best.sim || (mean === best.sim && t.id < best.t.id)) best = { t, swap, sim: mean };
      }
    }
    if (best && best.sim >= tau) {
      best.t.members.push({ sighting_id: s.sighting_id, record_id: s.record_id, v: orient(x, best.swap) });
      best.t.records.add(s.record_id);
      assignments.push({ sighting_id: s.sighting_id, tension_id: best.t.id, swap: best.swap, sim_to_tension: best.sim, founded: false });
    } else {
      const id = tensionIdFor(s.sighting_id);
      tensions.set(id, { id, members: [{ sighting_id: s.sighting_id, record_id: s.record_id, v: orient(x, false) }], records: new Set([s.record_id]) });
      assignments.push({ sighting_id: s.sighting_id, tension_id: id, swap: false, sim_to_tension: null, founded: true });
    }
  }
  return { assignments, tensions };
}

/**
 * Assign sightings to tensions from ADJUDICATED LINKS instead of raw similarity (the embedding is then only a candidate generator).
 *   links : Map "<sightingA>|<sightingB>" (A sorted before B) → { swap }  — consensus-"same" pairs only. A pair absent from `links`
 *           is treated as NOT linked (never adjudicated, or no consensus).
 * A sighting joins the cluster it shares the largest FRACTION of links with, provided it is linked to at least `minShare` of that
 * cluster's members (default one half — so one stray link cannot drag a sighting into a large cluster), the cluster holds no sighting
 * from the same record, and the linked members agree on orientation (a split orientation vote is a conflict ⇒ found a new tension).
 */
export const linkKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
export function assignByLinks(sightings, links, { minShare = 0.5, prior = [] } = {}) {
  const tensions = new Map();
  const assignments = [];
  const frozen = new Set();
  const swapOf = new Map(); // sighting_id → swap relative to its cluster frame
  const bySighting = new Map(sightings.map((s) => [s.sighting_id, s]));
  for (const p of prior) {
    if (!bySighting.has(p.sighting_id)) continue;
    frozen.add(p.sighting_id); swapOf.set(p.sighting_id, p.swap);
    const t = tensions.get(p.tension_id) || tensions.set(p.tension_id, { id: p.tension_id, members: [], records: new Set() }).get(p.tension_id);
    t.members.push(p.sighting_id); t.records.add(bySighting.get(p.sighting_id).record_id);
    assignments.push({ sighting_id: p.sighting_id, tension_id: p.tension_id, swap: p.swap, link_share: p.link_share ?? null, founded: !!p.founded });
  }
  for (const s of sightings) {
    if (frozen.has(s.sighting_id)) continue;
    let best = null;
    for (const t of tensions.values()) {
      if (t.records.has(s.record_id)) continue;
      let n = 0, swapVotes = 0;
      for (const m of t.members) {
        const l = links.get(linkKey(s.sighting_id, m));
        if (!l) continue;
        n++;
        // l.swap is stated for the pair in sorted-key order; orientation of s relative to m is symmetric under swapping both sides.
        swapVotes += (l.swap ? 1 : 0) ^ (swapOf.get(m) ? 1 : 0) ? 1 : -1;
      }
      if (!n) continue;
      const share = n / t.members.length;
      if (share < minShare || swapVotes === 0) continue; // below share, or a tied orientation vote ⇒ conflict
      if (!best || share > best.share || (share === best.share && t.id < best.t.id)) best = { t, share, swap: swapVotes > 0 };
    }
    if (best) {
      best.t.members.push(s.sighting_id); best.t.records.add(s.record_id); swapOf.set(s.sighting_id, best.swap);
      assignments.push({ sighting_id: s.sighting_id, tension_id: best.t.id, swap: best.swap, link_share: +best.share.toFixed(3), founded: false });
    } else {
      const id = tensionIdFor(s.sighting_id);
      tensions.set(id, { id, members: [s.sighting_id], records: new Set([s.record_id]) }); swapOf.set(s.sighting_id, false);
      assignments.push({ sighting_id: s.sighting_id, tension_id: id, swap: false, link_share: null, founded: true });
    }
  }
  return { assignments, tensions };
}

/** Similarities between two tensions of the SAME record. Used only to calibrate the embedding-only baseline's threshold (NOT a clean negative control — see docs/TENSION-IDENTITY.md §5). */
export function withinRecordSims(sightings, vecs) {
  const byRec = new Map();
  for (const s of sightings) (byRec.get(s.record_id) || byRec.set(s.record_id, []).get(s.record_id)).push(s);
  const sims = [];
  for (const list of byRec.values())
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      sims.push(pairSim(vecs.get(list[i].sighting_id), vecs.get(list[j].sighting_id)).sim);
  return sims;
}

export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, r) => p - r); const k = (a.length - 1) * q; const f = Math.floor(k);
  return a[f] + (a[Math.min(f + 1, a.length - 1)] - a[f]) * (k - f);
}

/** Group assignments by tension with a stable, deterministic ordering. */
export function summarize(sightings, assignments) {
  const bySighting = new Map(sightings.map((s) => [s.sighting_id, s]));
  const groups = new Map();
  for (const a of assignments) (groups.get(a.tension_id) || groups.set(a.tension_id, []).get(a.tension_id)).push({ ...bySighting.get(a.sighting_id), ...a });
  return [...groups.entries()].map(([id, ms]) => {
    ms.sort((p, q) => String(p.captured_at).localeCompare(String(q.captured_at)) || idNum(p.record_id) - idNum(q.record_id) || p.index - q.index);
    return { tension_id: id, ms };
  }).sort((p, q) => q.ms.length - p.ms.length || (p.tension_id < q.tension_id ? -1 : 1));
}
