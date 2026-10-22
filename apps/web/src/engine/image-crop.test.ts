// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { viewport } from "./camera";
import { FRAME_HANDLES, cancelCrop, cropFor, cropFramePatch, cropMatrix, endCrop, frameHandleAt, placement, resizeCropFrame, startCrop } from "./image-crop";
import { editor } from "./store";
import type { ImagePaint, NagmaDocument, SceneNode } from "./types";
import { vectorUi } from "./vector-ui";
import { PAGE, add, emptyDoc } from "../test/core-fixtures";

// Crop mode: the layer is the crop frame; dragging its edges or corners changes what the frame
// shows while the picture stays exactly where it is on the canvas.

// A 400×200 picture, already loaded. (The module is replaced outright: loading the original would
// pull in the store and this module before the mock is in place.)
vi.mock("./images", () => ({
    getImage: () => ({ complete: true, naturalWidth: 400, naturalHeight: 200 }) as unknown as HTMLImageElement,
    readImage: vi.fn(),
    placeImages: vi.fn(),
    pickImportFiles: vi.fn(),
    importAsNewFiles: vi.fn(),
    pickImages: vi.fn(),
    IMPORT_ACCEPT: "",
}));

const image = (extra: Partial<ImagePaint> = {}): ImagePaint => ({ type: "image", id: "pic", mode: "fill", opacity: 1, visible: true, blend: "normal", ...extra });

function withImage(box: { x: number; y: number; w: number; h: number }, paint: ImagePaint): NagmaDocument {
    return add(emptyDoc(), "rect", "IMG", box, PAGE, { fills: [paint] });
}

const handle = (id: string) => FRAME_HANDLES.find((h) => h.id === id)!;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sameMatrix = (a: DOMMatrix, b: DOMMatrix) => close(a.a, b.a) && close(a.b, b.b) && close(a.c, b.c) && close(a.d, b.d) && close(a.e, b.e) && close(a.f, b.f);

describe("frame handles", () => {
    const corners = [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 200 },
        { x: 100, y: 200 },
    ];

    it("finds a corner, or any spot along a side", () => {
        expect(frameHandleAt(corners, { x: 302, y: 98 })?.id).toBe("ne");
        expect(frameHandleAt(corners, { x: 300, y: 130 })?.id).toBe("e");
        expect(frameHandleAt(corners, { x: 180, y: 203 })?.id).toBe("s");
        expect(frameHandleAt(corners, { x: 97, y: 120 })?.id).toBe("w");
        expect(frameHandleAt(corners, { x: 250, y: 100 })?.id).toBe("n");
        expect(frameHandleAt(corners, { x: 200, y: 150 })).toBeNull();
        expect(frameHandleAt(corners, { x: 320, y: 150 })).toBeNull();
    });
});

describe("resizing the crop frame", () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };

    it("moves only the dragged side", () => {
        expect(resizeCropFrame(box, handle("e"), -50, 20)).toEqual({ x: 0, y: 0, w: 150, h: 100 });
        expect(resizeCropFrame(box, handle("w"), 30, 0)).toEqual({ x: 30, y: 0, w: 170, h: 100 });
        expect(resizeCropFrame(box, handle("n"), 0, 10)).toEqual({ x: 0, y: 10, w: 200, h: 90 });
        expect(resizeCropFrame(box, handle("s"), 0, -10)).toEqual({ x: 0, y: 0, w: 200, h: 90 });
        expect(resizeCropFrame(box, handle("se"), -20, -30)).toEqual({ x: 0, y: 0, w: 180, h: 70 });
        expect(resizeCropFrame(box, handle("nw"), 20, 30)).toEqual({ x: 20, y: 30, w: 180, h: 70 });
    });

    it("keeps the proportions from the opposite corner with shift", () => {
        expect(resizeCropFrame(box, handle("se"), -100, 0, true)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    });

    it("never gets thinner than a pixel, and flips over when dragged past the far side", () => {
        expect(resizeCropFrame(box, handle("e"), -250, 0)).toEqual({ x: -50, y: 0, w: 50, h: 100 });
        expect(resizeCropFrame(box, handle("e"), -200, 0).w).toBe(1);
    });
});

describe("cropping keeps the picture in place", () => {
    const box = { x: 100, y: 50, w: 200, h: 100 };
    const doc = withImage(box, image({ mode: "crop", crop: [1, 0, 0, 0, 1, 0] }));
    const node = doc.nodes.IMG as SceneNode;
    const paint = node.fills[0] as ImagePaint;
    const place = placement(doc, node, paint);

    it("places the whole image in the frame when the crop is the identity", () => {
        expect(sameMatrix(place, new DOMMatrix([200, 0, 0, 100, 100, 50]))).toBe(true);
        expect(cropFor(box, place)).toEqual([1, 0, 0, 0, 1, 0]);
    });

    it.each(FRAME_HANDLES.map((h) => [h.id, h] as const))("from the %s handle: the visible pixels stay where they were", (_id, h) => {
        const next = resizeCropFrame(box, h, -20, 10);
        const patch = cropFramePatch(node, 0, paint, next, place);
        const after = { ...node, ...patch } as SceneNode;
        const paintAfter = after.fills[0] as ImagePaint;
        expect(paintAfter.mode).toBe("crop");
        // The image's placement on the canvas is unchanged...
        expect(sameMatrix(placement(doc, after, paintAfter), place)).toBe(true);
        // ...and the crop records exactly the region the frame now covers, in image fractions.
        const crop = cropMatrix(paintAfter.crop!);
        const tl = crop.transformPoint(new DOMPoint(0, 0));
        const br = crop.transformPoint(new DOMPoint(1, 1));
        expect(close(tl.x, (next.x - box.x) / box.w) && close(tl.y, (next.y - box.y) / box.h)).toBe(true);
        expect(close(br.x, (next.x + next.w - box.x) / box.w) && close(br.y, (next.y + next.h - box.y) / box.h)).toBe(true);
    });

    it("cropping from the right edge shows the left three quarters of the picture", () => {
        const next = resizeCropFrame(box, handle("e"), -50, 0);
        const patch = cropFramePatch(node, 0, paint, next, place);
        const crop = (patch.fills![0] as ImagePaint).crop!;
        expect(crop.map((v) => Math.round(v * 1000) / 1000)).toEqual([0.75, 0, 0, 0, 1, 0]);
        expect([patch.x, patch.y, patch.w, patch.h]).toEqual([100, 50, 150, 100]);
    });

    it("moving the picture under the frame changes the crop, not the frame", () => {
        const moved = new DOMMatrix().translate(-40, 0).multiply(place);
        const crop = cropMatrix(cropFor(box, moved));
        const tl = crop.transformPoint(new DOMPoint(0, 0));
        expect(close(tl.x, 0.2) && close(tl.y, 0)).toBe(true);
    });
});

describe("entering and leaving crop mode", () => {
    beforeEach(() => {
        viewport.width = 2000;
        viewport.height = 2000;
        editor.loadDocument(withImage({ x: 100, y: 50, w: 200, h: 100 }, image()), null);
        editor.set({ camera: { x: 0, y: 0, zoom: 1 }, selection: ["IMG"] });
        vectorUi.set({ crop: null });
    });

    it("switches the fill to a crop where the picture already was, moving nothing", () => {
        const before = editor.get().doc;
        const node = before.nodes.IMG as SceneNode;
        const fillPlace = placement(before, node, node.fills[0] as ImagePaint);
        startCrop("IMG");
        expect(vectorUi.get().crop).toEqual({ nodeId: "IMG", paintIndex: 0 });
        const after = editor.get().doc.nodes.IMG as SceneNode;
        const paint = after.fills[0] as ImagePaint;
        expect(paint.mode).toBe("crop");
        expect([after.x, after.y, after.w, after.h]).toEqual([100, 50, 200, 100]);
        expect(sameMatrix(placement(editor.get().doc, after, paint), fillPlace)).toBe(true);
        // A 400×200 picture fills a 200×100 frame exactly: the crop is the whole image.
        expect(paint.crop!.map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0, 0, 1, 0]);
        endCrop();
        expect(vectorUi.get().crop).toBeNull();
        expect((editor.get().doc.nodes.IMG as SceneNode).fills[0]).toEqual(paint);
    });

    it("a frame of another shape shows the middle of the picture, uncropped elsewhere", () => {
        editor.loadDocument(withImage({ x: 0, y: 0, w: 100, h: 100 }, image()), null);
        editor.set({ selection: ["IMG"] });
        startCrop("IMG");
        const node = editor.get().doc.nodes.IMG as SceneNode;
        const paint = node.fills[0] as ImagePaint;
        // Fill mode covered the square with the picture's middle half: the crop is that half.
        const crop = cropMatrix(paint.crop!);
        const tl = crop.transformPoint(new DOMPoint(0, 0));
        const br = crop.transformPoint(new DOMPoint(1, 1));
        expect(close(tl.x, 0.25) && close(tl.y, 0) && close(br.x, 0.75) && close(br.y, 1)).toBe(true);
    });

    it("Cancel puts the layer back as it was", () => {
        const before = editor.get().doc.nodes.IMG as SceneNode;
        startCrop("IMG");
        const node = editor.get().doc.nodes.IMG as SceneNode;
        const paint = node.fills[0] as ImagePaint;
        const next = resizeCropFrame({ x: node.x, y: node.y, w: node.w, h: node.h }, handle("e"), -50, 0);
        editor.execute({ type: "node.update", id: "IMG", patch: cropFramePatch(node, 0, paint, next, placement(editor.get().doc, node, paint)) });
        expect((editor.get().doc.nodes.IMG as SceneNode).w).toBe(150);
        cancelCrop();
        const restored = editor.get().doc.nodes.IMG as SceneNode;
        expect([restored.x, restored.y, restored.w, restored.h]).toEqual([100, 50, 200, 100]);
        expect(restored.fills).toEqual(before.fills);
        expect(vectorUi.get().crop).toBeNull();
    });
});
