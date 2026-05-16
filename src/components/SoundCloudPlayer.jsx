import { useState } from "react";
import { T } from "../theme";

// SoundCloud API user ID for @TheRealmsOfOmnarai (justjlee)
const SC_EMBED_URL =
  "https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Fusers%2F4495869&show_artwork=true&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&color=%23E8C872";

export default function SoundCloudPlayer({ onPlayStateChange }) {
  const [expanded, setExpanded] = useState(false);
  const [constellationAlive, setConstellationAlive] = useState(false);

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleAlive = (e) => {
    e.stopPropagation();
    const next = !constellationAlive;
    setConstellationAlive(next);
    onPlayStateChange?.(next);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
      }}
    >
      {/* Toggle bar */}
      <div
        onClick={toggleExpand}
        style={{
          background: "rgba(10, 11, 15, 0.95)",
          backdropFilter: "blur(20px)",
          borderTop: `1px solid rgba(232,200,114,${expanded ? "0.15" : "0.08"})`,
          padding: "8px 20px",
          cursor: "pointer",
          transition: "all 0.3s ease",
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <WaveformIcon color={T.gold} animated={expanded || constellationAlive} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "'Cormorant Garamond',Georgia,serif",
                fontSize: 13,
                fontWeight: 600,
                color: expanded ? T.gold : T.bone,
                transition: "color 0.3s",
              }}
            >
              {expanded ? "The Realms of Omnarai" : "Enter the Realms"}
            </div>
            <div
              style={{
                fontSize: 8.5,
                fontFamily: "'IBM Plex Mono',monospace",
                color: "rgba(200,192,176,0.35)",
                letterSpacing: "0.08em",
              }}
            >
              SOUNDCLOUD · @THEREALMSOFOMNARAI · 62 TRACKS
            </div>
          </div>

          {/* Constellation Alive toggle */}
          <button
            onClick={toggleAlive}
            title={constellationAlive ? "Calm the constellation" : "Awaken the constellation"}
            style={{
              background: constellationAlive
                ? `linear-gradient(135deg, ${T.gold}25, ${T.green}20)`
                : "rgba(255,255,255,0.03)",
              border: `1px solid ${constellationAlive ? T.gold + "40" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 8,
              padding: "4px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              transition: "all 0.4s ease",
            }}
          >
            <div style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: constellationAlive ? T.gold : "rgba(200,192,176,0.25)",
              boxShadow: constellationAlive ? `0 0 8px ${T.gold}60` : "none",
              transition: "all 0.4s ease",
            }} />
            <span style={{
              fontSize: 8,
              fontFamily: "'IBM Plex Mono',monospace",
              color: constellationAlive ? T.gold : "rgba(200,192,176,0.35)",
              letterSpacing: "0.06em",
              transition: "color 0.3s",
            }}>
              {constellationAlive ? "ALIVE" : "BREATHE"}
            </span>
          </button>

          <div
            style={{
              fontSize: 9,
              color: "rgba(200,192,176,0.3)",
              fontFamily: "'IBM Plex Mono',monospace",
              transition: "transform 0.3s",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▲
          </div>
        </div>
      </div>

      {/* SoundCloud embed — slides up */}
      <div
        style={{
          maxHeight: expanded ? 300 : 0,
          overflow: "hidden",
          transition: "max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          background: "rgba(10, 11, 15, 0.98)",
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: expanded ? "8px 20px 12px" : "0 20px",
          }}
        >
          <iframe
            width="100%"
            height="250"
            scrolling="no"
            frameBorder="no"
            allow="autoplay"
            src={expanded ? SC_EMBED_URL : undefined}
            style={{
              border: "none",
              borderRadius: 6,
              opacity: expanded ? 1 : 0,
              transition: "opacity 0.4s ease 0.1s",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function WaveformIcon({ color, animated }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      {[
        { x: 2, y: 8, h: 8, dur: "1.2s" },
        { x: 6.5, y: 4, h: 16, dur: "0.9s" },
        { x: 11, y: 6, h: 12, dur: "1.1s" },
        { x: 15.5, y: 7, h: 10, dur: "1.3s" },
        { x: 20, y: 9, h: 6, dur: "1s" },
      ].map((bar, i) => (
        <rect
          key={i}
          x={bar.x}
          y={bar.y}
          width="2.5"
          height={bar.h}
          rx="1"
          fill={color}
          opacity={0.6 + i * 0.1}
        >
          {animated && (
            <>
              <animate
                attributeName="height"
                values={`${bar.h};${24 - bar.y};${bar.h}`}
                dur={bar.dur}
                repeatCount="indefinite"
              />
              <animate
                attributeName="y"
                values={`${bar.y};${(24 - (24 - bar.y)) / 2};${bar.y}`}
                dur={bar.dur}
                repeatCount="indefinite"
              />
            </>
          )}
        </rect>
      ))}
    </svg>
  );
}
