import { nanoid } from "nanoid";
import { imageSrc, notifyImageReady, onImageReady, storeDataUrl, storeImage } from "./image-store";
import { isLayoutFile } from "../engines/layout-engine";
import { isPdfFile } from "../engines/pdf-engine";
import { isVideoFile } from "../engines/video-engine";
import { isPhotoshopFile } from "../engines/photo-engine";
import { frameAt, makeNode } from "./nodes";
import { placeLayoutFile } from "./layout-import";
import { noteImageSize } from "./lottie";
import { placePdf } from "./pdf";
import { placeVideos } from "./video";
import { importPhotoshop } from "./photo";
import { imagePaint } from "./paint";
import { editor } from "./store";
import { apply, spaceMatrix } from "./transform";
import type { Command, NagmaDocument } from "./types";

// Largest side kept on import, like other design tools; bigger images are scaled down.
const MAX_SIDE = 4096;

const cache = new Map<string, HTMLImageElement>();

// A media image that just arrived gets drawn on the next frame.
onImageReady(() => editor.set({}));

// The decoded image for an id, or null while it loads (the canvas redraws once it's ready).
export function getImage(doc: NagmaDocument, id: string): HTMLImageElement | null {
    const cached = cache.get(id);
    if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
    // Media images arrive a moment later; the canvas redraws when they do.
    const src = imageSrc(doc.images, id);
    if (!src) return null;
    const img = new Image();
    img.onload = () => {
        noteImageSize(id, img.naturalWidth, img.naturalHeight);
        // Slide thumbnails and other pictures drawn outside the editor's canvas redraw too.
        notifyImageReady();
        editor.set({});
    };
    img.src = src;
    cache.set(id, img);
    return null;
}

interface Imported {
    id: string;
    data: string;
    width: number;
    height: number;
    name: string;
    // The original layered file (PSD), kept for editing in Photo.
    source?: string;
}

export async function readImage(file: File): Promise<Imported | null> {
    if (!file.type.startsWith("image/") || isPhotoshopFile(file.name)) return null;
    try {
        const bitmap = await createImageBitmap(file);
        // Animated GIFs keep their bytes so the prototype player can play them.
        if (file.type === "image/gif" && Math.max(bitmap.width, bitmap.height) <= MAX_SIDE) {
            const width = bitmap.width;
            const height = bitmap.height;
            bitmap.close();
            const raw = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            return { id: nanoid(12), data: await storeDataUrl(raw), width, height, name: file.name.replace(/\.[^.]+$/, "") || "Image" };
        }
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        // WebP keeps transparency and stays small; browsers without WebP encoding fall back to PNG.
        const data = await storeDataUrl(canvas.toDataURL("image/webp", 0.92));
        return { id: nanoid(12), data, width, height, name: file.name.replace(/\.[^.]+$/, "") || "Image" };
    } catch {
        return null;
    }
}

// Adds image files as rectangles with image fills, centred on a world point and placed into the frame under it.
export async function placeImages(files: File[], at: { x: number; y: number }) {
    // Design, slides and campaign files, Sketch files and presentations open as files of their
    // own, after the rest is placed here (opening one switches files). They aren't images, so they
    // mustn't reach the image reader either (which replaced "Opened …" with "Those files aren't
    // images Nagma can open.").
    const own = files.filter(opensAsOwnFile);
    await placeHere(files.filter((f) => !opensAsOwnFile(f)), at);
    if (own.length) await importAsNewFiles(own);
}

const opensAsOwnFile = (f: File) => FIG_FAMILY.test(f.name) || SKETCH.test(f.name) || PPTX.test(f.name);

async function placeHere(files: File[], at: { x: number; y: number }) {
    if (!files.length) return;
    // SVG files become editable layers (engine/svg-import.ts).
    const svgs = files.filter((f) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name));
    if (svgs.length) {
        const { importSvgFile } = await import("./svg-import");
        for (const [i, file] of svgs.entries()) await importSvgFile(file, { x: at.x + i * 24, y: at.y + i * 24 });
        files = files.filter((f) => !svgs.includes(f));
        if (!files.length) return;
    }
    // PDFs become frames, one per page; InDesign (IDML) and DesignCraft files become pages of
    // editable layers. Each document starts below the one before.
    const cursor = { ...at };
    for (const file of files.filter((f) => isPdfFile(f) || isLayoutFile(f))) {
        try {
            const ids = isPdfFile(file) ? await placePdf(file, cursor) : await placeLayoutFile(file, cursor);
            const { nodes } = editor.get().doc;
            const bottom = Math.max(cursor.y, ...ids.map((id) => (nodes[id] ? nodes[id].y + nodes[id].h : cursor.y)));
            cursor.y = bottom + 160;
        } catch (error) {
            editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    files = files.filter((f) => !isPdfFile(f) && !isLayoutFile(f));
    // Videos are read by FilmCraft and placed as video fills.
    if (files.some((f) => isVideoFile(f))) {
        await placeVideos(files, at);
        files = files.filter((f) => !isVideoFile(f));
    }
    if (!files.length) return;
    const hasPsd = files.some((f) => isPhotoshopFile(f.name));
    if (hasPsd) editor.notify("Opening Photoshop file…");
    const images = (
        await Promise.all(
            files.map(async (file): Promise<Imported | null> => {
                if (!isPhotoshopFile(file.name)) return readImage(file);
                try {
                    const psd = await importPhotoshop(file);
                    return psd ? { id: nanoid(12), data: await storeDataUrl(psd.data), width: psd.width, height: psd.height, name: psd.name, source: await storeImage(psd.source) } : null;
                } catch (error) {
                    editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
                    return null;
                }
            }),
        )
    ).filter((item): item is Imported => item !== null);
    if (!images.length) {
        if (!hasPsd) editor.notify("Those files aren't images Nagma can open.");
        return;
    }
    const { doc } = editor.get();
    const parentId = frameAt(doc, at.x, at.y);
    const local = apply(spaceMatrix(doc, parentId).inverse(), at.x, at.y);
    const commands: Command[] = [];
    const created: string[] = [];
    let offset = 0;
    for (const image of images) {
        const node = makeNode(
            doc,
            "rect",
            { x: local.x - image.width / 2 + offset, y: local.y - image.height / 2 + offset, w: image.width, h: image.height },
            parentId,
            { name: image.name, fills: [{ ...imagePaint(image.id), ...(image.source ? { source: `${image.id}-source` } : {}) }] },
        );
        commands.push({ type: "image.add", id: image.id, data: image.data });
        if (image.source) commands.push({ type: "image.add", id: `${image.id}-source`, data: image.source });
        commands.push({ type: "node.create", node });
        created.push(node.id);
        offset += 24;
    }
    editor.execute({ type: "batch", commands });
    editor.set({ selection: created, tool: "move" });
}

// Import from Home (or with no file open): an imported file opens as a file of its own. A .fig
// opens as itself; each PDF becomes a Document (the PDF workbench) and each InDesign file a
// document of its layers; images, Photoshop files and videos together become one new design file.
export function pickImportFiles() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMPORT_ACCEPT;
    input.multiple = true;
    input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (files.length) void importAsNewFiles(files);
    };
    input.click();
}

// Everything Import opens: design, slides and campaign files, presentations, PDFs, page layouts,
// pictures and video. Each becomes a file of its own kind.
export const IMPORT_ACCEPT = ".fig,.deck,.buzz,.sketch,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,application/pdf,.idml,.designcraft,image/*,.svg,video/*,.mov,.mkv,.webm,.mxf,.psd,.psb";
const FIG_FAMILY = /\.(fig|deck|buzz)$/i;
const PPTX = /\.pptx$/i;
const SKETCH = /\.sketch$/i;

export async function importAsNewFiles(files: File[]) {
    const { createFile, openFile, createEmptyDocument, importFigFile, discardFile } = await import("./files");
    const { zoomToFit } = await import("./camera");
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
    for (const file of files.filter((f) => FIG_FAMILY.test(f.name))) {
        await importFigFile(file).catch((error) => editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`));
    }
    for (const file of files.filter((f) => SKETCH.test(f.name))) {
        try {
            const { importSketch } = await import("./sketch-import");
            const { doc, skipped } = await importSketch(file);
            await openFile(createFile("design", doc, doc.name).id);
            await settle();
            zoomToFit();
            editor.notify(skipped.length ? `Opened ${file.name}. Not carried over: ${skipped.join(", ")}.` : `Opened ${file.name}.`);
        } catch (error) {
            editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    for (const file of files.filter((f) => PPTX.test(f.name))) {
        const { importPptx } = await import("../slides/pptx");
        await importPptx(file).catch((error) => editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`));
    }
    for (const file of files.filter((f) => isPdfFile(f))) {
        const { documentFromFile } = await import("../document/new-document");
        await documentFromFile(file).catch((error) => editor.notify(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`));
    }
    // A file that turns out to have nothing Nagma could read in it (an empty, corrupt or
    // unsupported file) is discarded again, so a failed import doesn't leave an empty file behind.
    const keepIfFilled = (id: string) => {
        const { doc } = editor.get();
        if (editor.get().fileId === id && !Object.values(doc.nodes).some((n) => n.type !== "page")) discardFile(id);
    };
    for (const file of files.filter((f) => isLayoutFile(f))) {
        const name = file.name.replace(/\.[^.]+$/, "") || "Untitled document";
        const meta = createFile("docs", createEmptyDocument(name), name);
        await openFile(meta.id);
        await settle();
        await placeImages([file], { x: 0, y: 0 });
        editor.set({ selection: [] });
        zoomToFit();
        keepIfFilled(meta.id);
    }
    const rest = files.filter((f) => !FIG_FAMILY.test(f.name) && !SKETCH.test(f.name) && !PPTX.test(f.name) && !isPdfFile(f) && !isLayoutFile(f));
    if (rest.length) {
        const name = rest.length === 1 ? rest[0]?.name.replace(/\.[^.]+$/, "") || "Untitled" : "Untitled";
        const meta = createFile("design", createEmptyDocument(name), name);
        await openFile(meta.id);
        await settle();
        await placeImages(rest, { x: 0, y: 0 });
        editor.set({ selection: [] });
        zoomToFit();
        keepIfFilled(meta.id);
    }
}

// Opens the system file picker for images and other files to place.
export function pickImages(at: () => { x: number; y: number }) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.svg,video/*,.psd,.psb,.pdf,application/pdf,.idml,.designcraft,.fig,.mov,.mkv,.webm,.mxf";
    input.multiple = true;
    input.onchange = async () => {
        const files = Array.from(input.files ?? []);
        if (!files.length) return;
        // In the editor, images and videos wait at the cursor to be placed (engine/place.ts);
        // documents (PDF, InDesign, .fig design files, PSD) open straight away.
        if (!editor.get().homeOpen) {
            const { beginPlace, isPlaceable } = await import("./place");
            const placeable = files.filter(isPlaceable);
            const rest = files.filter((f) => !isPlaceable(f));
            if (rest.length) void placeImages(rest, at());
            if (placeable.length) void beginPlace(placeable);
            return;
        }
        void placeImages(files, at());
    };
    input.click();
}
