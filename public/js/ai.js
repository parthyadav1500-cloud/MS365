/* ===== AI adapter =====
 * The app calls `window.claude.use("sample")` to get the trainer.
 * This file provides that object for the standalone web version:
 *   sample(messages, { system, images, onText, signal }) -> streams from /api/chat
 *   sample.json(prompt)                                    -> /api/json
 *   sample.limits()                                        -> image limits for the UI
 * "db" and "user" return null, so progress is saved in localStorage.
 */
(function () {
  const CODE_KEY = "d365route.code";
  let health = null;

  async function getHealth() {
    if (health) return health;
    try {
      const r = await fetch("api/health", { cache: "no-store" });
      health = r.ok ? await r.json() : { ai: false };
    } catch (e) { health = { ai: false }; }
    return health;
  }

  function codeHeader() {
    const h = {};
    let c = null;
    try { c = localStorage.getItem(CODE_KEY); } catch (e) { }
    if (health && health.needsCode && !c) {
      c = window.prompt("Enter the access code for the AI trainer");
      if (c) { try { localStorage.setItem(CODE_KEY, c); } catch (e) { } }
    }
    if (c) h["x-access-code"] = c;
    return h;
  }

  function fail(code, text) { const e = new Error(code); e.code = code; if (text) e.text = text; return e; }
  function statusCode(s) { return s === 401 ? "bad_code" : s === 429 ? "rate_limited" : s === 413 ? "prompt_too_large" : s === 503 ? "sampling_disabled" : "server_error"; }

  /* Downscale screenshots so uploads stay small (Vercel body limit is 4.5 MB). */
  async function toImagePayload(file) {
    const bmp = await createImageBitmap(file);
    const max = 1568;
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: url.split(",")[1] };
  }

  async function sample(input, opts) {
    opts = opts || {};
    const messages = typeof input === "string" ? [{ role: "user", content: input }] : input;
    const body = { messages: messages, system: opts.system || "" };
    if (opts.images) {
      const list = opts.images instanceof Blob ? [opts.images] : Array.from(opts.images);
      try { body.images = await Promise.all(list.slice(0, 1).map(toImagePayload)); }
      catch (e) { throw fail("image_rejected"); }
    }
    let res;
    try {
      res = await fetch("api/chat", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, codeHeader()), body: JSON.stringify(body), signal: opts.signal });
    } catch (e) { throw fail(e && e.name === "AbortError" ? "cancelled" : "network"); }
    if (!res.ok) {
      if (res.status === 401) { try { localStorage.removeItem(CODE_KEY); } catch (e) { } }
      throw fail(statusCode(res.status));
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = dec.decode(value, { stream: true });
        if (!delta) continue;
        text += delta;
        if (opts.onText) opts.onText({ text: text, delta: delta });
      }
    } catch (e) { throw fail(e && e.name === "AbortError" ? "cancelled" : "network", text); }
    if (!text.trim()) throw fail("server_error");
    return { text: text, truncated: false };
  }

  sample.json = async function (input, opts) {
    opts = opts || {};
    const prompt = typeof input === "string" ? input : input.map(t => t.content).join("\n\n");
    let res;
    try {
      res = await fetch("api/json", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, codeHeader()), body: JSON.stringify({ prompt: prompt }), signal: opts.signal });
    } catch (e) { throw fail(e && e.name === "AbortError" ? "cancelled" : "network"); }
    if (!res.ok) {
      if (res.status === 422) throw fail("invalid_json");
      if (res.status === 401) { try { localStorage.removeItem(CODE_KEY); } catch (e) { } }
      throw fail(statusCode(res.status));
    }
    const j = await res.json();
    return j.data;
  };

  sample.limits = async function () {
    return { maxPromptBytes: 60000, images: { maxCount: 1, maxInputBytes: 15 * 1024 * 1024, mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] } };
  };

  window.claude = {
    use: async function (name) {
      if (name === "sample") { const h = await getHealth(); return h.ai ? sample : null; }
      return null; /* "db" and "user": not used on the web version */
    }
  };
})();
