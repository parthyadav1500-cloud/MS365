/* POST /api/json  { prompt }  ->  { data: <parsed JSON from the model> }
 * Used by "Make new practice questions". */
import { PROVIDER, sendError, checkAccess, rateLimited, readBody, jsonReply } from "../lib/ai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "method", "Use POST.");
  if (!PROVIDER) return sendError(res, 503, "sampling_disabled", "No GEMINI_API_KEY or ANTHROPIC_API_KEY configured.");
  if (!checkAccess(req)) return sendError(res, 401, "bad_code", "Wrong access code.");
  if (rateLimited(req)) return sendError(res, 429, "rate_limited", "Too many requests. Wait a few minutes.");

  const { prompt } = readBody(req);
  if (typeof prompt !== "string" || !prompt.trim()) return sendError(res, 400, "bad_request", "Send a prompt.");

  let reply;
  try {
    reply = await jsonReply(prompt.slice(0, 12000));
  } catch (e) {
    return sendError(res, e.status || 502, e.code || "upstream_error", e.message);
  }
  const text = reply.replace(/```json|```/g, "").trim();
  const start = text.search(/[\[{]/);
  try {
    const data = JSON.parse(start >= 0 ? text.slice(start) : text);
    res.status(200).json({ data });
  } catch (e) {
    sendError(res, 422, "invalid_json", "The model's reply wasn't valid JSON.");
  }
}
