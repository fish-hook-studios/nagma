import { cssFor, round } from "./dev-css";
import { refuseExport } from "./share-settings";
import { pluginLanguages, pluginStore } from "./plugins";
import { pluginAllowedInInspect, teamDefaultLanguage } from "./inspect-settings";
import { editor } from "./store";
import type { Effect, NagmaDocument, Paint, SceneNode } from "./types";
import { findVariable } from "./variables";

// Inspect's code snippets for every platform: CSS and a utility-class list for the web, SwiftUI and
// UIKit for iOS, Compose and XML layouts for Android. Each reads the layer the same way (size,
// sizing, fills, border, corners, shadows, blur, auto layout, typography) and writes it in the
// platform's own idiom, in the unit picked (with its scale) and with variables as tokens.

export type BuiltinLang = "css" | "tailwind" | "swiftui" | "uikit" | "compose" | "xml";
// Codegen plugins add languages as "plugin:<plugin id>:<value>" (engine/plugins.ts).
export type CodeLang = BuiltinLang | `plugin:${string}`;
export type CodeUnit = "px" | "rem" | "pt" | "dp";

export interface CodeSettings {
    lang: CodeLang;
    unit: CodeUnit;
    // rem: the root font size in px. pt and dp: canvas pixels per unit.
    scale: number;
}

export interface CodeBlock {
    title: string;
    lines: string[];
}

export interface LangInfo {
    id: CodeLang;
    label: string;
    platform: "Web" | "iOS" | "Android" | "Plugins";
    units: CodeUnit[];
}

export const CODE_LANGS: (LangInfo & { id: BuiltinLang })[] = [
    { id: "css", label: "CSS", platform: "Web", units: ["px", "rem"] },
    { id: "tailwind", label: "Tailwind", platform: "Web", units: ["px"] },
    { id: "swiftui", label: "SwiftUI", platform: "iOS", units: ["pt", "px"] },
    { id: "uikit", label: "UIKit", platform: "iOS", units: ["pt", "px"] },
    { id: "compose", label: "Compose", platform: "Android", units: ["dp", "px"] },
    { id: "xml", label: "XML", platform: "Android", units: ["dp", "px"] },
];

export const UNIT_LABELS: Record<CodeUnit, string> = { px: "px", rem: "rem", pt: "pt", dp: "dp / sp" };

export const DEFAULT_CODE: CodeSettings = { lang: "css", unit: "px", scale: 16 };

// The scale a unit starts with: the browser's root font size for rem, one canvas pixel otherwise.
export function defaultScale(unit: CodeUnit): number {
    return unit === "rem" ? 16 : 1;
}

// Every language Inspect offers: the built-in ones, then each codegen plugin's.
export function allLangs(): LangInfo[] {
    return [...CODE_LANGS, ...pluginLanguages().filter((l) => pluginAllowedInInspect(l.pluginId)).map((l): LangInfo => ({ id: l.id as CodeLang, label: l.label, platform: "Plugins", units: ["px"] }))];
}

export function langInfo(lang: CodeLang): LangInfo {
    const found = allLangs().find((l) => l.id === lang);
    if (found) return found;
    // A plugin language before the plugins have loaded keeps its place.
    if (lang.startsWith("plugin:") && !pluginStore.get().loaded) return { id: lang, label: lang.split(":").pop() ?? lang, platform: "Plugins", units: ["px"] };
    return CODE_LANGS[0] as LangInfo;
}

// Keeps the unit valid for the language (a language switch picks that platform's first unit).
export function normalizeSettings(s: CodeSettings): CodeSettings {
    const info = langInfo(s.lang);
    const unit = info.units.includes(s.unit) ? s.unit : (info.units[0] as CodeUnit);
    const scale = unit === s.unit && s.scale > 0 ? s.scale : defaultScale(unit);
    return { lang: info.id, unit, scale };
}

// ---- Reading a layer ----------------------------------------------------------------------------

interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
    hex: string;
}

function rgba(hex: string, alpha = 1): Rgba {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.slice(0, 6);
    const n = parseInt(full || "000000", 16);
    const extra = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: Math.round(alpha * extra * 1000) / 1000, hex: `#${full.toUpperCase()}` };
}

interface Shadow {
    inner: boolean;
    x: number;
    y: number;
    blur: number;
    spread: number;
    color: Rgba;
}

interface Spec {
    node: SceneNode;
    width: { value: number; sizing: "fixed" | "hug" | "fill" };
    height: { value: number; sizing: "fixed" | "hug" | "fill" };
    fill: Rgba | null;
    gradient: boolean;
    image: boolean;
    border: { width: number; color: Rgba; align: SceneNode["strokeAlign"] } | null;
    radius: number | [number, number, number, number] | null;
    ellipse: boolean;
    opacity: number;
    rotation: number;
    shadows: Shadow[];
    blur: number;
    backgroundBlur: number;
    clip: boolean;
    layout: SceneNode["layout"];
    children: string[];
}

function firstSolid(paints: Paint[]): Rgba | null {
    const p = [...paints].reverse().find((x) => x.visible && x.type === "solid");
    return p?.type === "solid" ? rgba(p.color, p.opacity) : null;
}

function shadowsOf(node: SceneNode): Shadow[] {
    const list: Shadow[] = [];
    if (node.shadow) list.push({ inner: false, x: node.shadow.x, y: node.shadow.y, blur: node.shadow.blur, spread: 0, color: rgba(node.shadow.color, node.shadow.opacity) });
    for (const e of node.effects ?? []) {
        if (!e.visible || (e.type !== "drop-shadow" && e.type !== "inner-shadow")) continue;
        list.push({ inner: e.type === "inner-shadow", x: e.x, y: e.y, blur: e.blur, spread: e.spread, color: rgba(e.color, e.opacity) });
    }
    return list;
}

function effectBlur(node: SceneNode, type: Effect["type"]): number {
    return (node.effects ?? []).filter((e) => e.visible && e.type === type).reduce((m, e) => Math.max(m, e.blur), 0);
}

function specOf(node: SceneNode): Spec {
    const stroke = firstSolid(node.strokes);
    const radii = node.radii && node.radii.some((r) => r !== node.radii?.[0]) ? node.radii : null;
    return {
        node,
        width: { value: node.w, sizing: node.sizing?.h ?? "fixed" },
        height: { value: node.h, sizing: node.sizing?.v ?? "fixed" },
        fill: node.type === "text" ? null : firstSolid(node.fills),
        gradient: node.type !== "text" && node.fills.some((p) => p.visible && (p.type === "linear" || p.type === "radial" || p.type === "angular" || p.type === "diamond")),
        image: node.fills.some((p) => p.visible && p.type === "image"),
        border: stroke && node.strokeWidth > 0 ? { width: node.strokeWidth, color: stroke, align: node.strokeAlign } : null,
        radius: radii ?? (node.radius ? node.radius : null),
        ellipse: node.type === "ellipse",
        opacity: node.opacity,
        rotation: node.rotation,
        shadows: shadowsOf(node),
        blur: Math.max(node.blur || 0, effectBlur(node, "layer-blur")),
        backgroundBlur: effectBlur(node, "background-blur"),
        clip: node.clip,
        layout: node.layout,
        children: node.children,
    };
}

// A bound variable as the platform names it: its code syntax when set, otherwise its name.
function token(doc: NagmaDocument | undefined, node: SceneNode, key: string, platform: "web" | "ios" | "android"): string | null {
    if (!doc) return null;
    const id = node.boundVariables?.[key] ?? (key.endsWith(":0") ? node.boundVariables?.[key.slice(0, -2)] : undefined);
    const v = id ? findVariable(doc, id)?.variable : undefined;
    if (!v) return null;
    const own = v.codeSyntax?.[platform]?.trim();
    if (own) return own;
    const words = v.name.split(/[^a-z0-9]+/i).filter(Boolean);
    if (platform === "web") return `--${words.join("-").toLowerCase()}`;
    const camel = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase())).join("");
    return platform === "ios" ? camel : words.join("_").toLowerCase();
}

const childNames = (doc: NagmaDocument | undefined, spec: Spec) =>
    spec.children
        .map((id) => doc?.nodes[id]?.name)
        .filter((n): n is string => Boolean(n))
        .slice(0, 6);

const num = (n: number) => String(round(n));

// ---- CSS ----------------------------------------------------------------------------------------

function withRem(text: string, root: number): string {
    return text.replace(/(-?\d+(?:\.\d+)?)px/g, (_m, n: string) => `${Math.round((Number(n) / root) * 1000) / 1000}rem`);
}

function cssBlocks(node: SceneNode, doc: NagmaDocument, s: CodeSettings): CodeBlock[] {
    const css = cssFor(node, doc.images, doc);
    const conv = (l: string) => (s.unit === "rem" ? withRem(l, s.scale) : l);
    const lines = css.split("\n").filter(Boolean).map(conv);
    const pick = (test: (prop: string) => boolean) => lines.filter((l) => test(l.split(":")[0] ?? ""));
    const layoutProps = ["width", "height", "display", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-self", "flex", "gap", "row-gap", "padding", "overflow", "transform", "position", "min-width", "max-width", "min-height", "max-height"];
    const layout = pick((p) => layoutProps.includes(p));
    const typography = pick((p) => p.startsWith("font") || ["line-height", "letter-spacing", "text-align", "color", "text-transform", "text-decoration"].includes(p));
    const appearance = lines.filter((l) => !layout.includes(l) && !typography.includes(l));
    return [
        { title: "Layout", lines: layout },
        { title: "Typography", lines: typography },
        { title: "Appearance", lines: appearance },
    ].filter((g) => g.lines.length);
}

// ---- Tailwind -----------------------------------------------------------------------------------

const TW_RADIUS: Record<number, string> = { 2: "rounded-sm", 4: "rounded", 6: "rounded-md", 8: "rounded-lg", 12: "rounded-xl", 16: "rounded-2xl", 24: "rounded-3xl" };
const TW_WEIGHT: Record<number, string> = { 100: "font-thin", 200: "font-extralight", 300: "font-light", 400: "font-normal", 500: "font-medium", 600: "font-semibold", 700: "font-bold", 800: "font-extrabold", 900: "font-black" };

// A spacing value: the default 4px scale when it fits, otherwise an arbitrary value.
function twSpace(prefix: string, v: number): string {
    const r = round(v);
    if (r === 0) return `${prefix}-0`;
    if (r % 1 === 0 && (r % 4 === 0 || r === 2 || r === 6 || r === 10 || r === 14) && r <= 384) return `${prefix}-${r / 4}`;
    return `${prefix}-[${r}px]`;
}

function twColor(prefix: string, c: Rgba): string {
    return c.a < 1 ? `${prefix}-[${c.hex}]/${Math.round(c.a * 100)}` : `${prefix}-[${c.hex}]`;
}

function tailwindBlocks(node: SceneNode, doc: NagmaDocument): CodeBlock[] {
    const sp = specOf(node);
    const cls: string[] = [];
    const size = (axis: "w" | "h", d: Spec["width"]) => {
        if (d.sizing === "fill") cls.push(axis === "w" ? "w-full" : "h-full");
        else if (d.sizing === "fixed") cls.push(twSpace(axis, d.value));
    };
    size("w", sp.width);
    size("h", sp.height);
    const l = sp.layout;
    if (l && !l.grid) {
        cls.push("flex", l.direction === "vertical" ? "flex-col" : "flex-row");
        if (l.wrap) cls.push("flex-wrap");
        const justify = { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between", around: "justify-around", evenly: "justify-evenly" }[l.primary];
        const items = { start: "items-start", center: "items-center", end: "items-end", baseline: "items-baseline" }[l.counter];
        cls.push(justify, items);
        if (l.gap) cls.push(twSpace("gap", l.gap));
        const [t, r, b, lft] = l.padding;
        if (t === b && r === lft && t === r) {
            if (t) cls.push(twSpace("p", t));
        } else {
            if (t === b) {
                if (t) cls.push(twSpace("py", t));
            } else {
                if (t) cls.push(twSpace("pt", t));
                if (b) cls.push(twSpace("pb", b));
            }
            if (r === lft) {
                if (r) cls.push(twSpace("px", r));
            } else {
                if (lft) cls.push(twSpace("pl", lft));
                if (r) cls.push(twSpace("pr", r));
            }
        }
    } else if (l?.grid) {
        cls.push("grid", `grid-cols-${l.grid.columns}`);
        if (l.grid.columnGap) cls.push(twSpace("gap-x", l.grid.columnGap));
        if (l.grid.rowGap) cls.push(twSpace("gap-y", l.grid.rowGap));
    }
    const fillToken = token(doc, node, "fill:0", "web");
    if (node.type === "text") {
        const c = firstSolid(node.fills);
        if (fillToken) cls.push(`text-[var(${fillToken})]`);
        else if (c) cls.push(twColor("text", c));
        cls.push(`text-[${num(node.fontSize ?? 16)}px]`, TW_WEIGHT[Math.round((node.fontWeight ?? 400) / 100) * 100] ?? `font-[${node.fontWeight}]`);
        if (node.fontFamily) cls.push(`font-['${node.fontFamily.replace(/\s+/g, "_")}']`);
        if (node.italic) cls.push("italic");
        if (node.lineHeight != null) cls.push(`leading-[${num(node.lineHeight * (node.fontSize ?? 16))}px]`);
        if (node.letterSpacing) cls.push(`tracking-[${num(node.letterSpacing / 100)}em]`);
        if (node.textAlign && node.textAlign !== "left") cls.push(`text-${node.textAlign}`);
        if (node.textCase === "upper") cls.push("uppercase");
        else if (node.textCase === "lower") cls.push("lowercase");
        else if (node.textCase === "title") cls.push("capitalize");
        if (node.decoration === "underline") cls.push("underline");
        else if (node.decoration === "strikethrough") cls.push("line-through");
    } else if (fillToken) cls.push(`bg-[var(${fillToken})]`);
    else if (sp.fill) cls.push(twColor("bg", sp.fill));
    if (sp.border) {
        cls.push(sp.border.width === 1 ? "border" : `border-[${num(sp.border.width)}px]`, twColor("border", sp.border.color));
    }
    if (sp.ellipse) cls.push("rounded-full");
    else if (Array.isArray(sp.radius)) cls.push(`rounded-tl-[${num(sp.radius[0])}px]`, `rounded-tr-[${num(sp.radius[1])}px]`, `rounded-br-[${num(sp.radius[2])}px]`, `rounded-bl-[${num(sp.radius[3])}px]`);
    else if (sp.radius) cls.push(TW_RADIUS[round(sp.radius)] ?? (sp.radius >= Math.min(node.w, node.h) / 2 ? "rounded-full" : `rounded-[${num(sp.radius)}px]`));
    if (sp.shadows.length) {
        const parts = sp.shadows.map((x) => `${x.inner ? "inset_" : ""}${num(x.x)}px_${num(x.y)}px_${num(x.blur)}px_${num(x.spread)}px_rgba(${x.color.r},${x.color.g},${x.color.b},${x.color.a})`);
        cls.push(`shadow-[${parts.join(",")}]`);
    }
    if (sp.opacity < 1) cls.push(`opacity-[${num(sp.opacity)}]`);
    if (sp.rotation) cls.push(`rotate-[${num(sp.rotation)}deg]`);
    if (sp.blur) cls.push(`blur-[${num(sp.blur)}px]`);
    if (sp.backgroundBlur) cls.push(`backdrop-blur-[${num(sp.backgroundBlur)}px]`);
    if (sp.clip && sp.children.length) cls.push("overflow-hidden");
    const tag = node.type === "text" ? "p" : "div";
    const inner = node.type === "text" ? (node.text ?? "").replace(/</g, "&lt;").split("\n")[0]?.slice(0, 60) ?? "" : "";
    return [
        { title: "Classes", lines: [cls.filter(Boolean).join(" ")] },
        { title: "Markup", lines: [`<${tag} class="${cls.filter(Boolean).join(" ")}">${inner}</${tag}>`] },
    ];
}

// ---- iOS ----------------------------------------------------------------------------------------

function iosLen(v: number, s: CodeSettings): string {
    return num(s.unit === "pt" ? v / s.scale : v);
}

function swiftColor(c: Rgba): string {
    const f = (n: number) => num(n / 255);
    return `Color(red: ${f(c.r)}, green: ${f(c.g)}, blue: ${f(c.b)}${c.a < 1 ? `, opacity: ${c.a}` : ""})`;
}

function uiColor(c: Rgba): string {
    const f = (n: number) => num(n / 255);
    return `UIColor(red: ${f(c.r)}, green: ${f(c.g)}, blue: ${f(c.b)}, alpha: ${c.a})`;
}

const SWIFT_WEIGHT: Record<number, string> = { 100: "ultraLight", 200: "thin", 300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "heavy", 900: "black" };
const swiftWeight = (w = 400) => SWIFT_WEIGHT[Math.round(w / 100) * 100] ?? "regular";
const quote = (t: string) => t.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

function swiftuiBlocks(node: SceneNode, doc: NagmaDocument, s: CodeSettings): CodeBlock[] {
    const sp = specOf(node);
    const len = (v: number) => iosLen(v, s);
    const out: string[] = [`// ${node.name}`];
    const mods: string[] = [];
    const fillTok = token(doc, node, "fill:0", "ios");
    if (node.type === "text") {
        const c = firstSolid(node.fills);
        out.push(`Text("${quote(node.text ?? "")}")`);
        mods.push(`.font(.custom("${node.fontFamily ?? "Inter"}", size: ${len(node.fontSize ?? 16)}).weight(.${swiftWeight(node.fontWeight)}))`);
        if (node.italic) mods.push(".italic()");
        if (node.lineHeight != null) mods.push(`.lineSpacing(${len(Math.max(0, node.lineHeight * (node.fontSize ?? 16) - (node.fontSize ?? 16)))})`);
        if (node.letterSpacing) mods.push(`.kerning(${len((node.letterSpacing / 100) * (node.fontSize ?? 16))})`);
        if (node.textAlign === "center" || node.textAlign === "right") mods.push(`.multilineTextAlignment(.${node.textAlign === "center" ? "center" : "trailing"})`);
        if (node.textCase === "upper" || node.textCase === "lower") mods.push(`.textCase(.${node.textCase === "upper" ? "uppercase" : "lowercase"})`);
        if (node.decoration === "underline") mods.push(".underline()");
        else if (node.decoration === "strikethrough") mods.push(".strikethrough()");
        if (fillTok) mods.push(`.foregroundColor(Color("${fillTok}"))`);
        else if (c) mods.push(`.foregroundColor(${swiftColor(c)})`);
    } else if (sp.layout && !sp.layout.grid) {
        const l = sp.layout;
        const vertical = l.direction === "vertical";
        const align = vertical ? { start: ".leading", center: ".center", end: ".trailing", baseline: ".leading" }[l.counter] : { start: ".top", center: ".center", end: ".bottom", baseline: ".firstTextBaseline" }[l.counter];
        const spacing = l.primary === "between" ? 0 : l.gap;
        out.push(`${vertical ? "VStack" : "HStack"}(alignment: ${align}, spacing: ${len(spacing)}) {`);
        for (const name of childNames(doc, sp)) out.push(`    // ${name}`);
        out.push("}");
        const [t, r, b, lft] = l.padding;
        if (t || r || b || lft) mods.push(t === b && r === lft && t === r ? `.padding(${len(t)})` : `.padding(EdgeInsets(top: ${len(t)}, leading: ${len(lft)}, bottom: ${len(b)}, trailing: ${len(r)}))`);
    } else if (sp.ellipse) out.push("Ellipse()");
    else if (sp.image) out.push(`Image("${node.name.replace(/"/g, "")}")`, "    .resizable()", "    .aspectRatio(contentMode: .fill)");
    else out.push(sp.radius && !Array.isArray(sp.radius) ? `RoundedRectangle(cornerRadius: ${len(sp.radius)})` : "Rectangle()");
    // Shapes take their fill before the frame; stacks and images get a background after it.
    const shapeless = sp.layout || node.type === "text" || sp.image;
    const fillMod = node.type === "text" ? null : fillTok ? (shapeless ? `.background(Color("${fillTok}"))` : `.fill(Color("${fillTok}"))`) : sp.fill ? (shapeless ? `.background(${swiftColor(sp.fill)})` : `.fill(${swiftColor(sp.fill)})`) : sp.gradient ? "// Gradient fill: see the CSS for its stops" : null;
    if (fillMod && !shapeless) mods.push(fillMod);
    const frame = (axis: "width" | "height", d: Spec["width"]) => (d.sizing === "fill" ? `max${axis === "width" ? "Width" : "Height"}: .infinity` : d.sizing === "fixed" ? `${axis}: ${len(d.value)}` : null);
    const dims = [frame("width", sp.width), frame("height", sp.height)].filter(Boolean);
    if (dims.length) mods.push(`.frame(${dims.join(", ")})`);
    if (fillMod && shapeless) mods.push(fillMod);
    const corner = Array.isArray(sp.radius) ? sp.radius[0] : sp.radius;
    if (shapeless && corner) mods.push(`.clipShape(RoundedRectangle(cornerRadius: ${len(corner)}))`);
    if (sp.border) mods.push(`.overlay(${sp.ellipse ? "Ellipse()" : `RoundedRectangle(cornerRadius: ${len(corner ?? 0)})`}.${sp.border.align === "inside" ? "strokeBorder" : "stroke"}(${swiftColor(sp.border.color)}, lineWidth: ${len(sp.border.width)}))`);
    for (const x of sp.shadows.filter((sh) => !sh.inner)) mods.push(`.shadow(color: ${swiftColor(x.color)}, radius: ${len(x.blur / 2)}, x: ${len(x.x)}, y: ${len(x.y)})`);
    if (sp.blur) mods.push(`.blur(radius: ${len(sp.blur / 2)})`);
    if (sp.opacity < 1) mods.push(`.opacity(${num(sp.opacity)})`);
    if (sp.rotation) mods.push(`.rotationEffect(.degrees(${num(sp.rotation)}))`);
    return [{ title: "SwiftUI", lines: [...out, ...mods.map((m) => `    ${m}`)] }];
}

function uikitBlocks(node: SceneNode, doc: NagmaDocument, s: CodeSettings): CodeBlock[] {
    const sp = specOf(node);
    const len = (v: number) => iosLen(v, s);
    const v = node.type === "text" ? "label" : sp.layout && !sp.layout.grid ? "stack" : "view";
    const out: string[] = [`// ${node.name}`];
    const fillTok = token(doc, node, "fill:0", "ios");
    if (node.type === "text") {
        const c = firstSolid(node.fills);
        const size = len(node.fontSize ?? 16);
        out.push("let label = UILabel()", `label.text = "${quote(node.text ?? "")}"`, `label.font = UIFont(name: "${node.fontFamily ?? "Inter"}", size: ${size}) ?? .systemFont(ofSize: ${size}, weight: .${swiftWeight(node.fontWeight)})`);
        if (fillTok) out.push(`label.textColor = UIColor(named: "${fillTok}")`);
        else if (c) out.push(`label.textColor = ${uiColor(c)}`);
        if (node.textAlign && node.textAlign !== "left") out.push(`label.textAlignment = .${node.textAlign === "justify" ? "justified" : node.textAlign}`);
        out.push("label.numberOfLines = 0");
        const attrs: string[] = [];
        if (node.letterSpacing) attrs.push(`.kern: ${len((node.letterSpacing / 100) * (node.fontSize ?? 16))}`);
        if (node.decoration === "underline") attrs.push(".underlineStyle: NSUnderlineStyle.single.rawValue");
        if (node.decoration === "strikethrough") attrs.push(".strikethroughStyle: NSUnderlineStyle.single.rawValue");
        if (node.lineHeight != null) {
            out.push("let paragraph = NSMutableParagraphStyle()", `paragraph.minimumLineHeight = ${len(node.lineHeight * (node.fontSize ?? 16))}`, `paragraph.maximumLineHeight = ${len(node.lineHeight * (node.fontSize ?? 16))}`);
            attrs.push(".paragraphStyle: paragraph");
        }
        if (attrs.length) out.push(`label.attributedText = NSAttributedString(string: label.text ?? "", attributes: [${attrs.join(", ")}])`);
    } else if (v === "stack" && sp.layout) {
        const l = sp.layout;
        const align = { start: l.direction === "vertical" ? ".leading" : ".top", center: ".center", end: l.direction === "vertical" ? ".trailing" : ".bottom", baseline: ".firstBaseline" }[l.counter];
        const dist = { start: ".fill", center: ".fill", end: ".fill", between: ".equalSpacing", around: ".equalCentering", evenly: ".equalSpacing" }[l.primary];
        out.push("let stack = UIStackView()", `stack.axis = .${l.direction}`, `stack.spacing = ${len(l.gap)}`, `stack.alignment = ${align}`, `stack.distribution = ${dist}`);
        const [t, r, b, lft] = l.padding;
        if (t || r || b || lft) out.push("stack.isLayoutMarginsRelativeArrangement = true", `stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: ${len(t)}, leading: ${len(lft)}, bottom: ${len(b)}, trailing: ${len(r)})`);
        for (const name of childNames(doc, sp)) out.push(`// stack.addArrangedSubview(${name.replace(/[^a-z0-9]+/gi, "")})`);
    } else out.push(sp.image ? "let view = UIImageView()" : "let view = UIView()");
    if (v !== "label") {
        if (fillTok) out.push(`${v}.backgroundColor = UIColor(named: "${fillTok}")`);
        else if (sp.fill) out.push(`${v}.backgroundColor = ${uiColor(sp.fill)}`);
    }
    if (sp.width.sizing === "fixed") out.push(`${v}.widthAnchor.constraint(equalToConstant: ${len(sp.width.value)}).isActive = true`);
    if (sp.height.sizing === "fixed") out.push(`${v}.heightAnchor.constraint(equalToConstant: ${len(sp.height.value)}).isActive = true`);
    const corner = sp.ellipse ? Math.min(node.w, node.h) / 2 : Array.isArray(sp.radius) ? sp.radius[0] : sp.radius;
    if (corner) out.push(`${v}.layer.cornerRadius = ${len(corner)}`);
    if (Array.isArray(sp.radius)) out.push(`// Corners differ: ${sp.radius.map(num).join(", ")} (use layer.maskedCorners or a path)`);
    if (sp.border) out.push(`${v}.layer.borderWidth = ${len(sp.border.width)}`, `${v}.layer.borderColor = ${uiColor(sp.border.color)}.cgColor`);
    const sh = sp.shadows.find((x) => !x.inner);
    if (sh) out.push(`${v}.layer.shadowColor = ${uiColor({ ...sh.color, a: 1 })}.cgColor`, `${v}.layer.shadowOpacity = ${sh.color.a}`, `${v}.layer.shadowOffset = CGSize(width: ${len(sh.x)}, height: ${len(sh.y)})`, `${v}.layer.shadowRadius = ${len(sh.blur / 2)}`);
    if (sp.clip && sp.children.length) out.push(`${v}.clipsToBounds = true`);
    if (sp.opacity < 1) out.push(`${v}.alpha = ${num(sp.opacity)}`);
    if (sp.rotation) out.push(`${v}.transform = CGAffineTransform(rotationAngle: ${num(sp.rotation)} * .pi / 180)`);
    return [{ title: "UIKit", lines: out }];
}

// ---- Android ------------------------------------------------------------------------------------

function androidLen(v: number, s: CodeSettings, text = false): string {
    if (s.unit === "px") return `${num(v)}${text ? "px" : "px"}`;
    return `${num(v / s.scale)}${text ? "sp" : "dp"}`;
}

function argb(c: Rgba): string {
    const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
    return `${h(Math.round(c.a * 255))}${c.hex.slice(1)}`;
}

function composeLen(v: number, s: CodeSettings, text = false): string {
    // Compose has no px literal; px sizes go through the density.
    if (s.unit === "px") return `with(LocalDensity.current) { ${num(v)}f.toDp() }`.replace("toDp", text ? "toSp" : "toDp");
    return `${num(v / s.scale)}.${text ? "sp" : "dp"}`;
}

function composeBlocks(node: SceneNode, doc: NagmaDocument, s: CodeSettings): CodeBlock[] {
    const sp = specOf(node);
    const len = (v: number) => composeLen(v, s);
    const mods: string[] = [];
    const fillTok = token(doc, node, "fill:0", "android");
    if (sp.width.sizing === "fill") mods.push(".fillMaxWidth()");
    else if (sp.width.sizing === "fixed") mods.push(`.width(${len(sp.width.value)})`);
    if (sp.height.sizing === "fill") mods.push(".fillMaxHeight()");
    else if (sp.height.sizing === "fixed") mods.push(`.height(${len(sp.height.value)})`);
    const corner = Array.isArray(sp.radius) ? `RoundedCornerShape(topStart = ${len(sp.radius[0])}, topEnd = ${len(sp.radius[1])}, bottomEnd = ${len(sp.radius[2])}, bottomStart = ${len(sp.radius[3])})` : sp.ellipse ? "CircleShape" : sp.radius ? `RoundedCornerShape(${len(sp.radius)})` : null;
    const sh = sp.shadows.find((x) => !x.inner);
    if (sh) mods.push(`.shadow(elevation = ${len(sh.blur / 2)}${corner ? `, shape = ${corner}` : ""}, spotColor = Color(0x${argb(sh.color)}))`);
    if (node.type !== "text") {
        if (fillTok) mods.push(`.background(color = ${fillTok}${corner ? `, shape = ${corner}` : ""})`);
        else if (sp.fill) mods.push(`.background(color = Color(0x${argb(sp.fill)})${corner ? `, shape = ${corner}` : ""})`);
    }
    if (sp.border) mods.push(`.border(width = ${len(sp.border.width)}, color = Color(0x${argb(sp.border.color)})${corner ? `, shape = ${corner}` : ""})`);
    if (sp.clip && corner && sp.children.length) mods.push(`.clip(${corner})`);
    if (sp.layout && !sp.layout.grid) {
        const [t, r, b, lft] = sp.layout.padding;
        if (t || r || b || lft) mods.push(t === b && r === lft && t === r ? `.padding(${len(t)})` : `.padding(start = ${len(lft)}, top = ${len(t)}, end = ${len(r)}, bottom = ${len(b)})`);
    }
    if (sp.blur) mods.push(`.blur(${len(sp.blur / 2)})`);
    if (sp.opacity < 1) mods.push(`.alpha(${num(sp.opacity)}f)`);
    if (sp.rotation) mods.push(`.rotate(${num(sp.rotation)}f)`);
    const modifier = mods.length ? ["modifier = Modifier", ...mods.map((m) => `    ${m}`)] : [];
    const out: string[] = [`// ${node.name}`];
    if (node.type === "text") {
        const c = firstSolid(node.fills);
        const style = [
            `fontSize = ${composeLen(node.fontSize ?? 16, s, true)}`,
            node.lineHeight != null ? `lineHeight = ${composeLen(node.lineHeight * (node.fontSize ?? 16), s, true)}` : null,
            `fontFamily = FontFamily(Font(R.font.${(node.fontFamily ?? "inter").toLowerCase().replace(/[^a-z0-9]+/g, "_")}))`,
            `fontWeight = FontWeight(${node.fontWeight ?? 400})`,
            node.italic ? "fontStyle = FontStyle.Italic" : null,
            fillTok ? `color = ${fillTok}` : c ? `color = Color(0x${argb(c)})` : null,
            node.textAlign && node.textAlign !== "left" ? `textAlign = TextAlign.${node.textAlign === "center" ? "Center" : node.textAlign === "right" ? "Right" : "Justify"}` : null,
            node.letterSpacing ? `letterSpacing = ${composeLen((node.letterSpacing / 100) * (node.fontSize ?? 16), s, true)}` : null,
            node.decoration === "underline" ? "textDecoration = TextDecoration.Underline" : node.decoration === "strikethrough" ? "textDecoration = TextDecoration.LineThrough" : null,
        ].filter(Boolean);
        out.push("Text(", `    text = "${quote(node.text ?? "")}",`, "    style = TextStyle(", ...style.map((x) => `        ${x},`), "    ),");
        if (modifier.length) out.push(...modifier.map((m, i) => `    ${m}${i === modifier.length - 1 ? "," : ""}`));
        out.push(")");
        return [{ title: "Compose", lines: out }];
    }
    if (sp.layout && !sp.layout.grid) {
        const l = sp.layout;
        const vertical = l.direction === "vertical";
        const arr = l.primary === "between" ? "Arrangement.SpaceBetween" : l.primary === "around" ? "Arrangement.SpaceAround" : l.primary === "evenly" ? "Arrangement.SpaceEvenly" : `Arrangement.spacedBy(${len(l.gap)}, Alignment.${vertical ? { start: "Top", center: "CenterVertically", end: "Bottom" }[l.primary] : { start: "Start", center: "CenterHorizontally", end: "End" }[l.primary]})`;
        const cross = vertical ? `horizontalAlignment = Alignment.${{ start: "Start", center: "CenterHorizontally", end: "End", baseline: "Start" }[l.counter]}` : `verticalAlignment = Alignment.${{ start: "Top", center: "CenterVertically", end: "Bottom", baseline: "Top" }[l.counter]}`;
        out.push(`${vertical ? "Column" : "Row"}(`, `    ${vertical ? "verticalArrangement" : "horizontalArrangement"} = ${arr},`, `    ${cross},`);
        if (modifier.length) out.push(...modifier.map((m, i) => `    ${m}${i === modifier.length - 1 ? "," : ""}`));
        out.push(") {", ...childNames(doc, sp).map((n) => `    // ${n}`), "}");
        return [{ title: "Compose", lines: out }];
    }
    out.push(sp.image ? "Image(" : "Box(");
    if (sp.image) out.push("    painter = painterResource(id = R.drawable.image),", "    contentDescription = null,", "    contentScale = ContentScale.Crop,");
    if (modifier.length) out.push(...modifier.map((m) => `    ${m}`));
    out.push(")");
    return [{ title: "Compose", lines: out }];
}

function xmlBlocks(node: SceneNode, doc: NagmaDocument, s: CodeSettings): CodeBlock[] {
    const sp = specOf(node);
    const len = (v: number) => androidLen(v, s);
    const id = node.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "view";
    const dim = (d: Spec["width"]) => (d.sizing === "fill" ? "match_parent" : d.sizing === "hug" ? "wrap_content" : len(d.value));
    const attrs: string[] = [`android:id="@+id/${id}"`, `android:layout_width="${dim(sp.width)}"`, `android:layout_height="${dim(sp.height)}"`];
    const fillTok = token(doc, node, "fill:0", "android");
    const needsShape = node.type !== "text" && (sp.radius || sp.border || sp.ellipse);
    let tag = sp.image ? "ImageView" : "View";
    if (node.type === "text") {
        tag = "TextView";
        const c = firstSolid(node.fills);
        attrs.push(`android:text="${(node.text ?? "").replace(/"/g, "&quot;").replace(/\n/g, "\\n")}"`, `android:textSize="${androidLen(node.fontSize ?? 16, s, true)}"`, `android:fontFamily="@font/${(node.fontFamily ?? "inter").toLowerCase().replace(/[^a-z0-9]+/g, "_")}"`);
        if ((node.fontWeight ?? 400) >= 600 || node.italic) attrs.push(`android:textStyle="${[(node.fontWeight ?? 400) >= 600 ? "bold" : "", node.italic ? "italic" : ""].filter(Boolean).join("|")}"`);
        if (fillTok) attrs.push(`android:textColor="@color/${fillTok}"`);
        else if (c) attrs.push(`android:textColor="#${argb(c)}"`);
        if (node.lineHeight != null) attrs.push(`android:lineHeight="${androidLen(node.lineHeight * (node.fontSize ?? 16), s, true)}"`);
        if (node.letterSpacing) attrs.push(`android:letterSpacing="${num(node.letterSpacing / 100)}"`);
        if (node.textAlign && node.textAlign !== "left") attrs.push(`android:gravity="${node.textAlign === "center" ? "center_horizontal" : node.textAlign === "right" ? "end" : "start"}"`);
        if (node.textCase === "upper") attrs.push('android:textAllCaps="true"');
    } else if (sp.layout && !sp.layout.grid) {
        tag = "LinearLayout";
        const l = sp.layout;
        attrs.push(`android:orientation="${l.direction}"`);
        const main = { start: "start", center: "center", end: "end", between: "start", around: "center", evenly: "center" }[l.primary];
        const cross = { start: "start", center: "center", end: "end", baseline: "start" }[l.counter];
        const g = l.direction === "vertical" ? [main === "center" ? "center_vertical" : main === "end" ? "bottom" : "top", cross === "center" ? "center_horizontal" : cross] : [main === "center" ? "center_horizontal" : main, cross === "center" ? "center_vertical" : cross === "end" ? "bottom" : "top"];
        attrs.push(`android:gravity="${g.join("|")}"`);
        const [t, r, b, lft] = l.padding;
        if (t || r || b || lft) {
            if (t === b && r === lft && t === r) attrs.push(`android:padding="${len(t)}"`);
            else attrs.push(`android:paddingStart="${len(lft)}"`, `android:paddingTop="${len(t)}"`, `android:paddingEnd="${len(r)}"`, `android:paddingBottom="${len(b)}"`);
        }
        if (l.gap) attrs.push('android:showDividers="middle"', `android:divider="@drawable/space_${num(l.gap)}"`);
    }
    if (node.type !== "text") {
        if (needsShape) attrs.push(`android:background="@drawable/${id}_background"`);
        else if (fillTok) attrs.push(`android:background="@color/${fillTok}"`);
        else if (sp.fill) attrs.push(`android:background="#${argb(sp.fill)}"`);
    }
    const sh = sp.shadows.find((x) => !x.inner);
    if (sh) attrs.push(`android:elevation="${len(sh.blur / 2)}"`);
    if (sp.opacity < 1) attrs.push(`android:alpha="${num(sp.opacity)}"`);
    if (sp.rotation) attrs.push(`android:rotation="${num(sp.rotation)}"`);
    if (sp.clip && sp.children.length) attrs.push('android:clipChildren="true"');
    const layout = [`<${tag}`, ...attrs.map((a) => `    ${a}`)];
    if (tag === "LinearLayout") layout.push(">", ...childNames(doc, sp).map((n) => `    <!-- ${n} -->`), "</LinearLayout>");
    else layout[layout.length - 1] += " />";
    const blocks: CodeBlock[] = [{ title: "Layout", lines: layout }];
    if (needsShape) {
        const shape = [`<!-- res/drawable/${id}_background.xml -->`, `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="${sp.ellipse ? "oval" : "rectangle"}">`];
        if (fillTok) shape.push(`    <solid android:color="@color/${fillTok}" />`);
        else if (sp.fill) shape.push(`    <solid android:color="#${argb(sp.fill)}" />`);
        if (Array.isArray(sp.radius)) shape.push(`    <corners android:topLeftRadius="${len(sp.radius[0])}" android:topRightRadius="${len(sp.radius[1])}" android:bottomRightRadius="${len(sp.radius[2])}" android:bottomLeftRadius="${len(sp.radius[3])}" />`);
        else if (sp.radius) shape.push(`    <corners android:radius="${len(sp.radius)}" />`);
        if (sp.border) shape.push(`    <stroke android:width="${len(sp.border.width)}" android:color="#${argb(sp.border.color)}" />`);
        shape.push("</shape>");
        blocks.push({ title: "Background drawable", lines: shape });
    }
    return blocks;
}

// ---- Entry --------------------------------------------------------------------------------------

export function codeBlocks(node: SceneNode, doc: NagmaDocument, settings: CodeSettings): CodeBlock[] {
    const s = normalizeSettings(settings);
    // Plugin languages are generated asynchronously (generateCode in engine/plugins.ts).
    if (s.lang.startsWith("plugin:")) return [];
    switch (s.lang as BuiltinLang) {
        case "css":
            return cssBlocks(node, doc, s);
        case "tailwind":
            return tailwindBlocks(node, doc);
        case "swiftui":
            return swiftuiBlocks(node, doc, s);
        case "uikit":
            return uikitBlocks(node, doc, s);
        case "compose":
            return composeBlocks(node, doc, s);
        case "xml":
            return xmlBlocks(node, doc, s);
    }
}

// A length in the chosen unit, for the box model and measurements.
export function formatLength(v: number, settings: CodeSettings): string {
    const s = normalizeSettings(settings);
    if (s.unit === "rem") return `${Math.round((v / s.scale) * 1000) / 1000}`;
    if (s.unit === "pt" || s.unit === "dp") return num(v / s.scale);
    return num(v);
}

const SETTINGS_KEY = "nagma.inspect.code";

export function loadCodeSettings(): CodeSettings {
    // Until you pick a language, Inspect starts with the one the file's team set.
    const team = teamDefaultLanguage();
    const teamLang = CODE_LANGS.find((l) => l.id === team);
    const start = teamLang ? { lang: teamLang.id, unit: teamLang.units[0] as CodeUnit, scale: defaultScale(teamLang.units[0] as CodeUnit) } : DEFAULT_CODE;
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? normalizeSettings({ ...DEFAULT_CODE, ...(JSON.parse(raw) as Partial<CodeSettings>) }) : start;
    } catch {
        return start;
    }
}

export function saveCodeSettings(s: CodeSettings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
        // A per-viewer convenience: without storage the choice lasts for the session.
    }
}

export async function copyText(text: string, what = "Copied.") {
    try {
        await navigator.clipboard.writeText(text);
        editor.notify(what);
    } catch {
        editor.notify("The browser didn't allow copying.");
    }
}

// Copy as code (context menu): each selected layer's code in the given language, under a comment
// with its name, using the Inspect panel's unit settings.
export async function copyAsCode(lang: BuiltinLang) {
    if (refuseExport()) return;
    const { doc, selection } = editor.get();
    const nodes = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (!nodes.length) return;
    const settings = normalizeSettings({ ...loadCodeSettings(), lang });
    const comment = lang === "xml" ? (text: string) => `<!-- ${text} -->` : (text: string) => `// ${text}`;
    const text = nodes
        .map((node) => {
            const blocks = codeBlocks(node, doc, settings);
            // The generators open with the layer's name already; otherwise add it.
            const named = blocks[0]?.lines[0]?.includes(node.name);
            return [...(named ? [] : [comment(node.name)]), ...blocks.map((b) => (blocks.length > 1 ? `${comment(b.title)}\n` : "") + b.lines.join("\n"))].join("\n");
        })
        .join("\n\n");
    await copyText(text, `Copied as ${langInfo(lang).label}.`);
}
