import { T } from "../theme";

export default function RingSelector({ activeRing, onSelect, ringCounts }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {Object.entries(T.ring).map(([key, ring]) => {
        const active = activeRing === key;
        const count = ringCounts ? ringCounts[key] || 0 : 0;
        return (
          <button key={key}
            onClick={() => onSelect(active ? null : key)}
            style={{
              flex: "1 1 150px",
              background: active ? ring.color + "0D" : "rgba(255,255,255,0.015)",
              border: `1px solid ${active ? ring.color + "60" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 8, padding: "12px 14px",
              cursor: "pointer", textAlign: "left",
              transition: "all 0.3s",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: ring.color,
                boxShadow: active ? `0 0 8px ${ring.color}50` : "none",
              }} />
              <span style={{
                fontFamily: "'Cormorant Garamond',Georgia,serif",
                fontSize: 14, fontWeight: 600,
                color: active ? ring.color : T.ash,
                letterSpacing: "0.02em",
              }}>{ring.label}</span>
            </div>
            <p style={{
              margin: 0, fontSize: 10.5, lineHeight: 1.45,
              color: "rgba(200,192,176,0.5)",
              fontFamily: "'IBM Plex Sans',sans-serif",
            }}>{ring.desc}</p>
            <div style={{
              marginTop: 6, fontSize: 9, color: ring.color,
              opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace",
              letterSpacing: "0.05em",
            }}>{count} posts</div>
          </button>
        );
      })}
    </div>
  );
}
