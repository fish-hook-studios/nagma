import { hexToRgb, hsvToRgb, rgbToHex } from "./color";
import { worldBounds } from "./transform";
import type { NagmaDocument, SceneNode } from "./types";

// WCAG contrast for the colour picker: what a layer sits on, the ratio against it, and where the
// pass/fail line runs through the saturation/brightness square.

function channel(c: number): number {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
    const { r, g, b } = hexToRgb(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// A colour with some opacity, flattened onto the backdrop.
export function flatten(hex: string, opacity: number, backdrop: string): string {
    const a = hexToRgb(hex);
    const b = hexToRgb(backdrop);
    const k = Math.max(0, Math.min(1, opacity));
    return rgbToHex({ r: a.r * k + b.r * (1 - k), g: a.g * k + b.g * (1 - k), b: a.b * k + b.b * (1 - k) });
}

export function ratioOf(la: number, lb: number): number {
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Large text (24 px, or 18.66 px bold) needs 3:1 for AA and 4.5:1 for AAA; other text and
// graphics 4.5:1 and 7:1.
export function thresholds(node: SceneNode | null | undefined): { aa: number; aaa: number; large: boolean } {
    const size = node?.type === "text" ? (node.fontSize ?? 16) : 0;
    const large = node?.type === "text" && (size >= 24 || (size >= 18.66 && (node.fontWeight ?? 400) >= 700));
    return large ? { aa: 3, aaa: 4.5, large: true } : { aa: 4.5, aaa: 7, large: false };
}

function covers(outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }) {
    return outer.x <= inner.x + 0.5 && outer.y <= inner.y + 0.5 && outer.x + outer.w >= inner.x + inner.w - 0.5 && outer.y + outer.h >= inner.y + inner.h - 0.5;
}

function topSolid(node: SceneNode): string | null {
    for (let i = node.fills.length - 1; i >= 0; i--) {
        const p = node.fills[i];
        if (!p?.visible || p.opacity <= 0) continue;
        if (p.type === "solid") return p.opacity >= 0.999 ? p.color : null;
        return null;
    }
    return null;
}

// The colour behind a layer: the topmost opaque solid fill under it among its earlier siblings
// (and theirs, up the tree) that covers it, then its ancestors, then the page.
export function backdropColor(doc: NagmaDocument, node: SceneNode): string {
    const box = worldBounds(doc, node);
    let child: SceneNode = node;
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent) {
        const index = parent.children.indexOf(child.id);
        for (let i = index - 1; i >= 0; i--) {
            const sib = doc.nodes[parent.children[i] ?? ""];
            if (!sib || !sib.visible || sib.type === "text") continue;
            const color = topSolid(sib);
            if (color && covers(worldBounds(doc, sib), box)) return color;
        }
        if (parent.type === "page") return topSolid(parent) ?? "#F5F5F5";
        const own = topSolid(parent);
        if (own) return own;
        child = parent;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return "#FFFFFF";
}

// For one hue: per saturation step, the brightness where the contrast against `backdrop` equals
// `ratio` (darker side and lighter side). Each is a list of points (s, v) in 0..1, or empty.
export function contrastCurves(hue: number, backdrop: string, ratio: number, steps = 48): { dark: { s: number; v: number }[]; light: { s: number; v: number }[] } {
    const lb = luminance(backdrop);
    const darkTarget = (lb + 0.05) / ratio - 0.05;
    const lightTarget = ratio * (lb + 0.05) - 0.05;
    const lumAt = (s: number, v: number) => luminance(rgbToHex(hsvToRgb({ h: hue, s, v })));
    // Luminance rises with brightness for a fixed hue and saturation, so a bisection finds it.
    const solve = (s: number, target: number): number | null => {
        if (target < lumAt(s, 0) || target > lumAt(s, 1)) return null;
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            if (lumAt(s, mid) < target) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    };
    const dark: { s: number; v: number }[] = [];
    const light: { s: number; v: number }[] = [];
    for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        if (darkTarget >= 0) {
            const v = solve(s, darkTarget);
            if (v !== null) dark.push({ s, v });
        }
        if (lightTarget <= 1) {
            const v = solve(s, lightTarget);
            if (v !== null) light.push({ s, v });
        }
    }
    return { dark, light };
}
