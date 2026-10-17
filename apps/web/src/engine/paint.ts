import { imageSrc } from "./image-store";
import type { BlendMode, GradientPaint, ImagePaint, Paint, SceneNode, SolidPaint } from "./types";



// The reference's blend menu, in its groups.
export const BLEND_GROUPS: BlendMode[][] = [
    ["pass-through", "normal"],
    ["darken", "multiply", "plus-darker", "color-burn"],
    ["lighten", "screen", "plus-lighter", "color-dodge"],
    ["overlay", "soft-light", "hard-light"],
    ["difference", "exclusion"],
    ["hue", "saturation", "color", "luminosity"],
];

const BLEND_LABELS: Record<BlendMode, string> = {
    "pass-through": "Pass through",
    normal: "Normal",
    darken: "Darken",
    multiply: "Multiply",
    "plus-darker": "Plus darker",
    "color-burn": "Color burn",
    lighten: "Lighten",
    screen: "Screen",
    "plus-lighter": "Plus lighter",
    "color-dodge": "Color dodge",
    overlay: "Overlay",
    "soft-light": "Soft light",
    "hard-light": "Hard light",
    difference: "Difference",
    exclusion: "Exclusion",
    hue: "Hue",
    saturation: "Saturation",
    color: "Color",
    luminosity: "Luminosity",
};

export function blendLabel(mode: BlendMode): string {
    return BLEND_LABELS[mode] ?? mode;
}

// Every mode a paint or a shape can use (pass through is for groups and frames only).
export const BLEND_MODES: [BlendMode, string][] = BLEND_GROUPS.flat()
    .filter((m) => m !== "pass-through")
    .map((m) => [m, BLEND_LABELS[m]]);

export function solid(color: string, opacity = 1): SolidPaint {
    return { type: "solid", color, opacity, visible: true, blend: "normal" };
}

export function linearGradient(from = "#6D4AFF", to = "#FF7A59"): GradientPaint {
    return {
        type: "linear",
        stops: [
            { position: 0, color: from, opacity: 1 },
            { position: 1, color: to, opacity: 1 },
        ],
        from: { x: 0.5, y: 0 },
        to: { x: 0.5, y: 1 },
        opacity: 1,
        visible: true,
        blend: "normal",
    };
}

export function imagePaint(id: string, mode: ImagePaint["mode"] = "fill"): ImagePaint {
    return { type: "image", id, mode, opacity: 1, visible: true, blend: "normal" };
}

// The colour space paint values are drawn in: a Display P3 file's hex values are P3 colours, so
// they are handed to the canvas as such (renderScene sets this from the file's colour profile).
let paintSpace: "srgb" | "p3" = "srgb";

export function setPaintSpace(space: "srgb" | "p3") {
    paintSpace = space;
}

export function hexToRgba(hex: string, alpha: number): string {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16) || 0;
    const g = parseInt(value.slice(2, 4), 16) || 0;
    const b = parseInt(value.slice(4, 6), 16) || 0;
    if (paintSpace === "p3") return `color(display-p3 ${(r / 255).toFixed(4)} ${(g / 255).toFixed(4)} ${(b / 255).toFixed(4)} / ${alpha})`;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// A paint colour as a canvas colour, in the file's colour space.
export function paintColor(hex: string): string {
    return paintSpace === "p3" ? hexToRgba(hex, 1) : hex;
}

export function isGradient(paint: Paint): paint is GradientPaint {
    return paint.type === "linear" || paint.type === "radial" || paint.type === "angular" || paint.type === "diamond";
}

export function visiblePaints(paints: Paint[]): Paint[] {
    return paints.filter((paint) => paint.visible && paint.opacity > 0);
}

// The top visible solid colour, for things that need one colour (text cursor, thumbnails).
export function primaryColor(paints: Paint[]): string | null {
    for (let i = paints.length - 1; i >= 0; i--) {
        const paint = paints[i];
        if (!paint?.visible) continue;
        if (paint.type === "solid") return paint.color;
        if (isGradient(paint)) return paint.stops[0]?.color ?? null;
    }
    return null;
}

// A CSS background that previews a paint (for swatches in the panel).
export function paintCss(paint: Paint, images: Record<string, string>): string {
    if (paint.type === "solid") return hexToRgba(paint.color, paint.opacity);
    if (paint.type === "image") return `center / cover url(${imageSrc(images, paint.id) ?? ""})`;
    // A pattern's swatch: a small grid of dots standing in for its tiles.
    if (paint.type === "pattern") return `radial-gradient(circle, ${hexToRgba("#7A7A7A", paint.opacity)} 28%, transparent 30%) 0 0 / 6px 6px`;
    // A shader's swatch: a small rainbow standing in for whatever it draws.
    if (paint.type === "shader") return `linear-gradient(135deg, ${hexToRgba("#6D4AFF", paint.opacity)}, ${hexToRgba("#FF7A59", paint.opacity)}, ${hexToRgba("#2BD9A3", paint.opacity)})`;
    const stops = [...paint.stops].sort((a, b) => a.position - b.position).map((s) => `${hexToRgba(s.color, s.opacity)} ${Math.round(s.position * 100)}%`);
    if (paint.type === "radial") return `radial-gradient(circle, ${stops.join(", ")})`;
    if (paint.type === "diamond") return `conic-gradient(from 45deg, ${stops.join(", ")})`;
    if (paint.type === "angular") return `conic-gradient(${stops.join(", ")})`;
    return `linear-gradient(${Math.round(gradientAngle(paint) + 90)}deg, ${stops.join(", ")})`;
}

// A swatch background: the paint over a checkerboard. A solid colour has to be wrapped in a
// gradient, since a plain colour can't be a non-final layer of `background`.
export function swatchCss(paint: Paint, images: Record<string, string>): string {
    const css = paintCss(paint, images);
    const layer = paint.type === "solid" ? `linear-gradient(${css}, ${css})` : css;
    return `${layer}, repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px`;
}

// Degrees for a linear gradient, 0 = left to right, 90 = top to bottom.
export function gradientAngle(paint: GradientPaint): number {
    return (Math.atan2(paint.to.y - paint.from.y, paint.to.x - paint.from.x) * 180) / Math.PI;
}

export function withAngle(paint: GradientPaint, degrees: number): GradientPaint {
    const rad = (degrees * Math.PI) / 180;
    const dx = Math.cos(rad) / 2;
    const dy = Math.sin(rad) / 2;
    return { ...paint, from: { x: 0.5 - dx, y: 0.5 - dy }, to: { x: 0.5 + dx, y: 0.5 + dy } };
}

// A canvas fill style for a gradient laid over a box.
export function gradientStyle(ctx: CanvasRenderingContext2D, paint: GradientPaint, box: { x: number; y: number; w: number; h: number }): CanvasGradient {
    const fx = box.x + paint.from.x * box.w;
    const fy = box.y + paint.from.y * box.h;
    const tx = box.x + paint.to.x * box.w;
    const ty = box.y + paint.to.y * box.h;
    let gradient: CanvasGradient;
    if (paint.type === "radial" || paint.type === "diamond") gradient = ctx.createRadialGradient(fx, fy, 0, fx, fy, Math.max(0.5, Math.hypot(tx - fx, ty - fy)));
    else if (paint.type === "angular") gradient = ctx.createConicGradient(Math.atan2(ty - fy, tx - fx), fx, fy);
    else gradient = ctx.createLinearGradient(fx, fy, tx, ty);
    for (const stop of [...paint.stops].sort((a, b) => a.position - b.position)) {
        gradient.addColorStop(Math.min(1, Math.max(0, stop.position)), hexToRgba(stop.color, stop.opacity));
    }
    return gradient;
}

// Converts files saved with a single fill, image and stroke into paint lists.
export function migratePaints(raw: Record<string, unknown>): Partial<SceneNode> {
    if (Array.isArray(raw.fills)) return {};
    const fills: Paint[] = [];
    if (typeof raw.fill === "string") {
        const paint = solid(raw.fill, typeof raw.fillOpacity === "number" ? raw.fillOpacity : 1);
        paint.visible = raw.fillVisible !== false;
        fills.push(paint);
    }
    const image = raw.image as { id?: string; mode?: "fill" | "fit" } | null | undefined;
    if (image?.id) fills.push(imagePaint(image.id, image.mode ?? "fill"));
    const strokes: Paint[] = typeof raw.stroke === "string" ? [solid(raw.stroke)] : [];
    return { fills, strokes };
}
