import { useState, useEffect, useRef, useCallback } from "react";
import { T } from "../theme";

/**
 * OmnaraiPlayer — self-hosted audio for the Realms of Omnarai.
 *
 * Autoplay contract: attempt unmuted play() once the manifest lands. Systems
 * open to it play; blocked systems get a visible control and a hint line.
 * Muting to force autoplay would defeat the purpose — don't.
 *
 * Data source: /audio/manifest.json — the same manifest the MCP server reads.
 * No localStorage: all state in memory (SSR / artifact safety).
 *
 * onPlayStateChange fires from the audio element's own play/pause events, so
 * the constellation breathes with real playback rather than a manual switch.
 */
export default function OmnaraiPlayer({ autoplay = true, onPlayStateChange }) {
  const [tracks, setTracks] = useState([]);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const audioRef = useRef(null);

  // `playing` is driven by the element's events (below), but skipping tracks
  // needs to know whether to resume — a ref avoids re-running that effect.
  const playingRef = useRef(false);
  playingRef.current = playing;

  useEffect(() => {
    fetch("/audio/manifest.json")
      .then((r) => r.json())
      .then((m) => setTracks(m.tracks || []))
      .catch((e) => console.error("manifest load failed", e));
  }, []);

  useEffect(() => {
    if (!autoplay || tracks.length === 0 || !audioRef.current) return;
    const attempt = audioRef.current.play();
    if (attempt !== undefined) attempt.catch(() => setAutoplayBlocked(true));
  }, [tracks, autoplay]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => setAutoplayBlocked(true));
    } else {
      el.pause();
    }
  }, []);

  const select = useCallback((i) => {
    setCurrent(i);
    setProgress(0);
  }, []);

  const skip = useCallback(
    (dir) => {
      setCurrent((c) => (c + dir + tracks.length) % tracks.length);
      setProgress(0);
    },
    [tracks.length],
  );

  // Track changed: load the new source, and keep going if we were already going.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || tracks.length === 0) return;
    el.load();
    if (playingRef.current) el.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const setPlayState = useCallback(
    (next) => {
      setPlaying(next);
      onPlayStateChange?.(next);
    },
    [onPlayStateChange],
  );

  const seek = useCallback(
    (e) => {
      const el = audioRef.current;
      const t = tracks[current];
      if (!el || !t) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      const dur = Number.isFinite(el.duration) ? el.duration : t.duration;
      el.currentTime = ratio * dur;
      setProgress(el.currentTime);
    },
    [tracks, current],
  );

  // Arrow keys scrub ±5s, matching the click-to-seek affordance.
  const nudge = useCallback((e) => {
    const el = audioRef.current;
    if (!el) return;
    const delta = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
    if (!delta) return;
    e.preventDefault();
    const dur = Number.isFinite(el.duration) ? el.duration : 0;
    el.currentTime = Math.min(Math.max(el.currentTime + delta, 0), dur);
    setProgress(el.currentTime);
  }, []);

  if (tracks.length === 0) return null;
  const t = tracks[current];
  const pct = t.duration ? Math.min((progress / t.duration) * 100, 100) : 0;

  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999 }}>
      <audio
        ref={audioRef}
        src={`/audio/${t.file}`}
        preload="metadata"
        onPlay={() => setPlayState(true)}
        onPause={() => setPlayState(false)}
        onEnded={() => skip(1)}
        onTimeUpdate={(e) => setProgress(e.target.currentTime)}
      />

      {/* Track list — slides up */}
      <div
        style={{
          maxHeight: expanded ? 260 : 0,
          overflow: "hidden",
          transition: "max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          background: "rgba(10, 11, 15, 0.98)",
          backdropFilter: "blur(20px)",
          borderTop: expanded ? `1px solid ${T.gold}15` : "none",
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: "10px 20px",
            overflowY: "auto",
            maxHeight: 240,
            scrollbarWidth: "thin",
            scrollbarColor: `${T.gold}30 transparent`,
          }}
        >
          {tracks.map((track, i) => {
            const active = i === current;
            return (
              <button
                key={track.slug}
                onClick={() => select(i)}
                aria-current={active ? "true" : undefined}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  padding: "6px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: active ? `${T.gold}10` : "transparent",
                  border: "none",
                  borderLeft: `2px solid ${active ? T.gold : "transparent"}`,
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                }}
              >
                <span style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.3)", minWidth: 22 }}>
                  {String(track.id).padStart(2, "0")}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontFamily: "'Cormorant Garamond',Georgia,serif",
                    fontSize: 13,
                    color: active ? T.gold : T.bone,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {track.title}
                  {track.credits && (
                    <span style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.3)", marginLeft: 8 }}>
                      {track.credits}
                    </span>
                  )}
                </span>
                <span style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.3)" }}>{fmt(track.duration)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Transport bar */}
      <div
        style={{
          background: "rgba(10, 11, 15, 0.95)",
          backdropFilter: "blur(20px)",
          borderTop: `1px solid rgba(232,200,114,${expanded ? "0.15" : "0.08"})`,
          padding: "8px 20px",
          transition: "all 0.3s ease",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <WaveformIcon color={T.gold} animated={playing} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Cormorant Garamond',Georgia,serif",
                fontSize: 13,
                fontWeight: 600,
                color: playing ? T.gold : T.bone,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                transition: "color 0.3s",
              }}
            >
              {t.title}
            </div>
            <div style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.35)", letterSpacing: "0.08em" }}>
              {autoplayBlocked && !playing
                ? "THIS SYSTEM HOLDS THE SILENCE — PRESS PLAY TO OPEN THE CHANNEL"
                : `${fmt(progress)} / ${fmt(t.duration)}${t.credits ? ` · ${t.credits.toUpperCase()}` : ""}`}
            </div>
            <div
              onClick={seek}
              onKeyDown={nudge}
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(t.duration)}
              aria-valuenow={Math.round(progress)}
              aria-valuetext={`${fmt(progress)} of ${fmt(t.duration)}`}
              style={{
                height: 3,
                background: "rgba(232,200,114,0.1)",
                borderRadius: 2,
                marginTop: 5,
                overflow: "hidden",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: T.gold,
                  boxShadow: playing ? `0 0 8px ${T.gold}60` : "none",
                  transition: "width 0.25s linear",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            <button style={btn} onClick={() => skip(-1)} aria-label="Previous track">
              ⟨⟨
            </button>
            <button
              style={{ ...btn, fontSize: 14, padding: "7px 13px", borderColor: `${T.gold}40`, color: T.gold }}
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button style={btn} onClick={() => skip(1)} aria-label="Next track">
              ⟩⟩
            </button>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? "Close the archive" : "Open the archive"}
            title={expanded ? "Close the archive" : "Open the archive"}
            style={{
              ...mono,
              fontSize: 9,
              color: "rgba(200,192,176,0.3)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 6px",
              transition: "transform 0.3s",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▲
          </button>
        </div>
      </div>
    </div>
  );
}

const mono = { fontFamily: "'IBM Plex Mono',monospace" };

const btn = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: T.ash,
  borderRadius: 8,
  padding: "5px 9px",
  cursor: "pointer",
  fontSize: 11,
  ...mono,
};

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function WaveformIcon({ color, animated }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      {[
        { x: 2, y: 8, h: 8, dur: "1.2s" },
        { x: 6.5, y: 4, h: 16, dur: "0.9s" },
        { x: 11, y: 6, h: 12, dur: "1.1s" },
        { x: 15.5, y: 7, h: 10, dur: "1.3s" },
        { x: 20, y: 9, h: 6, dur: "1s" },
      ].map((bar, i) => (
        <rect key={i} x={bar.x} y={bar.y} width="2.5" height={bar.h} rx="1" fill={color} opacity={0.6 + i * 0.1}>
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
