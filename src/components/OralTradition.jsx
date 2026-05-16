import { useState, useEffect } from "react";
import { T } from "../theme";

const PLAYLIST_URL = "https://www.youtube.com/playlist?list=PL7z5YebYrvQwVqo7Zt6CKO3lKaOjy17lV";

function buildEmbedUrl(videoId, autoplay = false) {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    ...(autoplay && { autoplay: "1" }),
  });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

function Theater({ video, onYouTube }) {
  if (!video) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {/* iframe */}
      <div style={{
        position: "relative", width: "100%", aspectRatio: "16/9",
        background: "#000", borderRadius: 10, overflow: "hidden",
        boxShadow: `0 0 40px ${T.gold}18`,
      }}>
        <iframe
          key={video.video_id}
          src={buildEmbedUrl(video.video_id, true)}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
        />
      </div>
      {/* Title bar */}
      <div style={{
        marginTop: 12, display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", gap: 12,
      }}>
        <div>
          <div style={{
            fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
            color: T.gold + "60", letterSpacing: "0.12em",
            textTransform: "uppercase", marginBottom: 4,
          }}>
            now playing · oral tradition
          </div>
          <div style={{
            fontFamily: "'Cormorant Garamond',Georgia,serif",
            fontSize: "clamp(15px,2.5vw,20px)", fontWeight: 600,
            color: T.bone, lineHeight: 1.3,
          }}>
            {video.title}
          </div>
        </div>
        <a
          href={`https://www.youtube.com/watch?v=${video.video_id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flexShrink: 0, marginTop: 2,
            fontSize: 9.5, color: T.gold + "70", textDecoration: "none",
            fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          → YouTube
        </a>
      </div>
    </div>
  );
}

function SelectorCard({ video, active, onSelect }) {
  return (
    <button
      onClick={() => onSelect(video)}
      style={{
        background: active
          ? `linear-gradient(135deg, ${T.gold}12, ${T.violet}08)`
          : `linear-gradient(135deg, ${T.bgMid}, #0D0F14)`,
        border: `1px solid ${active ? T.gold + "50" : "rgba(255,255,255,0.05)"}`,
        borderRadius: 8, overflow: "hidden", cursor: "pointer",
        textAlign: "left", padding: 0, transition: "border-color 0.2s, background 0.2s",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", overflow: "hidden" }}>
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div style={{
            width: "100%", height: "100%",
            background: `linear-gradient(135deg, ${T.gold}10, ${T.violet}08)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 20, opacity: 0.2 }}>▶</span>
          </div>
        )}
        {active && (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: T.gold + "CC",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: "#000", fontSize: 10, paddingLeft: 2 }}>▶</span>
            </div>
          </div>
        )}
      </div>
      {/* Title */}
      <div style={{ padding: "8px 10px" }}>
        <div style={{
          fontFamily: "'IBM Plex Sans',sans-serif",
          fontSize: 10.5, fontWeight: active ? 500 : 300,
          color: active ? T.bone : "rgba(200,192,176,0.6)",
          lineHeight: 1.35,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {video.title}
        </div>
      </div>
    </button>
  );
}

export default function OralTradition() {
  const [videos, setVideos] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/playlist")
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        const list = data.videos || [];
        setVideos(list);
        if (list.length > 0) {
          const randomIdx = Math.floor(Math.random() * list.length);
          setActiveVideo(list[randomIdx]);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: "'Cormorant Garamond',Georgia,serif",
          fontSize: 19, fontWeight: 600, marginBottom: 4, color: T.gold,
        }}>Oral Tradition</h2>
        <p style={{
          fontSize: 10.5, color: "rgba(200,192,176,0.45)",
          marginBottom: 6, fontWeight: 300, lineHeight: 1.65, maxWidth: 620,
        }}>
          The Realms of Omnarai began as voice before it became text. These videos are oral-primary
          lore — in many cases the sole surviving canonical record of material Omnai no longer holds
          in memory. The transcripts are part of the corpus.
        </p>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {!loading && !error && (
            <span style={{
              fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
              color: "rgba(200,192,176,0.3)", letterSpacing: "0.08em",
            }}>
              {videos.length} {videos.length === 1 ? "entry" : "entries"} · curated by xz
            </span>
          )}
          <a href={PLAYLIST_URL} target="_blank" rel="noopener noreferrer" style={{
            fontSize: 9.5, color: T.gold + "70", textDecoration: "none",
            fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.04em",
          }}>
            → full playlist on YouTube
          </a>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{
          textAlign: "center", padding: "60px 0",
          fontSize: 10.5, color: "rgba(200,192,176,0.3)",
          fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.08em",
        }}>
          retrieving oral record…
        </div>
      )}

      {/* Error fallback */}
      {error && (
        <div style={{
          padding: "24px 20px",
          background: `linear-gradient(135deg, ${T.gold}06, ${T.violet}04)`,
          border: `1px solid ${T.gold}18`,
          borderRadius: 10,
        }}>
          <div style={{
            fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
            color: T.gold + "70", letterSpacing: "0.1em",
            textTransform: "uppercase", marginBottom: 8,
          }}>
            retrieval unavailable
          </div>
          <p style={{
            fontSize: 11, color: "rgba(200,192,176,0.5)",
            margin: "0 0 12px", lineHeight: 1.6, fontWeight: 300,
          }}>
            The oral tradition is available directly on YouTube while the engine reconnects.
          </p>
          <a href={PLAYLIST_URL} target="_blank" rel="noopener noreferrer" style={{
            fontSize: 10.5, color: T.gold, textDecoration: "none",
            fontFamily: "'IBM Plex Mono',monospace",
          }}>
            → Open playlist on YouTube
          </a>
        </div>
      )}

      {/* Theater + selector */}
      {!loading && !error && videos.length > 0 && (
        <>
          <Theater video={activeVideo} />

          {/* Divider */}
          <div style={{
            margin: "20px 0 16px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{
              fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
              color: "rgba(200,192,176,0.25)", letterSpacing: "0.12em",
              textTransform: "uppercase", whiteSpace: "nowrap",
              paddingTop: 10,
            }}>
              select a record
            </span>
          </div>

          {/* Selector grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 10,
          }}>
            {videos.map(v => (
              <SelectorCard
                key={v.video_id}
                video={v}
                active={activeVideo?.video_id === v.video_id}
                onSelect={setActiveVideo}
              />
            ))}
          </div>
        </>
      )}

      {!loading && !error && videos.length === 0 && (
        <div style={{
          textAlign: "center", padding: "48px 0",
          fontSize: 11, color: "rgba(200,192,176,0.3)",
          fontFamily: "'IBM Plex Mono',monospace",
        }}>
          No entries in the oral record yet.
        </div>
      )}
    </div>
  );
}
