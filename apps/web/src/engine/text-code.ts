import { featureSettings, variationSettings } from "./fonts";
import { type CharStyle, baseStyle, styledRuns } from "./rich-text";
import type { SceneNode } from "./types";

// Inspect code for text: the CSS of each differently styled range of a rich text layer (the reference's
// Code view lists one block per style), plus the type settings plain CSS for the layer misses.

const round = (v: number) => Math.round(v * 100) / 100;

function solidColor(style: CharStyle): string | null {
    const fill = style.fills.find((p) => p.visible && p.type === "solid");
    return fill?.type === "solid" ? (fill.opacity < 1 ? `${fill.color}${Math.round(fill.opacity * 255).toString(16).padStart(2, "0")}` : fill.color) : null;
}

export function charCss(style: CharStyle, base: CharStyle | null): string[] {
    const out: string[] = [];
    const diff = <K extends keyof CharStyle>(k: K) => !base || JSON.stringify(style[k]) !== JSON.stringify(base[k]);
    if (diff("fontFamily")) out.push(`font-family: "${style.fontFamily}";`);
    if (diff("fontSize")) out.push(`font-size: ${round(style.fontSize)}px;`);
    if (diff("fontWeight") || diff("fontVariations")) out.push(`font-weight: ${Math.round(style.fontVariations.wght ?? style.fontWeight)};`);
    if (diff("italic") && (style.italic || base)) out.push(`font-style: ${style.italic ? "italic" : "normal"};`);
    if (diff("lineHeight") || diff("fontSize")) if (style.lineHeight !== null || base) out.push(`line-height: ${style.lineHeight === null ? "normal" : `${round(style.lineHeight * style.fontSize)}px`};`);
    if (diff("letterSpacing") && (style.letterSpacing || base)) out.push(`letter-spacing: ${round((style.letterSpacing / 100) * style.fontSize)}px;`);
    if (diff("decoration") && (style.decoration !== "none" || base)) out.push(`text-decoration: ${style.decoration === "strikethrough" ? "line-through" : style.decoration};`);
    if (diff("textCase") && (style.textCase !== "none" || base)) {
        if (style.textCase === "small-caps") out.push("font-variant: small-caps;");
        else if (style.textCase === "small-caps-forced") out.push("font-variant-caps: all-small-caps;");
        else out.push(`text-transform: ${style.textCase === "upper" ? "uppercase" : style.textCase === "lower" ? "lowercase" : style.textCase === "title" ? "capitalize" : "none"};`);
    }
    const feat = featureSettings(style.openType);
    if (diff("openType") && (feat || base)) out.push(`font-feature-settings: ${feat || "normal"};`);
    const vars = variationSettings(style.fontVariations);
    if (diff("fontVariations") && (vars || base)) out.push(`font-variation-settings: ${vars || "normal"};`);
    const color = solidColor(style);
    if (diff("fills") && color && base) out.push(`color: ${color};`);
    return out;
}

// Extra lines for the layer itself (type settings beyond font, size and line height).
export function layerTextCss(node: SceneNode): string[] {
    const base = baseStyle(node);
    const out = charCss(base, null).filter((l) => /^(text-decoration|text-transform|font-variant|font-feature-settings|font-variation-settings|font-style)/.test(l));
    if (node.paragraphSpacing) out.push(`/* paragraph spacing */ margin-bottom: ${round(node.paragraphSpacing)}px;`);
    if (node.paragraphIndent) out.push(`text-indent: ${round(node.paragraphIndent)}px;`);
    if (node.textWrap && node.textWrap !== "auto") out.push(`text-wrap: ${node.textWrap};`);
    if (node.truncate !== false && node.maxLines) out.push("overflow: hidden;", "display: -webkit-box;", `-webkit-line-clamp: ${node.maxLines};`, "-webkit-box-orient: vertical;");
    return out;
}

// One block per run that differs from the layer: a label (the run's text) and its CSS.
export function richTextBlocks(node: SceneNode): { title: string; lines: string[] }[] {
    if (node.type !== "text" || !node.spans?.length) return [];
    const base = baseStyle(node);
    const text = node.text ?? "";
    const blocks: { title: string; lines: string[] }[] = [];
    for (const run of styledRuns(node)) {
        if (!Object.keys(run.own).length) continue;
        const lines = charCss(run.style, base);
        if (run.style.hyperlink && run.style.hyperlink !== base.hyperlink) lines.push(`/* link: ${run.style.hyperlink} */`);
        if (!lines.length) continue;
        const label = text.slice(run.start, run.end).replace(/\s+/g, " ").trim();
        blocks.push({ title: `"${label.length > 28 ? `${label.slice(0, 27)}…` : label}"`, lines });
    }
    return blocks;
}
