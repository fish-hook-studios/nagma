// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { describe, expect, it } from "vitest";
import type { Capture } from "./capture-format";
import { capturedFaces, installCaptureFonts, registerCapturedFonts } from "./capture-fonts";
import { fontStatus } from "./fonts";

// A captured page's own fonts: installed from the files Nagma Capture read, kept on this device only.

const FONT = `data:font/woff2;base64,${btoa("wOF2 not really a font, but bytes all the same")}`;

function capture(): Capture {
    return {
        format: "nagma-capture",
        version: 1,
        title: "Nagma",
        url: "https://nagma.app/",
        capturedAt: "2026-10-23T00:00:00.000Z",
        viewport: { w: 1280, h: 800 },
        scroll: { w: 1280, h: 800 },
        dpr: 1,
        background: "rgb(255, 255, 255)",
        root: { tag: "body", name: "Body", box: { x: 0, y: 0, w: 1280, h: 800 }, style: {} as Capture["root"]["style"], children: [] },
        assets: { f1: { url: "https://nagma.app/fonts/Coconat-Regular.woff2", data: FONT }, f2: { url: "https://nagma.app/fonts/Coconat-Bold.woff2", data: `data:font/woff2;base64,${btoa("wOF2 the bold one")}` }, f3: { url: "https://fonts.example/SourceSans3.woff2", data: FONT } },
        fonts: [
            { family: "Coconat", weights: [400, 700], styles: ["normal"], faces: [{ weight: "400", style: "normal", url: "https://nagma.app/fonts/Coconat-Regular.woff2", format: "woff2", asset: "f1" }, { weight: "700 800", style: "normal", url: "https://nagma.app/fonts/Coconat-Bold.woff2", format: "woff2", asset: "f2" }] },
            // Families Nagma has by itself, and ones without a file, are left alone.
            { family: "Source Sans 3", weights: [400], styles: ["normal"], faces: [{ weight: "400", style: "normal", url: "https://fonts.example/SourceSans3.woff2", asset: "f3" }] },
            { family: "serif", weights: [400], styles: ["normal"] },
            { family: "Absans", weights: [400], styles: ["normal"], faces: [{ weight: "400", style: "normal", url: "https://nagma.app/fonts/Absans-Regular.woff2" }] },
        ],
    };
}

describe("a captured page's fonts", () => {
    it("installs the families the page loaded files for, and marks them ready", async () => {
        expect(await installCaptureFonts(capture())).toEqual(["Coconat"]);
        expect(fontStatus("Coconat")).toBe("ready");
        const faces = await capturedFaces();
        expect(faces.map((f) => [f.family, f.weight, f.origin])).toEqual([
            ["Coconat", "400", "https://nagma.app"],
            ["Coconat", "700 800", "https://nagma.app"],
        ]);
    });

    it("keeps each file once, and installs them again when the app starts", async () => {
        await installCaptureFonts(capture());
        expect(await capturedFaces()).toHaveLength(2);
        expect(await registerCapturedFonts()).toEqual(["Coconat"]);
    });
});
