// Loaded first so the collab ⇄ inspect-settings import cycle resolves (as a single bundle does in the app).
import "./inspect-settings";
import { beforeEach, describe, expect, it } from "vitest";
import { viewport } from "./camera";
import { editor } from "./store";
import { importSvg, parsePathData } from "./svg-import";
import type { NagmaDocument, SceneNode } from "./types";
import { emptyDoc } from "../test/core-fixtures";

// SVG pasted from another design tool: nested groups with transforms, clip paths and masks in
// <defs>, gradients and patterns by url(#id), <use>, even-odd paths, strokes with caps, joins
// and dashes, the basic shapes, text, group opacity and blend modes. Every visible element must
// become a layer, where it was drawn.

const doc = () => editor.get().doc;

function layers(d: NagmaDocument, rootId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const n = d.nodes[id];
        if (!n) return;
        out.push(n);
        for (const c of n.children) visit(c);
    };
    for (const c of d.nodes[rootId]?.children ?? []) visit(c);
    return out;
}

function leaves(d: NagmaDocument, rootId: string): SceneNode[] {
    return layers(d, rootId).filter((n) => n.type !== "group" && n.type !== "frame");
}

function paste(markup: string): { id: string; all: SceneNode[]; leaves: SceneNode[]; frame: SceneNode } {
    const id = importSvg(markup, { x: 500, y: 500 }, "SVG");
    if (!id) throw new Error("import failed");
    return { id, all: layers(doc(), id), leaves: leaves(doc(), id), frame: doc().nodes[id] as SceneNode };
}

const visible = (n: SceneNode) => n.fills.some((p) => p.visible) || n.strokes.some((p) => p.visible);
const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;

beforeEach(() => {
    viewport.width = 2000;
    viewport.height = 2000;
    editor.loadDocument(emptyDoc(), null);
    editor.set({ camera: { x: 0, y: 0, zoom: 1 }, selection: [] });
});

describe("path data", () => {
    it("reads arc flags written without separators", () => {
        const subs = parsePathData("M10 10a5 5 0 1012 0z");
        expect(subs).toHaveLength(1);
        const sub = subs[0]!;
        expect(sub.closed).toBe(true);
        const last = sub.points[sub.points.length - 1]!;
        // The arc ends 12 to the right of where it started.
        expect(near(last.x, 22) || near(sub.points[0]!.x, 10)).toBe(true);
        const xs = sub.points.map((p) => p.x);
        expect(Math.max(...xs)).toBeGreaterThan(20);
    });
});

describe("a logo with a clip path and a gradient", () => {
    const markup = `<svg width="200" height="120" viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clipA)">
<rect width="200" height="120" fill="url(#gradA)"/>
<path d="M20 20H80V60H20V20Z" fill="#FF0000"/>
<circle cx="150" cy="60" r="30" fill="#00FF00"/>
</g>
<defs>
<linearGradient id="gradA" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
<stop stop-color="#112233"/>
<stop offset="1" stop-color="#445566"/>
</linearGradient>
<clipPath id="clipA"><rect width="200" height="120" fill="white"/></clipPath>
</defs>
</svg>`;

    it("keeps the three shapes, filled, inside a clipping frame", () => {
        const r = paste(markup);
        expect(r.frame.type).toBe("frame");
        expect(r.leaves).toHaveLength(3);
        expect(r.leaves.every(visible)).toBe(true);
        const bg = r.leaves.find((n) => n.fills[0]?.type === "linear");
        expect(bg).toBeDefined();
        expect(near(bg!.w, 200) && near(bg!.h, 120)).toBe(true);
        // The clip path becomes a clipping frame the size of its rectangle, holding the group's layers.
        const clip = r.all.find((n) => n.type === "frame" && n.clip && n.id !== r.id);
        expect(clip).toBeDefined();
        expect(near(clip!.w, 200) && near(clip!.h, 120)).toBe(true);
        for (const leaf of r.leaves) expect(layers(doc(), clip!.id)).toContain(leaf);
        // The circle sits where it was drawn (frame children share the frame's coordinates).
        const circle = r.leaves.find((n) => n.type === "ellipse")!;
        expect(near(circle.x, r.frame.x + 120) && near(circle.y, r.frame.y + 30)).toBe(true);
    });
});

describe("a group with nested transforms and a <use>", () => {
    const markup = `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<defs><path id="dot" d="M-5 -5H5V5H-5Z" fill="#0000FF"/></defs>
<g transform="translate(50 50)">
  <g transform="scale(2) rotate(0)">
    <rect x="0" y="0" width="10" height="10" fill="#FF0000"/>
    <use xlink:href="#dot" x="15" y="0"/>
    <use href="#dot" transform="translate(0 15)"/>
  </g>
</g>
</svg>`;

    it("composes the transforms and copies the referenced shape for every use", () => {
        const r = paste(markup);
        expect(r.leaves).toHaveLength(3);
        const rect = r.leaves.find((n) => n.fills[0]?.type === "solid" && n.fills[0].color === "#FF0000")!;
        expect(near(rect.x, r.frame.x + 50) && near(rect.y, r.frame.y + 50) && near(rect.w, 20) && near(rect.h, 20)).toBe(true);
        const dots = r.leaves.filter((n) => n.fills[0]?.type === "solid" && n.fills[0].color === "#0000FF");
        expect(dots).toHaveLength(2);
        // 10 wide in symbol units at scale 2, centred at (50 + 30, 50) and (50, 50 + 30).
        const a = dots.find((n) => near(n.x, r.frame.x + 70))!;
        const b = dots.find((n) => near(n.y, r.frame.y + 70))!;
        expect(a && near(a.y, r.frame.y + 40) && near(a.w, 20)).toBe(true);
        expect(b && near(b.x, r.frame.x + 40) && near(b.h, 20)).toBe(true);
    });
});

describe("a symbol placed by use", () => {
    it("scales the symbol's viewBox to the use's size", () => {
        const r = paste(`<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<symbol id="sym" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ABCDEF"/></symbol>
<use href="#sym" x="20" y="30" width="40" height="40"/>
</svg>`);
        expect(r.leaves).toHaveLength(1);
        const rect = r.leaves[0]!;
        expect(near(rect.x, r.frame.x + 20) && near(rect.y, r.frame.y + 30) && near(rect.w, 40) && near(rect.h, 40)).toBe(true);
    });
});

describe("an icon set with even-odd paths", () => {
    const ring = "M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20Z";
    const markup = `<svg width="72" height="24" viewBox="0 0 72 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="${ring}" fill="#111111"/>
<g transform="translate(24 0)"><path fill-rule="evenodd" clip-rule="evenodd" d="${ring} M12 8C9.79 8 8 9.79 8 12C8 14.21 9.79 16 12 16C14.21 16 16 14.21 16 12C16 9.79 14.21 8 12 8Z" fill="#222222"/></g>
<g transform="translate(48 0)"><path fill-rule="evenodd" d="M4 4H20V20H4V4ZM8 8V16H16V8H8Z" fill="#333333" stroke="#444444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 1"/></g>
</svg>`;

    it("keeps every icon as one vector of the original points, with its holes", () => {
        const r = paste(markup);
        expect(r.leaves).toHaveLength(3);
        for (const n of r.leaves) {
            expect(n.type).toBe("vector");
            expect(visible(n)).toBe(true);
        }
        expect(r.leaves.map((n) => Math.round(n.w))).toEqual([20, 20, 16]);
        const [ringIcon, target, square] = r.leaves;
        expect(ringIcon!.path!.subpaths).toHaveLength(2);
        expect(target!.path!.subpaths).toHaveLength(3);
        expect(square!.path!.subpaths).toHaveLength(2);
        // Holes run the other way round from their outline, so the default (non-zero) fill leaves them empty.
        const area = (pts: { x: number; y: number }[]) => pts.reduce((sum, p, i) => sum + (p.x * pts[(i + 1) % pts.length]!.y - pts[(i + 1) % pts.length]!.x * p.y), 0) / 2;
        const [outer, inner] = square!.path!.subpaths.map((s) => area(s.points));
        expect(Math.sign(outer!)).not.toBe(Math.sign(inner!));
        const [o2, mid, dot] = target!.path!.subpaths.map((s) => area(s.points));
        expect(Math.sign(o2!)).not.toBe(Math.sign(mid!));
        expect(Math.sign(dot!)).toBe(Math.sign(o2!));
        expect(square!.strokeCap).toBe("round");
        expect(square!.strokeJoin).toBe("round");
        expect(square!.dash).toEqual([2, 1]);
        expect(square!.strokeWidth).toBe(1.5);
        expect(near(square!.x, r.frame.x + 52) && near(square!.y, r.frame.y + 4)).toBe(true);
    });
});

describe("an illustration with masks, patterns, group opacity and blend modes", () => {
    const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const markup = `<svg width="300" height="200" viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g opacity="0.5" style="mix-blend-mode:multiply">
  <ellipse cx="60" cy="60" rx="40" ry="20" fill="#AA0000"/>
  <line x1="10" y1="10" x2="90" y2="90" stroke="#00AA00" stroke-width="3"/>
  <polyline points="100,10 120,30 140,10" stroke="#0000AA" stroke-width="2"/>
  <polygon points="200,10 240,10 220,40" fill="#AAAA00"/>
</g>
<mask id="maskA" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="100" width="150" height="100">
  <rect y="100" width="150" height="100" fill="#D9D9D9"/>
</mask>
<g mask="url(#maskA)">
  <rect x="-20" y="80" width="200" height="140" fill="#0099FF"/>
  <text x="20" y="160" font-size="24" fill="#FFFFFF">Hello</text>
</g>
<rect x="200" y="100" width="80" height="80" fill="url(#patA)"/>
<rect x="200" y="20" width="40" height="40" fill="url(#missing)"/>
<defs>
<pattern id="patA" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#img0" transform="scale(1)"/></pattern>
<image id="img0" width="1" height="1" href="${px}"/>
</defs>
</svg>`;

    it("keeps every element: masked ones under a mask layer, pattern images as image fills, unknown paints as a visible fill", () => {
        const r = paste(markup);
        const kinds = r.leaves.map((n) => n.type);
        // Ellipse, line, polyline, polygon, mask rect, masked rect, text, pattern rect, fallback rect.
        expect(r.leaves).toHaveLength(9);
        expect(kinds.filter((k) => k === "text")).toHaveLength(1);
        expect(r.leaves.every(visible)).toBe(true);
        const group = r.all.find((n) => n.type === "group" && n.opacity === 0.5);
        expect(group).toBeDefined();
        expect(group!.blendMode).toBe("multiply");
        // The mask: a layer flagged as mask, first under its own frame, with the masked content after it.
        const mask = r.all.find((n) => n.isMask);
        expect(mask).toBeDefined();
        expect(mask!.maskType).toBe("alpha");
        const host = doc().nodes[mask!.parentId!]!;
        expect(host.children[0]).toBe(mask!.id);
        expect(host.children.length).toBe(3);
        const text = r.leaves.find((n) => n.type === "text")!;
        expect(text.parentId).toBe(host.id);
        expect(text.text).toBe("Hello");
        // Pattern fills from an image become image fills.
        const pic = r.leaves.find((n) => n.fills[0]?.type === "image");
        expect(pic).toBeDefined();
        expect(near(pic!.x, r.frame.x + 200) && near(pic!.w, 80)).toBe(true);
        // A paint that points nowhere still shows as a solid fill rather than vanishing.
        const fallback = r.leaves.find((n) => near(n.x, r.frame.x + 200) && near(n.y, r.frame.y + 20));
        expect(fallback).toBeDefined();
        expect(fallback!.fills[0]?.type).toBe("solid");
    });
});

describe("a wrapping svg with px sizes and a viewBox offset", () => {
    it("places shapes by the viewBox, scaled to the pixel size", () => {
        const r = paste(`<svg width="200px" height="100px" viewBox="100 50 100 50" xmlns="http://www.w3.org/2000/svg"><rect x="100" y="50" width="50" height="25" fill="#123456"/></svg>`);
        expect(near(r.frame.w, 200) && near(r.frame.h, 100)).toBe(true);
        const rect = r.leaves[0]!;
        expect(near(rect.x, r.frame.x) && near(rect.y, r.frame.y) && near(rect.w, 100) && near(rect.h, 50)).toBe(true);
    });

    it("gives a path that only strokes its stroke, and keeps one with neither paint as a layer", () => {
        const r = paste(`<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L9 9" stroke="#000" fill="none"/><path d="M1 9L9 1" fill="none"/></svg>`);
        expect(r.leaves).toHaveLength(2);
        expect(r.leaves[0]!.strokes).toHaveLength(1);
        expect(r.leaves[0]!.fills).toHaveLength(0);
        expect(r.leaves[1]!.type).toBe("vector");
    });
});
