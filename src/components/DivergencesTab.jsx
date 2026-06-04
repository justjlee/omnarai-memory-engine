import { useState, useEffect, useCallback } from "react";
import { T } from "../theme";

// Map a lab to an accent color so each voice is visually distinct.
const LAB_COLOR = {
  Anthropic: T.gold,
  OpenAI: T.green,
  Google: "#7EB8D4",
  xAI: T.violet,
  DeepSeek: "#A8C5A0",
};
const colorFor = (lab) => LAB_COLOR[lab] || T.ash;

const STATUS_COLOR = { divergent: "#C87272", unresolved: T.gold, emerging: T.violet };

// Minimal, safe inline renderer: **bold** only, builds React nodes (no HTML injection).
function renderInline(text, keyBase) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={`${keyBase}-${i}`} style={{ color: T.bone, fontWeight: 500 }}>{p.slice(2, -2)}</strong>;
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}
function renderBody(text) {
  return (text || "").split("\n").map((line, i) => {
    if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
    if (/^\s*[-*•]\s+/.test(line))
      return (
        <div key={i} style={{ display: "flex", gap: 8, padding: "1px 0 1px 6px" }}>
          <span style={{ color: T.gold + "80" }}>•</span>
          <span>{renderInline(line.replace(/^\s*[-*•]\s+/, ""), i)}</span>
        </div>
      );
    if (/^#{1,6}\s/.test(line))
      return <div key={i} style={{ fontWeight: 500, color: T.ash, margin: "6px 0 2px" }}>{renderInline(line.replace(/^#+\s/, ""), i)}</div>;
    return <p key={i} style={{ margin: "0 0 6px" }}>{renderInline(line, i)}</p>;
  });
}

function AnswerCard({ answer }) {
  const [open, setOpen] = useState(false);
  const c = colorFor(answer.lab);
  const preview = (answer.text || "").replace(/\s+/g, " ").slice(0, 150);
  return (
    <div style={{
      background: "rgba(255,255,255,0.012)", border: `1px solid ${c}22`,
      borderLeft: `2px solid ${c}`, borderRadius: 8, marginBottom: 10, overflow: "hidden",
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
        padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
      }}>
        <span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: c, fontWeight: 500 }}>
            {answer.model}
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, color: "rgba(200,192,176,0.4)", marginLeft: 8 }}>
            {answer.lab} · {answer.model_id}
          </span>
          {!open && (
            <span style={{ display: "block", fontSize: 11, color: "rgba(200,192,176,0.4)", marginTop: 4, fontWeight: 300 }}>
              {preview}…
            </span>
          )}
        </span>
        <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: c + "90", flexShrink: 0 }}>
          {open ? "− collapse" : "+ read"}
        </span>
      </button>
      {open && (
        <div style={{
          padding: "0 16px 14px", fontSize: 12.5, lineHeight: 1.7,
          color: "rgba(232,224,208,0.72)", fontFamily: "'IBM Plex Sans',sans-serif",
        }}>
          {renderBody(answer.text)}
        </div>
      )}
    </div>
  );
}

function TensionRow({ t }) {
  const sc = STATUS_COLOR[t.status] || T.ash;
  return (
    <div style={{
      background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: 8, padding: "12px 14px", marginBottom: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: T.ash }}>{t.topic}</span>
        <span style={{
          fontFamily: "'IBM Plex Mono',monospace", fontSize: 8.5, color: sc,
          border: `1px solid ${sc}40`, borderRadius: 6, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.08em",
        }}>{t.status}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: T.gold, marginBottom: 3 }}>{t.voice_a}</div>
          <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.6)", lineHeight: 1.55, fontWeight: 300 }}>{t.claim_a}</div>
        </div>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 10 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: T.violet, marginBottom: 3 }}>{t.voice_b}</div>
          <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.6)", lineHeight: 1.55, fontWeight: 300 }}>{t.claim_b}</div>
        </div>
      </div>
    </div>
  );
}

const mono = { fontFamily: "'IBM Plex Mono',monospace" };

export default function DivergencesTab() {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [record, setRecord] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);

  useEffect(() => {
    fetch("/api/divergences")
      .then(r => r.json())
      .then(setIndex)
      .catch(() => setError("Could not load divergence records."));
  }, []);

  const openRecord = useCallback((id) => {
    setSelectedId(id); setRecord(null); setLoadingRec(true);
    fetch(`/api/divergences?id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { setRecord(d); setLoadingRec(false); })
      .catch(() => { setError("Could not load that record."); setLoadingRec(false); });
  }, []);

  const Header = () => (
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

  if (error) return <div><Header /><p style={{ color: "#C87272", fontSize: 12 }}>{error}</p></div>;

  // ── Detail view ──
  if (selectedId) {
    return (
      <div>
        <button onClick={() => { setSelectedId(null); setRecord(null); }} style={{
          ...mono, fontSize: 10, color: "rgba(200,192,176,0.5)", background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", marginBottom: 16,
        }}>← all divergences</button>

        {loadingRec && <p style={{ ...mono, fontSize: 11, color: "rgba(200,192,176,0.4)" }}>loading record…</p>}
        {record && (
          <div>
            <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.35)", marginBottom: 6 }}>
              {record.id} · {record.date} · {(record.answers || []).length} voices · {(record.tensions || []).length} tensions
            </div>
            <h2 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, fontWeight: 600, color: T.bone, margin: "0 0 14px", lineHeight: 1.25 }}>
              {record.title}
            </h2>
            <div style={{
              background: `linear-gradient(135deg, ${T.gold}08, ${T.violet}05)`, border: `1px solid ${T.gold}20`,
              borderRadius: 10, padding: "14px 18px", marginBottom: 22,
            }}>
              <div style={{ ...mono, fontSize: 8.5, color: T.gold + "90", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>The question (asked verbatim)</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: T.bone, fontStyle: "italic", fontFamily: "'Cormorant Garamond',Georgia,serif" }}>
                {record.question}
              </div>
            </div>

            <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
              The verbatim answers ({(record.answers || []).length}) — click to read
            </div>
            {(record.answers || []).map((a, i) => <AnswerCard key={i} answer={a} />)}

            {(record.tensions || []).length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                  Where they actually diverge
                </div>
                {record.tensions.map((t, i) => <TensionRow key={i} t={t} />)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div>
      <Header />
      {!index && <p style={{ ...mono, fontSize: 11, color: "rgba(200,192,176,0.4)" }}>loading…</p>}
      {index && index.count === 0 && (
        <p style={{ fontSize: 12, color: "rgba(200,192,176,0.4)", fontStyle: "italic" }}>No divergence records yet.</p>
      )}
      {index && (index.records || []).map(r => (
        <button key={r.id} onClick={() => openRecord(r.id)} style={{
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
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)" }}>
            <span style={{ color: "#C87272" }}>{r.answerCount} voices</span>
            <span>{r.tensionCount} tensions</span>
            <span>{r.date}</span>
            <span style={{ color: T.green }}>read →</span>
          </div>
        </button>
      ))}
    </div>
  );
}
