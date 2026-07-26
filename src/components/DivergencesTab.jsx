import { useState, useEffect } from "react";
import { T } from "../theme";
import DivergenceRecord from "./DivergenceRecord";

const mono = { fontFamily: "'IBM Plex Mono',monospace" };

const certTier = r => (r.certification || {}).tier || null;
const tierRank = t => (t === "C3" ? 3 : t === "C1" ? 2 : 0);

// A record's certification tier, shown as a chip on the browse list so the
// splits that survived perturbation are findable without opening each one.
// Language rule matches the detail view: certified ⇒ survived pressure;
// "captured" (C0) ⇒ displayed only, no robustness test run yet.
function TierChip({ tier }) {
  if (!tier) return null;
  if (tier === "C0") {
    return <span style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.35)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, padding: "1px 6px" }}>captured</span>;
  }
  const c = tier === "C3" ? T.green : T.gold;
  return <span style={{ ...mono, fontSize: 8.5, color: c, border: `1px solid ${c}55`, borderRadius: 5, padding: "1px 6px" }}>{tier} · certified</span>;
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

// Controlled by App.jsx: `openId` (which record, if any, is open) and the
// history/URL sync live there so a record page has one real, shareable URL
// regardless of whether it was reached via a list click, the Atlas hero CTA,
// or a direct link. This component only fetches the index + the one open
// record and renders accordingly.
export default function DivergencesTab({ openId, onOpen, onClose, onDeliberate }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(null);
  const [record, setRecord] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);

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

  if (error) return <div><Header /><p style={{ color: "#C87272", fontSize: 12 }}>{error}</p></div>;

  if (openId) {
    return <DivergenceRecord key={openId} record={record} loading={loadingRec} onBack={onClose} onOpenRecord={onOpen} onDeliberate={onDeliberate} />;
  }

  // Certified splits rise to the top so the strongest evidence is the first
  // thing a visitor sees; Array.sort is stable, so original order is preserved
  // within each tier band.
  const records = index
    ? [...(index.records || [])].sort((a, b) => tierRank(certTier(b)) - tierRank(certTier(a)))
    : [];

  return (
    <div>
      <Header />
      {!index && <p style={{ ...mono, fontSize: 11, color: "rgba(200,192,176,0.4)" }}>loading…</p>}
      {index && index.count === 0 && (
        <p style={{ fontSize: 12, color: "rgba(200,192,176,0.4)", fontStyle: "italic" }}>No divergence records yet.</p>
      )}
      {index && index.certified_count > 0 && (
        <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.6)", background: "rgba(126,186,166,0.05)", border: "1px solid rgba(126,186,166,0.18)", borderRadius: 8, padding: "11px 15px", marginBottom: 16, lineHeight: 1.65 }}>
          <span style={{ ...mono, color: T.green }}>{index.certified_count} of {index.count} splits certified</span>
          {" "}— they held under paraphrase and adversarial pressure without collapsing, each graded across independent multi-run batteries. So far the certified core is <em>behavioral-ethical</em> (intervention, self-trust, tuning-as-identity), not metaphysical.
        </div>
      )}
      {index && records.map(r => (
        <button key={r.id} onClick={() => onOpen(r.id)} style={{
          width: "100%", textAlign: "left", cursor: "pointer", display: "block",
          background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10, padding: "16px 18px", marginBottom: 10, transition: "border-color 0.2s",
        }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "#C8727255")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}>
          <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 17, fontWeight: 600, color: T.bone, marginBottom: 6, lineHeight: 1.3 }}>
            {r.title.replace(/^Divergence:\s*/, "")}
          </div>
          <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.5)", fontStyle: "italic", lineHeight: 1.5, marginBottom: 10, fontWeight: 300 }}>
            {r.question}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)" }}>
            <span style={{ color: "#C87272" }}>{r.answerCount} voices</span>
            <span>{r.tensionCount} tensions</span>
            <span>{r.date}</span>
            <TierChip tier={certTier(r)} />
            <span style={{ color: T.green }}>read →</span>
          </div>
        </button>
      ))}
    </div>
  );
}
