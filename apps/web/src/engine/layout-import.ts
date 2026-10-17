import {
    type LayoutBox,
    type LayoutDocument,
    type LayoutFill,
    type LayoutItem,
    type LayoutPage,
    type LayoutParagraph,
    type LayoutSubpath,
    type Point,
    isLayoutFile,
    loadLayoutEngine,
} from "../engines/layout-engine";
import { readImage } from "./images";
import { makeNode } from "./nodes";
import { activePage } from "./page";
import { imagePaint, solid } from "./paint";
import { editor } from "./store";
import { ensureFont } from "./text";
import type { BlendMode, Command, NagmaDocument, NodeType, Paint, PathPoint, SceneNode, Subpath } from "./types";

// Pages sit side by side with this gap, wrapping after a few.
const GAP = 80;
const PER_ROW = 6;

const BLENDS = new Set<BlendMode>([
    "normal",
    "darken",
    "multiply",
    "color-burn",
    "lighten",
    "screen",
    "color-dodge",
    "overlay",
    "soft-light",
    "hard-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
]);

function blendOf(name: string | null): BlendMode {
    const kebab = (name ?? "normal").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) as BlendMode;
    return BLENDS.has(kebab) ? kebab : "normal";
}

const round = (v: number) => Math.round(v * 100) / 100;

// A point in a layer's own unrotated space, from page space (layers rotate around their centre).
function unrotate(p: Point, box: { x: number; y: number; w: number; h: number; rotation: number }): Point {
    if (!box.rotation) return p;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const a = (-box.rotation * Math.PI) / 180;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

// Places `child` (page space) inside a possibly rotated frame: frame children live in the frame's
// unrotated space.
function intoFrame(child: LayoutBox, frame: LayoutBox | null): LayoutBox {
    if (!frame?.rotation) return child;
    const [cx, cy] = unrotate([child.x + child.w / 2, child.y + child.h / 2], frame);
    return { x: cx - child.w / 2, y: cy - child.h / 2, w: child.w, h: child.h, rotation: child.rotation - frame.rotation };
}

interface Builder {
    doc: NagmaDocument;
    commands: Command[];
    // Image ids by DesignCraft asset id.
    images: Map<string, string>;
    families: Set<string>;
    // Offset from page space to the parent's space.
    dx: number;
    dy: number;
}

function paintOf(fill: LayoutFill | undefined, box: { x: number; y: number; w: number; h: number; rotation: number }): Paint[] {
    if (!fill) return [];
    if (fill.type === "solid") return [solid(fill.color)];
    const norm = (p: Point) => {
        const [x, y] = unrotate(p, box);
        return { x: round((x - box.x) / Math.max(box.w, 1e-6)), y: round((y - box.y) / Math.max(box.h, 1e-6)) };
    };
    return [
        {
            type: fill.type,
            stops: fill.stops.map((s) => ({ position: s.position, color: s.color, opacity: s.opacity })),
            from: norm(fill.from),
            to: norm(fill.to),
            opacity: 1,
            visible: true,
            blend: "normal",
        },
    ];
}

function vectorPath(subpaths: LayoutSubpath[]): { box: { x: number; y: number; w: number; h: number }; path: SceneNode["path"] } | null {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const sp of subpaths)
        for (const pt of sp.points)
            for (const p of [pt.p, pt.in, pt.out]) {
                if (!p) continue;
                xs.push(p[0]);
                ys.push(p[1]);
            }
    if (!xs.length) return null;
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(Math.max(...xs) - x, 0.01);
    const h = Math.max(Math.max(...ys) - y, 0.01);
    const at = (p: Point) => ({ x: round(p[0] - x), y: round(p[1] - y) });
    const converted: Subpath[] = subpaths.map((sp) => ({
        closed: sp.closed,
        points: sp.points.map((pt): PathPoint => ({ ...at(pt.p), in: pt.in ? at(pt.in) : null, out: pt.out ? at(pt.out) : null })),
    }));
    return { box: { x, y, w, h }, path: { w, h, subpaths: converted } };
}

function create(b: Builder, type: NodeType, box: { x: number; y: number; w: number; h: number; rotation?: number }, parentId: string, extra: Partial<SceneNode>): SceneNode {
    const node = makeNode(b.doc, type, { x: 0, y: 0, w: 1, h: 1 }, parentId, {
        x: round(box.x + b.dx),
        y: round(box.y + b.dy),
        w: Math.max(round(box.w), 0.01),
        h: Math.max(round(box.h), 0.01),
        rotation: round(box.rotation ?? 0),
        ...extra,
    });
    b.commands.push({ type: "node.create", node });
    return node;
}

// Looks after the parts every layer has: opacity, blending, shadow.
function common(item: LayoutItem, fallback: string): Partial<SceneNode> {
    return {
        name: item.name || fallback,
        opacity: item.opacity,
        blendMode: blendOf(item.blend),
        shadow: item.shadow ? { ...item.shadow } : null,
    };
}

function strokeOf(item: LayoutItem): Partial<SceneNode> {
    if (!item.stroke) return { strokes: [] };
    return { strokes: [solid(item.stroke.color)], strokeWidth: item.stroke.weight, strokeAlign: item.stroke.align };
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function paragraph(b: Builder, p: LayoutParagraph, parentId: string) {
    if (!p.box) return;
    b.families.add(p.family);
    // The lines are already broken where DesignCraft broke them, so text never needs to wrap:
    // left-aligned text sizes to its content; centred and right-aligned text keeps its edge and
    // gets room to grow, since browser fonts can set a little wider.
    const room = p.box.w * 0.25;
    const box =
        p.align === "center" ? { ...p.box, x: p.box.x - room / 2, w: p.box.w + room } : p.align === "right" ? { ...p.box, x: p.box.x - room, w: p.box.w + room } : p.box;
    create(b, "text", box, parentId, {
        name: p.text.replace(/\s+/g, " ").slice(0, 40),
        text: p.text,
        fontFamily: p.family,
        fontSize: p.size,
        fontWeight: WEIGHTS.reduce((best, w) => (Math.abs(w - p.weight) < Math.abs(best - p.weight) ? w : best), 400),
        italic: p.italic,
        lineHeight: p.lineHeight,
        textAlign: p.align,
        decoration: p.underline ? "underline" : p.strikethrough ? "strikethrough" : "none",
        fills: [solid(p.color)],
        sizing: { h: p.align === "left" ? "hug" : "fixed", v: "hug" },
    });
}

// One DesignCraft item as Nagma layers under `parentId` (which lives in page space plus dx/dy).
function convert(b: Builder, item: LayoutItem, parentId: string) {
    if (item.kind === "group") {
        const group = create(b, "group", { ...item.bounds }, parentId, { ...common(item, "Group"), fills: [] });
        for (const child of item.children ?? []) convert(b, child, group.id);
        return;
    }
    if (item.kind === "clip") {
        // A frame with items pasted inside: a clipping frame at its bounds.
        const box = item.box && !item.box.rotation ? item.box : { ...item.bounds, rotation: 0 };
        const frame = create(b, "frame", box, parentId, { ...common(item, "Frame"), ...strokeOf(item), fills: paintOf(item.fill, box), clip: true });
        for (const child of item.children ?? []) convert(b, child, frame.id);
        return;
    }
    const text = item.text?.paragraphs ?? [];
    const decos = item.text?.decos ?? [];
    const cells = item.text?.cells ?? [];
    const rules = item.text?.rules ?? [];
    const hasLook = Boolean(item.fill || item.stroke || item.image);
    // Text frames with several paragraphs (or a background or a table) become a group.
    let textParent = parentId;
    if (text.length && (text.length > 1 || hasLook || decos.length || cells.length || rules.length)) {
        textParent = create(b, "group", { ...item.bounds }, parentId, { name: item.name || "Text frame", fills: [] }).id;
    }
    if (hasLook) shape(b, item, textParent);
    for (const d of decos) if (d.box) create(b, "rect", d.box, textParent, { name: "Shading", fills: [solid(d.color)] });
    for (const c of cells) if (c.box) create(b, "rect", c.box, textParent, { name: "Cell", fills: [solid(c.color)] });
    for (const r of rules) {
        const vector = vectorPath([{ closed: false, points: [{ p: r.a, in: null, out: null }, { p: r.b, in: null, out: null }] }]);
        if (vector) create(b, "vector", { ...vector.box, rotation: 0 }, textParent, { name: "Rule", path: vector.path, fills: [], strokes: [solid(r.color)], strokeWidth: r.weight, strokeAlign: "center" });
    }
    for (const p of text) paragraph(b, p, textParent);
}

// The item's own shape: rectangle, ellipse or vector, with its fill, stroke and placed image.
function shape(b: Builder, item: LayoutItem, parentId: string) {
    const base = common(item, item.image?.name || (item.kind === "ellipse" ? "Ellipse" : item.kind === "rect" ? "Rectangle" : "Vector"));
    const image = item.image ? b.images.get(item.image.asset) : undefined;
    const stroke = strokeOf(item);
    if ((item.kind === "rect" || item.kind === "ellipse") && item.box) {
        const fills = paintOf(item.fill, item.box);
        if (image && item.kind === "rect" && item.image?.box) {
            // An image frame: the frame crops the picture, placed where InDesign placed it.
            const frame = create(b, "frame", item.box, parentId, { ...base, ...stroke, fills, clip: true });
            create(b, "rect", intoFrame(item.image.box, item.box), frame.id, { name: item.image.name || "Image", fills: [imagePaint(image, "fill")] });
            return;
        }
        create(b, item.kind, item.box, parentId, { ...base, ...stroke, fills: image ? [...fills, imagePaint(image, "fill")] : fills });
        return;
    }
    const vector = vectorPath(item.path ?? []);
    if (!vector) return;
    const box = { ...vector.box, rotation: 0 };
    const fills = paintOf(item.fill, box);
    create(b, "vector", box, parentId, { ...base, ...stroke, path: vector.path, fills: image ? [...fills, imagePaint(image, "fill")] : fills });
}

// Adds the pictures a page uses (scaled down and re-encoded like any placed image).
async function addImages(b: Builder, layout: LayoutDocument, page: LayoutPage) {
    for (const asset of page.assets) {
        if (b.images.has(asset)) continue;
        try {
            const data = layout.asset(asset);
            const file = new File([data.bytes as BlobPart], `image.${data.mime.split("/")[1] ?? "png"}`, { type: data.mime });
            data.free();
            const image = await readImage(file);
            if (!image) continue;
            b.images.set(asset, image.id);
            b.commands.push({ type: "image.add", id: image.id, data: image.data });
        } catch {
            // A picture that can't be read leaves its frame empty.
        }
    }
}

// Turns every page of a layout document into a frame of editable layers, left to right from `at`.
export async function placeLayoutDocument(layout: LayoutDocument, at: { x: number; y: number }): Promise<string[]> {
    const { doc } = editor.get();
    const b: Builder = { doc, commands: [], images: new Map(), families: new Set(), dx: 0, dy: 0 };
    const created: string[] = [];
    let skipped = 0;
    let x = at.x;
    let y = at.y;
    let rowHeight = 0;
    const count = layout.pageCount();
    for (let i = 0; i < count; i++) {
        const page = JSON.parse(layout.page(i)) as LayoutPage;
        await addImages(b, layout, page);
        if (i > 0 && i % PER_ROW === 0) {
            x = at.x;
            y += rowHeight + GAP;
            rowHeight = 0;
        }
        b.dx = 0;
        b.dy = 0;
        const frame = create(b, "frame", { x, y, w: page.width, h: page.height }, activePage.id, {
            name: /^\d+$/.test(page.name) ? `Page ${page.name}` : page.name,
            fills: [solid(page.paper)],
            clip: true,
        });
        b.dx = x;
        b.dy = y;
        for (const item of page.items) convert(b, item, frame.id);
        created.push(frame.id);
        skipped += page.skipped;
        x += page.width + GAP;
        rowHeight = Math.max(rowHeight, page.height);
    }
    editor.execute({ type: "batch", commands: b.commands });
    editor.set({ selection: created, tool: "move" });
    for (const family of b.families) ensureFont(family, () => editor.refreshText());
    const extra = skipped ? ` ${skipped === 1 ? "1 object" : `${skipped} objects`} (tables, text on a path or media) ${skipped === 1 ? "wasn't" : "weren't"} converted.` : "";
    editor.notify(`Placed ${count} ${count === 1 ? "page" : "pages"} from ${layout.title() || "the document"} as editable layers.${extra}`);
    return created;
}

export async function placeLayoutFile(file: File, at: { x: number; y: number }): Promise<string[]> {
    if (!isLayoutFile(file)) return [];
    editor.notify("Opening layout file…");
    const engine = await loadLayoutEngine();
    const bytes = new Uint8Array(await file.arrayBuffer());
    // The engine's own parse errors name the wrong format for a damaged .idml (it tries an IDML
    // without the zip header as a DesignCraft file) and quote the parser; say what the file isn't.
    const idml = /\.idml$/i.test(file.name);
    const unreadable = new Error(idml ? "it isn't an InDesign (IDML) file, or it's damaged." : "it isn't a DesignCraft file, or it's damaged.");
    if (idml && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw unreadable;
    let layout: LayoutDocument;
    try {
        layout = new engine.LayoutDoc(bytes);
    } catch {
        throw unreadable;
    }
    try {
        return await placeLayoutDocument(layout, at);
    } finally {
        layout.free();
    }
}

// DesignCraft's sample magazine, for trying page layouts out.
export async function placeSampleMagazine(at: { x: number; y: number }): Promise<string[]> {
    editor.notify("Opening the sample magazine…");
    const engine = await loadLayoutEngine();
    const layout = engine.LayoutDoc.sample();
    try {
        return await placeLayoutDocument(layout, at);
    } finally {
        layout.free();
    }
}
