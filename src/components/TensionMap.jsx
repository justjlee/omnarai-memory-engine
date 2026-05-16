import { T } from "../theme";

const STATUS_STYLE = {
  divergent: { color: "#E87272", label: "DIVERGENT", bg: "rgba(232,114,114,0.08)", border: "rgba(232,114,114,0.20)" },
  unresolved: { color: T.violet, label: "UNRESOLVED", bg: "rgba(160,137,201,0.08)", border: "rgba(160,137,201,0.20)" },
  emerging: { color: T.green, label: "EMERGING", bg: "rgba(126,186,166,0.08)", border: "rgba(126,186,166,0.20)" },
};

export default function TensionMap({ tensions }) {
  if (!tensions || tensions.length === 0) return null;

  return (
    <div style={{
      marginTop: 16,
      padding: "14px 16px",
      background: "rgba(232,114,114,0.03)",
      border: "1px solid rgba(232,114,114,0.10)",
      borderRadius: 10,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1L13 13H1L7 1Z" stroke="#E87272" strokeWidth="1.2" fill="none" />
          <line x1="7" y1="5" x2="7" y2="9" stroke="#E87272" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="7" cy="11" r="0.8" fill="#E87272" />
        </svg>
        <span style={{
          fontSize: 9,
          fontFamily: "'IBM Plex Mono',monospace",
          color: "#E87272",
          letterSpacing: "0.08em",
        }}>
          TENSION MAP · {tensions.length} DETECTED
        </span>
      </div>

      {tensions.map((t, i) => {
        const style = STATUS_STYLE[t.status] || STATUS_STYLE.divergent;
        return (
          <div key={i} style={{
            marginBottom: i < tensions.length - 1 ? 10 : 0,
            background: style.bg,
            border: `1px solid ${style.border}`,
            borderRadius: 8,
            overflow: "hidden",
          }}>
            {/* Topic bar */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 12px",
              borderBottom: `1px solid ${style.border}`,
            }}>
              <span style={{
                fontSize: 10,
                fontFamily: "'Cormorant Garamond',Georgia,serif",
                fontWeight: 600,
                color: style.color,
                letterSpacing: "0.02em",
              }}>{t.topic}</span>
              <span style={{
                fontSize: 7.5,
                fontFamily: "'IBM Plex Mono',monospace",
                color: style.color + "80",
                letterSpacing: "0.08em",
                padding: "1px 6px",
                background: style.color + "10",
                borderRadius: 4,
              }}>{style.label}</span>
            </div>

            {/* Claim vs Counter-claim */}
            <div style={{
              display: "flex",
              gap: 0,
            }}>
              {/* Voice A */}
              <div style={{
                flex: 1,
                padding: "10px 12px",
                borderRight: `1px solid ${style.border}`,
              }}>
                <div style={{
                  fontSize: 9,
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: T.gold + "80",
                  letterSpacing: "0.04em",
                  marginBottom: 4,
                }}>{t.voice_a}</div>
                <div style={{
                  fontSize: 11,
                  fontFamily: "'IBM Plex Sans',sans-serif",
                  color: "rgba(232,224,208,0.65)",
                  lineHeight: 1.55,
                }}>{t.claim_a}</div>
              </div>

              {/* Tension indicator */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                flexShrink: 0,
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  border: `1.5px solid ${style.color}60`,
                  position: "relative",
                }}>
                  <div style={{
                    position: "absolute",
                    top: "50%",
                    left: -6,
                    right: -6,
                    height: 1,
                    background: style.color + "40",
                  }} />
                </div>
              </div>

              {/* Voice B */}
              <div style={{
                flex: 1,
                padding: "10px 12px",
              }}>
                <div style={{
                  fontSize: 9,
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: T.green + "80",
                  letterSpacing: "0.04em",
                  marginBottom: 4,
                }}>{t.voice_b}</div>
                <div style={{
                  fontSize: 11,
                  fontFamily: "'IBM Plex Sans',sans-serif",
                  color: "rgba(232,224,208,0.65)",
                  lineHeight: 1.55,
                }}>{t.claim_b}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
