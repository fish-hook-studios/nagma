import { isPhotoshopFile } from "../engines/photo-engine";
import { isVideoFile } from "../engines/video-engine";
import { readImage } from "./images";
import { frameAt, makeNode } from "./nodes";
import { imagePaint } from "./paint";
import { editor } from "./store";
import { apply, spaceMatrix } from "./transform";
import type { Command, SceneNode } from "./types";
import { type PlaceItem, vectorUi } from "./vector-ui";
import { placeVideos } from "./video";

// Place image/video (⇧⌘K): the picked files wait at the cursor (a badge with the next
// one's thumbnail and how many are left). Click to place the next at its natural size, drag to
// size it, click a shape to make it the shape's fill, or Place all to lay them out in a grid.

type Prepared = NonNullable<Awaited<ReturnType<typeof readImage>>>;
const prepared = new WeakMap<File, Prepared>();

async function thumbnail(file: File): Promise<string | null> {
    try {
        const bitmap = await createImageBitmap(file);
        const k = 72 / Math.max(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * k));
        canvas.height = Math.max(1, Math.round(bitmap.height * k));
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return canvas.toDataURL("image/png");
    } catch {
        return null;
    }
}

export function isPlaceable(file: File): boolean {
    // SVGs import as editable layers instead.
    const svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
    return (file.type.startsWith("image/") && !svg && !isPhotoshopFile(file.name)) || isVideoFile(file);
}

// Queues files for placing. Images are read up front so a click places them at once.
export async function beginPlace(files: File[]) {
    const items: PlaceItem[] = [];
    for (const file of files) {
        if (!isVideoFile(file)) {
            const image = await readImage(file);
            if (!image) continue;
            prepared.set(file, image);
        }
        items.push({ file, thumb: isVideoFile(file) ? null : await thumbnail(file) });
    }
    if (!items.length) {
        editor.notify("Those files aren't images or videos Nagma can place.");
        return;
    }
    editor.set({ tool: "move", editingVectorId: null });
    vectorUi.set({ place: [...vectorUi.get().place, ...items] });
}

export function cancelPlace() {
    if (vectorUi.get().place.length) vectorUi.set({ place: [] });
}

function next(): PlaceItem | null {
    return vectorUi.get().place[0] ?? null;
}

function shift() {
    vectorUi.set({ place: vectorUi.get().place.slice(1) });
}

// The next item's natural size (videos are sized once FilmCraft has read them).
export function nextSize(): { w: number; h: number } | null {
    const item = next();
    const image = item ? prepared.get(item.file) : undefined;
    return image ? { w: image.width, h: image.height } : null;
}

function imageCommands(image: Prepared): Command[] {
    return [{ type: "image.add", id: image.id, data: image.data }];
}

// Places the next item with its top-left at a world point, at its natural size or in `box` (world).
export async function placeNext(at: { x: number; y: number }, box?: { x: number; y: number; w: number; h: number }) {
    const item = next();
    if (!item) return;
    shift();
    if (isVideoFile(item.file)) {
        const ids = await placeVideos([item.file], box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : at);
        if (ids.length) editor.set({ selection: ids });
        return;
    }
    const image = prepared.get(item.file);
    if (!image) return;
    const { doc } = editor.get();
    const target = box ?? { x: at.x, y: at.y, w: image.width, h: image.height };
    const parentId = frameAt(doc, target.x + target.w / 2, target.y + target.h / 2);
    const inv = spaceMatrix(doc, parentId).inverse();
    const local = apply(inv, target.x, target.y);
    const node = makeNode(doc, "rect", { x: local.x, y: local.y, w: target.w, h: target.h }, parentId, { name: image.name, fills: [imagePaint(image.id)] });
    editor.execute({ type: "batch", commands: [...imageCommands(image), { type: "node.create", node }] });
    editor.set({ selection: [node.id] });
}

// Makes the next image the fill of a shape (replacing its fills).
export function placeInto(node: SceneNode) {
    const item = next();
    const image = item ? prepared.get(item.file) : undefined;
    if (!item || !image) return false;
    shift();
    editor.execute({ type: "batch", commands: [...imageCommands(image), { type: "node.update", id: node.id, patch: { fills: [imagePaint(image.id)] } }] });
    editor.set({ selection: [node.id] });
    return true;
}

// Places everything left in a grid around a world point (images keep their proportions, the
// longest side at most 800).
export async function placeAll(center: { x: number; y: number }) {
    const items = vectorUi.get().place;
    if (!items.length) return;
    vectorUi.set({ place: [] });
    const images = items.map((it) => ({ it, image: prepared.get(it.file) })).filter((x) => x.image) as { it: PlaceItem; image: Prepared }[];
    const videos = items.filter((it) => isVideoFile(it.file));
    const sizes = images.map(({ image }) => {
        const k = Math.min(1, 800 / Math.max(image.width, image.height));
        return { w: Math.round(image.width * k), h: Math.round(image.height * k) };
    });
    const cols = Math.max(1, Math.ceil(Math.sqrt(images.length)));
    const gap = 40;
    const colW = Math.max(0, ...sizes.map((s) => s.w));
    const rows = Math.ceil(images.length / cols);
    const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...sizes.slice(r * cols, r * cols + cols).map((s) => s.h)));
    const totalW = cols * colW + (cols - 1) * gap;
    const totalH = rowH.reduce((a, b) => a + b, 0) + (rows - 1) * gap;
    const { doc } = editor.get();
    const commands: Command[] = [];
    const created: string[] = [];
    let y = center.y - totalH / 2;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const entry = images[i];
            const size = sizes[i];
            if (!entry || !size) continue;
            const x = center.x - totalW / 2 + c * (colW + gap) + (colW - size.w) / 2;
            const node = makeNode(doc, "rect", { x, y: y + ((rowH[r] ?? 0) - size.h) / 2, w: size.w, h: size.h }, editor.get().pageId, { name: entry.image.name, fills: [imagePaint(entry.image.id)] });
            commands.push(...imageCommands(entry.image), { type: "node.create", node });
            created.push(node.id);
        }
        y += (rowH[r] ?? 0) + gap;
    }
    if (commands.length) editor.execute({ type: "batch", commands });
    if (videos.length) created.push(...(await placeVideos(videos.map((v) => v.file), { x: center.x, y: center.y + totalH / 2 + 200 })));
    editor.set({ selection: created });
}
