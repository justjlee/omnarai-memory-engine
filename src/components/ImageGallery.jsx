import { useState, useMemo } from "react";
import { T } from "../theme";

export default function ImageGallery({ images, corpus }) {
  const [selected, setSelected] = useState(null);
  const [filterRing, setFilterRing] = useState(null);

  // Enrich images with corpus ring data
  const enriched = useMemo(() => {
    const corpusMap = {};
    for (const r of corpus) corpusMap[r.id] = r;
    return images
      .map(img => {
        const record = corpusMap[img.corpusId];
        return { ...img, ring: record?.ring || "open", record };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [images, corpus]);

  const filtered = filterRing
    ? enriched.filter(img => img.ring === filterRing)
    : enriched;

  return (
    <div>
      {/* Ring filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => setFilterRing(null)}
          style={{
            fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
            color: !filterRing ? T.bone : "rgba(200,192,176,0.35)",
            background: !filterRing ? "rgba(255,255,255,0.06)" : "transparent",
            border: `1px solid ${!filterRing ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}`,
            borderRadius: 8, padding: "5px 12px", cursor: "pointer",
            letterSpacing: "0.06em",
          }}
        >ALL ({enriched.length})</button>
        {["core", "curated", "open"].map(ring => {
          const count = enriched.filter(img => img.ring === ring).length;
          const rc = T.ring[ring];
          return (
            <button key={ring}
              onClick={() => setFilterRing(filterRing === ring ? null : ring)}
              style={{
                fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                color: filterRing === ring ? rc.color : "rgba(200,192,176,0.35)",
                background: filterRing === ring ? rc.color + "12" : "transparent",
                border: `1px solid ${filterRing === ring ? rc.color + "30" : "rgba(255,255,255,0.04)"}`,
                borderRadius: 8, padding: "5px 12px", cursor: "pointer",
                letterSpacing: "0.06em",
              }}
            >{rc.label.toUpperCase()} ({count})</button>
          );
        })}
      </div>

      {/* Masonry grid */}
      <div style={{
        columns: "2 280px",
        columnGap: 10,
      }}>
        {filtered.map(img => {
          const rc = T.ring[img.ring] || T.ring.open;
          const aspect = img.height / img.width;
          return (
            <div key={img.corpusId}
              onClick={() => setSelected(img)}
              style={{
                breakInside: "avoid",
                marginBottom: 10,
                cursor: "pointer",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.04)",
                background: "rgba(255,255,255,0.01)",
                transition: "border-color 0.2s, transform 0.2s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = rc.color + "40";
                e.currentTarget.style.transform = "scale(1.01)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              <div style={{
                width: "100%",
                paddingBottom: `${aspect * 100}%`,
                position: "relative",
                background: "rgba(255,255,255,0.02)",
              }}>
                <img
                  src={img.url}
                  alt={img.title}
                  loading="lazy"
                  style={{
                    position: "absolute",
                    top: 0, left: 0,
                    width: "100%", height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </div>
              <div style={{ padding: "8px 10px" }}>
                <div style={{
                  fontSize: 10.5,
                  fontFamily: "'IBM Plex Sans',sans-serif",
                  color: T.bone,
                  lineHeight: 1.4,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>{img.title}</div>
                <div style={{
                  fontSize: 8.5,
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: "rgba(200,192,176,0.3)",
                  marginTop: 3,
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}>
                  <span style={{ color: rc.color + "70" }}>{img.corpusId}</span>
                  <span>{img.date}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(5,6,10,0.92)",
            backdropFilter: "blur(12px)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            cursor: "pointer",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: "90vw",
              maxHeight: "80vh",
              position: "relative",
              cursor: "default",
            }}
          >
            <img
              src={selected.url}
              alt={selected.title}
              style={{
                maxWidth: "90vw",
                maxHeight: "75vh",
                objectFit: "contain",
                borderRadius: 6,
                display: "block",
              }}
            />
            <div style={{
              marginTop: 12,
              textAlign: "center",
              maxWidth: 600,
              margin: "12px auto 0",
            }}>
              <div style={{
                fontSize: 14,
                fontFamily: "'Cormorant Garamond',Georgia,serif",
                color: T.bone,
                fontWeight: 600,
                lineHeight: 1.4,
              }}>{selected.title}</div>
              <div style={{
                fontSize: 9,
                fontFamily: "'IBM Plex Mono',monospace",
                color: "rgba(200,192,176,0.4)",
                marginTop: 6,
                display: "flex",
                gap: 10,
                justifyContent: "center",
                alignItems: "center",
              }}>
                <span style={{ color: (T.ring[selected.ring]?.color || T.violet) + "80" }}>
                  {selected.corpusId}
                </span>
                <span>{selected.date}</span>
                <span>{selected.width} x {selected.height}</span>
                {selected.record?.contributors && (
                  <span>{selected.record.contributors.join(", ")}</span>
                )}
              </div>
              {selected.permalink && (
                <a
                  href={selected.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{
                    display: "inline-block",
                    marginTop: 10,
                    fontSize: 9,
                    fontFamily: "'IBM Plex Mono',monospace",
                    color: T.violet + "80",
                    textDecoration: "none",
                    border: `1px solid ${T.violet}25`,
                    borderRadius: 6,
                    padding: "4px 12px",
                  }}
                >VIEW ORIGINAL POST</a>
              )}
            </div>
          </div>
          {/* Close button */}
          <button
            onClick={() => setSelected(null)}
            style={{
              position: "absolute",
              top: 16, right: 20,
              fontSize: 11,
              fontFamily: "'IBM Plex Mono',monospace",
              color: "rgba(200,192,176,0.5)",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >ESC</button>
        </div>
      )}
    </div>
  );
}
