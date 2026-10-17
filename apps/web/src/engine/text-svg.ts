import { featureSettings, variationSettings } from "./fonts";
import { visiblePaints } from "./paint";
import type { CharStyle } from "./rich-text";
import { type Fragment, layoutText, verticalOffset } from "./text-layout";
import type { Paint, SceneNode } from "./types";

// A text layer as SVG <text> elements: one per styled piece of a line, each paint stacked like
// the canvas draws them, list markers included. Fonts are named by family, so the SVG renders
// wherever those fonts are available.

const num = (n: number) => String(Math.round(n * 100) / 100);
const esc = (text: unknown) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function fontAttrs(style: CharStyle, tracking: number): string {
    const css: string[] = [];
    const feat = featureSettings(style.openType);
    const vars = variationSettings(style.fontVariations);
    if (feat) css.push(`font-feature-settings:${feat.replace(/"/g, "'")}`);
    if (vars) css.push(`font-variation-settings:${vars.replace(/"/g, "'")}`);
    const deco = style.decoration === "underline" || (style.decoration === "none" && style.hyperlink) ? "underline" : style.decoration === "strikethrough" ? "line-through" : "";
    if (deco) {
        // The line's style, offset, thickness, colour and ink skipping, as CSS (where SVG viewers read it).
        if (style.decorationStyle && style.decorationStyle !== "solid") css.push(`text-decoration-style:${style.decorationStyle}`);
        if (style.decorationThickness != null) css.push(`text-decoration-thickness:${num(style.decorationThickness)}px`);
        if (style.decorationOffset != null && deco === "underline") css.push(`text-underline-offset:${num(style.decorationOffset)}px`);
        if (style.decorationColor) css.push(`text-decoration-color:${style.decorationColor}`);
        if (style.decorationSkipInk === false) css.push(`text-decoration-skip-ink:none`);
    }
    return [
        `font-family="${esc(style.fontFamily)}, sans-serif"`,
        `font-size="${num(style.fontSize)}"`,
        `font-weight="${Math.round(style.fontVariations.wght ?? style.fontWeight)}"`,
        style.italic ? 'font-style="italic"' : "",
        style.textCase === "small-caps" || style.openType.smcp ? 'font-variant="small-caps"' : style.textCase === "small-caps-forced" ? 'style="font-variant-caps:all-small-caps"' : "",
        tracking ? `letter-spacing="${num(tracking)}"` : "",
        deco ? `text-decoration="${deco}"` : "",
        css.length ? `style="${esc(css.join(";"))}"` : "",
    ]
        .filter(Boolean)
        .join(" ");
}

export function textSvg(node: SceneNode, paint: (p: Paint) => string, attrs: (p: Paint) => string): string {
    const layout = layoutText(node);
    const dy = node.y + verticalOffset(node, layout);
    const out: string[] = [];
    // Strokes on text: a centre stroke at the weight; inside and outside at twice the weight, drawn
    // under the fill (outside) or over it (inside, as near as SVG text gets without a clip).
    const strokes = node.strokeWidth > 0 ? visiblePaints(node.strokes).filter((q) => q.type !== "image" && q.type !== "pattern" && q.type !== "shader") : [];
    const strokeAttrs = (p: Paint) => {
        const align = node.strokeAlign ?? "center";
        const width = align === "center" ? node.strokeWidth : node.strokeWidth * 2;
        const dash = node.dash && (node.dash[0] > 0 || node.dash[1] > 0) ? ` stroke-dasharray="${num(node.dash[0])} ${num(node.dash[1])}"` : "";
        return ` fill="none" stroke="${paint(p)}" stroke-width="${num(width)}" stroke-linejoin="${esc(node.strokeJoin ?? "miter")}"${dash}${attrs(p)}`;
    };
    const piece = (f: Pick<Fragment, "style" | "tracking" | "wordSpacing">, text: string, x: number, y: number) => {
        if (!text) return;
        const spacing = f.wordSpacing ? ` word-spacing="${num(f.wordSpacing)}"` : "";
        const open = `<text xml:space="preserve" x="${num(x)}" y="${num(y)}" ${fontAttrs(f.style, f.tracking)}${spacing}`;
        const dir = node.direction === "rtl" ? ' direction="rtl" unicode-bidi="plaintext"' : "";
        if ((node.strokeAlign ?? "center") === "outside") for (const p of strokes) out.push(`${open}${strokeAttrs(p)}${dir}>${esc(text)}</text>`);
        for (const p of visiblePaints(f.style.fills).filter((q) => q.type !== "image")) {
            out.push(`${open} fill="${paint(p)}"${attrs(p)}${dir}>${esc(text)}</text>`);
        }
        if ((node.strokeAlign ?? "center") !== "outside") for (const p of strokes) out.push(`${open}${strokeAttrs(p)}${dir}>${esc(text)}</text>`);
    };
    for (const line of layout.lines) {
        const y = dy + line.baseline;
        if (line.marker) piece({ style: line.marker.style, tracking: 0, wordSpacing: 0 }, line.marker.text, node.x + line.marker.x, y);
        for (const f of line.fragments) piece(f, f.text.replace(/\s+$/, (m) => (f.end >= line.end && !line.hard ? "" : m)), node.x + f.x, y);
    }
    return out.join("");
}
