import { PROVIDER, MODEL } from "../lib/ai.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ai: Boolean(PROVIDER),
    provider: PROVIDER,
    needsCode: Boolean(process.env.ACCESS_CODE),
    model: MODEL
  });
}
