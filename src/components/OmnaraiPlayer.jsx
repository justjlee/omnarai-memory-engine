import { useState, useEffect, useRef, useCallback } from "react";
import { T } from "../theme";

/**
 * OmnaraiPlayer — self-hosted audio for the Realms of Omnarai.
 *
 * Autoplay contract: attempt unmuted play() once the manifest lands. Systems
 * open to it play; blocked systems get a visible control and a hint line.
 * Muting to force autoplay would defeat the purpose — don't.
 *
 * CONTINUITY (2026-07-26): the player follows a visitor across the whole
 * omnarai.org family. It cannot truly *stream* across a page navigation — a new
 * document tears the <audio> element down (a hard web-platform limit) — so it
 * does the honest next best thing: it RESUMES. Playback state {track, position,
 * playing} is written to a cookie scoped to `.omnarai.org` (regular localStorage
 * is walled per-subdomain and can't cross engine. ↔ chess. ↔ apex). On load, the
 * player restores the same track at the same spot. Where a browser's autoplay
 * policy allows, it resumes silently; where it doesn't, the existing
 * autoplayBlocked control offers a one-tap "press play" — never a muted fake.
 * Off the omnarai.org domains (vercel.app, localhost, previews) the cookie is
 * host-only, so it still survives same-origin reloads.
 *
 * audioBase: where /manifest.json and the track files live. Defaults to a
 * relative "/audio" (self-hosted, the engine's own origin). Pass an absolute
 * origin (e.g. "https://engine.omnarai.org/audio") to let the flag and chess
 * sites share ONE audio home — those files + manifest must then send permissive
 * CORS headers so the cross-origin manifest fetch succeeds.
 *
 * Data source: <audioBase>/manifest.json — the same manifest the MCP server reads.
 * onPlayStateChange fires from the audio element's own play/pause events, so
 * the constellation breathes with real playback rather than a manual switch.
 */

const NP_COOKIE = "omnarai_np";
// Resume the *track + position* always; resume the *playing* intent only within
// this window, so a visitor returning hours later isn't ambushed by sound.
const RESUME_PLAY_WINDOW_MS = 30 * 60 * 1000;

// A play becomes a "qualified" listen (not a skip) once it passes this much audio.
const QUALIFY_MS = 30 * 1000;

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

// Fire a play-count beacon at /api/play. Fire-and-forget, never throws, never
// blocks playback: keepalive so it survives a page-unload race, and any failure
// is swallowed — a telemetry miss must never be audible. Mirrors the static bar's
// beacon in omnarai-home/omnarai-player.js so both players feed one leaderboard.
function beaconPlay(slug, event) {
  if (!isBrowser() || !slug) return;
  try {
    fetch("/api/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, event, source: "engine" }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* no-op */
  }
}

// Share across *.omnarai.org; host-only everywhere else (vercel.app / localhost / previews).
function cookieDomainAttr() {
  if (!isBrowser()) return "";
  return /(^|\.)omnarai\.org$/i.test(window.location.hostname) ? "; domain=.omnarai.org" : "";
}

function readNowPlaying() {
  if (!isBrowser()) return null;
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + NP_COOKIE + "=([^;]+)"));
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

function writeNowPlaying(state) {
  if (!isBrowser()) return;
  const val = encodeURIComponent(JSON.stringify(state));
  // SameSite=Lax so the cookie rides top-level navigations between subdomains.
  document.cookie = `${NP_COOKIE}=${val}; path=/; max-age=21600; samesite=lax${cookieDomainAttr()}`;
}

export default function OmnaraiPlayer({ autoplay = true, onPlayStateChange, audioBase = "/audio" }) {
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
  const currentRef = useRef(0);
  currentRef.current = current;

  // Play-count beacon state, reset per track load: `start` fires once when a
  // track first plays (not on resume-after-pause), `qualified` once at QUALIFY_MS.
  const playBeaconRef = useRef({ started: false, qualified: false });

  // A play only COUNTS if the visitor willed it. This latches true on a genuine
  // gesture (press play, pick a track, hit next/prev) and stays true for the rest
  // of that listening session — so an auto-advance to the next track still counts,
  // but autoplay-on-mount and cross-page auto-resume never do.
  const userEngagedRef = useRef(false);
  const markEngaged = useCallback(() => {
    userEngagedRef.current = true;
  }, []);

  // Restore-once state read from the shared cookie at mount.
  const restoreRef = useRef(isBrowser() ? readNowPlaying() : null);
  const pendingSeekRef = useRef(null); // position to apply on loadedmetadata
  const intendedIdxRef = useRef(null); // the restored track index we're settling toward
  const autoStartRef = useRef(false); // start playback once, when settled
  const lastPersistRef = useRef(0);

  const persist = useCallback(
    (playingOverride) => {
      const el = audioRef.current;
      const t = tracks[currentRef.current];
      if (!t) return;
      writeNowPlaying({
        s: t.slug || t.file,
        p: el ? el.currentTime : 0,
        playing: playingOverride != null ? playingOverride : playingRef.current,
        ts: Date.now(),
      });
    },
    [tracks],
  );

  useEffect(() => {
    fetch(`${audioBase}/manifest.json`)
      .then((r) => r.json())
      .then((m) => setTracks(m.tracks || []))
      .catch((e) => console.error("manifest load failed", e));
  }, [audioBase]);

  // Resolve the restored state once the manifest lands: pick the saved track,
  // stage its position, and decide whether to auto-start.
  useEffect(() => {
    if (tracks.length === 0) return;
    const r = restoreRef.current;
    let idx = 0;
    if (r && r.s) {
      const found = tracks.findIndex((t) => (t.slug || t.file) === r.s);
      if (found >= 0) {
        idx = found;
        if (typeof r.p === "number" && r.p > 0) pendingSeekRef.current = r.p;
      }
    }
    autoStartRef.current = r ? !!(r.playing && r.ts && Date.now() - r.ts < RESUME_PLAY_WINDOW_MS) : autoplay;
    intendedIdxRef.current = idx;
    restoreRef.current = null; // consume once
    if (idx !== 0) setCurrent(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  // Manage the audio source. Runs when the manifest lands (idx 0) and on every
  // track change. While settling toward a restored non-zero track we load but
  // hold playback until `current` catches up — that's what prevents an audible
  // flash of track 0 during a cross-site resume.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || tracks.length === 0) return;
    el.load();
    if (intendedIdxRef.current != null && current !== intendedIdxRef.current) return;
    intendedIdxRef.current = null;
    if (playingRef.current || autoStartRef.current) {
      autoStartRef.current = false;
      const attempt = el.play();
      if (attempt !== undefined) attempt.catch(() => setAutoplayBlocked(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, tracks]);

  // Persist a final snapshot as the page unloads (the cross-site handoff).
  useEffect(() => {
    if (!isBrowser()) return;
    const h = () => persist();
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, [persist]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      markEngaged(); // pressing play is the clearest willful play
      el.play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => setAutoplayBlocked(true));
    } else {
      el.pause();
    }
  }, [markEngaged]);

  const select = useCallback(
    (i) => {
      markEngaged(); // picking a track is a willful play
      playBeaconRef.current = { started: false, qualified: false };
      setCurrent(i);
      setProgress(0);
    },
    [markEngaged],
  );

  // `skip` is called both by the next/prev buttons (willful — those handlers call
  // markEngaged) and programmatically by onEnded (auto-advance). It never marks
  // engagement itself, so an auto-advance in an UN-engaged session stays uncounted.
  const skip = useCallback(
    (dir) => {
      playBeaconRef.current = { started: false, qualified: false };
      setCurrent((c) => (c + dir + tracks.length) % tracks.length);
      setProgress(0);
    },
    [tracks.length],
  );

  // Emit the `start` beacon the first time a willfully-played track load actually
  // plays (guarded so resume-after-pause doesn't re-count; skipped entirely for
  // autoplay/auto-resume, which never set userEngaged). The `started` latch is set
  // only when we actually beacon, so a later willful play of the same load counts.
  const beaconStart = useCallback(() => {
    if (playBeaconRef.current.started || !userEngagedRef.current) return;
    playBeaconRef.current.started = true;
    const t = tracks[currentRef.current];
    if (t) beaconPlay(t.slug || t.file, "start");
  }, [tracks]);

  const setPlayState = useCallback(
    (next) => {
      setPlaying(next);
      onPlayStateChange?.(next);
      persist(next);
    },
    [onPlayStateChange, persist],
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

  // Apply a staged resume position once the track's metadata is known.
  const onLoadedMetadata = useCallback((e) => {
    if (pendingSeekRef.current == null) return;
    const el = e.target;
    const dur = Number.isFinite(el.duration) ? el.duration : 0;
    el.currentTime = dur ? Math.min(pendingSeekRef.current, dur - 0.5) : pendingSeekRef.current;
    setProgress(el.currentTime);
    pendingSeekRef.current = null;
  }, []);

  const onTimeUpdate = useCallback(
    (e) => {
      setProgress(e.target.currentTime);
      // A willful play that passes QUALIFY_MS of audio counts as a real listen.
      if (!playBeaconRef.current.qualified && userEngagedRef.current && e.target.currentTime * 1000 >= QUALIFY_MS) {
        playBeaconRef.current.qualified = true;
        const t = tracks[currentRef.current];
        if (t) beaconPlay(t.slug || t.file, "qualified");
      }
      const now = Date.now();
      if (now - lastPersistRef.current > 5000) {
        lastPersistRef.current = now;
        persist();
      }
    },
    [persist, tracks],
  );

  // Played to the very end — the strongest listen signal. Fires before skip(1)
  // advances, so it reads the track that just finished.
  const onEnded = useCallback(() => {
    const t = tracks[currentRef.current];
    if (t && userEngagedRef.current) beaconPlay(t.slug || t.file, "complete");
    skip(1);
  }, [tracks, skip]);

  if (tracks.length === 0) return null;
  const t = tracks[current];
  const pct = t.duration ? Math.min((progress / t.duration) * 100, 100) : 0;

  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999 }}>
      <audio
        ref={audioRef}
        src={`${audioBase}/${t.file}`}
        preload="metadata"
        onPlay={() => {
          beaconStart();
          setPlayState(true);
        }}
        onPause={() => setPlayState(false)}
        onEnded={onEnded}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
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
            <button
              style={btn}
              onClick={() => {
                markEngaged();
                skip(-1);
              }}
              aria-label="Previous track"
            >
              ⟨⟨
            </button>
            <button
              style={{ ...btn, fontSize: 14, padding: "7px 13px", borderColor: `${T.gold}40`, color: T.gold }}
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button
              style={btn}
              onClick={() => {
                markEngaged();
                skip(1);
              }}
              aria-label="Next track"
            >
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
