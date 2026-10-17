import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The PDF engine (WebAssembly) loaded from disk for tests, where the app's loader would fetch it:
// `vi.mock("../engines/pdf-engine", async (orig) => ({ ...(await orig()), loadPdfEngine: nodePdfEngine }))`.
let loading: Promise<unknown> | null = null;

export function nodePdfEngine<T>(): Promise<T> {
    loading ??= (async () => {
        const glue = await import("../engines/pdf/nagma_pdf.js");
        await glue.default({ module_or_path: readFileSync(resolve(process.cwd(), "src/engines/pdf/nagma_pdf_bg.wasm")) });
        return glue;
    })();
    return loading as Promise<T>;
}

// Media kept in memory (jsdom has no IndexedDB): `vi.mock("../engine/media", () => import("../test/pdf-engine-node").then((m) => m.memoryMedia()))`.
export async function memoryMedia() {
    const real = await import("../engine/media");
    const blobs = new Map<string, Blob>();
    return {
        ...real,
        storeMedia: async (id: string, blob: Blob) => void blobs.set(id, blob),
        loadMedia: async (id: string) => blobs.get(id) ?? null,
    };
}

// The photo engine (PSD/PSB), loaded from disk the same way:
// `vi.mock("../engines/photo-engine", async (orig) => ({ ...(await orig()), loadPhotoEngine: nodePhotoEngine }))`.
let photoLoading: Promise<unknown> | null = null;

export function nodePhotoEngine<T>(): Promise<T> {
    photoLoading ??= (async () => {
        const glue = await import("../engines/photo/nagma_photo.js");
        await glue.default({ module_or_path: readFileSync(resolve(process.cwd(), "src/engines/photo/nagma_photo_bg.wasm")) });
        return glue;
    })();
    return photoLoading as Promise<T>;
}
