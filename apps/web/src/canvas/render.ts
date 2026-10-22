import { pluginOwnsLabel } from "./canvas-plugins";
import { worldToScreen } from "../engine/camera";
import { isFrameLike } from "../engine/components";
import { getImage } from "../engine/images";
import { liveFrame } from "../engine/video";
import { gifFrame } from "../engine/gif";
import { gradientStyle, hexToRgba, paintColor, setPaintSpace, visiblePaints } from "../engine/paint";
import { booleanResult } from "../engine/booleans";
import { widthAt as widthAtT, widthPointsOf } from "../engine/width-profile";
import { band, hasStyledStroke, styledStrokePolygons } from "../engine/stroke-styles";
import { placedSubpaths, samplePath, shapeSubpaths, tracePath } from "../engine/vector";
import { regionFillSubpaths } from "../engine/vector-network";
import { activePage, layerRoots, pageOf as pageOfNode } from "../engine/page";
import { selectionBounds } from "../engine/nodes";
import type { Theme } from "../engine/store";
import { editor } from "../engine/store";
import { vectorUi } from "../engine/vector-ui";
import { DEFAULT_FAMILY, ensureFont, fontString, styleOf } from "../engine/text";
import { staggerTimeOf } from "../engine/text-stagger";
import { drawTextLayer, strokeText } from "./text-render";
import { layoutText, verticalOffset } from "../engine/text-layout";
import { SIZE_PILL_GAP, SIZE_PILL_HEIGHT, type Segment, effectiveSizing, firstBaseline, formatSize, lineBaselines, sizePillText } from "../engine/selection-chrome";
import { apply, corners, localMatrix, parentMatrix, worldMatrix } from "../engine/transform";
import type { BlendMode, Camera, Effect, EndCap, GradientPaint, NagmaDocument, Paint, PatternPaint, Rect, SceneNode } from "../engine/types";
import { patternGrid } from "../engine/pattern";
import { guideCells } from "../engine/guides";
import { dashOf, miterLimitOf, sideBandD, sideWeights } from "../engine/stroke";
import { exportBounds } from "../engine/effect-bounds";
import { FRAME_LABEL_SIZE, frameLabelRect, labelled, sceneFocus } from "./hit-test";
import { drawConnections } from "./prototype-connections";
import type { Guide, Measure } from "./snapping";
import { type VertexRef, isSelected, screenVertices } from "./vector-edit";
import { drawUiOverlay } from "./ui-overlay";
import { drawShaderEffect, drawShaderPaint } from "./shader-paint";
import { ensureLiveSnapshots, liveSnapshot, skipSnapshot } from "./live-snapshots";
import { beginKnockout, drawGlassBackdrop, drawGlassRim, drawNoise, drawRamped, drawTextured, endKnockout, layerSpace, progressiveBackdrop, progressiveOf, rampPoints } from "./effects-render";

export const RULER_SIZE = 20;

export interface Palette {
    canvas: string;
    brand: string;
    brandSoft: string;
    label: string;
    ruler: string;
    rulerBorder: string;
    rulerText: string;
}

export const PALETTES: Record<Theme, Palette> = {
    dark: {
        canvas: "#1E1E1E",
        brand: "#0D99FF",
        brandSoft: "rgba(13, 153, 255, 0.22)",
        label: "#ADADAD",
        ruler: "#2C2C2C",
        rulerBorder: "#444444",
        rulerText: "#646464",
    },
    light: {
        canvas: "#F5F5F5",
        brand: "#0D99FF",
        brandSoft: "rgba(13, 153, 255, 0.14)",
        label: "#7F7F7F",
        ruler: "#FFFFFF",
        rulerBorder: "#E6E6E6",
        rulerText: "#B3B3B3",
    },
};

// Smart guides and measurements use a warm red in both themes, so they read as "temporary".
const GUIDE = "#F5455C";
const COMPONENT = "#B67CFF";
const VIEWER = "#9747FF";
// Selection chrome for components, instances and the layers inside them: the component purple.
const COMPONENT_CHROME = "#9747FF";

// Whether a layer is a component, a component set, an instance, or sits inside one of them.
export function inComponent(doc: NagmaDocument, node: SceneNode): boolean {
    let at: SceneNode | undefined = node;
    for (let depth = 0; at && depth < 64; depth++) {
        if (at.type === "component" || at.type === "componentSet" || at.type === "instance" || at.sourceId) return true;
        at = at.parentId ? doc.nodes[at.parentId] : undefined;
    }
    return false;
}

function chromeColor(doc: NagmaDocument, nodes: SceneNode[], palette: Palette): string {
    return nodes.length > 0 && nodes.every((n) => inComponent(doc, n)) ? COMPONENT_CHROME : palette.brand;
}

export interface Overlay {
    // Collaborators on this page: their selections and cursors.
    peers: { userId: string; name: string; color: string; cursor: { x: number; y: number } | null; selection: string[] }[];
    // Prototype tab: draw connections, and the link being dragged from the selection.
    prototype: { connecting: { from: string; cursor: { x: number; y: number } } | null } | null;
    // Point editing on a vector, or the pen's path in progress (with the pointer for the next segment).
    vectorEdit: { nodeId: string; vertices: VertexRef[]; lasso: { x: number; y: number }[] | null } | null;
    pen: { nodeId: string; cursor: { x: number; y: number } | null } | null;
    marquee: Rect | null;
    guides: Guide[];
    measures: Measure[];
    editingTextId: string | null;
    hoverId: string | null;
    selection: string[];
    rulers: boolean;
    rulerGuides: { axis: "x" | "y"; at: number }[];
    presenting: boolean;
    // View options: the pixel grid (from 800% zoom), and outlines instead of fills.
    pixelGrid: boolean;
    outlines: boolean;
    showDimensions: boolean;
    layoutGuides: boolean;
    // Pixel preview: the document rasterised at 1x (or 2x) and shown without smoothing, to see real pixels.
    pixelPreview: boolean;
    pixelPreviewScale?: number;
    // View-only files: the selection is drawn in purple without handles, with its parent dashed.
    viewOnly?: boolean;
    unmanagedColor?: boolean;
    // View menu: slices' outlines (on unless turned off), and outlines on masks and on frames.
    showSlices?: boolean;
    maskOutlines?: boolean;
    frameOutlines?: boolean;
}

// Whiteboards draw their objects' extras (sticky text, connectors, stamps...) and the dot grid
// through these hooks, set by board/paint.ts. "replace" returns true when it drew the whole layer.
export const boardPainter: {
    draw: ((ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions, phase: "replace" | "after") => boolean) | null;
    backdrop: ((ctx: CanvasRenderingContext2D, width: number, height: number, doc: NagmaDocument, camera: Camera) => void) | null;
    // A board draws its sections' titles itself (as pills); true when it did.
    sectionLabel: ((ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, rect: Rect, active: boolean) => boolean) | null;
} = { draw: null, backdrop: null, sectionLabel: null };

export interface DrawOptions {
    editingTextId: string | null;
    // Outline mode: every layer as a thin stroke, nothing filled.
    outlines?: boolean;
    // Device pixels per document unit; shadows and blur are specified in device pixels by the canvas API.
    pixelScale: number;
    // The layer whose motion blur is being applied (drawn once sharp, then smeared).
    motionSkip?: string;
    // Drawing a textured layer onto its own canvas (the texture is added after).
    textureSkip?: string;
}

function shapePath(ctx: CanvasRenderingContext2D, node: SceneNode) {
    ctx.beginPath();
    if (node.type === "vector") {
        tracePath(ctx, shapeSubpaths(node));
    } else if (node.type === "ellipse" || node.radii || node.cornerSmoothing) {
        tracePath(ctx, shapeSubpaths(node));
    } else {
        const radius = Math.max(0, Math.min(node.radius, node.w / 2, node.h / 2));
        ctx.roundRect(node.x, node.y, node.w, node.h, radius);
    }
}

type Box = { x: number; y: number; w: number; h: number };

// The canvas style for a solid or gradient paint laid over a box.
function paintStyle(ctx: CanvasRenderingContext2D, paint: Paint, box: Box): string | CanvasGradient {
    if (paint.type === "solid") return paintColor(paint.color);
    if (paint.type === "image" || paint.type === "pattern" || paint.type === "shader") return "transparent";
    return gradientStyle(ctx, paint, box);
}

// The canvas operation for a blend mode.
function compositeOf(mode: BlendMode): GlobalCompositeOperation {
    if (mode === "normal" || mode === "pass-through") return "source-over";
    if (mode === "plus-lighter") return "lighter";
    if (mode === "plus-darker") return "multiply";
    return mode;
}


const blendCanvases: HTMLCanvasElement[] = [];
let blendDepth = 0;

// Starts drawing something with a blend mode. Most modes are a canvas operation; plus darker
// (add the colours and subtract white) has none, so it is drawn on a scratch canvas first and
// composited by endBlend. Pair every call with endBlend.
function beginBlend(ctx: CanvasRenderingContext2D, mode: BlendMode): CanvasRenderingContext2D {
    if (mode !== "plus-darker" || !ctx.canvas.width || !ctx.canvas.height) {
        ctx.save();
        ctx.globalCompositeOperation = compositeOf(mode);
        return ctx;
    }
    const level = blendDepth++;
    const canvas = scratch(blendCanvases[level] ?? null, ctx.canvas);
    blendCanvases[level] = canvas;
    const c = canvas.getContext("2d") as CanvasRenderingContext2D;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.filter = "none";
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(ctx.getTransform());
    c.globalAlpha = ctx.globalAlpha;
    c.filter = ctx.filter;
    c.save();
    return c;
}

function endBlend(ctx: CanvasRenderingContext2D, c: CanvasRenderingContext2D) {
    c.restore();
    if (c === ctx) return;
    blendDepth--;
    compositePlusDarker(ctx, c.canvas);
}

let darkerBase: HTMLCanvasElement | null = null;
let darkerWork: HTMLCanvasElement | null = null;

// Plus darker: max(0, backdrop + source - 1), weighted by the source's alpha. Worked out on a copy
// of the canvas through inverting (white minus the backdrop, plus white minus the source, clamped
// by "lighter", then inverted back), keeping the backdrop's own alpha.
function compositePlusDarker(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement) {
    const main = ctx.canvas;
    darkerBase = scratch(darkerBase, main);
    darkerWork = scratch(darkerWork, main);
    const b = darkerBase.getContext("2d");
    const w = darkerWork.getContext("2d");
    if (!b || !w) return;
    for (const c of [b, w]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.filter = "none";
        c.globalCompositeOperation = "copy";
        c.drawImage(main, 0, 0);
    }
    w.globalCompositeOperation = "difference";
    w.fillStyle = "#FFFFFF";
    w.fillRect(0, 0, main.width, main.height);
    w.globalCompositeOperation = "lighter";
    w.filter = "invert(1)";
    w.drawImage(src, 0, 0);
    w.filter = "none";
    w.globalCompositeOperation = "difference";
    w.fillRect(0, 0, main.width, main.height);
    w.globalCompositeOperation = "destination-in";
    w.drawImage(darkerBase, 0, 0);
    // Where nothing was underneath, the source shows as it is.
    w.globalCompositeOperation = "destination-over";
    w.drawImage(src, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(darkerWork, 0, 0);
    ctx.restore();
}

// A video's adjustments can't be baked into its frames, so they draw through a filter that
// approximates the image sliders (exposure, contrast, saturation, temperature, tint, highlights
// and shadows, each -100 to 100).
function videoAdjustFilter(a: NonNullable<Extract<Paint, { type: "image" }>["adjust"]>): string {
    const parts = [
        `brightness(${(1 + a.exposure / 125 + a.highlights / 400 + a.shadows / 600).toFixed(3)})`,
        `contrast(${(1 + a.contrast / 100 - a.shadows / 500 + a.highlights / 500).toFixed(3)})`,
        `saturate(${Math.max(0, 1 + a.saturation / 100).toFixed(3)})`,
    ];
    if (a.temperature > 0) parts.push(`sepia(${(a.temperature / 250).toFixed(3)})`);
    if (a.temperature < 0) parts.push(`hue-rotate(${(a.temperature * 0.2).toFixed(1)}deg)`);
    if (a.tint) parts.push(`hue-rotate(${(a.tint * 0.3).toFixed(1)}deg)`);
    return parts.join(" ");
}

// Draws an image paint inside the current clip: "fill" crops to cover the box, "fit" letterboxes.
function drawImagePaint(ctx: CanvasRenderingContext2D, doc: NagmaDocument, paint: Extract<Paint, { type: "image" }>, box: Box) {
    if (paint.video && paint.adjust) {
        ctx.save();
        ctx.filter = videoAdjustFilter(paint.adjust);
        drawImagePaintRaw(ctx, doc, paint, box);
        ctx.restore();
        return;
    }
    drawImagePaintRaw(ctx, doc, paint, box);
}

function drawImagePaintRaw(ctx: CanvasRenderingContext2D, doc: NagmaDocument, paint: Extract<Paint, { type: "image" }>, box: Box) {
    // A playing video draws its current frame instead of the poster.
    const frame = paint.video ? liveFrame(paint.id) : gifFrame(doc, paint.id);
    const img = getImage(doc, paint.id);
    const src = frame ?? img;
    if (!src) {
        ctx.fillStyle = "rgba(128, 128, 128, 0.25)";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        return;
    }
    const nw = src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : (src as HTMLCanvasElement).width;
    const nh = src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : (src as HTMLCanvasElement).height;
    if (!nw || !nh) return;
    if (paint.mode === "tile") {
        // A pattern fill: the image repeats from the box's corner at the chosen scale.
        const pattern = ctx.createPattern(src as CanvasImageSource, "repeat");
        if (!pattern) return;
        const k = paint.tileScale ?? 0.5;
        const turn = paint.rotation ?? 0;
        // A turned tile pivots on its own corner, then shifts back so it still starts at the box's corner.
        const shift = turn === 90 ? [nh * k, 0] : turn === 180 ? [nw * k, nh * k] : turn === 270 ? [0, nw * k] : [0, 0];
        pattern.setTransform(new DOMMatrix().translate(box.x + (shift[0] ?? 0), box.y + (shift[1] ?? 0)).rotate(turn).scale(k, k));
        ctx.fillStyle = pattern;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        return;
    }
    if (paint.mode === "crop" && paint.crop) {
        // The crop maps layer space to image space; draw the image through its inverse.
        const [a, b, c, d, e, f] = paint.crop;
        const toImage = new DOMMatrix([a, d, b, e, c, f]);
        if (Math.abs(a * e - b * d) > 1e-9) {
            const m = new DOMMatrix().translate(box.x, box.y).scale(box.w, box.h).multiply(toImage.inverse()).scale(1 / nw, 1 / nh);
            ctx.save();
            ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(src, 0, 0);
            ctx.restore();
            return;
        }
    }
    const turn = paint.mode === "crop" ? 0 : (paint.rotation ?? 0);
    // The turned image's bounding box decides how it fits or fills (a quarter turn swaps the sides).
    const rad = (turn * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const fw = nw * cos + nh * sin;
    const fh = nw * sin + nh * cos;
    // Fill covers the box with the turned image: the box turned back must fit inside the image.
    const scale = paint.mode === "fit" ? Math.min(box.w / fw, box.h / fh) : Math.max((box.w * cos + box.h * sin) / nw, (box.w * sin + box.h * cos) / nh);
    const w = nw * scale;
    const h = nh * scale;
    ctx.imageSmoothingQuality = "high";
    if (!turn) {
        ctx.drawImage(src, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
        return;
    }
    ctx.save();
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    ctx.restore();
}

// Paints a shape's fills bottom to top, each with its own opacity and blend mode. The drop shadow
// is cast by the first visible paint.
function drawFills(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, path: Path2D, pixelScale: number) {
    const box = { x: node.x, y: node.y, w: node.w, h: node.h };
    visiblePaints(node.fills).forEach((paint, i) => {
        const c = beginBlend(ctx, paint.blend);
        c.globalAlpha *= paint.opacity;
        if (i === 0) applyShadow(c, node, pixelScale);
        if (paint.type === "image") {
            if (i === 0 && node.shadow) castShadow(c, path);
            clearShadow(c);
            c.clip(path);
            drawImagePaint(c, doc, paint, box);
        } else if (paint.type === "pattern") {
            if (i === 0 && node.shadow) castShadow(c, path);
            clearShadow(c);
            c.clip(path);
            drawPatternPaint(c, doc, paint, box, pixelScale);
        } else if (paint.type === "diamond") {
            if (i === 0 && node.shadow) castShadow(c, path);
            clearShadow(c);
            c.clip(path);
            fillDiamond(c, paint, box);
        } else if (paint.type === "shader") {
            if (i === 0 && node.shadow) castShadow(c, path);
            clearShadow(c);
            c.clip(path);
            drawShaderPaint(c, `${node.id}:fill:${i}`, paint, box, pixelScale);
        } else {
            c.fillStyle = paintStyle(c, paint, box);
            c.fill(path);
        }
        endBlend(ctx, c);
    });
}

const patternBlocks = new Map<string, { nodes: object; canvas: HTMLCanvasElement }>();
const patternBusy = new Set<string>();

// A pattern paint: its source layer drawn once into a repeating block (at screen resolution, with
// the hexagonal stagger), then filled across the shape from the aligned origin.
function drawPatternPaint(c: CanvasRenderingContext2D, doc: NagmaDocument, paint: PatternPaint, box: Box, pixelScale: number) {
    const source = doc.nodes[paint.sourceId];
    if (!source || patternBusy.has(source.id)) return;
    const sb = selectionBounds(doc, [source.id]);
    const grid = sb ? patternGrid(paint, sb) : null;
    if (!sb || !grid) return;
    const res = Math.max(0.05, Math.min(pixelScale, 4096 / Math.max(grid.blockW, grid.blockH)));
    const key = `${paint.sourceId}|${paint.tile}|${paint.scale}|${paint.spacing.x},${paint.spacing.y}|${res.toFixed(3)}`;
    let entry = patternBlocks.get(key);
    if (!entry || entry.nodes !== doc.nodes) {
        const canvas = entry?.canvas ?? document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(grid.blockW * res));
        canvas.height = Math.max(1, Math.ceil(grid.blockH * res));
        const b = canvas.getContext("2d");
        if (!b) return;
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.clearRect(0, 0, canvas.width, canvas.height);
        const k = grid.tileW / sb.w;
        const parent = parentMatrix(doc, source);
        patternBusy.add(source.id);
        try {
            for (const copy of grid.copies) {
                b.setTransform(canvas.width / grid.blockW, 0, 0, canvas.height / grid.blockH, 0, 0);
                b.translate(copy.x, copy.y);
                b.scale(k, k);
                b.translate(-sb.x, -sb.y);
                b.transform(parent.a, parent.b, parent.c, parent.d, parent.e, parent.f);
                drawNode(b, doc, { ...source, visible: true }, { editingTextId: null, pixelScale: res * k });
            }
        } finally {
            patternBusy.delete(source.id);
        }
        entry = { nodes: doc.nodes, canvas };
        if (patternBlocks.size > 32) patternBlocks.clear();
        patternBlocks.set(key, entry);
    }
    const pattern = c.createPattern(entry.canvas, "repeat");
    if (!pattern) return;
    const o = grid.origin(box);
    pattern.setTransform(new DOMMatrix().translate(o.x, o.y).scale(grid.blockW / entry.canvas.width, grid.blockH / entry.canvas.height));
    c.fillStyle = pattern;
    c.fillRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
}

// The reference's diamond gradient: the stops run out from the centre (`from`) along diamond-shaped
// contours, |u| + |v| = t, where u runs towards `to` and v across it (both scale with the box).
// In each quarter around the centre that is an ordinary linear gradient, so four are drawn.
function fillDiamond(c: CanvasRenderingContext2D, paint: GradientPaint, box: Box) {
    const cx = box.x + paint.from.x * box.w;
    const cy = box.y + paint.from.y * box.h;
    const dn = { x: paint.to.x - paint.from.x, y: paint.to.y - paint.from.y };
    const len2 = dn.x * dn.x + dn.y * dn.y;
    if (len2 < 1e-9) return;
    const en = { x: -dn.y, y: dn.x };
    const dp = { x: dn.x * box.w, y: dn.y * box.h };
    const ep = { x: en.x * box.w, y: en.y * box.h };
    const far = 1e4 / Math.max(1e-6, Math.min(Math.hypot(dp.x, dp.y), Math.hypot(ep.x, ep.y)));
    const stops = [...paint.stops].sort((p, q) => p.position - q.position);
    for (const su of [1, -1]) {
        for (const sv of [1, -1]) {
            // t = g · (p - centre) in this quarter.
            const gn = { x: (su * dn.x + sv * en.x) / len2, y: (su * dn.y + sv * en.y) / len2 };
            const gp = { x: gn.x / box.w, y: gn.y / box.h };
            const g2 = gp.x * gp.x + gp.y * gp.y;
            if (g2 < 1e-12) continue;
            const grad = c.createLinearGradient(cx, cy, cx + gp.x / g2, cy + gp.y / g2);
            for (const stop of stops) grad.addColorStop(Math.min(1, Math.max(0, stop.position)), hexToRgba(stop.color, stop.opacity));
            c.save();
            c.beginPath();
            c.moveTo(cx, cy);
            c.lineTo(cx + su * dp.x * far, cy + su * dp.y * far);
            c.lineTo(cx + (su * dp.x + sv * ep.x) * far, cy + (su * dp.y + sv * ep.y) * far);
            c.lineTo(cx + sv * ep.x * far, cy + sv * ep.y * far);
            c.closePath();
            c.clip();
            c.fillStyle = grad;
            c.fillRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
            c.restore();
        }
    }
}

// Effects beyond the layer's own shadow and blur: more drop shadows, inner shadows, background blur.
function drawEffectsBelow(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D, pixelScale: number) {
    for (const e of node.effects ?? []) {
        if (!e.visible) continue;
        if (e.type === "glass") drawGlassBackdrop(ctx, node, path, e, pixelScale);
        else if (e.type === "background-blur" && e.progressive) progressiveBackdrop(ctx, node, path, e, pixelScale);
        else if (e.type === "background-blur") {
            // What's already drawn under the shape, blurred, inside the shape.
            if (!ctx.canvas.width || !ctx.canvas.height) continue;
            ctx.save();
            ctx.clip(path);
            const t = ctx.getTransform();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            // The reference's blur radius is twice the Gaussian's deviation (CSS blur takes the deviation).
            ctx.filter = `blur(${Math.max(0.5, (e.blur / 2) * pixelScale)}px)`;
            ctx.drawImage(ctx.canvas, 0, 0);
            ctx.setTransform(t);
            ctx.restore();
        } else if (e.type === "drop-shadow" && e.showBehind === false) {
            // Cut out under the layer: the shadow goes on its own canvas first.
            const k = beginKnockout(ctx);
            if (!k) continue;
            k.shadowColor = hexToRgba(e.color, e.opacity);
            k.shadowOffsetX = e.x * pixelScale;
            k.shadowOffsetY = e.y * pixelScale;
            k.shadowBlur = e.blur * pixelScale;
            if (e.spread) castSpreadShadow(k, (c) => {
                c.fillStyle = "#000";
                c.fill(path);
                spreadEdge(c, path, e.spread);
            });
            else castShadow(k, path);
            const mode = e.blend ?? "normal";
            endKnockout(ctx, k, (c) => c.fill(path), mode === "plus-darker" ? "multiply" : compositeOf(mode));
        } else if (e.type === "drop-shadow") {
            const g = beginBlend(ctx, e.blend ?? "normal");
            g.shadowColor = hexToRgba(e.color, e.opacity);
            g.shadowOffsetX = e.x * pixelScale;
            g.shadowOffsetY = e.y * pixelScale;
            g.shadowBlur = e.blur * pixelScale;
            if (e.spread) castSpreadShadow(g, (c) => {
                c.fillStyle = "#000";
                c.fill(path);
                spreadEdge(c, path, e.spread);
            });
            else castShadow(g, path);
            endBlend(ctx, g);
        }
    }
}

function drawEffectsAbove(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D, pixelScale: number) {
    for (const e of node.effects ?? []) {
        if (!e.visible) continue;
        if (e.type === "noise") {
            const g = beginBlend(ctx, e.blend ?? "normal");
            drawNoise(g, node, path, e);
            endBlend(ctx, g);
        } else if (e.type === "shader" && e.shader) {
            // The shader reads the layer as drawn so far and paints over it, inside its shape.
            const g = beginBlend(ctx, e.blend ?? "normal");
            g.globalAlpha *= e.opacity;
            g.clip(path);
            drawShaderEffect(g, `${node.id}:effect:${e.shader.code.length}`, e.shader, { x: node.x, y: node.y, w: node.w, h: node.h });
            endBlend(ctx, g);
        }
        else if (e.type === "glass") drawGlassRim(ctx, node, path, e, pixelScale);
        else if (e.type === "inner-shadow") {
            // The shadow of everything outside the shape, seen only inside it.
            const g = beginBlend(ctx, e.blend ?? "normal");
            g.clip(path);
            g.shadowColor = hexToRgba(e.color, e.opacity);
            g.shadowOffsetX = e.x * pixelScale;
            g.shadowOffsetY = e.y * pixelScale;
            g.shadowBlur = e.blur * pixelScale;
            // A ring just around the shape (not the whole plane), so the ring itself stays off-canvas
            // after the far translate while its shadow lands back on the shape.
            const reach = e.blur * 3 + Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.spread) + 8;
            if (e.spread) {
                // Spread moves the edge of what casts the shadow into the shape (or out of it).
                castSpreadShadow(g, (c) => {
                    c.fillStyle = "#000";
                    c.fillRect(node.x - reach, node.y - reach, node.w + reach * 2, node.h + reach * 2);
                    c.globalCompositeOperation = "destination-out";
                    c.fill(path);
                    c.globalCompositeOperation = "source-over";
                    spreadEdge(c, path, e.spread);
                });
                endBlend(ctx, g);
                continue;
            }
            const outside = new Path2D();
            outside.rect(node.x - reach, node.y - reach, node.w + reach * 2, node.h + reach * 2);
            outside.addPath(path);
            const far = 100000;
            const m = g.getTransform();
            g.shadowOffsetX += m.a * far;
            g.shadowOffsetY += m.b * far;
            g.translate(-far, 0);
            g.fillStyle = "#000";
            g.fill(outside, "evenodd");
            endBlend(ctx, g);
        }
    }
}

let spreadCanvas: HTMLCanvasElement | null = null;

// Grows (positive) or shrinks (negative) what was just filled by `amount` around the outline.
function spreadEdge(c: CanvasRenderingContext2D, path: Path2D, amount: number) {
    if (!amount) return;
    c.save();
    c.lineWidth = Math.abs(amount) * 2;
    c.lineJoin = "round";
    c.strokeStyle = "#000";
    c.globalCompositeOperation = amount > 0 ? "source-over" : "destination-out";
    c.stroke(path);
    c.restore();
}

// Casts only the shadow of a shape drawn by `draw` (in the current space) on a scratch canvas, so
// the shape can be grown or shrunk first for a shadow's spread.
function castSpreadShadow(ctx: CanvasRenderingContext2D, draw: (c: CanvasRenderingContext2D) => void) {
    if (!ctx.canvas.width || !ctx.canvas.height) return;
    spreadCanvas = scratch(spreadCanvas, ctx.canvas);
    const c = spreadCanvas.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.clearRect(0, 0, spreadCanvas.width, spreadCanvas.height);
    c.setTransform(ctx.getTransform());
    draw(c);
    const far = 100000;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowOffsetX += far;
    ctx.drawImage(spreadCanvas, -far, 0);
    ctx.restore();
}

// Arrow heads and dots at the ends of open paths, sized by the stroke weight.
function drawEndCaps(ctx: CanvasRenderingContext2D, node: SceneNode) {
    if (node.type !== "vector" || node.strokeWidth <= 0) return;
    const start = node.strokeCapStart ?? "none";
    const end = node.strokeCapEnd ?? "none";
    if (start === "none" && end === "none") return;
    const paint = visiblePaints(node.strokes).find((p) => p.type !== "image");
    if (!paint) return;
    const size = Math.max(4, node.strokeWidth * 4);
    const w = node.strokeWidth;
    const draw = (cap: EndCap, tip: { x: number; y: number }, from: { x: number; y: number }) => {
        if (cap === "none") return;
        const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
        if (cap === "round" || cap === "square") {
            // On top of the line's own cap: a half disc, or the line carried on half its width.
            ctx.save();
            ctx.translate(tip.x, tip.y);
            ctx.rotate(angle);
            ctx.fillStyle = paintStyle(ctx, paint, { x: -size, y: -size, w: size * 2, h: size * 2 });
            ctx.beginPath();
            if (cap === "round") ctx.arc(0, 0, w / 2, -Math.PI / 2, Math.PI / 2);
            else ctx.rect(0, -w / 2, w / 2, w);
            ctx.fill();
            ctx.restore();
            return;
        }
        ctx.save();
        ctx.translate(tip.x, tip.y);
        ctx.rotate(angle);
        ctx.fillStyle = paintStyle(ctx, paint, { x: -size, y: -size, w: size * 2, h: size * 2 });
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = w;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        if (cap === "arrow-lines") {
            ctx.moveTo(-size, -size * 0.7);
            ctx.lineTo(0, 0);
            ctx.lineTo(-size, size * 0.7);
            ctx.stroke();
        } else if (cap === "arrow-equilateral" || cap === "triangle") {
            ctx.moveTo(0, 0);
            ctx.lineTo(-size, -size * 0.58);
            ctx.lineTo(-size, size * 0.58);
            ctx.closePath();
            ctx.fill();
        } else if (cap === "circle") {
            ctx.arc(-size * 0.4, 0, size * 0.4, 0, Math.PI * 2);
            ctx.fill();
        } else if (cap === "diamond") {
            ctx.moveTo(0, 0);
            ctx.lineTo(-size * 0.5, -size * 0.5);
            ctx.lineTo(-size, 0);
            ctx.lineTo(-size * 0.5, size * 0.5);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    };
    for (const pts of samplePath(placedSubpaths(node), 8)) {
        if (pts.length < 2) continue;
        const first = pts[0] as { x: number; y: number };
        const second = pts[1] as { x: number; y: number };
        const last = pts[pts.length - 1] as { x: number; y: number };
        const before = pts[pts.length - 2] as { x: number; y: number };
        draw(start, first, second);
        draw(end, last, before);
    }
}

// Draws only the shadow of a shape: the shape itself goes far off-canvas and its shadow is offset
// back by the same distance in device pixels (works under any rotation or zoom).
function castShadow(ctx: CanvasRenderingContext2D, path: Path2D) {
    const far = 100000;
    const m = ctx.getTransform();
    ctx.save();
    ctx.shadowOffsetX += m.a * far;
    ctx.shadowOffsetY += m.b * far;
    ctx.translate(-far, 0);
    ctx.fillStyle = "#000";
    ctx.fill(path);
    ctx.restore();
}

// A stroke's outline as sampled polylines, each point with its place along the whole outline (0 to
// 1). With a trim, only the part between trimStart and trimEnd is kept.
interface StrokePiece {
    pts: { x: number; y: number }[];
    t: number[];
}

function isTrimmed(node: SceneNode): boolean {
    return (node.trimStart ?? 0) > 0.0001 || (node.trimEnd ?? 1) < 0.9999;
}

function strokePieces(node: SceneNode): StrokePiece[] {
    const subpaths = shapeSubpaths(node);
    const lines = samplePath(subpaths, 16);
    const lengths = lines.map((pts) => {
        const l = [0];
        for (let i = 1; i < pts.length; i++) l.push((l[i - 1] ?? 0) + Math.hypot((pts[i]?.x ?? 0) - (pts[i - 1]?.x ?? 0), (pts[i]?.y ?? 0) - (pts[i - 1]?.y ?? 0)));
        return l;
    });
    const total = lengths.reduce((sum, l) => sum + (l[l.length - 1] ?? 0), 0) || 1;
    const a = Math.max(0, Math.min(1, Math.min(node.trimStart ?? 0, node.trimEnd ?? 1))) * total;
    const b = Math.max(0, Math.min(1, Math.max(node.trimStart ?? 0, node.trimEnd ?? 1))) * total;
    const out: StrokePiece[] = [];
    let offset = 0;
    lines.forEach((pts, li) => {
        const l = lengths[li] ?? [0];
        let run: StrokePiece | null = null;
        for (let i = 0; i + 1 < pts.length; i++) {
            const d0 = offset + (l[i] ?? 0);
            const d1 = offset + (l[i + 1] ?? 0);
            if (d1 < a || d0 > b) {
                if (run) out.push(run);
                run = null;
                continue;
            }
            const p = pts[i] as { x: number; y: number };
            const q = pts[i + 1] as { x: number; y: number };
            const at = (d: number) => {
                const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
                return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
            };
            const from = Math.max(a, d0);
            const to = Math.min(b, d1);
            if (!run) run = { pts: [at(from)], t: [from / total] };
            run.pts.push(at(to));
            run.t.push(to / total);
        }
        if (run) out.push(run);
        offset += l[l.length - 1] ?? 0;
    });
    return out.filter((piece) => piece.pts.length > 1);
}

// A variable-width stroke as a filled ribbon: the outline sampled, widened by the profile's
// multipliers (start, middle, end) along the whole outline's length.
function ribbonPath(node: SceneNode): Path2D | null {
    // Draw mode's dynamic strokes and brushes are filled outlines too (engine/stroke-styles.ts).
    if (hasStyledStroke(node)) {
        const out = new Path2D();
        for (const poly of styledStrokePolygons(node, strokePieces(node)) ?? []) {
            out.moveTo(poly[0]?.x ?? 0, poly[0]?.y ?? 0);
            for (const p of poly.slice(1)) out.lineTo(p.x, p.y);
            out.closePath();
        }
        return out;
    }
    // Width points (engine/width-profile.ts); older files' start/middle/end profile reads as three.
    const points = node.type === "vector" ? widthPointsOf(node) : null;
    if (!points) return null;
    const widthAt = (t: number) => (node.strokeWidth * Math.max(0, widthAtT(points, t))) / 2;
    const out = new Path2D();
    for (const { pts, t } of strokePieces(node)) {
        const w = t.map(widthAt);
        const poly = band(pts, w, w, node.strokeCap === "round");
        out.moveTo(poly[0]?.x ?? 0, poly[0]?.y ?? 0);
        for (const p of poly.slice(1)) out.lineTo(p.x, p.y);
        out.closePath();
    }
    return out;
}

// A trimmed stroke's visible part as open lines.
function trimmedPath(node: SceneNode): Path2D {
    const out = new Path2D();
    for (const { pts } of strokePieces(node)) {
        out.moveTo(pts[0]?.x ?? 0, pts[0]?.y ?? 0);
        for (const p of pts.slice(1)) out.lineTo(p.x, p.y);
    }
    return out;
}

// Only some sides of a rectangle or frame: the stroke becomes straight lines on those edges.
function sidesPath(node: SceneNode): Path2D | null {
    const sides = node.strokeSides;
    if (!sides || (node.type !== "rect" && !isFrameLike(node)) || (sides.top && sides.right && sides.bottom && sides.left)) return null;
    const p = new Path2D();
    const { x, y, w, h } = node;
    if (sides.top) {
        p.moveTo(x, y);
        p.lineTo(x + w, y);
    }
    if (sides.right) {
        p.moveTo(x + w, y);
        p.lineTo(x + w, y + h);
    }
    if (sides.bottom) {
        p.moveTo(x, y + h);
        p.lineTo(x + w, y + h);
    }
    if (sides.left) {
        p.moveTo(x, y);
        p.lineTo(x, y + h);
    }
    return p;
}

function drawStrokes(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D) {
    if (node.strokeWidth <= 0 && !node.strokeWeights) return;
    const box = { x: node.x, y: node.y, w: node.w, h: node.h };
    const dashes = dashOf(node);
    // Sides stroked unevenly (some off, or Custom weights): the band they cover is filled, which
    // keeps rounded corners and each side's own weight. Dashed sides fall back to lines.
    const weights = !dashes && !isTrimmed(node) ? sideWeights(node, isFrameLike(node)) : null;
    if (weights) {
        const band = new Path2D(sideBandD(node, weights));
        for (const paint of visiblePaints(node.strokes)) {
            if (paint.type === "image" || paint.type === "pattern" || paint.type === "shader") continue;
            const c = beginBlend(ctx, paint.blend);
            c.globalAlpha *= paint.opacity;
            c.fillStyle = paintStyle(c, paint, box);
            c.fill(band, "evenodd");
            endBlend(ctx, c);
        }
        return;
    }
    const ribbon = ribbonPath(node);
    if (ribbon) {
        for (const paint of visiblePaints(node.strokes)) {
            if (paint.type === "image" || paint.type === "shader") continue;
            const c = beginBlend(ctx, paint.blend);
            c.globalAlpha *= paint.opacity;
            c.fillStyle = paintStyle(c, paint, box);
            c.fill(ribbon);
            endBlend(ctx, c);
        }
        return;
    }
    const trim = isTrimmed(node);
    if (trim) path = trimmedPath(node);
    const sides = trim ? null : sidesPath(node);
    const open = trim || (node.type === "vector" && node.path?.subpaths.some((sub) => !sub.closed)) || sides !== null;
    const align = open ? "center" : node.strokeAlign;
    for (const paint of visiblePaints(node.strokes)) {
        if (paint.type === "image" || paint.type === "pattern" || paint.type === "shader") continue;
        const c = beginBlend(ctx, paint.blend);
        c.globalAlpha *= paint.opacity;
        c.strokeStyle = paintStyle(c, paint, box);
        c.lineWidth = align === "center" ? node.strokeWidth : node.strokeWidth * 2;
        c.lineJoin = node.strokeJoin ?? "miter";
        c.miterLimit = miterLimitOf(node);
        c.lineCap = node.strokeCap ?? "butt";
        if (dashes) c.setLineDash(dashes);
        if (align === "inside") c.clip(path);
        if (align === "outside") {
            const outside = new Path2D();
            outside.rect(-1e7, -1e7, 2e7, 2e7);
            outside.addPath(path);
            c.clip(outside, "evenodd");
        }
        if (sides) {
            // Inside/outside positions are kept by clipping to the shape, as for whole strokes.
            c.lineWidth = node.strokeAlign === "center" ? node.strokeWidth : node.strokeWidth * 2;
            if (node.strokeAlign === "inside") c.clip(path);
            if (node.strokeAlign === "outside") {
                const outside = new Path2D();
                outside.rect(-1e7, -1e7, 2e7, 2e7);
                outside.addPath(path);
                c.clip(outside, "evenodd");
            }
            c.stroke(sides);
        } else c.stroke(path);
        endBlend(ctx, c);
    }
}

function scratch(existing: HTMLCanvasElement | null, like: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = existing ?? document.createElement("canvas");
    if (canvas.width !== like.width || canvas.height !== like.height) {
        canvas.width = like.width;
        canvas.height = like.height;
    }
    return canvas;
}

// Draws a boolean: its children's shapes combined into real paths (engine/clip.ts), then painted
// with the boolean's own fills, strokes and effects like any other shape.
function drawBoolean(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions) {
    const path = new Path2D();
    tracePath(path, booleanResult(doc, node));
    if (options.outlines) {
        ctx.save();
        ctx.lineWidth = 1 / options.pixelScale;
        ctx.strokeStyle = "#999999";
        ctx.stroke(path);
        ctx.restore();
        return;
    }
    drawEffectsBelow(ctx, node, path, options.pixelScale);
    drawFills(ctx, doc, node, path, options.pixelScale);
    drawEffectsAbove(ctx, node, path, options.pixelScale);
    drawStrokes(ctx, node, path);
}

function drawText(ctx: CanvasRenderingContext2D, node: SceneNode, pixelScale: number) {
    drawTextLayer(ctx, node, pixelScale, staggerTimeOf(node));
}

// Text on a path: each glyph sits on the outline of another layer, turned to follow it. The text
// and the path share a parent, so the path's points are already in this space.
function drawTextOnPath(ctx: CanvasRenderingContext2D, node: SceneNode, target: SceneNode, pixelScale: number) {
    const style = styleOf(node);
    if (style.family !== DEFAULT_FAMILY) ensureFont(style.family, () => editor.refreshText());
    const subpaths = target.type === "vector" ? placedSubpaths(target) : shapeSubpaths(target);
    const m = localMatrix(target);
    const points = samplePath(subpaths, 24)
        .flat()
        .map((p) => (m.isIdentity ? p : apply(m, p.x, p.y)));
    if (points.length < 2) return;
    const lengths: number[] = [0];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1] as { x: number; y: number };
        const b = points[i] as { x: number; y: number };
        lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const total = lengths[lengths.length - 1] ?? 0;
    const at = (d: number) => {
        const dd = Math.max(0, Math.min(total, d));
        let i = 1;
        while (i < lengths.length - 1 && (lengths[i] ?? 0) < dd) i++;
        const a = points[i - 1] as { x: number; y: number };
        const b = points[i] as { x: number; y: number };
        const la = lengths[i - 1] ?? 0;
        const lb = lengths[i] ?? la + 1;
        const t = lb > la ? (dd - la) / (lb - la) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const paint = visiblePaints(node.fills).find((p) => p.type !== "image");
    if (!paint) return;
    const text = node.text ?? "";
    ctx.save();
    ctx.font = fontString(style.size, style.weight, style.family, style.italic);
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha *= paint.opacity;
    ctx.fillStyle = paintStyle(ctx, paint, { x: node.x, y: node.y, w: node.w, h: node.h });
    applyShadow(ctx, node, pixelScale);
    const widths = [...text].map((ch) => ctx.measureText(ch).width + style.tracking);
    const used = widths.reduce((a, b) => a + b, 0);
    // The start offset moves the text along the path (from its aligned place).
    let d = (node.textAlign === "center" ? (total - used) / 2 : node.textAlign === "right" ? total - used : 0) + (node.textPathStart ?? 0) * total;
    [...text].forEach((ch, i) => {
        const w = widths[i] ?? 0;
        const p = at(d + w / 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillText(ch, -w / 2, -style.size * 0.15);
        strokeText(ctx, node, { font: ctx.font, tracking: style.tracking, caps: "normal", wordSpacing: 0 }, ch, -w / 2, -style.size * 0.15, { x: -w, y: -style.size, w: w * 2, h: style.size * 2 }, false);
        ctx.restore();
        d += w;
    });
    ctx.restore();
}

function shapePath2D(node: SceneNode): Path2D {
    const path = new Path2D();
    if (node.type === "vector") tracePath(path, shapeSubpaths(node));
    else if (node.type === "ellipse" || node.radii || node.cornerSmoothing) tracePath(path, shapeSubpaths(node));
    else path.roundRect(node.x, node.y, node.w, node.h, Math.max(0, Math.min(node.radius, node.w / 2, node.h / 2)));
    return path;
}

// A vector filled region by region (vector networks) fills only those regions.
function fillPath2D(node: SceneNode): Path2D | null {
    if (node.type !== "vector" || !node.regionFills) return null;
    const subs = regionFillSubpaths(node, placedSubpaths(node));
    if (!subs) return null;
    const path = new Path2D();
    tracePath(path, subs);
    return path;
}

function applyShadow(ctx: CanvasRenderingContext2D, node: SceneNode, pixelScale: number) {
    const s = node.shadow;
    if (!s) return;
    ctx.shadowColor = hexToRgba(s.color, s.opacity);
    ctx.shadowOffsetX = s.x * pixelScale;
    ctx.shadowOffsetY = s.y * pixelScale;
    ctx.shadowBlur = s.blur * pixelScale;
}

function clearShadow(ctx: CanvasRenderingContext2D) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

// A Live frame's content: the last picture its code sent back, clipped to the frame's shape. Until
// there is one, a placeholder with the frame's name and the lightning mark.
function drawLiveContent(ctx: CanvasRenderingContext2D, node: SceneNode, path: Path2D, pixelScale: number) {
    if (skipSnapshot(node.id)) return;
    ctx.save();
    ctx.clip(path);
    const img = liveSnapshot(node.id);
    if (img) {
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, node.x, node.y, node.w, node.h);
        ctx.restore();
        return;
    }
    ctx.fillStyle = "rgba(112, 72, 232, 0.06)";
    ctx.fillRect(node.x, node.y, node.w, node.h);
    const size = Math.min(14, Math.max(6, node.h / 6));
    if (size * pixelScale >= 4) {
        ctx.fillStyle = "rgba(90, 60, 190, 0.75)";
        ctx.font = fontString(size, 500);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`ϟ ${node.name}`, node.x + node.w / 2, node.y + node.h / 2, Math.max(1, node.w - 8));
    }
    ctx.restore();
}

// Draws a layer and its children in the current space (the layer's parent space).
export function drawNode(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions): void {
    if (!node.visible) return;
    if (options.motionSkip !== node.id && ctx.canvas.width && ctx.canvas.height) {
        const motion = (node.effects ?? []).find((e) => e.visible && e.type === "motion-blur" && e.blur > 0);
        if (motion) return drawMotionBlurred(ctx, doc, node, options, motion);
    }
    if (needsIsolation(doc, node) && ctx.canvas.width && ctx.canvas.height) return drawIsolated(ctx, doc, node, options);
    // A layer blur blurs the finished layer (fills, inside or outside strokes, effects, children), as
    // in the reference: drawn sharp on its own canvas first, then blurred onto this one.
    // Texture roughens the finished layer; a progressive layer blur ramps across it.
    if (options.textureSkip !== node.id && ctx.canvas.width && ctx.canvas.height && !options.outlines) {
        const texture = (node.effects ?? []).find((e) => e.visible && e.type === "texture" && e.blur > 0);
        if (texture) return drawTexturedNode(ctx, doc, node, options, texture);
    }
    const ramp = (node.effects ?? []).find((e) => e.visible && e.type === "layer-blur" && e.progressive);
    if (ramp && ctx.canvas.width && ctx.canvas.height) return drawProgressiveBlurred(ctx, doc, node, options, ramp);
    const blur = node.blur + (node.effects ?? []).filter((e) => e.visible && e.type === "layer-blur").reduce((sum, e) => sum + e.blur, 0);
    if (blur > 0 && ctx.canvas.width && ctx.canvas.height) return drawBlurred(ctx, doc, node, options, blur);
    // A frame or group casts its drop shadows from what it shows (its fill and its children), as in
    // The reference: a frame with no fill and glowing shadows makes its contents glow.
    if (node.children.length > 0 && node.type !== "boolean" && ctx.canvas.width && ctx.canvas.height && (node.shadow || (node.effects ?? []).some((e) => e.visible && e.type === "drop-shadow"))) {
        return drawShadowedContainer(ctx, doc, node, options);
    }
    ctx.save();
    const m = localMatrix(node);
    if (!m.isIdentity) ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha *= node.opacity;
    if (blur > 0) ctx.filter = `blur(${(blur / 2) * options.pixelScale}px)`;

    if (node.isSlice) {
        // A slice is only an export region; the chrome pass outlines it.
    } else if (node.type === "text") {
        const target = node.pathId ? doc.nodes[node.pathId] : undefined;
        // Text being edited is drawn too: the editor only adds the caret and selection over it.
        if (target) drawTextOnPath(ctx, node, target, options.pixelScale);
        else drawText(ctx, node, options.pixelScale);
        // Shader effects read the finished text and paint over its box.
        if (!options.outlines && (node.effects ?? []).some((e) => e.visible && e.type === "shader" && e.shader)) {
            const box = new Path2D();
            box.rect(node.x, node.y, node.w, node.h);
            drawEffectsAbove(ctx, { ...node, effects: (node.effects ?? []).filter((e) => e.type === "shader") }, box, options.pixelScale);
        }
    } else if (node.type === "boolean") {
        drawBoolean(ctx, doc, node, options);
    } else if (node.jam && boardPainter.draw?.(ctx, doc, node, options, "replace")) {
        // Drawn whole by the board painter (connectors, stamps, tables, tape).
    } else if (node.type !== "group") {
        const path = shapePath2D(node);
        if (options.outlines) {
            ctx.save();
            ctx.lineWidth = 1 / options.pixelScale;
            ctx.strokeStyle = "#999999";
            ctx.stroke(path);
            ctx.restore();
        } else {
            drawEffectsBelow(ctx, node, path, options.pixelScale);
            drawFills(ctx, doc, node, fillPath2D(node) ?? path, options.pixelScale);
            if (node.type === "live") drawLiveContent(ctx, node, path, options.pixelScale);
            drawEffectsAbove(ctx, node, path, options.pixelScale);
            drawStrokes(ctx, node, path);
            drawEndCaps(ctx, node);
            if (node.jam) boardPainter.draw?.(ctx, doc, node, options, "after");
        }
    }

    // A boolean's children only contribute their shapes; they aren't drawn themselves. A section
    // with its contents hidden draws only itself.
    if (node.children.length > 0 && node.type !== "boolean" && !(node.isSection && node.sectionContentsHidden)) {
        if (isFrameLike(node) && node.clip && !node.isSection) {
            shapePath(ctx, node);
            ctx.clip();
        }
        drawChildren(ctx, doc, node, options);
    }
    ctx.restore();
}

// Blend modes and isolation: a layer with a blend mode is drawn on its own and then
// mixed with what is behind it. Frames and groups default to pass through, so their children
// blend straight into the backdrop; a frame or group set to Normal is a closed group (its children
// blend only with each other). Opacity below 100% on a frame or group always fades it as a whole.
const innerBlendCache = new WeakMap<object, Map<string, boolean>>();

function blends(node: SceneNode): boolean {
    if (node.blendMode !== "normal" && node.blendMode !== "pass-through") return true;
    return node.fills.some((p) => p.blend !== "normal") || node.strokes.some((p) => p.blend !== "normal") || (node.effects ?? []).some((e) => e.blend && e.blend !== "normal");
}

function hasInnerBlend(doc: NagmaDocument, node: SceneNode): boolean {
    let cache = innerBlendCache.get(doc.nodes);
    if (!cache) {
        cache = new Map();
        innerBlendCache.set(doc.nodes, cache);
    }
    const hit = cache.get(node.id);
    if (hit !== undefined) return hit;
    const result = node.children.some((id) => {
        const child = doc.nodes[id];
        return Boolean(child && child.visible && (blends(child) || hasInnerBlend(doc, child)));
    });
    cache.set(node.id, result);
    return result;
}

export function needsIsolation(doc: NagmaDocument, node: SceneNode): boolean {
    const mode = node.blendMode;
    const container = node.children.length > 0 && node.type !== "boolean";
    // Opacity on a frame or group applies to it as a whole, pass through or not (as the SVG export
    // and CSS do): faded per child, overlapping children showed through each other.
    if (mode === "pass-through") return container && node.opacity < 1 && layersShown(doc, node) > 1;
    if (mode !== "normal") return true;
    return container && (node.opacity < 1 || hasInnerBlend(doc, node));
}

// How many things a container draws: its own visible paints, then each visible child.
function layersShown(doc: NagmaDocument, node: SceneNode): number {
    const own = node.fills.some((p) => p.visible) || node.strokes.some((p) => p.visible) ? 1 : 0;
    return own + node.children.filter((id) => doc.nodes[id]?.visible).length;
}

const textureCanvases: HTMLCanvasElement[] = [];
let textureDepth = 0;

// The layer drawn as usual on its own canvas, then roughened onto this one.
function drawTexturedNode(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions, effect: Effect) {
    const level = textureDepth++;
    const canvas = scratch(textureCanvases[level] ?? null, ctx.canvas);
    textureCanvases[level] = canvas;
    const c = canvas.getContext("2d", { willReadFrequently: true });
    try {
        if (!c) return drawNode(ctx, doc, node, { ...options, textureSkip: node.id });
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.filter = "none";
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.setTransform(ctx.getTransform());
        c.globalAlpha = ctx.globalAlpha;
        drawNode(c, doc, node, { ...options, textureSkip: node.id });
        drawTextured(ctx, canvas, layerSpace(ctx, node), effect);
    } finally {
        textureDepth--;
    }
}

const rampCanvases: HTMLCanvasElement[] = [];
let rampDepth = 0;

// A progressive layer blur: the layer drawn sharp, then blurred more and more along the ramp.
function drawProgressiveBlurred(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions, effect: Effect) {
    const level = rampDepth++;
    const canvas = scratch(rampCanvases[level] ?? null, ctx.canvas);
    rampCanvases[level] = canvas;
    const c = canvas.getContext("2d");
    try {
        const sharp: SceneNode = { ...node, blur: 0, effects: (node.effects ?? []).filter((e) => e !== effect), opacity: 1 };
        if (!c) return drawNode(ctx, doc, sharp, options);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.filter = "none";
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.setTransform(ctx.getTransform());
        drawNode(c, doc, sharp, options);
        const p = progressiveOf(effect);
        if (!p) return;
        const [p0, p1] = rampPoints(layerSpace(ctx, node), node, p);
        ctx.save();
        ctx.globalAlpha *= node.opacity;
        drawRamped(ctx, canvas, p.startBlur * options.pixelScale, effect.blur * options.pixelScale, p0, p1);
        ctx.restore();
    } finally {
        rampDepth--;
    }
}

const isolateCanvases: HTMLCanvasElement[] = [];
let isolateDepth = 0;

const shadowCanvases: HTMLCanvasElement[] = [];
let shadowDepth = 0;

function drawShadowedContainer(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions) {
    const shadows = [
        ...(node.shadow ? [{ x: node.shadow.x, y: node.shadow.y, blur: node.shadow.blur, color: node.shadow.color, opacity: node.shadow.opacity }] : []),
        ...(node.effects ?? []).filter((e) => e.visible && e.type === "drop-shadow"),
    ];
    const level = shadowDepth++;
    const canvas = scratch(shadowCanvases[level] ?? null, ctx.canvas);
    shadowCanvases[level] = canvas;
    const c = canvas.getContext("2d");
    try {
        const plain: SceneNode = { ...node, shadow: null, effects: (node.effects ?? []).filter((e) => e.type !== "drop-shadow"), opacity: 1 };
        if (!c) return drawNode(ctx, doc, plain, options);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.filter = "none";
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.setTransform(ctx.getTransform());
        drawNode(c, doc, plain, options);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= node.opacity;
        // Each shadow is the layer's silhouette, offset and blurred, drawn far away so only the
        // shadow lands here.
        const far = 100000;
        for (const e of shadows) {
            const knock = "showBehind" in e && e.showBehind === false ? beginKnockout(ctx) : null;
            const g = knock ?? ctx;
            g.shadowColor = hexToRgba(e.color, e.opacity);
            g.shadowBlur = e.blur * options.pixelScale;
            g.shadowOffsetX = e.x * options.pixelScale + far;
            g.shadowOffsetY = e.y * options.pixelScale;
            g.drawImage(canvas, -far, 0);
            // Cut out where the frame shows anything, so the shadow stays outside it.
            if (knock) endKnockout(ctx, knock, (k) => k.drawImage(canvas, 0, 0));
        }
        clearShadow(ctx);
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
    } finally {
        shadowDepth--;
    }
}

const blurCanvases: HTMLCanvasElement[] = [];
let blurDepth = 0;

function drawBlurred(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions, blur: number) {
    const level = blurDepth++;
    const canvas = scratch(blurCanvases[level] ?? null, ctx.canvas);
    blurCanvases[level] = canvas;
    const c = canvas.getContext("2d");
    try {
        const sharp: SceneNode = { ...node, blur: 0, effects: (node.effects ?? []).filter((e) => e.type !== "layer-blur"), opacity: 1 };
        if (!c) return drawNode(ctx, doc, sharp, options);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.filter = "none";
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.setTransform(ctx.getTransform());
        drawNode(c, doc, sharp, options);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= node.opacity;
        // The reference's blur radius is twice the Gaussian's deviation (CSS blur takes the deviation).
        ctx.filter = `blur(${Math.max(0.5, (blur / 2) * options.pixelScale)}px)`;
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
    } finally {
        blurDepth--;
    }
}

function drawIsolated(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions) {
    const level = isolateDepth++;
    const canvas = scratch(isolateCanvases[level] ?? null, ctx.canvas);
    isolateCanvases[level] = canvas;
    const c = canvas.getContext("2d");
    try {
        if (!c) return drawNode(ctx, doc, { ...node, blendMode: "pass-through" }, options);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.filter = "none";
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.setTransform(ctx.getTransform());
        // Drawn as an ordinary layer at full opacity; opacity and the blend apply to the result.
        drawNode(c, doc, { ...node, blendMode: "pass-through", opacity: 1 }, options);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= node.opacity;
        if (node.blendMode === "plus-darker") {
            if (ctx.globalAlpha < 1) {
                // Fold the opacity into the layer first, since plus darker composites it as it is.
                c.setTransform(1, 0, 0, 1, 0, 0);
                c.globalCompositeOperation = "destination-in";
                c.globalAlpha = ctx.globalAlpha;
                c.fillStyle = "#000";
                c.fillRect(0, 0, canvas.width, canvas.height);
                c.globalAlpha = 1;
                c.globalCompositeOperation = "source-over";
            }
            ctx.restore();
            compositePlusDarker(ctx, canvas);
            return;
        }
        ctx.globalCompositeOperation = compositeOf(node.blendMode);
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
    } finally {
        isolateDepth--;
    }
}

const motionCanvases: HTMLCanvasElement[] = [];
let motionDepth = 0;

// A directional blur: the layer drawn sharp on a scratch canvas, then averaged over copies spread
// along the blur's direction (in the layer's own space) and its length.
function drawMotionBlurred(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions, effect: { blur: number; angle?: number }): void {
    const level = motionDepth++;
    const src = scratch(motionCanvases[level * 2] ?? null, ctx.canvas);
    const acc = scratch(motionCanvases[level * 2 + 1] ?? null, ctx.canvas);
    motionCanvases[level * 2] = src;
    motionCanvases[level * 2 + 1] = acc;
    const s = src.getContext("2d");
    const a = acc.getContext("2d");
    try {
        if (!s || !a) return drawNode(ctx, doc, node, { ...options, motionSkip: node.id });
        const t = ctx.getTransform();
        for (const [c, cv] of [[s, src], [a, acc]] as const) {
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.globalCompositeOperation = "source-over";
            c.globalAlpha = 1;
            c.filter = "none";
            c.clearRect(0, 0, cv.width, cv.height);
        }
        s.setTransform(t);
        drawNode(s, doc, node, { ...options, motionSkip: node.id });
        s.setTransform(1, 0, 0, 1, 0, 0);
        const local = localMatrix(node);
        const rad = ((effect.angle ?? 0) * Math.PI) / 180;
        const vx = Math.cos(rad) * effect.blur;
        const vy = Math.sin(rad) * effect.blur;
        // The direction turns with the layer; then into device pixels.
        const lx = local.a * vx + local.c * vy;
        const ly = local.b * vx + local.d * vy;
        const dx = t.a * lx + t.c * ly;
        const dy = t.b * lx + t.d * ly;
        const n = Math.max(2, Math.min(40, Math.ceil(Math.hypot(dx, dy) / 1.5)));
        a.globalCompositeOperation = "lighter";
        a.globalAlpha = 1 / n;
        for (let i = 0; i < n; i++) {
            const f = i / (n - 1) - 0.5;
            a.drawImage(src, dx * f, dy * f);
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(acc, 0, 0);
        ctx.restore();
    } finally {
        motionDepth--;
    }
}

// The active page's layers, with masks applied between top-level siblings too.
export function drawRoots(ctx: CanvasRenderingContext2D, doc: NagmaDocument, options: DrawOptions) {
    const page = doc.nodes[activePage.id];
    const focus = sceneFocus.id ? doc.nodes[sceneFocus.id] : undefined;
    // The slide on its own gets softly rounded corners on screen (about 10px whatever the zoom); the
    // slide itself stays square for export and the show.
    if (page && focus && focus.parentId === page.id) drawNode(ctx, doc, { ...focus, radius: Math.max(focus.radius, (10 * (window.devicePixelRatio || 1)) / options.pixelScale) }, options);
    else if (page) drawChildren(ctx, doc, page, options);
    else for (const id of layerRoots(doc)) {
        const node = doc.nodes[id];
        if (node) drawNode(ctx, doc, node, options);
    }
}

const maskCanvases: HTMLCanvasElement[] = [];
let maskDepth = 0;

// A mask layer drawn as an ordinary layer, for its coverage.
function maskShape(child: SceneNode): SceneNode {
    return { ...child, isMask: false };
}

// A luminance mask keeps what lies under its light parts: each pixel's coverage becomes its
// brightness times its alpha (black hides, white shows). It counted as an alpha mask before, so a
// black luminance mask showed everything on the canvas while the SVG export hid it.
function luminanceToAlpha(c: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const image = c.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] as number;
        if (!a) continue;
        const lum = (0.2126 * (d[i] as number) + 0.7152 * (d[i + 1] as number) + 0.0722 * (d[i + 2] as number)) / 255;
        d[i + 3] = Math.round(a * lum);
    }
    c.putImageData(image, 0, 0);
    c.restore();
}

// Children in order; a mask child hides the siblings above it outside its shape (until the next mask).
function drawChildren(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, options: DrawOptions) {
    let kids = node.children.map((id) => doc.nodes[id]).filter((c): c is SceneNode => Boolean(c));
    // Auto layout with "first on top": the stacking order is reversed for drawing only.
    if (node.layout?.reverseZ) kids = [...kids].reverse();
    let i = 0;
    while (i < kids.length) {
        const child = kids[i] as SceneNode;
        if (!child.isMask || !child.visible) {
            drawNode(ctx, doc, child, options);
            i++;
            continue;
        }
        // The masked run: every sibling above, up to the next mask.
        const run: SceneNode[] = [];
        let j = i + 1;
        while (j < kids.length && !kids[j]?.isMask) run.push(kids[j++] as SceneNode);
        if (child.maskType === "vector" && (child.type === "rect" || child.type === "ellipse" || child.type === "vector")) {
            ctx.save();
            const m = localMatrix(child);
            ctx.save();
            if (!m.isIdentity) ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
            shapePath(ctx, child);
            ctx.restore();
            ctx.clip();
            for (const r of run) drawNode(ctx, doc, r, options);
            ctx.restore();
        } else {
            // Alpha or luminance: draw the run offscreen, keep it where the mask paints (by brightness for luminance).
            const main = ctx.canvas;
            if (!main.width || !main.height) {
                for (const r of run) drawNode(ctx, doc, r, options);
                i = j;
                continue;
            }
            // Masks can nest (a masked run can hold another mask), so each level gets its own pair
            // of scratch canvases: one for the content, one for the mask shape.
            const level = maskDepth++;
            const content = scratch(maskCanvases[level * 2] ?? null, main);
            const shape = scratch(maskCanvases[level * 2 + 1] ?? null, main);
            maskCanvases[level * 2] = content;
            maskCanvases[level * 2 + 1] = shape;
            const off = content.getContext("2d");
            const sh = shape.getContext("2d");
            if (off && sh) {
                const t = ctx.getTransform();
                for (const [c, cv] of [[off, content], [sh, shape]] as const) {
                    c.setTransform(1, 0, 0, 1, 0, 0);
                    c.globalCompositeOperation = "source-over";
                    c.globalAlpha = 1;
                    c.filter = "none";
                    c.clearRect(0, 0, cv.width, cv.height);
                    c.setTransform(t);
                }
                for (const r of run) drawNode(off, doc, r, options);
                // The mask is drawn on its own canvas (its fills set their own blend modes), then
                // only its coverage is kept from the content.
                drawNode(sh, doc, maskShape(child), options);
                if (child.maskType === "luminance") luminanceToAlpha(sh, shape);
                off.setTransform(1, 0, 0, 1, 0, 0);
                off.globalCompositeOperation = "destination-in";
                off.drawImage(shape, 0, 0);
                off.globalCompositeOperation = "source-over";
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.filter = "none";
                ctx.drawImage(content, 0, 0);
                ctx.restore();
            } else for (const r of run) drawNode(ctx, doc, r, options);
            maskDepth--;
        }
        i = j;
    }
}

// Builds a layer's outline as a path in device space, so the stroke width stays constant on screen.
function outlinePath(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, camera: Camera, dpr: number) {
    ctx.save();
    ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
    const m = worldMatrix(doc, node);
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    if (node.type === "vector") tracePath(ctx, placedSubpaths(node));
    else if (node.type === "ellipse") ctx.ellipse(node.x + node.w / 2, node.y + node.h / 2, node.w / 2, node.h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(node.x, node.y, node.w, node.h);
    ctx.restore();
}

function strokeOutline(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, camera: Camera, color: string, width: number) {
    const dpr = window.devicePixelRatio || 1;
    outlinePath(ctx, doc, node, camera, dpr);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
}

function handleSquare(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.strokeRect(-4, -4, 8, 8);
    ctx.restore();
}

function sizeLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, color: string) {
    ctx.font = fontString(11, 500);
    const width = ctx.measureText(text).width + 10;
    const lx = cx - width / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(lx, top, width, SIZE_PILL_HEIGHT, 4);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "middle";
    ctx.fillText(text, lx + 5, top + SIZE_PILL_HEIGHT / 2 + 0.5);
}

export { formatSize };

// A text layer's baselines on screen: the first line's across the box while selected, every
// line's under its text while hovered (how text shows it is text, instead of a box).
function textBaselineSegments(node: SceneNode, all: boolean): Segment[] {
    if (node.type !== "text" || node.pathId) return [];
    const layout = layoutText(node);
    const dy = verticalOffset(node, layout);
    if (all) return lineBaselines(node, layout.lines, dy);
    const first = firstBaseline(node, layout.lines, dy);
    return first ? [first] : [];
}

function strokeBaselines(ctx: CanvasRenderingContext2D, doc: NagmaDocument, node: SceneNode, camera: Camera, segments: Segment[], color: string, width: number) {
    if (!segments.length) return;
    const m = worldMatrix(doc, node);
    ctx.save();
    ctx.beginPath();
    for (const seg of segments) {
        const a = apply(m, seg.x0, seg.y);
        const b = apply(m, seg.x1, seg.y);
        const pa = worldToScreen(camera, a.x, a.y);
        const pb = worldToScreen(camera, b.x, b.y);
        // Snapped to the pixel grid when level, so the line stays crisp.
        const level = Math.abs(pa.y - pb.y) < 0.01;
        const y = level ? Math.round(pa.y) + 0.5 : pa.y;
        ctx.moveTo(pa.x, y);
        ctx.lineTo(pb.x, level ? y : pb.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, overlay: Overlay, palette: Palette) {
    const nodes = overlay.selection.map((id) => doc.nodes[id]).filter((node): node is SceneNode => Boolean(node));
    if (nodes.length === 0 || overlay.editingTextId) return;
    if (overlay.viewOnly) return drawViewerSelection(ctx, doc, camera, nodes);

    const single = nodes.length === 1 ? nodes[0] : undefined;
    const color = chromeColor(doc, nodes, palette);
    if (single) {
        // One layer: a box that follows its rotation, with its own (unrotated) size.
        const pts = corners(doc, single).map((p) => worldToScreen(camera, p.x, p.y));
        const [a, b] = pts;
        const angle = a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
        // In crop mode the crop frame (canvas/plugins/image-crop.ts) replaces the box and its handles.
        const cropping = vectorUi.get().crop?.nodeId === single.id;
        if (!cropping) {
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
            strokeBaselines(ctx, doc, single, camera, textBaselineSegments(single, false), color, 1);
            for (const p of pts) handleSquare(ctx, p.x, p.y, angle, color);
        }
        const bottom = Math.max(...pts.map((p) => p.y));
        const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
        if (overlay.showDimensions) sizeLabel(ctx, sizePillText(single.w, single.h, effectiveSizing(doc, single)), cx, bottom + SIZE_PILL_GAP, color);
        return;
    }

    for (const node of nodes) strokeOutline(ctx, doc, node, camera, color, 1);
    const bounds = selectionBounds(doc, overlay.selection);
    if (!bounds) return;
    const p = worldToScreen(camera, bounds.x, bounds.y);
    const w = bounds.w * camera.zoom;
    const h = bounds.h * camera.zoom;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(w), Math.round(h));
    for (const [hx, hy] of [
        [p.x, p.y],
        [p.x + w, p.y],
        [p.x + w, p.y + h],
        [p.x, p.y + h],
    ] as const) {
        handleSquare(ctx, Math.round(hx) + 0.5, Math.round(hy) + 0.5, 0, color);
    }
    if (overlay.showDimensions) sizeLabel(ctx, `${formatSize(bounds.w)} × ${formatSize(bounds.h)}`, p.x + w / 2, p.y + h + SIZE_PILL_GAP, color);
}

// What a viewer selects: a solid purple box per layer (nothing to drag), its parent's box dashed.
function drawViewerSelection(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, nodes: SceneNode[]) {
    ctx.save();
    const parents = new Set(nodes.map((n) => n.parentId).filter((id): id is string => Boolean(id && doc.nodes[id] && doc.nodes[id]?.type !== "page")));
    ctx.setLineDash([4, 3]);
    for (const id of parents) strokeOutline(ctx, doc, doc.nodes[id] as SceneNode, camera, VIEWER, 1);
    ctx.setLineDash([]);
    for (const node of nodes) strokeOutline(ctx, doc, node, camera, VIEWER, 1.5);
    ctx.restore();
}

// The vector's outline, its anchors (squares) and the handles near the selected point (circles on stems).
function drawVectorEdit(
    ctx: CanvasRenderingContext2D,
    doc: NagmaDocument,
    camera: Camera,
    nodeId: string,
    vertices: VertexRef[],
    palette: Palette,
    cursor: { x: number; y: number } | null = null,
    lasso: { x: number; y: number }[] | null = null,
) {
    const node = doc.nodes[nodeId];
    if (!node) return;
    const dpr = window.devicePixelRatio || 1;
    outlinePath(ctx, doc, node, camera, dpr);
    ctx.strokeStyle = palette.brand;
    ctx.lineWidth = 1;
    ctx.stroke();
    const all = screenVertices(doc, node, camera, vertices);
    const anchors = all.filter((v) => v.part === "anchor");
    // Rubber band from the last point to the pointer while drawing with the pen.
    const last = anchors[anchors.length - 1];
    if (cursor && last) {
        const c = worldToScreen(camera, cursor.x, cursor.y);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(c.x, c.y);
        ctx.strokeStyle = palette.brand;
        ctx.stroke();
    }
    for (const v of all) {
        if (v.part === "anchor") continue;
        const anchor = anchors.find((a) => a.sub === v.sub && a.index === v.index);
        if (anchor) {
            ctx.beginPath();
            ctx.moveTo(anchor.x, anchor.y);
            ctx.lineTo(v.x, v.y);
            ctx.strokeStyle = palette.brand;
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(v.x, v.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        ctx.stroke();
    }
    for (const a of anchors) {
        const active = isSelected(vertices, a.sub, a.index);
        ctx.fillStyle = active ? palette.brand : "#FFFFFF";
        ctx.strokeStyle = palette.brand;
        ctx.fillRect(Math.round(a.x) - 3.5, Math.round(a.y) - 3.5, 7, 7);
        ctx.strokeRect(Math.round(a.x) - 3.5, Math.round(a.y) - 3.5, 7, 7);
    }
    if (lasso && lasso.length > 1) {
        ctx.save();
        ctx.beginPath();
        lasso.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = palette.brand;
        ctx.stroke();
        ctx.fillStyle = `${palette.brand}1A`;
        ctx.fill();
        ctx.restore();
    }
}


// Other people's selections (outlined in their colour) and cursors with name tags.
// White text on most cursor colours; dark on yellow, the way the reference keeps labels readable.
function labelTextColor(hex: string): string {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 186 ? "#1E1E1E" : "#FFFFFF";
}

function drawPeers(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera, peers: Overlay["peers"]) {
    for (const peer of peers) {
        for (const id of peer.selection) {
            const node = doc.nodes[id];
            if (node) strokeOutline(ctx, doc, node, camera, peer.color, 1.5);
        }
    }
    ctx.save();
    ctx.font = fontString(11, 600);
    ctx.textBaseline = "middle";
    for (const peer of peers) {
        if (!peer.cursor) continue;
        const p = worldToScreen(camera, peer.cursor.x, peer.cursor.y);
        // The kite-shaped multiplayer arrow, filled in the user's colour with a thin white edge.
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 6.4, p.y + 15.4);
        ctx.lineTo(p.x + 8.7, p.y + 8.7);
        ctx.lineTo(p.x + 15.4, p.y + 6.4);
        ctx.closePath();
        ctx.lineJoin = "round";
        ctx.fillStyle = peer.color;
        ctx.fill();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Name tag: a small rounded label in the same colour, tucked under the arrow.
        const label = peer.name || "Guest";
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = peer.color;
        ctx.beginPath();
        ctx.roundRect(p.x + 13, p.y + 16, w, 20, 4);
        ctx.fill();
        ctx.fillStyle = labelTextColor(peer.color);
        ctx.fillText(label, p.x + 19, p.y + 26.5);
    }
    ctx.restore();
}

function drawGuides(ctx: CanvasRenderingContext2D, camera: Camera, guides: Guide[]) {
    if (!guides.length) return;
    ctx.save();
    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = 1;
    for (const g of guides) {
        const a = worldToScreen(camera, g.x1, g.y1);
        const b = worldToScreen(camera, g.x2, g.y2);
        const vertical = Math.abs(a.x - b.x) < 0.5;
        const ax = vertical ? Math.round(a.x) + 0.5 : a.x;
        const ay = vertical ? a.y : Math.round(a.y) + 0.5;
        const bx = vertical ? Math.round(b.x) + 0.5 : b.x;
        const by = vertical ? b.y : Math.round(b.y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        // Small crosses mark the ends of the guide.
        for (const [x, y] of [
            [ax, ay],
            [bx, by],
        ] as const) {
            ctx.beginPath();
            ctx.moveTo(x - 3, y - 3);
            ctx.lineTo(x + 3, y + 3);
            ctx.moveTo(x + 3, y - 3);
            ctx.lineTo(x - 3, y + 3);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawMeasures(ctx: CanvasRenderingContext2D, camera: Camera, measures: Measure[], color = GUIDE) {
    if (!measures.length) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.font = fontString(11, 600);
    ctx.textBaseline = "middle";
    for (const m of measures) {
        const a = worldToScreen(camera, m.x1, m.y1);
        const b = worldToScreen(camera, m.x2, m.y2);
        ctx.beginPath();
        ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
        ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
        ctx.stroke();
        const label = formatSize(m.value);
        const w = ctx.measureText(label).width + 8;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, cy - 9, w, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, cx - w / 2 + 4, cy + 0.5);
        ctx.fillStyle = color;
    }
    ctx.restore();
}

let previewCanvas: HTMLCanvasElement | null = null;

// Draws the visible document at 1 px per unit, then scales it up without smoothing.
function drawPixelPreview(ctx: CanvasRenderingContext2D, width: number, height: number, doc: NagmaDocument, camera: Camera, options: DrawOptions, density = 1) {
    const w = Math.ceil((width / camera.zoom) * density) + 2;
    const h = Math.ceil((height / camera.zoom) * density) + 2;
    previewCanvas ??= document.createElement("canvas");
    if (previewCanvas.width !== w || previewCanvas.height !== h) {
        previewCanvas.width = w;
        previewCanvas.height = h;
    }
    const pc = previewCanvas.getContext("2d");
    if (!pc) return;
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.clearRect(0, 0, w, h);
    const ox = Math.floor((-camera.x / camera.zoom) * density) / density;
    const oy = Math.floor((-camera.y / camera.zoom) * density) / density;
    pc.scale(density, density);
    pc.translate(-ox, -oy);
    drawRoots(pc, doc, { ...options, pixelScale: density });
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(camera.x + ox * camera.zoom, camera.y + oy * camera.zoom);
    ctx.scale(camera.zoom / density, camera.zoom / density);
    ctx.drawImage(previewCanvas, 0, 0);
    ctx.restore();
}

// Column, row and grid guides on frames, in the frame's own space.
function drawLayoutGuides(ctx: CanvasRenderingContext2D, doc: NagmaDocument, camera: Camera) {
    for (const node of Object.values(doc.nodes)) {
        if (!node.guides?.length || !node.visible || pageOfNode(doc, node) !== activePage.id) continue;
        const m = worldMatrix(doc, node);
        ctx.save();
        ctx.translate(camera.x, camera.y);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.beginPath();
        ctx.rect(node.x, node.y, node.w, node.h);
        ctx.clip();
        for (const g of node.guides) {
            if (!g.visible) continue;
            ctx.fillStyle = g.color;
            if (g.kind === "grid") {
                const size = Math.max(1, g.size);
                ctx.globalAlpha = g.opacity ?? 0.35;
                ctx.strokeStyle = g.color;
                ctx.lineWidth = 1 / camera.zoom;
                ctx.beginPath();
                for (let x = node.x; x <= node.x + node.w; x += size) {
                    ctx.moveTo(x, node.y);
                    ctx.lineTo(x, node.y + node.h);
                }
                for (let y = node.y; y <= node.y + node.h; y += size) {
                    ctx.moveTo(node.x, y);
                    ctx.lineTo(node.x + node.w, y);
                }
                ctx.stroke();
                continue;
            }
            ctx.globalAlpha = g.opacity ?? 0.12;
            for (const cell of guideCells(g, g.kind === "columns" ? node.w : node.h)) {
                if (g.kind === "columns") ctx.fillRect(node.x + cell.start, node.y, cell.size, node.h);
                else ctx.fillRect(node.x, node.y + cell.start, node.w, cell.size);
            }
        }
        ctx.restore();
    }
}

// One line per document pixel, visible from 800% zoom like the usual design tools.
function drawPixelGrid(ctx: CanvasRenderingContext2D, width: number, height: number, camera: Camera, palette: Palette) {
    ctx.save();
    ctx.strokeStyle = palette.label;
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = Math.floor(-camera.x / camera.zoom);
    const endX = Math.ceil((width - camera.x) / camera.zoom);
    for (let x = startX; x <= endX; x++) {
        const sx = Math.round(camera.x + x * camera.zoom) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
    }
    const startY = Math.floor(-camera.y / camera.zoom);
    const endY = Math.ceil((height - camera.y) / camera.zoom);
    for (let y = startY; y <= endY; y++) {
        const sy = Math.round(camera.y + y * camera.zoom) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
    }
    ctx.stroke();
    ctx.restore();
}

// Guides dragged out of the rulers: thin lines across the whole canvas.
function drawRulerGuides(ctx: CanvasRenderingContext2D, width: number, height: number, camera: Camera, guides: { axis: "x" | "y"; at: number }[]) {
    if (!guides.length) return;
    ctx.save();
    ctx.strokeStyle = "#FF4D4DCC";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const g of guides) {
        if (g.axis === "x") {
            const sx = Math.round(camera.x + g.at * camera.zoom) + 0.5;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, height);
        } else {
            const sy = Math.round(camera.y + g.at * camera.zoom) + 0.5;
            ctx.moveTo(0, sy);
            ctx.lineTo(width, sy);
        }
    }
    ctx.stroke();
    ctx.restore();
}

function rulerStep(zoom: number): number {
    const steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    return steps.find((step) => step * zoom >= 50) ?? 10000;
}

function drawRulers(ctx: CanvasRenderingContext2D, width: number, height: number, camera: Camera, selection: Rect | null, palette: Palette) {
    const size = RULER_SIZE;
    const step = rulerStep(camera.zoom);
    ctx.save();
    ctx.font = fontString(9, 500);

    // Bands.
    ctx.fillStyle = palette.ruler;
    ctx.fillRect(0, 0, width, size);
    ctx.fillRect(0, 0, size, height);

    // Selection highlight.
    if (selection) {
        const a = worldToScreen(camera, selection.x, selection.y);
        const b = worldToScreen(camera, selection.x + selection.w, selection.y + selection.h);
        ctx.fillStyle = palette.brandSoft;
        ctx.fillRect(a.x, 0, b.x - a.x, size);
        ctx.fillRect(0, a.y, size, b.y - a.y);
    }

    // Tick labels step aside for the selection's start and end values.
    const sa = selection ? worldToScreen(camera, selection.x, selection.y) : null;
    const sb = selection ? worldToScreen(camera, selection.x + selection.w, selection.y + selection.h) : null;
    const clearX = (sx: number) => !sa || !sb || (Math.abs(sx - sa.x) > 30 && Math.abs(sx - sb.x) > 30);
    const clearY = (sy: number) => !sa || !sb || (Math.abs(sy - sa.y) > 30 && Math.abs(sy - sb.y) > 30);

    // Horizontal ticks.
    ctx.fillStyle = palette.rulerText;
    ctx.strokeStyle = palette.rulerText;
    ctx.lineWidth = 1;
    ctx.textBaseline = "top";
    const startX = Math.floor(-camera.x / camera.zoom / step) * step;
    for (let wx = startX; wx * camera.zoom + camera.x < width; wx += step) {
        const sx = Math.round(wx * camera.zoom + camera.x) + 0.5;
        if (sx < size) continue;
        ctx.beginPath();
        ctx.moveTo(sx, size - 5);
        ctx.lineTo(sx, size);
        ctx.stroke();
        if (clearX(sx)) ctx.fillText(String(wx), sx + 3, 4);
    }

    // Vertical ticks, with labels rotated like a ruler.
    const startY = Math.floor(-camera.y / camera.zoom / step) * step;
    for (let wy = startY; wy * camera.zoom + camera.y < height; wy += step) {
        const sy = Math.round(wy * camera.zoom + camera.y) + 0.5;
        if (sy < size) continue;
        ctx.beginPath();
        ctx.moveTo(size - 5, sy);
        ctx.lineTo(size, sy);
        ctx.stroke();
        if (clearY(sy)) {
            ctx.save();
            ctx.translate(4, sy - 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(wy), 0, 0);
            ctx.restore();
        }
    }

    // Selection start and end values, drawn over the ticks.
    if (selection) {
        const a = worldToScreen(camera, selection.x, selection.y);
        const b = worldToScreen(camera, selection.x + selection.w, selection.y + selection.h);
        const label = (text: string, x: number, y: number, vertical: boolean) => {
            const w = ctx.measureText(text).width + 6;
            ctx.save();
            ctx.translate(x, y);
            if (vertical) ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = palette.ruler;
            ctx.fillRect(-w / 2, -1, w, 12);
            ctx.fillStyle = palette.brand;
            ctx.textAlign = "center";
            ctx.fillText(text, 0, 0);
            ctx.restore();
        };
        if (b.x > size) {
            label(String(Math.round(selection.x)), Math.max(a.x, size + 12), 4, false);
            label(String(Math.round(selection.x + selection.w)), b.x, 4, false);
        }
        if (b.y > size) {
            label(String(Math.round(selection.y)), 4, Math.max(a.y, size + 12), true);
            label(String(Math.round(selection.y + selection.h)), 4, b.y, true);
        }
    }

    ctx.fillStyle = palette.rulerBorder;
    ctx.fillRect(0, size - 1, width, 1);
    ctx.fillRect(size - 1, 0, 1, height);
    ctx.fillStyle = palette.ruler;
    ctx.fillRect(0, 0, size - 1, size - 1);
    ctx.restore();
}

export function renderScene(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    doc: NagmaDocument,
    camera: Camera,
    overlay: Overlay,
    palette: Palette,
) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Unmanaged colour (Preferences › Color profile) draws every file's values as sRGB.
    setPaintSpace(doc.colorProfile === "p3" && !overlay.unmanagedColor ? "p3" : "srgb");
    // The page's own background colour, when one is set, replaces the canvas colour.
    const page = doc.nodes[activePage.id];
    const pageFill = page?.fills.find((p) => p.visible && p.type === "solid");
    ctx.fillStyle = overlay.presenting ? "#000000" : pageFill && pageFill.type === "solid" ? pageFill.color : palette.canvas;
    ctx.fillRect(0, 0, width, height);
    if (!overlay.presenting) boardPainter.backdrop?.(ctx, width, height, doc, camera);

    // Document content in world space.
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);
    const options: DrawOptions = { editingTextId: overlay.editingTextId, pixelScale: camera.zoom * dpr, outlines: overlay.outlines && !overlay.presenting };
    const density = overlay.pixelPreviewScale ?? 1;
    if (overlay.pixelPreview && camera.zoom > density && !overlay.presenting) {
        ctx.restore();
        drawPixelPreview(ctx, width, height, doc, camera, options, density);
    } else {
        drawRoots(ctx, doc, options);
        ctx.restore();
    }
    if (overlay.presenting) return;
    if (overlay.pixelGrid && camera.zoom >= 8) drawPixelGrid(ctx, width, height, camera, palette);
    if (overlay.layoutGuides) drawLayoutGuides(ctx, doc, camera);

    // Chrome in screen space: frame labels, hover, selection, marquee, rulers.
    const selected = new Set(overlay.selection);
    ctx.font = fontString(FRAME_LABEL_SIZE, 500);
    ctx.textBaseline = "top";
    for (const id of sceneFocus.id ? [] : labelled(doc)) {
        const node = doc.nodes[id];
        if (!node || !(isFrameLike(node) || node.type === "live") || !node.visible || pluginOwnsLabel(node)) continue;
        const r = frameLabelRect(doc, node, camera);
        if (node.isSection && doc.board && boardPainter.sectionLabel?.(ctx, doc, node, r, selected.has(id) || overlay.hoverId === id)) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y - 2, Math.max(r.w, 1), r.h + 4);
        ctx.clip();
        // Components and instances wear the component colour and mark, so they're easy to tell apart.
        const reusable = node.type === "component" || node.type === "componentSet" || node.type === "instance";
        ctx.fillStyle = reusable ? COMPONENT : selected.has(id) || overlay.hoverId === id ? palette.brand : palette.label;
        if (node.isSection) ctx.font = fontString(FRAME_LABEL_SIZE, 700);
        ctx.fillText(`${node.type === "component" || node.type === "componentSet" ? "❖ " : node.type === "instance" ? "◇ " : ""}${node.name}`, r.x, r.y + 1);
        ctx.restore();
        if (node.isSection) ctx.font = fontString(FRAME_LABEL_SIZE, 500);
    }

    // Component sets get a dashed outline in the component colour, the usual way to show a variant group.
    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "componentSet" || !node.visible || pageOfNode(doc, node) !== activePage.id) continue;
        const dpr = window.devicePixelRatio || 1;
        outlinePath(ctx, doc, node, camera, dpr);
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = COMPONENT;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    // Slices show only as a dashed outline, since they draw nothing of their own.
    for (const node of Object.values(doc.nodes)) {
        if (overlay.showSlices === false || !node.isSlice || !node.visible || pageOfNode(doc, node) !== activePage.id) continue;
        const dpr = window.devicePixelRatio || 1;
        outlinePath(ctx, doc, node, camera, dpr);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = palette.label;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    // View › Mask outlines and Frame outlines: a thin outline on every mask, or every frame.
    if (overlay.maskOutlines || overlay.frameOutlines) {
        for (const node of Object.values(doc.nodes)) {
            if (!node.visible || pageOfNode(doc, node) !== activePage.id) continue;
            const frame = isFrameLike(node) && !node.isSection && !node.isSlice && node.type !== "page";
            if (!((overlay.maskOutlines && node.isMask) || (overlay.frameOutlines && frame))) continue;
            strokeOutline(ctx, doc, node, camera, node.isMask ? palette.brand : palette.label, 1);
        }
    }

    const hover = overlay.hoverId ? doc.nodes[overlay.hoverId] : undefined;
    if (hover && !selected.has(hover.id)) {
        // Text is hovered by underlining its lines; everything else by its outline.
        const lines = hover.type === "text" && hover.id !== overlay.editingTextId ? textBaselineSegments(hover, true) : [];
        const color = chromeColor(doc, [hover], palette);
        if (lines.length) strokeBaselines(ctx, doc, hover, camera, lines, color, 1.5);
        else strokeOutline(ctx, doc, hover, camera, color, 1.5);
    }


    if (overlay.pen) drawVectorEdit(ctx, doc, camera, overlay.pen.nodeId, overlay.vectorEdit?.vertices ?? [], palette, overlay.pen.cursor);
    else if (overlay.vectorEdit) drawVectorEdit(ctx, doc, camera, overlay.vectorEdit.nodeId, overlay.vectorEdit.vertices, palette, null, overlay.vectorEdit.lasso);
    else drawSelection(ctx, doc, camera, overlay, palette);
    drawUiOverlay(ctx, doc, camera, palette, overlay.selection);

    drawPeers(ctx, doc, camera, overlay.peers);
    if (overlay.prototype) drawConnections(ctx, doc, camera, overlay.selection);
    drawRulerGuides(ctx, width, height, camera, overlay.rulerGuides);
    drawGuides(ctx, camera, overlay.guides);
    drawMeasures(ctx, camera, overlay.measures);

    if (overlay.marquee) {
        const m = overlay.marquee;
        const p = worldToScreen(camera, m.x, m.y);
        ctx.fillStyle = palette.brandSoft;
        ctx.strokeStyle = palette.brand;
        ctx.lineWidth = 1;
        ctx.fillRect(p.x, p.y, m.w * camera.zoom, m.h * camera.zoom);
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, m.w * camera.zoom, m.h * camera.zoom);
    }

    if (overlay.rulers) drawRulers(ctx, width, height, camera, selectionBounds(doc, overlay.selection), palette);
}

// Several layers in one PNG, framed by their shared bounds (with room for shadows and blurs).
export async function renderSelectionToPng(doc: NagmaDocument, ids: string[], scale: number, format: "png" | "jpeg" = "png"): Promise<Blob | null> {
    const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (nodes.length === 1 && nodes[0]) return renderNodesToPng(doc, nodes[0], scale, format);
    const box = selectionBounds(doc, nodes.map((n) => n.id));
    if (!nodes.length || !box) return null;
    await ensureLiveSnapshots(doc, ids, Math.max(1, Math.min(4, scale)));
    const pad = Math.max(0, ...nodes.map((n) => (n.shadow ? Math.abs(n.shadow.x) + Math.abs(n.shadow.y) + n.shadow.blur * 2 : 0) + n.blur * 2));
    const bounds = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
    const width = Math.max(1, Math.min(8192, Math.ceil(bounds.w * scale)));
    const height = Math.max(1, Math.min(8192, Math.ceil(bounds.h * scale)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (format === "jpeg") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
    }
    for (const node of nodes) {
        ctx.save();
        ctx.scale(scale, scale);
        ctx.translate(-bounds.x, -bounds.y);
        const parent = parentMatrix(doc, node);
        ctx.transform(parent.a, parent.b, parent.c, parent.d, parent.e, parent.f);
        drawNode(ctx, doc, node, { editingTextId: null, pixelScale: scale });
        ctx.restore();
    }
    return new Promise((resolve) => canvas.toBlob(resolve, `image/${format}`, 0.92));
}

// Raster export options: image quality (JPEG), resampling (sharp pixels instead of smoothing),
// the colour space, and absolute bounds (the layer's full extent, nothing clipped away).
export interface RasterOptions {
    quality?: number;
    resampling?: "smooth" | "detailed";
    colorSpace?: "srgb" | "display-p3";
    absoluteBounds?: boolean;
}

export function rasterContext(canvas: HTMLCanvasElement, options: RasterOptions): CanvasRenderingContext2D | null {
    const ctx = canvas.getContext("2d", options.colorSpace === "display-p3" ? { colorSpace: "display-p3" } : undefined);
    if (ctx && options.resampling === "detailed") {
        ctx.imageSmoothingEnabled = false;
    } else if (ctx) ctx.imageSmoothingQuality = "high";
    return ctx;
}

// Everything a layer and its descendants cover (ignoring clipping), for absolute-bounds exports.
export function absoluteBoundsOf(doc: NagmaDocument, node: SceneNode): Rect | null {
    const ids = [node.id];
    const visit = (id: string) => {
        for (const child of doc.nodes[id]?.children ?? []) {
            ids.push(child);
            visit(child);
        }
    };
    visit(node.id);
    return selectionBounds(doc, ids);
}

// A copy of the layer with every clip in its subtree switched off.
function unclipped(doc: NagmaDocument, node: SceneNode): NagmaDocument {
    const nodes = { ...doc.nodes };
    const visit = (id: string) => {
        const n = nodes[id];
        if (!n) return;
        if (n.clip) nodes[id] = { ...n, clip: false };
        n.children.forEach(visit);
    };
    visit(node.id);
    return { ...doc, nodes };
}

// Renders layers to a PNG at the given scale, in their world placement.
export async function renderNodesToPng(input: NagmaDocument, node: SceneNode, scale: number, format: "png" | "jpeg" = "png", options: RasterOptions = {}): Promise<Blob | null> {
    // Live frames are drawn from their pictures: bring them up to date first.
    await ensureLiveSnapshots(input, [node.id], Math.max(1, Math.min(4, scale)));
    const doc = options.absoluteBounds ? unclipped(input, node) : input;
    // The layer with what its effects reach (shadows, blur) and any contents it doesn't clip. The
    // padding was read only from the old single-shadow fields, so shadows and blurs from the
    // Effects list were cut off at the layer's edge.
    const bounds = options.absoluteBounds ? absoluteBoundsOf(doc, node) : exportBounds(doc, node);
    if (!bounds) return null;
    const width = Math.max(1, Math.min(8192, Math.ceil(bounds.w * scale)));
    const height = Math.max(1, Math.min(8192, Math.ceil(bounds.h * scale)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = rasterContext(canvas, options);
    if (!ctx) return null;
    // The file's values are in its own colour space; the canvas converts them to the export's.
    setPaintSpace(doc.colorProfile === "p3" ? "p3" : "srgb");
    // JPEG has no transparency, so it gets a white background.
    if (format === "jpeg") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
    }
    ctx.scale(scale, scale);
    ctx.translate(-bounds.x, -bounds.y);
    const parent = parentMatrix(doc, node);
    ctx.transform(parent.a, parent.b, parent.c, parent.d, parent.e, parent.f);
    drawNode(ctx, doc, node, { editingTextId: null, pixelScale: scale });
    return new Promise((resolve) => canvas.toBlob(resolve, `image/${format}`, options.quality ?? 0.92));
}
