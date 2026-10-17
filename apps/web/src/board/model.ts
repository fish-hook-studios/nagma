import { makeNode } from "../engine/nodes";
import { solid } from "../engine/paint";
import type { NagmaDocument, PathPoint, SceneNode, Subpath, VectorPath } from "../engine/types";
import type { ConnectorCap, ConnectorEnd, ConnectorLine, JamData, JamFont, ShapeKind, StampKind, StampPick, WashiPattern } from "./types";

// Board objects: what they look like when made, the shapes' outlines, and the board document.

export const STICKY_COLORS: { name: string; color: string }[] = [
    { name: "White", color: "#FFFFFF" },
    { name: "Gray", color: "#E6E6E6" },
    { name: "Green", color: "#B3EFBD" },
    { name: "Teal", color: "#B3F4EF" },
    { name: "Blue", color: "#A8DAFF" },
    { name: "Violet", color: "#D3BDFF" },
    { name: "Pink", color: "#FFA8DB" },
    { name: "Red", color: "#FFB8A8" },
    { name: "Orange", color: "#FFD3A8" },
    { name: "Yellow", color: "#FFE299" },
];

// The palette for shapes, sections, marker doodles, connectors and text: a light row and a strong row.
export const LIGHT_COLORS: { name: string; color: string }[] = [
    { name: "White", color: "#FFFFFF" },
    { name: "Light gray", color: "#D9D9D9" },
    { name: "Gray", color: "#B3B3B3" },
    { name: "Light green", color: "#CDF4D3" },
    { name: "Light teal", color: "#C6FAF6" },
    { name: "Light blue", color: "#C2E5FF" },
    { name: "Light violet", color: "#E4CCFF" },
    { name: "Light pink", color: "#FFC2EC" },
    { name: "Light red", color: "#FFCDC2" },
    { name: "Light orange", color: "#FFE0C2" },
    { name: "Light yellow", color: "#FFECBD" },
];

export const STRONG_COLORS: { name: string; color: string }[] = [
    { name: "Black", color: "#1E1E1E" },
    { name: "Dark gray", color: "#757575" },
    { name: "Green", color: "#66D575" },
    { name: "Teal", color: "#5AD8CC" },
    { name: "Blue", color: "#3DADFF" },
    { name: "Violet", color: "#9747FF" },
    { name: "Pink", color: "#F849C1" },
    { name: "Red", color: "#FF7556" },
    { name: "Orange", color: "#FF9E42" },
    { name: "Yellow", color: "#FFC943" },
];

// Marker, connector and text colours: the strong row, then gray and white.
export const INK_COLORS: { name: string; color: string }[] = [...STRONG_COLORS, { name: "Gray", color: "#B3B3B3" }, { name: "White", color: "#FFFFFF" }];

// The highlighter's own soft palette.
export const HIGHLIGHT_COLORS: { name: string; color: string }[] = [
    { name: "Gray", color: "#D9D9D9" },
    { name: "Pink", color: "#FFBDF2" },
    { name: "Orange", color: "#FCD19C" },
    { name: "Yellow", color: "#FFFAA3" },
    { name: "Green", color: "#AFF4C6" },
    { name: "Blue", color: "#B6ECF7" },
    { name: "Violet", color: "#E4CCFF" },
    { name: "White", color: "#FFFFFF" },
];

// Shape fills: the light row, then the strong row.
export const SHAPE_COLORS: { name: string; color: string }[] = [...LIGHT_COLORS, ...STRONG_COLORS];

export const SECTION_COLORS: { name: string; color: string }[] = [
    { name: "White", color: "#FFFFFF" },
    { name: "Gray", color: "#F2F2F2" },
    { name: "Green", color: "#E6F9E9" },
    { name: "Teal", color: "#E3FCFA" },
    { name: "Blue", color: "#E1F2FF" },
    { name: "Violet", color: "#F2E6FF" },
    { name: "Pink", color: "#FFE1F6" },
    { name: "Red", color: "#FFE6E1" },
    { name: "Orange", color: "#FFF0E1" },
    { name: "Yellow", color: "#FFF6DE" },
];

export const JAM_FONTS: Record<JamFont, { label: string; family: string }> = {
    simple: { label: "Simple", family: "Inter" },
    bookish: { label: "Bookish", family: "Source Serif 4" },
    technical: { label: "Technical", family: "Roboto Mono" },
    scribbled: { label: "Scribbled", family: "Caveat" },
};

// Text sizes offered for stickies, shapes and text ("Auto" fits a sticky's text to the note).
export const TEXT_SIZES: { label: string; size: number | null }[] = [
    { label: "Auto", size: null },
    { label: "Small", size: 16 },
    { label: "Medium", size: 24 },
    { label: "Large", size: 40 },
    { label: "Extra large", size: 64 },
    { label: "Huge", size: 96 },
];

// The name a size goes by: a preset, or Teensy / Custom / Ginormous between and beyond them.
export function sizeLabel(size: number | null): string {
    if (size === null) return "Auto";
    const preset = TEXT_SIZES.find((t) => t.size === size);
    if (preset) return preset.label;
    return size < 16 ? "Teensy" : size > 96 ? "Ginormous" : "Custom";
}

export const STAMPS: { kind: StampKind; label: string; glyph: string; color: string }[] = [
    { kind: "thumbs-up", label: "Thumbs up", glyph: "👍", color: "#FFCD29" },
    { kind: "thumbs-down", label: "Thumbs down", glyph: "👎", color: "#FF9E1F" },
    { kind: "heart", label: "Heart", glyph: "❤️", color: "#FFB3A8" },
    { kind: "plus-one", label: "Plus one", glyph: "+1", color: "#0D99FF" },
    { kind: "star", label: "Star", glyph: "⭐", color: "#FFE07A" },
    { kind: "question", label: "Question", glyph: "?", color: "#9747FF" },
    { kind: "check", label: "Check", glyph: "✓", color: "#14AE5C" },
    { kind: "fire", label: "Fire", glyph: "🔥", color: "#FFC77D" },
    { kind: "laugh", label: "Laugh", glyph: "😂", color: "#FFE07A" },
    { kind: "party", label: "Party", glyph: "🎉", color: "#D7C2FF" },
];

// How a stamp looks: its name, what's written on it and its colour (a face shows initials on the
// person's colour).
export function stampLook(pick: StampPick): { label: string; glyph: string; color: string } {
    if (pick.kind === "face" && pick.face) {
        const initials = pick.face.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
        return { label: pick.face.name, glyph: initials, color: pick.face.color };
    }
    if (pick.kind === "emoji" && pick.glyph) return { label: `Stamp ${pick.glyph}`, glyph: pick.glyph, color: "#FFF1C2" };
    const preset = STAMPS.find((s) => s.kind === pick.kind) ?? (STAMPS[0] as (typeof STAMPS)[number]);
    return { label: preset.label, glyph: preset.glyph, color: preset.color };
}

// The same stamp (for recents).
export const sameStamp = (a: StampPick, b: StampPick) => a.kind === b.kind && a.glyph === b.glyph && a.face?.name === b.face?.name;

// Emoji for the stamp wheel's "more" panel, by group.
export const STAMP_EMOJI: { group: string; emoji: string[] }[] = [
    { group: "Smileys", emoji: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😋", "😛", "😜", "🤪", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😌", "😔", "😴", "😷", "🤒", "🤯", "🥳", "😎", "🤓", "🧐", "😕", "😟", "😮", "😲", "😳", "🥺", "😢", "😭", "😱", "😤", "😡", "🤬", "💀", "🤡", "👻", "👽", "🤖"] },
    { group: "Gestures", emoji: ["👍", "👎", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✌️", "🤞", "🤟", "🤘", "👌", "🤌", "👈", "👉", "👆", "👇", "☝️", "✋", "🖐️", "👋", "💪", "🫶", "👀", "🧠"] },
    { group: "Hearts", emoji: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝"] },
    { group: "Objects", emoji: ["🔥", "⭐", "🌟", "✨", "⚡", "💡", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🎯", "🚀", "📌", "📍", "🔑", "🔒", "🔔", "📣", "💬", "💭", "📝", "📎", "📈", "📉", "🗓️", "⏰", "⌛", "🧩", "🛠️", "⚙️", "🐛", "☕", "🍕", "🌈", "☀️", "🌙", "🌱", "🍀"] },
    { group: "Symbols", emoji: ["✅", "☑️", "✔️", "❌", "❎", "➕", "➖", "❓", "❗", "‼️", "⁉️", "⚠️", "🚫", "⛔", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "💯", "🆗", "🆕", "🔝", "🔜", "♻️", "⬆️", "⬇️", "⬅️", "➡️"] },
];

export const WASHI_PATTERNS: { pattern: WashiPattern; label: string; color: string }[] = [
    { pattern: "dots", label: "Dots", color: "#FF8FB1" },
    { pattern: "stripes", label: "Stripes", color: "#7CC4FF" },
    { pattern: "grid", label: "Grid", color: "#8FD9A8" },
    { pattern: "waves", label: "Waves", color: "#FFC85C" },
    { pattern: "hearts", label: "Hearts", color: "#C9A7FF" },
    { pattern: "checks", label: "Checks", color: "#5551F6" },
    { pattern: "stars", label: "Stars", color: "#344357" },
    { pattern: "plain", label: "Plain", color: "#F4E3B5" },
];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
    square: "Square",
    rounded: "Rounded rectangle",
    circle: "Circle",
    ellipse: "Ellipse",
    diamond: "Diamond",
    triangle: "Triangle",
    "triangle-down": "Triangle down",
    pentagon: "Pentagon",
    hexagon: "Hexagon",
    octagon: "Octagon",
    plus: "Plus",
    star: "Star",
    "arrow-left": "Arrow left",
    "arrow-right": "Arrow right",
    chevron: "Chevron",
    speech: "Speech bubble",
    parallelogram: "Parallelogram",
    "parallelogram-left": "Parallelogram left",
    "cylinder-h": "Horizontal cylinder",
    file: "File",
    documents: "Multiple documents",
    shield: "Shield",
    trapezoid: "Trapezoid",
    cylinder: "Database",
    document: "Document",
    folder: "Folder",
    predefined: "Predefined process",
    "manual-input": "Manual input",
    "off-page": "Off page link",
    display: "Display",
    "internal-storage": "Internal storage",
    summing: "Summing junction",
    or: "Or",
    "cloud": "Cloud",
    "user": "User",
    "mobile": "Mobile",
    "desktop": "Desktop",
    "server": "Server",
    "email": "Email",
    "security": "Security",
    "location": "Location",
    "terminal": "Terminal",
    "web": "Web",
    "payment": "Payment",
    "instant": "Instant",
    "package": "Package",
    "chat": "Chat",
    "activity": "Activity",
    "storage": "Storage",
    "send": "Send",
    "wallet": "Wallet",
    "archive": "Archive",
    "authentication": "Authentication",
    "computer": "Computer",
    "frontend": "Frontend",
    "service": "Service",
    "settings": "Settings",
    "file-icon": "File icon",
    analytics: "Analytics",
    "cloud-compute": "Compute",
    "cloud-storage": "Object storage",
    "cloud-database": "Managed database",
    "cloud-function": "Function",
    "cloud-queue": "Message queue",
    "cloud-cdn": "CDN",
    "cloud-balancer": "Load balancer",
    "cloud-network": "Virtual network",
    "cloud-container": "Container",
    "cloud-gateway": "API gateway",
    "cloud-cache": "Cache",
    "cloud-monitor": "Monitoring",
};

export const BASIC_SHAPES: ShapeKind[] = ["square", "ellipse", "diamond", "triangle", "triangle-down", "rounded", "circle", "pentagon", "hexagon", "octagon", "plus", "arrow-left", "arrow-right", "chevron", "star", "speech"];
export const FLOWCHART_SHAPES: ShapeKind[] = ["parallelogram", "parallelogram-left", "trapezoid", "cylinder", "cylinder-h", "internal-storage", "file", "document", "documents", "folder", "predefined", "manual-input", "off-page", "display", "shield", "summing", "or"];
// Tech icons on a card, with room for a label under the icon.
export const ADVANCED_SHAPES: ShapeKind[] = ["cloud", "user", "mobile", "desktop", "server", "email", "security", "location", "terminal", "web", "payment", "instant", "package", "chat", "activity", "storage", "send", "wallet", "archive", "authentication", "computer", "frontend", "service", "settings", "file-icon", "analytics"];
// Cloud architecture: generic services of any cloud provider, on the same cards.
export const CLOUD_SHAPES: ShapeKind[] = ["cloud-compute", "cloud-storage", "cloud-database", "cloud-function", "cloud-queue", "cloud-cdn", "cloud-balancer", "cloud-network", "cloud-container", "cloud-gateway", "cloud-cache", "cloud-monitor"];
// Every shape drawn as an icon on a card.
export const ICON_SHAPES: ShapeKind[] = [...ADVANCED_SHAPES, ...CLOUD_SHAPES];
// The shapes tray shows these; the rest live in the Shapes panel.
// The shapes bar: seven shapes (a mind map follows them in the bar); the rest are under More shapes.
export const TRAY_SHAPES: ShapeKind[] = ["square", "ellipse", "diamond", "triangle", "triangle-down", "rounded", "cylinder"];

export const STICKY_SIZE = 240;
// A wide sticky: the index-card shape.
export const STICKY_WIDE = 480;
export const SHAPE_SIZE = 200;

const P = (x: number, y: number): PathPoint => ({ x, y, in: null, out: null });
const C = (x: number, y: number, inX: number, inY: number, outX: number, outY: number): PathPoint => ({ x, y, in: { x: inX, y: inY }, out: { x: outX, y: outY } });
const K = 0.5523;

function polygon(points: [number, number][], w: number, h: number): Subpath {
    return { points: points.map(([x, y]) => P(x * w, y * h)), closed: true };
}

function ellipse(x: number, y: number, w: number, h: number): Subpath {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    return {
        closed: true,
        points: [
            C(cx, y, cx - rx * K, y, cx + rx * K, y),
            C(x + w, cy, x + w, cy - ry * K, x + w, cy + ry * K),
            C(cx, y + h, cx + rx * K, y + h, cx - rx * K, y + h),
            C(x, cy, x, cy + ry * K, x, cy - ry * K),
        ],
    };
}

function roundedRect(w: number, h: number, r: number): Subpath {
    const k = r * (1 - K);
    return {
        closed: true,
        points: [
            C(r, 0, k, 0, r, 0),
            C(w - r, 0, w - r, 0, w - k, 0),
            C(w, r, w, k, w, r),
            C(w, h - r, w, h - r, w, h - k),
            C(w - r, h, w - k, h, w - r, h),
            C(r, h, r, h, k, h),
            C(0, h - r, 0, h - k, 0, h - r),
            C(0, r, 0, r, 0, k),
        ],
    };
}

function regular(sides: number, w: number, h: number, start = -Math.PI / 2): Subpath {
    const pts: [number, number][] = [];
    for (let i = 0; i < sides; i++) {
        const a = start + (i * 2 * Math.PI) / sides;
        pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
    }
    return polygon(pts, w, h);
}

// An eight-toothed gear, in unit coordinates.
const GEAR: [string, boolean][] = [
    [
        (() => {
            const pts: string[] = [];
            for (let i = 0; i < 16; i++) {
                const a = (i * Math.PI) / 8 - Math.PI / 16;
                const r = i % 2 === 0 ? 0.42 : 0.3;
                const b = a + Math.PI / 16;
                pts.push(`${i === 0 ? "M" : "L"} ${(0.5 + r * Math.cos(a)).toFixed(3)} ${(0.5 + r * Math.sin(a)).toFixed(3)} L ${(0.5 + r * Math.cos(b)).toFixed(3)} ${(0.5 + r * Math.sin(b)).toFixed(3)}`);
            }
            return pts.join(" ");
        })(),
        true,
    ],
];

// The icons: path commands (M, L and C, in a unit square) closed or open, and circles (cx, cy, rx, ry).
const ICONS: Partial<Record<ShapeKind, { paths: [string, boolean][]; circles: [number, number, number, number][] }>> = {
    "cloud": { paths: [["M .25 .8 L .78 .8 C .95 .8 .98 .55 .82 .5 C .82 .32 .62 .25 .52 .36 C .45 .22 .22 .25 .24 .45 C .05 .47 .07 .8 .25 .8", true]], circles: [] },
    "user": { paths: [["M .18 .92 C .18 .6 .82 .6 .82 .92", true]], circles: [[0.5, 0.32, 0.17, 0.17]] },
    "mobile": { paths: [["M .3 .08 L .7 .08 L .7 .92 L .3 .92", true], ["M .45 .82 L .55 .82", false]], circles: [] },
    "desktop": { paths: [["M .1 .15 L .9 .15 L .9 .65 L .1 .65", true], ["M .5 .65 L .5 .8", false], ["M .32 .82 L .68 .82", false]], circles: [] },
    "server": { paths: [["M .15 .1 L .85 .1 L .85 .34 L .15 .34", true], ["M .15 .38 L .85 .38 L .85 .62 L .15 .62", true], ["M .15 .66 L .85 .66 L .85 .9 L .15 .9", true], ["M .25 .22 L .35 .22", false], ["M .25 .5 L .35 .5", false], ["M .25 .78 L .35 .78", false]], circles: [] },
    "email": { paths: [["M .1 .22 L .9 .22 L .9 .78 L .1 .78", true], ["M .1 .22 L .5 .54 L .9 .22", false]], circles: [] },
    "security": { paths: [["M .22 .45 L .78 .45 L .78 .9 L .22 .9", true], ["M .34 .45 L .34 .3 C .34 .08 .66 .08 .66 .3 L .66 .45", false]], circles: [[0.5, 0.66, 0.06, 0.06]] },
    "location": { paths: [["M .5 .94 C .3 .66 .2 .52 .2 .38 C .2 .2 .34 .06 .5 .06 C .66 .06 .8 .2 .8 .38 C .8 .52 .7 .66 .5 .94", true]], circles: [[0.5, 0.38, 0.1, 0.1]] },
    "terminal": { paths: [["M .08 .15 L .92 .15 L .92 .85 L .08 .85", true], ["M .24 .38 L .38 .5 L .24 .62", false], ["M .45 .64 L .64 .64", false]], circles: [] },
    "web": { paths: [["M .12 .5 L .88 .5", false]], circles: [[0.5, 0.5, 0.38, 0.38], [0.5, 0.5, 0.16, 0.38]] },
    "payment": { paths: [["M .08 .24 L .92 .24 L .92 .76 L .08 .76", true], ["M .08 .38 L .92 .38", false], ["M .18 .62 L .38 .62", false]], circles: [] },
    "instant": { paths: [["M .58 .06 L .24 .56 L .48 .56 L .4 .94 L .76 .42 L .52 .42 L .58 .06", true]], circles: [] },
    "package": { paths: [["M .5 .08 L .9 .28 L .9 .72 L .5 .92 L .1 .72 L .1 .28", true], ["M .1 .28 L .5 .48 L .9 .28", false], ["M .5 .48 L .5 .92", false]], circles: [] },
    "chat": { paths: [["M .12 .16 L .88 .16 L .88 .68 L .46 .68 L .26 .86 L .3 .68 L .12 .68", true], ["M .3 .36 L .7 .36", false], ["M .3 .5 L .58 .5", false]], circles: [] },
    "activity": { paths: [["M .06 .55 L .3 .55 L .4 .26 L .58 .8 L .68 .55 L .94 .55", false]], circles: [] },
    "storage": { paths: [["M .2 .24 L .2 .76 C .2 .9 .8 .9 .8 .76 L .8 .24", false], ["M .2 .5 C .2 .63 .8 .63 .8 .5", false]], circles: [[0.5, 0.24, 0.3, 0.1]] },
    "send": { paths: [["M .08 .48 L .92 .14 L .62 .9 L .48 .58", true], ["M .48 .58 L .92 .14", false]], circles: [] },
    "wallet": { paths: [["M .08 .26 L .92 .26 L .92 .86 L .08 .86", true], ["M .1 .26 L .72 .1 L .76 .26", false], ["M .64 .46 L .92 .46 L .92 .66 L .64 .66", true]], circles: [] },
    "archive": { paths: [["M .06 .14 L .94 .14 L .94 .32 L .06 .32", true], ["M .12 .32 L .12 .88 L .88 .88 L .88 .32", false], ["M .4 .5 L .6 .5", false]], circles: [] },
    "authentication": { paths: [["M .44 .5 L .92 .5 L .92 .64", false], ["M .76 .5 L .76 .62", false]], circles: [[0.28, 0.5, 0.16, 0.16]] },
    "computer": { paths: [["M .18 .2 L .82 .2 L .82 .64 L .18 .64", true], ["M .06 .72 L .94 .72 L .86 .84 L .14 .84", true]], circles: [] },
    "frontend": { paths: [["M .34 .28 L .12 .5 L .34 .72", false], ["M .66 .28 L .88 .5 L .66 .72", false], ["M .56 .2 L .44 .8", false]], circles: [] },
    "service": { paths: [["M .5 .06 L .88 .28 L .88 .72 L .5 .94 L .12 .72 L .12 .28", true]], circles: [[0.5, 0.5, 0.14, 0.14]] },
    settings: { paths: GEAR, circles: [[0.5, 0.5, 0.14, 0.14]] },
    "file-icon": { paths: [["M .2 .06 L .62 .06 L .82 .26 L .82 .94 L .2 .94", true], ["M .62 .06 L .62 .26 L .82 .26", false], ["M .32 .5 L .7 .5", false], ["M .32 .66 L .7 .66", false]], circles: [] },
    analytics: { paths: [["M .1 .88 L .9 .88", false], ["M .22 .8 L .22 .52", false], ["M .42 .8 L .42 .3", false], ["M .62 .8 L .62 .58", false], ["M .82 .8 L .82 .16", false]], circles: [] },
    "cloud-compute": { paths: [["M .28 .28 L .72 .28 L .72 .72 L .28 .72", true], ["M .4 .28 L .4 .14", false], ["M .6 .28 L .6 .14", false], ["M .4 .72 L .4 .86", false], ["M .6 .72 L .6 .86", false], ["M .28 .4 L .14 .4", false], ["M .28 .6 L .14 .6", false], ["M .72 .4 L .86 .4", false], ["M .72 .6 L .86 .6", false]], circles: [] },
    "cloud-storage": { paths: [["M .18 .25 L .28 .88 L .72 .88 L .82 .25", false]], circles: [[0.5, 0.25, 0.32, 0.08]] },
    "cloud-database": { paths: [["M .2 .22 L .2 .78 C .2 .92 .8 .92 .8 .78 L .8 .22", false], ["M .2 .41 C .2 .55 .8 .55 .8 .41", false], ["M .2 .6 C .2 .74 .8 .74 .8 .6", false]], circles: [[0.5, 0.22, 0.3, 0.09]] },
    "cloud-function": { paths: [["M .24 .14 L .38 .14 L .76 .86", false], ["M .52 .44 L .26 .86", false]], circles: [] },
    "cloud-queue": { paths: [["M .08 .38 L .3 .38 L .3 .62 L .08 .62", true], ["M .39 .38 L .61 .38 L .61 .62 L .39 .62", true], ["M .7 .38 L .92 .38 L .92 .62 L .7 .62", true]], circles: [] },
    "cloud-cdn": { paths: [["M .14 .5 L .86 .5", false], ["M .5 .14 C .3 .3 .3 .7 .5 .86", false], ["M .5 .14 C .7 .3 .7 .7 .5 .86", false]], circles: [[0.5, 0.5, 0.36, 0.36]] },
    "cloud-balancer": { paths: [["M .5 .3 L .2 .7", false], ["M .5 .3 L .5 .7", false], ["M .5 .3 L .8 .7", false]], circles: [[0.5, 0.2, 0.1, 0.1], [0.2, 0.8, 0.1, 0.1], [0.5, 0.8, 0.1, 0.1], [0.8, 0.8, 0.1, 0.1]] },
    "cloud-network": { paths: [["M .28 .3 L .72 .3", false], ["M .24 .37 L .46 .68", false], ["M .76 .37 L .54 .68", false]], circles: [[0.2, 0.3, 0.08, 0.08], [0.8, 0.3, 0.08, 0.08], [0.5, 0.75, 0.08, 0.08]] },
    "cloud-container": { paths: [["M .12 .25 L .88 .25 L .88 .75 L .12 .75", true], ["M .31 .25 L .31 .75", false], ["M .5 .25 L .5 .75", false], ["M .69 .25 L .69 .75", false]], circles: [] },
    "cloud-gateway": { paths: [["M .2 .86 L .2 .36 C .2 .1 .8 .1 .8 .36 L .8 .86", false], ["M .34 .6 L .66 .6", false], ["M .56 .5 L .66 .6 L .56 .7", false]], circles: [] },
    "cloud-cache": { paths: [["M .55 .2 L .38 .54 L .52 .54 L .45 .8 L .64 .44 L .5 .44 L .55 .2", true]], circles: [[0.5, 0.5, 0.38, 0.38]] },
    "cloud-monitor": { paths: [["M .1 .2 L .9 .2 L .9 .72 L .1 .72", true], ["M .18 .48 L .36 .48 L .44 .32 L .54 .62 L .62 .48 L .82 .48", false], ["M .4 .86 L .6 .86", false]], circles: [] },
};

// An icon's subpaths in a size×size square at (ox, oy).
export function iconSubpaths(shape: ShapeKind, ox: number, oy: number, size: number): Subpath[] {
    const icon = ICONS[shape];
    if (!icon) return [];
    const at = (u: string, v: string) => ({ x: ox + Number(u) * size, y: oy + Number(v) * size });
    const out: Subpath[] = [];
    for (const [d, closed] of icon.paths) {
        const t = d.trim().split(/\s+/);
        const points: PathPoint[] = [];
        for (let i = 0; i < t.length; ) {
            const cmd = t[i++];
            if (cmd === "M" || cmd === "L") {
                const p = at(t[i] ?? "0", t[i + 1] ?? "0");
                i += 2;
                points.push({ ...p, in: null, out: null });
            } else if (cmd === "C") {
                const c1 = at(t[i] ?? "0", t[i + 1] ?? "0");
                const c2 = at(t[i + 2] ?? "0", t[i + 3] ?? "0");
                const p = at(t[i + 4] ?? "0", t[i + 5] ?? "0");
                i += 6;
                const last = points[points.length - 1];
                if (last) last.out = c1;
                points.push({ ...p, in: c2, out: null });
            } else break;
        }
        // A closed path that ends where it started joins up through its first point.
        const first = points[0];
        const last = points[points.length - 1];
        if (closed && first && last && points.length > 1 && Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) {
            first.in = last.in;
            points.pop();
        }
        out.push({ closed, points });
    }
    for (const [cx, cy, rx, ry] of icon.circles) out.push(ellipse(ox + (cx - rx) * size, oy + (cy - ry) * size, rx * 2 * size, ry * 2 * size));
    return out;
}

// A shape's outline in a w×h box. Open lines inside (a database's rim, a process's bars) are extra subpaths.
export function shapePath(shape: ShapeKind, w: number, h: number): VectorPath {
    if (ICONS[shape]) {
        // A card with the icon in its upper part.
        const s = Math.min(w, h * 0.62) * 0.5;
        return { w, h, subpaths: [roundedRect(w, h, Math.min(w, h) * 0.12), ...iconSubpaths(shape, (w - s) / 2, h * 0.12, s)] };
    }
    const subpaths: Subpath[] = (() => {
        switch (shape) {
            case "square":
                return [polygon([[0, 0], [1, 0], [1, 1], [0, 1]], w, h)];
            case "rounded":
                return [roundedRect(w, h, Math.min(w, h) * 0.18)];
            case "circle":
            case "ellipse":
                return [ellipse(0, 0, w, h)];
            case "diamond":
                return [polygon([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], w, h)];
            case "triangle":
                return [polygon([[0.5, 0], [1, 1], [0, 1]], w, h)];
            case "triangle-down":
                return [polygon([[0, 0], [1, 0], [0.5, 1]], w, h)];
            case "pentagon":
                return [regular(5, w, h)];
            case "hexagon":
                return [polygon([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]], w, h)];
            case "octagon":
                return [polygon([[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]], w, h)];
            case "plus":
                return [polygon([[0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33]], w, h)];
            case "star": {
                const pts: [number, number][] = [];
                for (let i = 0; i < 10; i++) {
                    const a = -Math.PI / 2 + (i * Math.PI) / 5;
                    const r = i % 2 === 0 ? 0.5 : 0.2;
                    pts.push([0.5 + r * Math.cos(a), 0.52 + r * Math.sin(a)]);
                }
                return [polygon(pts, w, h)];
            }
            case "arrow-right":
                return [polygon([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]], w, h)];
            case "arrow-left":
                return [polygon([[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]], w, h)];
            case "chevron":
                return [polygon([[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]], w, h)];
            case "speech":
                return [polygon([[0, 0], [1, 0], [1, 0.75], [0.45, 0.75], [0.2, 1], [0.25, 0.75], [0, 0.75]], w, h)];
            case "parallelogram":
                return [polygon([[0.2, 0], [1, 0], [0.8, 1], [0, 1]], w, h)];
            case "parallelogram-left":
                return [polygon([[0, 0], [0.8, 0], [1, 1], [0.2, 1]], w, h)];
            case "cylinder-h":
                // The upright cylinder turned on its side (its rim on the left).
                return shapePath("cylinder", h, w).subpaths.map((sp) => ({ ...sp, points: sp.points.map((pt) => ({ x: pt.y, y: pt.x, in: pt.in ? { x: pt.in.y, y: pt.in.x } : null, out: pt.out ? { x: pt.out.y, y: pt.out.x } : null })) }));
            case "file":
                return [polygon([[0, 0], [0.72, 0], [1, 0.28], [1, 1], [0, 1]], w, h), { closed: false, points: [P(w * 0.72, 0), P(w * 0.72, h * 0.28), P(w, h * 0.28)] }];
            case "documents": {
                const d = h * 0.08;
                const fx = w * 0.84;
                const top = h * 0.16;
                const front: Subpath = { closed: true, points: [P(0, top), P(fx, top), C(fx, h - d, fx, h - d, fx * 0.75, h - d * 3), C(fx * 0.5, h - d, fx * 0.6, h + d * 0.5, fx * 0.4, h - d * 2.5), C(0, h - d, fx * 0.25, h + d, 0, h - d)] };
                return [
                    front,
                    { closed: false, points: [P(w * 0.08, top), P(w * 0.08, h * 0.08), P(w * 0.92, h * 0.08), P(w * 0.92, h * 0.78), P(fx, h * 0.78)] },
                    { closed: false, points: [P(w * 0.16, h * 0.08), P(w * 0.16, 0), P(w, 0), P(w, h * 0.7), P(w * 0.92, h * 0.7)] },
                ];
            }
            case "shield":
                return [{ closed: true, points: [P(0, h * 0.12), P(w / 2, 0), C(w, h * 0.12, w, h * 0.12, w, h * 0.12), C(w, h * 0.5, w, h * 0.4, w, h * 0.68), C(w / 2, h, w * 0.86, h * 0.86, w * 0.14, h * 0.86), C(0, h * 0.5, 0, h * 0.68, 0, h * 0.4)] }];
            case "trapezoid":
                return [polygon([[0.2, 0], [0.8, 0], [1, 1], [0, 1]], w, h)];
            case "cylinder": {
                const ry = Math.min(h * 0.12, w * 0.25);
                const rim: Subpath = { closed: false, points: [C(0, ry, 0, ry, 0, ry + ry * K), C(w / 2, ry * 2, w / 2 - (w / 2) * K, ry * 2, w / 2 + (w / 2) * K, ry * 2), C(w, ry, w, ry + ry * K, w, ry)] };
                const body: Subpath = {
                    closed: true,
                    points: [
                        C(0, ry, 0, ry, 0, ry - ry * K),
                        C(w / 2, 0, w / 2 - (w / 2) * K, 0, w / 2 + (w / 2) * K, 0),
                        C(w, ry, w, ry - ry * K, w, ry),
                        C(w, h - ry, w, h - ry, w, h - ry + ry * K),
                        C(w / 2, h, w / 2 + (w / 2) * K, h, w / 2 - (w / 2) * K, h),
                        C(0, h - ry, 0, h - ry + ry * K, 0, h - ry),
                    ],
                };
                return [body, rim];
            }
            case "document": {
                const d = h * 0.1;
                return [{ closed: true, points: [P(0, 0), P(w, 0), C(w, h - d, w, h - d, w * 0.75, h - d * 3), C(w * 0.5, h - d, w * 0.6, h + d * 0.5, w * 0.4, h - d * 2.5), C(0, h - d, w * 0.25, h + d, 0, h - d)] }];
            }
            case "folder":
                return [polygon([[0, 0.12], [0.08, 0], [0.38, 0], [0.45, 0.12], [1, 0.12], [1, 1], [0, 1]], w, h)];
            case "predefined":
                return [
                    polygon([[0, 0], [1, 0], [1, 1], [0, 1]], w, h),
                    { closed: false, points: [P(w * 0.1, 0), P(w * 0.1, h)] },
                    { closed: false, points: [P(w * 0.9, 0), P(w * 0.9, h)] },
                ];
            case "internal-storage":
                return [
                    polygon([[0, 0], [1, 0], [1, 1], [0, 1]], w, h),
                    { closed: false, points: [P(w * 0.15, 0), P(w * 0.15, h)] },
                    { closed: false, points: [P(0, h * 0.15), P(w, h * 0.15)] },
                ];
            case "manual-input":
                return [polygon([[0, 0.3], [1, 0], [1, 1], [0, 1]], w, h)];
            case "off-page":
                return [polygon([[0, 0], [1, 0], [1, 0.7], [0.5, 1], [0, 0.7]], w, h)];
            case "display":
                return [{ closed: true, points: [P(w * 0.2, 0), C(w * 0.85, 0, w * 0.85, 0, w, 0), C(w * 0.85, h, w, h, w * 0.85, h), P(w * 0.2, h), P(0, h / 2)] }];
            case "summing": {
                const r = Math.SQRT1_2 / 2;
                return [
                    ellipse(0, 0, w, h),
                    { closed: false, points: [P(w * (0.5 - r), h * (0.5 - r)), P(w * (0.5 + r), h * (0.5 + r))] },
                    { closed: false, points: [P(w * (0.5 + r), h * (0.5 - r)), P(w * (0.5 - r), h * (0.5 + r))] },
                ];
            }
            case "or":
                return [ellipse(0, 0, w, h), { closed: false, points: [P(w / 2, 0), P(w / 2, h)] }, { closed: false, points: [P(0, h / 2), P(w, h / 2)] }];
            default:
                return [];
        }
    })();
    return { w, h, subpaths };
}

// Light fills get dark text, strong fills white text.
export function textOn(color: string): string {
    const hex = color.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1E1E1E" : "#FFFFFF";
}

// A darker edge for a shape's fill.
export function edgeOf(color: string): string {
    const hex = color.replace("#", "");
    const ch = (i: number) => Math.round((parseInt(hex.slice(i, i + 2), 16) || 0) * 0.62);
    return `#${[0, 2, 4].map((i) => ch(i).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function jamOf<K extends JamData["kind"]>(node: SceneNode | undefined, kind: K): Extract<JamData, { kind: K }> | null {
    return node?.jam?.kind === kind ? (node.jam as Extract<JamData, { kind: K }>) : null;
}

const textDefaults = (font: JamFont = "simple"): Partial<SceneNode> => ({ text: "", fontFamily: JAM_FONTS[font].family, fontWeight: 400, fontSize: undefined, textAlign: "left", textAlignV: "top" });

export function makeSticky(doc: NagmaDocument, x: number, y: number, color: string, parentId: string | null, author: string, wide = false): SceneNode {
    return makeNode(doc, "rect", { x, y, w: wide ? STICKY_WIDE : STICKY_SIZE, h: STICKY_SIZE }, parentId, {
        name: "Sticky",
        fills: [solid(color)],
        radius: 2,
        shadow: { x: 0, y: 2, blur: 6, color: "#000000", opacity: 0.16 },
        ...textDefaults(),
        jam: { kind: "sticky", author, showAuthor: true, ...(wide ? { wide: true } : {}) },
    });
}

export function makeShapeNode(doc: NagmaDocument, shape: ShapeKind, box: { x: number; y: number; w: number; h: number }, color: string, parentId: string | null): SceneNode {
    const path = shapePath(shape, box.w, box.h);
    return makeNode(doc, "vector", box, parentId, {
        name: SHAPE_LABELS[shape],
        path,
        fills: [solid(color)],
        strokes: [solid(edgeOf(color))],
        strokeWidth: 2,
        strokeAlign: "center",
        strokeJoin: "round",
        ...textDefaults(),
        fontSize: 16,
        textAlign: "center",
        textAlignV: "middle",
        jam: { kind: "shape", shape },
    });
}

export function makeConnector(doc: NagmaDocument, start: ConnectorEnd, end: ConnectorEnd, line: ConnectorLine, color: string, parentId: string | null, caps: { start: ConnectorCap; end: ConnectorCap } = { start: "none", end: "arrow" }): SceneNode {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    return makeNode(doc, "vector", { x, y, w: Math.abs(end.x - start.x) || 1, h: Math.abs(end.y - start.y) || 1 }, parentId, {
        name: "Connector",
        path: { w: Math.abs(end.x - start.x) || 1, h: Math.abs(end.y - start.y) || 1, subpaths: [{ closed: false, points: [P(start.x - x, start.y - y), P(end.x - x, end.y - y)] }] },
        fills: [],
        strokes: [solid(color)],
        strokeWidth: 2,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        text: "",
        fontSize: 14,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "center",
        jam: { kind: "connector", start, end, line, startCap: caps.start, endCap: caps.end },
    });
}

export function makeStamp(doc: NagmaDocument, x: number, y: number, pick: StampPick, parentId: string | null, author: string, size = 48, on?: { id: string; u: number; v: number }): SceneNode {
    return makeNode(doc, "ellipse", { x: x - size / 2, y: y - size / 2, w: size, h: size }, parentId, {
        name: stampLook(pick).label,
        // Stamps land slightly tilted, as if pressed by hand.
        rotation: Math.round((Math.random() * 2 - 1) * 12),
        fills: [],
        lockAspect: true,
        jam: { kind: "stamp", stamp: pick.kind, ...(pick.glyph ? { glyph: pick.glyph } : {}), ...(pick.face ? { face: pick.face } : {}), author, ...(on ? { on: on.id, at: { u: on.u, v: on.v } } : {}) },
    });
}

export const TABLE_COL = 160;
export const TABLE_ROW = 48;

export function makeTable(doc: NagmaDocument, x: number, y: number, parentId: string | null, cols = 3, rows = 3, cells?: string[][]): SceneNode {
    const colW = 160;
    const rowH = 48;
    return makeNode(doc, "rect", { x, y, w: colW * cols, h: rowH * rows }, parentId, {
        name: "Table",
        fills: [solid("#FFFFFF")],
        strokes: [solid("#B3B3B3")],
        strokeWidth: 1,
        fontSize: 14,
        fontFamily: "Inter",
        jam: { kind: "table", cols: Array.from({ length: cols }, () => 1), rows: Array.from({ length: rows }, () => 1), cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells?.[r]?.[c] ?? "")) },
    });
}

export const STICKERS = ["🚀", "🎯", "💡", "✅", "❌", "⚠️", "📌", "⏰", "🔥", "🌟", "🎉", "❤️", "👀", "🙌", "👏", "💬", "🤔", "😀", "😍", "😎", "🥳", "🧠", "📈", "🐛"];

export function makeSticker(doc: NagmaDocument, x: number, y: number, glyph: string, parentId: string | null, author: string, size = 120): SceneNode {
    return makeNode(doc, "rect", { x: x - size / 2, y: y - size / 2, w: size, h: size }, parentId, { name: `Sticker ${glyph}`, fills: [], lockAspect: true, jam: { kind: "sticker", glyph, author } });
}

// Washi tape: a strip from a to b, as a rect turned along the drag.
export function makeWashi(doc: NagmaDocument, a: { x: number; y: number }, b: { x: number; y: number }, pattern: WashiPattern, color: string, parentId: string | null): SceneNode {
    const length = Math.max(24, Math.hypot(b.x - a.x, b.y - a.y));
    const height = 28;
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    return makeNode(doc, "rect", { x: cx - length / 2, y: cy - height / 2, w: length, h: height }, parentId, {
        name: "Washi tape",
        rotation: angle,
        fills: [solid(color, 0.85)],
        jam: { kind: "washi", pattern, color },
    });
}

// The board's canvas colour: a light gray the dot grid is drawn over (boards made before pass 6 kept
// their white page; it's the page's own fill, so changing it there still works).
export const BOARD_CANVAS = "#F4F4F4";

// A new board: one page in the board's canvas colour (the dot grid is drawn over it).
export function createBoardDocument(name: string): NagmaDocument {
    const base: NagmaDocument = { name, nodes: {}, roots: [], images: {}, board: true };
    const page = makeNode(base, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Page 1", fills: [solid(BOARD_CANVAS)], jam: { kind: "board" } });
    return { ...base, nodes: { [page.id]: page }, roots: [page.id] };
}

export function isBoard(doc: NagmaDocument | null | undefined): boolean {
    return Boolean(doc?.board);
}

// Where a bar of this width centres so it stays 8px inside the canvas (centred when it can't fit).
export function barCenter(want: number, width: number, room: number): number {
    const half = width / 2 + 8;
    return half * 2 > room ? room / 2 : Math.max(half, Math.min(want, room - half));
}
