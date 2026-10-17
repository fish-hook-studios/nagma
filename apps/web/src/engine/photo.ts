import { type PhotoDocument, isPhotoshopFile, loadPhotoEngine } from "../engines/photo-engine";
import { imageBytes, isMediaRef } from "./image-store";
import { editor } from "./store";
import type { ImagePaint, SceneNode } from "./types";

// Data URLs and media references alike (see engine/image-store.ts).
export async function dataUrlToBytes(url: string): Promise<Uint8Array> {
    if (isMediaRef(url)) {
        const bytes = await imageBytes({ x: url }, "x");
        if (!bytes) throw new Error("This image's data is missing from this browser and the server.");
        return bytes;
    }
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
}

// Turns the engine's RGBA output into a PNG data URL (what Nagma draws as the image fill).
export async function rgbaToPng(rgba: Uint8Array, width: number, height: number): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
    return canvas.toDataURL("image/png");
}

// Reads a PSD/PSB with PhotoCraft: a flattened image to show, plus the original to keep for editing.
// The original is the file itself (copying a big PSD into a data URL took about twice its size again).
export async function importPhotoshop(file: File): Promise<{ data: string; source: Blob; width: number; height: number; name: string } | null> {
    if (!isPhotoshopFile(file.name)) return null;
    const engine = await loadPhotoEngine();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A Photoshop file starts "8BPS"; the engine's own error for anything else is a codec message.
    const damaged = new Error("it isn't a Photoshop file, or it's damaged.");
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== "8BPS") throw damaged;
    let doc: PhotoDocument;
    try {
        doc = new engine.PhotoDoc(file.name, bytes);
    } catch {
        throw damaged;
    }
    try {
        const width = doc.width();
        const height = doc.height();
        const data = await rgbaToPng(doc.render(), width, height);
        const source = new Blob([file], { type: "image/vnd.adobe.photoshop" });
        return { data, source, width, height, name: file.name.replace(/\.[^.]+$/, "") };
    } finally {
        doc.free();
    }
}

export function imagePaintAt(node: SceneNode | undefined, index: number): ImagePaint | null {
    const paint = node?.fills[index];
    return paint?.type === "image" ? paint : null;
}

// The top image fill of a layer, if it has one.
export function firstImagePaint(node: SceneNode | undefined): number {
    if (!node) return -1;
    for (let i = node.fills.length - 1; i >= 0; i--) if (node.fills[i]?.type === "image") return i;
    return -1;
}

// A layer that is "an image" the way the reference labels it: a rectangle (or a frame with nothing
// inside) whose only fill is a still image. Its header reads "Image" and it gets the image bar.
export function isImageLayer(node: SceneNode | undefined): boolean {
    if (!node || node.sourceId || node.isMask) return false;
    if (node.type !== "rect" && !(node.type === "frame" && node.children.length === 0 && !node.isSection)) return false;
    const only = node.fills.length === 1 ? node.fills[0] : undefined;
    return only?.type === "image" && !only.video;
}

export function openPhotoEditor(nodeId?: string) {
    const s = editor.get();
    const id = nodeId ?? s.selection[0];
    const node = id ? s.doc.nodes[id] : undefined;
    const index = firstImagePaint(node);
    if (!node || index < 0) {
        editor.notify("Select an image layer (or drop in a photo or PSD) to edit it in Photo.");
        return;
    }
    if (s.readOnly) {
        editor.notify("This file is view only.");
        return;
    }
    editor.set({ photoEdit: { nodeId: node.id, paintIndex: index } });
}
