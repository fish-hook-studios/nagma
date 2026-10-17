import type { SceneNode } from "./types";

// Stroke details shared by the canvas and SVG export: the dash pattern, per-side weights and the
// band a per-side stroke covers.

export const DEFAULT_MITER_ANGLE = 28.96;

// The dash pattern to draw, or null for a solid stroke.
export function dashOf(node: SceneNode): number[] | null {
    if (node.dashPattern?.length && node.dashPattern.some((n) => n > 0)) return node.dashPattern.map((n) => Math.max(0, n));
    if (node.dash && (node.dash[0] > 0 || node.dash[1] > 0)) return [Math.max(0, node.dash[0]), Math.max(0, node.dash[1])];
    return null;
}

// Canvas miter limit for the reference's miter angle (the join turns into a bevel below it).
export function miterLimitOf(node: SceneNode): number {
    const angle = Math.max(1, Math.min(179, node.miterAngle ?? DEFAULT_MITER_ANGLE));
    return 1 / Math.sin(((angle * Math.PI) / 180) / 2);
}

// Top, right, bottom, left weights when a rectangle or frame strokes its sides unevenly (some
// sides off, or Custom weights); null for an even stroke all round.
export function sideWeights(node: SceneNode, frameLike: boolean): [number, number, number, number] | null {
    if (node.type !== "rect" && !frameLike) return null;
    if (node.strokeWeights) return node.strokeWeights.map((n) => Math.max(0, n)) as [number, number, number, number];
    const s = node.strokeSides;
    if (!s || (s.top && s.right && s.bottom && s.left)) return null;
    const w = node.strokeWidth;
    return [s.top ? w : 0, s.right ? w : 0, s.bottom ? w : 0, s.left ? w : 0];
}

type Corner = { x: number; y: number };

// A rounded rectangle as SVG path data, each corner with its own horizontal and vertical radius.
function roundRectD(x: number, y: number, w: number, h: number, r: [Corner, Corner, Corner, Corner]): string {
    if (w <= 0 || h <= 0) return "";
    const [tl, tr, br, bl] = r.map((c) => ({ x: Math.max(0, Math.min(c.x, w / 2)), y: Math.max(0, Math.min(c.y, h / 2)) })) as [Corner, Corner, Corner, Corner];
    const n = (v: number) => Math.round(v * 1000) / 1000;
    return [
        `M${n(x + tl.x)} ${n(y)}`,
        `H${n(x + w - tr.x)}`,
        tr.x && tr.y ? `A${n(tr.x)} ${n(tr.y)} 0 0 1 ${n(x + w)} ${n(y + tr.y)}` : "",
        `V${n(y + h - br.y)}`,
        br.x && br.y ? `A${n(br.x)} ${n(br.y)} 0 0 1 ${n(x + w - br.x)} ${n(y + h)}` : "",
        `H${n(x + bl.x)}`,
        bl.x && bl.y ? `A${n(bl.x)} ${n(bl.y)} 0 0 1 ${n(x)} ${n(y + h - bl.y)}` : "",
        `V${n(y + tl.y)}`,
        tl.x && tl.y ? `A${n(tl.x)} ${n(tl.y)} 0 0 1 ${n(x + tl.x)} ${n(y)}` : "",
        "Z",
    ].join("");
}

// The area an uneven stroke covers, as SVG path data to fill with the even-odd rule: the outline
// grown outwards and shrunk inwards by each side's weight (all inside, all outside, or half each).
export function sideBandD(node: SceneNode, weights: [number, number, number, number]): string {
    const out = node.strokeAlign === "outside" ? 1 : node.strokeAlign === "center" ? 0.5 : 0;
    const [t, r, b, l] = weights;
    const o = { t: t * out, r: r * out, b: b * out, l: l * out };
    const i = { t: t - o.t, r: r - o.r, b: b - o.b, l: l - o.l };
    const radii = node.radii ?? [node.radius, node.radius, node.radius, node.radius];
    const rad = radii.map((v) => Math.max(0, Math.min(v, node.w / 2, node.h / 2)));
    const corner = (k: number, dx: number, dy: number): Corner => ((rad[k] ?? 0) > 0 ? { x: Math.max(0, (rad[k] ?? 0) + dx), y: Math.max(0, (rad[k] ?? 0) + dy) } : { x: 0, y: 0 });
    const outer = roundRectD(node.x - o.l, node.y - o.t, node.w + o.l + o.r, node.h + o.t + o.b, [corner(0, o.l, o.t), corner(1, o.r, o.t), corner(2, o.r, o.b), corner(3, o.l, o.b)]);
    const inner = roundRectD(node.x + i.l, node.y + i.t, node.w - i.l - i.r, node.h - i.t - i.b, [corner(0, -i.l, -i.t), corner(1, -i.r, -i.t), corner(2, -i.r, -i.b), corner(3, -i.l, -i.b)]);
    return outer + inner;
}
