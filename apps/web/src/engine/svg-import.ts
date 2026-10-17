import { booleanPaths } from "./clip";
import { frameAt, makeNode } from "./nodes";
import { solid } from "./paint";
import { editor } from "./store";
import { apply as applyMatrix, spaceMatrix } from "./transform";
import type { Command, GradientPaint, NagmaDocument, Paint, PathPoint, SceneNode, Subpath } from "./types";
import { fitPath, mapSubpaths, pathBounds } from "./vector";

// SVG import (files, drops and pasted SVG text) into editable layers: a frame the size of the SVG
// holding groups, vectors (paths and transformed shapes), rectangles, ellipses, text and images,
// with fills (solid and gradients), strokes (weight, caps, joins, dashes), opacity and fill rules.

type Pt = { x: number; y: number };
type M = DOMMatrix;

interface Style {
    fill: string | null;
    fillOpacity: number;
    fillRule: "nonzero" | "evenodd";
    stroke: string | null;
    strokeOpacity: number;
    strokeWidth: number;
    strokeCap: "butt" | "round" | "square";
    strokeJoin: "miter" | "round" | "bevel";
    dash: [number, number] | null;
    opacity: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    fontStyle: string;
    textAnchor: string;
    display: boolean;
    color: string;
}

const DEFAULT_STYLE: Style = {
    fill: "#000000",
    fillOpacity: 1,
    fillRule: "nonzero",
    stroke: null,
    strokeOpacity: 1,
    strokeWidth: 1,
    strokeCap: "butt",
    strokeJoin: "miter",
    dash: null,
    opacity: 1,
    fontSize: 16,
    fontFamily: "Inter",
    fontWeight: 400,
    fontStyle: "normal",
    textAnchor: "start",
    display: true,
    color: "#000000",
};

const NAMED: Record<string, string> = {
    black: "#000000", white: "#FFFFFF", red: "#FF0000", green: "#008000", blue: "#0000FF", yellow: "#FFFF00", orange: "#FFA500", purple: "#800080",
    gray: "#808080", grey: "#808080", silver: "#C0C0C0", maroon: "#800000", olive: "#808000", lime: "#00FF00", aqua: "#00FFFF", cyan: "#00FFFF",
    teal: "#008080", navy: "#000080", fuchsia: "#FF00FF", magenta: "#FF00FF", pink: "#FFC0CB", brown: "#A52A2A", gold: "#FFD700", indigo: "#4B0082",
    violet: "#EE82EE", coral: "#FF7F50", salmon: "#FA8072", tomato: "#FF6347", crimson: "#DC143C", darkgray: "#A9A9A9", darkgrey: "#A9A9A9",
    lightgray: "#D3D3D3", lightgrey: "#D3D3D3", gainsboro: "#DCDCDC", whitesmoke: "#F5F5F5", transparent: "#000000",
};

function hex2(n: number): string {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
}

// A CSS colour as hex plus alpha, or null for none.
export function parseColor(value: string, current = "#000000"): { hex: string; alpha: number } | null {
    const v = value.trim().toLowerCase();
    if (!v || v === "none") return null;
    if (v === "transparent") return { hex: "#000000", alpha: 0 };
    if (v === "currentcolor") return parseColor(current);
    if (v.startsWith("#")) {
        const h = v.slice(1);
        if (h.length === 3 || h.length === 4) {
            const [r, g, b, a] = h.split("").map((c) => parseInt(c + c, 16));
            return { hex: `#${hex2(r ?? 0)}${hex2(g ?? 0)}${hex2(b ?? 0)}`, alpha: a === undefined ? 1 : a / 255 };
        }
        if (h.length === 6 || h.length === 8) {
            const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
            return { hex: `#${h.slice(0, 6).toUpperCase()}`, alpha: h.length === 8 ? n(6) / 255 : 1 };
        }
        return null;
    }
    const rgb = v.match(/^rgba?\(([^)]+)\)$/);
    if (rgb) {
        const parts = (rgb[1] ?? "").split(/[\s,/]+/).filter(Boolean);
        const ch = (s: string | undefined) => (s?.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s ?? "0"));
        const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        return { hex: `#${hex2(ch(parts[0]))}${hex2(ch(parts[1]))}${hex2(ch(parts[2]))}`, alpha: Number.isFinite(a) ? a : 1 };
    }
    const hsl = v.match(/^hsla?\(([^)]+)\)$/);
    if (hsl) {
        const parts = (hsl[1] ?? "").split(/[\s,/]+/).filter(Boolean);
        const h = (parseFloat(parts[0] ?? "0") % 360) / 360;
        const s = parseFloat(parts[1] ?? "0") / 100;
        const l = parseFloat(parts[2] ?? "0") / 100;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const t = (x: number) => {
            const k = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
            return k < 1 / 6 ? p + (q - p) * 6 * k : k < 1 / 2 ? q : k < 2 / 3 ? p + (q - p) * (2 / 3 - k) * 6 : p;
        };
        const a = parts[3] === undefined ? 1 : parseFloat(parts[3]);
        return { hex: `#${hex2(t(h + 1 / 3) * 255)}${hex2(t(h) * 255)}${hex2(t(h - 1 / 3) * 255)}`, alpha: a };
    }
    const named = NAMED[v];
    return named ? { hex: named, alpha: v === "transparent" ? 0 : 1 } : null;
}

function num(v: string | null | undefined, fallback = 0): number {
    if (v === null || v === undefined) return fallback;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}

// A length that may be a percentage of a reference size.
function len(v: string | null, ref: number, fallback = 0): number {
    if (v === null) return fallback;
    if (v.trim().endsWith("%")) return (parseFloat(v) / 100) * ref;
    return num(v, fallback);
}

// SVG transform attribute → matrix.
export function parseTransform(value: string | null): M {
    let m = new DOMMatrix();
    if (!value) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value))) {
        const args = (match[2] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
        const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
        switch (match[1]) {
            case "matrix":
                m = m.multiply(new DOMMatrix([a, b, c, d, e, f]));
                break;
            case "translate":
                m = m.translate(a, args.length > 1 ? b : 0);
                break;
            case "scale":
                m = m.scale(a, args.length > 1 ? b : a);
                break;
            case "rotate":
                m = args.length > 1 ? m.translate(b, c).rotate(a).translate(-b, -c) : m.rotate(a);
                break;
            case "skewX":
                m = m.skewX(a);
                break;
            case "skewY":
                m = m.skewY(a);
                break;
        }
    }
    return m;
}

// Path data → subpaths (absolute coordinates, cubic handles).
export function parsePathData(d: string): Subpath[] {
    const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
    const subs: Subpath[] = [];
    let i = 0;
    let cmd = "";
    let cur: Pt = { x: 0, y: 0 };
    let start: Pt = { x: 0, y: 0 };
    let sub: Subpath | null = null;
    let lastCubic: Pt | null = null;
    let lastQuad: Pt | null = null;
    const isCmd = (t: string | undefined) => t !== undefined && /^[a-zA-Z]$/.test(t);
    const next = () => parseFloat(tokens[i++] ?? "0");
    const begin = (p: Pt) => {
        sub = { closed: false, points: [{ x: p.x, y: p.y, in: null, out: null }] };
        subs.push(sub);
        start = p;
    };
    const ensure = () => {
        if (!sub) begin(cur);
        return sub as Subpath;
    };
    const lineTo = (p: Pt) => {
        ensure().points.push({ x: p.x, y: p.y, in: null, out: null });
        cur = p;
    };
    const cubicTo = (c1: Pt, c2: Pt, p: Pt) => {
        const s = ensure();
        const last = s.points[s.points.length - 1] as PathPoint;
        last.out = { ...c1 };
        s.points.push({ x: p.x, y: p.y, in: { ...c2 }, out: null });
        cur = p;
    };
    while (i < tokens.length) {
        if (isCmd(tokens[i])) cmd = tokens[i++] as string;
        else if (!cmd) {
            i++;
            continue;
        }
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        const off = (p: Pt): Pt => (rel ? { x: p.x + cur.x, y: p.y + cur.y } : p);
        let quad: Pt | null = null;
        let cubic: Pt | null = null;
        switch (C) {
            case "M": {
                const p = off({ x: next(), y: next() });
                cur = p;
                begin(p);
                // Further pairs are line-tos.
                cmd = rel ? "l" : "L";
                break;
            }
            case "L":
                lineTo(off({ x: next(), y: next() }));
                break;
            case "H": {
                const x = next();
                lineTo({ x: rel ? cur.x + x : x, y: cur.y });
                break;
            }
            case "V": {
                const y = next();
                lineTo({ x: cur.x, y: rel ? cur.y + y : y });
                break;
            }
            case "C": {
                const c1 = off({ x: next(), y: next() });
                const c2 = off({ x: next(), y: next() });
                const p = off({ x: next(), y: next() });
                cubicTo(c1, c2, p);
                cubic = c2;
                break;
            }
            case "S": {
                const c1 = lastCubic ? { x: 2 * cur.x - lastCubic.x, y: 2 * cur.y - lastCubic.y } : { ...cur };
                const c2 = off({ x: next(), y: next() });
                const p = off({ x: next(), y: next() });
                cubicTo(c1, c2, p);
                cubic = c2;
                break;
            }
            case "Q": {
                const q = off({ x: next(), y: next() });
                const p = off({ x: next(), y: next() });
                cubicTo({ x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
                quad = q;
                break;
            }
            case "T": {
                const q: Pt = lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : { ...cur };
                const p = off({ x: next(), y: next() });
                cubicTo({ x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
                quad = q;
                break;
            }
            case "A": {
                const rx = Math.abs(next());
                const ry = Math.abs(next());
                const rot = next();
                const large = next() !== 0;
                const sweep = next() !== 0;
                const p = off({ x: next(), y: next() });
                for (const [c1, c2, q] of arcToCubics(cur, p, rx, ry, rot, large, sweep)) cubicTo(c1, c2, q);
                if (!rx || !ry) lineTo(p);
                cur = p;
                break;
            }
            case "Z": {
                const s = sub as Subpath | null;
                if (s) {
                    s.closed = true;
                    // A last point on top of the first merges into it.
                    const first = s.points[0] as PathPoint;
                    const last = s.points[s.points.length - 1] as PathPoint;
                    if (s.points.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
                        first.in = last.in;
                        s.points.pop();
                    }
                }
                cur = start;
                sub = null;
                break;
            }
            default:
                i++;
        }
        lastCubic = cubic;
        lastQuad = quad;
    }
    return subs.filter((s) => s.points.length > 1 || s.closed);
}

// An elliptical arc as cubic segments (the SVG arc parameterisation, ≤ 90° per cubic).
function arcToCubics(p0: Pt, p1: Pt, rxIn: number, ryIn: number, angle: number, large: boolean, sweep: boolean): [Pt, Pt, Pt][] {
    if (!rxIn || !ryIn || (p0.x === p1.x && p0.y === p1.y)) return [];
    const phi = (angle * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (p0.x - p1.x) / 2;
    const dy = (p0.y - p1.y) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    let rx = rxIn;
    let ry = ryIn;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }
    const sign = large === sweep ? -1 : 1;
    const numer = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const coef = sign * Math.sqrt(Math.max(0, numer / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cx1 = (coef * rx * y1) / ry;
    const cy1 = (-coef * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2;
    const cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
        const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        return a;
    };
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= Math.PI * 2;
    if (sweep && dt < 0) dt += Math.PI * 2;
    const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
    const step = dt / segs;
    const k = (4 / 3) * Math.tan(step / 4);
    const at = (t: number): Pt => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
    const deriv = (t: number): Pt => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
    const out: [Pt, Pt, Pt][] = [];
    for (let s = 0; s < segs; s++) {
        const a = t1 + step * s;
        const b = a + step;
        const pa = at(a);
        const pb = s === segs - 1 ? p1 : at(b);
        const da = deriv(a);
        const db = deriv(b);
        out.push([{ x: pa.x + k * da.x, y: pa.y + k * da.y }, { x: pb.x - k * db.x, y: pb.y - k * db.y }, pb]);
    }
    return out;
}

const K = 0.5522847498;

function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath {
    const P = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): PathPoint => ({ x, y, in: { x: x + ix, y: y + iy }, out: { x: x + ox, y: y + oy } });
    return {
        closed: true,
        points: [
            P(cx, cy - ry, -rx * K, 0, rx * K, 0),
            P(cx + rx, cy, 0, -ry * K, 0, ry * K),
            P(cx, cy + ry, rx * K, 0, -rx * K, 0),
            P(cx - rx, cy, 0, ry * K, 0, -ry * K),
        ],
    };
}

function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): Subpath {
    if (rx <= 0 || ry <= 0) {
        const c = (px: number, py: number): PathPoint => ({ x: px, y: py, in: null, out: null });
        return { closed: true, points: [c(x, y), c(x + w, y), c(x + w, y + h), c(x, y + h)] };
    }
    rx = Math.min(rx, w / 2);
    ry = Math.min(ry, h / 2);
    const kx = rx * K;
    const ky = ry * K;
    const pts: PathPoint[] = [
        { x: x + rx, y, in: { x: x + rx - kx, y }, out: null },
        { x: x + w - rx, y, in: null, out: { x: x + w - rx + kx, y } },
        { x: x + w, y: y + ry, in: { x: x + w, y: y + ry - ky }, out: null },
        { x: x + w, y: y + h - ry, in: null, out: { x: x + w, y: y + h - ry + ky } },
        { x: x + w - rx, y: y + h, in: { x: x + w - rx + kx, y: y + h }, out: null },
        { x: x + rx, y: y + h, in: null, out: { x: x + rx - kx, y: y + h } },
        { x, y: y + h - ry, in: { x, y: y + h - ry + ky }, out: null },
        { x, y: y + ry, in: null, out: { x, y: y + ry - ky } },
    ];
    return { closed: true, points: pts };
}

// Simple CSS rules from <style> blocks: class, id, element and comma lists (no combinators).
function readCss(root: Element): { selector: string; decls: Record<string, string> }[] {
    const rules: { selector: string; decls: Record<string, string> }[] = [];
    for (const style of Array.from(root.querySelectorAll("style"))) {
        const text = (style.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
        const re = /([^{}]+)\{([^}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
            const decls = parseDecls(m[2] ?? "");
            for (const sel of (m[1] ?? "").split(",")) rules.push({ selector: sel.trim(), decls });
        }
    }
    return rules;
}

function parseDecls(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of text.split(";")) {
        const at = part.indexOf(":");
        if (at < 0) continue;
        out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
    return out;
}

const STYLE_PROPS = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "font-size", "font-family", "font-weight", "font-style", "text-anchor", "display", "visibility", "color"];

interface Ctx {
    css: { selector: string; decls: Record<string, string> }[];
    defs: Map<string, Element>;
    doc: NagmaDocument;
    commands: Command[];
    parentId: string;
    origin: Pt;
    viewport: { w: number; h: number };
}

function declsOf(el: Element, ctx: Ctx): Record<string, string> {
    const out: Record<string, string> = {};
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    for (const rule of ctx.css) {
        const sel = rule.selector;
        const hit = sel === el.tagName || (sel.startsWith(".") && classes.includes(sel.slice(1))) || (sel.startsWith("#") && el.getAttribute("id") === sel.slice(1)) || sel === "*";
        if (hit) Object.assign(out, rule.decls);
    }
    for (const prop of STYLE_PROPS) {
        const v = el.getAttribute(prop);
        if (v !== null) out[prop] = v;
    }
    Object.assign(out, parseDecls(el.getAttribute("style") ?? ""));
    return out;
}

function styleOf(el: Element, parent: Style, ctx: Ctx): Style {
    const d = declsOf(el, ctx);
    const s: Style = { ...parent, opacity: 1 };
    if (d.color) s.color = d.color;
    if (d.fill !== undefined) s.fill = d.fill;
    if (d["fill-opacity"] !== undefined) s.fillOpacity = num(d["fill-opacity"], 1);
    if (d["fill-rule"]) s.fillRule = d["fill-rule"] === "evenodd" ? "evenodd" : "nonzero";
    if (d.stroke !== undefined) s.stroke = d.stroke;
    if (d["stroke-opacity"] !== undefined) s.strokeOpacity = num(d["stroke-opacity"], 1);
    if (d["stroke-width"] !== undefined) s.strokeWidth = num(d["stroke-width"], 1);
    if (d["stroke-linecap"]) s.strokeCap = (["butt", "round", "square"].includes(d["stroke-linecap"]) ? d["stroke-linecap"] : "butt") as Style["strokeCap"];
    if (d["stroke-linejoin"]) s.strokeJoin = (["miter", "round", "bevel"].includes(d["stroke-linejoin"]) ? d["stroke-linejoin"] : "miter") as Style["strokeJoin"];
    if (d["stroke-dasharray"] !== undefined) {
        const parts = d["stroke-dasharray"].split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
        s.dash = d["stroke-dasharray"] === "none" || !parts.length ? null : [parts[0] ?? 0, parts[1] ?? parts[0] ?? 0];
    }
    if (d.opacity !== undefined) s.opacity = num(d.opacity, 1);
    if (d["font-size"]) s.fontSize = num(d["font-size"], 16);
    if (d["font-family"]) s.fontFamily = (d["font-family"].split(",")[0] ?? "Inter").replace(/["']/g, "").trim() || "Inter";
    if (d["font-weight"]) s.fontWeight = d["font-weight"] === "bold" ? 700 : d["font-weight"] === "normal" ? 400 : num(d["font-weight"], 400);
    if (d["font-style"]) s.fontStyle = d["font-style"];
    if (d["text-anchor"]) s.textAnchor = d["text-anchor"];
    if (d.display === "none" || d.visibility === "hidden") s.display = false;
    return s;
}

// The paint for a fill or stroke value, in the box the layer will have (parent space).
function paintFor(value: string | null, opacity: number, style: Style, ctx: Ctx, matrix: M, local: { x: number; y: number; w: number; h: number }, box: { x: number; y: number; w: number; h: number }): Paint | null {
    if (!value) return null;
    const ref = value.match(/url\(\s*['"]?#([^'")]+)['"]?\s*\)/);
    if (ref) {
        const grad = gradientFor(ctx.defs.get(ref[1] ?? ""), ctx, matrix, local, box, opacity, style);
        if (grad) return grad;
        const fallback = value.replace(/url\([^)]*\)/, "").trim();
        return fallback ? paintFor(fallback, opacity, style, ctx, matrix, local, box) : null;
    }
    const c = parseColor(value, parseColor(style.color)?.hex ?? "#000000");
    if (!c) return null;
    return solid(c.hex, Math.max(0, Math.min(1, c.alpha * opacity)));
}

function gradientFor(el: Element | undefined, ctx: Ctx, matrix: M, local: { x: number; y: number; w: number; h: number }, box: { x: number; y: number; w: number; h: number }, opacity: number, style: Style): GradientPaint | null {
    if (!el || (el.tagName !== "linearGradient" && el.tagName !== "radialGradient")) return null;
    // Stops and attributes can come from a gradient this one points to with href.
    const chain: Element[] = [el];
    let cursor: Element | undefined = el;
    while (cursor) {
        const href: string = (cursor.getAttribute("href") ?? cursor.getAttribute("xlink:href") ?? "").replace(/^#/, "");
        cursor = href ? ctx.defs.get(href) : undefined;
        if (cursor && !chain.includes(cursor)) chain.push(cursor);
        else cursor = undefined;
    }
    const attr = (name: string) => {
        for (const g of chain) {
            const v = g.getAttribute(name);
            if (v !== null) return v;
        }
        return null;
    };
    const stopsEl = chain.map((g) => Array.from(g.children).filter((c) => c.tagName === "stop")).find((s) => s.length) ?? [];
    const stops = stopsEl.map((stop) => {
        const d = { ...parseDecls(stop.getAttribute("style") ?? "") };
        const color = parseColor(d["stop-color"] ?? stop.getAttribute("stop-color") ?? "#000000", parseColor(style.color)?.hex) ?? { hex: "#000000", alpha: 1 };
        const so = num(d["stop-opacity"] ?? stop.getAttribute("stop-opacity"), 1);
        const offRaw = stop.getAttribute("offset") ?? "0";
        const position = offRaw.endsWith("%") ? parseFloat(offRaw) / 100 : num(offRaw, 0);
        return { position: Math.max(0, Math.min(1, position)), color: color.hex, opacity: color.alpha * so };
    });
    if (!stops.length) return null;
    const userSpace = attr("gradientUnits") === "userSpaceOnUse";
    const gt = parseTransform(attr("gradientTransform"));
    // A point in gradient space → the layer box's fractions.
    const toFraction = (p: Pt): Pt => {
        let q = gt.transformPoint(new DOMPoint(p.x, p.y));
        if (!userSpace) q = new DOMPoint(local.x + q.x * local.w, local.y + q.y * local.h);
        const w = matrix.transformPoint(q);
        return { x: box.w ? (w.x + ctx.origin.x - box.x) / box.w : 0, y: box.h ? (w.y + ctx.origin.y - box.y) / box.h : 0 };
    };
    const vw = ctx.viewport.w;
    const vh = ctx.viewport.h;
    const L = (name: string, ref: number, fallback: string) => {
        const v = attr(name) ?? fallback;
        if (userSpace) return len(v, ref);
        return v.endsWith("%") ? parseFloat(v) / 100 : num(v);
    };
    const base = { stops, opacity, visible: true, blend: "normal" as const };
    if (el.tagName === "linearGradient") {
        const from = toFraction({ x: L("x1", vw, "0%"), y: L("y1", vh, "0%") });
        const to = toFraction({ x: L("x2", vw, "100%"), y: L("y2", vh, "0%") });
        return { type: "linear", from, to, ...base };
    }
    const cx = L("cx", vw, "50%");
    const cy = L("cy", vh, "50%");
    const r = L("r", Math.hypot(vw, vh) / Math.SQRT2, "50%");
    return { type: "radial", from: toFraction({ x: cx, y: cy }), to: toFraction({ x: cx + r, y: cy }), ...base };
}

function isAxisAligned(m: M): boolean {
    return Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 && m.a > 0 && m.d > 0;
}

function strokeScale(m: M): number {
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

// Adds one layer for a shape with geometry `subs` in SVG user space under transform `m`.
function addShape(el: Element, subs: Subpath[], style: Style, m: M, ctx: Ctx, parentId: string, name: string, local: { x: number; y: number; w: number; h: number }, kind?: { type: "rect"; rx: number } | { type: "ellipse" }) {
    if (!subs.length || !style.display) return;
    const placed = mapSubpaths(subs, (p) => {
        const q = m.transformPoint(new DOMPoint(p.x, p.y));
        return { x: q.x + ctx.origin.x, y: q.y + ctx.origin.y };
    });
    const bounds = pathBounds(placed) ?? { x: ctx.origin.x, y: ctx.origin.y, w: 1, h: 1 };
    const box = { x: bounds.x, y: bounds.y, w: Math.max(bounds.w, 0.01), h: Math.max(bounds.h, 0.01) };
    const fill = paintFor(style.fill, style.fillOpacity, style, ctx, m, local, box);
    const stroke = paintFor(style.stroke, style.strokeOpacity, style, ctx, m, local, box);
    const k = strokeScale(m);
    const common: Partial<SceneNode> = {
        name: el.getAttribute("id") || el.getAttribute("inkscape:label") || name,
        fills: fill ? [fill] : [],
        strokes: stroke ? [stroke] : [],
        strokeWidth: stroke ? style.strokeWidth * k : 1,
        strokeAlign: "center",
        strokeCap: style.strokeCap,
        strokeJoin: style.strokeJoin,
        dash: style.dash ? [style.dash[0] * k, style.dash[1] * k] : null,
        opacity: style.opacity,
    };
    let node: SceneNode;
    if (kind && isAxisAligned(m)) {
        const r = kind.type === "rect" ? kind.rx * m.a : 0;
        node = makeNode(ctx.doc, kind.type, box, parentId, { ...common, radius: r });
        node = { ...node, ...box };
    } else {
        // Even-odd fills become the same area under the default rule (holes keep their holes).
        const geometry = style.fillRule === "evenodd" && placed.filter((s) => s.closed).length > 1 ? [...booleanPaths("exclude", placed.filter((s) => s.closed).map((s) => [s])), ...placed.filter((s) => !s.closed)] : placed;
        const fitted = fitPath(geometry);
        node = { ...makeNode(ctx.doc, "vector", fitted, parentId, { ...common, path: fitted.path }), x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h };
    }
    ctx.commands.push({ type: "node.create", node });
}

function addText(el: Element, style: Style, m: M, ctx: Ctx, parentId: string) {
    if (!style.display) return;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const first = el.querySelector("tspan");
    const x = num(el.getAttribute("x") ?? first?.getAttribute("x"), 0);
    const y = num(el.getAttribute("y") ?? first?.getAttribute("y"), 0);
    const k = strokeScale(m);
    const size = style.fontSize * k;
    const p = m.transformPoint(new DOMPoint(x, y));
    const fill = parseColor(style.fill ?? "none", parseColor(style.color)?.hex);
    const width = text.length * size * 0.55;
    const left = style.textAnchor === "middle" ? p.x - width / 2 : style.textAnchor === "end" ? p.x - width : p.x;
    const node = makeNode(ctx.doc, "text", { x: left + ctx.origin.x, y: p.y + ctx.origin.y - size * 0.92, w: width, h: size * 1.2 }, parentId, {
        name: text.slice(0, 40),
        text,
        fontSize: size,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        italic: style.fontStyle === "italic",
        textAlign: style.textAnchor === "middle" ? "center" : style.textAnchor === "end" ? "right" : "left",
        fills: fill ? [solid(fill.hex, fill.alpha * style.fillOpacity)] : [],
        opacity: style.opacity,
        sizing: { h: "hug", v: "hug" },
    });
    ctx.commands.push({ type: "node.create", node });
}

function addImage(el: Element, style: Style, m: M, ctx: Ctx, parentId: string) {
    const href = el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "";
    if (!href.startsWith("data:image/")) return;
    const x = num(el.getAttribute("x"));
    const y = num(el.getAttribute("y"));
    const w = num(el.getAttribute("width"));
    const h = num(el.getAttribute("height"));
    if (!w || !h) return;
    const a = m.transformPoint(new DOMPoint(x, y));
    const b = m.transformPoint(new DOMPoint(x + w, y + h));
    const id = `svgimg-${Math.random().toString(36).slice(2, 10)}`;
    ctx.commands.push({ type: "image.add", id, data: href });
    const box = { x: Math.min(a.x, b.x) + ctx.origin.x, y: Math.min(a.y, b.y) + ctx.origin.y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    const node = makeNode(ctx.doc, "rect", box, parentId, { name: el.getAttribute("id") || "Image", fills: [{ type: "image", id, mode: el.getAttribute("preserveAspectRatio") === "none" ? "fill" : "fit", opacity: 1, visible: true, blend: "normal" }], opacity: style.opacity });
    ctx.commands.push({ type: "node.create", node: { ...node, ...box } });
}

function walk(el: Element, parentStyle: Style, parentMatrix: M, ctx: Ctx, parentId: string) {
    const tag = el.tagName.replace(/^svg:/, "");
    if (["defs", "style", "title", "desc", "metadata", "clipPath", "mask", "linearGradient", "radialGradient", "pattern", "symbol", "marker", "filter"].includes(tag)) return;
    const style = styleOf(el, parentStyle, ctx);
    if (!style.display) return;
    const m = parentMatrix.multiply(parseTransform(el.getAttribute("transform")));
    const a = (n: string) => el.getAttribute(n);
    const vw = ctx.viewport.w;
    const vh = ctx.viewport.h;
    switch (tag) {
        case "g":
        case "a":
        case "switch": {
            const kids = Array.from(el.children);
            if (!kids.length) return;
            // Groups keep their structure; their opacity stays on the group.
            const group = makeNode(ctx.doc, "group", { x: 0, y: 0, w: 1, h: 1 }, parentId, { name: el.getAttribute("id") || el.getAttribute("inkscape:label") || "Group", opacity: style.opacity, fills: [] });
            const before = ctx.commands.length;
            ctx.commands.push({ type: "node.create", node: group });
            const inner = { ...style, opacity: 1 };
            for (const child of kids) walk(child, inner, m, ctx, group.id);
            // An empty group is dropped.
            if (ctx.commands.length === before + 1) ctx.commands.pop();
            return;
        }
        case "svg": {
            // A nested svg: its x/y offset and its viewBox.
            const x = len(a("x"), vw);
            const y = len(a("y"), vh);
            for (const child of Array.from(el.children)) walk(child, style, m.translate(x, y), ctx, parentId);
            return;
        }
        case "use": {
            const ref = ctx.defs.get((a("href") ?? a("xlink:href") ?? "").replace(/^#/, ""));
            if (!ref) return;
            const moved = m.translate(len(a("x"), vw), len(a("y"), vh));
            if (ref.tagName === "symbol") for (const child of Array.from(ref.children)) walk(child, style, moved, ctx, parentId);
            else walk(ref, style, moved, ctx, parentId);
            return;
        }
        case "path": {
            const subs = parsePathData(a("d") ?? "");
            const b = pathBounds(subs) ?? { x: 0, y: 0, w: 0, h: 0 };
            addShape(el, subs, style, m, ctx, parentId, "Vector", b);
            return;
        }
        case "rect": {
            const x = len(a("x"), vw);
            const y = len(a("y"), vh);
            const w = len(a("width"), vw);
            const h = len(a("height"), vh);
            if (w <= 0 || h <= 0) return;
            let rx = a("rx") !== null ? len(a("rx"), vw) : a("ry") !== null ? len(a("ry"), vh) : 0;
            let ry = a("ry") !== null ? len(a("ry"), vh) : rx;
            rx = Math.min(rx, w / 2);
            ry = Math.min(ry, h / 2);
            addShape(el, [rectPath(x, y, w, h, rx, ry)], style, m, ctx, parentId, "Rectangle", { x, y, w, h }, Math.abs(rx - ry) < 1e-6 ? { type: "rect", rx } : undefined);
            return;
        }
        case "circle":
        case "ellipse": {
            const cx = len(a("cx"), vw);
            const cy = len(a("cy"), vh);
            const rx = tag === "circle" ? len(a("r"), Math.hypot(vw, vh) / Math.SQRT2) : len(a("rx"), vw);
            const ry = tag === "circle" ? rx : len(a("ry"), vh);
            if (rx <= 0 || ry <= 0) return;
            addShape(el, [ellipsePath(cx, cy, rx, ry)], style, m, ctx, parentId, "Ellipse", { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }, { type: "ellipse" });
            return;
        }
        case "line": {
            const p1 = { x: len(a("x1"), vw), y: len(a("y1"), vh) };
            const p2 = { x: len(a("x2"), vw), y: len(a("y2"), vh) };
            addShape(el, [{ closed: false, points: [{ ...p1, in: null, out: null }, { ...p2, in: null, out: null }] }], { ...style, fill: null }, m, ctx, parentId, "Line", { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) });
            return;
        }
        case "polyline":
        case "polygon": {
            const nums = (a("points") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
            const pts: PathPoint[] = [];
            for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i] ?? 0, y: nums[i + 1] ?? 0, in: null, out: null });
            if (pts.length < 2) return;
            const sub: Subpath = { closed: tag === "polygon", points: pts };
            addShape(el, [sub], style, m, ctx, parentId, tag === "polygon" ? "Polygon" : "Line", pathBounds([sub]) ?? { x: 0, y: 0, w: 0, h: 0 });
            return;
        }
        case "text":
            addText(el, style, m, ctx, parentId);
            return;
        case "image":
            addImage(el, style, m, ctx, parentId);
            return;
    }
}

// Imports SVG markup as layers, centred on a world point (or with its top-left there). Returns the frame's id.
export function importSvg(markup: string, point: { x: number; y: number }, name = "SVG", centred = true): string | null {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = parsed.documentElement;
    if (!root || root.tagName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) return null;
    const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    const hasViewBox = vb.length === 4 && vb.every((n) => Number.isFinite(n)) && (vb[2] ?? 0) > 0 && (vb[3] ?? 0) > 0;
    const width = len(root.getAttribute("width"), hasViewBox ? (vb[2] as number) : 300, hasViewBox ? (vb[2] as number) : 300) || (hasViewBox ? (vb[2] as number) : 300);
    const height = len(root.getAttribute("height"), hasViewBox ? (vb[3] as number) : 150, hasViewBox ? (vb[3] as number) : 150) || (hasViewBox ? (vb[3] as number) : 150);
    // The viewBox scales to the width and height (preserveAspectRatio's default: meet, centred).
    let m = new DOMMatrix();
    if (hasViewBox) {
        const [vx, vy, vw, vh] = vb as [number, number, number, number];
        const k = Math.min(width / vw, height / vh);
        m = m.translate((width - vw * k) / 2, (height - vh * k) / 2).scale(k, k).translate(-vx, -vy);
    }
    const at = centred ? { x: Math.round(point.x - width / 2), y: Math.round(point.y - height / 2) } : point;
    const s = editor.get();
    const doc = s.doc;
    const parentId = frameAt(doc, at.x, at.y);
    const local = applyMatrix(spaceMatrix(doc, parentId).inverse(), at.x, at.y);
    const frame = makeNode(doc, "frame", { x: local.x, y: local.y, w: width, h: height }, parentId, { name: root.getAttribute("id") || name, fills: [], clip: false });
    const defs = new Map<string, Element>();
    for (const el of Array.from(root.querySelectorAll("[id]"))) defs.set(el.getAttribute("id") ?? "", el);
    const ctx: Ctx = { css: readCss(root), defs, doc, commands: [{ type: "node.create", node: { ...frame, x: local.x, y: local.y, w: width, h: height } }], parentId: frame.id, origin: { x: local.x, y: local.y }, viewport: { w: hasViewBox ? (vb[2] as number) : width, h: hasViewBox ? (vb[3] as number) : height } };
    const style = styleOf(root, DEFAULT_STYLE, ctx);
    for (const child of Array.from(root.children)) walk(child, { ...style, opacity: 1 }, m, ctx, frame.id);
    editor.execute({ type: "batch", commands: ctx.commands });
    editor.set({ selection: [frame.id] });
    return frame.id;
}

export function looksLikeSvg(text: string): boolean {
    const t = text.trimStart().slice(0, 2000);
    return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(t);
}

export async function importSvgFile(file: File, at: { x: number; y: number }) {
    const text = await file.text();
    if (!importSvg(text, at, file.name.replace(/\.svg$/i, "") || "SVG")) editor.notify(`Couldn't read ${file.name} as SVG.`);
}
