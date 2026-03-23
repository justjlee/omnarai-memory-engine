import { T } from "../theme";

export default function RecordCard({ record, compact }) {
  const ring = T.ring[record.ring];

  return (
    <div style={{
      background: "rgba(255,255,255,0.015)",
      border: `1px solid rgba(255,255,255,0.05)`,
      borderRadius: 8,
      padding: compact ? "10px 14px" : "14px 16px",
      marginBottom: 8,
      transition: "all 0.3s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{
            fontFamily: "'IBM Plex Mono',monospace", fontSize: 8.5,
            color: "rgba(200,192,176,0.35)", letterSpacing: "0.08em", marginRight: 8,
          }}>{record.id}</span>
          {record.permalink ? (
            <a href={record.permalink} target="_blank" rel="noopener noreferrer"
              style={{
                fontFamily: "'Cormorant Garamond',Georgia,serif",
                fontSize: compact ? 13.5 : 15, fontWeight: 600, color: T.bone,
                textDecoration: "none",
              }}
              onMouseEnter={e => e.target.style.color = T.gold}
              onMouseLeave={e => e.target.style.color = T.bone}>
              {record.title}
            </a>
          ) : (
            <span style={{
              fontFamily: "'Cormorant Garamond',Georgia,serif",
              fontSize: compact ? 13.5 : 15, fontWeight: 600, color: T.bone,
            }}>{record.title}</span>
          )}
        </div>
        <span style={{
          fontSize: 8.5, color: ring.color,
          fontFamily: "'IBM Plex Mono',monospace",
          padding: "2px 7px",
          border: `1px solid ${ring.color}35`,
          borderRadius: 10, whiteSpace: "nowrap", flexShrink: 0,
        }}>{ring.label}</span>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
        {(record.contributors || []).map(c => (
          <span key={c} style={{
            fontSize: 9.5, color: T.ash,
            background: "rgba(255,255,255,0.035)",
            padding: "1px 7px", borderRadius: 8,
            fontFamily: "'IBM Plex Sans',sans-serif",
          }}>{c}</span>
        ))}
        <span style={{
          fontSize: 9.5, color: "rgba(200,192,176,0.35)",
          fontFamily: "'IBM Plex Mono',monospace", marginLeft: "auto",
        }}>{record.type} · {record.date}{record.wordCount ? ` · ${record.wordCount.toLocaleString()} words` : ""}</span>
      </div>

      {!compact && record.excerpt && (
        <p style={{
          margin: 0, fontSize: 12.5, lineHeight: 1.65,
          color: "rgba(232,224,208,0.65)",
          fontFamily: "'IBM Plex Sans',sans-serif", fontStyle: "italic",
        }}>{record.excerpt}</p>
      )}

      {(record.lineage || []).length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: compact ? 4 : 8 }}>
          {record.lineage.map(l => (
            <span key={l} style={{
              fontSize: 8.5, color: "rgba(160,137,201,0.6)",
              fontFamily: "'IBM Plex Mono',monospace",
            }}>#{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}
