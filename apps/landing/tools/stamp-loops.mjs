// Stamps every loop reference in home.html (img/loop-*.mp4, .webm, .jpg) with a short hash of
// the file, as a query string, so a re-recorded loop is fetched afresh instead of served from the
// browser's cache. Run after recording (the build runs it too):
//
//   node apps/landing/tools/stamp-loops.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function stampLoops(html) {
    const hashes = new Map();
    const hash = (file) => {
        if (!hashes.has(file)) {
            try {
                hashes.set(file, createHash("sha1").update(readFileSync(join(root, file))).digest("hex").slice(0, 8));
            } catch {
                hashes.set(file, null);
            }
        }
        return hashes.get(file);
    };
    return html.replace(/img\/(loop-[a-z0-9-]+\.(?:mp4|webm|jpg))(\?v=[0-9a-f]+)?/g, (m, file) => {
        const h = hash(`img/${file}`);
        return h ? `img/${file}?v=${h}` : m;
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const p = join(root, "home.html");
    const before = readFileSync(p, "utf8");
    const after = stampLoops(before);
    if (after !== before) writeFileSync(p, after);
    console.log(after === before ? "loops: no change" : "loops: stamped");
}
