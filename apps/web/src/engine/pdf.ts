import { nanoid } from "nanoid";
import { isPdfFile, loadPdfEngine, pageInfo, type PdfDocument } from "../engines/pdf-engine";
import { makeNode } from "./nodes";
import { activePage } from "./page";
import { imagePaint, solid } from "./paint";
import { buildPageLayers, type BuildContext } from "./pdf-import";
import { imageBytes, storeDataUrl, storeImage } from "./image-store";
import { editor } from "./store";
import type { Command, ImagePaint, NagmaDocument, Paint, SceneNode } from "./types";

// Page pictures are drawn at up to 2 pixels per point, capped like other images.
const MAX_SIDE = 4096;
const GAP = 40;

interface PageImage {
    id: string;
    data: string;
    width: number;
    height: number;
}

// Renders every page of an open PDF to a picture, sized in points like the page itself.
async function renderPages(doc: PdfDocument, progress?: (done: number, total: number) => void, maxScale = 2, only?: number[]): Promise<PageImage[]> {
    const info = pageInfo(doc);
    const canvas = document.createElement("canvas");
    const out: PageImage[] = [];
    for (let i = 0; i < info.length; i++) {
        if (only && !only.includes(i)) continue;
        const { width, height } = info[i];
        const scale = Math.min(maxScale, MAX_SIDE / Math.max(width, height, 1));
        const page = doc.render(i, scale);
        try {
            canvas.width = page.width;
            canvas.height = page.height;
            const rgba = page.rgba;
            canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), page.width, page.height), 0, 0);
        } finally {
            page.free();
        }
        out.push({ id: nanoid(12), data: await storeDataUrl(canvas.toDataURL("image/webp", 0.92)), width: Math.round(width), height: Math.round(height) });
        progress?.(i + 1, info.length);
        // Let the page repaint between pages so the progress shows.
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return out;
}

function pagePaint(image: PageImage, source: string, page: number, visible = true): ImagePaint {
    return { ...imagePaint(image.id), source, page, visible };
}

// An editable page keeps its picture as a hidden fill: it ties the frame to its PDF and page (for
// the page organizer) and is what "Flatten page to image" shows.
export function isEditablePage(node: SceneNode | undefined): boolean {
    const paint = pdfPaint(node);
    return Boolean(paint && !paint.visible);
}

// Page frame fills: the page's own background under the hidden page picture.
function editableFills(picture: ImagePaint, background: string | null): Paint[] {
    return [solid(background ?? "#FFFFFF"), { ...picture, visible: false }];
}

// Lays out page `page` of `pdf` as editable layers inside `frame` (its fills are set to match).
async function buildEditablePage(pdf: PdfDocument, page: number, frame: SceneNode, picture: ImagePaint, ctx: BuildContext): Promise<SceneNode> {
    const at = ctx.commands.length;
    let background: string | null = null;
    try {
        ({ background } = await buildPageLayers(pdf, page, frame, ctx));
    } catch (error) {
        // A page the extractor can't read stays a picture.
        ctx.commands.length = at;
        console.warn(`PDF page ${page + 1} kept as a picture:`, error);
        return { ...frame, fills: [{ ...picture, visible: true }] };
    }
    return { ...frame, fills: editableFills(picture, background) };
}

// The PDF a layer's fill comes from, if any.
export function pdfPaint(node: SceneNode | undefined): ImagePaint | null {
    for (const paint of node?.fills ?? []) if (paint.type === "image" && paint.page !== undefined && paint.source) return paint;
    return null;
}

// The frames showing pages of a PDF, in page order.
export function pdfFrames(doc: NagmaDocument, source: string): SceneNode[] {
    return Object.values(doc.nodes)
        .filter((n) => pdfPaint(n)?.source === source)
        .sort((a, b) => (pdfPaint(a)?.page ?? 0) - (pdfPaint(b)?.page ?? 0));
}

// Opens a PDF and lays its pages out as frames, left to right from `at`. Each page becomes
// editable layers (text, vectors, images); `flat` keeps one picture per page.
export async function placePdf(file: File, at: { x: number; y: number }, options: { flat?: boolean } = {}): Promise<string[]> {
    if (!isPdfFile(file)) return [];
    editor.notify(`Opening ${file.name}…`);
    const engine = await loadPdfEngine();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = new engine.PdfDoc(bytes);
    const flat = options.flat ?? false;
    try {
        // Editable pages keep a lighter picture: it is hidden unless the page is flattened.
        const pages = await renderPages(pdf, flat ? (done, total) => editor.notify(`Opening ${file.name}: page ${done} of ${total}…`) : undefined, flat ? 2 : 1);
        if (!pages.length) {
            editor.notify(`${file.name} has no pages.`);
            return [];
        }
        const { doc } = editor.get();
        const source = nanoid(12);
        const commands: Command[] = [{ type: "image.add", id: source, data: await storeImage(new Blob([bytes as BlobPart], { type: "application/pdf" })) }];
        const ctx: BuildContext = { doc, commands, added: new Set() };
        const created: string[] = [];
        let x = at.x;
        const y = at.y - pages[0].height / 2;
        for (const [i, image] of pages.entries()) {
            commands.push({ type: "image.add", id: image.id, data: image.data });
            const picture = pagePaint(image, source, i);
            let node = makeNode(doc, "frame", { x, y, w: image.width, h: image.height }, activePage.id, { name: `Page ${i + 1}`, fills: [picture] });
            const slot = commands.length;
            commands.push({ type: "node.create", node });
            if (!flat) {
                editor.notify(`Opening ${file.name}: page ${i + 1} of ${pages.length}…`);
                node = await buildEditablePage(pdf, i, node, picture, ctx);
                commands[slot] = { type: "node.create", node };
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            created.push(node.id);
            x += image.width + GAP;
        }
        editor.execute({ type: "batch", commands });
        editor.set({ selection: created, tool: "move" });
        editor.notify(`Placed ${pages.length} ${pages.length === 1 ? "page" : "pages"} from ${file.name}. Right-click a page to organize the PDF${flat ? "" : " or flatten a page to an image"}.`);
        return created;
    } finally {
        pdf.free();
    }
}

// After the PDF changed in the organizer: store the new file and make the page frames match it,
// updating pictures and sizes, removing frames of deleted pages and adding frames for new ones.
export async function syncPdf(source: string, pdf: PdfDocument, bytes: Uint8Array) {
    const { doc } = editor.get();
    const frames = pdfFrames(doc, source);
    const editable = frames.length === 0 || frames.some((f) => isEditablePage(f));
    const pages = await renderPages(pdf, undefined, editable ? 1 : 2);
    // Images never change once added (collaborators may still have the old one), so the new
    // file gets its own id and the frames point at it.
    const next = nanoid(12);
    const commands: Command[] = [{ type: "image.add", id: next, data: await storeImage(new Blob([bytes as BlobPart], { type: "application/pdf" })) }];
    const ctx: BuildContext = { doc, commands, added: new Set() };
    const last = frames[frames.length - 1];
    let x = last ? last.x + last.w + GAP : 0;
    const y = last?.y ?? 0;
    const parentId = last?.parentId ?? activePage.id;
    const created: string[] = [];
    for (const [i, image] of pages.entries()) {
        commands.push({ type: "image.add", id: image.id, data: image.data });
        const frame = frames[i];
        const picture = pagePaint(image, next, i);
        if (frame) {
            const name = /^Page \d+$/.test(frame.name) ? `Page ${i + 1}` : frame.name;
            if (isEditablePage(frame)) {
                // The page's layers are rebuilt from the organized PDF.
                if (frame.children.length) commands.push({ type: "node.delete", ids: [...frame.children] });
                const sized = { ...frame, w: image.width, h: image.height, name };
                const built = await buildEditablePage(pdf, i, sized, picture, ctx);
                commands.push({ type: "node.update", id: frame.id, patch: { fills: built.fills, w: image.width, h: image.height, name } });
            } else {
                const fills = frame.fills.map((p) => (p.type === "image" && p.source === source ? pagePaint(image, next, i, p.visible) : p));
                commands.push({ type: "node.update", id: frame.id, patch: { fills, w: image.width, h: image.height, name } });
            }
        } else {
            let node = makeNode(doc, "frame", { x, y, w: image.width, h: image.height }, parentId, { name: `Page ${i + 1}`, fills: [picture] });
            const slot = commands.length;
            commands.push({ type: "node.create", node });
            if (editable) {
                node = await buildEditablePage(pdf, i, node, picture, ctx);
                commands[slot] = { type: "node.create", node };
            }
            created.push(node.id);
            x += image.width + GAP;
        }
    }
    const removed = frames.slice(pages.length).map((f) => f.id);
    if (removed.length) commands.push({ type: "node.delete", ids: removed });
    editor.execute({ type: "batch", commands });
    if (created.length) editor.set({ selection: created });
}

async function openSource(source: string): Promise<PdfDocument | null> {
    const bytes = await imageBytes(editor.get().doc.images, source);
    if (!bytes) return null;
    const engine = await loadPdfEngine();
    return new engine.PdfDoc(bytes);
}

// Flatten page to image: the page frame shows the page as one picture again (its layers go).
export async function flattenPdfPage(nodeId: string) {
    const { doc } = editor.get();
    const frame = doc.nodes[nodeId];
    const paint = pdfPaint(frame);
    if (!frame || !paint?.source || paint.page === undefined) return;
    editor.notify(`Flattening ${frame.name}…`);
    const pdf = await openSource(paint.source);
    if (!pdf) {
        editor.notify("This PDF's data is missing from this browser and the server.");
        return;
    }
    try {
        const [image] = await renderPages(pdf, undefined, 2, [paint.page]);
        if (!image) return;
        const fills = frame.fills.filter((p) => p !== paint && p.type !== "solid");
        const commands: Command[] = [
            { type: "image.add", id: image.id, data: image.data },
            { type: "node.update", id: frame.id, patch: { fills: [...fills, { ...paint, id: image.id, visible: true }] } },
        ];
        if (frame.children.length) commands.push({ type: "node.delete", ids: [...frame.children] });
        editor.execute({ type: "batch", commands });
        editor.notify(`${frame.name} is now one image.`);
    } finally {
        pdf.free();
    }
}

// The opposite: a page shown as a picture becomes editable layers.
export async function makePdfPageEditable(nodeId: string) {
    const { doc } = editor.get();
    const frame = doc.nodes[nodeId];
    const paint = pdfPaint(frame);
    if (!frame || !paint?.source || paint.page === undefined) return;
    editor.notify(`Making ${frame.name} editable…`);
    const pdf = await openSource(paint.source);
    if (!pdf) {
        editor.notify("This PDF's data is missing from this browser and the server.");
        return;
    }
    try {
        const commands: Command[] = [];
        const ctx: BuildContext = { doc, commands, added: new Set() };
        const built = await buildEditablePage(pdf, paint.page, frame, paint, ctx);
        if (frame.children.length) commands.unshift({ type: "node.delete", ids: [...frame.children] });
        const others = frame.fills.filter((p) => p !== paint && p.type !== "solid");
        commands.push({ type: "node.update", id: frame.id, patch: { fills: [...others, ...built.fills] } });
        editor.execute({ type: "batch", commands });
        editor.notify(isEditablePage({ ...frame, fills: built.fills }) ? `${frame.name} is now editable layers.` : `Couldn't read the layers of ${frame.name}.`);
    } finally {
        pdf.free();
    }
}

export function openPdfEditor(nodeId?: string) {
    const s = editor.get();
    const node = s.doc.nodes[nodeId ?? s.selection[0] ?? ""];
    const paint = pdfPaint(node);
    if (!node || !paint?.source) {
        editor.notify("Select a PDF page to organize its document.");
        return;
    }
    if (s.readOnly) {
        editor.notify("This file is view only.");
        return;
    }
    editor.set({ pdfEdit: { source: paint.source, name: node.name } });
}
