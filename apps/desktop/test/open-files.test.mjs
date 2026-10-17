import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { MAX_OPEN_BYTES, openableFiles, readOpenFile } = require("../open-files.cjs");

describe("files opened from Finder, the Dock or the command line", () => {
    it("takes every kind Import… opens, not just .fig, .deck, .buzz, .pptx and .pdf", () => {
        const files = ["/a/Design.fig", "/a/Deck.DECK", "/a/Ad.buzz", "/a/Talk.pptx", "/a/Doc.pdf", "/a/Screens.sketch", "/a/Art.psd", "/a/Big.psb", "/a/Mag.idml", "/a/Mag.designcraft", "/a/Logo.svg", "/a/Photo.JPG", "/a/Pic.webp", "/a/Clip.mov", "/a/Clip.mkv", "/a/Clip.webm", "/a/Clip.mxf", "/a/Clip.mp4"];
        assert.deepEqual(openableFiles(files), files);
    });
    it("leaves out flags, the app's own path and files Nagma doesn't open", () => {
        assert.deepEqual(openableFiles(["/Applications/Nagma.app/Contents/MacOS/Nagma", ".", "--inspect", "-psn_0_123", "/a/notes.txt", "/a/archive.zip", "nagma://open?file=1", "/a/Real.fig"]), ["/a/Real.fig"]);
    });
    it("reads a file as base64 with its name", () => {
        const fs = { statSync: () => ({ size: 3 }), readFileSync: () => Buffer.from("abc") };
        assert.deepEqual(readOpenFile(fs, "/x/y/File.fig"), { name: "File.fig", data: "YWJj" });
    });
    it("refuses a file too big to hand to the page, before reading it", () => {
        let read = false;
        const fs = { statSync: () => ({ size: MAX_OPEN_BYTES + 1 }), readFileSync: () => ((read = true), Buffer.alloc(0)) };
        assert.throws(() => readOpenFile(fs, "/x/Huge.pdf"), /Huge\.pdf is larger than 256 MB\. Open it with Import… in Nagma instead\./);
        assert.equal(read, false);
    });
});
