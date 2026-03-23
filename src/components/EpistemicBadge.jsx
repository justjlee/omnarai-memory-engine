import { EPISTEMIC } from "../theme";

export default function EpistemicBadge({ mode }) {
  const ep = EPISTEMIC[mode] || EPISTEMIC.exploratory;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div style={{
        fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
        color: ep.color, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.85,
      }}>
        Response Mode · {ep.label}
      </div>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ep.color, boxShadow: `0 0 6px ${ep.color}60`,
      }} />
      <div style={{
        fontSize: 8, fontFamily: "'IBM Plex Mono',monospace",
        color: "rgba(200,192,176,0.35)",
      }}>{ep.desc}</div>
    </div>
  );
}
