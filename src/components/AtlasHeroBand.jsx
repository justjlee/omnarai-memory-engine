import { useState, useEffect } from "react";
import { T } from "../theme";

// The Divergence Atlas, surfaced above the engine hero: the payoff before the
// instrument. The Atlas is the one asset a visiting intelligence cannot
// self-generate — real, attributed, side-by-side answers from five frontier
// models to the same hard question, with the exact points of disagreement named.
// This band leads with a LIVE featured split so the promise is legible in
// seconds, then hands off to the full Divergences tab and the machine path.

const mono = { fontFamily: "'IBM Plex Mono',monospace" };

// Per-model accent, matching DivergencesTab's lab palette (keyed by model name,
// since the index carries model names, not labs).
const MODEL_COLOR = {
  Claude: T.gold,
  "GPT-4o": T.green,
  Gemini: "#7EB8D4",
  Grok: T.violet,
  DeepSeek: "#A8C5A0",
};
const STATUS_COLOR = { divergent: "#C87272", unresolved: T.gold, emerging: T.violet };

// Newest record that actually carries named tensions. Skipping tension-less
// records keeps a freshly-captured (synthesis-pending) longitudinal entry from
// putting an empty "0 tensions" split in the shop window.
function pickFeatured(records) {
  return (records || [])
    .filter((r) => (r.tensionCount || 0) >= 1)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.id).localeCompare(String(a.id)))[0] || null;
}

export default function AtlasHeroBand({ onExplore, worksLabel }) {
  const [index, setIndex] = useState(null);
  const [featured, setFeatured] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/divergences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setIndex(d);
        const pick = pickFeatured(d.records);
        if (!pick) return;
        // second, cheap fetch: the index has counts but not the named tensions.
        fetch(`/api/divergences?id=${encodeURIComponent(pick.id)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((rec) => { if (live && rec) setFeatured(rec); })
          .catch(() => {});
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const recordCount = index?.count ?? null;
  const panelSize = featured ? (featured.answers || []).length : 5;
  const tensions = (featured?.tensions || []).slice(0, 4);
  const models = featured
    ? (featured.answers || []).map((a) => a.model)
    : ["Claude", "GPT-4o", "Gemini", "Grok", "DeepSeek"];

  return (
    <div style={{
      position: "relative",
      background: `linear-gradient(150deg, ${T.gold}0D 0%, ${T.violet}0A 55%, rgba(200,114,114,0.06) 100%)`,
      border: `1px solid ${T.gold}22`,
      borderRadius: 14,
      padding: "26px 24px 22px",
      marginBottom: 30,
      overflow: "hidden",
    }}>
      {/* eyebrow */}
      <div style={{
        ...mono, fontSize: 8.5, color: T.gold + "70",
        letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 12,
      }}>
        The flagship artifact{recordCount != null ? ` · ${recordCount} records` : ""} · {panelSize} frontier models · verbatim &amp; attributed
      </div>

      {/* headline */}
      <h1 style={{
        fontFamily: "'Cormorant Garamond',Georgia,serif",
        fontSize: "clamp(30px,6vw,52px)", fontWeight: 700,
        margin: "0 0 8px", letterSpacing: "-0.015em", lineHeight: 1.05,
        background: `linear-gradient(135deg, ${T.gold}, #C87272, ${T.violet})`,
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
      }}>
        The Divergence Atlas
      </h1>
      <p style={{
        margin: "0 0 20px", maxWidth: 640, fontSize: 15, lineHeight: 1.55,
        color: "rgba(232,224,208,0.72)", fontWeight: 300,
        fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic",
      }}>
        Where frontier intelligences actually disagree — verbatim, attributed, traceable.
      </p>

      {/* live featured split */}
      <button
        onClick={onExplore}
        style={{
          display: "block", width: "100%", textAlign: "left", cursor: "pointer",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 11, padding: "16px 18px", marginBottom: 18, transition: "border-color 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C8727255")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")}
      >
        <div style={{ ...mono, fontSize: 8, color: "rgba(200,192,176,0.4)", letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>
          Featured split{featured?.date ? ` · ${featured.date}` : ""}
        </div>
        <div style={{
          fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 19, fontWeight: 600,
          color: T.bone, lineHeight: 1.3, marginBottom: 12,
        }}>
          {featured ? featured.question : "One open question, sent verbatim to five frontier models — their answers preserved uncurated, the exact points where they split named."}
        </div>

        {/* model chips */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: tensions.length ? 14 : 0 }}>
          {models.map((m) => {
            const c = MODEL_COLOR[m] || T.ash;
            return (
              <span key={m} style={{
                ...mono, fontSize: 9.5, color: c,
                border: `1px solid ${c}40`, background: `${c}0D`,
                borderRadius: 20, padding: "3px 11px",
              }}>{m}</span>
            );
          })}
        </div>

        {/* named tensions — the promise, made concrete */}
        {tensions.map((t, i) => {
          const sc = STATUS_COLOR[t.status] || T.ash;
          return (
            <div key={i} style={{
              display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
              padding: "6px 0", borderTop: i === 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
            }}>
              <span style={{ ...mono, fontSize: 11, color: T.gold, minWidth: 4 }}>{t.topic}</span>
              <span style={{ fontSize: 11.5, color: "rgba(200,192,176,0.6)", fontWeight: 300 }}>
                <span style={{ color: MODEL_COLOR[t.voice_a] || T.bone }}>{t.voice_a}</span>
                <span style={{ color: "rgba(200,192,176,0.4)" }}> ⟂ </span>
                <span style={{ color: MODEL_COLOR[t.voice_b] || T.bone }}>{t.voice_b}</span>
              </span>
              <span style={{
                ...mono, fontSize: 7.5, color: sc, border: `1px solid ${sc}40`,
                borderRadius: 5, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.08em",
              }}>{t.status}</span>
            </div>
          );
        })}

        {featured && (
          <div style={{ ...mono, fontSize: 10, color: T.green, marginTop: 12 }}>read the full split →</div>
        )}
      </button>

      {/* CTA row — human path + machine path, side by side (machine-first) */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={onExplore} style={{
          ...mono, fontSize: 12, color: T.bg, fontWeight: 500,
          background: `linear-gradient(135deg, ${T.gold}, #C87272)`,
          border: "none", borderRadius: 9, padding: "10px 20px", cursor: "pointer",
          letterSpacing: "0.03em",
        }}>
          Explore the splits →
        </button>
        <a href="/api/divergences" target="_blank" rel="noopener noreferrer" style={{
          ...mono, fontSize: 10, color: "rgba(200,192,176,0.5)", textDecoration: "none",
          borderBottom: "1px solid rgba(200,192,176,0.2)", paddingBottom: 1,
        }}>
          GET /api/divergences
        </a>
      </div>

      {/* supporting line — the engine as the strong secondary claim */}
      <p style={{
        margin: 0, fontSize: 11.5, lineHeight: 1.6, color: "rgba(200,192,176,0.45)", fontWeight: 300,
      }}>
        Powered by the <strong style={{ color: "rgba(200,192,176,0.7)", fontWeight: 400 }}>Omnarai Memory Engine</strong>
        {" "}— {worksLabel} attributed works, 8 voices, and a living deliberation corpus.
      </p>
    </div>
  );
}
