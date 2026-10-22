// Nagma Capture's page script: walks the rendered page and builds a capture document
// (apps/web/src/engine/capture-format.ts). Injected by the service worker into the tab being
// captured; it defines `__nagmaCapture(options)` and nothing else on the page.
//
// The walk is synchronous, so the page can't change under it: pseudo elements (::before, ::after)
// are stood in for by real elements with the same computed style for the duration of the walk,
// then taken out again. Pictures are listed by URL and read afterwards, first from the page (same
// origin, CORS, data and blob URLs), then by the service worker for the rest.

import type { Capture, CaptureBackground, CaptureBox, CaptureFont, CaptureNode, CaptureRun, CaptureShadow, CaptureStyle, CaptureText, CaptureTextStyle } from "../../web/src/engine/capture-format";

export interface CaptureOptions {
    // Read every picture from the page itself (standalone use, tests); otherwise the ones the page
    // can't read are left for the service worker.
    inlineAssets?: boolean;
    // The most bytes of pictures a capture carries (40 MB).
    maxAssetBytes?: number;
}

// A picture still to read: by URL, or (when the URL can't be read) as a screenshot of its box.
export interface PendingAsset {
    id: string;
    url: string | null;
    box: CaptureBox;
}

export interface CaptureResult {
    capture: Capture;
    pending: PendingAsset[];
}

const SKIP = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "title", "base", "datalist", "source", "track", "param", "map", "area"]);
const REPLACED = new Set(["img", "svg", "video", "canvas", "iframe", "input", "textarea", "select", "button", "object", "embed", "picture", "audio", "progress", "meter", "math"]);
const SCREENSHOT_TAGS = new Set(["iframe", "embed", "object"]);
const LABELS: Record<string, string> = {
    header: "Header",
    nav: "Navigation",
    main: "Main",
    footer: "Footer",
    section: "Section",
    article: "Article",
    aside: "Aside",
    form: "Form",
    button: "Button",
    a: "Link",
    ul: "List",
    ol: "List",
    li: "List item",
    table: "Table",
    thead: "Table head",
    tbody: "Table body",
    tr: "Row",
    td: "Cell",
    th: "Header cell",
    img: "Image",
    picture: "Image",
    svg: "Icon",
    canvas: "Canvas",
    video: "Video",
    iframe: "Embedded page",
    input: "Input",
    textarea: "Text area",
    select: "Select",
    label: "Label",
    h1: "Heading",
    h2: "Heading",
    h3: "Heading",
    h4: "Heading",
    h5: "Heading",
    h6: "Heading",
    p: "Paragraph",
    blockquote: "Quote",
    figure: "Figure",
    figcaption: "Caption",
    hr: "Divider",
    dl: "List",
    pre: "Code",
    code: "Code",
    fieldset: "Field set",
    legend: "Legend",
    details: "Details",
    summary: "Summary",
    dialog: "Dialog",
    body: "Body",
};

// Utility classes say little about what a box is; the first class that isn't one names it.
const UTILITY = /^(-?[a-z]{1,3}-|flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|w-|h-|min-|max-|text-|font-|bg-|border|rounded|shadow|gap-|items-|justify-|self-|place-|content-|overflow|z-|opacity|transition|duration|ease|transform|translate|rotate|scale|space-|divide|ring|outline|leading|tracking|whitespace|truncate|sr-only|container|mx-|my-|px-|py-|pt-|pb-|pl-|pr-|mt-|mb-|ml-|mr-|top-|left-|right-|bottom-|inset|col-|row-|order-|basis|shrink|grow|cursor|select-|pointer|align-|object-|aspect|underline|uppercase|lowercase|capitalize|italic|antialiased|subpixel|break-|list-|appearance|fill-|stroke-|from-|to-|via-|backdrop|blur|filter|drop-shadow|animate|group|peer|dark:|hover:|focus:|md:|lg:|sm:|xl:)/;

const px = (v: string | null | undefined) => {
    const n = parseFloat(v ?? "");
    return Number.isFinite(n) ? n : 0;
};
const round = (n: number) => Math.round(n * 100) / 100;

function shortText(s: string, n = 32): string {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function nameOf(el: Element): string {
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return shortText(aria, 48);
    const tag = el.tagName.toLowerCase();
    if (tag === "img") {
        const alt = (el as HTMLImageElement).alt?.trim();
        if (alt) return `Image: ${shortText(alt, 40)}`;
    }
    const role = el.getAttribute("role");
    let base = LABELS[tag] ?? (role ? role[0]?.toUpperCase() + role.slice(1) : "");
    const id = el.id && !/^[:\d]|^radix-|^r\d/.test(el.id) ? el.id : "";
    const cls = Array.from(el.classList).find((c) => c.length > 1 && c.length < 40 && !UTILITY.test(c) && !/[[\]:/]/.test(c) && !/^(css|sc|jsx|svelte|emotion)-[a-z0-9]+$/i.test(c));
    if ((tag === "button" || tag === "a" || /^h[1-6]$/.test(tag) || tag === "label") && el.textContent?.trim()) {
        const text = shortText(el.textContent, 28);
        return `${base || "Text"} “${text}”`;
    }
    if (!base) base = cls ? "" : "Frame";
    const detail = id || cls || "";
    if (base && detail) return `${base} · ${detail}`;
    return base || detail || tag;
}

// ---- Fonts ----

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "-apple-system", "blinkmacsystemfont"]);
const familyCache = new Map<string, string>();
let loadedFamilies: Set<string> | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function webFamilies(): Set<string> {
    if (loadedFamilies) return loadedFamilies;
    loadedFamilies = new Set();
    try {
        document.fonts.forEach((f) => {
            if (f.status === "loaded") loadedFamilies?.add(f.family.replace(/^["']|["']$/g, "").toLowerCase());
        });
    } catch {
        // No font set: only installed fonts count.
    }
    return loadedFamilies;
}

function installed(family: string, text: string): boolean {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    const ctx = measureCtx;
    if (!ctx) return false;
    const sample = text;
    return ["monospace", "serif", "sans-serif"].some((fallback) => {
        ctx.font = `72px ${fallback}`;
        const a = ctx.measureText(sample).width;
        ctx.font = `72px "${family}", ${fallback}`;
        return ctx.measureText(sample).width !== a;
    });
}

// The first family in a stack the browser can draw these characters with (a family without the
// script's letters is passed over, as the browser does).
function resolveFamily(stack: string, text = ""): string {
    const letters = text.replace(/[\s\d.,:;!?'"()\-–—]/g, "");
    const latin = Array.from(letters).every((c) => (c.codePointAt(0) ?? 0) <= 0x24f);
    const sample = latin ? "mmmmmmmmmmlli1WQ@#&" : Array.from(letters).slice(0, 24).join("");
    const key = `${stack}|${latin ? "" : sample}`;
    const known = familyCache.get(key);
    if (known) return known;
    const families = stack
        .split(",")
        .map((f) => f.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    let chosen = families[families.length - 1] ?? "sans-serif";
    for (const f of families) {
        const lower = f.toLowerCase();
        if (GENERIC.has(lower) || (latin && webFamilies().has(lower)) || installed(f, sample)) {
            chosen = f;
            break;
        }
    }
    familyCache.set(key, chosen);
    return chosen;
}

// ---- Styles ----

function splitTop(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
            out.push(cur.trim());
            cur = "";
        } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

// box-shadow / text-shadow as computed: "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px inset, …".
function shadowsOf(value: string): CaptureShadow[] {
    if (!value || value === "none") return [];
    return splitTop(value).flatMap((part) => {
        const color = /((?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)|#[0-9a-f]+|transparent|currentcolor|[a-z]+(?=\s|$))/i.exec(part.replace(/\binset\b/, ""));
        const rest = part.replace(color?.[0] ?? "", "").replace(/\binset\b/, "");
        const nums = rest.match(/-?[\d.]+px|-?[\d.]+(?=\s|$)/g)?.map((n) => parseFloat(n)) ?? [];
        if (nums.length < 2) return [];
        return [{ x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color: color?.[0] ?? "rgba(0,0,0,1)", inset: /\binset\b/.test(part) }];
    });
}

function radiusOf(v: string, w: number, h: number): number {
    const first = v.split(/\s+/)[0] ?? "0";
    if (first.endsWith("%")) return (parseFloat(first) / 100) * Math.min(w, h);
    return px(first);
}

function tracks(value: string): number[] {
    if (!value || value === "none" || /repeat|subgrid|minmax|\[/.test(value)) return value.includes("[") ? value.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/).map(px).filter((n) => n > 0) : [];
    return value.split(/\s+/).map(px);
}

function blurOf(filter: string): number | undefined {
    const m = /blur\(([\d.]+)px\)/.exec(filter);
    return m ? parseFloat(m[1] as string) : undefined;
}

// The element's own rotation (degrees) and scale from its computed transform.
function rotationOf(cs: CSSStyleDeclaration): { angle: number; scale: number } {
    const t = cs.transform;
    if (!t || t === "none") return { angle: 0, scale: 1 };
    const m = /matrix\(([^)]+)\)/.exec(t);
    if (!m) return { angle: 0, scale: 1 };
    const [a = 1, b = 0] = (m[1] as string).split(",").map(parseFloat);
    return { angle: (Math.atan2(b, a) * 180) / Math.PI, scale: Math.hypot(a, b) };
}

interface Ctx {
    // Added to viewport positions: the scroll offset (zero inside fixed elements).
    ox: number;
    oy: number;
    // Rotated ancestors, outermost first: their centre (page px) and angle.
    turns: { cx: number; cy: number; angle: number }[];
    assets: Assets;
    // Inside a link: its address.
    href?: string;
}

function unturn(ctx: Ctx, x: number, y: number): { x: number; y: number } {
    let p = { x, y };
    for (const t of ctx.turns) {
        const r = (-t.angle * Math.PI) / 180;
        const dx = p.x - t.cx;
        const dy = p.y - t.cy;
        p = { x: t.cx + dx * Math.cos(r) - dy * Math.sin(r), y: t.cy + dx * Math.sin(r) + dy * Math.cos(r) };
    }
    return p;
}

function boxOf(ctx: Ctx, r: DOMRect | { left: number; top: number; width: number; height: number }, size?: { w: number; h: number }): CaptureBox {
    if (!ctx.turns.length && !size) return { x: round(r.left + ctx.ox), y: round(r.top + ctx.oy), w: round(r.width), h: round(r.height) };
    const c = unturn(ctx, r.left + ctx.ox + r.width / 2, r.top + ctx.oy + r.height / 2);
    const w = size?.w ?? r.width;
    const h = size?.h ?? r.height;
    return { x: round(c.x - w / 2), y: round(c.y - h / 2), w: round(w), h: round(h) };
}

function backgroundsOf(cs: CSSStyleDeclaration, ctx: Ctx, box: CaptureBox): CaptureBackground[] {
    const image = cs.backgroundImage;
    if (!image || image === "none") return [];
    const sizes = splitTop(cs.backgroundSize);
    const positions = splitTop(cs.backgroundPosition);
    const repeats = splitTop(cs.backgroundRepeat);
    return splitTop(image).flatMap((layer, i): CaptureBackground[] => {
        const url = /^url\(["']?(.*?)["']?\)$/.exec(layer);
        if (url) {
            const asset = ctx.assets.add(url[1] as string, box);
            return asset ? [{ kind: "image", asset, size: sizes[i % sizes.length] ?? "auto", position: positions[i % positions.length] ?? "0% 0%", repeat: repeats[i % repeats.length] ?? "repeat" }] : [];
        }
        if (/gradient\(/.test(layer)) return [{ kind: "gradient", css: layer }];
        return [];
    });
}

function styleOf(el: Element, cs: CSSStyleDeclaration, ctx: Ctx, box: CaptureBox): CaptureStyle {
    const display = cs.display;
    const style: CaptureStyle = {
        display,
        position: cs.position,
        padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
        borderWidths: [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)],
        borderColors: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
        borderStyles: [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle],
        radii: [radiusOf(cs.borderTopLeftRadius, box.w, box.h), radiusOf(cs.borderTopRightRadius, box.w, box.h), radiusOf(cs.borderBottomRightRadius, box.w, box.h), radiusOf(cs.borderBottomLeftRadius, box.w, box.h)],
        backgroundColor: cs.backgroundColor,
        backgrounds: backgroundsOf(cs, ctx, box),
        shadows: shadowsOf(cs.boxShadow),
        opacity: round(px(cs.opacity) || (cs.opacity === "0" ? 0 : 1)),
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        zIndex: cs.zIndex === "auto" ? null : parseInt(cs.zIndex, 10) || 0,
    };
    if (/flex|grid/.test(display)) {
        style.flexDirection = cs.flexDirection;
        style.flexWrap = cs.flexWrap;
        style.justifyContent = cs.justifyContent;
        style.alignItems = cs.alignItems;
        style.alignContent = cs.alignContent;
        if (cs.rowGap !== "normal") style.rowGap = px(cs.rowGap);
        if (cs.columnGap !== "normal") style.columnGap = px(cs.columnGap);
        if (/grid/.test(display)) {
            style.gridColumns = tracks(cs.gridTemplateColumns);
            style.gridRows = tracks(cs.gridTemplateRows);
        }
    }
    if (cs.mixBlendMode && cs.mixBlendMode !== "normal") style.blend = cs.mixBlendMode;
    const blur = blurOf(cs.filter);
    if (blur) style.blur = blur;
    const backdrop = blurOf(cs.backdropFilter ?? (cs as unknown as Record<string, string>).webkitBackdropFilter ?? "");
    if (backdrop) style.backdropBlur = backdrop;
    void el;
    return style;
}

function hiddenStyle(style: CaptureStyle): CaptureStyle {
    return { ...style, backgroundColor: "rgba(0, 0, 0, 0)", backgrounds: [], shadows: [], borderWidths: [0, 0, 0, 0] };
}

function textStyleOf(cs: CSSStyleDeclaration, text = ""): CaptureTextStyle {
    const size = px(cs.fontSize) || 16;
    const align = cs.textAlign;
    const rtl = cs.direction === "rtl";
    const lh = cs.lineHeight === "normal" ? null : px(cs.lineHeight);
    const decoration = cs.textDecorationLine ?? cs.textDecoration ?? "";
    return {
        family: resolveFamily(cs.fontFamily, text),
        stack: cs.fontFamily,
        size,
        weight: parseInt(cs.fontWeight, 10) || 400,
        italic: cs.fontStyle === "italic" || cs.fontStyle.startsWith("oblique"),
        lineHeight: lh,
        letterSpacing: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
        color: transparent(cs.color) && px(cs.getPropertyValue("-webkit-text-stroke-width")) > 0 ? cs.getPropertyValue("-webkit-text-stroke-color") : cs.color,
        align: align === "center" || align === "-webkit-center" ? "center" : align === "justify" ? "justify" : align === "right" || align === "-webkit-right" ? "right" : align === "left" || align === "-webkit-left" ? "left" : align === "end" ? (rtl ? "left" : "right") : rtl ? "right" : "left",
        decoration: decoration.includes("underline") ? "underline" : decoration.includes("line-through") ? "line-through" : "none",
        transform: cs.textTransform === "uppercase" || cs.textTransform === "lowercase" || cs.textTransform === "capitalize" ? cs.textTransform : "none",
        whiteSpace: cs.whiteSpace,
        direction: rtl ? "rtl" : "ltr",
        ...(cs.textShadow && cs.textShadow !== "none" ? { shadows: shadowsOf(cs.textShadow) } : {}),
    };
}

// ---- Assets ----

class Assets {
    byUrl = new Map<string, string>();
    data: Record<string, { url: string; data: string | null; bitmap?: boolean }> = {};
    pending: PendingAsset[] = [];
    private next = 1;

    add(url: string, box: CaptureBox): string | null {
        if (!url) return null;
        let abs: string;
        try {
            abs = new URL(url, document.baseURI).href;
        } catch {
            return null;
        }
        const known = this.byUrl.get(abs);
        if (known) return known;
        const id = `a${this.next++}`;
        this.byUrl.set(abs, id);
        this.data[id] = { url: abs, data: abs.startsWith("data:") ? abs : null };
        if (!abs.startsWith("data:")) this.pending.push({ id, url: abs, box });
        return id;
    }

    // Bytes the page already has (a canvas, a video frame).
    addData(label: string, data: string): string {
        const id = `a${this.next++}`;
        this.data[id] = { url: label, data };
        return id;
    }

    // Read later from a screenshot of the box.
    addScreenshot(label: string, box: CaptureBox): string {
        const id = `a${this.next++}`;
        this.data[id] = { url: label, data: null, bitmap: true };
        this.pending.push({ id, url: null, box });
        return id;
    }
}

// ---- Pseudo elements ----

const PSEUDO_TAG = "nagma-pseudo";

function contentText(content: string, el: Element, index: number): { text: string; url: string | null } | null {
    if (!content || content === "none" || content === "normal") return null;
    let text = "";
    let url: string | null = null;
    const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|url\(["']?([^"')]*)["']?\)|attr\(([^)]+)\)|counters?\([^)]*\)|open-quote|close-quote|no-open-quote|no-close-quote/g;
    let m: RegExpExecArray | null;
    let matched = false;
    while ((m = re.exec(content))) {
        matched = true;
        if (m[1] !== undefined || m[2] !== undefined) text += (m[1] ?? m[2] ?? "").replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1");
        else if (m[3] !== undefined) url = m[3];
        else if (m[4] !== undefined) text += el.getAttribute(m[4].trim()) ?? "";
        else if (m[0].startsWith("counter")) text += String(index + 1);
        else if (m[0] === "open-quote") text += "“";
        else if (m[0] === "close-quote") text += "”";
    }
    if (!matched) return null;
    return { text, url };
}

// Stands real elements in for ::before and ::after across the page; returns the undo.
function standInPseudos(): () => void {
    const added: Element[] = [];
    const hosts: Element[] = [];
    const sheet = document.createElement("style");
    sheet.setAttribute("data-nagma-capture", "");
    const rules: string[] = [];
    let n = 0;
    const all = Array.from(document.body.querySelectorAll("*"));
    for (const el of all) {
        const tag = el.tagName.toLowerCase();
        if (REPLACED.has(tag) || SKIP.has(tag) || el.closest("svg")) continue;
        for (const which of ["before", "after"] as const) {
            const ps = getComputedStyle(el, `::${which}`);
            if (ps.display === "none") continue;
            const index = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0;
            const content = contentText(ps.content, el, index);
            if (!content) continue;
            const stand = document.createElement(PSEUDO_TAG);
            for (let i = 0; i < ps.length; i++) {
                const prop = ps[i] as string;
                if (prop.startsWith("--") || prop === "content") continue;
                stand.style.setProperty(prop, ps.getPropertyValue(prop));
            }
            if (content.url) {
                const img = document.createElement("img");
                img.src = content.url;
                img.style.display = "inline";
                stand.appendChild(img);
            }
            if (content.text) stand.appendChild(document.createTextNode(content.text));
            stand.setAttribute("data-nagma-pseudo", which);
            const key = `p${n++}`;
            el.setAttribute(`data-nagma-host-${which}`, key);
            hosts.push(el);
            rules.push(`[data-nagma-host-${which}="${key}"]::${which}{content:none!important;display:none!important}`);
            if (which === "before") el.insertBefore(stand, el.firstChild);
            else el.appendChild(stand);
            added.push(stand);
        }
    }
    sheet.textContent = rules.join("\n");
    if (rules.length) document.head.appendChild(sheet);
    return () => {
        for (const a of added) a.remove();
        for (const h of hosts) {
            h.removeAttribute("data-nagma-host-before");
            h.removeAttribute("data-nagma-host-after");
        }
        sheet.remove();
    };
}

// ---- Text ----

// What an element draws inside it: its shadow tree when it has an open one, the nodes assigned to
// a slot (or the slot's fallback), its children otherwise.
function childrenOf(el: Element): Node[] {
    if (el.shadowRoot) return Array.from(el.shadowRoot.childNodes);
    if (el instanceof HTMLSlotElement) {
        const assigned = el.assignedNodes({ flatten: true });
        if (assigned.length) return assigned;
    }
    return Array.from(el.childNodes);
}

// Whether a node lays out as part of its parent's lines: text, or an inline element holding only
// such things.
function inlineFlow(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) return true;
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br" || tag === "wbr") return true;
    if (SKIP.has(tag)) return true;
    if (REPLACED.has(tag)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return true;
    if (cs.display !== "inline" && cs.display !== "contents") return false;
    if (cs.position === "absolute" || cs.position === "fixed") return false;
    return childrenOf(el).every(inlineFlow);
}

interface Segment {
    text: string;
    el: Element;
    href?: string;
    // A stand-in for an inline element's padding, border and margin at one end: a no-break space
    // as wide as that (px).
    space?: number;
}

let spaceCtx: CanvasRenderingContext2D | null = null;

// How wide a no-break space is in an element's font.
function nbspWidth(el: Element): number {
    spaceCtx ??= document.createElement("canvas").getContext("2d");
    if (!spaceCtx) return 0;
    spaceCtx.font = getComputedStyle(el).font;
    return spaceCtx.measureText("\u00A0").width;
}

// The rendered characters of a group of inline nodes, whitespace collapsed the way the page's
// white-space says, with the element each piece is styled by.
function segmentsOf(nodes: Node[], container: Element, href: string | undefined): Segment[] {
    const out: Segment[] = [];
    const visit = (node: Node, link: string | undefined) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const el = node.parentElement ?? container;
            out.push({ text: node.textContent ?? "", el, href: link });
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === "br") {
            out.push({ text: "\n", el, href: link });
            return;
        }
        if (SKIP.has(tag) || getComputedStyle(el).display === "none") return;
        const a = tag === "a" ? (el as HTMLAnchorElement).href || link : link;
        const cs = getComputedStyle(el);
        const rtl = cs.direction === "rtl";
        const left = px(cs.marginLeft) + px(cs.borderLeftWidth) + px(cs.paddingLeft);
        const right = px(cs.marginRight) + px(cs.borderRightWidth) + px(cs.paddingRight);
        const [startSpace, endSpace] = rtl ? [right, left] : [left, right];
        if (cs.display === "inline" && startSpace > 0.5) out.push({ text: "\u00A0", el, href: a, space: startSpace });
        for (const child of childrenOf(el)) visit(child, a);
        if (cs.display === "inline" && endSpace > 0.5) out.push({ text: "\u00A0", el, href: a, space: endSpace });
    };
    for (const node of nodes) visit(node, href);
    // Collapse whitespace across the pieces.
    let lastSpace = true;
    for (const s of out) {
        if (s.space !== undefined) continue;
        if (s.text === "\n" && s.el.tagName.toLowerCase() === "br") {
            lastSpace = true;
            continue;
        }
        const ws = getComputedStyle(s.el).whiteSpace;
        if (ws === "pre" || ws === "pre-wrap" || ws === "break-spaces") {
            lastSpace = /\s$/.test(s.text);
            continue;
        }
        let t = ws === "pre-line" ? s.text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n") : s.text.replace(/[\s]+/g, " ");
        if (lastSpace) t = t.replace(/^ /, "");
        if (t.length) lastSpace = /[ \n]$/.test(t);
        s.text = t;
    }
    // Trailing spaces at the end, and at each line break.
    for (let i = out.length - 1; i >= 0; i--) {
        const s = out[i] as Segment;
        s.text = s.text.replace(/ +$/, "");
        if (s.text.length) break;
    }
    return out.filter((s) => s.text.length);
}

const SAME_KEYS: (keyof CaptureTextStyle)[] = ["family", "size", "weight", "italic", "color", "decoration", "letterSpacing", "transform"];

// Text decoration isn't inherited in computed style but shows on the text inside: the nearest
// inline ancestor's.
function decorationOf(el: Element, stop: Element): CaptureTextStyle["decoration"] {
    let cur: Element | null = el;
    while (cur) {
        const line = getComputedStyle(cur).textDecorationLine;
        if (line.includes("underline")) return "underline";
        if (line.includes("line-through")) return "line-through";
        if (cur === stop) break;
        cur = cur.parentElement;
    }
    return "none";
}

function lineCount(rects: DOMRect[]): { lines: number; first: DOMRect | null } {
    const lines: { top: number; bottom: number }[] = [];
    let first: DOMRect | null = null;
    for (const r of rects) {
        if (r.width <= 0 || r.height <= 0) continue;
        first ??= r;
        const line = lines.find((l) => Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) > Math.min(r.height, l.bottom - l.top) * 0.5);
        if (line) {
            line.top = Math.min(line.top, r.top);
            line.bottom = Math.max(line.bottom, r.bottom);
        } else lines.push({ top: r.top, bottom: r.bottom });
    }
    return { lines: Math.max(1, lines.length), first };
}

function textNodeOf(nodes: Node[], container: Element, ctx: Ctx, alone: boolean): CaptureNode | null {
    const segments = segmentsOf(nodes, container, ctx.href);
    if (!segments.length) return null;
    const range = document.createRange();
    range.setStartBefore(nodes[0] as Node);
    range.setEndAfter(nodes[nodes.length - 1] as Node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    range.detach?.();
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const { lines, first } = lineCount(rects);
    const ccs = getComputedStyle(container);
    // The block's style: the style most of the characters have.
    const styles = segments.map((s) => {
        const st = textStyleOf(getComputedStyle(s.el), s.space !== undefined ? "" : s.text);
        st.decoration = s.space !== undefined ? "none" : decorationOf(s.el, container);
        if (s.space !== undefined) st.letterSpacing = round(s.space - nbspWidth(s.el));
        return st;
    });
    const weightBy = new Map<string, { style: CaptureTextStyle; n: number }>();
    styles.forEach((st, i) => {
        if ((segments[i] as Segment).space !== undefined) return;
        const key = JSON.stringify(SAME_KEYS.map((k) => st[k]));
        const e = weightBy.get(key) ?? { style: st, n: 0 };
        e.n += (segments[i] as Segment).text.length;
        weightBy.set(key, e);
    });
    const base = [...weightBy.values()].sort((a, b) => b.n - a.n)[0]?.style as CaptureTextStyle;
    const containerText = textStyleOf(ccs);
    base.align = containerText.align;
    base.lineHeight = containerText.lineHeight ?? base.lineHeight;
    base.whiteSpace = containerText.whiteSpace;
    base.direction = containerText.direction;
    let content = "";
    const runs: CaptureRun[] = [];
    segments.forEach((s, i) => {
        const st = styles[i] as CaptureTextStyle;
        const start = content.length;
        content += s.text;
        const diff: Partial<CaptureTextStyle> = {};
        for (const k of SAME_KEYS) if (st[k] !== base[k]) (diff as Record<string, unknown>)[k] = st[k];
        if (Object.keys(diff).length || (s.href && s.href !== ctx.href)) runs.push({ start, end: content.length, style: diff, ...(s.href && s.href !== ctx.href ? { href: s.href } : {}) });
    });
    if (!content.trim()) return null;
    // Range boxes are the glyphs' content area, not the line box: the line box (line-height tall)
    // shares its middle. "normal" line height is the content area itself.
    const contentH = Math.max(...rects.filter((r) => first && Math.min(r.bottom, first.bottom) - Math.max(r.top, first.top) > 0).map((r) => r.height));
    const normal = base.lineHeight === null;
    const lh = base.lineHeight ?? contentH;
    base.lineHeight = round(lh);
    const lineTop = top + (contentH - lh) / 2;
    // Text that is all of a block's content takes the block's content width: wrapping text then
    // wraps where the page did, and aligned text sits where it did.
    let x = left;
    let w = right - left;
    const blockish = !/flex|grid/.test(ccs.display);
    if (alone && blockish) {
        const cr = container.getBoundingClientRect();
        const cl = cr.left + px(ccs.borderLeftWidth) + px(ccs.paddingLeft);
        const cw = cr.width - px(ccs.borderLeftWidth) - px(ccs.paddingLeft) - px(ccs.borderRightWidth) - px(ccs.paddingRight);
        if (cw > 0 && cl <= left + 1 && cl + cw >= right - 1) {
            x = cl;
            w = cw;
        }
    }
    const text: CaptureText = { content, style: base, runs, lines, textWidth: round(right - left), ...(normal ? { lineHeightNormal: true } : {}) };
    if (first && lines > 1 && base.align === "left" && first.left - x > 1) text.indent = round(first.left - x);
    const clamp = parseInt((ccs as unknown as Record<string, string>).webkitLineClamp ?? "", 10);
    if (clamp > 0) text.maxLines = clamp;
    else if (ccs.textOverflow === "ellipsis" && ccs.overflowX !== "visible" && /nowrap|pre/.test(ccs.whiteSpace)) {
        text.maxLines = 1;
        const cr = container.getBoundingClientRect();
        w = Math.min(w, cr.right - x);
    }
    const box = boxOf(ctx, { left: x, top: lineTop, width: w, height: Math.max(lh * lines, bottom - lineTop - (contentH - lh) / 2) });
    return { tag: "#text", name: shortText(content, 40), box, style: emptyStyle(), text, children: [], ...(ctx.href ? { href: ctx.href } : {}) };
}

function emptyStyle(): CaptureStyle {
    return { display: "inline", position: "static", padding: [0, 0, 0, 0], borderWidths: [0, 0, 0, 0], borderColors: ["", "", "", ""], borderStyles: ["none", "none", "none", "none"], radii: [0, 0, 0, 0], backgroundColor: "rgba(0, 0, 0, 0)", backgrounds: [], shadows: [], opacity: 1, overflowX: "visible", overflowY: "visible", zIndex: null };
}

// Backgrounds and borders of inline elements inside a text block (highlighted code, badges in a
// sentence): a box behind the text for each line they cover.
function inlineBoxes(nodes: Node[], ctx: Ctx): CaptureNode[] {
    const out: CaptureNode[] = [];
    const visit = (node: Node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        const hasBg = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
        const hasBorder = px(cs.borderTopWidth) + px(cs.borderBottomWidth) + px(cs.borderLeftWidth) > 0 && cs.borderTopStyle !== "none";
        if (hasBg || hasBorder || cs.backgroundImage !== "none") {
            for (const r of Array.from(el.getClientRects())) {
                if (r.width <= 0 || r.height <= 0) continue;
                const box = boxOf(ctx, r);
                out.push({ tag: el.tagName.toLowerCase(), name: `${nameOf(el)} background`, box, style: { ...styleOf(el, cs, ctx, box), position: "static" }, children: [] });
            }
        }
        for (const c of childrenOf(el)) visit(c);
    };
    nodes.forEach(visit);
    return out;
}

// ---- Elements ----

function markerText(li: Element, cs: CSSStyleDeclaration): string | null {
    const type = cs.listStyleType;
    if (!type || type === "none" || cs.listStylePosition === "inside") return null;
    const list = li.parentElement;
    const items = list ? Array.from(list.children).filter((c) => getComputedStyle(c).display === "list-item") : [li];
    const ol = list?.tagName.toLowerCase() === "ol" ? (list as HTMLOListElement) : null;
    const pos = items.indexOf(li);
    const start = ol?.start ?? 1;
    const n = (li as HTMLLIElement).value || (ol?.reversed ? start - pos : start + pos);
    const alpha = (k: number, upper: boolean) => {
        let s = "";
        let v = k;
        while (v > 0) {
            v--;
            s = String.fromCharCode(97 + (v % 26)) + s;
            v = Math.floor(v / 26);
        }
        return upper ? s.toUpperCase() : s;
    };
    const roman = (k: number) => {
        const t: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
        let v = k;
        let s = "";
        for (const [a, r] of t)
            while (v >= a) {
                s += r;
                v -= a;
            }
        return s;
    };
    switch (type) {
        case "disc":
            return "•";
        case "circle":
            return "◦";
        case "square":
            return "▪";
        case "decimal":
            return `${n}.`;
        case "decimal-leading-zero":
            return `${String(n).padStart(2, "0")}.`;
        case "lower-alpha":
        case "lower-latin":
            return `${alpha(n, false)}.`;
        case "upper-alpha":
        case "upper-latin":
            return `${alpha(n, true)}.`;
        case "lower-roman":
            return `${roman(n)}.`;
        case "upper-roman":
            return `${roman(n).toUpperCase()}.`;
        default:
            return /^["']/.test(type) ? type.slice(1, -1) : "•";
    }
}

function markerNode(li: Element, cs: CSSStyleDeclaration, box: CaptureBox, ctx: Ctx): CaptureNode | null {
    const marker = markerText(li, cs);
    if (!marker) return null;
    const type = cs.listStyleType;
    if (type === "disc" || type === "circle" || type === "square") {
        // The browser draws these as shapes, about a third of an em, an em left of the text.
        const range = document.createRange();
        range.selectNodeContents(li);
        const line = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
        const size = px(cs.fontSize) || 16;
        const st = textStyleOf(cs);
        const lh = st.lineHeight ?? size * 1.2;
        const d = Math.max(3, Math.round(size * 0.35));
        const rtl = st.direction === "rtl";
        const contentLeft = box.x + px(cs.borderLeftWidth) + px(cs.paddingLeft);
        const contentRight = box.x + box.w - px(cs.borderRightWidth) - px(cs.paddingRight);
        const lineTop = line ? line.top + ctx.oy + (line.height - lh) / 2 : box.y + px(cs.paddingTop);
        const cy = lineTop + lh / 2 + size * 0.03;
        const x = rtl ? contentRight + size * 1.06 - d : contentLeft - size * 1.06;
        const style = { ...emptyStyle(), radii: (type === "square" ? [0, 0, 0, 0] : [d / 2, d / 2, d / 2, d / 2]) as [number, number, number, number] };
        if (type === "circle") {
            style.borderWidths = [1, 1, 1, 1];
            style.borderColors = [cs.color, cs.color, cs.color, cs.color];
            style.borderStyles = ["solid", "solid", "solid", "solid"];
        } else style.backgroundColor = cs.color;
        return { tag: "::marker", name: "Bullet", box: { x: round(x), y: round(cy - d / 2), w: d, h: d }, style, children: [] };
    }
    const probe = document.createElement("span");
    probe.textContent = `${marker} `;
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;left:0;top:0";
    li.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    const range = document.createRange();
    range.selectNodeContents(li);
    const firstLine = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
    const style = textStyleOf(cs);
    const lh = style.lineHeight ?? style.size * 1.2;
    const rtl = style.direction === "rtl";
    const contentLeft = box.x + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const contentRight = box.x + box.w - px(cs.borderRightWidth) - px(cs.paddingRight);
    const top = firstLine ? firstLine.top + ctx.oy + (firstLine.height - lh) / 2 : box.y + px(cs.paddingTop);
    const x = rtl ? contentRight : contentLeft - width;
    style.align = "left";
    style.lineHeight = lh;
    style.decoration = "none";
    return { tag: "::marker", name: "Marker", box: { x: round(x), y: round(top), w: round(width), h: round(lh) }, style: emptyStyle(), text: { content: marker, style, runs: [], lines: 1 }, children: [] };
}

function formControl(el: Element, cs: CSSStyleDeclaration, node: CaptureNode, ctx: Ctx): void {
    const tag = el.tagName.toLowerCase();
    const input = el as HTMLInputElement;
    const type = tag === "input" ? (input.type || "text").toLowerCase() : tag;
    const box = node.box;
    const content = {
        x: box.x + px(cs.borderLeftWidth) + px(cs.paddingLeft),
        y: box.y + px(cs.borderTopWidth) + px(cs.paddingTop),
        w: box.w - px(cs.borderLeftWidth) - px(cs.paddingLeft) - px(cs.borderRightWidth) - px(cs.paddingRight),
        h: box.h - px(cs.borderTopWidth) - px(cs.paddingTop) - px(cs.borderBottomWidth) - px(cs.paddingBottom),
    };
    if ((type === "checkbox" || type === "radio") && cs.appearance !== "none") {
        const accent = cs.accentColor && cs.accentColor !== "auto" ? cs.accentColor : "rgb(0, 117, 255)";
        const on = input.checked;
        node.style = {
            ...node.style,
            backgroundColor: on ? accent : "rgb(255, 255, 255)",
            borderWidths: [on && type === "checkbox" ? 0 : 1, on && type === "checkbox" ? 0 : 1, on && type === "checkbox" ? 0 : 1, on && type === "checkbox" ? 0 : 1],
            borderColors: [on ? accent : "rgb(118, 118, 118)", on ? accent : "rgb(118, 118, 118)", on ? accent : "rgb(118, 118, 118)", on ? accent : "rgb(118, 118, 118)"],
            borderStyles: ["solid", "solid", "solid", "solid"],
            radii: type === "radio" ? [box.w / 2, box.w / 2, box.w / 2, box.w / 2] : [2, 2, 2, 2],
        };
        if (on && type === "radio") {
            const d = box.w * 0.45;
            node.children.push({ tag: "dot", name: "Dot", box: { x: box.x + (box.w - d) / 2, y: box.y + (box.h - d) / 2, w: d, h: d }, style: { ...emptyStyle(), backgroundColor: "rgb(255, 255, 255)", radii: [d / 2, d / 2, d / 2, d / 2] }, children: [] });
            node.style.backgroundColor = "rgb(255, 255, 255)";
            node.style.borderWidths = [box.w * 0.27, box.w * 0.27, box.w * 0.27, box.w * 0.27];
        }
        if (on && type === "checkbox") {
            const st = textStyleOf(cs);
            node.children.push({ tag: "#text", name: "Check", box: { ...box }, style: emptyStyle(), text: { content: "✓", style: { ...st, family: "sans-serif", size: box.h * 0.85, weight: 700, color: "rgb(255, 255, 255)", align: "center", lineHeight: box.h }, runs: [], lines: 1 }, children: [] });
        }
        return;
    }
    if (["range", "color", "file", "progress", "meter", "image"].includes(type)) {
        const asset = ctx.assets.addScreenshot(`${type} control`, box);
        node.image = { asset, fit: "fill" };
        node.name = `${node.name} (bitmap)`;
        return;
    }
    let value = "";
    let placeholder = false;
    if (tag === "select") value = (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? "";
    else if (tag === "textarea" || tag === "input") {
        value = input.value;
        if (type === "password") value = "•".repeat(value.length);
        if (["submit", "button", "reset"].includes(type)) value = value || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
        if (!value && input.placeholder) {
            value = input.placeholder;
            placeholder = true;
        }
    }
    if (!value) return;
    const style = textStyleOf(placeholder ? getComputedStyle(el, "::placeholder") : cs);
    if (placeholder) style.color = getComputedStyle(el, "::placeholder").color;
    const lh = style.lineHeight ?? style.size * 1.2;
    style.lineHeight = lh;
    if (["submit", "button", "reset"].includes(type)) style.align = "center";
    const multi = tag === "textarea";
    const lines = multi ? Math.max(1, value.split("\n").length) : 1;
    const h = multi ? Math.min(content.h, lines * lh) : lh;
    const y = multi ? content.y : content.y + (content.h - lh) / 2;
    const w = tag === "select" ? Math.max(1, content.w - 16) : content.w;
    node.children.push({ tag: "#text", name: placeholder ? `Placeholder “${shortText(value, 24)}”` : shortText(value, 32), box: { x: round(content.x), y: round(y), w: round(w), h: round(h) }, style: emptyStyle(), text: { content: value, style, runs: [], lines: multi ? 2 : 1 }, children: [] });
    if (tag === "select" && cs.appearance !== "none") {
        const st = textStyleOf(cs);
        node.children.push({ tag: "#text", name: "Arrow", box: { x: round(content.x + content.w - 14), y: round(y), w: 14, h: round(lh) }, style: emptyStyle(), text: { content: "⌄", style: { ...st, align: "center", lineHeight: lh, weight: 400 }, runs: [], lines: 1 }, children: [] });
    }
}

// Inline SVG with its computed paint written onto each element, so it stands alone.
function serializeSvg(svg: SVGSVGElement, box: CaptureBox): string {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const src = [svg, ...Array.from(svg.querySelectorAll("*"))];
    const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];
    const props = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "display", "visibility", "stop-color", "stop-opacity", "color"];
    src.forEach((el, i) => {
        const target = dst[i];
        if (!target) return;
        const cs = getComputedStyle(el);
        const decls = props
            .map((p) => {
                let v = cs.getPropertyValue(p);
                if (!v) return "";
                if (v === "currentcolor" || v === "currentColor") v = cs.color;
                return `${p}:${v}`;
            })
            .filter(Boolean);
        target.setAttribute("style", decls.join(";"));
        target.removeAttribute("class");
    });
    clone.setAttribute("width", String(round(box.w)));
    clone.setAttribute("height", String(round(box.h)));
    if (!clone.getAttribute("viewBox")) {
        try {
            const bb = svg.viewBox?.baseVal;
            if (bb && bb.width) clone.setAttribute("viewBox", `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
            else clone.setAttribute("viewBox", `0 0 ${round(box.w)} ${round(box.h)}`);
        } catch {
            clone.setAttribute("viewBox", `0 0 ${round(box.w)} ${round(box.h)}`);
        }
    }
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // <use> pointing at symbols elsewhere on the page: bring them along. A symbol used without a
    // size fills the viewport (100%, the default the browser applies).
    for (const use of Array.from(clone.querySelectorAll("use"))) {
        const ref = (use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "").replace(/^#/, "");
        const target = ref ? (clone.querySelector(`#${CSS.escape(ref)}`) ?? document.getElementById(ref)) : null;
        if (target?.tagName.toLowerCase() === "symbol") {
            if (!use.getAttribute("width")) use.setAttribute("width", "100%");
            if (!use.getAttribute("height")) use.setAttribute("height", "100%");
        }
        if (ref && !clone.querySelector(`#${CSS.escape(ref)}`)) {
            const found = document.getElementById(ref);
            if (found) {
                let defs = clone.querySelector("defs");
                if (!defs) {
                    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                    clone.insertBefore(defs, clone.firstChild);
                }
                defs.appendChild(found.cloneNode(true));
            }
        }
    }
    return new XMLSerializer().serializeToString(clone);
}

function walkChildren(el: Element, ctx: Ctx): CaptureNode[] {
    const out: CaptureNode[] = [];
    const kids = childrenOf(el);
    // Which children run in the text's lines.
    const flags = kids.map((k) => inlineFlow(k));
    const alone = flags.every(Boolean);
    let group: Node[] = [];
    const flush = () => {
        if (!group.length) return;
        out.push(...inlineBoxes(group, ctx));
        const t = textNodeOf(group, el, ctx, alone);
        if (t) out.push(t);
        group = [];
    };
    kids.forEach((k, i) => {
        if (flags[i]) {
            group.push(k);
            return;
        }
        flush();
        if (k.nodeType === Node.ELEMENT_NODE) out.push(...walk(k as Element, ctx));
    });
    flush();
    return out;
}

function walk(el: Element, parentCtx: Ctx): CaptureNode[] {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return [];
    const cs = getComputedStyle(el);
    if (cs.display === "none") return [];
    if (cs.display === "contents") return walkChildren(el, parentCtx);
    const fixed = cs.position === "fixed";
    let ctx: Ctx = fixed ? { ...parentCtx, ox: 0, oy: 0 } : parentCtx;
    if (tag === "a" && (el as HTMLAnchorElement).href) ctx = { ...ctx, href: (el as HTMLAnchorElement).href };
    const r = el.getBoundingClientRect();
    const { angle, scale } = rotationOf(cs);
    const turned = Math.abs(angle) > 0.5 && el instanceof HTMLElement;
    const box = turned ? boxOf(ctx, r, { w: (el as HTMLElement).offsetWidth * scale, h: (el as HTMLElement).offsetHeight * scale }) : boxOf(ctx, r);
    if (box.w < 0.5 || box.h < 0.5) {
        // Nothing of its own to show; what overflows it still does.
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible" || REPLACED.has(tag)) return [];
        return walkChildren(el, ctx);
    }
    if (parseFloat(cs.opacity) === 0) return [];
    const hidden = cs.visibility !== "visible";
    let style = styleOf(el, cs, ctx, box);
    if (turned) style.rotation = round(angle);
    if (hidden) style = hiddenStyle(style);
    const node: CaptureNode = { tag, name: nameOf(el), box, style, children: [] };
    if (el.getAttribute("data-nagma-pseudo")) node.name = `::${el.getAttribute("data-nagma-pseudo")}`;
    if (fixed) node.scroll = "fixed";
    else if (cs.position === "sticky") node.scroll = "sticky";
    if (tag === "a" && ctx.href) node.href = ctx.href;
    const childCtx: Ctx = turned ? { ...ctx, turns: [...ctx.turns, { cx: box.x + box.w / 2, cy: box.y + box.h / 2, angle }] } : ctx;
    if (hidden) {
        node.children = walkChildren(el, childCtx);
        return node.children.length ? [node] : [];
    }
    if (tag === "img") {
        const img = el as HTMLImageElement;
        const asset = ctx.assets.add(img.currentSrc || img.src, box);
        if (asset) node.image = { asset, fit: cs.objectFit };
        return [node];
    }
    if (tag === "svg") {
        try {
            node.svg = serializeSvg(el as SVGSVGElement, box);
        } catch {
            node.image = { asset: ctx.assets.addScreenshot("svg", box), fit: "fill" };
        }
        return [node];
    }
    if (tag === "canvas") {
        try {
            node.image = { asset: ctx.assets.addData("canvas", (el as HTMLCanvasElement).toDataURL("image/png")), fit: "fill" };
        } catch {
            node.image = { asset: ctx.assets.addScreenshot("canvas", box), fit: "fill" };
            node.name = `${node.name} (bitmap)`;
        }
        return [node];
    }
    if (tag === "video") {
        const v = el as HTMLVideoElement;
        let asset: string | null = null;
        if (v.readyState >= 2 && v.videoWidth) {
            try {
                const c = document.createElement("canvas");
                c.width = v.videoWidth;
                c.height = v.videoHeight;
                c.getContext("2d")?.drawImage(v, 0, 0);
                asset = ctx.assets.addData("video frame", c.toDataURL("image/jpeg", 0.9));
            } catch {
                asset = null;
            }
        }
        if (!asset && v.poster) asset = ctx.assets.add(v.poster, box);
        if (!asset) {
            asset = ctx.assets.addScreenshot("video", box);
            node.name = `${node.name} (bitmap)`;
        }
        node.image = { asset, fit: cs.objectFit === "fill" ? "fill" : cs.objectFit };
        return [node];
    }
    if (SCREENSHOT_TAGS.has(tag)) {
        node.image = { asset: ctx.assets.addScreenshot(tag, box), fit: "fill" };
        node.name = `${node.name} (bitmap)`;
        return [node];
    }
    if (tag === "input" || tag === "textarea" || tag === "select") {
        formControl(el, cs, node, ctx);
        return [node];
    }
    if (cs.display === "list-item") {
        const marker = markerNode(el, cs, box, ctx);
        if (marker) node.children.push(marker);
    }
    node.children.push(...walkChildren(el, childCtx));
    return [node];
}

// ---- The page ----

function fontsOf(root: CaptureNode): CaptureFont[] {
    const used = new Map<string, { weights: Set<number>; styles: Set<string> }>();
    const note = (st: Partial<CaptureTextStyle>, base: CaptureTextStyle) => {
        const family = st.family ?? base.family;
        const e = used.get(family) ?? { weights: new Set(), styles: new Set() };
        e.weights.add(st.weight ?? base.weight);
        e.styles.add((st.italic ?? base.italic) ? "italic" : "normal");
        used.set(family, e);
    };
    const visit = (n: CaptureNode) => {
        if (n.text) {
            note({}, n.text.style);
            for (const r of n.text.runs) note(r.style, n.text.style);
        }
        n.children.forEach(visit);
    };
    visit(root);
    const sources = new Map<string, string[]>();
    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of Array.from(rules)) {
            if (!(rule instanceof CSSFontFaceRule)) continue;
            const family = rule.style.getPropertyValue("font-family").replace(/^["']|["']$/g, "");
            const urls = [...rule.style.getPropertyValue("src").matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => {
                try {
                    return new URL(m[1] as string, sheet.href ?? document.baseURI).href;
                } catch {
                    return m[1] as string;
                }
            });
            sources.set(family, [...(sources.get(family) ?? []), ...urls]);
        }
    }
    return [...used.entries()].map(([family, e]) => ({ family, weights: [...e.weights].sort((a, b) => a - b), styles: [...e.styles], ...(sources.get(family)?.length ? { sources: sources.get(family) } : {}) }));
}

function transparent(c: string): boolean {
    return !c || c === "transparent" || /^rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
}

async function readInPage(assets: Assets, budget: { left: number }, all: boolean): Promise<void> {
    const still: PendingAsset[] = [];
    await Promise.all(
        assets.pending.map(async (p) => {
            if (!p.url) {
                still.push(p);
                return;
            }
            const sameOrigin = p.url.startsWith(location.origin) || p.url.startsWith("blob:") || p.url.startsWith("data:");
            if (!sameOrigin && !all) {
                still.push(p);
                return;
            }
            try {
                const res = await fetch(p.url, { credentials: sameOrigin ? "same-origin" : "omit" });
                if (!res.ok) throw new Error(String(res.status));
                const blob = await res.blob();
                if (blob.size > budget.left) throw new Error("too large");
                budget.left -= blob.size;
                const data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
                const entry = assets.data[p.id];
                if (entry) entry.data = data;
            } catch {
                still.push(p);
            }
        }),
    );
    assets.pending = still;
}

export async function capturePage(options: CaptureOptions = {}): Promise<CaptureResult> {
    familyCache.clear();
    loadedFamilies = null;
    const assets = new Assets();
    const ctx: Ctx = { ox: window.scrollX, oy: window.scrollY, turns: [], assets };
    const undo = standInPseudos();
    let root: CaptureNode;
    let background: string;
    try {
        const htmlCs = getComputedStyle(document.documentElement);
        const bodyCs = getComputedStyle(document.body);
        // The root's background paints the whole canvas; without one, the body's does.
        const fromBody = transparent(htmlCs.backgroundColor) && !transparent(bodyCs.backgroundColor);
        background = fromBody ? bodyCs.backgroundColor : transparent(htmlCs.backgroundColor) ? "rgb(255, 255, 255)" : htmlCs.backgroundColor;
        const nodes = walk(document.body, ctx);
        root = nodes[0] ?? { tag: "body", name: "Body", box: { x: 0, y: 0, w: document.documentElement.clientWidth, h: 1 }, style: emptyStyle(), children: [] };
        if (fromBody) root.style.backgroundColor = "rgba(0, 0, 0, 0)";
    } finally {
        undo();
    }
    const budget = { left: options.maxAssetBytes ?? 40 * 1024 * 1024 };
    await readInPage(assets, budget, Boolean(options.inlineAssets));
    const doc = document.documentElement;
    const capture: Capture = {
        format: "nagma-capture",
        version: 1,
        title: document.title,
        url: location.href,
        capturedAt: new Date().toISOString(),
        viewport: { w: doc.clientWidth, h: window.innerHeight },
        scroll: { w: Math.max(doc.scrollWidth, document.body.scrollWidth), h: Math.max(doc.scrollHeight, document.body.scrollHeight) },
        dpr: window.devicePixelRatio || 1,
        background,
        root,
        assets: assets.data,
        fonts: fontsOf(root),
    };
    return { capture, pending: assets.pending };
}

(globalThis as unknown as { __nagmaCapture: typeof capturePage }).__nagmaCapture = capturePage;
