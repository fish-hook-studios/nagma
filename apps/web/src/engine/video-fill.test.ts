import { describe, expect, it, vi } from "vitest";

// FilmCraft has no VP8 decoder: its source opens, but reading facts or frames throws.
vi.mock("../engines/video-engine", async (orig) => ({
    ...(await orig<typeof import("../engines/video-engine")>()),
    loadVideoEngine: async () => ({
        VideoSource: class {
            info(): string {
                throw new Error("unsupported media: no decoder for VP8 video");
            }
            frame(): never {
                throw new Error("unsupported media: no decoder for VP8 video");
            }
            free() {}
        },
    }),
}));
vi.mock("./video/import", async (orig) => ({
    ...(await orig<typeof import("./video/import")>()),
    browserInfo: async () => ({ info: { seconds: 1.5, width: 320, height: 180, fps: 30, hasAudio: true }, poster: "data:image/jpeg;base64,AAAA" }),
}));
vi.mock("./media", async (orig) => ({ ...(await orig<typeof import("./media")>()), storeMedia: async () => undefined }));
vi.mock("./image-store", async (orig) => ({ ...(await orig<typeof import("./image-store")>()), storeDataUrl: async () => "media:poster" }));

const { importVideo } = await import("./video");

describe("video fills in design files", () => {
    it("a WebM FilmCraft can't decode (VP8) is read by the browser instead of failing", async () => {
        const { poster, video } = await importVideo(new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], "recording.webm", { type: "video/webm" }));
        expect(video).toMatchObject({ name: "recording.webm", seconds: 1.5, width: 320, height: 180, hasAudio: true });
        expect(poster.data).toBe("media:poster");
    });
});
