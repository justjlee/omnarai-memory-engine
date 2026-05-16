// Proxy endpoint for YouTube caption fetch.
// Uses YouTube's internal innertube API (Android client) instead of HTML scraping —
// Vercel data center IPs don't get captionTracks embedded in watch page HTML,
// but innertube POST requests work from any server IP.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const videoId = req.query.v || (req.body && req.body.v);
  if (!videoId) {
    return res.status(400).json({ error: "Missing video ID (?v=...)" });
  }

  const result = await fetchCaptions(videoId);
  if (result === null) {
    return res.status(404).json({ error: "no_captions_available", video_id: videoId });
  }

  return res.status(200).json({ text: result.text, video_id: videoId, source: "youtube-auto-caption" });
}

async function fetchCaptions(videoId) {
  // Android client innertube request — bypasses bot detection on data center IPs
  const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const playerRes = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "19.09.37",
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.09.37",
            androidSdkVersion: 30,
            userAgent: "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
            hl: "en",
            gl: "US",
          },
        },
      }),
    }
  );

  if (!playerRes.ok) return null;
  const playerData = await playerRes.json();

  const captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) return null;

  // Prefer English ASR (auto-generated), then any English, then first available
  const track =
    captionTracks.find(t => t.languageCode === "en" && t.kind === "asr") ||
    captionTracks.find(t => t.languageCode === "en") ||
    captionTracks[0];

  if (!track?.baseUrl) return null;

  const captionRes = await fetch(track.baseUrl + "&fmt=json3", {
    headers: {
      "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
    },
  });
  if (!captionRes.ok) return null;

  const data = await captionRes.json();
  const events = data.events || [];

  const segments = events
    .flatMap(e => e.segs || [])
    .map(s => s.utf8 || "")
    .filter(s => s.trim() && s !== "\n");

  const text = segments.join(" ").replace(/\s+/g, " ").trim();
  return text ? { text } : null;
}
