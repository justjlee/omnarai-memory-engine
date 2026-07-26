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

// innertube ANDROID user-agent. clientVersion 19.09.37 began returning player 400 in 2026;
// 20.10.38 works. The timedtext baseUrl returns format-3 XML (words in <s> tags), NOT json3,
// so parse the XML — appending &fmt=json3 is ignored by this endpoint.
const YT_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const YT_CLIENT_VERSION = "20.10.38";

const XML_ENT = { "&amp;": "&", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
          .replace(/&amp;|&#39;|&quot;|&lt;|&gt;|&nbsp;/g, (m) => XML_ENT[m] || m);
}
function parseTimedText(body) {
  const segs = [...body.matchAll(/<s[^>]*>([^<]*)<\/s>/g)].map((m) => decodeEntities(m[1]));
  if (segs.length) return segs.join("").replace(/\s+/g, " ").trim();
  const alt = [...body.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")));
  return alt.join(" ").replace(/\s+/g, " ").trim();
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
        "User-Agent": YT_UA,
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": YT_CLIENT_VERSION,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: YT_CLIENT_VERSION,
            androidSdkVersion: 34,
            userAgent: YT_UA,
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

  const captionRes = await fetch(track.baseUrl, {
    headers: { "User-Agent": YT_UA },
  });
  if (!captionRes.ok) return null;

  const text = parseTimedText(await captionRes.text());
  return text ? { text } : null;
}
