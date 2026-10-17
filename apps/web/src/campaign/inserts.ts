import { nanoid } from "nanoid";
import { storeDataUrl, storeImage } from "../engine/image-store";
import { makeNode } from "../engine/nodes";
import { imagePaint, solid } from "../engine/paint";
import { makeShape, type ShapeKind } from "../engine/shapes";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { assetData, assetOf, brandOf, fieldValuePatch, firstAsset, layerData } from "./model";
import { campaign } from "./state";

// What the rail's Text, Media and Inserts panels put on the asset on show: text boxes, pictures,
// shapes, logos and small ready-made objects. New layers land in the middle of the asset, taken out
// of its auto layout so they sit where they're put, and come out selected.

// The asset new layers go into: the one on show, else the selection's, else the first.
export function targetAsset(): SceneNode | null {
    const s = editor.get();
    const current = campaign.get().current;
    return (current ? s.doc.nodes[current] : null) ?? assetOf(s.doc, s.selection[0]) ?? firstAsset(s.doc);
}

// Puts layers made at the origin into the middle of the target asset. `make` gets the asset and
// a scratch document to name layers in; the first layer it returns is the top one.
export function insertLayers(make: (asset: SceneNode, scratch: NagmaDocument) => SceneNode[], extra: Command[] = []): string | null {
    const asset = targetAsset();
    if (!asset) {
        editor.notify("Add an asset first.");
        return null;
    }
    const doc = editor.get().doc;
    const scratch: NagmaDocument = { ...doc, nodes: { ...doc.nodes } };
    const nodes = make(asset, scratch);
    const root = nodes[0];
    if (!root) return null;
    // The top layer's box decides the offset; its own layers move with it.
    const dx = Math.round(asset.x + (asset.w - root.w) / 2 - root.x);
    const dy = Math.round(asset.y + (asset.h - root.h) / 2 - root.y);
    const placed = nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy, ...(n.id === root.id ? { parentId: asset.id, positioning: asset.layout ? ("absolute" as const) : n.positioning } : {}) }));
    editor.execute({ type: "batch", commands: [...extra, ...placed.map((node) => ({ type: "node.create" as const, node: { ...node, children: [] } }))] });
    editor.set({ selection: [root.id], editingTextId: null });
    return root.id;
}

// Type scales with the asset so a heading reads the same on a banner and on a poster.
function scaleFor(asset: SceneNode) {
    return Math.max(0.25, Math.min(asset.w, asset.h) / 1080);
}

export interface TextPreset {
    id: string;
    label: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
}

// The Text panel's four styles: a title, a headline, a subheadline and body text. The brand kit's
// own text styles stand in for them (its first for the title, its last for body text, middle ones
// for the headline and subheadline).
export function textPresets(doc: NagmaDocument): TextPreset[] {
    const brand = brandOf(doc).texts.map((t, i) => ({ id: `brand-${i}`, label: t.name, fontFamily: t.fontFamily, fontSize: t.fontSize, fontWeight: t.fontWeight }));
    const base: TextPreset[] = [
        { id: "title", label: "Title", fontFamily: "Inter", fontSize: 72, fontWeight: 700 },
        { id: "headline", label: "Headline", fontFamily: "Inter", fontSize: 44, fontWeight: 700 },
        { id: "subheadline", label: "Subheadline", fontFamily: "Inter", fontSize: 32, fontWeight: 600 },
        { id: "body", label: "Body text", fontFamily: "Inter", fontSize: 22, fontWeight: 400 },
    ];
    const out = base.map((b) => ({ ...b }));
    const pick = (i: number, from: TextPreset | undefined) => {
        const slot = out[i];
        if (from && slot) out[i] = { ...from, id: slot.id, label: slot.label };
    };
    pick(0, brand[0]);
    if (brand.length > 1) pick(3, brand[brand.length - 1]);
    if (brand.length > 2) pick(1, brand[1]);
    if (brand.length > 3) pick(2, brand[2]);
    return out;
}

export function addText(preset?: TextPreset) {
    insertLayers((asset, scratch) => {
        const k = scaleFor(asset);
        const size = Math.round((preset?.fontSize ?? 40) * k);
        const ink = brandOf(scratch).colors[0]?.color ?? "#14151A";
        const text = preset?.label ?? "Add your text";
        return [makeNode(scratch, "text", { x: 0, y: 0, w: Math.round(text.length * size * 0.55), h: Math.round(size * 1.2) }, asset.id, { name: text, text, fontFamily: preset?.fontFamily ?? "Inter", fontSize: size, fontWeight: preset?.fontWeight ?? 400, fills: [solid(ink)] })];
    });
}

export interface FontPair {
    id: string;
    heading: string;
    body: string;
    headingWeight: number;
    // The panel's sample: a heading (and a line under it) set the way the pair is meant to be used.
    sample: string;
    sub?: string;
    color: string;
    italic?: boolean;
    upper?: boolean;
    // The heading's size in the sample tile, in pixels, and the line under it (small caps by default).
    size: number;
    subSize?: number;
    subWeight?: number;
    subUpper?: boolean;
}

export const FONT_PAIRS: FontPair[] = [
    { id: "birthday", heading: "Playfair Display", body: "Montserrat", headingWeight: 700, sample: "Happy", sub: "Birthday", color: "#E8A355", italic: true, upper: true, size: 17, subSize: 17, subWeight: 500, subUpper: true },
    { id: "yard-sale", heading: "Lobster", body: "Inter", headingWeight: 400, sample: "Yard Sale", sub: "Books, vintage clothing, records, furniture and more", color: "#5FBF6A", size: 21, subSize: 4.5, subWeight: 600, subUpper: true },
    { id: "record", heading: "Anton", body: "Space Grotesk", headingWeight: 400, sample: "Record", color: "#A83BD9", upper: true, size: 23 },
    { id: "museum", heading: "Archivo", body: "Archivo", headingWeight: 700, sample: "Theodore Wores", sub: "In the collection of Franklin Museum of Arts", color: "#D9D05A", upper: true, size: 15, subSize: 5, subWeight: 600, subUpper: true },
    { id: "meme", heading: "Oswald", body: "Oswald", headingWeight: 700, sample: "Your meme", color: "#FFFFFF", upper: true, size: 23 },
    { id: "nature", heading: "Bebas Neue", body: "Karla", headingWeight: 400, sample: "Step into nature", sub: "Trails open all season", color: "#2F8F4E", size: 20, subSize: 5, subWeight: 600, subUpper: true },
    { id: "boom", heading: "Lobster", body: "Rubik", headingWeight: 400, sample: "Boom!", color: "#E53935", italic: true, size: 24 },
    { id: "hiring", heading: "Libre Baskerville", body: "Inter", headingWeight: 400, sample: "Now Hiring", sub: "Apply Now", color: "#B79CF0", size: 15, subSize: 14 },
    { id: "socialize", heading: "Pacifico", body: "Source Sans 3", headingWeight: 400, sample: "Socialize", sub: "with good company", color: "#8FC7F2", size: 20 },
    { id: "soon", heading: "Anton", body: "Inter", headingWeight: 400, sample: "Coming soon", sub: "website.com", color: "#E53935", upper: true, size: 20 },
    { id: "serif-sans", heading: "Source Serif 4", body: "Source Sans 3", headingWeight: 700, sample: "Editorial", sub: "A classic pairing", color: "#F2F2F2", size: 20 },
    { id: "mono", heading: "DM Mono", body: "DM Sans", headingWeight: 500, sample: "Launch day", sub: "01.01", color: "#7EE0C2", size: 18 },
];

// A heading over a line of body text, grouped in a small vertical stack.
export function addFontPair(pair: FontPair) {
    insertLayers((asset, scratch) => {
        const k = scaleFor(asset);
        const ink = brandOf(scratch).colors[0]?.color ?? "#14151A";
        const headSize = Math.round(64 * k);
        const bodySize = Math.round(28 * k);
        const w = Math.round(asset.w * 0.7);
        const stack = makeNode(scratch, "frame", { x: 0, y: 0, w, h: headSize * 1.2 + bodySize * 1.4 + 12 * k }, asset.id, {
            name: "Heading and body",
            fills: [],
            clip: false,
            layout: { direction: "vertical", gap: Math.round(12 * k), padding: [0, 0, 0, 0], primary: "start", counter: "start" },
            sizing: { h: "fixed", v: "hug" },
        });
        scratch.nodes[stack.id] = stack;
        const head = makeNode(scratch, "text", { x: 0, y: 0, w, h: headSize * 1.2 }, stack.id, { name: "Heading", text: pair.upper ? pair.sample.toUpperCase() : pair.sample, italic: pair.italic ?? false, fontFamily: pair.heading, fontSize: headSize, fontWeight: pair.headingWeight, lineHeight: 1.1, fills: [solid(ink)], sizing: { h: "fill", v: "hug" } });
        const body = makeNode(scratch, "text", { x: 0, y: headSize * 1.2, w, h: bodySize * 1.4 }, stack.id, { name: "Body", text: pair.sub ? (pair.subUpper ? pair.sub.toUpperCase() : pair.sub) : "A line of supporting text goes here.", fontFamily: pair.body, fontSize: bodySize, fontWeight: pair.subWeight ?? 400, lineHeight: 1.35, fills: [solid(ink, 0.8)], sizing: { h: "fill", v: "hug" } });
        stack.children = [head.id, body.id];
        return [stack, head, body];
    });
}

// A picture: into the selected image field when one is selected, else as a new layer.
export async function addImageData(data: string, name = "Image", size?: { w: number; h: number }) {
    const s = editor.get();
    const selected = s.doc.nodes[s.selection[0] ?? ""];
    const field = layerData(selected);
    const id = nanoid(12);
    if (selected && field?.type === "image" && !field.locks.content) {
        const patch = fieldValuePatch(selected, "image", id);
        editor.execute({ type: "batch", commands: [{ type: "image.add", id, data }, ...(patch ? [{ type: "node.update" as const, id: selected.id, patch }] : [])] });
        return;
    }
    insertLayers(
        (asset, scratch) => {
            const box = size ?? { w: 4, h: 3 };
            const k = Math.min((asset.w * 0.6) / box.w, (asset.h * 0.6) / box.h);
            return [makeNode(scratch, "rect", { x: 0, y: 0, w: Math.round(box.w * k), h: Math.round(box.h * k) }, asset.id, { name, fills: [imagePaint(id, "fill")] })];
        },
        [{ type: "image.add", id, data }],
    );
}

export async function addImageFile(file: File) {
    const data = await storeImage(file);
    const size = await new Promise<{ w: number; h: number } | undefined>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(undefined);
        img.src = URL.createObjectURL(file);
    });
    await addImageData(data, file.name.replace(/\.[^.]+$/, ""), size);
}

export function pickFiles(accept: string, onFiles: (files: File[]) => void, multiple = false) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => onFiles([...(input.files ?? [])]);
    input.click();
}

// ---- Made pictures: soft gradients and shapes from a palette, drawn here so nothing is fetched ----

export interface MadePicture {
    id: string;
    name: string;
    w: number;
    h: number;
    colors: string[];
    kind: "hills" | "sun" | "waves" | "blobs" | "grid" | "rings";
}

const SWATCHES = [
    ["#9FC6F5", "#F7D9C4", "#2F5A94"],
    ["#FFD8A8", "#FF8A65", "#5D2E46"],
    ["#C3F0CA", "#5CC9A7", "#1D4D4F"],
    ["#E4D4F4", "#9F7AEA", "#2D1E4F"],
    ["#FFF3B0", "#F2C14E", "#B5651D"],
    ["#D7E3FC", "#5E81F4", "#14213D"],
    ["#FAD2E1", "#E26D9A", "#4A1942"],
    ["#E0F7FA", "#26C6DA", "#004D57"],
];
const KINDS: MadePicture["kind"][] = ["hills", "sun", "waves", "blobs", "grid", "rings"];
const SHAPES = [
    [4, 5],
    [1, 1],
    [4, 3],
    [3, 4],
    [16, 9],
    [2, 3],
];

export const MADE_PICTURES: MadePicture[] = Array.from({ length: 16 }, (_, i) => {
    const colors = SWATCHES[i % SWATCHES.length] as string[];
    const kind = KINDS[(i * 5) % KINDS.length] as MadePicture["kind"];
    const [w, h] = SHAPES[(i * 7) % SHAPES.length] as [number, number];
    return { id: `made-${i}`, name: `${kind} ${i + 1}`, w: w * 120, h: h * 120, colors, kind };
});

export function drawPicture(p: MadePicture, scale = 1): string {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(p.w * scale);
    canvas.height = Math.round(p.h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const { width: w, height: h } = canvas;
    const [a = "#ddd", b = "#bbb", c = "#333"] = p.colors;
    const bg = ctx.createLinearGradient(0, 0, w * 0.3, h);
    bg.addColorStop(0, a);
    bg.addColorStop(1, b);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h);
    ctx.fillStyle = c;
    if (p.kind === "hills" || p.kind === "waves") {
        for (let layer = 0; layer < 3; layer++) {
            ctx.globalAlpha = 0.35 + layer * 0.25;
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let x = 0; x <= w; x += 8) ctx.lineTo(x, h * (0.55 + layer * 0.13) - Math.sin(x / (w / (p.kind === "waves" ? 6 : 2.5)) + layer * 1.7) * h * 0.06);
            ctx.lineTo(w, h);
            ctx.fill();
        }
    } else if (p.kind === "sun") {
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(w * 0.62, h * 0.42, m * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.fillRect(0, h * 0.72, w, h * 0.28);
    } else if (p.kind === "blobs") {
        for (let i = 0; i < 4; i++) {
            ctx.globalAlpha = 0.25 + i * 0.15;
            ctx.beginPath();
            ctx.ellipse(w * (0.2 + i * 0.2), h * (0.3 + ((i * 37) % 50) / 100), m * 0.22, m * 0.16, i, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (p.kind === "grid") {
        ctx.globalAlpha = 0.5;
        const step = m / 6;
        for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step) ctx.fillRect(x - step * 0.18, y - step * 0.18, step * 0.36, step * 0.36);
    } else {
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = m * 0.04;
        ctx.strokeStyle = c;
        for (let r = m * 0.1; r < m * 0.7; r += m * 0.12) {
            ctx.beginPath();
            ctx.arc(w * 0.5, h * 0.5, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
    return canvas.toDataURL("image/png");
}

export async function addMadePicture(p: MadePicture) {
    const data = await storeDataUrl(drawPicture(p, 2));
    await addImageData(data, `Picture ${p.name}`, { w: p.w, h: p.h });
}

// "Make an image": a new picture from the brand kit's colours.
export async function makeBrandPicture() {
    const doc = editor.get().doc;
    const colors = brandOf(doc).colors.map((c) => c.color);
    const pick = (i: number) => colors[Math.floor(Math.random() * colors.length + i) % Math.max(1, colors.length)] ?? "#888888";
    const kind = KINDS[Math.floor(Math.random() * KINDS.length)] as MadePicture["kind"];
    const asset = targetAsset();
    const p: MadePicture = { id: nanoid(6), name: kind, w: asset ? Math.round(asset.w / 2) : 600, h: asset ? Math.round(asset.h / 2) : 600, colors: [pick(0), pick(1), pick(2)], kind };
    await addMadePicture(p);
}

// ---- Shapes and objects ----

export type InsertShape = "rect" | "rounded" | "ellipse" | ShapeKind;

export function addShape(kind: InsertShape) {
    insertLayers((asset, scratch) => {
        const k = scaleFor(asset);
        const size = Math.round(240 * k);
        const color = brandOf(scratch).colors[2]?.color ?? "#4F46E5";
        if (kind === "rect" || kind === "rounded") return [makeNode(scratch, "rect", { x: 0, y: 0, w: size, h: size }, asset.id, { name: kind === "rounded" ? "Rounded rectangle" : "Rectangle", radius: kind === "rounded" ? Math.round(32 * k) : 0, fills: [solid(color)] })];
        if (kind === "ellipse") return [makeNode(scratch, "ellipse", { x: 0, y: 0, w: size, h: size }, asset.id, { name: "Ellipse", fills: [solid(color)] })];
        const shape = makeShape(scratch, kind, { x: 0, y: kind === "line" || kind === "arrow" ? size / 2 : 0 }, { x: size, y: kind === "line" || kind === "arrow" ? size / 2 : size }, asset.id);
        return [kind === "line" || kind === "arrow" ? { ...shape, strokes: [solid(color)], strokeWidth: Math.max(2, Math.round(6 * k)) } : { ...shape, fills: [solid(color)] }];
    });
}

export type InsertObject = "button" | "badge" | "rating" | "quote" | "divider" | "avatar";

export function addObject(kind: InsertObject) {
    insertLayers((asset, scratch) => {
        const k = scaleFor(asset);
        const brand = brandOf(scratch);
        const ink = brand.colors[0]?.color ?? "#14151A";
        const paper = brand.colors[1]?.color ?? "#FFFFFF";
        const primary = brand.colors[2]?.color ?? "#4F46E5";
        const accent = brand.colors[5]?.color ?? brand.colors[3]?.color ?? "#F7C948";
        const font = brand.texts[1]?.fontFamily ?? "Inter";
        if (kind === "divider") return [makeNode(scratch, "rect", { x: 0, y: 0, w: Math.round(asset.w * 0.6), h: Math.max(2, Math.round(4 * k)) }, asset.id, { name: "Divider", fills: [solid(ink, 0.2)] })];
        if (kind === "avatar") return [makeNode(scratch, "ellipse", { x: 0, y: 0, w: Math.round(120 * k), h: Math.round(120 * k) }, asset.id, { name: "Avatar", fills: [solid(accent)], strokes: [solid(paper)], strokeWidth: Math.max(2, Math.round(6 * k)) })];
        if (kind === "rating") {
            const size = Math.round(56 * k);
            const row = makeNode(scratch, "frame", { x: 0, y: 0, w: size * 5 + 8 * k * 4, h: size }, asset.id, { name: "Rating", fills: [], clip: false, layout: { direction: "horizontal", gap: Math.round(8 * k), padding: [0, 0, 0, 0], primary: "start", counter: "center" }, sizing: { h: "hug", v: "hug" } });
            scratch.nodes[row.id] = row;
            const stars = Array.from({ length: 5 }, (_, i) => {
                const star = makeShape(scratch, "star", { x: i * size, y: 0 }, { x: i * size + size, y: size }, row.id);
                scratch.nodes[star.id] = star;
                return { ...star, name: `Star ${i + 1}`, fills: [solid(accent)] };
            });
            row.children = stars.map((s) => s.id);
            return [row, ...stars];
        }
        const isButton = kind === "button";
        const isQuote = kind === "quote";
        const box = makeNode(scratch, "frame", { x: 0, y: 0, w: Math.round((isQuote ? 600 : 260) * k), h: Math.round(80 * k) }, asset.id, {
            name: isButton ? "Button" : isQuote ? "Quote card" : "Badge",
            fills: [solid(isButton ? primary : isQuote ? paper : accent)],
            radius: isButton ? 999 : Math.round((isQuote ? 28 : 12) * k),
            layout: { direction: "horizontal", gap: 8, padding: isQuote ? [Math.round(40 * k), Math.round(48 * k), Math.round(40 * k), Math.round(48 * k)] : [Math.round(18 * k), Math.round(36 * k), Math.round(18 * k), Math.round(36 * k)], primary: "center", counter: "center" },
            sizing: { h: isQuote ? "fixed" : "hug", v: "hug" },
        });
        scratch.nodes[box.id] = box;
        const label = makeNode(scratch, "text", { x: 0, y: 0, w: 100, h: 30 }, box.id, {
            name: isButton ? "Button label" : isQuote ? "Quote" : "Badge label",
            text: isButton ? "Shop now" : isQuote ? "“The best thing we did all year.”" : "New",
            fontFamily: font,
            fontSize: Math.round((isQuote ? 40 : 28) * k),
            fontWeight: isQuote ? 500 : 700,
            lineHeight: 1.25,
            fills: [solid(isButton ? paper : ink)],
            ...(isQuote ? { sizing: { h: "fill" as const, v: "hug" as const } } : {}),
        });
        box.children = [label.id];
        return [box, label];
    });
}

// A brand logo from the kit, as an image layer.
export function addLogo(imageId: string, name: string) {
    insertLayers((asset, scratch) => {
        const w = Math.round(Math.min(asset.w, asset.h) * 0.3);
        return [makeNode(scratch, "rect", { x: 0, y: 0, w, h: Math.round(w / 2) }, asset.id, { name, fills: [imagePaint(imageId, "fit")] })];
    });
}

// Is this layer the root of an asset (so the toolbar shows the asset's controls)?
export const isAssetNode = (node: SceneNode | undefined) => Boolean(assetData(node));
