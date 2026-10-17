import { customBrushStroke, customBrushes } from "./custom-brushes";
import { SCATTER_BRUSHES, STRETCH_BRUSHES } from "./stroke-styles";
import type { BrushStroke, NagmaDocument, SceneNode } from "./types";
import { widthAt } from "./width-profile";

// Brushes for the Brush tool (Draw mode). Each is a stroke look made from Nagma's own stroke
// properties: a width profile along the stroke, the cap, the opacity and an optional dash, so a
// brushed stroke stays an editable vector.

export interface Brush {
    id: string;
    name: string;
    // Width multipliers along the stroke; none means an even width.
    widthPoints?: { t: number; w: number }[];
    cap: "round" | "square" | "butt";
    opacity: number;
    // Stroke weight as a multiple of the chosen size.
    scale: number;
    // Dash and gap as multiples of the stroke weight.
    dash?: [number, number];
    // A stretch or scatter brush (engine/stroke-styles.ts) instead of a plain stroke.
    stroke?: BrushStroke;
    group?: "basic" | "stretch" | "scatter" | "custom";
}

export const BRUSHES: Brush[] = [
    { id: "round", name: "Round", cap: "round", opacity: 1, scale: 1 },
    { id: "taper", name: "Taper", cap: "round", opacity: 1, scale: 1.2, widthPoints: [{ t: 0, w: 0.05 }, { t: 0.5, w: 1 }, { t: 1, w: 0.05 }] },
    { id: "ink", name: "Ink", cap: "round", opacity: 1, scale: 1.2, widthPoints: [{ t: 0, w: 0.35 }, { t: 0.12, w: 1.15 }, { t: 0.7, w: 0.8 }, { t: 1, w: 0.02 }] },
    { id: "wedge", name: "Wedge", cap: "round", opacity: 1, scale: 1.4, widthPoints: [{ t: 0, w: 1 }, { t: 1, w: 0.02 }] },
    { id: "pulse", name: "Pulse", cap: "round", opacity: 1, scale: 1.2, widthPoints: [{ t: 0, w: 0.3 }, { t: 0.25, w: 1 }, { t: 0.5, w: 0.3 }, { t: 0.75, w: 1 }, { t: 1, w: 0.3 }] },
    { id: "marker", name: "Marker", cap: "square", opacity: 0.75, scale: 1.6 },
    { id: "dotted", name: "Dotted", cap: "round", opacity: 1, scale: 1, dash: [0.01, 2] },
    ...STRETCH_BRUSHES.map((b): Brush => ({ id: `stretch-${b.id}`, name: b.name, cap: "round", opacity: 1, scale: 1.4, stroke: b.stroke, group: "stretch" })),
    ...SCATTER_BRUSHES.map((b): Brush => ({ id: `scatter-${b.id}`, name: b.name, cap: "round", opacity: 1, scale: 1.2, stroke: b.stroke, group: "scatter" })),
];

// The built-in brushes plus the file's custom ones (Create brush).
export function allBrushes(doc: NagmaDocument | null): Brush[] {
    if (!doc) return BRUSHES;
    const custom = customBrushes(doc).map((def): Brush => ({ id: `custom-${def.id}`, name: `${def.name} (${def.type})`, cap: "round", opacity: 1, scale: def.type === "stretch" ? 1.4 : 1.2, stroke: customBrushStroke(def), group: "custom" }));
    return custom.length ? [...BRUSHES, ...custom] : BRUSHES;
}

// The brush tool's library, as in the reference: stretch and scatter brushes, then the file's custom
// ones. The plain shapes above (Round, Taper and so on) are width profiles in the stroke panel; they
// stay here so strokes drawn with them keep resolving.
export function menuBrushes(doc: NagmaDocument | null): Brush[] {
    return allBrushes(doc).filter((b) => b.group === "stretch" || b.group === "scatter" || b.group === "custom");
}

export const DEFAULT_BRUSH = "stretch-pencil";

export function brushById(id: string, doc: NagmaDocument | null = null): Brush {
    return allBrushes(doc).find((b) => b.id === id) ?? (BRUSHES.find((b) => b.id === DEFAULT_BRUSH) as Brush);
}

// The layer properties a brush gives a stroke of the chosen size.
export function brushPatch(brush: Brush, size: number): Partial<SceneNode> {
    const weight = Math.max(0.5, size * brush.scale);
    return {
        strokeWidth: weight,
        strokeCap: brush.cap,
        strokeJoin: "round",
        widthPoints: brush.widthPoints ? brush.widthPoints.map((p) => ({ ...p })) : null,
        dash: brush.dash ? [brush.dash[0] * weight, brush.dash[1] * weight] : null,
        brushStroke: brush.stroke ? { ...brush.stroke } : null,
        dynamicStroke: null,
    };
}

// A preview of the brush as SVG path data: a gentle wave of the brush's width profile in a w×h box.
export function brushPreviewPath(brush: Brush, w = 120, h = 20, weight = 6): string {
    const n = 48;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n;
        return { t, x: 6 + t * (w - 12), y: h / 2 + Math.sin(t * Math.PI * 2) * (h / 2 - weight / 2 - 1) };
    });
    const half = (t: number) => ((brush.widthPoints ? widthAt(brush.widthPoints, t) : 1) * weight * Math.min(brush.scale, 1.3)) / 2;
    const left: string[] = [];
    const right: string[] = [];
    pts.forEach((p, i) => {
        const q = pts[Math.min(i + 1, n)] as { x: number; y: number };
        const o = pts[Math.max(i - 1, 0)] as { x: number; y: number };
        const len = Math.hypot(q.x - o.x, q.y - o.y) || 1;
        const nx = -(q.y - o.y) / len;
        const ny = (q.x - o.x) / len;
        const r = half(p.t);
        left.push(`${(p.x + nx * r).toFixed(2)} ${(p.y + ny * r).toFixed(2)}`);
        right.push(`${(p.x - nx * r).toFixed(2)} ${(p.y - ny * r).toFixed(2)}`);
    });
    return `M${left.join(" L")} L${right.reverse().join(" L")} Z`;
}

// The centre line of the preview wave, for brushes drawn as plain strokes (round, marker, dotted).
export function brushPreviewLine(w = 120, h = 20, weight = 6): string {
    const n = 48;
    return Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n;
        return `${i === 0 ? "M" : "L"}${(6 + t * (w - 12)).toFixed(2)} ${(h / 2 + Math.sin(t * Math.PI * 2) * (h / 2 - weight / 2 - 1)).toFixed(2)}`;
    }).join(" ");
}
