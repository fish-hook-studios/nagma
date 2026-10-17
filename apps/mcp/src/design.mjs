// Reading a Nagma document: compact layer outlines, code for a layer, its variables and styles, and
// an SVG picture of it. Layers keep page coordinates; a child's place in its parent is the difference.

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function hexAlpha(hex, opacity = 1) {
    const h = String(hex ?? "#000000").replace("#", "");
    const full = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.slice(0, 6);
    const n = parseInt(full || "0", 16);
    const a = (h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1) * (opacity ?? 1);
    if (a >= 0.999) return `#${full.toUpperCase()}`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${round(a)})`;
}

const visible = (paints) => (paints ?? []).filter((p) => p && p.visible !== false);

function paintCss(p) {
    if (p.type === "solid") return hexAlpha(p.color, p.opacity);
    if (["linear", "radial", "angular", "diamond"].includes(p.type)) {
        const stops = (p.stops ?? []).map((s) => `${hexAlpha(s.color, (s.opacity ?? 1) * (p.opacity ?? 1))} ${round(s.position * 100)}%`).join(", ");
        if (p.type === "linear") {
            const angle = p.from && p.to ? Math.round((Math.atan2(p.to.y - p.from.y, p.to.x - p.from.x) * 180) / Math.PI + 90) : 180;
            return `linear-gradient(${angle}deg, ${stops})`;
        }
        if (p.type === "angular") return `conic-gradient(${stops})`;
        return `radial-gradient(${stops})`;
    }
    return null;
}

// A one-line description of a layer, for outlines.
function describe(node) {
    const bits = [`${node.type}`, `"${node.name}"`, `id=${node.id}`, `${round(node.w)}×${round(node.h)}`];
    if (node.type === "text" && node.text) bits.push(`text=${JSON.stringify(String(node.text).slice(0, 80))}`);
    if (node.componentId) bits.push(`instanceOf=${node.componentId}`);
    if (node.layout) bits.push(`autoLayout=${node.layout.direction}`);
    if (node.visible === false) bits.push("hidden");
    if (node.devStatus) bits.push(`status=${node.devStatus}`);
    return bits.join(" ");
}

export function outline(doc, rootId, depth = 3) {
    const lines = [];
    const walk = (id, level) => {
        const node = doc.nodes[id];
        if (!node) return;
        lines.push(`${"  ".repeat(level)}${describe(node)}`);
        if (level >= depth) {
            if (node.children?.length) lines.push(`${"  ".repeat(level + 1)}… ${node.children.length} more layers`);
            return;
        }
        for (const c of node.children ?? []) walk(c, level + 1);
    };
    walk(rootId, 0);
    return lines.join("\n");
}

export function fileSummary(doc) {
    const pages = (doc.roots ?? []).map((id) => doc.nodes[id]).filter(Boolean);
    const counts = {};
    for (const n of Object.values(doc.nodes ?? {})) counts[n.type] = (counts[n.type] ?? 0) + 1;
    return {
        name: doc.name ?? "Untitled",
        pages: pages.map((p) => ({ id: p.id, name: p.name, frames: (p.children ?? []).map((id) => doc.nodes[id]).filter(Boolean).map((n) => ({ id: n.id, name: n.name, type: n.type, width: round(n.w), height: round(n.h) })) })),
        layerCounts: counts,
        components: Object.values(doc.nodes ?? {}).filter((n) => n.type === "component").map((n) => ({ id: n.id, name: n.name, description: n.description ?? "" })),
        variableCollections: (doc.variables ?? []).length,
    };
}

// A layer's own properties, without the bookkeeping, in the units a developer reads.
export function nodeDetails(doc, node) {
    const parent = node.parentId ? doc.nodes[node.parentId] : null;
    const rel = parent && parent.type !== "page" ? { x: round(node.x - parent.x), y: round(node.y - parent.y) } : { x: round(node.x), y: round(node.y) };
    const out = { id: node.id, name: node.name, type: node.type, ...rel, width: round(node.w), height: round(node.h) };
    if (node.rotation) out.rotation = round(node.rotation);
    if (node.opacity != null && node.opacity !== 1) out.opacity = round(node.opacity);
    if (visible(node.fills).length) out.fills = visible(node.fills).map((p) => paintCss(p) ?? `${p.type} paint`);
    if (visible(node.strokes).length) out.strokes = { paints: visible(node.strokes).map((p) => paintCss(p) ?? p.type), weight: node.strokeWidth, align: node.strokeAlign };
    if (node.radii) out.cornerRadii = node.radii;
    else if (node.radius) out.cornerRadius = node.radius;
    if (node.layout) out.autoLayout = node.layout;
    if (node.sizing) out.sizing = node.sizing;
    if (node.type === "text") Object.assign(out, { text: node.text, fontFamily: node.fontFamily ?? "Inter", fontSize: node.fontSize, fontWeight: node.fontWeight, textAlign: node.textAlign, lineHeight: node.lineHeight ?? null, letterSpacing: node.letterSpacing ?? 0 });
    if (node.effects?.length) out.effects = node.effects;
    if (node.boundVariables) out.boundVariables = node.boundVariables;
    if (node.componentId) out.mainComponent = node.componentId;
    if (node.description) out.description = node.description;
    if (node.codeConnect) out.codeConnect = node.codeConnect;
    if (node.devResources?.length) out.devResources = node.devResources;
    if (node.annotations?.length) out.annotations = node.annotations.map((a) => a.label ?? a.text ?? "");
    if (node.children?.length) out.children = node.children;
    return out;
}

// ---- Code ----------------------------------------------------------------------------------------

const ALIGN = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly", baseline: "baseline" };

function styleOf(doc, node, inFlow) {
    const s = {};
    const parent = node.parentId ? doc.nodes[node.parentId] : null;
    if (!inFlow && parent && parent.type !== "page") {
        s.position = "absolute";
        s.left = round(node.x - parent.x);
        s.top = round(node.y - parent.y);
    }
    const sizing = node.sizing ?? {};
    if (sizing.h === "fill") s.flex = 1;
    else if (sizing.h !== "hug" && node.type !== "text") s.width = round(node.w);
    if (sizing.v === "fill" && !s.flex) s.alignSelf = "stretch";
    else if (sizing.v !== "hug" && node.type !== "text") s.height = round(node.h);
    if (node.type === "text" && sizing.h === "fixed") s.width = round(node.w);
    const fill = visible(node.fills)[0];
    if (fill) {
        const css = paintCss(fill);
        if (node.type === "text") s.color = css;
        else if (css) s.background = css;
    }
    const stroke = visible(node.strokes)[0];
    if (stroke && node.strokeWidth > 0 && node.type !== "text") s.border = `${round(node.strokeWidth)}px solid ${paintCss(stroke)}`;
    if (node.type === "ellipse") s.borderRadius = "50%";
    else if (node.radii) s.borderRadius = node.radii.map((r) => `${round(r)}px`).join(" ");
    else if (node.radius) s.borderRadius = round(node.radius);
    if (node.opacity != null && node.opacity !== 1) s.opacity = round(node.opacity);
    if (node.rotation) s.transform = `rotate(${round(-node.rotation)}deg)`;
    const shadow = node.shadow ?? (node.effects ?? []).find((e) => e.type === "drop-shadow");
    if (shadow) s.boxShadow = `${round(shadow.x)}px ${round(shadow.y)}px ${round(shadow.blur)}px ${hexAlpha(shadow.color, shadow.opacity)}`;
    if (node.layout) {
        const l = node.layout;
        s.display = "flex";
        s.flexDirection = l.direction === "horizontal" ? "row" : "column";
        if (l.gap) s.gap = round(l.gap);
        const [t, r, b, lft] = l.padding ?? [0, 0, 0, 0];
        if (t || r || b || lft) s.padding = `${round(t)}px ${round(r)}px ${round(b)}px ${round(lft)}px`;
        if (l.primary && l.primary !== "start") s.justifyContent = ALIGN[l.primary];
        if (l.counter && l.counter !== "start") s.alignItems = ALIGN[l.counter];
        if (l.wrap) s.flexWrap = "wrap";
    } else if (node.children?.length && node.type !== "page") s.position = s.position ?? "relative";
    if (node.clip && node.children?.length) s.overflow = "hidden";
    if (node.type === "text") {
        if (node.fontFamily) s.fontFamily = `'${node.fontFamily}'`;
        if (node.fontSize) s.fontSize = round(node.fontSize);
        if (node.fontWeight && node.fontWeight !== 400) s.fontWeight = node.fontWeight;
        if (node.italic) s.fontStyle = "italic";
        if (node.textAlign && node.textAlign !== "left") s.textAlign = node.textAlign;
        if (node.lineHeight) s.lineHeight = node.lineHeight;
        if (node.letterSpacing) s.letterSpacing = round(node.letterSpacing);
    }
    return s;
}

const cssName = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const cssValue = (k, v) => (typeof v === "number" && !["opacity", "fontWeight", "flex", "lineHeight"].includes(k) ? `${v}px` : String(v));
const escape = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
const component = (name) => (String(name).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^[^A-Za-z]+/, "") || "Layer").replace(/^./, (c) => c.toUpperCase());

// React (JSX with inline styles), HTML with a stylesheet, or CSS alone for a layer and its children.
export function codeFor(doc, rootId, language = "react") {
    const root = doc.nodes[rootId];
    if (!root) throw new Error("No such layer.");
    const classes = [];
    const render = (id, indent, inFlow) => {
        const node = doc.nodes[id];
        if (!node || node.visible === false) return "";
        const style = styleOf(doc, node, inFlow);
        const pad = "  ".repeat(indent);
        const kids = node.children ?? [];
        const childFlow = Boolean(node.layout) && !node.layout?.grid;
        const inner = node.type === "text" ? escape(node.text) : kids.map((c) => render(c, indent + 1, childFlow && doc.nodes[c]?.positioning !== "absolute")).filter(Boolean).join("\n");
        const tag = node.type === "text" ? (node.fontSize >= 24 ? "h2" : "p") : "div";
        // A layer connected to a code component (Code Connect) names it.
        const connected = node.codeConnect?.[0] ?? (node.componentId ? doc.nodes[node.componentId]?.codeConnect?.[0] : undefined);
        const note = connected && language === "react" ? `${pad}{/* Code component: ${connected.name}${connected.source ? ` (${connected.source})` : ""} */}\n` : "";
        if (language === "react") {
            const props = Object.entries(style)
                .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`)
                .join(", ");
            const open = `${pad}<${tag} data-layer=${JSON.stringify(node.name)} style={{ ${props} }}>`;
            if (!inner) return `${note}${open.replace(/>$/, " />")}`;
            return node.type === "text" ? `${note}${open}${inner}</${tag}>` : `${note}${open}\n${inner}\n${pad}</${tag}>`;
        }
        const cls = `${component(node.name).replace(/^./, (c) => c.toLowerCase())}-${classes.length + 1}`;
        classes.push(`.${cls} {\n${Object.entries(style)
            .map(([k, v]) => `  ${cssName(k)}: ${cssValue(k, v)};`)
            .join("\n")}\n}`);
        if (!inner) return `${pad}<${tag} class="${cls}"></${tag}>`;
        return node.type === "text" ? `${pad}<${tag} class="${cls}">${inner}</${tag}>` : `${pad}<${tag} class="${cls}">\n${inner}\n${pad}</${tag}>`;
    };
    if (language === "react") {
        const body = render(rootId, 2, true);
        return `export function ${component(root.name)}() {\n  return (\n${body}\n  );\n}\n`;
    }
    const html = render(rootId, 0, true);
    if (language === "css") return classes.join("\n\n");
    return `<style>\n${classes.join("\n\n")}\n</style>\n${html}\n`;
}

// ---- Variables and styles -------------------------------------------------------------------------

export function variablesFor(doc, rootId) {
    const used = new Set();
    if (rootId) {
        const walk = (id) => {
            const n = doc.nodes[id];
            if (!n) return;
            for (const v of Object.values(n.boundVariables ?? {})) {
                if (typeof v === "string") used.add(v);
                else if (v && typeof v === "object") for (const x of Object.values(v)) if (typeof x === "string") used.add(x);
            }
            for (const p of [...(n.fills ?? []), ...(n.strokes ?? [])]) if (p?.variableId) used.add(p.variableId);
            (n.children ?? []).forEach(walk);
        };
        walk(rootId);
    }
    const collections = (doc.variables ?? []).map((c) => ({
        name: c.name,
        modes: c.modes.map((m) => m.name),
        variables: c.variables
            .filter((v) => !rootId || used.has(v.id))
            .map((v) => ({ name: v.name, type: v.type, values: Object.fromEntries(c.modes.map((m) => [m.name, v.values?.[m.id] ?? null])), codeSyntax: v.codeSyntax ?? null, description: v.description ?? "" })),
    }));
    const styles = doc.styles ?? {};
    return {
        collections: collections.filter((c) => c.variables.length || !rootId),
        styles: {
            colors: (styles.colors ?? []).map((s) => ({ name: s.name, paints: (s.paints ?? []).map((p) => paintCss(p) ?? p.type) })),
            texts: (styles.texts ?? []).map((s) => ({ name: s.name, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight ?? null })),
            effects: (styles.effects ?? []).map((s) => ({ name: s.name })),
        },
    };
}

// ---- Picture --------------------------------------------------------------------------------------

function pathData(node) {
    const path = node.path;
    if (!path?.subpaths) return "";
    const sx = path.w > 0 ? node.w / path.w : 1;
    const sy = path.h > 0 ? node.h / path.h : 1;
    const P = (q) => `${round(node.x + q.x * sx)} ${round(node.y + q.y * sy)}`;
    return path.subpaths
        .map((sub) => {
            const pts = sub.points ?? [];
            if (!pts.length) return "";
            let d = `M${P(pts[0])}`;
            const count = sub.closed ? pts.length : pts.length - 1;
            for (let i = 0; i < count; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % pts.length];
                d += !a.out && !b.in ? ` L${P(b)}` : ` C${P(a.out ?? a)} ${P(b.in ?? b)} ${P(b)}`;
            }
            return sub.closed ? `${d} Z` : d;
        })
        .join(" ");
}

// An SVG of a layer: shapes, text, vector paths and image fills (from the file's images).
export function svgFor(doc, rootId, images = doc.images ?? {}) {
    const root = doc.nodes[rootId];
    if (!root) throw new Error("No such layer.");
    const defs = [];
    let clipSeq = 0;
    const svgPaint = (p) => (p.type === "solid" ? hexAlpha(p.color, p.opacity) : (p.stops?.[0]?.color ?? "#CCCCCC"));
    const draw = (id) => {
        const node = doc.nodes[id];
        if (!node || node.visible === false) return "";
        const parts = [];
        const op = node.opacity != null && node.opacity !== 1 ? ` opacity="${round(node.opacity)}"` : "";
        const rot = node.rotation ? ` transform="rotate(${round(-node.rotation)} ${round(node.x + node.w / 2)} ${round(node.y + node.h / 2)})"` : "";
        const stroke = visible(node.strokes)[0];
        const strokeAttr = stroke && node.strokeWidth > 0 ? ` stroke="${svgPaint(stroke)}" stroke-width="${round(node.strokeWidth)}"` : "";
        for (const p of visible(node.fills)) {
            if (node.type === "text") continue;
            if (p.type === "image") {
                const href = images[p.id];
                if (href) parts.push(`<image href="${href}" x="${round(node.x)}" y="${round(node.y)}" width="${round(node.w)}" height="${round(node.h)}" preserveAspectRatio="xMidYMid slice"/>`);
                continue;
            }
            const fill = ` fill="${svgPaint(p)}"`;
            if (node.type === "ellipse") parts.push(`<ellipse cx="${round(node.x + node.w / 2)}" cy="${round(node.y + node.h / 2)}" rx="${round(node.w / 2)}" ry="${round(node.h / 2)}"${fill}/>`);
            else if (node.type === "vector") parts.push(`<path d="${pathData(node)}"${fill}/>`);
            else if (node.type !== "group" && node.type !== "page") parts.push(`<rect x="${round(node.x)}" y="${round(node.y)}" width="${round(node.w)}" height="${round(node.h)}" rx="${round(Math.min(node.radius ?? 0, node.w / 2, node.h / 2))}"${fill}/>`);
        }
        if (strokeAttr && node.type !== "text") {
            if (node.type === "ellipse") parts.push(`<ellipse cx="${round(node.x + node.w / 2)}" cy="${round(node.y + node.h / 2)}" rx="${round(node.w / 2)}" ry="${round(node.h / 2)}" fill="none"${strokeAttr}/>`);
            else if (node.type === "vector") parts.push(`<path d="${pathData(node)}" fill="none"${strokeAttr}/>`);
            else if (node.type !== "group") parts.push(`<rect x="${round(node.x)}" y="${round(node.y)}" width="${round(node.w)}" height="${round(node.h)}" rx="${round(node.radius ?? 0)}" fill="none"${strokeAttr}/>`);
        }
        if (node.type === "text") {
            const fill = visible(node.fills)[0];
            const size = node.fontSize ?? 12;
            const lines = String(node.text ?? "").split("\n");
            const anchor = node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : "start";
            const x = anchor === "middle" ? node.x + node.w / 2 : anchor === "end" ? node.x + node.w : node.x;
            const lh = (node.lineHeight ?? 1.21) * size;
            parts.push(`<text x="${round(x)}" y="${round(node.y + size)}" font-family="${node.fontFamily ?? "Inter"}, sans-serif" font-size="${round(size)}" font-weight="${node.fontWeight ?? 400}" text-anchor="${anchor}" fill="${fill ? svgPaint(fill) : "#000000"}">${lines.map((l, i) => `<tspan x="${round(x)}" dy="${i ? round(lh) : 0}">${escape(l)}</tspan>`).join("")}</text>`);
        }
        let kids = (node.children ?? []).map(draw).join("");
        if (kids && node.clip && node.type !== "group") {
            const cid = `c${++clipSeq}`;
            defs.push(`<clipPath id="${cid}"><rect x="${round(node.x)}" y="${round(node.y)}" width="${round(node.w)}" height="${round(node.h)}" rx="${round(node.radius ?? 0)}"/></clipPath>`);
            kids = `<g clip-path="url(#${cid})">${kids}</g>`;
        }
        return `<g data-name="${escape(node.name)}"${op}${rot}>${parts.join("")}${kids}</g>`;
    };
    const body = draw(rootId);
    const box = root.type === "page" ? pageBox(doc, root) : { x: root.x, y: root.y, w: root.w, h: root.h };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(box.w)}" height="${round(box.h)}" viewBox="${round(box.x)} ${round(box.y)} ${round(box.w)} ${round(box.h)}"><defs>${defs.join("")}</defs>${body}</svg>`;
}

function pageBox(doc, page) {
    const kids = (page.children ?? []).map((id) => doc.nodes[id]).filter(Boolean);
    if (!kids.length) return { x: 0, y: 0, w: 100, h: 100 };
    const x = Math.min(...kids.map((n) => n.x));
    const y = Math.min(...kids.map((n) => n.y));
    return { x, y, w: Math.max(...kids.map((n) => n.x + n.w)) - x, h: Math.max(...kids.map((n) => n.y + n.h)) - y };
}
