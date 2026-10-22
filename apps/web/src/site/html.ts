import { exportSvg } from "../engine/export-svg";
import { liveSiteHtml } from "../engine/live";
import { BUNDLED } from "../engine/fonts";
import { blobToDataUrl, imageBlob } from "../engine/image-store";
import { loadMedia } from "../engine/media";
import type { Effect, NagmaDocument, Paint, SceneNode } from "../engine/types";
import { breakpointsOf, bpFrames, collectionOf, pageOverflow, fieldText, itemPageFor, libraryPage, mirrorIdFor, pageData, settingsOf, sitePages, slugify, webData } from "./model";
import { RUNTIME } from "./runtime";
import { sourceIdOf } from "./sync";
import type { BreakpointId, Collection, CollectionItem, SiteLink, SiteNodeData, SitePageData, StateStyle, WebTag } from "./types";

// Turns a site document into a static website: one HTML file per page (and per CMS item), with the
// page's CSS and a small script inline, and the images and font files beside them.
//
// - Layers become semantic elements (header, nav, main, section, footer, headings, links, images,
//   buttons, forms) with one class each ("n-<layer id>").
// - Auto layout becomes flexbox (grid layouts become CSS grid); layers outside auto layout are placed
//   absolutely in their frame. Fill, hug and fixed sizing, min and max sizes follow.
// - Desktop is the base style; the tablet and mobile frames add media queries with what differs.
// - Hover and press states become :hover and :active rules; scroll effects, forms, page transitions
//   and (in Preview) links between pages are handled by the script (runtime.ts).
// Every piece of user text is escaped; custom code (code embeds, head and body code) is the only
// thing written as-is, and only editors can put it there.

export interface BuiltPage {
    path: string;
    file: string;
    title: string;
    html: string;
}

export interface SiteBuild {
    pages: BuiltPage[];
    // Other files (images, fonts) by path inside the site.
    assets: Map<string, Blob>;
    warnings: string[];
}

type Mode = "preview" | "publish";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (text: string) => esc(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const px = (n: number) => `${Math.round(n * 100) / 100}px`;
const cls = (id: string) => `n-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

// Addresses people may link to: web, mail and phone links, and paths inside the site.
export function safeUrl(raw: string | undefined | null): string {
    const url = (raw ?? "").trim();
    if (!url) return "#";
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^[#/?.]/.test(url)) return url;
    // "example.com" without a scheme.
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) return `https://${url}`;
    return "#";
}

function rgba(color: string, alpha: number): string {
    const hex = color.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
    const r = parseInt(full.slice(0, 2), 16) || 0;
    const g = parseInt(full.slice(2, 4), 16) || 0;
    const b = parseInt(full.slice(4, 6), 16) || 0;
    const a = hex.length === 8 ? (parseInt(hex.slice(6, 8), 16) / 255) * alpha : alpha;
    return a >= 0.999 ? `#${full.toLowerCase()}` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

// ---- Context ----

interface Ctx {
    doc: NagmaDocument;
    mode: Mode;
    // How far below the site root this page is ("../" this many times).
    depth: number;
    pageId: string;
    item?: { collection: Collection; item: CollectionItem };
    images: Map<string, string>;
    usedImages: Set<string>;
    families: Map<string, Set<string>>;
    anchors: Map<string, string>;
    rules: string[];
    media: Partial<Record<BreakpointId, string[]>>;
    styled: Set<string>;
    hasForms: boolean;
    // Written at the end of the body: layers used as custom cursors.
    tail: string[];
}

const rel = (ctx: Ctx) => (ctx.depth ? "../".repeat(ctx.depth) : "./");

function imageUrl(ctx: Ctx, id: string): string {
    ctx.usedImages.add(id);
    const known = ctx.images.get(id);
    if (ctx.mode === "preview") return known ?? "";
    return `${rel(ctx)}${known ?? `assets/${id}`}`;
}

// A page's address as a link from the current page.
function pageHref(ctx: Ctx, path: string): string {
    if (path === "/") return rel(ctx);
    return `${rel(ctx)}${path.replace(/^\//, "")}/`;
}

function linkFor(ctx: Ctx, link: SiteLink | null | undefined): { href: string; to?: string; newTab?: boolean } | null {
    if (!link) return null;
    const doc = ctx.doc;
    switch (link.kind) {
        case "page": {
            const page = doc.nodes[link.pageId];
            const data = pageData(page);
            if (!data) return null;
            const anchor = link.anchor ? `#${ctx.anchors.get(link.anchor) ?? slugify(link.anchor)}` : "";
            return { href: pageHref(ctx, data.path) + anchor, to: data.path + anchor };
        }
        case "section": {
            const anchor = ctx.anchors.get(link.nodeId);
            if (!anchor) return null;
            let page = doc.nodes[link.nodeId];
            while (page?.parentId) page = doc.nodes[page.parentId];
            const data = pageData(page);
            if (!data || page?.id === ctx.pageId) return { href: `#${anchor}` };
            return { href: `${pageHref(ctx, data.path)}#${anchor}`, to: `${data.path}#${anchor}` };
        }
        case "url":
            return { href: safeUrl(link.url), newTab: link.newTab };
        case "email":
            return { href: `mailto:${encodeURIComponent(link.email.trim()).replace(/%40/g, "@")}` };
        case "field": {
            const value = ctx.item?.item.values[link.field];
            return value ? { href: safeUrl(value), newTab: /^https?:/i.test(value) } : null;
        }
        case "item": {
            if (!ctx.item) return null;
            const page = itemPageFor(doc, ctx.item.collection.id);
            const data = pageData(page);
            if (!data) return null;
            const path = `${data.path === "/" ? "" : data.path}/${ctx.item.item.slug}`;
            return { href: pageHref(ctx, path), to: path };
        }
    }
}

// ---- CSS for one layer ----

type Decls = Record<string, string>;

function paintCss(ctx: Ctx, paint: Paint): string | null {
    if (!paint.visible) return null;
    if (paint.type === "solid") return `linear-gradient(${rgba(paint.color, paint.opacity)}, ${rgba(paint.color, paint.opacity)})`;
    if (paint.type === "linear" || paint.type === "radial" || paint.type === "angular" || paint.type === "diamond") {
        const stops = paint.stops.map((s) => `${rgba(s.color, s.opacity * paint.opacity)} ${Math.round(s.position * 1000) / 10}%`).join(", ");
        if (paint.type === "linear") {
            const angle = (Math.atan2(paint.to.y - paint.from.y, paint.to.x - paint.from.x) * 180) / Math.PI + 90;
            return `linear-gradient(${Math.round(angle)}deg, ${stops})`;
        }
        if (paint.type === "angular") return `conic-gradient(from 90deg at ${Math.round(paint.from.x * 100)}% ${Math.round(paint.from.y * 100)}%, ${stops})`;
        return `radial-gradient(circle at ${Math.round(paint.from.x * 100)}% ${Math.round(paint.from.y * 100)}%, ${stops})`;
    }
    if (paint.type === "image") {
        const url = imageUrl(ctx, paint.id);
        return url ? `url("${url}")` : null;
    }
    return null;
}

function shadowCss(effects: Effect[] | undefined, legacy: SceneNode["shadow"]): string[] {
    const out: string[] = [];
    if (legacy) out.push(`${px(legacy.x)} ${px(legacy.y)} ${px(legacy.blur)} ${rgba(legacy.color, legacy.opacity)}`);
    for (const e of effects ?? []) {
        if (!e.visible) continue;
        if (e.type === "drop-shadow") out.push(`${px(e.x)} ${px(e.y)} ${px(e.blur)} ${px(e.spread)} ${rgba(e.color, e.opacity)}`);
        if (e.type === "inner-shadow") out.push(`inset ${px(e.x)} ${px(e.y)} ${px(e.blur)} ${px(e.spread)} ${rgba(e.color, e.opacity)}`);
    }
    return out;
}

const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly" };
const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", baseline: "baseline" };

export function fontStack(family: string | undefined): string {
    const f = family || "Inter";
    const generic = /serif|garamond|georgia|times|playfair|merriweather|lora/i.test(f) && !/sans/i.test(f) ? "serif" : /mono|code|courier/i.test(f) ? "monospace" : "sans-serif";
    return `"${f.replace(/["\\]/g, "")}", ${f === "Inter" ? "system-ui, " : ""}${generic}`;
}

function noteFont(ctx: Ctx, family: string | undefined, weight: number | undefined, italic: boolean | undefined) {
    const f = family || "Inter";
    const set = ctx.families.get(f) ?? new Set<string>();
    set.add(`${italic ? 1 : 0},${weight ?? 400}`);
    ctx.families.set(f, set);
}

// Whether the layer is shown as an <img>: a shape whose only fill is an image.
function isImageLayer(node: SceneNode): boolean {
    if (node.type !== "rect" && node.type !== "ellipse") return false;
    const fills = node.fills.filter((f) => f.visible);
    return fills.length === 1 && fills[0]?.type === "image" && node.children.length === 0;
}

function isFieldBox(node: SceneNode): boolean {
    return Boolean(webData(node).field);
}

// The declarations for a layer laid out in its parent (both from the same breakpoint).
function declsFor(ctx: Ctx, node: SceneNode, parent: SceneNode | undefined, root: boolean): Decls {
    const d: Decls = {};
    const web = webData(node);
    const isText = node.type === "text";
    const shown = node.visible;
    const hasLayout = Boolean(node.layout) && !isText;
    const grid = node.layout?.grid;
    // Box model.
    d.display = !shown ? "none" : hasLayout ? (grid ? "grid" : "flex") : isText && node.list ? "block" : "block";
    if (root) {
        d.width = "100%";
        d["min-height"] = node.minH ? px(node.minH) : "100vh";
    } else {
        const absolute = !parent?.layout || node.positioning === "absolute";
        if (absolute && parent) {
            d.position = "absolute";
            const c = node.constraints ?? { h: "left", v: "top" };
            const left = node.x - parent.x;
            const top = node.y - parent.y;
            const right = parent.w - (left + node.w);
            const bottom = parent.h - (top + node.h);
            if (c.h === "right") d.right = px(right);
            else if (c.h === "left-right") {
                d.left = px(left);
                d.right = px(right);
            } else if (c.h === "center") {
                d.left = `calc(50% + ${px(left + node.w / 2 - parent.w / 2)})`;
                d.translate = "-50% 0";
            } else if (c.h === "scale") d.left = `${Math.round((left / parent.w) * 10000) / 100}%`;
            else d.left = px(left);
            if (c.v === "bottom") d.bottom = px(bottom);
            else if (c.v === "top-bottom") {
                d.top = px(top);
                d.bottom = px(bottom);
            } else if (c.v === "center") {
                d.top = `calc(50% + ${px(top + node.h / 2 - parent.h / 2)})`;
                d.translate = d.translate ? "-50% -50%" : "0 -50%";
            } else if (c.v === "scale") d.top = `${Math.round((top / parent.h) * 10000) / 100}%`;
            else d.top = px(top);
            if (c.h !== "left-right") d.width = c.h === "scale" ? `${Math.round((node.w / parent.w) * 10000) / 100}%` : isText && node.sizing.h === "hug" ? "max-content" : px(node.w);
            if (c.v !== "top-bottom" && !(isText && node.sizing.v === "hug")) d.height = c.v === "scale" ? `${Math.round((node.h / parent.h) * 10000) / 100}%` : px(node.h);
        } else if (parent?.layout?.grid) {
            const span = node.gridSpan;
            if (span && span.col > 1) d["grid-column"] = `span ${span.col}`;
            if (span && span.row > 1) d["grid-row"] = `span ${span.row}`;
            if (node.sizing.h === "fixed") d.width = px(node.w);
            else if (node.sizing.h === "fill") d["justify-self"] = "stretch";
            else d["justify-self"] = "start";
            if (node.sizing.v === "fixed") d.height = px(node.h);
            else if (node.sizing.v === "fill") d["align-self"] = "stretch";
            d["min-width"] = "0";
        } else if (parent?.layout) {
            const horizontal = parent.layout.direction === "horizontal";
            const main = horizontal ? node.sizing.h : node.sizing.v;
            const cross = horizontal ? node.sizing.v : node.sizing.h;
            const mainDim = horizontal ? "width" : "height";
            const crossDim = horizontal ? "height" : "width";
            const mainSize = horizontal ? node.w : node.h;
            const crossSize = horizontal ? node.h : node.w;
            if (main === "fill") {
                d.flex = "1 1 0px";
                d[`min-${mainDim}`] = "0";
            } else if (main === "fixed") {
                d.flex = "0 0 auto";
                d[mainDim] = px(mainSize);
            } else d.flex = "0 1 auto";
            // Filling the width of a column: 100% (so a max width still centres like the canvas);
            // filling the height of a row: stretch.
            if (cross === "fill") {
                if (horizontal) d["align-self"] = "stretch";
                else d.width = "100%";
            } else if (cross === "fixed") d[crossDim] = px(crossSize);
            // Fixed widths give way on narrow screens.
            if (d.width && d.width.endsWith("px")) d["max-width"] = "100%";
            // A text in a horizontal stack wraps rather than overflowing.
            if (isText && horizontal && main === "hug") d["min-width"] = "0";
        }
    }
    if (node.minW != null) d["min-width"] = px(node.minW);
    if (node.maxW != null) d["max-width"] = px(node.maxW);
    if (node.minH != null && !root) d["min-height"] = px(node.minH);
    if (node.maxH != null) d["max-height"] = px(node.maxH);
    // A frame of fixed height that stacks its content grows with it rather than cutting it off.
    if (hasLayout && d.height && !root) {
        d["min-height"] = d.height;
        delete d.height;
    }
    // Own layout.
    if (hasLayout && node.layout) {
        const l = node.layout;
        const [pt, pr, pb, pl] = l.padding;
        if (pt || pr || pb || pl) d.padding = `${px(pt)} ${px(pr)} ${px(pb)} ${px(pl)}`;
        if (grid) {
            const track = (t: { type: string; value: number } | undefined) => (!t || t.type === "fill" ? `minmax(0, ${t?.value || 1}fr)` : t.type === "fixed" ? px(t.value) : "auto");
            d["grid-template-columns"] = grid.columnSizes?.length ? Array.from({ length: grid.columns }, (_, i) => track(grid.columnSizes?.[i])).join(" ") : `repeat(${grid.columns}, minmax(0, 1fr))`;
            if (grid.rows) d["grid-template-rows"] = grid.rowSizes?.length ? Array.from({ length: grid.rows }, (_, i) => track(grid.rowSizes?.[i])).join(" ") : `repeat(${grid.rows}, auto)`;
            d["column-gap"] = px(grid.columnGap);
            d["row-gap"] = px(grid.rowGap);
        } else {
            d["flex-direction"] = l.direction === "horizontal" ? "row" : "column";
            if (l.wrap) {
                d["flex-wrap"] = "wrap";
                d["row-gap"] = px(l.direction === "horizontal" ? (l.counterGap ?? l.gap) : l.gap);
                d["column-gap"] = px(l.direction === "horizontal" ? l.gap : (l.counterGap ?? l.gap));
            } else if (l.primary !== "between" || l.gap) d.gap = px(l.gap);
            d["justify-content"] = JUSTIFY[l.primary] ?? "flex-start";
            d["align-items"] = ALIGN[l.counter] ?? "flex-start";
        }
    }
    if (!hasLayout && node.children.length && !isText) d.position = d.position ?? "relative";
    if (hasLayout && !d.position) d.position = "relative";
    // Appearance.
    const fills = node.fills.filter((f) => f.visible);
    if (isText) {
        const solid = fills.find((f) => f.type === "solid");
        if (solid && solid.type === "solid") d.color = rgba(solid.color, solid.opacity);
        noteFont(ctx, node.fontFamily, node.fontWeight, node.italic);
        d["font-family"] = fontStack(node.fontFamily);
        d["font-size"] = px(node.fontSize ?? 16);
        d["font-weight"] = String(node.fontWeight ?? 400);
        if (node.italic) d["font-style"] = "italic";
        d["line-height"] = node.lineHeight ? String(Math.round(node.lineHeight * 1000) / 1000) : "normal";
        if (node.letterSpacing) d["letter-spacing"] = `${Math.round(node.letterSpacing * 10) / 1000}em`;
        if (node.textAlign && node.textAlign !== "left") d["text-align"] = node.textAlign;
        if (node.decoration === "underline") d["text-decoration"] = "underline";
        if (node.decoration === "strikethrough") d["text-decoration"] = "line-through";
        if (node.textCase === "upper") d["text-transform"] = "uppercase";
        if (node.textCase === "lower") d["text-transform"] = "lowercase";
        if (node.textCase === "title") d["text-transform"] = "capitalize";
        if (node.textCase === "small-caps") d["font-variant"] = "small-caps";
        if (node.textCase === "small-caps-forced") d["font-variant-caps"] = "all-small-caps";
        d["white-space"] = node.sizing.h === "hug" ? "pre" : "pre-wrap";
        if (node.textWrap === "balance") d["text-wrap"] = "balance";
        if (node.maxLines && node.truncate) {
            d.display = shown ? "-webkit-box" : "none";
            d["-webkit-line-clamp"] = String(node.maxLines);
            d["-webkit-box-orient"] = "vertical";
            d.overflow = "hidden";
        }
    } else if (!isImageLayer(node) && node.type !== "vector" && node.type !== "boolean") {
        const layers = fills.map((f) => paintCss(ctx, f)).filter((v): v is string => Boolean(v));
        if (layers.length) {
            const onlySolid = fills.length === 1 && fills[0]?.type === "solid";
            if (onlySolid && fills[0]?.type === "solid") d["background-color"] = rgba(fills[0].color, fills[0].opacity);
            else {
                d["background-image"] = layers.reverse().join(", ");
                const image = fills.find((f) => f.type === "image");
                if (image && image.type === "image") {
                    d["background-size"] = image.mode === "fit" ? "contain" : image.mode === "tile" ? "auto" : "cover";
                    d["background-position"] = "center";
                    d["background-repeat"] = image.mode === "tile" ? "repeat" : "no-repeat";
                }
            }
        }
    }
    if (isImageLayer(node)) {
        const image = fills[0];
        d["object-fit"] = image?.type === "image" && image.mode === "fit" ? "contain" : "cover";
        if (!d.height && node.sizing.v === "fixed") d.height = px(node.h);
        if (!d.width && node.sizing.h === "fixed") d.width = px(node.w);
    }
    // Strokes: inside strokes as inset shadows (they take no room, as on the canvas), others as outlines.
    const shadows = isText ? [] : shadowCss(node.effects, node.shadow);
    const stroke = node.strokes.find((s) => s.visible && s.type === "solid");
    if (stroke && stroke.type === "solid" && node.strokeWidth > 0 && !isText && node.type !== "vector") {
        const color = rgba(stroke.color, stroke.opacity);
        const sides = node.strokeSides;
        if (node.dash || node.dashPattern?.length || sides || node.strokeWeights) {
            const w = node.strokeWeights ?? [node.strokeWidth, node.strokeWidth, node.strokeWidth, node.strokeWidth];
            const style = node.dash || node.dashPattern?.length ? "dashed" : "solid";
            (["top", "right", "bottom", "left"] as const).forEach((side, i) => {
                if (!sides || sides[side]) d[`border-${side}`] = `${px(w[i] ?? node.strokeWidth)} ${style} ${color}`;
            });
            d["box-sizing"] = "border-box";
        } else if (node.strokeAlign === "inside") shadows.push(`inset 0 0 0 ${px(node.strokeWidth)} ${color}`);
        else {
            d.outline = `${px(node.strokeWidth)} solid ${color}`;
            d["outline-offset"] = node.strokeAlign === "center" ? px(-node.strokeWidth / 2) : "0px";
        }
    }
    if (shadows.length) d["box-shadow"] = shadows.join(", ");
    if (isText) {
        const drops = (node.effects ?? []).filter((e) => e.visible && e.type === "drop-shadow").map((e) => `${px(e.x)} ${px(e.y)} ${px(e.blur)} ${rgba(e.color, e.opacity)}`);
        if (drops.length) d["text-shadow"] = drops.join(", ");
    }
    const blur = (node.effects ?? []).find((e) => e.visible && e.type === "layer-blur");
    if (blur || node.blur) d.filter = `blur(${px(blur?.blur ?? node.blur)})`;
    const backdrop = (node.effects ?? []).find((e) => e.visible && e.type === "background-blur");
    if (backdrop) d["backdrop-filter"] = `blur(${px(backdrop.blur)})`;
    if (node.type === "ellipse") d["border-radius"] = "50%";
    else if (node.radii && node.radii.some((r) => r > 0)) d["border-radius"] = node.radii.map(px).join(" ");
    else if (node.radius > 0) d["border-radius"] = px(node.radius);
    if (node.opacity < 1) d.opacity = String(Math.round(node.opacity * 1000) / 1000);
    if (node.blendMode && node.blendMode !== "normal" && node.blendMode !== "pass-through") d["mix-blend-mode"] = node.blendMode.replace("plus-lighter", "plus-lighter").replace("plus-darker", "darken");
    if (node.rotation) d.transform = `rotate(${Math.round(-node.rotation * 100) / 100}deg)`;
    // The page itself clips sideways only: clipping it both ways would stop the window scrolling.
    if (node.clip && node.type !== "text" && node.children.length) {
        if (root) d["overflow-x"] = "clip";
        else d.overflow = "hidden";
    }
    // Scroll behaviour: the page scrolls by itself, so on it only sideways scrolling is added.
    if (root) {
        if (pageOverflow(ctx.doc, node.id) === "both") d["overflow-x"] = "auto";
    } else if (web.overflow) d.overflow = web.overflow === "both" ? "auto" : web.overflow === "x" ? "auto hidden" : web.overflow === "y" ? "hidden auto" : web.overflow;
    if (node.scrollPosition === "sticky") {
        d.position = "sticky";
        d.top = "0px";
        d["z-index"] = "10";
    } else if (node.scrollPosition === "fixed" && !root) {
        d.position = "fixed";
        d["z-index"] = "20";
    }
    if (web.link) d.cursor = "pointer";
    // Form fields write in their placeholder text's type.
    if (isFieldBox(node)) {
        const label = node.children.map((c) => ctx.doc.nodes[c]).find((c) => c?.type === "text");
        if (label) {
            noteFont(ctx, label.fontFamily, label.fontWeight, label.italic);
            d["font-family"] = fontStack(label.fontFamily);
            d["font-size"] = px(label.fontSize ?? 16);
            d["line-height"] = label.lineHeight ? String(label.lineHeight) : "normal";
        }
        d.color = "#101828";
    }
    // Embeds fill their box.
    if (web.embed) d.overflow = "hidden";
    return d;
}

function block(selector: string, d: Decls): string {
    const body = Object.entries(d)
        .map(([k, v]) => `${k}:${v}`)
        .join(";");
    return body ? `${selector}{${body}}` : "";
}

// Values that put a property back when a breakpoint drops something desktop set.
const RESET: Record<string, string> = {
    display: "block",
    position: "static",
    flex: "0 1 auto",
    "flex-direction": "row",
    "flex-wrap": "nowrap",
    "justify-content": "normal",
    "align-items": "normal",
    "align-self": "auto",
    "justify-self": "auto",
    gap: "normal",
    "row-gap": "normal",
    "column-gap": "normal",
    width: "auto",
    height: "auto",
    "min-width": "0",
    "min-height": "0",
    "max-width": "none",
    "max-height": "none",
    padding: "0",
    left: "auto",
    right: "auto",
    top: "auto",
    bottom: "auto",
    translate: "none",
    transform: "none",
    "box-shadow": "none",
    outline: "none",
    filter: "none",
    "backdrop-filter": "none",
    "border-radius": "0",
    opacity: "1",
    "background-color": "transparent",
    "background-image": "none",
    "text-align": "start",
    "text-decoration": "none",
    "text-transform": "none",
    "white-space": "normal",
    "grid-template-columns": "none",
    "grid-template-rows": "none",
    "grid-column": "auto",
    "grid-row": "auto",
    overflow: "visible",
    "overflow-x": "visible",
    "letter-spacing": "normal",
    "font-style": "normal",
};

function diff(base: Decls, next: Decls): Decls {
    const out: Decls = {};
    for (const [k, v] of Object.entries(next)) if (base[k] !== v) out[k] = v;
    for (const k of Object.keys(base)) if (!(k in next)) out[k] = RESET[k] ?? "unset";
    return out;
}

function stateBlock(selector: string, s: StateStyle, base: Decls, text: boolean): string {
    const d: Decls = {};
    if (s.fill) d[text ? "color" : "background-color"] = s.fill;
    if (s.opacity != null) d.opacity = String(s.opacity);
    const moves: string[] = [];
    if (base.transform && base.transform !== "none") moves.push(base.transform);
    if (s.y) moves.push(`translateY(${px(s.y)})`);
    if (s.scale != null && s.scale !== 1) moves.push(`scale(${s.scale})`);
    if (moves.length) d.transform = moves.join(" ");
    if (s.shadow) d["box-shadow"] = "0 12px 32px rgba(16, 24, 40, 0.18)";
    let out = block(selector, d);
    if (s.textColor) out += `${selector},${selector} *{color:${s.textColor}}`;
    return out;
}

// ---- Elements ----

function tagFor(node: SceneNode, web: SiteNodeData, root: boolean): string {
    if (root) return "body";
    const tag: WebTag = web.tag ?? "auto";
    if (web.form) return "form";
    if (web.submit) return "button";
    if (tag !== "auto") return tag === "img" && !isImageLayer(node) ? "div" : tag;
    if (isImageLayer(node)) return "img";
    if (node.type === "text") return node.list ? (node.list === "number" ? "ol" : "ul") : web.link ? "a" : "p";
    if (web.link) return "a";
    return "div";
}

const BLOCK_TEXT = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "span", "button"]);

function textInner(ctx: Ctx, node: SceneNode): string {
    let text = node.text ?? "";
    const bind = webData(node).bind;
    if (bind && ctx.item) {
        const field = ctx.item.collection.fields.find((f) => f.id === bind.field);
        if (field?.type === "richtext") return sanitizeRich(ctx.item.item.values[field.id] ?? "");
        text = fieldText(ctx.item.collection, ctx.item.item, bind.field);
    }
    if (node.list) {
        return text
            .split("\n")
            .map((line) => `<li>${esc(line)}</li>`)
            .join("");
    }
    const spans = !bind && node.spans?.length ? [...node.spans].sort((a, b) => a.start - b.start) : [];
    if (!spans.length) return esc(text);
    let out = "";
    let at = 0;
    for (const span of spans) {
        if (span.start > at) out += esc(text.slice(at, span.start));
        const part = esc(text.slice(Math.max(at, span.start), span.end));
        const d: Decls = {};
        if (span.fontWeight) d["font-weight"] = String(span.fontWeight);
        if (span.italic) d["font-style"] = "italic";
        if (span.fontSize) d["font-size"] = px(span.fontSize);
        if (span.fontFamily) {
            d["font-family"] = fontStack(span.fontFamily);
            noteFont(ctx, span.fontFamily, span.fontWeight ?? node.fontWeight, span.italic);
        }
        if (span.decoration === "underline") d["text-decoration"] = "underline";
        if (span.decoration === "strikethrough") d["text-decoration"] = "line-through";
        const fill = span.fills?.find((f) => f.visible && f.type === "solid");
        if (fill && fill.type === "solid") d.color = rgba(fill.color, fill.opacity);
        const style = Object.entries(d)
            .map(([k, v]) => `${k}:${v}`)
            .join(";");
        const inner = style ? `<span style="${attr(style)}">${part}</span>` : part;
        out += span.hyperlink ? `<a href="${attr(safeUrl(span.hyperlink))}">${inner}</a>` : inner;
        at = Math.max(at, span.end);
    }
    if (at < text.length) out += esc(text.slice(at));
    return out;
}

// Rich text from the CMS: a few formatting elements and safe links, nothing else.
function sanitizeRich(html: string): string {
    if (typeof DOMParser === "undefined") return esc(html.replace(/<[^>]*>/g, ""));
    const allowed = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "A", "H2", "H3", "H4", "BLOCKQUOTE", "CODE", "PRE"]);
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const walk = (node: Node): string => {
        if (node.nodeType === 3) return esc(node.textContent ?? "");
        if (node.nodeType !== 1) return "";
        const el = node as Element;
        const inner = [...el.childNodes].map(walk).join("");
        if (!allowed.has(el.tagName)) return inner;
        const tag = el.tagName.toLowerCase();
        if (tag === "br") return "<br>";
        if (tag === "a") return `<a href="${attr(safeUrl(el.getAttribute("href")))}">${inner}</a>`;
        return `<${tag}>${inner}</${tag}>`;
    };
    return [...(parsed.body.firstElementChild?.childNodes ?? [])].map(walk).join("");
}

function embedHtml(ctx: Ctx, node: SceneNode): string {
    const embed = webData(node).embed;
    if (!embed) return "";
    const frame = (src: string, title: string, extra = "") => `<iframe src="${attr(src)}" title="${attr(title)}" loading="lazy" style="border:0;width:100%;height:100%;display:block" ${extra}></iframe>`;
    if (embed.kind === "video") {
        const url = embed.url.trim();
        const yt = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
        if (yt) return frame(`https://www.youtube-nocookie.com/embed/${yt[1]}${embed.autoplay ? "?autoplay=1&mute=1" : ""}`, node.name, 'allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen');
        const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
        if (vm) return frame(`https://player.vimeo.com/video/${vm[1]}${embed.autoplay ? "?autoplay=1&muted=1" : ""}`, node.name, 'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen');
        if (/^https?:/i.test(url)) return `<video src="${attr(url)}" ${embed.controls === false ? "" : "controls"} ${embed.autoplay ? "autoplay muted loop playsinline" : ""} style="width:100%;height:100%;object-fit:cover;display:block"></video>`;
        return `<div class="site-embed-empty">${esc("Add a video address")}</div>`;
    }
    if (embed.kind === "map") {
        const q = embed.query.trim();
        if (!q) return `<div class="site-embed-empty">${esc("Add a place to show")}</div>`;
        return frame(`https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${embed.zoom ?? 14}&output=embed`, `Map of ${q}`);
    }
    // Custom code, written as-is (only editors can add it).
    void ctx;
    return embed.code;
}

// A breakpoint copy of a primary layer, if that breakpoint has one.
function copyOf(doc: NagmaDocument, id: string, frames: Partial<Record<BreakpointId, SceneNode>>, bp: BreakpointId): SceneNode | undefined {
    if (id === frames.desktop?.id) return frames[bp];
    // Layers inside an instance: the same layer inside the breakpoint's copy of the instance.
    const cut = id.indexOf(";");
    if (cut > 0) return doc.nodes[`${mirrorIdFor(id.slice(0, cut), bp)}${id.slice(cut)}`];
    return doc.nodes[mirrorIdFor(id, bp)];
}

interface RenderEnv {
    frames: Partial<Record<BreakpointId, SceneNode>>;
    // The page's other breakpoints, widest first.
    others: BreakpointId[];
}

// Styles for a layer: desktop as the base, then what each breakpoint changes. `onlyOn` is set for
// layers that exist on one breakpoint only (hidden elsewhere).
function styleNode(ctx: Ctx, env: RenderEnv, node: SceneNode, parent: SceneNode | undefined, root: boolean, className: string, onlyOn?: BreakpointId) {
    if (ctx.styled.has(className)) return;
    ctx.styled.add(className);
    const doc = ctx.doc;
    const base = declsFor(ctx, node, parent, root);
    const selector = root ? `body.${className}` : `.${className}`;
    if (onlyOn) {
        ctx.rules.push(block(selector, { ...base, display: "none" }));
        (ctx.media[onlyOn] ??= []).push(block(selector, { display: base.display ?? "block" }));
    } else {
        ctx.rules.push(block(selector, base));
        for (const bp of env.others) {
            const copy = copyOf(doc, node.id, env.frames, bp);
            if (!copy) continue;
            const copyParent = copy.parentId ? doc.nodes[copy.parentId] : undefined;
            const changes = diff(base, declsFor(ctx, copy, root ? undefined : copyParent, root));
            // Children in another order on this breakpoint.
            if (copyParent && webData(copyParent).ov?.includes("children")) changes.order = String(copyParent.children.indexOf(copy.id));
            const css = block(selector, changes);
            if (css) (ctx.media[bp] ??= []).push(css);
        }
    }
    const web = webData(node);
    const text = node.type === "text";
    const transitions = web.hover || web.press;
    if (transitions) {
        const ms = (web.hover?.duration ?? web.press?.duration ?? 200) / 1000;
        ctx.rules.push(`${selector}{transition:background-color ${ms}s ease,color ${ms}s ease,opacity ${ms}s ease,transform ${ms}s ease,box-shadow ${ms}s ease}`);
        if (web.hover) ctx.rules.push(`@media (hover:hover){${stateBlock(`${selector}:hover`, web.hover, base, text)}}`);
        if (web.press) ctx.rules.push(stateBlock(`${selector}:active`, web.press, base, text));
    }
    if (web.cursor?.kind === "system") ctx.rules.push(`${selector},${selector} *{cursor:${web.cursor.cursor}}`);
    if (web.cursor?.kind === "layer" && web.cursor.nodeId) ctx.rules.push(`@media (hover:hover){${selector},${selector} *{cursor:none}}`);
    if (web.action && web.action.kind !== "change-to") ctx.rules.push(`${selector}{cursor:${web.action.kind === "lightbox" ? "zoom-in" : "pointer"}}`);
    if (web.marquee) ctx.rules.push(`${selector}{overflow:hidden}`);
    const effect = web.effect;
    if (effect?.kind === "appear") {
        const ease = effect.easing === "spring" ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : effect.easing;
        ctx.rules.push(
            `${selector}[data-appear]:not(.is-in){opacity:${effect.opacity};translate:${px(effect.x)} ${px(effect.y)};scale:${effect.scale};rotate:${effect.rotate}deg}` +
                `${selector}[data-appear]{transition:opacity ${effect.duration}ms ${ease} ${effect.delay}ms,translate ${effect.duration}ms ${ease} ${effect.delay}ms,scale ${effect.duration}ms ${ease} ${effect.delay}ms,rotate ${effect.duration}ms ${ease} ${effect.delay}ms}`,
        );
    }
}

function renderNode(ctx: Ctx, env: RenderEnv, node: SceneNode, parent: SceneNode | undefined, opts: { root?: boolean; onlyOn?: BreakpointId; className?: string } = {}): string {
    const doc = ctx.doc;
    const web = webData(node);
    // CMS copies are made again from the template for each item.
    if (web.rep) return "";
    const root = Boolean(opts.root);
    const className = opts.className ?? cls(node.id);
    styleNode(ctx, env, node, parent, root, className, opts.onlyOn);
    const tag = tagFor(node, web, root);
    const attrs: string[] = [`class="${className}"`];
    const anchor = ctx.anchors.get(node.id);
    if (anchor && !ctx.item) attrs.push(`id="${attr(anchor)}"`);
    const link = linkFor(ctx, web.link);
    let wrapLink = false;
    if (link) {
        if (tag === "a") {
            attrs.push(`href="${attr(link.href)}"`);
            if (link.to) attrs.push(`data-to="${attr(link.to)}"`);
            if (link.newTab) attrs.push('target="_blank" rel="noopener noreferrer"');
        } else wrapLink = true;
    }
    const effect = web.effect;
    const targetOf = (id: string | null | undefined) => (id ? (ctx.anchors.get(id) ?? "") : "");
    if (effect?.kind === "appear") {
        const target = effect.trigger === "layer" ? targetOf(effect.target) : "";
        attrs.push(`data-appear="${effect.trigger === "load" ? "load" : target ? "layer" : "view"}"`, `data-once="${effect.once ? 1 : 0}"`);
        if (target) attrs.push(`data-appear-target="${attr(target)}"`);
    }
    if (effect?.kind === "parallax") attrs.push(`data-parallax="${Math.max(-1, Math.min(1, effect.speed))}"`);
    if (effect?.kind === "scroll") {
        const target = effect.trigger === "layer" ? targetOf(effect.target) : "";
        attrs.push(`data-scroll="${attr(JSON.stringify({ f: effect.from, t: effect.to, m: effect.trigger === "page" ? "page" : target ? "layer" : "self", g: target }))}"`);
    }
    actionAttrs(ctx, node, web, attrs);
    if (web.marquee) attrs.push(`data-marquee="${attr(JSON.stringify({ s: Math.max(1, Math.min(2000, web.marquee.speed)), d: web.marquee.direction, p: web.marquee.pauseOnHover ? 1 : 0 }))}"`);
    if (web.cursor?.kind === "layer") {
        const layer = ctx.doc.nodes[web.cursor.nodeId];
        if (layer) {
            const id = `site-cursor-${ctx.tail.length + 1}`;
            const solo: RenderEnv = { frames: {}, others: [] };
            ctx.tail.push(`<div class="site-cursor" id="${id}" aria-hidden="true" data-hotspot="${web.cursor.hotspot}" data-smooth="${Math.max(0, Math.min(0.95, web.cursor.smoothing))}">${renderNode(ctx, solo, layer, undefined, { className: `${cls(layer.id)}-cursor` })}</div>`);
            attrs.push(`data-cursor="${id}"`);
        }
    }
    if (node.name && !root && (tag === "nav" || tag === "section" || tag === "aside")) attrs.push(`aria-label="${attr(node.name)}"`);
    const open = (t: string) => `<${t} ${attrs.join(" ")}>`;

    // Images.
    if (tag === "img") {
        const paint = node.fills.find((f) => f.visible && f.type === "image");
        let id = paint?.type === "image" ? paint.id : "";
        const bind = web.bind;
        if (bind && ctx.item) id = ctx.item.item.values[bind.field] || id;
        const alt = node.altText ?? (bind && ctx.item ? fieldText(ctx.item.collection, ctx.item.item, ctx.item.collection.fields[0]?.id ?? "") : "");
        const src = id ? imageUrl(ctx, id) : "";
        // No picture yet (an empty CMS image): an empty box of the same size.
        if (!src) return `<div ${attrs.join(" ")} role="presentation"></div>`;
        const img = `<img ${attrs.join(" ")} src="${attr(src)}" alt="${attr(alt)}" loading="lazy" width="${Math.round(node.w)}" height="${Math.round(node.h)}">`;
        return wrapLink && link ? `<a href="${attr(link.href)}"${link.to ? ` data-to="${attr(link.to)}"` : ""}${link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""} style="display:contents">${img}</a>` : img;
    }
    // Form fields: an input styled like the box, its placeholder from the box's text.
    if (web.field) {
        const f = web.field;
        const label = node.children.map((c) => doc.nodes[c]).find((c) => c?.type === "text");
        if (label) {
            styleNode(ctx, env, label, node, false, cls(label.id));
        }
        const labelClass = label ? cls(label.id) : "";
        const placeholder = f.placeholder ?? label?.text ?? "";
        const common = `name="${attr(f.name || slugify(node.name))}"${f.required ? " required" : ""} aria-label="${attr(placeholder || node.name)}"`;
        ctx.hasForms = true;
        if (f.type === "checkbox") return `<label ${attrs.join(" ")}><input type="checkbox" ${common}> <span class="${labelClass}">${esc(label?.text ?? f.name)}</span></label>`;
        if (f.type === "textarea") return `<textarea ${attrs.join(" ")} ${common} placeholder="${attr(placeholder)}" data-text-class="${labelClass}"></textarea>`;
        if (f.type === "select")
            return `<select ${attrs.join(" ")} ${common}><option value="">${esc(placeholder)}</option>${(f.options ?? [])
                .map((o) => `<option>${esc(o)}</option>`)
                .join("")}</select>`;
        return `<input ${attrs.join(" ")} type="${f.type}" ${common} placeholder="${attr(placeholder)}">`;
    }
    if (web.form) {
        ctx.hasForms = true;
        const action = web.form.action ? safeUrl(web.form.action) : "";
        attrs.push("data-site-form", `data-success="${attr(web.form.success || "Thanks!")}"`, 'method="post"');
        if (action && action !== "#") attrs.push(`action="${attr(action)}"`);
    }
    if (web.submit) attrs.push('type="submit"');
    if (tag === "button" && !web.submit) attrs.push('type="button"');

    let inner = "";
    if (web.embed) inner = embedHtml(ctx, node);
    // A Live frame ships its code: the same sandboxed frame, with its props as they are now.
    else if (node.type === "live") inner = liveSiteHtml(doc, node);
    else if (node.type === "text") inner = textPerBreakpoint(ctx, env, node, className);
    else if (node.type === "vector" || node.type === "boolean") {
        const svg = exportSvg(doc, node.id);
        inner = svg ? svg.replace("<svg ", '<svg style="width:100%;height:100%;display:block" aria-hidden="true" ') : "";
    } else inner = renderChildren(ctx, env, node);
    inner = variantInner(ctx, env, node, parent, web, className, attrs, inner);

    if (root) return inner;
    let html = `${open(tag)}${inner}</${tag}>`;
    if (wrapLink && link) {
        const a = `<a href="${attr(link.href)}"${link.to ? ` data-to="${attr(link.to)}"` : ""}${link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""}`;
        // A heading or paragraph keeps its element with the link inside; boxes become the link.
        html = BLOCK_TEXT.has(tag) && tag !== "button" ? `${open(tag)}${a} style="color:inherit;text-decoration:inherit">${inner}</a></${tag}>` : `${a} style="display:contents">${html}</a>`;
    }
    return html;
}

// A text whose words differ on some breakpoints: each version, shown only in its breakpoint's range.
function textPerBreakpoint(ctx: Ctx, env: RenderEnv, node: SceneNode, className: string): string {
    const base = textInner(ctx, node);
    const versions: { bp: string; html: string }[] = [];
    for (const bp of env.others) {
        const copy = copyOf(ctx.doc, node.id, env.frames, bp);
        if (!copy || copy.type !== "text" || (copy.text === node.text && JSON.stringify(copy.spans) === JSON.stringify(node.spans))) continue;
        versions.push({ bp, html: textInner(ctx, copy) });
    }
    if (!versions.length) return base;
    const tag = `${className}-t`;
    ctx.rules.push(`.${tag}{display:contents}.${tag}[data-bp]{display:none}`);
    for (const v of versions) (ctx.media[v.bp] ??= []).push(`.${tag}[data-bp]{display:none}.${tag}[data-bp="${v.bp}"]{display:contents}.${tag}:not([data-bp]){display:none}`);
    // Breakpoints without words of their own show the primary's.
    const own = new Set(versions.map((v) => v.bp));
    for (const bp of env.others) if (!own.has(bp)) (ctx.media[bp] ??= []).push(`.${tag}:not([data-bp]){display:contents}`);
    return `<span class="${tag}">${base}</span>${versions.map((v) => `<span class="${tag}" data-bp="${attr(v.bp)}">${v.html}</span>`).join("")}`;
}

// Back, Scroll to and Lightbox: data the script acts on; layers that aren't links or buttons
// already become keyboard-reachable buttons.
function actionAttrs(ctx: Ctx, node: SceneNode, web: SiteNodeData, attrs: string[]) {
    const action = web.action;
    if (!action || action.kind === "change-to") return;
    if (action.kind === "back") attrs.push("data-back");
    if (action.kind === "scroll-to") {
        const anchor = ctx.anchors.get(action.nodeId);
        if (!anchor) return;
        attrs.push(`data-scroll-to="${attr(anchor)}"`, `data-offset="${Math.round(action.offset || 0)}"`, `data-smooth="${action.smooth ? 1 : 0}"`);
    }
    if (action.kind === "lightbox") {
        const paint = node.fills.find((f) => f.visible && f.type === "image");
        const id = action.imageId || (paint?.type === "image" ? paint.id : "");
        if (!id) return;
        attrs.push(`data-lightbox="${attr(imageUrl(ctx, id))}"`, `data-lightbox-alt="${attr(node.altText ?? node.name)}"`);
    }
    if (!web.link && !web.submit) attrs.push('role="button"', 'tabindex="0"');
}

// Change to: an instance holds its own content and the other variant's, and the script swaps them
// on the trigger. The box takes on the variant's look (fill, corners, padding...) with a class.
const VARIANT_KEYS = new Set(["background-color", "background-image", "color", "border", "outline", "box-shadow", "border-radius", "opacity", "padding", "gap", "filter", "justify-content", "align-items", "flex-direction"]);
function variantInner(ctx: Ctx, env: RenderEnv, node: SceneNode, parent: SceneNode | undefined, web: SiteNodeData, className: string, attrs: string[], inner: string): string {
    const action = web.action;
    if (action?.kind !== "change-to" || node.type !== "instance") return inner;
    const target = ctx.doc.nodes[action.variantId];
    if (!target || target.type !== "component" || target.id === node.componentId) return inner;
    const solo: RenderEnv = { frames: {}, others: [] };
    void env;
    const alt = target.children
        .map((id) => ctx.doc.nodes[id])
        .filter((c): c is SceneNode => Boolean(c))
        .map((c) => renderNode(ctx, solo, c, target))
        .join("");
    const own = declsFor(ctx, node, parent, false);
    const next = declsFor(ctx, target, parent, false);
    const changes: Decls = {};
    for (const [k, v] of Object.entries(diff(own, next))) if (VARIANT_KEYS.has(k)) changes[k] = v;
    const ms = Math.max(0, Math.min(2000, action.duration ?? 200));
    ctx.rules.push(block(`.${className}.is-alt`, changes), `.${className}{transition:background-color ${ms}ms ease,color ${ms}ms ease,border-radius ${ms}ms ease,box-shadow ${ms}ms ease,opacity ${ms}ms ease}`);
    attrs.push(`data-change="${action.trigger}"`);
    if (action.trigger === "click" && !web.link) attrs.push('role="button"', 'tabindex="0"', 'aria-pressed="false"');
    return `<span class="site-v" data-v="a">${inner}</span><span class="site-v" data-v="b">${alt}</span>`;
}

function renderChildren(ctx: Ctx, env: RenderEnv, node: SceneNode): string {
    const doc = ctx.doc;
    const web = webData(node);
    // A CMS list: its template once per item.
    if (web.list) {
        const collection = collectionOf(doc, web.list.collectionId);
        const template = node.children.map((c) => doc.nodes[c]).find((c) => c && !webData(c).rep);
        if (!collection || !template) return "";
        const items = collection.items.slice(0, web.list.limit && web.list.limit > 0 ? web.list.limit : undefined);
        const outer = ctx.item;
        const out = items
            .map((item) => {
                ctx.item = { collection, item };
                return renderNode(ctx, env, template, node);
            })
            .join("");
        ctx.item = outer;
        return out || `<p class="site-empty">${esc("Nothing here yet.")}</p>`;
    }
    let html = "";
    for (const id of node.children) {
        const child = doc.nodes[id];
        if (child) html += renderNode(ctx, env, child, node);
    }
    // Layers added on a tablet or mobile copy alone, hidden on the other breakpoints (an
    // instance's layers come from its component, so they're never a breakpoint's own).
    if (node.type === "instance" || node.id.includes(";")) return html;
    for (const bp of env.others) {
        const copy = copyOf(doc, node.id, env.frames, bp);
        if (!copy) continue;
        for (const id of copy.children) {
            const child = doc.nodes[id];
            if (!child || sourceIdOf(doc.nodes, child) || webData(child).rep) continue;
            html += renderOnly(ctx, env, child, copy, bp);
        }
    }
    return html;
}

// A layer that only one breakpoint has, with its children (all of them that breakpoint's own).
function renderOnly(ctx: Ctx, env: RenderEnv, node: SceneNode, parent: SceneNode, bp: BreakpointId): string {
    const solo: RenderEnv = { frames: {}, others: [] };
    void env;
    return renderNode(ctx, solo, node, parent, { onlyOn: bp });
}

// ---- Pages ----

const BASE_CSS =
    "*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}body{margin:0;-webkit-font-smoothing:antialiased;font-family:Inter,system-ui,sans-serif}" +
    "h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote,figure{margin:0}ul,ol{padding-left:1.4em}a{color:inherit;text-decoration:none}img{display:block}" +
    "button,input,textarea,select{font:inherit;color:inherit;margin:0}button{cursor:pointer;border:0;background:none;padding:0}" +
    "input,textarea,select{border:0;background:transparent;outline:none}input:focus-visible,textarea:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #4f46e5;outline-offset:2px}" +
    "textarea{resize:vertical}summary{list-style:none;cursor:pointer}summary::-webkit-details-marker{display:none}details[open] summary .site-faq-icon{rotate:45deg}.site-embed-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#667085;font:14px system-ui,sans-serif;background:#f2f4f7}" +
    ".site-form-done{font:inherit;padding:16px 0}.site-empty{color:#667085;font:14px system-ui,sans-serif}" +
    ".site-v{display:contents}[data-change]:not(.is-alt)>.site-v[data-v=b],[data-change].is-alt>.site-v[data-v=a]{display:none}" +
    ".site-cursor{position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;opacity:0;transition:opacity .15s ease}.site-cursor.is-on{opacity:1}" +
    ".site-lightbox{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.86);padding:4vmin;cursor:zoom-out;animation:site-lb .2s ease both}.site-lightbox img{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,.5)}.site-lightbox button{position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:20px;background:rgba(255,255,255,.14);color:#fff;font-size:22px;line-height:40px}@keyframes site-lb{from{opacity:0}}" +
    ".site-marquee-track{display:flex;flex-shrink:0;width:max-content;will-change:transform}.site-marquee-track.is-y{flex-direction:column;width:auto;height:max-content}@keyframes site-mq-x{to{transform:translateX(-50%)}}@keyframes site-mq-y{to{transform:translateY(-50%)}}[data-marquee-pause]:hover .site-marquee-track{animation-play-state:paused}" +
    "@media (prefers-reduced-motion:reduce){.site-marquee-track{animation:none!important}}" +
    "@media (prefers-reduced-motion:reduce){[data-appear]{transition:none!important;opacity:1!important;translate:none!important;scale:none!important;rotate:none!important}html{scroll-behavior:auto}}";

const TRANSITIONS: Record<string, string> = {
    none: "",
    fade: "@keyframes site-in{from{opacity:0}}body{animation:site-in .35s ease both}html.site-leaving body{opacity:0;transition:opacity .2s ease}",
    slide: "@keyframes site-in{from{opacity:0;translate:0 24px}}body{animation:site-in .45s cubic-bezier(.2,.7,.2,1) both}html.site-leaving body{opacity:0;translate:0 -12px;transition:opacity .2s ease,translate .2s ease}",
    zoom: "@keyframes site-in{from{opacity:0;scale:.98}}body{animation:site-in .4s ease both}html.site-leaving body{opacity:0;scale:1.01;transition:opacity .2s ease,scale .2s ease}",
};

function fontLinks(ctx: Ctx, families: Map<string, Set<string>>, custom: Set<string>): string {
    const settings = settingsOf(ctx.doc);
    if (!settings.webFonts) return "";
    const web = [...families.entries()].filter(([f]) => !custom.has(f) && !BUNDLED[f] && !/^(system-ui|-apple-system|arial|helvetica|georgia|times new roman|courier new|verdana)$/i.test(f));
    if (!web.length) return "";
    const params = web
        .map(([family, faces]) => {
            const list = [...faces]
                .map((f) => f.split(",").map(Number) as [number, number])
                .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            const axis = list.map(([i, w]) => `${i},${Math.round(w)}`).filter((v, i, all) => all.indexOf(v) === i);
            return `family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@${axis.join(";")}`;
        })
        .join("&");
    return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${params}&display=swap">`;
}

export interface OutputPage {
    pageId: string;
    path: string;
    file: string;
    depth: number;
    data: SitePageData;
    item?: { collection: Collection; item: CollectionItem };
}

// Every file the site will have: pages, item pages and the not-found page.
export function outputPages(doc: NagmaDocument): OutputPage[] {
    const out: OutputPage[] = [];
    for (const page of sitePages(doc)) {
        const data = pageData(page) as SitePageData;
        if (data.notFound) {
            out.push({ pageId: page.id, path: "/404", file: "404.html", depth: 0, data });
            continue;
        }
        const base = data.path === "/" ? "" : data.path;
        if (data.collectionId) {
            const collection = collectionOf(doc, data.collectionId);
            for (const item of collection?.items ?? []) {
                const path = `${base}/${item.slug}`;
                out.push({ pageId: page.id, path, file: `${path.slice(1)}/index.html`, depth: path.split("/").length - 1, data, item: { collection: collection as Collection, item } });
            }
            continue;
        }
        out.push({ pageId: page.id, path: data.path, file: base ? `${base.slice(1)}/index.html` : "index.html", depth: base ? base.split("/").length - 1 : 0, data });
    }
    return out;
}

function anchorsOf(doc: NagmaDocument): Map<string, string> {
    const anchors = new Map<string, string>();
    const used = new Set<string>();
    const add = (id: string) => {
        const node = doc.nodes[id];
        if (!node || anchors.has(id)) return;
        let name = slugify(webData(node).anchor || node.name);
        let n = 2;
        while (used.has(name)) name = `${slugify(webData(node).anchor || node.name)}-${n++}`;
        used.add(name);
        anchors.set(id, name);
    };
    for (const node of Object.values(doc.nodes)) {
        const web = webData(node);
        if (web.anchor) add(node.id);
        if (web.link?.kind === "section") add(web.link.nodeId);
        if (web.action?.kind === "scroll-to") add(web.action.nodeId);
        if ((web.effect?.kind === "appear" || web.effect?.kind === "scroll") && web.effect.trigger === "layer" && web.effect.target) add(web.effect.target);
    }
    return anchors;
}

function extFor(type: string): string {
    if (type.includes("png")) return "png";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    if (type.includes("gif")) return "gif";
    if (type.includes("webp")) return "webp";
    if (type.includes("svg")) return "svg";
    if (type.includes("avif")) return "avif";
    return "png";
}

// Builds the whole site. Preview inlines images and fonts as data so the result needs no server.
export async function buildSite(doc: NagmaDocument, mode: Mode): Promise<SiteBuild> {
    const settings = settingsOf(doc);
    const warnings: string[] = [];
    const assets = new Map<string, Blob>();
    // Images first, so pages can point at them.
    const images = new Map<string, string>();
    const neededImages = new Set<string>();
    for (const node of Object.values(doc.nodes)) for (const f of node.fills) if (f.type === "image") neededImages.add(f.id);
    for (const c of libraryData(doc)?.collections ?? []) for (const field of c.fields) if (field.type === "image") for (const item of c.items) if (item.values[field.id]) neededImages.add(item.values[field.id] as string);
    for (const id of [settings.favicon, settings.socialImage, ...sitePages(doc).map((p) => pageData(p)?.socialImage)]) if (id) neededImages.add(id);
    await Promise.all(
        [...neededImages].map(async (id) => {
            if (!doc.images[id]) return;
            const blob = await imageBlob(doc.images, id).catch(() => null);
            if (!blob) return;
            if (mode === "preview") images.set(id, await blobToDataUrl(blob));
            else {
                const name = `assets/${id.replace(/[^A-Za-z0-9_-]/g, "_")}.${extFor(blob.type)}`;
                images.set(id, name);
                assets.set(name, blob);
            }
        }),
    );
    // Uploaded fonts.
    let fontFaces = "";
    const custom = new Set<string>();
    for (const font of settings.fonts) {
        if (!font.media) continue;
        const blob = await loadMedia(font.media).catch(() => null);
        if (!blob) {
            warnings.push(`The font file for ${font.family} couldn't be loaded.`);
            continue;
        }
        custom.add(font.family);
        const ext = font.format === "woff" ? "woff" : font.format === "truetype" ? "ttf" : font.format === "opentype" ? "otf" : "woff2";
        let src: string;
        if (mode === "preview") src = await blobToDataUrl(blob);
        else {
            src = `fonts/${font.media.replace(/[^A-Za-z0-9_-]/g, "_")}.${ext}`;
            assets.set(src, blob);
        }
        fontFaces += `@font-face{font-family:"${font.family.replace(/["\\]/g, "")}";src:url("{{ROOT}}${src}") format("${font.format ?? "woff2"}");font-weight:${font.weight ?? 400};font-style:${font.italic ? "italic" : "normal"};font-display:swap}`;
    }
    const anchors = anchorsOf(doc);
    const pages: BuiltPage[] = [];
    for (const out of outputPages(doc)) {
        const frames = bpFrames(doc, out.pageId);
        const desktop = frames.desktop;
        if (!desktop) continue;
        const ctx: Ctx = {
            doc,
            mode,
            depth: out.depth,
            pageId: out.pageId,
            item: out.item,
            images,
            usedImages: new Set(),
            families: new Map(),
            anchors,
            rules: [],
            media: {},
            styled: new Set(),
            hasForms: false,
            tail: [],
        };
        const bps = breakpointsOf(doc, out.pageId);
        const body = renderNode(ctx, { frames, others: bps.slice(1).map((b) => b.id) }, desktop, undefined, { root: true });
        const rootClass = cls(desktop.id);
        // Each other breakpoint's changes apply across its own range of window widths.
        const queries = bps
            .slice(1)
            .filter((b) => ctx.media[b.id]?.length)
            .map((b) => {
                const range = [b.min > 0 ? `(min-width:${b.min}px)` : "", b.max !== null ? `(max-width:${b.max + 0.98}px)` : ""].filter(Boolean).join(" and ");
                return range ? `@media ${range}{${(ctx.media[b.id] ?? []).join("")}}` : (ctx.media[b.id] ?? []).join("");
            })
            .join("");
        const css =
            BASE_CSS +
            (TRANSITIONS[settings.transition] ?? "") +
            fontFaces.replace(/\{\{ROOT\}\}/g, mode === "preview" ? "" : rel(ctx)) +
            ctx.rules.join("") +
            queries;
        const page = doc.nodes[out.pageId] as SceneNode;
        const itemTitle = out.item ? fieldText(out.item.collection, out.item.item, out.item.collection.fields[0]?.id ?? "") : "";
        const pageTitle = out.item ? itemTitle : out.data.title || (out.data.path === "/" ? "" : page.name);
        const title = [pageTitle, settings.title].filter(Boolean).join(" | ") || page.name;
        const description = out.data.description || settings.description;
        const social = out.data.socialImage || settings.socialImage;
        const head: string[] = [
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            `<title>${esc(title)}</title>`,
        ];
        if (description) head.push(`<meta name="description" content="${attr(description)}">`, `<meta property="og:description" content="${attr(description)}">`);
        head.push(`<meta property="og:title" content="${attr(title)}">`, '<meta property="og:type" content="website">');
        if (social && images.get(social)) head.push(`<meta property="og:image" content="${attr(imageUrl(ctx, social))}">`, '<meta name="twitter:card" content="summary_large_image">');
        if (settings.favicon && images.get(settings.favicon)) head.push(`<link rel="icon" href="${attr(imageUrl(ctx, settings.favicon))}">`);
        if (settings.noindex || out.data.noindex || out.data.notFound) head.push('<meta name="robots" content="noindex">');
        head.push(fontLinks(ctx, ctx.families, custom));
        head.push(`<style>${css}</style>`);
        // Editors' own code, as-is.
        if (settings.analytics.trim()) head.push(settings.analytics);
        if (settings.headCode.trim()) head.push(settings.headCode);
        const runtime = `<script>${mode === "preview" ? "window.__sitePreview=1;" : ""}${RUNTIME}</script>`;
        const html = `<!doctype html>\n<html lang="${attr(settings.lang || "en")}">\n<head>\n${head.filter(Boolean).join("\n")}\n</head>\n<body class="${rootClass}">\n${body}\n${ctx.tail.join("\n")}${settings.bodyCode.trim() ? `${settings.bodyCode}\n` : ""}${runtime}\n</body>\n</html>\n`;
        pages.push({ path: out.path, file: out.file, title, html });
    }
    if (!pages.some((p) => p.path === "/")) warnings.push("The site has no home page (a page at /).");
    return { pages, assets, warnings };
}

function libraryData(doc: NagmaDocument) {
    const page = libraryPage(doc);
    return page?.site && "kind" in page.site && page.site.kind === "library" ? page.site : null;
}

// Every file of a built site, for the zip and for publishing.
export async function siteFiles(build: SiteBuild): Promise<{ path: string; blob: Blob }[]> {
    const out = build.pages.map((p) => ({ path: p.file, blob: new Blob([p.html], { type: "text/html" }) }));
    for (const [path, blob] of build.assets) out.push({ path, blob });
    return out;
}
