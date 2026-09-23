/* POST /api/chat  { system, messages: [{role, content}], images?: [{media_type, data}] }
 * Streams the trainer's answer back as plain text. */
import { PROVIDER, sendError, checkAccess, rateLimited, readBody, cleanMessages, streamReply } from "../lib/ai.js";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "method", "Use POST.");
  if (!PROVIDER) return sendError(res, 503, "sampling_disabled", "No GEMINI_API_KEY or ANTHROPIC_API_KEY configured.");
  if (!checkAccess(req)) return sendError(res, 401, "bad_code", "Wrong access code.");
  if (rateLimited(req)) return sendError(res, 429, "rate_limited", "Too many requests. Wait a few minutes.");

  const body = readBody(req);
  const messages = cleanMessages(body.messages);
  if (!messages) return sendError(res, 400, "bad_request", "Send at least one user message.");
  const system = typeof body.system === "string" ? body.system.slice(0, 12000) : "";
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter(i => i && IMAGE_TYPES.includes(i.media_type) && typeof i.data === "string" && i.data.length < 4_000_000)
    .slice(0, 1);

  /* res "close" fires on client disconnect; req "close" fires as soon as the body has been read (Node 16+). */
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });

  let stream;
  try {
    stream = await streamReply({ system, messages, images, signal: controller.signal });
  } catch (e) {
    return sendError(res, e.status || 502, e.code || "upstream_error", e.message);
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no"
  });
  try {
    for await (const text of stream) res.write(text);
  } catch (e) {
    /* client closed the connection, or the stream broke */
  }
  res.end();
}
