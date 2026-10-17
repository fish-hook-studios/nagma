import { editor } from "./store";

// Pixel preview (View › Pixel preview, ⌃P): the canvas drawn at 1x or 2x device pixels. Every
// change says so at the bottom of the screen, as in the reference.
export function setPixelPreview(scale: 0 | 1 | 2) {
    editor.setPrefs(scale ? { pixelPreview: true, pixelPreviewScale: scale } : { pixelPreview: false });
    editor.notify(scale ? `Pixel preview: ${scale}x` : "Pixel preview: disabled");
}

export function togglePixelPreview() {
    const p = editor.get().prefs;
    setPixelPreview(p.pixelPreview ? 0 : p.pixelPreviewScale);
}
