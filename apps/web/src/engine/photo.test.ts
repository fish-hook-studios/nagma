import { describe, expect, it, vi } from "vitest";

vi.mock("../engines/photo-engine", async (orig) => ({ ...(await orig<typeof import("../engines/photo-engine")>()), loadPhotoEngine: (await import("../test/pdf-engine-node")).nodePhotoEngine }));

const photo = await import("./photo");

// A minimal PSD: RGB, 8 bits, no layers, raw image data.
function psd(width: number, height: number): File {
    const head = [0x38, 0x42, 0x50, 0x53, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, height >> 8, height & 255, 0, 0, width >> 8, width & 255, 0, 8, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const bytes = new Uint8Array(head.length + width * height * 3);
    bytes.set(head);
    return new File([bytes], "Test.psd");
}

describe("Photoshop import", () => {
    it("keeps the original file as it is (no data URL copy, which took about twice a big file's size again)", async () => {
        // jsdom has no canvas: the flattened picture is stubbed (it isn't what this test checks).
        HTMLCanvasElement.prototype.getContext = (() => ({ putImageData: () => undefined })) as unknown as HTMLCanvasElement["getContext"];
        vi.stubGlobal("ImageData", class {});
        HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
        const file = psd(4, 3);
        const result = await photo.importPhotoshop(file);
        expect(result?.width).toBe(4);
        expect(result?.height).toBe(3);
        expect(result?.source).toBeInstanceOf(Blob);
        expect(result?.source.size).toBe(file.size);
    });

    it("a file that isn't a PSD says so (the engine said 'codec: unrecognized image format')", async () => {
        await expect(photo.importPhotoshop(new File(["not a psd"], "Fake.psd"))).rejects.toThrow("it isn't a Photoshop file, or it's damaged.");
    });
});

describe("image layers", async () => {
    const { makeNode } = await import("./nodes");
    const { imagePaint, solid } = await import("./paint");
    const doc = { name: "", nodes: {}, roots: [], images: {} } as unknown as Parameters<typeof makeNode>[0];

    it("calls a rectangle or an empty frame whose only fill is a still image an image", () => {
        expect(photo.isImageLayer(makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, null, { fills: [imagePaint("a")] }))).toBe(true);
        expect(photo.isImageLayer(makeNode(doc, "frame", { x: 0, y: 0, w: 10, h: 10 }, null, { fills: [imagePaint("a")] }))).toBe(true);
    });

    it("leaves out frames with layers, extra fills, video, ellipses and masks", () => {
        expect(photo.isImageLayer(makeNode(doc, "frame", { x: 0, y: 0, w: 10, h: 10 }, null, { fills: [imagePaint("a")], children: ["x"] }))).toBe(false);
        expect(photo.isImageLayer(makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, null, { fills: [solid("#FFFFFF"), imagePaint("a")] }))).toBe(false);
        expect(photo.isImageLayer(makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, null, { fills: [{ ...imagePaint("a"), video: { name: "v" } as never }] }))).toBe(false);
        expect(photo.isImageLayer(makeNode(doc, "ellipse", { x: 0, y: 0, w: 10, h: 10 }, null, { fills: [imagePaint("a")] }))).toBe(false);
        expect(photo.isImageLayer(makeNode(doc, "rect", { x: 0, y: 0, w: 10, h: 10 }, null, { fills: [imagePaint("a")], isMask: true }))).toBe(false);
    });
});
