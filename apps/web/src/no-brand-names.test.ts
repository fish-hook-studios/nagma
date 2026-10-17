import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Nagma describes itself on its own terms: the names of the design suite whose files it imports
// appear only in the modules that hold that format's protocol tokens. This scans every tracked
// text file for them. The patterns use a character class (f[i]...) so this file doesn't match
// itself; tools/check-brand-names.sh runs the same check in CI.

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

// The two interop modules may spell the format's tokens.
const ALLOWED_FILES = new Set(["apps/web/src/engine/interop-format.ts", "apps/server/interop-hosts.mjs"]);
const SKIPPED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(wasm|png|jpe?g|gif|webp|avif|ico|icns|ttf|otf|woff2?|pdf|mp4|zip)$/i;

const BANNED: { name: string; pattern: RegExp }[] = [
    { name: "suite name", pattern: /f[i]gma/i },
    { name: "whiteboard product name", pattern: /f[i]g-?jam/i },
    { name: "file magic", pattern: /f[i]g-(kiwi|deck|buzz)/i },
    { name: "inspect mode name", pattern: /D[e]v Mode/ },
    { name: "match animate name", pattern: /s[m]art animate/i },
    { name: "template field", pattern: /c[o]operTemplate/i },
    // The campaign product's name; `.buzz` (and `|buzz` in an extension list) is the file extension.
    { name: "campaign product name", pattern: /(?<![.|\w])b[u]zz(?!\w)/i },
];
// Lines that must carry the bare extension (the desktop app's file associations).
const ALLOWED_LINES = [/^\s*"ext": "b[u]zz",?$/];

function trackedFiles(): string[] {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        .split("\0")
        .filter((f) => f && !ALLOWED_FILES.has(f) && !SKIPPED.test(f));
}

describe("no brand names", () => {
    it("tracked files don't name the imported format's suite or its products", () => {
        const hits: string[] = [];
        for (const file of trackedFiles()) {
            let text: string;
            try {
                text = readFileSync(join(ROOT, file), "utf8");
            } catch {
                continue; // deleted in the working tree
            }
            if (text.includes("\0")) continue; // binary
            text.split("\n").forEach((line, i) => {
                if (ALLOWED_LINES.some((re) => re.test(line))) return;
                for (const { name, pattern } of BANNED) if (pattern.test(line)) hits.push(`${file}:${i + 1} (${name}): ${line.trim().slice(0, 120)}`);
            });
        }
        expect(hits).toEqual([]);
    });
});
