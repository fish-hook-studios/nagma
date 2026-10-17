import { nanoid } from "nanoid";
import { loadPhotoEngine } from "../engines/photo-engine";
import { storeDataUrl } from "./image-store";
import { dataUrlToBytes, rgbaToPng } from "./photo";
import type { ImageAdjust, ImagePaint } from "./types";

// The image fill's sliders, run through PhotoCraft's raw-style adjustment (temperature, tint,
// exposure, contrast, highlights, shadows, saturation) and baked into a new image. The untouched
// image is kept as `original`, so the sliders stay editable.

export const NO_ADJUST: ImageAdjust = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0 };

export const ADJUST_KEYS: (keyof ImageAdjust)[] = ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows"];
export const ADJUST_LABELS: Record<keyof ImageAdjust, string> = {
    exposure: "Exposure",
    contrast: "Contrast",
    saturation: "Saturation",
    temperature: "Temperature",
    tint: "Tint",
    highlights: "Highlights",
    shadows: "Shadows",
};

export function isAdjusted(adjust: ImageAdjust | undefined): boolean {
    return Boolean(adjust && ADJUST_KEYS.some((k) => adjust[k] !== 0));
}

// Bakes the sliders into a new image: returns its id and data, or null when nothing changed.
export async function bakeAdjust(paint: ImagePaint, images: Record<string, string>, adjust: ImageAdjust): Promise<{ id: string; data: string } | null> {
    const sourceId = paint.original ?? paint.id;
    const data = images[sourceId];
    if (!data) return null;
    const engine = await loadPhotoEngine();
    const bytes = await dataUrlToBytes(data);
    const name = data.startsWith("data:image/jpeg") ? "image.jpg" : data.startsWith("data:image/webp") ? "image.webp" : "image.png";
    const doc = new engine.PhotoDoc(name, bytes);
    try {
        doc.execute(
            "filter.cameraRaw",
            JSON.stringify({
                // Exposure runs -5..5 stops in the engine; the slider is -100..100.
                exposure: (adjust.exposure / 100) * 3,
                contrast: adjust.contrast,
                saturation: adjust.saturation,
                temperature: adjust.temperature,
                tint: adjust.tint,
                highlights: adjust.highlights,
                shadows: adjust.shadows,
            }),
        );
        const png = await rgbaToPng(doc.render(), doc.width(), doc.height());
        return { id: nanoid(12), data: await storeDataUrl(png) };
    } finally {
        doc.free();
    }
}
