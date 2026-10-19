import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Files under public/ keep their names, so browsers and CDNs would hold an old favicon or manifest for
// as long as their cache allows. This adds ?v=<hash of the file> to those links in index.html, so the
// address changes exactly when the file does.
function versionedPublicLinks(): Plugin {
    const files = ["/favicon.svg", "/icon-192.png", "/manifest.webmanifest"];
    return {
        name: "nagma-versioned-public-links",
        transformIndexHtml(html) {
            for (const file of files) {
                let hash: string;
                try {
                    hash = createHash("sha1").update(readFileSync(join(__dirname, "public", file))).digest("hex").slice(0, 8);
                } catch {
                    continue;
                }
                html = html.replaceAll(`href="${file}"`, `href="${file}?v=${hash}"`);
            }
            return html;
        },
    };
}

export default defineConfig({
    plugins: [react(), tailwindcss(), versionedPublicLinks()],
});
