import { durationOf, hasAnimation, valueAt } from "./animation";
import type { AnimProp } from "./types";
import { booleanResult, hasGlyphOutlines, textSubpaths } from "./booleans";
import { effectsOf } from "./effects";
import { placement } from "./image-crop";
import { hasVariableWidth, ribbonSubpaths } from "./width-profile";
import { hasStyledStroke, styledStrokeSubpaths } from "./stroke-styles";
import { selectionBounds } from "./nodes";
import { gradientAngle, visiblePaints } from "./paint";
import { textSvg } from "./text-svg";
import { localMatrix, parentMatrix, worldBounds } from "./transform";
import type { NagmaDocument, Paint, PatternPaint, SceneNode, ShaderPaint, Subpath } from "./types";
import { patternGrid } from "./pattern";
import { dashOf, miterLimitOf, sideBandD, sideWeights } from "./stroke";
import { exportBounds } from "./effect-bounds";
import { isFrameLike } from "./components";
import { placedSubpaths, shapeSubpaths } from "./vector";
import { regionFillSubpaths } from "./vector-network";
import { shaderDataUrl } from "../canvas/shader-paint";

// Builds a standalone SVG of a layer, matching what the canvas draws: paints (solid, gradients,
// images), strokes, text, vectors, booleans (as their combined paths), shadows, blur, opacity and blend modes.

// A huge rectangle; combined even-odd with a shape it means "everywhere outside the shape".
const EVERYWHERE = "M-100000 -100000 H100000 V100000 H-100000 Z";

// Escapes text for an attribute or element. Every string that comes from the document (names,
// colours, image data, enum fields) goes through it: files and collaborators can hold anything, and
// the SVG is inlined into published pages.
function esc(text: unknown): string {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function num(n: number): string {
    return String(Math.round(n * 1000) / 1000);
}

function pathData(subpaths: Subpath[]): string {
    const parts: string[] = [];
    for (const sub of subpaths) {
        const first = sub.points[0];
        if (!first) continue;
        parts.push(`M${num(first.x)} ${num(first.y)}`);
        const n = sub.points.length;
        const segments = sub.closed ? n : n - 1;
        for (let i = 0; i < segments; i++) {
            const a = sub.points[i];
            const b = sub.points[(i + 1) % n];
            if (!a || !b) continue;
            if (!a.out && !b.in) parts.push(`L${num(b.x)} ${num(b.y)}`);
            else {
                const c1 = a.out ?? a;
                const c2 = b.in ?? b;
                parts.push(`C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(b.x)} ${num(b.y)}`);
            }
        }
        if (sub.closed) parts.push("Z");
    }
    return parts.join(" ");
}

function matrixAttr(m: DOMMatrix): string {
    if (m.isIdentity) return "";
    return ` transform="matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(num).join(" ")})"`;
}

export interface SvgOptions {
    // Layer names as ids.
    includeId?: boolean;
    // Inside and outside strokes of rectangles and ellipses written as centre strokes on an inset
    // or outset shape (no clip paths); other shapes keep the clip.
    simplifyStroke?: boolean;
    // Text as vector outlines when glyph outlines are available (engine/booleans.ts textSubpaths).
    outlineText?: boolean;
}

class SvgWriter {
    defs: string[] = [];
    styles: string[] = [];
    private counter = 0;
    private doc: NagmaDocument;
    // Set to the animation's length to write Motion keyframes as CSS animations.
    private animate: number | null;
    private options: SvgOptions;
    private usedIds = new Set<string>();
    constructor(doc: NagmaDocument, animate: number | null = null, options: SvgOptions = {}) {
        this.doc = doc;
        this.animate = animate;
        this.options = options;
    }

    // Layer names as element ids (unique, XML-safe), when "Include id attribute" is on.
    layerId(node: SceneNode): string {
        if (!this.options.includeId) return "";
        const base = node.name.trim().replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^([^A-Za-z_])/, "_$1") || "layer";
        let id = base;
        let n = 2;
        while (this.usedIds.has(id)) id = `${base}_${n++}`;
        this.usedIds.add(id);
        return ` id="${esc(id)}"`;
    }

    // CSS keyframes for a layer's Motion tracks: position and size as a transform about the
    // layer's centre, rotation on top, opacity as is. Fill and radius tracks aren't carried.
    animation(node: SceneNode): string {
        if (!this.animate || !hasAnimation(node)) return "";
        const tracks = node.animation?.tracks ?? {};
        const times = new Set<number>([0, this.animate]);
        for (const track of Object.values(tracks)) for (const k of track ?? []) times.add(Math.min(this.animate, k.t));
        const cx0 = node.x + node.w / 2;
        const cy0 = node.y + node.h / 2;
        const at = (prop: AnimProp, t: number) => Number(valueAt(node, prop, t));
        const easeAt = (t: number): string => {
            for (const track of Object.values(tracks)) {
                const k = (track ?? []).filter((f) => f.t <= t).sort((a, b) => b.t - a.t)[0];
                if (k) return k.easing;
            }
            return "linear";
        };
        const frames = [...times]
            .sort((a, b) => a - b)
            .map((t) => {
                const w = at("w", t);
                const h = at("h", t);
                const cx = at("x", t) + w / 2;
                const cy = at("y", t) + h / 2;
                const rot = at("rotation", t) - node.rotation;
                const sx = node.w > 0 ? w / node.w : 1;
                const sy = node.h > 0 ? h / node.h : 1;
                const pct = num((t / (this.animate as number)) * 100);
                return `${pct}% { transform: translate(${num(cx - cx0)}px, ${num(cy - cy0)}px) rotate(${num(rot)}deg) scale(${num(sx)}, ${num(sy)}); opacity: ${num(at("opacity", t))}; animation-timing-function: ${esc(easeAt(t).replace(/[;{}]/g, ""))}; }`;
            });
        const name = this.id("anim");
        this.styles.push(`@keyframes ${name} { ${frames.join(" ")} }`);
        return ` style="transform-box: view-box; transform-origin: ${num(cx0)}px ${num(cy0)}px; animation: ${name} ${num(this.animate)}ms linear infinite both"`;
    }

    id(prefix: string): string {
        this.counter += 1;
        return `${prefix}${this.counter}`;
    }

    // The geometry of a layer as an SVG shape element (without paint).
    shape(node: SceneNode, attrs: string): string {
        // Booleans are written as their combined geometry, the same paths the canvas draws.
        if (node.type === "boolean") return `<path d="${pathData(booleanResult(this.doc, node))}"${attrs}/>`;
        if (node.type === "ellipse" && !node.arc) {
            return `<ellipse cx="${num(node.x + node.w / 2)}" cy="${num(node.y + node.h / 2)}" rx="${num(node.w / 2)}" ry="${num(node.h / 2)}"${attrs}/>`;
        }
        // Arcs, independent radii and smoothed corners share the canvas geometry.
        if (node.type === "vector" || node.type === "ellipse" || node.radii || node.cornerSmoothing) return `<path d="${pathData(shapeSubpaths(node))}"${attrs}/>`;
        const r = Math.max(0, Math.min(node.radius, node.w / 2, node.h / 2));
        return `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}"${r ? ` rx="${num(r)}"` : ""}${attrs}/>`;
    }

    // A pattern paint: the source layer drawn into an SVG pattern tile (with the stagger for
    // hexagonal layouts), repeated from the aligned origin.
    patternDepth = 0;

    pattern(paint: PatternPaint, node: SceneNode): string {
        const source = this.doc.nodes[paint.sourceId];
        const box = source ? selectionBounds(this.doc, [source.id]) : null;
        const grid = box ? patternGrid(paint, box) : null;
        if (!source || !box || !grid || this.patternDepth > 2) return "none";
        this.patternDepth++;
        const body = this.node({ ...source, visible: true });
        this.patternDepth--;
        const k = grid.tileW / box.w;
        const placed = `<g${matrixAttr(parentMatrix(this.doc, source))}>${body}</g>`;
        const copies = grid.copies.map((c) => `<g transform="translate(${num(c.x)} ${num(c.y)}) scale(${num(k)}) translate(${num(-box.x)} ${num(-box.y)})">${placed}</g>`).join("");
        const o = grid.origin(node);
        const id = this.id("pat");
        this.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(o.x)}" y="${num(o.y)}" width="${num(grid.blockW)}" height="${num(grid.blockH)}">${copies}</pattern>`);
        return `url(#${id})`;
    }

    // An inside or outside stroke of a plain rectangle or ellipse as a centre stroke on the inset or
    // outset shape, the way the reference's "Simplify stroke" writes it. Null when the shape can't be.
    centredStroke(node: SceneNode, align: "inside" | "outside", paint: Paint): string | null {
        const plainRect = node.type === "rect" && !node.radii && !node.cornerSmoothing && !node.strokeSides;
        const plainEllipse = node.type === "ellipse" && !node.arc;
        if (!plainRect && !plainEllipse) return null;
        const half = (node.strokeWidth / 2) * (align === "inside" ? 1 : -1);
        const w = node.w - half * 2;
        const h = node.h - half * 2;
        if (w <= 0 || h <= 0) return null;
        const dash = node.dash && (node.dash[0] > 0 || node.dash[1] > 0) ? ` stroke-dasharray="${num(node.dash[0])} ${num(node.dash[1])}"` : "";
        const attrs = ` fill="none" stroke="${this.paint(paint, node)}" stroke-width="${num(node.strokeWidth)}" stroke-linejoin="${esc(node.strokeJoin ?? "miter")}"${dash}${this.paintAttrs(paint, node)}`;
        if (plainEllipse) return `<ellipse cx="${num(node.x + node.w / 2)}" cy="${num(node.y + node.h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}"${attrs}/>`;
        const r = Math.max(0, Math.min(node.radius, node.w / 2, node.h / 2) - half);
        return `<rect x="${num(node.x + half)}" y="${num(node.y + half)}" width="${num(w)}" height="${num(h)}"${r ? ` rx="${num(r)}"` : ""}${attrs}/>`;
    }

    // A shader paint: rendered once at the layer's size (at 2x) and embedded as an image tile.
    shader(paint: ShaderPaint, node: SceneNode): string {
        const data = shaderDataUrl(`svg:${node.id}`, paint, Math.max(1, node.w * 2), Math.max(1, node.h * 2));
        if (!data) return "none";
        const id = this.id("shader");
        this.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}"><image href="${esc(data)}" width="${num(node.w)}" height="${num(node.h)}" preserveAspectRatio="none"/></pattern>`);
        return `url(#${id})`;
    }

    // A paint as an SVG fill/stroke value (defining gradients and patterns as needed).
    paint(paint: Paint, node: SceneNode): string {
        if (paint.type === "solid") return esc(paint.color);
        if (paint.type === "image") {
            const id = this.id("img");
            const data = this.doc.images[paint.id] ?? "";
            if (paint.mode === "tile") {
                // A repeating pattern at the tile scale; the image's own size isn't known here, so the
                // tile is the layer's box scaled, which matches the canvas for images of that size.
                const k = paint.tileScale ?? 0.5;
                this.defs.push(
                    `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w * k)}" height="${num(node.h * k)}"><image href="${esc(data)}" width="${num(node.w * k)}" height="${num(node.h * k)}" preserveAspectRatio="none"/></pattern>`,
                );
                return `url(#${id})`;
            }
            const aspect = paint.mode === "fit" ? "xMidYMid meet" : "xMidYMid slice";
            this.defs.push(
                `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}"><image href="${esc(data)}" width="${num(node.w)}" height="${num(node.h)}" preserveAspectRatio="${aspect}"/></pattern>`,
            );
            return `url(#${id})`;
        }
        if (paint.type === "pattern") return this.pattern(paint, node);
        if (paint.type === "shader") return this.shader(paint, node);
        const stops = [...paint.stops]
            .sort((a, b) => a.position - b.position)
            .map((s) => `<stop offset="${num(s.position)}" stop-color="${esc(s.color)}"${s.opacity < 1 ? ` stop-opacity="${num(s.opacity)}"` : ""}/>`)
            .join("");
        const fx = node.x + paint.from.x * node.w;
        const fy = node.y + paint.from.y * node.h;
        const tx = node.x + paint.to.x * node.w;
        const ty = node.y + paint.to.y * node.h;
        const id = this.id("grad");
        if (paint.type === "linear") {
            this.defs.push(
                `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(fx)}" y1="${num(fy)}" x2="${num(tx)}" y2="${num(ty)}">${stops}</linearGradient>`,
            );
        } else if (paint.type === "radial") {
            this.defs.push(
                `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(fx)}" cy="${num(fy)}" r="${num(Math.hypot(tx - fx, ty - fy))}">${stops}</radialGradient>`,
            );
        } else {
            // SVG has no conic gradient; a linear gradient along the start angle is the closest stand-in.
            const rad = (gradientAngle(paint) * Math.PI) / 180;
            const half = Math.max(node.w, node.h) / 2;
            this.defs.push(
                `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(fx - Math.cos(rad) * half)}" y1="${num(fy - Math.sin(rad) * half)}" x2="${num(fx + Math.cos(rad) * half)}" y2="${num(fy + Math.sin(rad) * half)}">${stops}</linearGradient>`,
            );
        }
        return `url(#${id})`;
    }

    paintAttrs(paint: Paint, node: SceneNode): string {
        const mode = paint.blend !== "normal" ? paint.blend : node.blendMode;
        const blend = mode !== "normal" && mode !== "pass-through" ? ` style="mix-blend-mode:${esc(String(mode).replace(/[;:{}]/g, ""))}"` : "";
        return `${paint.opacity < 1 ? ` opacity="${num(paint.opacity)}"` : ""}${blend}`;
    }

    // Shadows (with spread), inner shadows, layer blur and motion blur as one SVG filter.
    effects(node: SceneNode): string {
        const list = effectsOf(node).filter((e) => e.visible && e.type !== "background-blur");
        if (!list.length) return "";
        const id = this.id("fx");
        const parts: string[] = [];
        const below: string[] = [];
        const above: string[] = [];
        let blurX = 0;
        let blurY = 0;
        list.forEach((e, i) => {
            const shape = (from: string, grow: number) =>
                grow ? `<feMorphology in="${from}" operator="${grow > 0 ? "dilate" : "erode"}" radius="${num(Math.abs(grow))}" result="m${i}"/>` : `<feOffset in="${from}" dx="0" dy="0" result="m${i}"/>`;
            const tail = `<feOffset in="m${i}" dx="${num(e.x)}" dy="${num(e.y)}" result="o${i}"/><feGaussianBlur in="o${i}" stdDeviation="${num(e.blur / 2)}" result="b${i}"/><feFlood flood-color="${esc(e.color)}" flood-opacity="${num(e.opacity)}"/><feComposite operator="in" in2="b${i}" result="c${i}"/>`;
            if (e.type === "drop-shadow") {
                parts.push(shape("SourceAlpha", e.spread) + tail);
                below.push(`c${i}`);
            } else if (e.type === "inner-shadow") {
                parts.push(`<feComponentTransfer in="SourceAlpha" result="n${i}"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>${shape(`n${i}`, e.spread)}${tail}<feComposite operator="in" in="c${i}" in2="SourceAlpha" result="i${i}"/>`);
                above.push(`i${i}`);
            } else if (e.type === "layer-blur") {
                blurX += e.blur / 2;
                blurY += e.blur / 2;
            } else if (e.type === "motion-blur") {
                // SVG blurs only along the axes, so the direction is split between them.
                const rad = ((e.angle ?? 0) * Math.PI) / 180;
                blurX += (Math.abs(Math.cos(rad)) * e.blur) / 3;
                blurY += (Math.abs(Math.sin(rad)) * e.blur) / 3;
            }
        });
        parts.push(`<feMerge result="all">${[...below, "SourceGraphic", ...above].map((r) => `<feMergeNode in="${r}"/>`).join("")}</feMerge>`);
        if (blurX > 0 || blurY > 0) parts.push(`<feGaussianBlur in="all" stdDeviation="${num(blurX)} ${num(blurY)}"/>`);
        this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join("")}</filter>`);
        return ` filter="url(#${id})"`;
    }

    text(node: SceneNode): string {
        return textSvg(
            node,
            (paint) => this.paint(paint, node),
            (paint) => this.paintAttrs(paint, node),
        );
    }

    // Children in order; a mask child wraps the siblings above it (up to the next mask) in an SVG mask.
    children(node: SceneNode): string {
        const kids = node.children.map((id) => this.doc.nodes[id]).filter((c): c is SceneNode => Boolean(c));
        const out: string[] = [];
        let i = 0;
        while (i < kids.length) {
            const child = kids[i] as SceneNode;
            if (!child.isMask || !child.visible) {
                out.push(this.node(child));
                i++;
                continue;
            }
            const run: SceneNode[] = [];
            let j = i + 1;
            while (j < kids.length && !kids[j]?.isMask) run.push(kids[j++] as SceneNode);
            const id = this.id("mask");
            const shape = this.node({ ...child, isMask: false, fills: child.fills.length ? child.fills : [{ type: "solid", color: "#FFFFFF", opacity: 1, visible: true, blend: "normal" }] });
            // SVG masks read luminance. An alpha or vector mask (the default) keeps what the mask
            // layer covers whatever its colour, so its colours turn white and only its alpha counts;
            // before, a black mask shape (black being the usual) hid everything in the export.
            let content = shape;
            if (child.maskType !== "luminance") {
                const white = this.id("maskalpha");
                this.defs.push(`<filter id="${white}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter>`);
                content = `<g filter="url(#${white})">${shape}</g>`;
            }
            this.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse"${child.maskType !== "luminance" ? ' style="mask-type:alpha"' : ""}>${content}</mask>`);
            out.push(`<g mask="url(#${id})">${run.map((r) => this.node(r)).join("")}</g>`);
            i = j;
        }
        return out.join("");
    }

    node(node: SceneNode): string {
        if (!node.visible) return "";
        const parts: string[] = [];
        if (node.type === "text" && this.options.outlineText && hasGlyphOutlines()) {
            const d = pathData(textSubpaths(node));
            for (const paint of visiblePaints(node.fills)) if (paint.type !== "image") parts.push(`<path d="${d}" fill="${this.paint(paint, node)}"${this.paintAttrs(paint, node)}/>`);
            // Strokes on outlined text are clipped to or cut out of the glyphs, like a shape's.
            if (node.strokeWidth > 0) {
                const align = node.strokeAlign ?? "center";
                for (const paint of visiblePaints(node.strokes)) {
                    if (paint.type === "image" || paint.type === "pattern" || paint.type === "shader") continue;
                    const width = align === "center" ? node.strokeWidth : node.strokeWidth * 2;
                    const dashes = dashOf(node);
                    const stroke = `<path d="${d}" fill="none" stroke="${this.paint(paint, node)}" stroke-width="${num(width)}" stroke-linejoin="${esc(node.strokeJoin ?? "miter")}"${dashes ? ` stroke-dasharray="${dashes.map(num).join(" ")}"` : ""}${this.paintAttrs(paint, node)}/>`;
                    if (align === "center") parts.push(stroke);
                    else {
                        const id = this.id("stroke");
                        this.defs.push(align === "inside" ? `<clipPath id="${id}"><path d="${d}"/></clipPath>` : `<clipPath id="${id}"><path clip-rule="evenodd" d="${EVERYWHERE} ${d}"/></clipPath>`);
                        parts.push(`<g clip-path="url(#${id})">${stroke}</g>`);
                    }
                }
            }
        } else if (node.type === "text") parts.push(this.text(node));
        else if (node.type !== "group" && node.type !== "page") {
            for (const paint of visiblePaints(node.fills)) {
                if (paint.type === "image" && paint.mode === "crop" && paint.crop) {
                    // A cropped image: the image placed by its crop, clipped to the shape.
                    const clip = this.id("crop");
                    const m = placement(this.doc, node, paint);
                    this.defs.push(`<clipPath id="${clip}">${this.shape(node, "")}</clipPath>`);
                    parts.push(`<g clip-path="url(#${clip})"${this.paintAttrs(paint, node)}><image href="${esc(this.doc.images[paint.id] ?? "")}" width="1" height="1" preserveAspectRatio="none"${matrixAttr(m)}/></g>`);
                    continue;
                }
                const regions = node.type === "vector" ? regionFillSubpaths(node, placedSubpaths(node)) : null;
                if (regions) parts.push(`<path d="${pathData(regions)}" fill="${this.paint(paint, node)}"${this.paintAttrs(paint, node)}/>`);
                else parts.push(this.shape(node, ` fill="${this.paint(paint, node)}"${this.paintAttrs(paint, node)}`));
            }
            const weights = !dashOf(node) ? sideWeights(node, isFrameLike(node)) : null;
            if (node.strokeWidth > 0 && (hasStyledStroke(node) || hasVariableWidth(node))) {
                // A variable-width, dynamic or brushed stroke is written as its filled outline.
                const d = pathData(hasStyledStroke(node) ? styledStrokeSubpaths(node) : ribbonSubpaths(node));
                for (const paint of visiblePaints(node.strokes)) if (paint.type !== "image") parts.push(`<path d="${d}" fill="${this.paint(paint, node)}"${this.paintAttrs(paint, node)}/>`);
            } else if (weights) {
                // Uneven sides: the band they cover, filled.
                const d = sideBandD(node, weights);
                for (const paint of visiblePaints(node.strokes)) if (paint.type !== "image") parts.push(`<path fill-rule="evenodd" d="${d}" fill="${this.paint(paint, node)}"${this.paintAttrs(paint, node)}/>`);
            } else if (node.strokeWidth > 0) {
                for (const paint of visiblePaints(node.strokes)) {
                    if (paint.type === "image") continue;
                    const open = node.type === "vector" && node.path?.subpaths.some((s) => !s.closed);
                    const align = open ? "center" : node.strokeAlign;
                    const width = align === "center" ? node.strokeWidth : node.strokeWidth * 2;
                    const dashes = dashOf(node);
                    const dash = dashes ? ` stroke-dasharray="${dashes.map(num).join(" ")}"` : "";
                    const strokeAttrs = ` fill="none" stroke="${this.paint(paint, node)}" stroke-width="${num(width)}" stroke-linejoin="${esc(node.strokeJoin ?? "miter")}"${(node.strokeJoin ?? "miter") === "miter" ? ` stroke-miterlimit="${num(miterLimitOf(node))}"` : ""} stroke-linecap="${esc(node.strokeCap ?? "butt")}"${dash}${this.paintAttrs(paint, node)}`;
                    // Dashed strokes on only some sides are those sides' lines (as the canvas draws
                    // them); the whole outline was written before, dashing every side.
                    const sides = sidesD(node);
                    if (sides === "") continue;
                    const stroked = sides ? `<path d="${sides}"${strokeAttrs}/>` : this.shape(node, strokeAttrs);
                    const simple = sides === null && align !== "center" && this.options.simplifyStroke ? this.centredStroke(node, align, paint) : null;
                    if (simple) parts.push(simple);
                    else if (align === "center") parts.push(stroked);
                    else {
                        // Inside strokes are clipped to the shape; outside strokes are masked out of it.
                        const id = this.id("stroke");
                        if (align === "inside") {
                            this.defs.push(`<clipPath id="${id}">${this.shape(node, "")}</clipPath>`);
                            parts.push(`<g clip-path="url(#${id})">${stroked}</g>`);
                        } else {
                            this.defs.push(`<clipPath id="${id}"><path clip-rule="evenodd" d="${EVERYWHERE} ${pathData(node.type === "boolean" ? booleanResult(this.doc, node) : shapeSubpaths(node))}"/></clipPath>`);
                            parts.push(`<g clip-path="url(#${id})">${stroked}</g>`);
                        }
                    }
                }
            }
        }
        if (node.children.length && node.type !== "boolean") {
            const inner = this.children(node);
            if ((node.type === "frame" || node.type === "component" || node.type === "instance" || node.type === "componentSet") && node.clip) {
                const id = this.id("frame");
                this.defs.push(`<clipPath id="${id}">${this.shape(node, "")}</clipPath>`);
                parts.push(`<g clip-path="url(#${id})">${inner}</g>`);
            } else parts.push(inner);
        }
        const opacity = node.opacity < 1 ? ` opacity="${num(node.opacity)}"` : "";
        const anim = this.animation(node);
        const inner = `<g${this.layerId(node)}${matrixAttr(localMatrix(node))}${opacity}${this.effects(node)} data-name="${esc(node.name)}">${parts.join("")}</g>`;
        return anim ? `<g${anim}>${inner}</g>` : inner;
    }
}

// The stroked sides of a rectangle or frame with some sides off, as separate lines (null: all sides).
function sidesD(node: SceneNode): string | null {
    const s = node.strokeSides;
    if (!s || (node.type !== "rect" && !isFrameLike(node)) || (s.top && s.right && s.bottom && s.left)) return null;
    const { x, y, w, h } = node;
    const lines = [s.top && `M${num(x)} ${num(y)}H${num(x + w)}`, s.right && `M${num(x + w)} ${num(y)}V${num(y + h)}`, s.bottom && `M${num(x)} ${num(y + h)}H${num(x + w)}`, s.left && `M${num(x)} ${num(y)}V${num(y + h)}`].filter(Boolean);
    // No side on at all draws nothing (an empty string), as on the canvas.
    return lines.join("");
}

export function exportSvg(doc: NagmaDocument, id: string, options: SvgOptions = {}): string | null {
    const node = doc.nodes[id];
    if (node?.isSlice) {
        // A slice exports what lies under it on its page.
        const page = pageIdOf(doc, node);
        return page ? exportRegionSvg(doc, page, worldBounds(doc, node), options) : null;
    }
    // Shadows, blurs and unclipped contents are part of the picture, as in the PNG export.
    const box = node ? exportBounds(doc, node) : null;
    if (!node || !box) return null;
    const writer = new SvgWriter(doc, null, options);
    const body = writer.node(node);
    // Place the layer as it sits in the world (including rotated parents), then frame it at the origin.
    const placed = `<g transform="translate(${num(-box.x)} ${num(-box.y)})"><g${matrixAttr(parentMatrix(doc, node))}>${body}</g></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(box.w)}" height="${num(box.h)}" viewBox="0 0 ${num(box.w)} ${num(box.h)}" fill="none"><defs>${writer.defs.join("")}</defs>${placed}</svg>`;
}

// Several layers in one SVG, each placed as it sits in the world, framed by their shared bounds.
export function exportSelectionSvg(doc: NagmaDocument, ids: string[], options: SvgOptions = {}): string | null {
    const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (nodes.length === 1 && nodes[0]) return exportSvg(doc, nodes[0].id, options);
    const box = selectionBounds(doc, nodes.map((n) => n.id));
    if (!nodes.length || !box) return null;
    const writer = new SvgWriter(doc, null, options);
    const body = nodes.map((node) => `<g${matrixAttr(parentMatrix(doc, node))}>${writer.node(node)}</g>`).join("");
    const placed = `<g transform="translate(${num(-box.x)} ${num(-box.y)})">${body}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(box.w)}" height="${num(box.h)}" viewBox="0 0 ${num(box.w)} ${num(box.h)}" fill="none"><defs>${writer.defs.join("")}</defs>${placed}</svg>`;
}

// A frame with its Motion keyframes as CSS animations inside the SVG.
export function exportAnimatedSvg(doc: NagmaDocument, id: string): string | null {
    const node = doc.nodes[id];
    const box = selectionBounds(doc, [id]);
    if (!node || !box) return null;
    const writer = new SvgWriter(doc, durationOf(doc, id));
    const body = writer.node(node);
    const placed = `<g transform="translate(${num(-box.x)} ${num(-box.y)})"><g${matrixAttr(parentMatrix(doc, node))}>${body}</g></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(box.w)}" height="${num(box.h)}" viewBox="0 0 ${num(box.w)} ${num(box.h)}" fill="none"><style>${writer.styles.join("\n")}</style><defs>${writer.defs.join("")}</defs>${placed}</svg>`;
}

function pageIdOf(doc: NagmaDocument, node: SceneNode): string | null {
    let cur: SceneNode | undefined = node;
    while (cur && cur.type !== "page") cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
    return cur?.id ?? null;
}

// Everything on a page within a world rectangle (slices, and exports that aren't contents only).
export function exportRegionSvg(doc: NagmaDocument, pageId: string, rect: { x: number; y: number; w: number; h: number }, options: SvgOptions = {}): string | null {
    const page = doc.nodes[pageId];
    if (!page || rect.w <= 0 || rect.h <= 0) return null;
    const writer = new SvgWriter(doc, null, options);
    const body = writer.children(page);
    const clip = writer.id("region");
    writer.defs.push(`<clipPath id="${clip}"><rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}"/></clipPath>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(rect.w)}" height="${num(rect.h)}" viewBox="0 0 ${num(rect.w)} ${num(rect.h)}" fill="none"><defs>${writer.defs.join("")}</defs><g transform="translate(${num(-rect.x)} ${num(-rect.y)})" clip-path="url(#${clip})">${body}</g></svg>`;
}
