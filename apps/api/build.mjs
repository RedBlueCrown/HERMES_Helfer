// Bundles the API into dist/main.js, the migration job into dist/migrate.js,
// the telemetry preload into dist/telemetry.js (node --import ./dist/telemetry.js)
// and the evaluation of the agents into dist/eval/main.js: in Azure the model is
// reachable only from the app's network, so the evaluation runs in its container.
// The workspace package @hermes-helfer/core is bundled in; npm dependencies stay
// external and come from node_modules.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@hermes-helfer/"));

await build({
  entryPoints: ["src/main.ts", "src/migrate.ts", "src/telemetry.ts", "src/eval/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist",
  sourcemap: true,
  external,
  logLevel: "info",
});
