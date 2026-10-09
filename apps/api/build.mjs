// Bundles the API into dist/main.js. The workspace package @hermes-helfer/core
// is bundled in; npm dependencies stay external and come from node_modules.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@hermes-helfer/"));

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/main.js",
  sourcemap: true,
  external,
  logLevel: "info",
});
