import { copyLayers } from "../engine/actions";
import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import { editor } from "../engine/store";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { askPreview } from "./preview-bridge";

// "Copy as design layers": the running preview read as boxes, text and pictures (by the preview's
// script, in page coordinates) and rebuilt as frames, rectangles and text layers. Boxes without a
// look of their own (no fill, border or shadow) aren't kept: their children move up a level, so the
// layers stay close to what you see. The result goes on the clipboard to paste into a design file.

interface TextRun {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    font: string;
    size: number;
    weight: number;
    italic: boolean;
    color: string;
    align: string;
    lineHeight: string;
    letterSpacing: string;
    decoration: string;
    transform: string;
}

interface Box {
    tag: string;
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    bg: string;
    bgImage: boolean;
    radius: number;
    borderWidth: number;
    borderColor: string;
    opacity: number;
    shadow: boolean;
    clip: boolean;
    img: string | null;
    children: (Box | TextRun)[];
}

export interface PageLayers {
    width: number;
    height: number;
    background: string;
    root: Box | null;
}

// "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0.5)" → ["#010203", alpha].
export function cssColor(value: string): [string, number] | null {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(value);
    if (!m) return null;
    const alphaRaw = m[4];
    const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : Number(alphaRaw);
    if (alpha <= 0) return null;
    const hex = `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    return [hex, alpha];
}

const isText = (n: Box | TextRun): n is TextRun => "text" in n;
const family = (stack: string) => (stack.split(",")[0] ?? "Inter").replace(/["']/g, "").trim() || "Inter";

function hasLook(b: Box): boolean {
    return Boolean(cssColor(b.bg)) || b.bgImage || (b.borderWidth > 0 && Boolean(cssColor(b.borderColor))) || b.shadow || Boolean(b.img);
}

// Builds the layers into `doc` (a scratch document) under `parentId`; positions are page
// coordinates offset so the page's top left is (0, 0).
function build(doc: NagmaDocument, node: Box | TextRun, parentId: string, out: SceneNode[]) {
    const parent = doc.nodes[parentId] as SceneNode;
    if (isText(node)) {
        const colour = cssColor(node.color) ?? ["#000000", 1];
        const lh = parseFloat(node.lineHeight);
        const ls = parseFloat(node.letterSpacing);
        const text = makeNode(doc, "text", { x: node.x, y: node.y, w: Math.ceil(node.w) + 1, h: Math.ceil(node.h) }, parentId, {
            text: node.text,
            name: node.text.slice(0, 40),
            fontFamily: family(node.font),
            fontSize: Math.round(node.size * 10) / 10,
            fontWeight: node.weight,
            italic: node.italic,
            fills: [solid(colour[0], colour[1])],
            textAlign: node.align === "center" || node.align === "right" || node.align === "justify" ? node.align : "left",
            lineHeight: Number.isFinite(lh) && node.size ? Math.round((lh / node.size) * 100) / 100 : null,
            letterSpacing: Number.isFinite(ls) && node.size ? Math.round((ls / node.size) * 1000) / 10 : 0,
            decoration: node.decoration.includes("underline") ? "underline" : node.decoration.includes("line-through") ? "strikethrough" : "none",
            textCase: node.transform === "uppercase" ? "upper" : node.transform === "lowercase" ? "lower" : node.transform === "capitalize" ? "title" : "none",
        } as Partial<SceneNode>);
        doc.nodes[text.id] = text;
        parent.children.push(text.id);
        out.push(text);
        return;
    }
    if (!hasLook(node) && !node.clip) {
        for (const child of node.children) build(doc, child, parentId, out);
        return;
    }
    const fill = cssColor(node.bg);
    const border = node.borderWidth > 0 ? cssColor(node.borderColor) : null;
    const kind = node.img ? "rect" : "frame";
    const layer = makeNode(doc, kind, { x: node.x, y: node.y, w: node.w, h: node.h }, parentId, {
        name: node.img ? (node.img === "svg" ? "Icon" : "Image") : node.name || node.tag,
        fills: node.img ? [solid("#D0D5DD")] : fill ? [solid(fill[0], fill[1])] : [],
        strokes: border ? [solid(border[0], border[1])] : [],
        strokeWidth: border ? node.borderWidth : 1,
        radius: Math.round(node.radius),
        opacity: Number.isFinite(node.opacity) ? node.opacity : 1,
        clip: node.clip,
        ...(node.shadow ? { effects: [{ type: "drop-shadow", visible: true, x: 0, y: 4, blur: 12, spread: 0, color: "#101828", opacity: 0.12 }] } : {}),
    } as Partial<SceneNode>);
    doc.nodes[layer.id] = layer;
    parent.children.push(layer.id);
    out.push(layer);
    if (kind === "frame") for (const child of node.children) build(doc, child, layer.id, out);
}

export function layersToDocument(page: PageLayers, name: string): { doc: NagmaDocument; rootId: string } {
    const doc: NagmaDocument = { name, nodes: {}, roots: [], images: {} };
    const bg = cssColor(page.background) ?? ["#FFFFFF", 1];
    const root = makeNode(doc, "frame", { x: 0, y: 0, w: page.width, h: page.height }, null, { name, fills: [solid(bg[0], bg[1])], clip: true });
    doc.nodes[root.id] = root;
    doc.roots.push(root.id);
    const out: SceneNode[] = [];
    if (page.root) for (const child of page.root.children) build(doc, child, root.id, out);
    return { doc, rootId: root.id };
}

export async function copyPreviewAsLayers(): Promise<boolean> {
    const page = await askPreview<PageLayers>("layers");
    if (!page?.root) {
        editor.notify("The preview isn't running, so it can't be copied.");
        return false;
    }
    const { doc, rootId } = layersToDocument(page, editor.get().doc.name || "App");
    const count = Object.keys(doc.nodes).length;
    const ok = await copyLayers(doc, [rootId]);
    editor.notify(ok ? `Copied ${count} layers. Paste them into a design file with ⌘V.` : `Copied ${count} layers. Paste them into a design file in this tab with ⌘V.`);
    return true;
}
