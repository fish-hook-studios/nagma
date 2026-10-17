import { unzipSync, strFromU8 } from "fflate";
import { nanoid } from "nanoid";
import { makeNode } from "./nodes";
import { imagePaint, solid } from "./paint";
import type { NagmaDocument, NodeType, Paint, PathPoint, SceneNode } from "./types";

// .sketch files: a zip of JSON (document.json, pages/<id>.json) and pictures (images/…). Pages,
// artboards, groups, rectangles, ovals, paths and shape groups, text, bitmaps and symbol instances
// come over with their position, size, rotation, fills, borders, opacity, corner radius and
// visibility. Things without a counterpart (shared styles, symbol overrides, prototyping links)
// are listed as not carried over.

type SketchColor = { red: number; green: number; blue: number; alpha: number };
type SketchLayer = {
    _class: string;
    do_objectID?: string;
    name?: string;
    frame?: { x: number; y: number; width: number; height: number };
    rotation?: number;
    isVisible?: boolean;
    isLocked?: boolean;
    isFlippedHorizontal?: boolean;
    isFlippedVertical?: boolean;
    hasClippingMask?: boolean;
    layers?: SketchLayer[];
    style?: {
        fills?: { isEnabled: boolean; fillType: number; color?: SketchColor; image?: { _ref?: string } }[];
        borders?: { isEnabled: boolean; color?: SketchColor; thickness?: number; position?: number }[];
        contextSettings?: { opacity?: number };
        textStyle?: { encodedAttributes?: TextAttributes };
    };
    fixedRadius?: number;
    points?: { point: string; curveFrom: string; curveTo: string; hasCurveFrom: boolean; hasCurveTo: boolean; cornerRadius?: number }[];
    isClosed?: boolean;
    attributedString?: { string?: string; attributes?: { attributes?: TextAttributes }[] };
    image?: { _ref?: string };
    hasClickThrough?: boolean;
    symbolID?: string;
};
type TextAttributes = {
    MSAttributedStringFontAttribute?: { attributes?: { name?: string; size?: number } };
    MSAttributedStringColorAttribute?: SketchColor;
    paragraphStyle?: { alignment?: number };
};

const hex = (c?: SketchColor) => {
    if (!c) return { color: "#000000", opacity: 1 };
    const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    return { color: `#${h(c.red)}${h(c.green)}${h(c.blue)}`.toUpperCase(), opacity: c.alpha ?? 1 };
};
const pt = (s: string) => {
    const [x, y] = s.replace(/[{}\s]/g, "").split(",").map(Number);
    return { x: x ?? 0, y: y ?? 0 };
};

// The weight a PostScript font name suggests ("Inter-SemiBold" is 600).
function weightOf(name: string): number {
    const n = name.toLowerCase();
    return /thin|hairline/.test(n) ? 100 : /extralight|ultralight/.test(n) ? 200 : /light/.test(n) ? 300 : /medium/.test(n) ? 500 : /semibold|demibold/.test(n) ? 600 : /extrabold|ultrabold/.test(n) ? 800 : /black|heavy/.test(n) ? 900 : /bold/.test(n) ? 700 : 400;
}

export async function importSketch(file: File): Promise<{ doc: NagmaDocument; skipped: string[] }> {
    // A damaged file reports that, not the zip reader's or the JSON parser's own wording.
    const damaged = () => new Error("it isn't a .sketch file, or it's damaged.");
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch {
        throw damaged();
    }
    const json = (path: string) => {
        if (!entries[path]) return null;
        try {
            return JSON.parse(strFromU8(entries[path] as Uint8Array));
        } catch {
            throw damaged();
        }
    };
    const document = json("document.json") as { pages?: { _ref: string }[] } | null;
    if (!document) throw new Error("That isn't a .sketch file (no document.json inside).");
    const name = file.name.replace(/\.sketch$/i, "") || "Untitled";
    const doc: NagmaDocument = { name, nodes: {}, roots: [], images: {} };
    const skipped = new Set<string>();
    const imageIds = new Map<string, string>();

    // Pictures in the file, as data URLs (each stored once however often it's used).
    const imageFor = (ref?: string): string | null => {
        if (!ref) return null;
        const path = entries[ref] ? ref : entries[`${ref}.png`] ? `${ref}.png` : null;
        if (!path) return null;
        const known = imageIds.get(path);
        if (known) return known;
        const bytes = entries[path] as Uint8Array;
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const type = /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : "image/png";
        const id = nanoid(12);
        doc.images[id] = `data:${type};base64,${btoa(bin)}`;
        imageIds.set(path, id);
        return id;
    };

    const add = (node: SceneNode) => {
        doc.nodes[node.id] = node;
        const parent = node.parentId ? doc.nodes[node.parentId] : null;
        if (parent) parent.children = [...parent.children, node.id];
    };

    const paintsOf = (l: SketchLayer): Paint[] =>
        (l.style?.fills ?? []).flatMap((f): Paint[] => {
            if (f.fillType === 0) {
                const c = hex(f.color);
                return [{ ...solid(c.color, c.opacity), visible: f.isEnabled }];
            }
            if (f.fillType === 4) {
                const id = imageFor(f.image?._ref);
                return id ? [{ ...imagePaint(id, "fill"), visible: f.isEnabled }] : [];
            }
            skipped.add("gradient fills");
            return [];
        });

    const common = (l: SketchLayer): Partial<SceneNode> => {
        const border = (l.style?.borders ?? []).find((b) => b.isEnabled);
        const bc = hex(border?.color);
        return {
            name: l.name ?? "Layer",
            visible: l.isVisible !== false,
            locked: Boolean(l.isLocked),
            // Sketch turns layers counter-clockwise.
            rotation: -(l.rotation ?? 0),
            flipX: Boolean(l.isFlippedHorizontal),
            flipY: Boolean(l.isFlippedVertical),
            opacity: l.style?.contextSettings?.opacity ?? 1,
            ...(border ? { strokes: [solid(bc.color, bc.opacity)], strokeWidth: border.thickness ?? 1, strokeAlign: border.position === 0 ? "center" : border.position === 2 ? "outside" : "inside" } : {}),
        };
    };

    const pathOf = (l: SketchLayer, w: number, h: number) => {
        const pts = l.points ?? [];
        const points: PathPoint[] = pts.map((p) => {
            const at = pt(p.point);
            const from = pt(p.curveFrom);
            const to = pt(p.curveTo);
            return { x: at.x * w, y: at.y * h, in: p.hasCurveTo ? { x: to.x * w, y: to.y * h } : null, out: p.hasCurveFrom ? { x: from.x * w, y: from.y * h } : null, ...(p.cornerRadius ? { radius: p.cornerRadius } : {}) };
        });
        return { w, h, subpaths: [{ points, closed: l.isClosed !== false }] };
    };

    const walk = (l: SketchLayer, parentId: string, ox: number, oy: number) => {
        const f = l.frame ?? { x: 0, y: 0, width: 1, height: 1 };
        const box = { x: f.x + ox, y: f.y + oy, w: f.width, h: f.height };
        const kind = l._class;
        if (l.hasClippingMask) skipped.add("masks");
        let type: NodeType = "rect";
        const extra: Partial<SceneNode> = {};
        switch (kind) {
            case "artboard":
            case "symbolMaster":
                type = "frame";
                extra.fills = paintsOf(l).length ? paintsOf(l) : [solid("#FFFFFF")];
                extra.clip = true;
                break;
            case "group":
            case "shapeGroup":
                type = kind === "group" ? "group" : "frame";
                if (kind === "shapeGroup") {
                    extra.fills = paintsOf(l);
                    extra.clip = false;
                }
                break;
            case "symbolInstance":
                type = "frame";
                extra.fills = [];
                skipped.add("symbol instances (kept as frames)");
                break;
            case "rectangle":
                type = "rect";
                extra.fills = paintsOf(l);
                extra.radius = l.fixedRadius ?? Math.max(0, ...(l.points ?? []).map((p) => p.cornerRadius ?? 0));
                break;
            case "oval":
                type = "ellipse";
                extra.fills = paintsOf(l);
                break;
            case "shapePath":
            case "triangle":
            case "polygon":
            case "star":
                type = "vector";
                extra.fills = paintsOf(l);
                extra.path = pathOf(l, f.width, f.height);
                break;
            case "text": {
                type = "text";
                const attrs = l.attributedString?.attributes?.[0]?.attributes ?? l.style?.textStyle?.encodedAttributes;
                const font = attrs?.MSAttributedStringFontAttribute?.attributes;
                const color = hex(attrs?.MSAttributedStringColorAttribute);
                extra.text = l.attributedString?.string ?? "";
                extra.fontSize = font?.size ?? 14;
                extra.fontFamily = (font?.name ?? "Inter").split("-")[0]?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? "Inter";
                extra.fontWeight = weightOf(font?.name ?? "");
                extra.textAlign = (["left", "right", "center", "justify"] as const)[attrs?.paragraphStyle?.alignment ?? 0] ?? "left";
                extra.fills = [solid(color.color, color.opacity)];
                break;
            }
            case "bitmap": {
                type = "rect";
                const id = imageFor(l.image?._ref);
                extra.fills = id ? [imagePaint(id, "fill")] : [];
                break;
            }
            case "slice":
            case "MSImmutableHotspotLayer":
            case "hotspot":
                skipped.add("slices and hotspots");
                return;
            default:
                skipped.add(kind);
                type = "frame";
                extra.fills = [];
        }
        const node = makeNode(doc, type, box, parentId, { ...common(l), ...extra });
        add(node);
        // Sketch places children relative to their artboard or group; layers here keep page
        // positions (a parent only adds its rotation), so each child is offset by its parent's.
        for (const child of l.layers ?? []) walk(child, node.id, box.x, box.y);
    };

    for (const ref of document.pages ?? []) {
        const page = json(`${ref._ref}.json`) as SketchLayer | null;
        if (!page) continue;
        const node = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: page.name ?? "Page" });
        add(node);
        doc.roots.push(node.id);
        for (const l of page.layers ?? []) walk(l, node.id, 0, 0);
    }
    if (!doc.roots.length) throw new Error("No pages were found in that .sketch file.");
    return { doc, skipped: [...skipped] };
}
