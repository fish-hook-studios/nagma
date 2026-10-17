import { nanoid } from "nanoid";
import { applyCommand } from "../engine/commands";
import { cloneSubtree, makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import type { Command, LayoutGuide, NagmaDocument, SceneNode } from "../engine/types";
import type { DeckData, DeckSection, DeckTheme, NumberFormat, ShapeRole, SlideLayout, TemplateTextStyle, TextRole, ThemeColorKey } from "./types";

// The slides document: one page holding the slides (frames) in rows, one row per section, and the
// deck's settings on that page. Themes, layouts, and keeping slide positions and numbers in step.

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
const GAP = 160;
const ROW_GAP = 320;

// The reference tool's slides accent.
export const SLIDES_ORANGE = "#F24E1E";

export const THEMES: DeckTheme[] = [
    { id: "light", name: "Light slides", background: "#FFFFFF", surface: "#D1D1D1", text: "#000000", muted: "#50839A", accent: "#3C39F3", headingFont: "Inter", bodyFont: "Inter", headingWeight: 700, names: { background: "White", surface: "Light grey", text: "Black", muted: "Slate", accent: "Blue" } },
    { id: "dark", name: "Dark slides", background: "#000000", surface: "#2B2B2B", text: "#FFFFFF", muted: "#9AA7B0", accent: "#7B79FF", headingFont: "Inter", bodyFont: "Inter", headingWeight: 700, names: { background: "Black", surface: "Charcoal", text: "White", muted: "Silver", accent: "Periwinkle" } },
    { id: "paper", name: "Paper", background: "#FFFFFF", surface: "#F1F1EF", text: "#1E1E1E", muted: "#6B6B6B", accent: "#FF7237", headingFont: "Inter", bodyFont: "Inter", headingWeight: 700 },
    { id: "night", name: "Night", background: "#141416", surface: "#26262B", text: "#FFFFFF", muted: "#A3A3AD", accent: "#FF9361", headingFont: "Inter", bodyFont: "Inter", headingWeight: 700 },
    { id: "editorial", name: "Editorial", background: "#F6F1E7", surface: "#E9DFCC", text: "#2B2118", muted: "#7A6A58", accent: "#B5452A", headingFont: "Playfair Display", bodyFont: "Source Serif 4", headingWeight: 700 },
    { id: "ocean", name: "Ocean", background: "#0B2545", surface: "#13315C", text: "#EEF4ED", muted: "#8DA9C4", accent: "#5FD3F3", headingFont: "Space Grotesk", bodyFont: "DM Sans", headingWeight: 700 },
    { id: "mint", name: "Mint", background: "#E8F5EE", surface: "#CDEBDB", text: "#12372A", muted: "#4F7A68", accent: "#1F8A5B", headingFont: "DM Sans", bodyFont: "DM Sans", headingWeight: 700 },
    { id: "sunset", name: "Sunset", background: "#FFEDE1", surface: "#FFD9C2", text: "#3A1F1D", muted: "#8A5A4F", accent: "#E4572E", headingFont: "Source Sans 3", bodyFont: "Source Sans 3", headingWeight: 700 },
    { id: "terminal", name: "Terminal", background: "#0E1117", surface: "#1B2130", text: "#E6EDF3", muted: "#8B949E", accent: "#3FB950", headingFont: "JetBrains Mono", bodyFont: "Inter", headingWeight: 700 },
];

export const FONT_CHOICES = ["Inter", "DM Sans", "Space Grotesk", "Source Sans 3", "Source Serif 4", "Playfair Display", "JetBrains Mono"];

export const LAYOUTS: { id: SlideLayout; label: string }[] = [
    { id: "title", label: "Title" },
    { id: "title-body", label: "Title and body" },
    { id: "two-columns", label: "Two columns" },
    { id: "three-columns", label: "Three columns" },
    { id: "section", label: "Section header" },
    { id: "agenda", label: "Agenda" },
    { id: "image-text", label: "Image and text" },
    { id: "text-image", label: "Text and image" },
    { id: "full-image", label: "Full image" },
    { id: "comparison", label: "Comparison" },
    { id: "quote", label: "Quote" },
    { id: "big-number", label: "Big number" },
    { id: "closing", label: "Closing" },
    { id: "blank", label: "Blank" },
];

export const ROLE_LABELS: Record<TextRole, string> = {
    title: "Title",
    subtitle: "Subtitle",
    heading: "Heading",
    body: "Body",
    caption: "Caption",
    quote: "Quote",
    number: "Big number",
    "slide-number": "Slide number",
    footer: "Footer",
};

const ROLE_SIZES: Record<TextRole, number> = { title: 96, subtitle: 40, heading: 72, body: 40, caption: 32, quote: 72, number: 280, "slide-number": 24, footer: 24 };

// A text role's look in a theme: font, weight and colour (and its default size). A text style
// the template added wins over the role.
export function roleStyle(theme: DeckTheme, role: TextRole, styleId?: string): Partial<SceneNode> {
    const style = styleId ? theme.textStyles?.find((t) => t.id === styleId) : undefined;
    if (style) return textStyleLook(theme, style);
    const heading = role === "title" || role === "heading" || role === "number" || role === "quote";
    const color = role === "number" ? theme.accent : role === "caption" || role === "slide-number" || role === "footer" ? theme.muted : theme.text;
    const weight = role === "quote" ? 500 : heading ? theme.headingWeight : role === "slide-number" ? 500 : 400;
    return { fontFamily: heading ? theme.headingFont : theme.bodyFont, fontWeight: weight, fills: [solid(color)] };
}

export function textStyleLook(theme: DeckTheme, style: TemplateTextStyle): Partial<SceneNode> {
    return { fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontSize: style.fontSize, fills: [solid(templateColor(theme, style.color))] };
}

export function roleSize(role: TextRole): number {
    return ROLE_SIZES[role];
}

function shapeColor(theme: DeckTheme, role: ShapeRole): string {
    return role === "accent" ? theme.accent : theme.surface;
}

// ---- Template colours ----

export const COLOR_KEYS: ThemeColorKey[] = ["background", "surface", "text", "muted", "accent"];
const COLOR_LABELS: Record<ThemeColorKey, string> = { background: "Background", surface: "Surface", text: "Text", muted: "Muted", accent: "Accent" };

// Every colour of a template with its name: the five it always has, then any it added.
export function templateColors(theme: DeckTheme): { id: string; name: string; color: string }[] {
    return [...COLOR_KEYS.map((key) => ({ id: key, name: theme.names?.[key] ?? COLOR_LABELS[key], color: theme[key] })), ...(theme.colors ?? [])];
}

// A colour of the template by key or id (a hex code stays as it is).
export function templateColor(theme: DeckTheme, key: string): string {
    if ((COLOR_KEYS as string[]).includes(key)) return theme[key as ThemeColorKey];
    return theme.colors?.find((c) => c.id === key)?.color ?? (key.startsWith("#") ? key : theme.text);
}

// "Remix template colours": the accent turns round the colour wheel and the surface and muted
// colours follow it, keeping the background and text (so contrast holds).
export function remixTheme(theme: DeckTheme): DeckTheme {
    const shift = (hex: string, by: number) => {
        const [h, sat, l] = toHsl(hex);
        return fromHsl((h + by) % 360, sat, l);
    };
    const step = 47;
    return {
        ...theme,
        accent: shift(theme.accent, step),
        surface: shift(theme.surface, step),
        muted: shift(theme.muted, step),
        colors: theme.colors?.map((c) => ({ ...c, color: shift(c.color, step) })),
    };
}

function toHsl(hex: string): [number, number, number] {
    // #RGB means #RRGGBB (padding "FFF" with zeros made yellow).
    const raw = hex.replace("#", "");
    const n = Number.parseInt((raw.length === 3 || raw.length === 4 ? [...raw.slice(0, 3)].map((c) => c + c).join("") : raw.slice(0, 6).padEnd(6, "0")) || "0", 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, sat, l];
}

function fromHsl(h: number, sat: number, l: number): string {
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// ---- Reading the deck ----

export function deckPage(doc: NagmaDocument): SceneNode | undefined {
    return doc.nodes[doc.roots[0] ?? ""];
}

export type Deck = Extract<DeckData, { kind: "deck" }>;
export type SlideInfo = Extract<DeckData, { kind: "slide" }>;

const DEFAULT_SECTION: DeckSection = { id: "main", name: "Section 1" };

export function deckOf(doc: NagmaDocument): Deck {
    const data = deckPage(doc)?.deck;
    if (data?.kind === "deck") return data.sections.length ? data : { ...data, sections: [DEFAULT_SECTION] };
    return { kind: "deck", theme: THEMES[0] as DeckTheme, sections: [DEFAULT_SECTION] };
}

export function slideOf(node: SceneNode | undefined): SlideInfo | null {
    return node?.deck?.kind === "slide" ? node.deck : null;
}

// The templates this deck uses: the main one first.
export function templatesOf(doc: NagmaDocument): DeckTheme[] {
    const deck = deckOf(doc);
    return [deck.theme, ...(deck.themes ?? []).filter((t) => t.id !== deck.theme.id)];
}

// The template a slide follows (the deck's main one unless it chose another).
export function themeOf(doc: NagmaDocument, slideId: string | null | undefined): DeckTheme {
    const deck = deckOf(doc);
    const id = slideOf(doc.nodes[slideId ?? ""])?.theme;
    return (id && deck.themes?.find((t) => t.id === id)) || deck.theme;
}

// The slide a layer is on.
export function slideAround(doc: NagmaDocument, nodeId: string | null | undefined): SceneNode | undefined {
    let node: SceneNode | undefined = doc.nodes[nodeId ?? ""];
    while (node && !slideOf(node)) node = node.parentId ? doc.nodes[node.parentId] : undefined;
    return node;
}

// The section a slide sits in (an unknown or missing one counts as the first).
export function sectionOf(deck: Deck, slide: SceneNode): string {
    const id = slideOf(slide)?.section;
    return id && deck.sections.some((s) => s.id === id) ? id : (deck.sections[0]?.id ?? "main");
}

// Slides in deck order: section by section, each in page order.
export function slideIds(doc: NagmaDocument): string[] {
    const page = deckPage(doc);
    if (!page) return [];
    const deck = deckOf(doc);
    const slides = page.children.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && slideOf(n)));
    return deck.sections.flatMap((section) => slides.filter((s) => sectionOf(deck, s) === section.id).map((s) => s.id));
}

export function slidesBySection(doc: NagmaDocument): { section: DeckSection; ids: string[] }[] {
    const deck = deckOf(doc);
    const page = deckPage(doc);
    const slides = (page?.children ?? []).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n && slideOf(n)));
    return deck.sections.map((section) => ({ section, ids: slides.filter((s) => sectionOf(deck, s) === section.id).map((s) => s.id) }));
}

// The numbers shown on slides: skipped slides don't count.
export function slideNumbers(doc: NagmaDocument): Map<string, number> {
    const out = new Map<string, number>();
    let n = 0;
    for (const id of slideIds(doc)) {
        if (!slideOf(doc.nodes[id])?.skip) out.set(id, ++n);
    }
    return out;
}

// ---- Groups ----

export interface SlideGroup {
    section: DeckSection;
    ids: string[];
}

// A group's name, or the slides it holds.
export function groupLabel(group: { section: { name: string }; ids: string[] }, all: string[]): string {
    if (group.section.name) return group.section.name;
    const first = all.indexOf(group.ids[0] ?? "") + 1;
    return `Slides ${first} to ${first + group.ids.length - 1}`;
}

export function newGroup(name = ""): DeckSection {
    return { id: nanoid(8), name };
}

// The deck rearranged into these groups, in this order: groups left empty go, slides take the
// group they're listed in and the page keeps them in deck order.
export function arrangeCommands(doc: NagmaDocument, groups: SlideGroup[]): Command[] {
    const page = deckPage(doc);
    if (!page) return [];
    const kept = groups.filter((g) => g.ids.length);
    const sections = (kept.length ? kept : groups.slice(0, 1)).map((g) => g.section);
    const out: Command[] = [{ type: "node.update", id: page.id, patch: { deck: { ...deckOf(doc), sections, groups: true } } }];
    let index = 0;
    for (const g of kept) {
        for (const id of g.ids) {
            const info = slideOf(doc.nodes[id]);
            if (!info) continue;
            if (info.section !== g.section.id) out.push({ type: "node.update", id, patch: { deck: { ...info, section: g.section.id } } });
            if (page.children[index] !== id) out.push({ type: "node.reparent", id, parentId: page.id, index });
            index++;
        }
    }
    return out;
}

// ---- Making slides ----

type Place = { x: number; y: number; w: number; h?: number };

function text(doc: NagmaDocument, slide: SceneNode, theme: DeckTheme, role: TextRole, content: string, at: Place, extra: Partial<SceneNode> = {}): SceneNode {
    return makeNode(doc, "text", { x: slide.x + at.x, y: slide.y + at.y, w: at.w, h: at.h ?? roleSize(role) * 1.2 }, slide.id, {
        name: ROLE_LABELS[role],
        text: content,
        fontSize: roleSize(role),
        lineHeight: role === "body" || role === "caption" ? 1.4 : 1.15,
        sizing: { h: "fixed", v: "hug" },
        ...roleStyle(theme, role),
        deck: { kind: "text", role },
        ...extra,
    });
}

// Media placeholders are checkered until a picture fills them.
export const PLACEHOLDER_IMAGE = "slides-placeholder";
const PLACEHOLDER_DATA = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#F4F4F4'/><rect width='40' height='40' fill='#E4E4E4'/><rect x='40' y='40' width='40' height='40' fill='#E4E4E4'/></svg>")}`;

export function placeholderPaint() {
    return { type: "image" as const, id: PLACEHOLDER_IMAGE, mode: "tile" as const, tileScale: 1, opacity: 1, visible: true, blend: "normal" as const };
}

// The checkered picture, added to the file when it isn't there yet.
export function placeholderImageCommands(doc: NagmaDocument): Command[] {
    return doc.images[PLACEHOLDER_IMAGE] ? [] : [{ type: "image.add", id: PLACEHOLDER_IMAGE, data: PLACEHOLDER_DATA }];
}

// Whether a layer still shows the checkered placeholder (no picture of its own yet).
export function isEmptyPlaceholder(node: SceneNode): boolean {
    return !node.fills.some((p) => p.type === "image" && p.id !== PLACEHOLDER_IMAGE);
}

function shape(doc: NagmaDocument, slide: SceneNode, theme: DeckTheme, role: ShapeRole, name: string, at: Place, extra: Partial<SceneNode> = {}): SceneNode {
    const fills = role === "placeholder" ? [placeholderPaint()] : [solid(shapeColor(theme, role))];
    return makeNode(doc, "rect", { x: slide.x + at.x, y: slide.y + at.y, w: at.w, h: at.h ?? 10 }, slide.id, { name, fills, deck: { kind: "shape", role }, ...extra });
}

// The layers a layout puts on a slide (the slide must already be in `doc`).
export function layoutLayers(doc: NagmaDocument, slide: SceneNode, layout: SlideLayout, theme: DeckTheme): SceneNode[] {
    const W = slide.w;
    const H = slide.h;
    const left = { textAlign: "left" as const };
    const center = { textAlign: "center" as const };
    switch (layout) {
        case "title":
            return [
                text(doc, slide, theme, "title", "Slide Deck Title", { x: 128, y: H / 2 - 100, w: W - 256 }, left),
                text(doc, slide, theme, "subtitle", "This is just the beginning of something big.", { x: 128, y: H / 2 + 42, w: W - 256 }, left),
            ];
        case "title-body":
            return [
                text(doc, slide, theme, "heading", "Slide title", { x: 120, y: 110, w: W - 240 }, left),
                text(doc, slide, theme, "body", "First point\nSecond point\nThird point", { x: 120, y: 290, w: W - 240 }, { ...left, list: "bullet" }),
            ];
        case "two-columns":
            return [
                text(doc, slide, theme, "heading", "Two columns", { x: 120, y: 110, w: W - 240 }, left),
                text(doc, slide, theme, "body", "The first column of text goes here.", { x: 120, y: 290, w: (W - 320) / 2 }, left),
                text(doc, slide, theme, "body", "The second column of text goes here.", { x: W / 2 + 40, y: 290, w: (W - 320) / 2 }, left),
            ];
        case "three-columns": {
            const cw = (W - 240 - 2 * 60) / 3;
            return [
                text(doc, slide, theme, "heading", "Three columns", { x: 120, y: 110, w: W - 240 }, left),
                ...[0, 1, 2].flatMap((i) => [
                    text(doc, slide, theme, "subtitle", `Point ${i + 1}`, { x: 120 + i * (cw + 60), y: 300, w: cw }, left),
                    text(doc, slide, theme, "body", "A sentence or two about this point.", { x: 120 + i * (cw + 60), y: 380, w: cw }, left),
                ]),
            ];
        }
        case "agenda":
            return [
                text(doc, slide, theme, "heading", "Agenda", { x: 120, y: 110, w: W - 240 }, left),
                text(doc, slide, theme, "body", "Where we are\nWhat we learned\nWhat comes next\nQuestions", { x: 120, y: 290, w: W - 240 }, { ...left, list: "number" }),
            ];
        case "text-image":
            return [
                text(doc, slide, theme, "heading", "A point and a picture", { x: 120, y: 300, w: W / 2 - 220 }, left),
                text(doc, slide, theme, "body", "Say what the picture shows and why it matters.", { x: 120, y: 480, w: W / 2 - 220 }, left),
                shape(doc, slide, theme, "placeholder", "Image", { x: W / 2, y: 0, w: W / 2, h: H }),
            ];
        case "full-image":
            return [
                shape(doc, slide, theme, "placeholder", "Image", { x: 0, y: 0, w: W, h: H }),
                text(doc, slide, theme, "caption", "A caption for the picture", { x: 120, y: H - 160, w: W - 240 }, left),
            ];
        case "comparison":
            return [
                text(doc, slide, theme, "heading", "Comparison", { x: 120, y: 110, w: W - 240 }, left),
                shape(doc, slide, theme, "surface", "Left panel", { x: 120, y: 280, w: (W - 300) / 2, h: H - 400 }, { radius: 24 }),
                shape(doc, slide, theme, "surface", "Right panel", { x: W / 2 + 30, y: 280, w: (W - 300) / 2, h: H - 400 }, { radius: 24 }),
                text(doc, slide, theme, "subtitle", "Before", { x: 180, y: 330, w: (W - 300) / 2 - 120 }, left),
                text(doc, slide, theme, "body", "How it was.", { x: 180, y: 410, w: (W - 300) / 2 - 120 }, left),
                text(doc, slide, theme, "subtitle", "After", { x: W / 2 + 90, y: 330, w: (W - 300) / 2 - 120 }, left),
                text(doc, slide, theme, "body", "How it is now.", { x: W / 2 + 90, y: 410, w: (W - 300) / 2 - 120 }, left),
            ];
        case "closing":
            return [
                text(doc, slide, theme, "title", "Thank you", { x: 160, y: H / 2 - 120, w: W - 320 }, center),
                text(doc, slide, theme, "caption", "Questions? Get in touch.", { x: 160, y: H / 2 + 40, w: W - 320 }, center),
            ];
        case "section":
            return [
                shape(doc, slide, theme, "accent", "Accent", { x: 120, y: H / 2 - 120, w: 120, h: 12 }),
                text(doc, slide, theme, "title", "Section title", { x: 120, y: H / 2 - 80, w: W - 240 }, left),
                text(doc, slide, theme, "caption", "What this part is about", { x: 120, y: H / 2 + 90, w: W - 240 }, left),
            ];
        case "image-text":
            return [
                shape(doc, slide, theme, "placeholder", "Image", { x: 0, y: 0, w: W / 2, h: H }),
                text(doc, slide, theme, "heading", "A picture and a point", { x: W / 2 + 100, y: 300, w: W / 2 - 220 }, left),
                text(doc, slide, theme, "body", "Say what the picture shows and why it matters.", { x: W / 2 + 100, y: 480, w: W / 2 - 220 }, left),
            ];
        case "quote":
            return [
                text(doc, slide, theme, "quote", "“A quote that sums it all up.”", { x: 200, y: H / 2 - 160, w: W - 400 }, center),
                text(doc, slide, theme, "caption", "Name, Role", { x: 200, y: H / 2 + 120, w: W - 400 }, center),
            ];
        case "big-number":
            return [
                text(doc, slide, theme, "number", "87%", { x: 160, y: H / 2 - 260, w: W - 320 }, center),
                text(doc, slide, theme, "caption", "What the number means", { x: 160, y: H / 2 + 110, w: W - 320 }, center),
            ];
        case "blank":
            return [];
    }
}

// A fresh slide's layout guides: one row and one column inside the layouts' margins. They start
// clear (0% opacity) so slides aren't tinted; things still snap to their edges, and raising the
// opacity shows them.
export const SLIDE_GUIDES: LayoutGuide[] = [
    { kind: "rows", count: 1, gutter: 0, margin: 110, size: 0, color: "#FF0000", visible: true, align: "stretch", opacity: 0 },
    { kind: "columns", count: 1, gutter: 0, margin: 120, size: 0, color: "#FF0000", visible: true, align: "stretch", opacity: 0 },
];

// A new slide frame (not yet in the document) with the layout's layers, in the deck's main
// template or the one given.
export function makeSlide(doc: NagmaDocument, layout: SlideLayout, section?: string, theme?: DeckTheme): SceneNode[] {
    const deck = deckOf(doc);
    const page = deckPage(doc);
    const count = slideIds(doc).length;
    const look = theme ?? deck.theme;
    const frame = makeNode(doc, "frame", { x: 0, y: -(SLIDE_H + ROW_GAP) * 4, w: SLIDE_W, h: SLIDE_H }, page?.id ?? null, {
        name: `Slide ${count + 1}`,
        fills: [solid(look.background)],
        clip: true,
        guides: SLIDE_GUIDES.map((g) => ({ ...g })),
        deck: { kind: "slide", layout, section: section ?? deck.sections[0]?.id, ...(look.id !== deck.theme.id ? { theme: look.id } : {}) },
    });
    const withFrame = applyCommand(doc, { type: "node.create", node: frame });
    return [frame, ...layoutLayers(withFrame, frame, layout, look)];
}

// Where a new slide after `anchorId` goes: into the anchor's group when it has several slides,
// else into a group of its own right after the anchor's (at the end without an anchor). The
// command adds that new group to the deck.
export function placeAfter(doc: NagmaDocument, anchorId: string | null, join = false, before = false): { section: string; deck?: Command } {
    const deck = deckOf(doc);
    const page = deckPage(doc);
    const anchor = anchorId ? doc.nodes[anchorId] : undefined;
    if (!deck.groups || !page) return { section: anchor ? sectionOf(deck, anchor) : (deck.sections[0]?.id ?? "main") };
    const rows = slidesBySection(doc);
    const row = anchor ? rows.find((r) => r.ids.includes(anchor.id)) : rows[rows.length - 1];
    if (anchor && row && (row.ids.length > 1 || join)) return { section: row.section.id };
    const section: DeckSection = { id: nanoid(8), name: "" };
    const sections = [...deck.sections];
    sections.splice(row ? sections.findIndex((s) => s.id === row.section.id) + (anchor && before ? 0 : 1) : sections.length, 0, section);
    return { section: section.id, deck: { type: "node.update", id: page.id, patch: { deck: { ...deck, sections } } } };
}

// The commands that add a slide after `after` (or at the end); with `before`, just before it.
export function addSlideCommands(doc: NagmaDocument, layout: SlideLayout, after?: string | null, theme?: DeckTheme, join = false, before = false): { commands: Command[]; id: string } {
    const page = deckPage(doc);
    const anchor = after ? doc.nodes[after] : undefined;
    const place = placeAfter(doc, anchor?.id ?? null, join, before);
    const working = place.deck ? applyCommand(doc, place.deck) : doc;
    const nodes = makeSlide(working, layout, place.section, theme);
    const frame = nodes[0] as SceneNode;
    const index = anchor && page ? page.children.indexOf(anchor.id) + (before ? 0 : 1) : undefined;
    const creates = nodes.map((node, i) => ({ type: "node.create" as const, node, ...(i === 0 && index !== undefined ? { index } : {}) }));
    const images = nodes.some((n) => n.deck?.kind === "shape" && n.deck.role === "placeholder") ? placeholderImageCommands(doc) : [];
    return { commands: [...images, ...(place.deck ? [place.deck] : []), ...creates], id: frame.id };
}

export function duplicateSlideCommands(doc: NagmaDocument, id: string): { commands: Command[]; id: string } | null {
    const page = deckPage(doc);
    const node = doc.nodes[id];
    if (!page || !node) return null;
    const copies = cloneSubtree(doc, id, 0, page.id).map((n) => ({ ...n, children: [] as string[] }));
    const first = copies[0];
    if (!first) return null;
    // Animations point at the copied layers.
    const ids = new Map<string, string>();
    const flat: string[] = [];
    const collect = (nid: string) => {
        flat.push(nid);
        for (const c of doc.nodes[nid]?.children ?? []) collect(c);
    };
    collect(id);
    flat.forEach((old, i) => ids.set(old, copies[i]?.id ?? old));
    const info = slideOf(first);
    // A copy of a slide in a group joins the group; a slide on its own gets a copy on its own.
    const place = placeAfter(doc, id);
    if (info) first.deck = { ...info, section: place.section, ...(info.animations ? { animations: info.animations.map((a) => ({ ...a, id: nanoid(8), target: ids.get(a.target) ?? a.target })) } : {}) };
    first.name = `${node.name} copy`;
    const index = page.children.indexOf(id) + 1;
    return { commands: [...(place.deck ? [place.deck] : []), ...copies.map((n, i) => ({ type: "node.create" as const, node: n, ...(i === 0 ? { index } : {}) }))], id: first.id };
}

// ---- Keeping the deck tidy ----

// Slides laid out in rows (a row per section), and slide numbers matching the setting.
export function numberLabel(n: number, total: number, format: NumberFormat = "plain"): string {
    return format === "slash" ? `${n} / ${total}` : format === "of" ? `${n} of ${total}` : String(n);
}

export function tidyCommands(doc: NagmaDocument): Command[] {
    const out: Command[] = [];
    const deck = deckOf(doc);
    const numbers = slideNumbers(doc);
    const total = numbers.size;
    const footer = deck.footer?.trim() ?? "";
    // Groups left without slides go.
    const rows = slidesBySection(doc);
    const page = deckPage(doc);
    if (deck.groups && page && rows.some((r) => !r.ids.length) && rows.some((r) => r.ids.length)) {
        out.push({ type: "node.update", id: page.id, patch: { deck: { ...deck, sections: rows.filter((r) => r.ids.length).map((r) => r.section) } } });
    }
    let position = 0;
    rows.filter((r) => r.ids.length || !deck.groups).forEach(({ ids }, row) => {
        ids.forEach((id, col) => {
            const node = doc.nodes[id];
            if (!node) return;
            const x = col * (SLIDE_W + GAP);
            const y = row * (SLIDE_H + ROW_GAP);
            if (node.x !== x || node.y !== y) out.push({ type: "node.move", ids: [id], dx: x - node.x, dy: y - node.y });
            // Slides still called "Slide n" keep the name of their place in the deck.
            const name = `Slide ${++position}`;
            if (/^Slide \d+( copy)?$/.test(node.name) && node.name !== name) out.push({ type: "node.update", id, patch: { name } });
            // Slide numbers: one text in the corner, kept to the slide's place in the deck, and any
            // put on the slide by hand (Insert > Slide number), which stay whatever the setting.
            const numberTexts = node.children.map((c) => doc.nodes[c]).filter((c): c is SceneNode => c?.deck?.kind === "text" && c.deck.role === "slide-number");
            const placed = numberTexts.filter((c) => c.deck?.kind === "text" && c.deck.placed);
            const existing = numberTexts.find((c) => !placed.includes(c));
            const n = numbers.get(id);
            for (const p of placed) {
                const format = p.deck?.kind === "text" ? (p.deck.format ?? deck.numberFormat) : deck.numberFormat;
                const label = n === undefined ? "" : numberLabel(n, total, format);
                if (p.text !== label) out.push({ type: "node.update", id: p.id, patch: { text: label } });
            }
            if (deck.slideNumbers && n !== undefined && !placed.length) {
                const label = numberLabel(n, total, deck.numberFormat);
                if (existing) {
                    if (existing.text !== label) out.push({ type: "node.update", id: existing.id, patch: { text: label } });
                } else {
                    const made = text(doc, { ...node, x, y }, themeOf(doc, id), "slide-number", label, { x: node.w - 320, y: node.h - 80, w: 240 }, { textAlign: "right" });
                    out.push({ type: "node.create", node: { ...made, x: x + node.w - 320, y: y + node.h - 80 } });
                }
            } else if (existing) out.push({ type: "node.delete", ids: [existing.id] });
            // The footer: one text in the bottom left of every slide that doesn't opt out.
            const foot = node.children.map((c) => doc.nodes[c]).find((c) => c?.deck?.kind === "text" && c.deck.role === "footer");
            if (footer && !slideOf(node)?.noFooter) {
                if (foot) {
                    if (foot.text !== footer) out.push({ type: "node.update", id: foot.id, patch: { text: footer } });
                } else {
                    const made = text(doc, { ...node, x, y }, themeOf(doc, id), "footer", footer, { x: 120, y: node.h - 80, w: node.w - 560 }, { textAlign: "left" });
                    out.push({ type: "node.create", node: { ...made, x: x + 120, y: y + node.h - 80 } });
                }
            } else if (foot) out.push({ type: "node.delete", ids: [foot.id] });
        });
    });
    return out;
}

// Runs edits to the deck as one undo step, with the slides tidied afterwards.
export function deckBatch(doc: NagmaDocument, commands: Command[]): Command {
    const after = applyCommand(doc, { type: "batch", commands });
    return { type: "batch", commands: [...commands, ...tidyCommands(after)] };
}

// ---- Templates ----

// Restyles one slide for a template: its background (unless it chose its own), text by role or
// text style, and accent and placeholder shapes (a placeholder filled with a picture keeps it).
export function restyleCommands(doc: NagmaDocument, id: string, theme: DeckTheme): Command[] {
    const slide = doc.nodes[id];
    const info = slideOf(slide);
    if (!slide || !info) return [];
    const out: Command[] = [];
    if (!info.background) out.push({ type: "node.update", id, patch: { fills: [solid(theme.background)] } });
    const visit = (nid: string) => {
        const node = doc.nodes[nid];
        if (!node) return;
        if (node.deck?.kind === "text") {
            const style = roleStyle(theme, node.deck.role, node.deck.style);
            // Spans that set their own colour or font would hide the template's.
            out.push({ type: "node.update", id: nid, patch: { ...style, spans: node.spans?.map(({ fills: _f, fontFamily: _ff, ...rest }) => rest) } });
        } else if (node.deck?.kind === "shape" && !node.fills.some((p) => p.type === "image")) out.push({ type: "node.update", id: nid, patch: { fills: [solid(shapeColor(theme, node.deck.role))] } });
        for (const c of node.children) visit(c);
    };
    for (const c of slide.children) visit(c);
    return out;
}

// The deck's templates written back: the main one and the others still in use by a slide.
function templatesCommand(doc: NagmaDocument, main: DeckTheme, others: DeckTheme[], uses: Map<string, string | undefined>): Command | null {
    const page = deckPage(doc);
    if (!page) return null;
    const used = new Set<string>();
    for (const id of slideIds(doc)) {
        const t = uses.has(id) ? uses.get(id) : slideOf(doc.nodes[id])?.theme;
        if (t) used.add(t);
    }
    const themes = others.filter((t, i) => t.id !== main.id && used.has(t.id) && others.findIndex((o) => o.id === t.id) === i);
    return { type: "node.update", id: page.id, patch: { deck: { ...deckOf(doc), theme: main, themes: themes.length ? themes : undefined } } };
}

// Puts slides on a template (every slide when `ids` is absent: it becomes the deck's main
// template), restyling them.
export function templateCommands(doc: NagmaDocument, given: DeckTheme, ids?: string[]): Command[] {
    const deck = deckOf(doc);
    // A different template under an id this deck already uses (built-in Light over a remixed
    // Light, or another deck's) joins as a copy of its own when only some slides take it: sharing
    // the id replaced the deck's template for every slide but restyled only those.
    const taken = [deck.theme, ...(deck.themes ?? [])].find((t) => t.id === given.id);
    const theme = ids && taken && JSON.stringify(taken) !== JSON.stringify(given) ? { ...given, id: `${given.id}-${nanoid(6)}` } : given;
    const all = slideIds(doc);
    const targets = ids ?? all;
    const main = ids ? (deck.theme.id === theme.id ? theme : deck.theme) : theme;
    const others = ids ? [...(deck.themes ?? []).filter((t) => t.id !== theme.id), ...(theme.id !== main.id ? [theme] : [])] : (deck.themes ?? []).filter((t) => t.id !== theme.id);
    const uses = new Map<string, string | undefined>();
    const out: Command[] = [];
    for (const id of targets) {
        const info = slideOf(doc.nodes[id]);
        if (!info) continue;
        const next = theme.id === main.id ? undefined : theme.id;
        uses.set(id, next);
        if (info.theme !== next) out.push({ type: "node.update", id, patch: { deck: { ...info, theme: next } } });
        out.push(...restyleCommands(doc, id, theme));
    }
    const write = templatesCommand(doc, main, others, uses);
    return write ? [write, ...out] : out;
}

// A template changed (colours, fonts, text styles): it replaces the one with its id and every
// slide on it is restyled.
export function editTemplateCommands(doc: NagmaDocument, theme: DeckTheme): Command[] {
    const deck = deckOf(doc);
    const isMain = deck.theme.id === theme.id;
    const page = deckPage(doc);
    if (!page) return [];
    const out: Command[] = [{ type: "node.update", id: page.id, patch: { deck: { ...deck, theme: isMain ? theme : deck.theme, themes: deck.themes?.map((t) => (t.id === theme.id ? theme : t)) } } }];
    for (const id of slideIds(doc)) if (themeOf(doc, id).id === theme.id) out.push(...restyleCommands(doc, id, theme));
    return out;
}

// The whole deck on one template (the template picker over a new deck).
export function themeCommands(doc: NagmaDocument, theme: DeckTheme): Command[] {
    return templateCommands(doc, theme);
}

// ---- The document ----

export function createSlidesDocument(name: string): NagmaDocument {
    const base: NagmaDocument = { name, nodes: {}, roots: [], images: {}, slides: true };
    const page = makeNode(base, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Slides", deck: { kind: "deck", theme: THEMES[0] as DeckTheme, sections: [{ ...DEFAULT_SECTION }], picker: true, groups: true } });
    let doc = applyCommand(base, { type: "node.create", node: page });
    const first = addSlideCommands(doc, "title");
    doc = applyCommand(doc, { type: "batch", commands: first.commands });
    return applyCommand(doc, { type: "batch", commands: tidyCommands(doc) });
}

export function isSlides(doc: NagmaDocument | null | undefined): boolean {
    return Boolean(doc?.slides);
}
