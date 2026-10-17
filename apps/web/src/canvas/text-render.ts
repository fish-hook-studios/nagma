import { ensureFont, subscribeFontMetrics } from "../engine/fonts";
import { gradientStyle, hexToRgba, visiblePaints } from "../engine/paint";
import { dashOf, miterLimitOf } from "../engine/stroke";
import { styledRuns } from "../engine/rich-text";
import { editor } from "../engine/store";
import { type Fragment, type LayoutLine, applyFont, layoutText, verticalOffset } from "../engine/text-layout";
import { staggerPieces } from "../engine/text-stagger";
import type { Paint, SceneNode } from "../engine/types";

// Draws a text layer from its layout: each run in its own font and paints, list markers,
// underline and strikethrough, and (in Motion) the text stagger's per-letter or per-word motion.

// Re-measure and redraw when a font (or an alias face with OpenType settings) finishes loading.
subscribeFontMetrics(() => editor.refreshText());

type Box = { x: number; y: number; w: number; h: number };

function fillStyle(ctx: CanvasRenderingContext2D, paint: Paint, box: Box): string | CanvasGradient {
    if (paint.type === "solid") return paint.color;
    if (paint.type === "image" || paint.type === "pattern" || paint.type === "shader") return "transparent";
    return gradientStyle(ctx, paint, box);
}

// The layer's own blend mode is applied when the layer is composited (render.ts drawIsolated), so
// a run's paint only adds its own. Plus darker has no canvas operation here and falls back to multiply.
function blendFor(_node: SceneNode, paint: Paint): GlobalCompositeOperation {
    const mode = paint.blend;
    if (mode === "normal" || mode === "pass-through") return "source-over";
    if (mode === "plus-lighter") return "lighter";
    if (mode === "plus-darker") return "multiply";
    return mode;
}

function shadowOn(ctx: CanvasRenderingContext2D, node: SceneNode, pixelScale: number) {
    const s = node.shadow;
    if (!s) return;
    ctx.shadowColor = hexToRgba(s.color, s.opacity);
    ctx.shadowOffsetX = s.x * pixelScale;
    ctx.shadowOffsetY = s.y * pixelScale;
    ctx.shadowBlur = s.blur * pixelScale;
}

// Loads every family the layer uses.
export function ensureTextFonts(node: SceneNode) {
    for (const run of styledRuns(node)) ensureFont(run.style.fontFamily, () => editor.refreshText());
}

function drawPiece(ctx: CanvasRenderingContext2D, node: SceneNode, f: Fragment, text: string, x: number, baseline: number, box: Box, pixelScale: number, rtl: boolean) {
    const paints = visiblePaints(f.style.fills).filter((p) => p.type !== "image");
    paints.forEach((paint, i) => {
        ctx.save();
        applyFont(ctx, f.font, f.tracking, f.caps, f.wordSpacing);
        ctx.textBaseline = "alphabetic";
        ctx.direction = rtl ? "rtl" : "ltr";
        ctx.textAlign = "left";
        ctx.globalAlpha *= paint.opacity;
        ctx.globalCompositeOperation = blendFor(node, paint);
        ctx.fillStyle = fillStyle(ctx, paint, box);
        if (i === 0) shadowOn(ctx, node, pixelScale);
        ctx.fillText(text, x, baseline);
        ctx.restore();
    });
}

let strokeScratch: HTMLCanvasElement | null = null;

// Strokes on text, drawn over the fills: a centre stroke is the glyphs stroked at the weight; an
// inside or outside one is stroked at twice the weight on a scratch canvas, then cut to the
// glyphs (inside) or the glyphs cut out of it (outside), so only that half shows.
export function strokeText(ctx: CanvasRenderingContext2D, node: SceneNode, f: Pick<Fragment, "font" | "tracking" | "caps" | "wordSpacing">, text: string, x: number, baseline: number, box: Box, rtl: boolean) {
    const w = node.strokeWidth;
    if (!(w > 0)) return;
    const paints = visiblePaints(node.strokes).filter((p) => p.type !== "image" && p.type !== "pattern" && p.type !== "shader");
    if (!paints.length) return;
    const align = node.strokeAlign ?? "center";
    const dashes = dashOf(node);
    const setup = (c: CanvasRenderingContext2D, paint: Paint) => {
        applyFont(c, f.font, f.tracking, f.caps, f.wordSpacing);
        c.textBaseline = "alphabetic";
        c.direction = rtl ? "rtl" : "ltr";
        c.textAlign = "left";
        c.lineWidth = align === "center" ? w : w * 2;
        c.lineJoin = node.strokeJoin ?? "miter";
        c.miterLimit = miterLimitOf(node);
        c.lineCap = node.strokeCap ?? "butt";
        if (dashes) c.setLineDash(dashes);
        c.strokeStyle = fillStyle(c, paint, box);
    };
    for (const paint of paints) {
        if (align === "center" || !ctx.canvas.width || !ctx.canvas.height) {
            ctx.save();
            setup(ctx, paint);
            ctx.globalAlpha *= paint.opacity;
            ctx.globalCompositeOperation = blendFor(node, paint);
            ctx.strokeText(text, x, baseline);
            ctx.restore();
            continue;
        }
        const main = ctx.canvas;
        strokeScratch ??= document.createElement("canvas");
        if (strokeScratch.width !== main.width || strokeScratch.height !== main.height) {
            strokeScratch.width = main.width;
            strokeScratch.height = main.height;
        }
        const s = strokeScratch.getContext("2d");
        if (!s) continue;
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.globalCompositeOperation = "source-over";
        s.globalAlpha = 1;
        s.filter = "none";
        s.clearRect(0, 0, main.width, main.height);
        s.setTransform(ctx.getTransform());
        setup(s, paint);
        s.strokeText(text, x, baseline);
        // Keep the half inside the glyphs, or cut the glyphs out to keep the half outside.
        s.globalCompositeOperation = align === "inside" ? "destination-in" : "destination-out";
        s.fillStyle = "#000";
        s.fillText(text, x, baseline);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha *= paint.opacity;
        ctx.globalCompositeOperation = blendFor(node, paint);
        ctx.drawImage(strokeScratch, 0, 0);
        ctx.restore();
    }
}

// The line an underline or strikethrough draws: its distance below the baseline, thickness and
// paint, from the text's settings or the font's own proportions.
function decorationLine(f: Fragment, kind: "underline" | "strikethrough") {
    const size = f.style.fontSize;
    const offset = kind === "strikethrough" ? -size * 0.3 : (f.style.decorationOffset ?? size * 0.12);
    const thickness = Math.max(0.5, f.style.decorationThickness ?? Math.max(1, size / 14));
    return { offset, thickness };
}

// Underlines and strikethroughs: solid, double, dotted, dashed or wavy lines in the text's own
// paint or a colour of their own, skipping descenders (underline only) unless told not to.
function decorate(ctx: CanvasRenderingContext2D, f: Fragment, x: number, width: number, baseline: number, box: Box, text: string) {
    const kind = f.style.decoration !== "none" ? f.style.decoration : f.style.hyperlink ? "underline" : "none";
    if (kind === "none" || width <= 0) return;
    const paint = visiblePaints(f.style.fills).find((p) => p.type !== "image");
    if (!paint && !f.style.decorationColor) return;
    const { offset, thickness } = decorationLine(f, kind);
    const style = f.style.decorationStyle ?? "solid";
    ctx.save();
    if (f.style.decorationColor) ctx.strokeStyle = f.style.decorationColor;
    else if (paint) {
        ctx.globalAlpha *= paint.opacity;
        ctx.strokeStyle = fillStyle(ctx, paint, box);
    }
    ctx.lineWidth = thickness;
    ctx.lineCap = "butt";
    const y = baseline + offset + thickness / 2;
    const line = (c: CanvasRenderingContext2D, at: number) => {
        c.beginPath();
        if (style === "wavy") {
            const amp = Math.max(thickness, f.style.fontSize / 24);
            const step = amp * 2;
            c.moveTo(x, at);
            for (let px = x, i = 0; px < x + width; px += step, i++) c.quadraticCurveTo(px + step / 2, at + (i % 2 ? amp : -amp), Math.min(px + step, x + width), at);
        } else {
            if (style === "dotted") c.setLineDash([thickness, thickness * 1.5]);
            else if (style === "dashed") c.setLineDash([thickness * 4, thickness * 2]);
            c.moveTo(x, at);
            c.lineTo(x + width, at);
        }
        c.stroke();
    };
    const lines = (c: CanvasRenderingContext2D) => {
        if (style === "double") {
            line(c, y - thickness);
            line(c, y + thickness);
        } else line(c, y);
    };
    // Skip ink: the underline stays clear of the letters' descenders by cutting a gap around them.
    if (kind === "underline" && f.style.decorationSkipInk !== false && text && ctx.canvas.width && ctx.canvas.height) {
        ctx.save();
        const gap = Math.max(1, thickness * 1.2);
        // The letters, grown by the gap, as a clip that keeps everything else.
        const main = ctx.canvas;
        strokeScratch ??= document.createElement("canvas");
        if (strokeScratch.width !== main.width || strokeScratch.height !== main.height) {
            strokeScratch.width = main.width;
            strokeScratch.height = main.height;
        }
        const s = strokeScratch.getContext("2d");
        if (s) {
            s.setTransform(1, 0, 0, 1, 0, 0);
            s.globalCompositeOperation = "source-over";
            s.globalAlpha = 1;
            s.filter = "none";
            s.clearRect(0, 0, main.width, main.height);
            s.setTransform(ctx.getTransform());
            s.lineWidth = thickness;
            s.strokeStyle = ctx.strokeStyle;
            s.globalAlpha = ctx.globalAlpha;
            lines(s);
            // Cut the descenders (plus a gap) out of the line, then lay it on.
            s.globalCompositeOperation = "destination-out";
            applyFont(s, f.font, f.tracking, f.caps, f.wordSpacing);
            s.textBaseline = "alphabetic";
            s.textAlign = "left";
            s.lineWidth = gap * 2;
            s.lineJoin = "round";
            s.strokeStyle = "#000";
            s.setLineDash([]);
            s.strokeText(text, x, baseline);
            s.fillStyle = "#000";
            s.fillText(text, x, baseline);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.drawImage(strokeScratch, 0, 0);
        }
        ctx.restore();
        ctx.restore();
        return;
    }
    lines(ctx);
    ctx.restore();
}

// Visible width of a fragment on its line (trailing spaces at a wrap aren't underlined).
function visibleWidth(line: LayoutLine, f: Fragment): number {
    const lineRight = line.x + line.width;
    return Math.max(0, Math.min(f.x + f.width, lineRight) - f.x);
}

export function drawTextLayer(ctx: CanvasRenderingContext2D, node: SceneNode, pixelScale: number, time: number | null = null) {
    ensureTextFonts(node);
    const layout = layoutText(node);
    const dy = node.y + verticalOffset(node, layout);
    const dx = node.x;
    const box = { x: node.x, y: node.y, w: node.w, h: node.h };
    const rtl = node.direction === "rtl";
    const stagger = time !== null && node.animation?.stagger ? staggerPieces(node, layout, time) : null;
    for (const line of layout.lines) {
        const baseline = dy + line.baseline;
        if (line.marker) {
            const m = line.marker;
            const markerFragment: Fragment = { start: line.start, end: line.start, text: m.text, x: m.x, width: m.width, style: m.style, font: m.font, tracking: 0, wordSpacing: 0, caps: "normal", ascent: 0, descent: 0 };
            drawPiece(ctx, node, markerFragment, m.text, dx + m.x, baseline, box, pixelScale, false);
        }
        if (stagger) continue;
        for (const f of line.fragments) {
            drawPiece(ctx, node, f, f.text, dx + f.x, baseline, box, pixelScale, rtl);
            strokeText(ctx, node, f, f.text, dx + f.x, baseline, box, rtl);
            decorate(ctx, f, dx + f.x, visibleWidth(line, f), baseline, box, f.text);
        }
    }
    if (!stagger) return;
    // Text stagger: each unit drawn on its own with its offset, rotation, scale, opacity and blur.
    for (const piece of stagger) {
        if (piece.opacity <= 0) continue;
        ctx.save();
        const cx = dx + piece.cx;
        const cy = dy + piece.cy;
        if (piece.clip) {
            ctx.beginPath();
            ctx.rect(dx + piece.x, dy + piece.line.top, piece.width, piece.line.height);
            ctx.clip();
        }
        ctx.translate(cx + piece.dx, cy + piece.dy);
        if (piece.rotation) ctx.rotate((piece.rotation * Math.PI) / 180);
        if (piece.scale !== 1) ctx.scale(piece.scale, piece.scale);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha *= piece.opacity;
        if (piece.blur > 0) ctx.filter = `blur(${piece.blur * pixelScale}px)`;
        const f = piece.fragment;
        drawPiece(ctx, node, f, piece.text, dx + piece.x, dy + piece.line.baseline, box, pixelScale, false);
        strokeText(ctx, node, f, piece.text, dx + piece.x, dy + piece.line.baseline, box, false);
        decorate(ctx, f, dx + piece.x, piece.width, dy + piece.line.baseline, box, piece.text);
        ctx.restore();
    }
}
