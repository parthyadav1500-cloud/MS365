/* Shared helpers for the API routes. Server-side only: API keys never reach the browser.
 * Provider: Google Gemini (free tier) when GEMINI_API_KEY is set, otherwise Anthropic when ANTHROPIC_API_KEY is set. */
export const PROVIDER = process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
export const MODEL = PROVIDER === "gemini"
  ? process.env.GEMINI_MODEL || "gemini-3.5-flash"
  : process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

/* Optional shared passcode so strangers can't use up your quota. */
export function checkAccess(req) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  return req.headers["x-access-code"] === code;
}

/* Best-effort rate limit per IP (per warm instance): 40 requests / 10 minutes. */
const hits = new Map();
export function rateLimited(req, limit = 40, windowMs = 10 * 60 * 1000) {
  const ip = String(req.headers["x-forwarded-for"] || "anon").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > limit;
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

/* Keep the conversation valid: user first, roles alternate, last turn from the user. */
export function cleanMessages(input) {
  const list = (Array.isArray(input) ? input : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))
    .slice(-16);
  while (list.length && list[0].role !== "user") list.shift();
  const merged = [];
  for (const m of list) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  if (!merged.length || merged[merged.length - 1].role !== "user") return null;
  return merged;
}

/* Thrown for a failed upstream call; `status`, `code` and `message` go straight to the browser. */
export class UpstreamError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function upstreamError(r) {
  const text = await r.text().catch(() => "");
  console.error(PROVIDER + " error", r.status, text);
  if (r.status === 429 || r.status === 529 || r.status === 503) return new UpstreamError(429, "rate_limited", "The AI service is busy or the free quota is used up. Try again in a minute.");
  if (r.status === 401 || r.status === 403 || /API_KEY_INVALID|API key not valid/i.test(text)) return new UpstreamError(500, "server_key", "The server's AI API key is missing or invalid.");
  if (r.status === 413) return new UpstreamError(413, "prompt_too_large", "The request is too large.");
  if (r.status === 400) return new UpstreamError(400, "bad_request", "The AI service rejected the request.");
  return new UpstreamError(502, "upstream_error", "The AI service returned an error.");
}

async function post(url, headers, body, signal) {
  let r;
  try { r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal }); }
  catch (e) { throw new UpstreamError(502, "upstream_error", "Could not reach the AI service."); }
  if (!r.ok) throw await upstreamError(r);
  return r;
}

/* Yields the JSON payload of each server-sent event. */
async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const dataLine = event.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) continue;
      try { yield JSON.parse(dataLine.slice(5).trim()); } catch (e) { /* skip malformed event */ }
    }
  }
}

/* ---------- Gemini ---------- */
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const geminiHeaders = () => ({ "x-goog-api-key": process.env.GEMINI_API_KEY });

function geminiBody(system, messages, images, extra) {
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (images.length) contents[contents.length - 1].parts.unshift(...images.map(i => ({ inlineData: { mimeType: i.media_type, data: i.data } })));
  const body = { contents, generationConfig: { maxOutputTokens: 8192, ...extra } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return body;
}

const geminiText = data => ((data.candidates || [])[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join("");

/* ---------- Anthropic ---------- */
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const anthropicHeaders = () => ({ "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" });

function anthropicMessages(messages, images) {
  if (!images.length) return messages;
  const out = messages.map(m => ({ ...m }));
  const last = out[out.length - 1];
  last.content = [
    ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
    { type: "text", text: last.content }
  ];
  return out;
}

/* ---------- public API ---------- */

/* Starts a streamed reply. Throws UpstreamError before any text if the call fails;
 * otherwise returns an async iterable of text chunks. */
export async function streamReply({ system, messages, images = [], signal }) {
  if (PROVIDER === "gemini") {
    const r = await post(GEMINI_URL + encodeURIComponent(MODEL) + ":streamGenerateContent?alt=sse", geminiHeaders(), geminiBody(system, messages, images), signal);
    return (async function* () {
      for await (const data of sseEvents(r.body)) {
        if (data.error) { console.error("Stream error", data.error); continue; }
        const t = geminiText(data);
        if (t) yield t;
      }
    })();
  }
  const r = await post(ANTHROPIC_URL, anthropicHeaders(),
    { model: MODEL, max_tokens: 4000, system: system || undefined, messages: anthropicMessages(messages, images), stream: true }, signal);
  return (async function* () {
    for await (const data of sseEvents(r.body)) {
      if (data.type === "content_block_delta" && data.delta && data.delta.type === "text_delta") yield data.delta.text;
      else if (data.type === "error") console.error("Stream error", data.error);
    }
  })();
}

/* One-shot reply asking for JSON. Returns the raw text. */
export async function jsonReply(prompt) {
  const system = "Reply with valid JSON only. No prose, no code fences.";
  if (PROVIDER === "gemini") {
    const r = await post(GEMINI_URL + encodeURIComponent(MODEL) + ":generateContent", geminiHeaders(),
      geminiBody(system, [{ role: "user", content: prompt }], [], { responseMimeType: "application/json" }));
    return geminiText(await r.json());
  }
  const r = await post(ANTHROPIC_URL, anthropicHeaders(),
    { model: MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: prompt }] });
  const out = await r.json();
  return (out.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}
