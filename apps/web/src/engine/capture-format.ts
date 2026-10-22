// The capture document Nagma Capture (apps/browser-extension) makes from a web page, and the
// importer (engine/capture-import.ts) turns into a Design file. Plain JSON: the extension builds it
// in the page, fills in the assets from its service worker and hands it to the app (a window
// message) or saves it as `<title>.nagma-capture.json`.
//
// Boxes are in page pixels (CSS px, from the top-left of the document), untransformed: a rotated
// element keeps its own width and height, and `rotation` turns it about its centre.

export const CAPTURE_FORMAT = "nagma-capture";
export const CAPTURE_VERSION = 1;
export const CAPTURE_EXTENSION = ".nagma-capture.json";

export interface CaptureBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface CaptureShadow {
    x: number;
    y: number;
    blur: number;
    spread: number;
    // A CSS colour as the browser computed it (rgb(), rgba(), color(srgb …)).
    color: string;
    inset: boolean;
}

// One background layer, in paint order from the top (as CSS lists them).
export type CaptureBackground =
    | { kind: "image"; asset: string; size: string; position: string; repeat: string }
    // The computed gradient text: linear-gradient(…), radial-gradient(…), conic-gradient(…).
    | { kind: "gradient"; css: string };

export interface CaptureStyle {
    display: string;
    position: string;
    // Flex and grid containers.
    flexDirection?: string;
    flexWrap?: string;
    justifyContent?: string;
    alignItems?: string;
    alignContent?: string;
    rowGap?: number;
    columnGap?: number;
    // Resolved track sizes in px ("200px 200px 1fr" comes back as px from the browser).
    gridColumns?: number[];
    gridRows?: number[];
    // Top, right, bottom, left.
    padding: [number, number, number, number];
    borderWidths: [number, number, number, number];
    borderColors: [string, string, string, string];
    borderStyles: [string, string, string, string];
    // Top-left, top-right, bottom-right, bottom-left, in px.
    radii: [number, number, number, number];
    backgroundColor: string;
    backgrounds: CaptureBackground[];
    shadows: CaptureShadow[];
    opacity: number;
    overflowX: string;
    overflowY: string;
    zIndex: number | null;
    blend?: string;
    // filter: blur(Npx) and backdrop-filter: blur(Npx).
    blur?: number;
    backdropBlur?: number;
    // Degrees, clockwise.
    rotation?: number;
}

export interface CaptureTextStyle {
    // The first family in the stack the browser could use, and the whole stack.
    family: string;
    stack: string;
    size: number;
    weight: number;
    italic: boolean;
    // px; null for "normal".
    lineHeight: number | null;
    // px.
    letterSpacing: number;
    color: string;
    align: "left" | "center" | "right" | "justify";
    decoration: "none" | "underline" | "line-through";
    transform: "none" | "uppercase" | "lowercase" | "capitalize";
    whiteSpace: string;
    direction: "ltr" | "rtl";
    shadows?: CaptureShadow[];
}

// A styled range of the text: characters start to end (UTF-16 units), with what differs from the
// block's own style.
export interface CaptureRun {
    start: number;
    end: number;
    style: Partial<CaptureTextStyle>;
    href?: string;
}

export interface CaptureText {
    content: string;
    style: CaptureTextStyle;
    runs: CaptureRun[];
    // How many lines the browser drew, and the first line's indent from the box's left edge.
    lines: number;
    // The widest line's width (the box can be wider: a block's content width).
    textWidth?: number;
    // The page's line height is "normal" (the font's own): `style.lineHeight` is what was measured
    // for the largest characters, and smaller ones scale with their size.
    lineHeightNormal?: boolean;
    indent?: number;
    // Cut after this many lines with an ellipsis (text-overflow, line-clamp).
    maxLines?: number;
}

export interface CaptureNode {
    // What the element was: "div", "img", "svg", "#text" (a run of text), "::before", "::marker".
    tag: string;
    name: string;
    box: CaptureBox;
    style: CaptureStyle;
    text?: CaptureText;
    // Pictures: an asset id; how it fits its box (object-fit).
    image?: { asset: string; fit: string };
    // Inline SVG, serialised with its computed paint inlined and sized to the box.
    svg?: string;
    // position: fixed or sticky elements, so the frame's scrolling matches.
    scroll?: "fixed" | "sticky";
    // A link the element opens.
    href?: string;
    children: CaptureNode[];
}

export interface CaptureAsset {
    // Where it came from (a page URL, or "canvas", "screenshot").
    url: string;
    // A data URL of the bytes; null when it couldn't be read (the importer leaves a placeholder).
    data: string | null;
    // Taken from a screenshot of its box because the file couldn't be read.
    bitmap?: boolean;
}

export interface CaptureFont {
    family: string;
    weights: number[];
    styles: string[];
    // Font files the page loaded for it, when it's a web font.
    sources?: string[];
}

export interface Capture {
    format: typeof CAPTURE_FORMAT;
    version: number;
    title: string;
    url: string;
    capturedAt: string;
    viewport: { w: number; h: number };
    scroll: { w: number; h: number };
    dpr: number;
    // The page's background (the root's, or the body's when the root has none).
    background: string;
    root: CaptureNode;
    assets: Record<string, CaptureAsset>;
    fonts: CaptureFont[];
}

export class NotACapture extends Error {}

// The capture in a text (a .nagma-capture.json file, or a message), checked enough to import.
export function parseCapture(input: string | unknown): Capture {
    let value: unknown = input;
    if (typeof input === "string") {
        try {
            value = JSON.parse(input);
        } catch {
            throw new NotACapture("it isn't a page capture.");
        }
    }
    const c = value as Partial<Capture> | null;
    if (!c || typeof c !== "object" || c.format !== CAPTURE_FORMAT) throw new NotACapture("it isn't a page capture.");
    if (typeof c.version !== "number" || c.version > CAPTURE_VERSION) throw new NotACapture("it was made by a newer Nagma Capture.");
    if (!c.root || typeof c.root !== "object" || !Array.isArray(c.root.children) || !c.root.box) throw new NotACapture("the capture is damaged.");
    if (!c.viewport || !(c.viewport.w > 0)) throw new NotACapture("the capture is damaged.");
    return { ...c, assets: c.assets && typeof c.assets === "object" ? c.assets : {}, fonts: Array.isArray(c.fonts) ? c.fonts : [], title: typeof c.title === "string" ? c.title : "", url: typeof c.url === "string" ? c.url : "" } as Capture;
}

export function isCaptureFile(file: File): boolean {
    return /\.nagma-capture\.json$/i.test(file.name);
}
