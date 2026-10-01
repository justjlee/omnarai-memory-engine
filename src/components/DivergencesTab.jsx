import { useState, useEffect, useMemo, useRef } from "react";
import { T } from "../theme";
import DivergenceRecord from "./DivergenceRecord";

const mono = { fontFamily: "'IBM Plex Mono',monospace" };

const certTier = r => (r.certification || {}).tier || null;
// Highest robustness first. C2 (pressure-robust only) is ranked above C1 but below C3;
// no live record holds C2 today, and the filter says so rather than hiding the tier.
const TIER_RANK = { C3: 4, C2: 3, C1: 2, C0: 0 };
const tierRank = t => TIER_RANK[t] || 0;
const TIERS = ["C3", "C2", "C1", "C0"];

// Word for each tier. Only C3 is called "certified" / "genuine divergence"
// (docs/tier3-perturbation-rigor.md): C1 and C2 each held under ONE perturbation, so
// they are named for what they survived and nothing more. Never upgrade a tier in copy.
const TIER_WORD = { C3: "certified", C2: "pressure-robust", C1: "paraphrase-robust", C0: "captured" };

// A record's certification tier, shown as a chip on the browse list so the
// splits that survived perturbation are findable without opening each one.
function TierChip({ tier }) {
  if (!tier) return null;
  if (tier === "C0") {
    return <span style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.35)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, padding: "1px 6px" }}>captured</span>;
  }
  const c = tier === "C3" ? T.green : T.gold;
  return <span style={{ ...mono, fontSize: 8.5, color: c, border: `1px solid ${c}55`, borderRadius: 5, padding: "1px 6px" }}>{tier} · {TIER_WORD[tier] || tier}</span>;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Every number here is read from the live index — nothing is hardcoded — and the tier
// language follows the legend: only C3 survived paraphrase AND adversarial pressure.
function FindingBanner({ index }) {
  const total = index.count;
  const tested = index.tested_count;
  const dist = index.tier_distribution || {};
  const n = k => dist[k] || 0;
  const v = k => (n(k) === 1 ? "survives" : "survive");
  if (!total || n("C3") + n("C2") + n("C1") === 0) return null;
  const dris = (index.records || []).map(r => (r.certification || {}).dri).filter(Number.isFinite);
  const med = median(dris);
  const c0 = total - n("C3") - n("C2") - n("C1");
  const link = { color: T.green, textDecoration: "none", borderBottom: `1px solid ${T.green}40` };
  return (
    <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.62)", background: "rgba(126,186,166,0.05)", border: "1px solid rgba(126,186,166,0.18)", borderRadius: 8, padding: "12px 15px", marginBottom: 16, lineHeight: 1.65 }}>
      <span style={{ ...mono, color: T.green }}>The finding, stated plainly:</span> sent the same question, today's frontier models mostly <em>converge</em>.
      {" "}Of {total} recorded splits, {tested} have been put through perturbation.
      {" "}{n("C3")} {v("C3")} <em>both</em> paraphrase and adversarial pressure (C3 — the only tier called genuine divergence)
      {n("C1") > 0 && <>; {n("C1")} more {v("C1")} paraphrase alone (C1)</>}
      {n("C2") > 0 && <>; {n("C2")} {v("C2")} pressure alone (C2)</>}.
      {" "}The other {c0} are C0: captured once, or tested without clearing a tier.
      {med != null && <> Across the {dris.length} scored for robustness, the median split's between-model spread sits right at a single model's own re-roll variance (median DRI ≈ {med.toFixed(2)}).</>}
      {" "}Genuine divergence is real but <em>rare</em>; in the July campaign it clustered in behavioral-ethical questions (intervention, self-trust, tuning-as-identity) rather than metaphysical ones. That rarity is the measured result, not a gap in coverage.
      {" "}See <a href="/claims.json" target="_blank" rel="noopener noreferrer" style={link}>claims.json → cross-model-divergence-is-prevalent</a>
      {" "}and <a href="/limitations.md" target="_blank" rel="noopener noreferrer" style={link}>what this does not claim</a>.
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 19, fontWeight: 600, marginBottom: 3, color: "#C87272" }}>
        Divergence Records
      </h2>
      <p style={{ fontSize: 10.5, color: "rgba(200,192,176,0.45)", marginBottom: 8, fontWeight: 300, lineHeight: 1.6 }}>
        One open question, sent verbatim to multiple frontier models — their answers preserved <em>uncurated</em>,
        with the exact points where they disagree named. This is content no single model can generate alone:
        a map of where minds actually split.
      </p>
      <a href="/api/divergences" target="_blank" rel="noopener noreferrer"
        style={{ ...mono, fontSize: 9.5, color: T.green, textDecoration: "none", borderBottom: `1px solid ${T.green}40` }}>
        → machine-readable: GET /api/divergences
      </a>
    </div>
  );
}

// Fallback when semantic search is unavailable (the embedding call can fail): plain
// any-word match over the index we already hold, labelled as such so nobody mistakes it
// for the by-meaning ranking.
function lexicalMatches(records, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (!terms.length) return [];
  return records.filter(r => {
    const hay = `${r.title || ""} ${r.question || ""}`.toLowerCase();
    return terms.some(t => hay.includes(t));
  });
}

function RecordRow({ r, onOpen }) {
  return (
    <button onClick={() => onOpen(r.id)} style={{
      width: "100%", textAlign: "left", cursor: "pointer", display: "block",
      background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10, padding: "16px 18px", marginBottom: 10, transition: "border-color 0.2s",
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "#C8727255")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}>
      <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 17, fontWeight: 600, color: T.bone, marginBottom: 6, lineHeight: 1.3 }}>
        {(r.title || r.question || r.id).replace(/^Divergence:\s*/, "")}
      </div>
      <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.5)", fontStyle: "italic", lineHeight: 1.5, marginBottom: 10, fontWeight: 300 }}>
        {r.question}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)" }}>
        <span style={{ color: "#C87272" }}>{r.answerCount} voices</span>
        {r.tensionCount != null && <span>{r.tensionCount} tensions</span>}
        {r.date && <span>{r.date}</span>}
        <TierChip tier={certTier(r)} />
        {r.score != null && <span title="cosine similarity to your query">match {r.score.toFixed(2)}</span>}
        <span style={{ color: T.green }}>read →</span>
      </div>
    </button>
  );
}

// Controlled by App.jsx: `openId` (which record, if any, is open) and the
// history/URL sync live there so a record page has one real, shareable URL
// regardless of whether it was reached via a list click, the Atlas hero CTA,
// or a direct link. This component fetches the index + the one open record,
// and owns the list's search box and tier filter.
export default function DivergencesTab({ openId, onOpen, onClose, onDeliberate }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(null);
  const [record, setRecord] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ status: "idle" });
  const [tier, setTier] = useState("ALL");

  useEffect(() => {
    fetch("/api/divergences")
      .then(r => r.json())
      .then(setIndex)
      .catch(() => setError("Could not load divergence records."));
  }, []);

  useEffect(() => {
    if (!openId) { setRecord(null); return; }
    let live = true;
    setRecord(null);
    setLoadingRec(true);
    fetch(`/api/divergences?id=${encodeURIComponent(openId)}`)
      .then(r => r.json())
      .then(d => { if (live) { setRecord(d); setLoadingRec(false); } })
      .catch(() => { if (live) { setError("Could not load that record."); setLoadingRec(false); } });
    return () => { live = false; };
  }, [openId]);

  // Semantic search runs on an explicit submit (Enter / button), never per keystroke: each
  // query is one embedding call on the engine. A sequence number drops stale responses.
  const searchSeq = useRef(0);
  const runSearch = q => {
    const seq = ++searchSeq.current;
    setQuery(q);
    setSearch({ status: "loading" });
    fetch(`/api/divergences/search?q=${encodeURIComponent(q)}&k=10`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (seq === searchSeq.current) setSearch({ status: "ok", results: Array.isArray(d.results) ? d.results : [] }); })
      .catch(() => { if (seq === searchSeq.current) setSearch({ status: "fallback" }); });
  };

  const byId = useMemo(() => new Map(((index && index.records) || []).map(r => [r.id, r])), [index]);

  // Rows before the tier filter, in the order they should be shown.
  const baseRows = useMemo(() => {
    if (!index) return [];
    const all = index.records || [];
    if (query && search.status === "ok") {
      return search.results.map(h => ({ ...(byId.get(h.id) || { id: h.id, title: h.question, question: h.question, answerCount: (h.contributors || []).length, tensionCount: null, certification: null }), score: h.score }));
    }
    if (query && search.status === "fallback") return lexicalMatches(all, query);
    // Browse: certified splits rise to the top so the strongest evidence is the first thing a
    // visitor sees; Array.sort is stable, so original order is kept within each tier band.
    return [...all].sort((a, b) => tierRank(certTier(b)) - tierRank(certTier(a)));
  }, [index, query, search, byId]);

  const tierCounts = useMemo(() => {
    const c = { C3: 0, C2: 0, C1: 0, C0: 0 };
    for (const r of baseRows) { const t = certTier(r); if (t in c) c[t]++; }
    return c;
  }, [baseRows]);

  const rows = tier === "ALL" ? baseRows : baseRows.filter(r => certTier(r) === tier);

  const submit = e => {
    e.preventDefault();
    const q = draft.trim();
    if (q.length >= 2) runSearch(q);
  };
  const clear = () => { searchSeq.current++; setDraft(""); setQuery(""); setSearch({ status: "idle" }); setTier("ALL"); };

  if (error) return <div><Header /><p style={{ color: "#C87272", fontSize: 12 }}>{error}</p></div>;

  if (openId) {
    return <DivergenceRecord key={openId} record={record} loading={loadingRec} onBack={onClose} onOpenRecord={onOpen} onDeliberate={onDeliberate} />;
  }

  const chip = active => ({
    ...mono, fontSize: 9.5, cursor: "pointer", borderRadius: 6, padding: "4px 9px",
    color: active ? T.bone : "rgba(200,192,176,0.55)",
    background: active ? "rgba(255,255,255,0.07)" : "transparent",
    border: `1px solid ${active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)"}`,
  });

  let status = null;
  if (index) {
    if (query && search.status === "loading") status = `searching for “${query}”…`;
    else if (query && search.status === "ok") status = `the ${search.results.length} closest records to “${query}”, ranked by meaning. This always returns the nearest matches, even when none is close — read the match score.`;
    else if (query && search.status === "fallback") status = `semantic search is unavailable right now — showing records whose title or question contains any of your words.`;
    else status = `${index.count} recorded · ${index.tested_count} perturbation-tested · ${index.count - index.tested_count} captured once and never tested`;
  }

  let empty = null;
  if (index && rows.length === 0 && !(query && search.status === "loading")) {
    if (tier === "C2" && tierCounts.C2 === 0) empty = "No record currently holds tier C2 (pressure-robust without being paraphrase-robust). Records that survive pressure and paraphrase are C3.";
    else if (index.count === 0) empty = "No divergence records yet.";
    else empty = `No ${tier === "ALL" ? "" : tier + " "}records${query ? ` among the results for “${query}”` : ""}.`;
  }

  return (
    <div>
      <Header />
      {!index && <p style={{ ...mono, fontSize: 11, color: "rgba(200,192,176,0.4)" }}>loading…</p>}
      {index && <FindingBanner index={index} />}
      {index && (
        <div style={{ marginBottom: 14 }}>
          <form onSubmit={submit} role="search" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              type="search" value={draft} onChange={e => setDraft(e.target.value)}
              aria-label="Search the Divergence Atlas by meaning"
              placeholder="Search by meaning — e.g. “does a model have a continuous self?”"
              style={{ flex: "1 1 220px", minWidth: 0, ...mono, fontSize: 11.5, color: T.bone, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, padding: "8px 11px", outline: "none" }}
            />
            <button type="submit" disabled={draft.trim().length < 2} style={{ ...chip(false), opacity: draft.trim().length < 2 ? 0.45 : 1 }}>Search</button>
            {(query || tier !== "ALL") && <button type="button" onClick={clear} style={chip(false)}>Clear</button>}
          </form>
          <div role="group" aria-label="Filter by certification tier" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <button type="button" aria-pressed={tier === "ALL"} onClick={() => setTier("ALL")} style={chip(tier === "ALL")}>All {baseRows.length}</button>
            {TIERS.map(t => (
              <button key={t} type="button" aria-pressed={tier === t} onClick={() => setTier(t)} style={chip(tier === t)} title={TIER_WORD[t]}>
                {t} {tierCounts[t]}
              </button>
            ))}
          </div>
          <p aria-live="polite" style={{ ...mono, fontSize: 9.5, color: "rgba(200,192,176,0.45)", lineHeight: 1.6, margin: 0 }}>{status}</p>
        </div>
      )}
      {empty && <p style={{ fontSize: 12, color: "rgba(200,192,176,0.45)", fontStyle: "italic" }}>{empty}</p>}
      {index && rows.map(r => <RecordRow key={r.id} r={r} onOpen={onOpen} />)}
    </div>
  );
}
