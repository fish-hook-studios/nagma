import { fontString } from "./text";
import { layerTextCss } from "./text-code";
import { editor } from "./store";
import { refuseExport } from "./share-settings";
import type { NagmaDocument, Paint, SceneNode } from "./types";
import { findVariable } from "./variables";

// A layer as CSS, the way Inspect's Code section shows it; also behind Edit › Copy as › Copy as CSS.
function paintCss(paint: Paint, images: Record<string, string>): string | null {
    if (!paint.visible) return null;
    if (paint.type === "solid") return paint.opacity < 1 ? `${hexWithAlpha(paint.color, paint.opacity)}` : paint.color;
    if (paint.type === "pattern" || paint.type === "shader") return null;
    if (paint.type === "image") return images[paint.id] ? `url(<image ${paint.id}>) center / ${paint.mode === "fit" ? "contain" : "cover"} no-repeat` : null;
    const stops = paint.stops.map((s) => `${hexWithAlpha(s.color, s.opacity)} ${Math.round(s.position * 100)}%`).join(", ");
    if (paint.type === "radial") return `radial-gradient(circle, ${stops})`;
    if (paint.type === "angular") return `conic-gradient(${stops})`;
    const angle = Math.round((Math.atan2(paint.to.y - paint.from.y, paint.to.x - paint.from.x) * 180) / Math.PI + 90);
    return `linear-gradient(${angle}deg, ${stops})`;
}

function hexWithAlpha(hex: string, alpha: number) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return `${hex}${alpha < 1 ? a : ""}`.toUpperCase();
}

// A bound field reads as its variable (CSS custom property), the way handoff tools show tokens.
function varName(doc: NagmaDocument, node: SceneNode, key: string): string | null {
    const id = node.boundVariables?.[key] ?? (key.endsWith(":0") ? node.boundVariables?.[key.slice(0, -2)] : undefined);
    if (!id) return null;
    const v = findVariable(doc, id)?.variable;
    if (!v) return null;
    const web = v.codeSyntax?.web?.trim();
    if (web) return web.startsWith("--") ? `var(${web})` : web;
    return `var(--${v.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()})`;
}

export function cssFor(node: SceneNode, images: Record<string, string>, doc?: NagmaDocument): string {
    const lines: string[] = [];
    const bound = (key: string) => (doc ? varName(doc, node, key) : null);
    // Fill sizing stretches with its auto layout parent; hug leaves the size to the content.
    const parent = doc && node.parentId ? doc.nodes[node.parentId] : undefined;
    const inFlow = parent?.layout && node.positioning !== "absolute" ? parent.layout : null;
    const sizing = node.sizing ?? { h: "fixed", v: "fixed" };
    const along = (axis: "h" | "v") => (inFlow ? (inFlow.direction === "horizontal") === (axis === "h") : false);
    for (const [axis, prop, key, value] of [["h", "width", "w", node.w], ["v", "height", "h", node.h]] as const) {
        if (sizing[axis] === "fill") lines.push(inFlow && along(axis) ? "flex: 1 0 0;" : inFlow ? "align-self: stretch;" : `${prop}: 100%;`);
        else if (sizing[axis] !== "hug" || bound(key)) lines.push(`${prop}: ${bound(key) ?? `${round(value)}px`};`);
    }
    if (parent && node.positioning === "absolute" && parent.layout) lines.push("position: absolute;");
    if (node.type === "text") {
        const fill = node.fills.find((p) => p.type === "solid");
        lines.push(`font: ${fontString(node.fontSize ?? 16, node.fontWeight ?? 400, node.fontFamily ?? "Inter", node.italic)};`);
        for (const [key, prop] of [["fontSize", "font-size"], ["fontWeight", "font-weight"], ["fontFamily", "font-family"]] as const) {
            const b = bound(key);
            if (b) lines.push(`${prop}: ${b};`);
        }
        lines.push(`line-height: ${node.lineHeight == null ? "normal" : `${round(node.lineHeight * (node.fontSize ?? 16))}px`};`);
        if (node.letterSpacing) lines.push(`letter-spacing: ${round(((node.letterSpacing ?? 0) / 100) * (node.fontSize ?? 16))}px;`);
        if (node.textAlign && node.textAlign !== "left") lines.push(`text-align: ${node.textAlign};`);
        if (fill?.type === "solid") lines.push(`color: ${bound("fill:0") ?? fill.color};`);
    } else {
        const fills = node.fills.map((p) => paintCss(p, images)).filter((c): c is string => Boolean(c));
        if (fills.length) lines.push(`background: ${bound("fill:0") ?? fills.reverse().join(", ")};`);
        const stroke = node.strokes.find((p) => p.visible && p.type === "solid");
        if (stroke?.type === "solid") lines.push(`border: ${bound("strokeWidth") ?? `${round(node.strokeWidth)}px`} solid ${bound("stroke:0") ?? stroke.color};`);
        if (node.radius || bound("radius")) lines.push(`border-radius: ${bound("radius") ?? `${round(node.radius)}px`};`);
        if (node.type === "ellipse") lines.push("border-radius: 50%;");
    }
    if (node.opacity < 1 || bound("opacity")) lines.push(`opacity: ${bound("opacity") ?? round(node.opacity)};`);
    if (node.rotation) lines.push(`transform: rotate(${round(node.rotation)}deg);`);
    // Every drop and inner shadow, in paint order (text takes text-shadow, which has no spread or inset).
    const shadows: string[] = [];
    if (node.shadow) shadows.push(`${round(node.shadow.x)}px ${round(node.shadow.y)}px ${bound("shadow:blur") ?? `${round(node.shadow.blur)}px`} ${bound("shadow:color") ?? hexWithAlpha(node.shadow.color, node.shadow.opacity)}`);
    for (const e of node.effects ?? []) {
        if (!e.visible || (e.type !== "drop-shadow" && e.type !== "inner-shadow")) continue;
        if (node.type === "text" && e.type === "inner-shadow") continue;
        const spread = node.type === "text" ? "" : ` ${round(e.spread)}px`;
        shadows.push(`${e.type === "inner-shadow" ? "inset " : ""}${round(e.x)}px ${round(e.y)}px ${round(e.blur)}px${spread} ${hexWithAlpha(e.color, e.opacity)}`);
    }
    if (shadows.length) lines.push(`${node.type === "text" ? "text-shadow" : "box-shadow"}: ${shadows.join(", ")};`);
    const layerBlur = Math.max(node.blur || 0, ...(node.effects ?? []).filter((e) => e.visible && e.type === "layer-blur").map((e) => e.blur));
    if (layerBlur) lines.push(`filter: blur(${round(layerBlur)}px);`);
    const backdrop = (node.effects ?? []).find((e) => e.visible && e.type === "background-blur");
    if (backdrop) lines.push(`backdrop-filter: blur(${round(backdrop.blur)}px);`);
    if (node.layout?.grid) {
        const g = node.layout.grid;
        lines.push("display: grid;", `grid-template-columns: repeat(${g.columns}, minmax(0, 1fr));`, `row-gap: ${g.rowGap}px;`, `column-gap: ${g.columnGap}px;`);
        lines.push(`padding: ${node.layout.padding.map((p) => `${p}px`).join(" ")};`);
    } else if (node.layout) {
        const l = node.layout;
        lines.push("display: flex;", `flex-direction: ${l.direction === "vertical" ? "column" : "row"};`);
        if (l.wrap) lines.push("flex-wrap: wrap;");
        const justify = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly" }[l.primary];
        const align = { start: "flex-start", center: "center", end: "flex-end", baseline: "baseline" }[l.counter];
        lines.push(`justify-content: ${justify};`, `align-items: ${align};`);
        if (l.primary !== "between" || bound("gap")) lines.push(`gap: ${bound("gap") ?? `${l.gap}px`};`);
        if (l.wrap && l.counterGap) lines.push(`row-gap: ${l.counterGap}px;`);
        lines.push(`padding: ${bound("padding") ?? l.padding.map((p, i) => bound(`padding:${i}`) ?? `${p}px`).join(" ")};`);
    }
    if (node.clip && node.children.length) lines.push("overflow: hidden;");
    return lines.join("\n");
}

export const round = (v: number) => Math.round(v * 100) / 100;


// Copy as CSS: each selected layer's CSS, under a comment with its name; with `all`, the layers
// inside them too (Copy as › CSS (all layers)).
export async function copyAsCss(all = false) {
    if (refuseExport()) return;
    const { doc, selection } = editor.get();
    const ids: string[] = [];
    const add = (id: string) => {
        if (!doc.nodes[id] || ids.includes(id)) return;
        ids.push(id);
        if (all) doc.nodes[id]?.children.forEach(add);
    };
    selection.forEach(add);
    const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (!nodes.length) return;
    const text = nodes
        .map((n) => {
            const lines = [...cssFor(n, doc.images, doc).split("\n"), ...(n.type === "text" ? layerTextCss(n) : [])];
            return `/* ${n.name} */\n${lines.join("\n")}`;
        })
        .join("\n\n");
    try {
        await navigator.clipboard.writeText(text);
        editor.notify(nodes.length === 1 ? "Copied as CSS." : `Copied ${nodes.length} layers as CSS.`);
    } catch {
        editor.notify("The browser didn't allow copying.");
    }
}
