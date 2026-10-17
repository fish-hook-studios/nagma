import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { clipboardImage, MAX_CLIPBOARD_IMAGE } = require("../guards.cjs");

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

describe("the clipboard's picture handed to the editor", () => {
    it("passes PNG bytes through", () => {
        const out = clipboardImage(PNG);
        assert.ok(out instanceof Uint8Array);
        assert.deepEqual(Buffer.from(out), PNG);
    });
    it("refuses anything that isn't PNG bytes", () => {
        for (const v of [null, undefined, "png", 42, {}, [137, 80, 78, 71], Buffer.from("GIF89a........"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), new Uint8Array()]) assert.equal(clipboardImage(v), null);
    });
    it("refuses a picture over the size cap", () => {
        const big = Buffer.alloc(MAX_CLIPBOARD_IMAGE + 1);
        PNG.copy(big, 0, 0, 8);
        assert.equal(clipboardImage(big), null);
    });
    it("the preload exposes only a no-argument reader over one invoke channel", async () => {
        const { readFileSync } = await import("node:fs");
        const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
        assert.match(preload, /readClipboardImage: \(\) => ipcRenderer\.invoke\("nagma:clipboard-image"\)/);
        const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8");
        assert.match(main, /ipcMain\.handle\("nagma:clipboard-image", \(event\) => \{\n\s+if \(!fromTrusted\(event\)/);
    });
});
