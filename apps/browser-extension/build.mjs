// Builds Nagma Capture into dist/ (load it with "Load unpacked" in chrome://extensions).
//   node build.mjs          once
//   node build.mjs --watch  rebuilds on change
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "static"), dist, { recursive: true });
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });

const options = {
    entryPoints: { capture: join(root, "src/capture.ts"), background: join(root, "src/background.ts"), popup: join(root, "src/popup.ts") },
    outdir: dist,
    bundle: true,
    format: "iife",
    target: "chrome116",
    legalComments: "none",
    logLevel: "info",
};

if (watch) await (await context(options)).watch();
else await build(options);
