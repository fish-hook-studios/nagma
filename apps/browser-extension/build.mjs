// Builds Nagma Capture.
//   node build.mjs             Chromium (Chrome, Edge, Brave, Arc) into dist/: "Load unpacked"
//   node build.mjs --firefox   Firefox into dist-firefox/: about:debugging › Load Temporary Add-on
//   node build.mjs --watch     rebuilds on change
// Both builds come from the same source. Firefox has no chrome.debugger, so its build leaves the
// debugger features out (states and widths use the fallbacks) and its manifest runs the background
// script as an event page.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const firefox = process.argv.includes("--firefox");
const watch = process.argv.includes("--watch");
const dist = join(root, firefox ? "dist-firefox" : "dist");

// The Chromium manifest as Firefox takes it.
export function firefoxManifest(manifest) {
    const out = { ...manifest };
    delete out.minimum_chrome_version;
    out.background = { scripts: ["background.js"] };
    out.optional_permissions = (manifest.optional_permissions ?? []).filter((p) => p !== "debugger");
    if (!out.optional_permissions.length) delete out.optional_permissions;
    out.browser_specific_settings = { gecko: { id: "capture@nagma.app", strict_min_version: "115.0" } };
    return out;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "static"), dist, { recursive: true });
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });
if (firefox) {
    const manifest = JSON.parse(readFileSync(join(root, "static/manifest.json"), "utf8"));
    writeFileSync(join(dist, "manifest.json"), `${JSON.stringify(firefoxManifest(manifest), null, 4)}\n`);
}

const options = {
    entryPoints: { capture: join(root, "src/capture.ts"), background: join(root, "src/background.ts"), popup: join(root, "src/popup.ts") },
    outdir: dist,
    bundle: true,
    format: "iife",
    target: firefox ? "firefox115" : "chrome116",
    legalComments: "none",
    logLevel: "info",
    define: { __FIREFOX__: firefox ? "true" : "false" },
    // Firefox's build drops the debugger code paths outright (they're behind __FIREFOX__).
    minifySyntax: firefox,
};

if (watch) await (await context(options)).watch();
else await build(options);
