/* Quick syntax check of every front-end and API file: `npm run check` */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const order = ["ai.js", "data.js", "qbank.js", "lab.js", "app.js", "labui.js", "boot.js"];
const bundle = order.map(f => readFileSync(join("public/js", f), "utf8")).join("\n");
try { new vm.Script(bundle, { filename: "public/js (bundle)" }); console.log("✓ front-end scripts parse"); }
catch (e) { console.error("✗ front-end:", e.message); process.exit(1); }

for (const f of readdirSync("api")) {
  try { await import("../api/" + f); console.log("✓ api/" + f); }
  catch (e) { console.error("✗ api/" + f, e.message); process.exit(1); }
}
