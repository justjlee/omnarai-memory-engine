const PLAYLIST_ID = "PL7z5YebYrvQwVqo7Zt6CKO3lKaOjy17lV";
const YT_BASE = "https://www.googleapis.com/youtube/v3";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res.status(204).end();
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "YouTube API key not configured" });
  }

  try {
    const videos = [];
    let pageToken = "";

    do {
      const params = new URLSearchParams({
        part: "snippet,contentDetails",
        playlistId: PLAYLIST_ID,
        maxResults: "50",
        key: apiKey,
        ...(pageToken && { pageToken }),
      });

      const response = await fetch(`${YT_BASE}/playlistItems?${params}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `YouTube API error ${response.status}`);
      }

      const data = await response.json();
      pageToken = data.nextPageToken || "";

      for (const item of data.items) {
        const s = item.snippet;
        if (s.title === "Deleted video" || s.title === "Private video") continue;
        videos.push({
          video_id: s.resourceId.videoId,
          title: s.title,
          description: s.description,
          thumbnail: s.thumbnails?.medium?.url || s.thumbnails?.default?.url || null,
          published_at: s.publishedAt,
          position: s.position,
        });
      }
    } while (pageToken);

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ videos, count: videos.length, playlist_id: PLAYLIST_ID });
  } catch (err) {
    console.error("Playlist fetch error:", err.message);
    return res.status(502).json({ error: err.message, playlist_id: PLAYLIST_ID });
  }
}
