// Builds the library (tsc -> dist/), copies the WebAssembly binary next to it,
// and builds the static demo (demo-dist/) that can be hosted as-is.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const wasm = require.resolve("@contentauth/c2pa-web/resources/c2pa.wasm");

rmSync("dist", { recursive: true, force: true });
rmSync("demo-dist", { recursive: true, force: true });

execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { stdio: "inherit", shell: true });
copyFileSync(wasm, "dist/c2pa.wasm");

mkdirSync("demo-dist", { recursive: true });
await build({
  entryPoints: ["demo/app.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  outfile: "demo-dist/app.js",
  legalComments: "none",
});
copyFileSync(wasm, "demo-dist/c2pa.wasm");
writeFileSync("demo-dist/index.html", readFileSync("demo/index.html", "utf8"));
console.log("built dist/ and demo-dist/");
