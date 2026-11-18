// One chat call to any council provider over node:https (2026-10-15). Generalizes the caller in
// scripts/stranger-loop-models.mjs (system prompt, temperature, token cap) for harnesses that run the engine under the
// hermetic loader: that loader replaces global fetch with a refuse-all shim (which is what seals the ENGINE off), so
// model calls go out over node:https instead, with keys passed explicitly — never read from the engine's environment.
import https from "node:https";
import { envValue } from "./env-value.mjs";

function postJSON(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(text); } catch { /* non-json */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on("error", reject);
    req.setTimeout(150000, () => req.destroy(new Error("provider timeout")));
    req.write(body); req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// member: {provider, model_id}; messages: [{role: "user"|"assistant", content}]. Returns {text, usage:{in,out}, model}.
// `model` is what the provider reports back, so version drift is recorded rather than assumed away.
// `extra` (Anthropic only) is merged into the request body, e.g. { output_config: { effort: "medium" } }; `stop` is the
// provider's stop reason, so a refusal is visible to the caller rather than read as an empty answer.
export async function chat(member, messages, { key, system = null, maxTokens = 1800, temperature = null, tries = 6, extra = null } = {}) {
  if (!key) throw new Error(`no API key for ${member.provider}`);
  let lastStatus = null;
  for (let t = 0; t < tries; t++) {
    let res, d;
    try {
      if (member.provider === "anthropic") {
        res = await postJSON("https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          JSON.stringify({ model: member.model_id, max_tokens: maxTokens, ...(system ? { system } : {}), ...(temperature != null ? { temperature } : {}), ...(extra || {}), messages }));
      } else if (member.provider === "gemini") {
        res = await postJSON(`https://generativelanguage.googleapis.com/v1beta/models/${member.model_id}:generateContent?key=${key}`, { "content-type": "application/json" },
          JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: Math.max(maxTokens, 3000), ...(temperature != null ? { temperature } : {}) } }));
      } else {
        const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[member.provider];
        if (!base) throw new Error(`unknown provider ${member.provider}`);
        res = await postJSON(`${base}/chat/completions`, { "content-type": "application/json", authorization: `Bearer ${key}` },
          JSON.stringify({ model: member.model_id, max_tokens: maxTokens, ...(temperature != null ? { temperature } : {}), messages: [...(system ? [{ role: "system", content: system }] : []), ...messages] }));
      }
    } catch (e) { lastStatus = String(e.message || e); await sleep(4000 * (t + 1)); continue; }
    if (res.status === 429 || res.status >= 500) { lastStatus = res.status; await sleep(8000 * (t + 1)); continue; }
    d = res.json || {};
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error).slice(0, 160));
    if (member.provider === "anthropic") return { text: d.content?.map((c) => c.text).join("") || "", usage: { in: d.usage?.input_tokens || 0, out: d.usage?.output_tokens || 0 }, model: d.model || member.model_id, stop: d.stop_reason || null };
    if (member.provider === "gemini") return { text: d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "", usage: { in: d.usageMetadata?.promptTokenCount || 0, out: (d.usageMetadata?.candidatesTokenCount || 0) + (d.usageMetadata?.thoughtsTokenCount || 0) }, model: d.modelVersion || member.model_id };
    return { text: d.choices?.[0]?.message?.content || "", usage: { in: d.usage?.prompt_tokens || 0, out: d.usage?.completion_tokens || 0 }, model: d.model || member.model_id, stop: d.choices?.[0]?.finish_reason || null };
  }
  throw new Error(`provider retries exhausted (last: ${lastStatus})`);
}

// First balanced JSON object in a reply (strings respected) — the stranger-loop parser.
export function firstJSONObject(text) {
  const t = String(text ?? ""); const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

// Keys come from an explicit file (KEY=value lines) or from SL_<ENV> variables — never from the engine's own env.
export function readKeys(envFile, readFileSync) {
  const want = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY", "BLOB_READ_WRITE_TOKEN"];
  const out = {};
  for (const k of want) if (process.env[`SL_${k}`]) out[k] = process.env[`SL_${k}`];
  if (envFile) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m || !want.includes(m[1]) || out[m[1]]) continue;
      out[m[1]] = envValue(m[2]);
    }
  }
  return out;
}
