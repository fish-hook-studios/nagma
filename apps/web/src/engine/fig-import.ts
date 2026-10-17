import { inflateSync, unzipSync, unzlibSync } from "fflate";
import { decompress as zstdDecompress } from "fzstd";
import { compileSchema, decodeBinarySchema } from "kiwi-schema";
import { nanoid } from "nanoid";
import { literal } from "./expressions";
import { makeNode } from "./nodes";
import { imagePaint, linearGradient, solid, withAngle } from "./paint";
import { parseUniforms } from "./shaders";
import { FORMAT_MAGIC, TEMPLATE_DATA_FIELD } from "./interop-format";
import { figFeatures, figRichText, figTextStagger, figVariations, staggerTrackIds } from "./fig-text";
import type { Constraints, Easing, Interaction, PrototypeAction, Transition, TransitionType, Trigger, AnimProp, Animation, GradientPaint, Keyframe, LayoutGuide, NagmaDocument, NodeType, Paint, PathPoint, SceneNode, Styles, Subpath, VariableCollection, VariableType, VariableValue } from "./types";
import { resolveVariable, resolveVariables } from "./variables";

// Opens a .fig design file as a Nagma document.
//
// A .fig is a zip holding canvas.fig (the document), images/<hash> (bitmaps), thumbnail.png and
// meta.json. canvas.fig starts with an 8-byte header (FORMAT_MAGIC), a version number, then length-prefixed chunks,
// each deflated: first the Kiwi schema the file was written with, then the document message.
// The message is a list of node changes (every layer, keyed by guid, with its parent and the
// properties set on it); the geometry of vectors comes as path strings in the message's blobs.
// The format isn't documented by its makers; this reader follows what the community has worked out
// and keeps what it can read: frames, groups, sections, rectangles, ellipses, lines, polygons,
// stars, vectors, booleans, text, components and instances, with fills, strokes, effects, corner
// radii, auto layout, layout grids, opacity, blend modes and visibility.

type Fig = Record<string, unknown>;

interface Guid {
    sessionID: number;
    localID: number;
}

const guidKey = (g: Guid | undefined) => (g ? `${g.sessionID}:${g.localID}` : "");

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function inflate(bytes: Uint8Array): Uint8Array {
    // Newer exports (format 100+) compress the document with zstd; older ones with raw deflate.
    if (bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return zstdDecompress(bytes);
    try {
        return inflateSync(bytes);
    } catch {
        return unzlibSync(bytes);
    }
}

// Splits canvas.fig into its chunks (already inflated).
export function figChunks(bytes: Uint8Array): Uint8Array[] {
    if (!FIG_MAGIC.has(headerOf(bytes))) throw new Error("Not a .fig, .deck or .buzz file (unknown header).");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12; // magic + version
    const chunks: Uint8Array[] = [];
    while (offset + 4 <= bytes.length) {
        const length = view.getUint32(offset, true);
        offset += 4;
        // An empty chunk ends the file (zero padding after it isn't millions of empty chunks,
        // which ran a big damaged file out of memory), and a chunk can't run past the end.
        if (length === 0) break;
        if (offset + length > bytes.length) throw new Error("The file is damaged: it ends part way through.");
        chunks.push(inflate(bytes.subarray(offset, offset + length)));
        offset += length;
    }
    if (chunks.length < 2) throw new Error("The .fig file has no document in it.");
    return chunks;
}

// Decodes the document message with the schema stored in the file.
// The same container holds a design file, a slides deck, a campaign of marketing assets and a
// whiteboard; the header (FORMAT_MAGIC) says which.
export type FigKind = keyof typeof FORMAT_MAGIC;
const FIG_MAGIC = new Map<string, FigKind>((Object.entries(FORMAT_MAGIC) as [FigKind, string][]).map(([kind, magic]) => [magic, kind]));

// The header is 8 bytes; a shorter name (the whiteboard's) is padded to fill them, so the padding (a full
// stop, NUL or space) isn't part of the name.
function headerOf(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes.subarray(0, 8)).replace(/[.\0 ]+$/, "");
}

export function figKind(bytes: Uint8Array): FigKind {
    return FIG_MAGIC.get(headerOf(bytes)) ?? "design";
}

export function decodeFig(bytes: Uint8Array): { message: Fig; blobs: Uint8Array[] } {
    const [schemaBytes, messageBytes] = figChunks(bytes) as [Uint8Array, Uint8Array];
    const schema = decodeBinarySchema(schemaBytes);
    const compiled = compileSchema(schema) as { decodeMessage: (b: Uint8Array) => Fig };
    const message = compiled.decodeMessage(messageBytes);
    const blobs = ((message.blobs as { bytes: Uint8Array }[] | undefined) ?? []).map((b) => b.bytes);
    return { message, blobs };
}

// Colours come as 0..1 floats.
function hex(c: { r: number; g: number; b: number; a?: number } | undefined): string {
    if (!c) return "#000000";
    const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    return `#${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
}

const BLENDS: Record<string, SceneNode["blendMode"]> = {
    NORMAL: "normal",
    PASS_THROUGH: "pass-through",
    LINEAR_BURN: "plus-darker",
    LINEAR_DODGE: "plus-lighter",
    DARKEN: "darken",
    MULTIPLY: "multiply",
    COLOR_BURN: "color-burn",
    LIGHTEN: "lighten",
    SCREEN: "screen",
    COLOR_DODGE: "color-dodge",
    OVERLAY: "overlay",
    SOFT_LIGHT: "soft-light",
    HARD_LIGHT: "hard-light",
    DIFFERENCE: "difference",
    EXCLUSION: "exclusion",
    HUE: "hue",
    SATURATION: "saturation",
    COLOR: "color",
    LUMINOSITY: "luminosity",
};

const WEIGHTS: [RegExp, number][] = [
    [/thin|hairline/i, 100],
    [/extra ?light|ultra ?light/i, 200],
    [/light/i, 300],
    [/medium/i, 500],
    [/semi ?bold|demi ?bold/i, 600],
    [/extra ?bold|ultra ?bold/i, 800],
    [/black|heavy/i, 900],
    [/bold/i, 700],
];

function weightOf(style: string | undefined): number {
    if (!style) return 400;
    for (const [re, w] of WEIGHTS) if (re.test(style)) return w;
    return 400;
}

// "M0 0 L10 0 C ... Z" (absolute commands, as the format writes geometry) → subpaths in local space.
export function parsePathCommands(text: string): Subpath[] {
    const tokens = text.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
    const subpaths: Subpath[] = [];
    let current: Subpath | null = null;
    let i = 0;
    // The next n numbers, or null when the path ends (or the next command starts) first: a
    // truncated command is dropped rather than read as NaN.
    const nums = (n: number): number[] | null => {
        const out: number[] = [];
        for (let k = 0; k < n; k++) {
            const t = tokens[i + k];
            if (t === undefined || /^[MLCQZ]$/i.test(t)) return null;
            out.push(Number(t));
        }
        i += n;
        return out;
    };
    let last: PathPoint | null = null;
    while (i < tokens.length) {
        const cmd = tokens[i++];
        switch (cmd?.toUpperCase()) {
            case "M": {
                const v = nums(2);
                if (!v) break;
                current = { closed: false, points: [] };
                subpaths.push(current);
                last = { x: v[0] as number, y: v[1] as number, in: null, out: null };
                current.points.push(last);
                break;
            }
            case "L": {
                const v = nums(2);
                if (!current || !v) break;
                last = { x: v[0] as number, y: v[1] as number, in: null, out: null };
                current.points.push(last);
                break;
            }
            case "C": {
                const v = nums(6);
                if (!current || !last || !v) break;
                const [c1x, c1y, c2x, c2y, px, py] = v as [number, number, number, number, number, number];
                last.out = { x: c1x, y: c1y };
                last = { x: px, y: py, in: { x: c2x, y: c2y }, out: null };
                current.points.push(last);
                break;
            }
            case "Q": {
                const v = nums(4);
                if (!current || !last || !v) break;
                const c = { x: v[0] as number, y: v[1] as number };
                const p = { x: v[2] as number, y: v[3] as number };
                // A quadratic as a cubic with handles two thirds of the way to the control point.
                last.out = { x: last.x + (2 / 3) * (c.x - last.x), y: last.y + (2 / 3) * (c.y - last.y) };
                last = { x: p.x, y: p.y, in: { x: p.x + (2 / 3) * (c.x - p.x), y: p.y + (2 / 3) * (c.y - p.y) }, out: null };
                current.points.push(last);
                break;
            }
            case "Z": {
                if (!current) break;
                current.closed = true;
                // A closing point on top of the first one is redundant.
                const first = current.points[0];
                const end = current.points[current.points.length - 1];
                if (first && end && current.points.length > 1 && Math.abs(first.x - end.x) < 1e-6 && Math.abs(first.y - end.y) < 1e-6) {
                    first.in = end.in;
                    current.points.pop();
                }
                current = null;
                last = null;
                break;
            }
            default:
                // A bare number where a command was expected: skip it.
                break;
        }
    }
    return subpaths.filter((s) => s.points.length >= 2);
}

// The format's vector network: the editable path behind a vector (vertices, and segments with tangent
// handles relative to their end vertices), in a box of `normalizedSize`. Stroke-only vectors are
// rebuilt from it so the stroke follows the real centreline (trim, caps and width profiles need
// it). Vertices whose style sets a corner radius get the format's rounded corners: the radius is kept
// within each straight segment (half of it when both its ends are rounded).
export function parseVectorNetwork(bytes: Uint8Array, sx: number, sy: number, radiusOf: (style: number) => number): Subpath[] {
    if (bytes.length < 12) return [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nv = view.getUint32(0, true);
    const ns = view.getUint32(4, true);
    if (12 + nv * 12 + ns * 28 > bytes.length) return [];
    const verts: { x: number; y: number; r: number }[] = [];
    let o = 12;
    for (let i = 0; i < nv; i++, o += 12) verts.push({ r: radiusOf(view.getUint32(o, true)), x: view.getFloat32(o + 4, true) * sx, y: view.getFloat32(o + 8, true) * sy });
    const segs: { a: number; b: number; ta: { x: number; y: number }; tb: { x: number; y: number } }[] = [];
    for (let i = 0; i < ns; i++, o += 28) {
        segs.push({
            a: view.getUint32(o + 4, true),
            ta: { x: view.getFloat32(o + 8, true) * sx, y: view.getFloat32(o + 12, true) * sy },
            b: view.getUint32(o + 16, true),
            tb: { x: view.getFloat32(o + 20, true) * sx, y: view.getFloat32(o + 24, true) * sy },
        });
    }
    // Chains of consecutive segments become subpaths (vertex ids kept for the corner pass).
    const chains: { ids: number[]; pts: PathPoint[]; closed: boolean }[] = [];
    let cur: { ids: number[]; pts: PathPoint[]; closed: boolean } | null = null;
    const handle = (v: { x: number; y: number }, t: { x: number; y: number }) => (Math.abs(t.x) < 1e-6 && Math.abs(t.y) < 1e-6 ? null : { x: v.x + t.x, y: v.y + t.y });
    for (const seg of segs) {
        const va = verts[seg.a];
        const vb = verts[seg.b];
        if (!va || !vb) continue;
        if (!cur || cur.ids[cur.ids.length - 1] !== seg.a) {
            cur = { ids: [seg.a], pts: [{ x: va.x, y: va.y, in: null, out: null }], closed: false };
            chains.push(cur);
        }
        const last = cur.pts[cur.pts.length - 1] as PathPoint;
        last.out = handle(va, seg.ta);
        if (seg.b === cur.ids[0] && cur.ids.length > 1) {
            (cur.pts[0] as PathPoint).in = handle(vb, seg.tb);
            cur.closed = true;
            cur = null;
            continue;
        }
        cur.ids.push(seg.b);
        cur.pts.push({ x: vb.x, y: vb.y, in: handle(vb, seg.tb), out: null });
    }
    return chains.map(({ ids, pts, closed }) => {
        const n = pts.length;
        const radius = (i: number) => (verts[ids[i] ?? -1]?.r ?? 0);
        const at = (i: number) => (closed ? pts[(i + n) % n] : pts[i]);
        const straight = (i: number, j: number) => {
            const p = at(i);
            const q = at(j);
            return Boolean(p && q && !p.out && !q.in);
        };
        const out: PathPoint[] = [];
        for (let i = 0; i < n; i++) {
            const p = pts[i] as PathPoint;
            const r = radius(i);
            const prev = at(i - 1);
            const next = at(i + 1);
            if (r <= 0 || !prev || !next || p.in || p.out || !straight(i - 1, i) || !straight(i, i + 1)) {
                out.push({ ...p });
                continue;
            }
            const ax = prev.x - p.x;
            const ay = prev.y - p.y;
            const bx = next.x - p.x;
            const by = next.y - p.y;
            const la = Math.hypot(ax, ay);
            const lb = Math.hypot(bx, by);
            if (la < 1e-6 || lb < 1e-6) {
                out.push({ ...p });
                continue;
            }
            const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
            const theta = Math.acos(cos);
            if (theta < 1e-3 || Math.PI - theta < 1e-3) {
                out.push({ ...p });
                continue;
            }
            const half = Math.tan(theta / 2);
            const limitA = radius(i - 1) > 0 && (closed || i - 1 > 0) ? la / 2 : la;
            const limitB = radius(i + 1) > 0 && (closed || i + 1 < n - 1) ? lb / 2 : lb;
            const d = Math.min(r / half, limitA, limitB);
            const rr = d * half;
            const turn = Math.PI - theta;
            const k = (4 / 3) * Math.tan(turn / 4) * rr;
            const p1 = { x: p.x + (ax / la) * d, y: p.y + (ay / la) * d };
            const p2 = { x: p.x + (bx / lb) * d, y: p.y + (by / lb) * d };
            out.push({ x: p1.x, y: p1.y, in: null, out: { x: p1.x - (ax / la) * k, y: p1.y - (ay / la) * k } });
            out.push({ x: p2.x, y: p2.y, in: { x: p2.x - (bx / lb) * k, y: p2.y - (by / lb) * k }, out: null });
        }
        return { closed, points: out };
    });
}

// The format's binary path commands: an opcode byte (0 close, 1 move, 2 line, 3 quadratic, 4 cubic)
// followed by little-endian float32 coordinates.
export function parseBinaryPath(bytes: Uint8Array): Subpath[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const subpaths: Subpath[] = [];
    let current: Subpath | null = null;
    let last: PathPoint | null = null;
    let i = 0;
    const f = () => {
        const v = view.getFloat32(i, true);
        i += 4;
        return v;
    };
    const close = () => {
        if (!current) return;
        current.closed = true;
        const first = current.points[0];
        const end = current.points[current.points.length - 1];
        if (first && end && current.points.length > 1 && Math.abs(first.x - end.x) < 1e-4 && Math.abs(first.y - end.y) < 1e-4) {
            first.in = end.in;
            current.points.pop();
        }
        current = null;
        last = null;
    };
    while (i < bytes.length) {
        const op = bytes[i++];
        if (op === 0) close();
        else if (op === 1) {
            if (i + 8 > bytes.length) break;
            current = { closed: false, points: [] };
            subpaths.push(current);
            last = { x: f(), y: f(), in: null, out: null };
            current.points.push(last);
        } else if (op === 2) {
            if (i + 8 > bytes.length) break;
            const p: PathPoint = { x: f(), y: f(), in: null, out: null };
            if (!current) {
                current = { closed: false, points: [] };
                subpaths.push(current);
            }
            current.points.push(p);
            last = p;
        } else if (op === 3) {
            if (i + 16 > bytes.length) break;
            const c = { x: f(), y: f() };
            const p = { x: f(), y: f() };
            if (!current || !last) continue;
            last.out = { x: last.x + (2 / 3) * (c.x - last.x), y: last.y + (2 / 3) * (c.y - last.y) };
            last = { x: p.x, y: p.y, in: { x: p.x + (2 / 3) * (c.x - p.x), y: p.y + (2 / 3) * (c.y - p.y) }, out: null };
            current.points.push(last);
        } else if (op === 4) {
            if (i + 24 > bytes.length) break;
            const c1 = { x: f(), y: f() };
            const c2 = { x: f(), y: f() };
            const p = { x: f(), y: f() };
            if (!current || !last) continue;
            last.out = c1;
            last = { x: p.x, y: p.y, in: c2, out: null };
            current.points.push(last);
        } else break;
    }
    return subpaths.filter((sp) => sp.points.length >= 2);
}

interface Change extends Fig {
    guid?: Guid;
    overrideKey?: Guid;
    parentIndex?: { guid: Guid; position: string };
    type?: string;
    name?: string;
    visible?: boolean;
    opacity?: number;
    size?: { x: number; y: number };
    transform?: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number };
    fillPaints?: Fig[];
    strokePaints?: Fig[];
    strokeWeight?: number;
    strokeAlign?: string;
    strokeCap?: string;
    strokeJoin?: string;
    dashPattern?: number[];
    cornerRadius?: number;
    rectangleCornerRadiiIndependent?: boolean;
    rectangleTopLeftCornerRadius?: number;
    rectangleTopRightCornerRadius?: number;
    rectangleBottomLeftCornerRadius?: number;
    rectangleBottomRightCornerRadius?: number;
    cornerSmoothing?: number;
    arcData?: { startingAngle: number; endingAngle: number; innerRadius: number };
    mask?: boolean;
    maskType?: string;
    strokeCapStart?: string;
    strokeCapEnd?: string;
    textCase?: string;
    maxLines?: number;
    paragraphSpacing?: number;
    paragraphIndent?: number;
    stackWrap?: string;
    stackCounterSpacing?: number;
    stackPositioning?: string;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    blendMode?: string;
    textData?: { characters?: string };
    fontSize?: number;
    fontName?: { family?: string; style?: string };
    textAlignHorizontal?: string;
    textAlignVertical?: string;
    textAutoResize?: string;
    lineHeight?: { value: number; units: string };
    letterSpacing?: { value: number; units: string };
    textDecoration?: string;
    stackMode?: string;
    stackSpacing?: number;
    stackPadding?: number;
    stackHorizontalPadding?: number;
    stackVerticalPadding?: number;
    stackPaddingRight?: number;
    stackPaddingBottom?: number;
    stackCounterAlign?: string;
    stackJustify?: string;
    stackPrimaryAlignItems?: string;
    stackCounterAlignItems?: string;
    frameMaskDisabled?: boolean;
    resizeToFit?: boolean;
    effects?: Fig[];
    fillGeometry?: { windingRule?: string; commandsBlob?: number }[];
    strokeGeometry?: { windingRule?: string; commandsBlob?: number }[];
    booleanOperation?: string;
    symbolData?: { symbolID?: Guid; symbolOverrides?: Override[] };
    derivedSymbolData?: Override[];
    componentPropRefs?: { defID?: Guid; componentPropNodeField?: string }[];
    componentPropAssignments?: { defID?: Guid; varValue?: { value?: PropValue } }[];
    stackPrimarySizing?: string;
    stackCounterSizing?: string;
    stackChildPrimaryGrow?: number;
    stackChildAlignSelf?: string;
    stackReverseZIndex?: boolean;
    layoutGrids?: Fig[];
    count?: number;
    starInnerScale?: number;
}

// One entry of an instance's overrides or of the format's pre-computed geometry for it: the fields to
// apply to the layer that `guidPath` points at (a path through nested instances).
interface Override extends Partial<Change> {
    guidPath?: { guids?: Guid[] };
    overriddenSymbolID?: Guid;
}

interface PropValue {
    boolValue?: boolean;
    textDataValue?: { characters?: string };
    symbolIdValue?: { guid?: Guid };
}

interface Affine {
    m00: number;
    m01: number;
    m02: number;
    m10: number;
    m11: number;
    m12: number;
}

const IDENTITY: Affine = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function invert(t: Affine): Affine | null {
    const det = t.m00 * t.m11 - t.m01 * t.m10;
    if (Math.abs(det) < 1e-12) return null;
    const a = t.m11 / det;
    const b = -t.m01 / det;
    const c = -t.m10 / det;
    const d = t.m00 / det;
    return { m00: a, m01: b, m02: -(a * t.m02 + b * t.m12), m10: c, m11: d, m12: -(c * t.m02 + d * t.m12) };
}

const mapPoint = (t: Affine, x: number, y: number) => ({ x: t.m00 * x + t.m01 * y + t.m02, y: t.m10 * x + t.m11 * y + t.m12 });

const pathKey = (guids: (Guid | undefined)[]) => guids.map(guidKey).join("/");

// Overrides address layers by their override key (stable across library copies), not their id.
const pathId = (c: { guid?: Guid; overrideKey?: Guid }) => c.overrideKey ?? c.guid;

// Fields of an override or derived entry that are bookkeeping, not layer properties.
const NOT_PROPERTIES = new Set(["guidPath", "overrideLevel", "textUserLayoutVersion", "textExplicitLayoutVersion", "toggledOnOTFeatures", "toggledOffOTFeatures", "overriddenSymbolID", "componentPropAssignments", "derivedTextData", "listSpacing"]);

// Imported motion: a keyframe track is a list of keyframes on the hidden canvas; a layer links a
// property to a track through its parameterConsumptionMap ("KEYFRAME" expressions).
type MotionValue = number | { x: number; y: number } | { r: number; g: number; b: number; a?: number };
interface MotionKey {
    t: number;
    v: MotionValue;
    easing: Keyframe["easing"];
    bezier?: Keyframe["bezier"];
}

const NAMED_CURVES: Record<string, [number, number, number, number]> = {
    EASE_IN: [0.42, 0, 1, 1],
    EASE_OUT: [0, 0, 0.58, 1],
    EASE_IN_AND_OUT: [0.42, 0, 0.58, 1],
    IN_CUBIC: [0.32, 0, 0.67, 0],
    OUT_CUBIC: [0.33, 1, 0.68, 1],
    IN_OUT_CUBIC: [0.65, 0, 0.35, 1],
    IN_QUAD: [0.11, 0, 0.5, 0],
    OUT_QUAD: [0.5, 1, 0.89, 1],
    IN_OUT_QUAD: [0.45, 0, 0.55, 1],
    IN_BACK: [0.36, 0, 0.66, -0.56],
    OUT_BACK: [0.34, 1.56, 0.64, 1],
    IN_OUT_BACK: [0.68, -0.6, 0.32, 1.6],
};

function motionValue(v: Fig | undefined): MotionValue | null {
    const value = (v?.value ?? {}) as Fig;
    if (typeof value.floatValue === "number") return value.floatValue;
    if (value.vectorValue) return value.vectorValue as { x: number; y: number };
    if (value.colorValue) return value.colorValue as { r: number; g: number; b: number; a?: number };
    return null;
}

function motionEasing(e: Fig | undefined): Pick<MotionKey, "easing" | "bezier"> {
    const type = String(e?.easingType ?? "LINEAR");
    if (type === "HOLD") return { easing: "hold" };
    if (type === "LINEAR") return { easing: "linear" };
    const b = ((e?.easingValue as Fig | undefined)?.bezierEasing ?? null) as { p1x: number; p1y: number; p2x: number; p2y: number } | null;
    if (type === "CUSTOM_CUBIC" && b) return { easing: "ease-in-out", bezier: [b.p1x, b.p1y, b.p2x, b.p2y] };
    const named = NAMED_CURVES[type];
    if (named) return { easing: "ease-in-out", bezier: named };
    if (b) return { easing: "ease-in-out", bezier: [b.p1x, b.p1y, b.p2x, b.p2y] };
    return { easing: "ease-in-out" };
}

// The paints of a code layer's cached preview (the format stores it as image paints on codeSnapshot;
// presets and unrendered layers have none).
function codeSnapshotPaints(c: Fig): Fig[] {
    const snap = c.codeSnapshot as { paints?: Fig[]; state?: string } | undefined;
    return (snap?.paints ?? []).filter((p) => p && p.type === "IMAGE");
}

// The track a KEYFRAME expression points at.
function trackOf(variableData: Fig | undefined): string | null {
    const expr = ((variableData?.value as Fig | undefined)?.expressionValue ?? null) as { expressionFunction?: string; expressionArguments?: Fig[] } | null;
    if (!expr || expr.expressionFunction !== "KEYFRAME") return null;
    for (const arg of expr.expressionArguments ?? []) {
        const params = (((arg.value as Fig | undefined)?.keyframeTrackParameterValue as Fig | undefined)?.parameters ?? []) as Fig[];
        for (const param of params) {
            // Keyframes drawn by hand, or generated by an animation preset (path, text and so on).
            const value = param.value as Fig | undefined;
            const source = (value?.manual ?? value?.animationPreset) as Fig | undefined;
            const guid = source?.keyframeTrackId as { guid?: Guid } | undefined;
            if (guid?.guid) return guidKey(guid.guid);
        }
    }
    return null;
}

// While expanding an instance: overrides and computed geometry by path, and property values by definition.
interface Expansion {
    overrides: Map<string, Override>;
    derived: Map<string, Override>;
    swaps: Map<string, Guid>;
    props: Map<string, PropValue>;
    depth: number;
}

export interface FigImportResult {
    doc: NagmaDocument;
    // What the reader had to leave out, for the notice after import.
    skipped: string[];
    // Which product the file came from.
    kind: FigKind;
    // The Nagma layer made for each of the file's nodes (by "session:local" guid).
    ids: Record<string, string>;
    // Decks and campaigns: the rows of the slide grid, with each row's members (by guid), and what
    // the grid's children carried (speaker notes, the campaign size type).
    product: FigProduct | null;
}

export interface FigProduct {
    rows: { name: string; members: string[] }[];
    notes: Record<string, string>;
    sizeType: Record<string, string>;
}

// Decks and campaigns keep their slides (or assets) in a SLIDE_GRID of SLIDE_ROWs, a stack layout
// of its own. Here the grid is taken apart before import: its children move up to the canvas at
// their absolute positions, slides become ordinary frames that clip, and the rows are remembered
// so the deck's sections (or the campaign's rows) can be rebuilt afterwards.
function flattenSlideGrid(changes: Change[]): { changes: Change[]; product: FigProduct | null } {
    const grids = changes.filter((c) => c.type === "SLIDE_GRID");
    if (!grids.length) return { changes, product: null };
    const product: FigProduct = { rows: [], notes: {}, sizeType: {} };
    const drop = new Set<string>();
    const hoisted = new Map<string, Change>();
    const byPosition = (a: Change, b: Change) => ((a.parentIndex?.position ?? "") < (b.parentIndex?.position ?? "") ? -1 : (a.parentIndex?.position ?? "") > (b.parentIndex?.position ?? "") ? 1 : 0);
    const shift = (c: Change | undefined) => ({ x: Number((c?.transform as Fig | undefined)?.m02 ?? 0), y: Number((c?.transform as Fig | undefined)?.m12 ?? 0) });
    for (const grid of grids) {
        const gridKey = guidKey(grid.guid);
        const canvasGuid = grid.parentIndex?.guid;
        if (!canvasGuid) continue;
        drop.add(gridKey);
        const rows = changes.filter((c) => c.type === "SLIDE_ROW" && guidKey(c.parentIndex?.guid) === gridKey).sort(byPosition);
        rows.forEach((row, rowIndex) => {
            const rowKey = guidKey(row.guid);
            drop.add(rowKey);
            const members = changes.filter((c) => guidKey(c.parentIndex?.guid) === rowKey).sort(byPosition);
            const entry = { name: String(row.name ?? ""), members: [] as string[] };
            members.forEach((m, memberIndex) => {
                const key = guidKey(m.guid);
                entry.members.push(key);
                const g = shift(grid);
                const r = shift(row);
                const t = (m.transform as Fig | undefined) ?? {};
                const transform = { m00: Number(t.m00 ?? 1), m01: Number(t.m01 ?? 0), m02: Number(t.m02 ?? 0) + g.x + r.x, m10: Number(t.m10 ?? 0), m11: Number(t.m11 ?? 1), m12: Number(t.m12 ?? 0) + g.y + r.y };
                const position = `${String(rowIndex).padStart(4, "0")}${String(memberIndex).padStart(4, "0")}`;
                const next: Change = { ...m, type: m.type === "SLIDE" ? "FRAME" : m.type, transform, parentIndex: { guid: canvasGuid, position } };
                if (m.type === "SLIDE") next.frameMaskDisabled = false;
                if (typeof (m as Fig).slideSpeakerNotes === "string") product.notes[key] = lexicalText((m as Fig).slideSpeakerNotes as string);
                const template = (m as Fig)[TEMPLATE_DATA_FIELD] as { type?: string } | undefined;
                if (template?.type) product.sizeType[key] = template.type;
                hoisted.set(key, next);
            });
            product.rows.push(entry);
        });
    }
    const out = changes.filter((c) => !drop.has(guidKey(c.guid))).map((c) => hoisted.get(guidKey(c.guid)) ?? c);
    return { changes: out, product };
}

// Speaker notes are stored as a rich-text tree; this keeps the text, one line per paragraph.
function lexicalText(json: string): string {
    try {
        const root = (JSON.parse(json) as { root?: { children?: unknown[] } }).root;
        const lines: string[] = [];
        const walk = (n: { type?: string; text?: string; children?: unknown[] }, out: string[]) => {
            if (n.type === "text" && typeof n.text === "string") out.push(n.text);
            if (n.type === "linebreak") out.push("\n");
            for (const c of n.children ?? []) walk(c as typeof n, out);
        };
        for (const p of root?.children ?? []) {
            const out: string[] = [];
            walk(p as { type?: string }, out);
            lines.push(out.join(""));
        }
        return lines.join("\n").trim();
    } catch {
        return "";
    }
}

// Builds the Nagma document from the decoded message and the zip's images.
//
// The format stores an instance as a pointer to its component plus overrides; its layers are not in the
// file. Components usually sit on the hidden "Internal Only Canvas". So every instance is rebuilt
// here from its component, applying (outermost wins) the instance's overrides, its component
// property values, swapped nested instances, and the format's own computed sizes and geometry for the
// resized result. Layers are collected in one mutable map, so large files import quickly.
export interface FigToDocumentOptions {
    // For an image whose bytes aren't in `images` (pasted layers carry only hashes): the image id
    // its fills should point at while the bytes are fetched, or null to leave the paint out.
    pendingImage?: (hash: string) => string | null;
}

export async function figToDocument(message: Fig, blobs: Uint8Array[], images: Map<string, Uint8Array>, name: string, kind: FigKind = "design", options: FigToDocumentOptions = {}): Promise<FigImportResult> {
    const flat = flattenSlideGrid(((message.nodeChanges as Change[] | undefined) ?? []).filter((c) => c.guid));
    const changes = flat.changes;
    const ids: Record<string, string> = {};
    const byGuid = new Map<string, Change>();
    const children = new Map<string, Change[]>();
    for (const c of changes) {
        byGuid.set(guidKey(c.guid), c);
        const parent = guidKey(c.parentIndex?.guid);
        let list = children.get(parent);
        if (!list) children.set(parent, (list = []));
        list.push(c);
    }
    for (const list of children.values()) list.sort((a, b) => ((a.parentIndex?.position ?? "") < (b.parentIndex?.position ?? "") ? -1 : (a.parentIndex?.position ?? "") > (b.parentIndex?.position ?? "") ? 1 : 0));

    const tracks = new Map<string, MotionKey[]>();
    for (const c of changes) {
        if (c.type !== "KEYFRAME_TRACK") continue;
        const keys: MotionKey[] = [];
        for (const k of children.get(guidKey(c.guid)) ?? []) {
            if (k.type !== "KEYFRAME") continue;
            const v = motionValue((k as Fig).keyframeValue as Fig | undefined);
            if (v === null) continue;
            keys.push({ t: Number((k as Fig).timelinePosition ?? 0) / 1000, v, ...motionEasing((k as Fig).easingData as Fig | undefined) });
        }
        keys.sort((a, b) => a.t - b.t);
        if (keys.length) tracks.set(guidKey(c.guid), keys);
    }

    // Text stagger presets (engine/fig-text.ts): their tracks, and the code components behind them.
    const staggerTracks = staggerTrackIds(changes as Fig[], { key: (g) => guidKey(g as Guid) });
    const codeComponents = new Map<string, Fig>();
    for (const c of changes) if (c.type === "CODE_COMPONENT" && typeof (c as Fig).key === "string") codeComponents.set((c as Fig).key as string, c as Fig);

    // Variables: the format's collections (with their modes) and variables, library ones included, so
    // colours bound to a variable follow it (and its mode) like in the source app instead of the colour
    // cached next to the binding, which is often stale inside component overrides.
    const collections: VariableCollection[] = [];
    const collectionByRef = new Map<string, VariableCollection>();
    const variableByRef = new Map<string, string>();
    const refKeys = (c: Change) => [typeof (c as Fig).key === "string" ? ((c as Fig).key as string) : "", guidKey(c.guid)].filter(Boolean);
    const refOf = (r: unknown): string => {
        const ref = r as { assetRef?: { key?: string }; guid?: Guid } | undefined;
        return ref?.assetRef?.key ?? (ref?.guid ? guidKey(ref.guid) : "");
    };
    for (const c of changes) {
        if (c.type !== "VARIABLE_SET") continue;
        const modes = [...(((c as Fig).variableSetModes as { id: Guid; name: string; sortPosition?: string }[] | undefined) ?? [])].sort((a, b) => ((a.sortPosition ?? "") < (b.sortPosition ?? "") ? -1 : (a.sortPosition ?? "") > (b.sortPosition ?? "") ? 1 : 0));
        const collection: VariableCollection = {
            id: `fig-set-${refKeys(c)[0]}`,
            name: c.name || "Collection",
            modes: modes.map((m) => ({ id: guidKey(m.id), name: m.name })),
            defaultModeId: modes[0] ? guidKey(modes[0].id) : undefined,
            variables: [],
        };
        if (!collection.modes.length) continue;
        collections.push(collection);
        for (const k of refKeys(c)) collectionByRef.set(k, collection);
    }
    const variableNodes = changes.filter((c) => c.type === "VARIABLE");
    for (const c of variableNodes) {
        const id = `fig-var-${refKeys(c)[0]}`;
        for (const k of refKeys(c)) variableByRef.set(k, id);
    }
    const TYPES: Record<string, VariableType> = { COLOR: "color", FLOAT: "number", STRING: "string", BOOLEAN: "boolean" };
    for (const c of variableNodes) {
        const collection = collectionByRef.get(refOf((c as Fig).variableSetID));
        const type = TYPES[String((c as Fig).variableResolvedType)];
        if (!collection || !type) continue;
        const values: Record<string, VariableValue> = {};
        for (const entry of (((c as Fig).variableDataValues as { entries?: { modeID: Guid; variableData?: Fig }[] } | undefined)?.entries ?? [])) {
            const value = (entry.variableData?.value ?? {}) as Fig;
            let v: VariableValue | undefined;
            if (value.alias) {
                const target = variableByRef.get(refOf(value.alias));
                if (target) v = { alias: target };
            } else if (value.colorValue) v = hex(value.colorValue as { r: number; g: number; b: number });
            else if (typeof value.floatValue === "number") v = value.floatValue;
            else if (typeof value.textValue === "string") v = value.textValue;
            else if (typeof value.boolValue === "boolean") v = value.boolValue;
            if (v !== undefined) values[guidKey(entry.modeID)] = v;
        }
        // "Hide from publishing" on this file's own variables.
        const hiddenVar = !(c as Fig).sourceLibraryKey && (c as Fig).isPublishable === false;
        collection.variables.push({ id: `fig-var-${refKeys(c)[0]}`, name: c.name || "Variable", type, values, ...(hiddenVar ? { hidden: true } : {}) });
    }
    // A library collection can arrive as several copies (one per published version); copies with
    // the same name and modes show as one collection.
    for (let i = collections.length - 1; i > 0; i--) {
        const copy = collections[i] as VariableCollection;
        const sameModes = (a: VariableCollection) => a.modes.length === copy.modes.length && a.modes.every((m, j) => m.id === copy.modes[j]?.id);
        const first = collections.find((c, j) => j < i && c.name === copy.name && sameModes(c));
        if (!first) continue;
        const names = new Set(first.variables.map((v) => v.name));
        for (const v of copy.variables) first.variables.push(names.has(v.name) ? { ...v, hidden: true } : v);
        for (const [k, c] of collectionByRef) if (c === copy) collectionByRef.set(k, first);
        collections.splice(i, 1);
    }
    // The variable a paint's colour is bound to.
    const variableOf = (colorVar: unknown): string | null => {
        const alias = ((colorVar as Fig | undefined)?.value as Fig | undefined)?.alias;
        return alias ? (variableByRef.get(refOf(alias)) ?? null) : null;
    };
    // A variable named by reference (its guid, or its library key).
    const variableId = (ref: unknown): string | null => (ref ? (variableByRef.get(refOf(ref)) ?? null) : null);
    const prototypeRefs: FigRefs = {
        node: () => null,
        variable: variableId,
        collection: (ref) => (ref ? (collectionByRef.get(refOf(ref))?.id ?? null) : null),
    };
    // Fields bound to variables (the format's variableConsumptionMap): sizes, padding, gaps, visibility,
    // text and the like take the variable straight; a variant property takes it through
    // RESOLVE_VARIANT, so the instance shows the variant whose value matches.
    const fieldBindings = (c: Change): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const e of (((c as Fig).variableConsumptionMap as { entries?: { variableField?: string; variableData?: Fig }[] } | undefined)?.entries ?? [])) {
            const value = (e.variableData?.value ?? {}) as Fig;
            if (e.variableField === "VARIANT_PROPERTIES") {
                const expr = value.expressionValue as { expressionFunction?: string; expressionArguments?: Fig[] } | undefined;
                if (expr?.expressionFunction !== "RESOLVE_VARIANT") continue;
                const map = ((expr.expressionArguments?.[0]?.value as Fig | undefined)?.mapValue as { values?: { key: string; value: Fig }[] } | undefined)?.values ?? [];
                for (const { key, value: arg } of map) {
                    // The value is a variable, or a variable turned into text.
                    let v = (arg?.value ?? {}) as Fig;
                    const inner = v.expressionValue as { expressionFunction?: string; expressionArguments?: Fig[] } | undefined;
                    if (inner?.expressionFunction === "STRINGIFY") v = (inner.expressionArguments?.[0]?.value ?? {}) as Fig;
                    const id = variableId(v.alias);
                    if (id) out[`variant:${key}`] = id;
                }
                continue;
            }
            const key = FIG_FIELDS[String(e.variableField)];
            const id = variableId(value.alias);
            if (key && id) out[key] = id;
        }
        return out;
    };
    // The modes a layer picks for collections (the format's "variable mode" on frames).
    const modesOf = (c: Change): Record<string, string> | null => {
        const entries = (((c as Fig).variableModeBySetMap as { entries?: { variableSetID?: unknown; variableModeID?: Guid }[] } | undefined)?.entries ?? []);
        const out: Record<string, string> = {};
        for (const e of entries) {
            const collection = collectionByRef.get(refOf(e.variableSetID));
            if (collection && e.variableModeID) out[collection.id] = guidKey(e.variableModeID);
        }
        return Object.keys(out).length ? out : null;
    };

    // Styles by library key (and id), so an override that only names a style can be resolved.
    const styles = new Map<string, Change>();
    for (const c of changes) {
        if (!(c as Fig).styleType) continue;
        const k = (c as Fig).key;
        if (typeof k === "string") styles.set(k, c);
        styles.set(guidKey(c.guid), c);
    }
    const styleOf = (ref: unknown): Change | undefined => {
        const r = ref as { assetRef?: { key?: string }; guid?: Guid } | undefined;
        if (r?.assetRef?.key) return styles.get(r.assetRef.key);
        if (r?.guid) return styles.get(guidKey(r.guid));
        return undefined;
    };
    const TEXT_STYLE_FIELDS = ["fontSize", "fontName", "lineHeight", "letterSpacing", "textCase", "textDecoration", "paragraphSpacing", "paragraphIndent"] as const;

    // Applies one override entry. An override that sets paints (or text fields) without naming a
    // style detaches the style the layer had, as editing a styled property does in the source app.
    const applyOverride = (base: Change, o: Override): Change => {
        const out: Change = { ...base };
        const f = o as Fig;
        if (f.fillPaints && !f.styleIdForFill) delete (out as Fig).styleIdForFill;
        if (f.strokePaints && !f.styleIdForStrokeFill) delete (out as Fig).styleIdForStrokeFill;
        if (f.effects && !f.styleIdForEffect) delete (out as Fig).styleIdForEffect;
        if (!f.styleIdForText && TEXT_STYLE_FIELDS.some((k) => f[k] !== undefined)) delete (out as Fig).styleIdForText;
        for (const [k, v] of Object.entries(o)) if (!NOT_PROPERTIES.has(k)) (out as Fig)[k] = v;
        return out;
    };

    // A layer's styles decide what they cover: the paints, effects or text settings stored next
    // to a style reference are a cache that goes stale when the library changes (components here
    // carry a default purple while their styles say orange), so the style wins.
    const withStyles = (c: Change): Change => {
        const f = c as Fig;
        const fill = styleOf(f.styleIdForFill);
        const stroke = styleOf(f.styleIdForStrokeFill);
        const effect = styleOf(f.styleIdForEffect);
        const text = styleOf(f.styleIdForText);
        if (!fill?.fillPaints && !stroke?.fillPaints && !effect?.effects && !text) return c;
        const out: Fig = { ...c };
        if (fill?.fillPaints) out.fillPaints = fill.fillPaints;
        if (stroke?.fillPaints) out.strokePaints = stroke.fillPaints;
        if (effect?.effects) out.effects = effect.effects;
        if (text) for (const k of TEXT_STYLE_FIELDS) if ((text as Fig)[k] !== undefined) out[k] = (text as Fig)[k];
        return out as Change;
    };

    const skipped = new Set<string>();
    const nodes: Record<string, SceneNode> = {};
    const roots: string[] = [];
    const docImages: Record<string, string> = {};
    const imageIds = new Map<string, string>();
    const naming: NagmaDocument = { name, nodes: {}, roots: [], images: {} };

    const imageFor = async (hash: Uint8Array | undefined): Promise<string | null> => {
        if (!hash) return null;
        const key = bytesToHex(hash);
        const known = imageIds.get(key);
        if (known) return known;
        const bytes = images.get(key);
        if (!bytes) {
            const pending = options.pendingImage?.(key);
            if (pending) {
                imageIds.set(key, pending);
                return pending;
            }
            skipped.add("an image missing from the file");
            return null;
        }
        const type = bytes[0] === 0x89 ? "image/png" : bytes[0] === 0xff ? "image/jpeg" : bytes[0] === 0x47 ? "image/gif" : bytes[0] === 0x52 ? "image/webp" : "image/png";
        const blob = new Blob([bytes as BlobPart], { type });
        const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        const id = nanoid(12);
        docImages[id] = data;
        imageIds.set(key, id);
        return id;
    };

    const paintOf = async (p: Fig): Promise<Paint | null> => {
        const type = String(p.type ?? "SOLID");
        const opacity = typeof p.opacity === "number" ? p.opacity : 1;
        const visible = p.visible !== false;
        const mapped = BLENDS[String(p.blendMode ?? "NORMAL")] ?? "normal";
        const blend = mapped === "pass-through" ? "normal" : mapped;
        if (type === "SOLID") {
            const c = p.color as { r: number; g: number; b: number; a?: number } | undefined;
            return { ...solid(hex(c), opacity * (c?.a ?? 1)), visible, blend };
        }
        if (type.startsWith("GRADIENT")) {
            const stops = ((p.stops as { color: { r: number; g: number; b: number; a?: number }; position: number }[] | undefined) ?? []).map((s) => ({ position: s.position, color: hex(s.color), opacity: s.color?.a ?? 1 }));
            const base = withAngle(linearGradient(stops[0]?.color ?? "#000000", stops[stops.length - 1]?.color ?? "#FFFFFF"), 90);
            const kind: GradientPaint["type"] = type === "GRADIENT_RADIAL" ? "radial" : type === "GRADIENT_DIAMOND" ? "diamond" : type === "GRADIENT_ANGULAR" ? "angular" : "linear";
            const g: GradientPaint = { ...base, type: kind, stops: stops.length >= 2 ? stops : base.stops, opacity, visible, blend };
            // The paint's transform maps the layer's unit square into gradient space, where a linear
            // gradient runs from (0, 0.5) to (1, 0.5) and a radial one is centred at (0.5, 0.5).
            const inv = invert((p.transform as Affine | undefined) ?? IDENTITY);
            if (!inv) return g;
            if (kind === "linear") return { ...g, from: mapPoint(inv, 0, 0.5), to: mapPoint(inv, 1, 0.5) };
            return { ...g, from: mapPoint(inv, 0.5, 0.5), to: mapPoint(inv, 1, 0.5) };
        }
        if (type === "IMAGE") {
            const image = p.image as { hash?: Uint8Array } | undefined;
            const id = await imageFor(image?.hash);
            if (!id) return null;
            const scaleMode = String(p.imageScaleMode ?? "FILL");
            if (scaleMode === "FIT") return { ...imagePaint(id, "fit"), opacity, visible, blend };
            if (scaleMode === "TILE") return { ...imagePaint(id, "tile"), tileScale: typeof p.scale === "number" ? p.scale : 0.5, opacity, visible, blend };
            if (scaleMode === "STRETCH") {
                // The format's crop mode: the transform picks the region of the image (and mirrors it).
                const t = (p.transform as Affine | undefined) ?? IDENTITY;
                return { ...imagePaint(id, "crop"), crop: [t.m00, t.m01, t.m02, t.m10, t.m11, t.m12], opacity, visible, blend };
            }
            return { ...imagePaint(id, "fill"), opacity, visible, blend };
        }
        if (type === "SHADER") {
            // A shader paint keeps its code when the file carries it; otherwise it is left out.
            const code = typeof p.code === "string" ? p.code : typeof (p.shader as Fig | undefined)?.code === "string" ? String((p.shader as Fig).code) : null;
            if (code) return { type: "shader", code, uniforms: parseUniforms(code), opacity, visible, blend };
        }
        skipped.add(`${type.toLowerCase().replace(/_/g, " ")} paints`);
        return null;
    };

    // Paints plus, for each kept paint, the variable its colour is bound to (if any).
    // Gradient stops bound to colour variables come back as "<paint>:stop:<stop>" keys.
    const paintsWithVars = async (list: Fig[] | undefined): Promise<{ paints: Paint[]; vars: (string | null)[]; stopVars: Record<string, string> }> => {
        const out: Paint[] = [];
        const vars: (string | null)[] = [];
        const stopVars: Record<string, string> = {};
        for (const p of list ?? []) {
            const paint = await paintOf(p);
            if (!paint) continue;
            out.push(paint);
            vars.push(paint.type === "solid" ? variableOf((p as Fig).colorVar) : null);
            if (paint.type !== "solid" && paint.type !== "image")
                (((p as Fig).stops as Fig[] | undefined) ?? []).forEach((stop, j) => {
                    const v = variableOf(stop.colorVar);
                    if (v) stopVars[`${out.length - 1}:stop:${j}`] = v;
                });
        }
        return { paints: out, vars, stopVars };
    };

    const geometry = (c: Change, key: "fillGeometry" | "strokeGeometry"): Subpath[] => {
        const parts = c[key] ?? [];
        const out: Subpath[] = [];
        for (const g of parts) {
            const blob = g.commandsBlob !== undefined ? blobs[g.commandsBlob] : undefined;
            if (!blob) continue;
            // The format writes path commands as binary; very old files used SVG-like text.
            out.push(...(blob[0] === 0x4d ? parsePathCommands(new TextDecoder().decode(blob)) : parseBinaryPath(blob)));
        }
        return out;
    };

    const typeOf = (c: Change): NodeType | "skip" => {
        switch (c.type) {
            case "CANVAS":
                return "page";
            case "FRAME":
            case "SECTION":
                // A frame holding variants is the format's component set.
                if ((c as Fig).isStateGroup) return "componentSet";
                return c.resizeToFit ? "group" : "frame";
            case "GROUP":
                return "group";
            case "SYMBOL":
                return "component";
            case "INSTANCE":
                return "frame";
            case "RECTANGLE":
            case "ROUNDED_RECTANGLE":
                return "rect";
            case "ELLIPSE":
                return "ellipse";
            case "TEXT":
                return "text";
            case "BOOLEAN_OPERATION":
                return "boolean";
            case "LINE":
            case "REGULAR_POLYGON":
            case "STAR":
            case "VECTOR":
            case "BRUSH":
                return "vector";
            // Code layers (generated apps and sites): their rendered preview, when the file stores one,
            // comes in as an image; without one they keep their place as an empty frame. Code
            // components that define Motion animation presets have no layer of their own (their
            // keyframes are on the animated layers already).
            case "CODE_LAYER":
            case "CODE_INSTANCE":
            case "CODE_COMPONENT":
                if (c.codeObjectType === "ANIMATION_PRESET") return "skip";
                return codeSnapshotPaints(c).length ? "rect" : "frame";
            default:
                return "skip";
        }
    };

    // Starts expanding an instance (or adds a nested instance's own data under `prefix`). Entries
    // already present come from an outer instance and win.
    const seed = (into: Expansion, instance: Change, prefix: (Guid | undefined)[]) => {
        for (const o of instance.symbolData?.symbolOverrides ?? []) {
            const k = pathKey([...prefix, ...(o.guidPath?.guids ?? [])]);
            const prev = into.overrides.get(k);
            into.overrides.set(k, prev ? { ...o, ...prev } : o);
            if (o.overriddenSymbolID && !into.swaps.has(k)) into.swaps.set(k, o.overriddenSymbolID);
        }
        for (const d of instance.derivedSymbolData ?? []) {
            const k = pathKey([...prefix, ...(d.guidPath?.guids ?? [])]);
            if (!into.derived.has(k)) into.derived.set(k, d);
        }
        for (const a of instance.componentPropAssignments ?? []) {
            const k = guidKey(a.defID);
            if (k && a.varValue?.value && !into.props.has(k)) into.props.set(k, a.varValue.value);
        }
    };

    // A layer as it appears inside an instance: its component definition with overrides applied.
    const resolved = (src: Change, path: string, ctx: Expansion | null): Change => {
        if (!ctx) return src;
        let out: Change = src;
        const o = ctx.overrides.get(path);
        if (o) out = applyOverride(out, o);
        for (const ref of src.componentPropRefs ?? []) {
            const value = ctx.props.get(guidKey(ref.defID));
            if (!value) continue;
            if (ref.componentPropNodeField === "VISIBLE" && typeof value.boolValue === "boolean") out = { ...out, visible: value.boolValue };
            if (ref.componentPropNodeField === "TEXT_DATA" && value.textDataValue?.characters !== undefined) out = { ...out, textData: { characters: value.textDataValue.characters } };
        }
        const d = ctx.derived.get(path);
        if (d) {
            out = { ...out };
            if (d.size) out.size = d.size;
            if (d.transform) out.transform = d.transform;
            if (d.fillGeometry) out.fillGeometry = d.fillGeometry;
            if (d.strokeGeometry) out.strokeGeometry = d.strokeGeometry;
        }
        return out;
    };

    // Which component a (possibly nested) instance shows: a swap override, an instance-swap
    // property, or its own.
    const symbolOf = (src: Change, path: string, ctx: Expansion | null): Change | undefined => {
        let id: Guid | undefined = ctx?.swaps.get(path);
        if (!id && ctx) {
            for (const ref of src.componentPropRefs ?? []) {
                if (ref.componentPropNodeField !== "OVERRIDDEN_SYMBOL_ID") continue;
                const v = ctx.props.get(guidKey(ref.defID));
                if (v?.symbolIdValue?.guid) id = v.symbolIdValue.guid;
            }
        }
        return byGuid.get(guidKey(id ?? src.symbolData?.symbolID));
    };

    // A layer's imported motion as Nagma keyframes. Translation keys are offsets from the layer's
    // place; scale and opacity are absolute; a frame's timeline length becomes its duration.
    const motionOf = (c: Change, node: SceneNode): Animation | null => {
        const out: Animation = { tracks: {} };
        const put = (prop: AnimProp, keys: MotionKey[], map: (v: MotionValue) => number | string | null) => {
            const list: Keyframe[] = [];
            for (const k of keys) {
                const v = map(k.v);
                if (v === null) continue;
                list.push({ t: k.t, v, easing: k.easing, ...(k.bezier ? { bezier: k.bezier } : {}) });
            }
            if (list.length) out.tracks[prop] = list;
        };
        const num = (v: MotionValue) => (typeof v === "number" ? v : null);
        for (const entry of ((c as Fig).parameterConsumptionMap as { entries?: { variableField?: string; variableData?: Fig }[] } | undefined)?.entries ?? []) {
            const track = trackOf(entry.variableData);
            // A text stagger preset's tracks animate each unit, not the layer (see figTextStagger).
            if (track && node.type === "text" && staggerTracks.has(track)) continue;
            const keys = track ? tracks.get(track) : undefined;
            if (!keys) continue;
            switch (entry.variableField) {
                case "MOTION_TRANSLATION_X":
                    put("x", keys, (v) => (typeof v === "number" ? node.x + v : null));
                    break;
                case "MOTION_TRANSLATION_Y":
                    put("y", keys, (v) => (typeof v === "number" ? node.y + v : null));
                    break;
                case "MOTION_TRANSLATION_XY":
                    put("x", keys, (v) => (typeof v === "object" && "x" in v && !("r" in v) ? node.x + v.x : null));
                    put("y", keys, (v) => (typeof v === "object" && "y" in v && !("r" in v) ? node.y + v.y : null));
                    break;
                case "PATH_TRIM_START":
                    put("trimStart", keys, num);
                    break;
                case "PATH_TRIM_END":
                    put("trimEnd", keys, num);
                    break;
                case "MOTION_SCALE_XY":
                    put("scaleX", keys, (v) => (typeof v === "object" && "x" in v ? v.x : typeof v === "number" ? v : null));
                    put("scaleY", keys, (v) => (typeof v === "object" && "y" in v ? v.y : typeof v === "number" ? v : null));
                    break;
                case "MOTION_SCALE_X":
                    put("scaleX", keys, num);
                    break;
                case "MOTION_SCALE_Y":
                    put("scaleY", keys, num);
                    break;
                case "MOTION_ROTATION":
                    // Radians, clockwise on screen.
                    put("rotation", keys, (v) => (typeof v === "number" ? node.rotation + (v * 180) / Math.PI : null));
                    break;
                case "OPACITY":
                    // Motion opacity is stored in percent.
                    put("opacity", keys, (v) => (typeof v === "number" ? Math.max(0, Math.min(1, v / 100)) : null));
                    break;
                case "WIDTH":
                    put("w", keys, num);
                    break;
                case "HEIGHT":
                    put("h", keys, num);
                    break;
                case "CORNER_RADIUS":
                    put("radius", keys, num);
                    break;
                default:
                    skipped.add(`motion on ${String(entry.variableField).toLowerCase().replace(/_/g, " ")}`);
            }
        }
        // A colour animated on the first solid fill.
        for (const paint of c.fillPaints ?? []) {
            const track = trackOf((paint.colorVar as Fig | undefined) ?? undefined);
            const keys = track ? tracks.get(track) : undefined;
            if (!keys || paint.type !== "SOLID") continue;
            put("fill", keys, (v) => (typeof v === "object" && "r" in v ? hex(v) : null));
            break;
        }
        const duration = (c as Fig).timelineDuration;
        if (duration !== undefined) out.duration = Number(duration) / 1000;
        return Object.keys(out.tracks).length || out.duration ? out : null;
    };

    let pageOrder = 0;

    const add = (node: SceneNode, parentId: string | null) => {
        nodes[node.id] = node;
        if (parentId) nodes[parentId]?.children.push(node.id);
        else roots.push(node.id);
    };

    // `prefix` is the chain of instances (by override key) above this layer: the format's override
    // paths name only nested instances and the target, not the plain frames in between.
    // Linked instances: where each imported layer sits relative to the component (or top-level
    // instance) it belongs to, by the same override-key path the format uses. Instances are linked to
    // their components after the whole file is read (linkInstances below).
    interface LinkCtx {
        root: string;
        path: (Guid | undefined)[];
    }
    const linkOf = new Map<string, { root: string; key: string }>();
    // Prototype interactions point at layers by their id in the file; they're resolved once every layer exists.
    const nodeByGuid = new Map<string, SceneNode>();
    const pendingInteractions: { node: SceneNode; raw: Fig[] }[] = [];
    const symbolNode = new Map<string, string>();
    const instanceSymbol = new Map<string, string>();
    let internalPageId: string | null = null;

    const visit = async (src: Change, parentId: string | null, origin: { x: number; y: number }, parentChange: Change | null, ctx: Expansion | null, prefix: (Guid | undefined)[], link: LinkCtx | null = null): Promise<void> => {
        const key = guidKey(src.guid);
        const pk = ctx ? pathKey([...prefix, pathId(src)]) : "";
        let c = resolved(src, pk, ctx);
        // An instance: find its component and gather its overrides now, since an override aimed at
        // the component itself styles the instance's own frame (its fill, size, radius...).
        let expansion: { symbol: Change; ctx: Expansion; prefix: (Guid | undefined)[] } | null = null;
        if (src.type === "INSTANCE") {
            const symbol = symbolOf(src, pk, ctx);
            if (symbol && (ctx?.depth ?? 0) <= 24) {
                const inner = ctx ? [...prefix, pathId(src)] : [];
                const next: Expansion = ctx ? { ...ctx, overrides: new Map(ctx.overrides), derived: new Map(ctx.derived), swaps: new Map(ctx.swaps), props: new Map(ctx.props), depth: ctx.depth + 1 } : { overrides: new Map(), derived: new Map(), swaps: new Map(), props: new Map(), depth: 0 };
                seed(next, c, inner);
                if (src !== c) seed(next, src, inner);
                const root = next.overrides.get(pathKey([...inner, pathId(symbol)]));
                if (root) {
                    c = applyOverride(c, root);
                    // The outer instance's own override of this layer still wins.
                    const outer = ctx?.overrides.get(pk);
                    if (outer) c = applyOverride(c, outer);
                }
                expansion = { symbol, ctx: next, prefix: inner };
            } else if (!symbol) skipped.add("instances whose component is missing");
        }
        c = withStyles(c);
        // A code layer's stored preview becomes its fill.
        if (/^CODE_/.test(String(c.type)) && codeSnapshotPaints(c).length) c = { ...c, fillPaints: codeSnapshotPaints(c), strokePaints: [] };
        else if (/^CODE_/.test(String(c.type)) && c.codeObjectType !== "ANIMATION_PRESET") skipped.add("code layer previews (not stored in the file)");
        const type = typeOf(c);
        if (type === "skip") {
            const quiet = new Set(["DOCUMENT", "VARIABLE", "VARIABLE_SET", "KEYFRAME_TRACK", "KEYFRAME", "ANIMATION_PRESET_INSTANCE", "CODE_COMPONENT"]);
            if (c.type && !quiet.has(c.type)) skipped.add(`${c.type.toLowerCase().replace(/_/g, " ")} layers`);
            if (c.type === "DOCUMENT") for (const child of children.get(key) ?? []) await visit(child, null, { x: 0, y: 0 }, null, null, []);
            return;
        }
        if (type === "page") {
            // The format's hidden canvas holds library components; instances reach them through the index.
            // It becomes this file's hidden internal page, so instances can link to its components.
            const internal = c.name === "Internal Only Canvas" || Boolean((c as Fig).internalOnly);
            const page = makeNode(naming, "page", { x: 0, y: 0, w: 1, h: 1 }, null, internal ? { name: "Internal", internal: true } : { name: c.name || `Page ${++pageOrder}` });
            add(page, null);
            if (internal) internalPageId = page.id;
            for (const child of children.get(key) ?? []) await visit(child, page.id, { x: 0, y: 0 }, c, null, []);
            return;
        }
        const t = c.transform ?? IDENTITY;
        const size = c.size ?? { x: 100, y: 100 };
        // A mirrored layer (negative determinant) is a flip plus a rotation, not a bigger rotation.
        const det = t.m00 * t.m11 - t.m01 * t.m10;
        const rotation = (Math.atan2(t.m10, t.m00) * 180) / Math.PI;
        const w = Math.max(0.01, size.x);
        const h = Math.max(0.01, size.y);
        // The format positions the layer's top-left after rotation about it; Nagma rotates about the centre.
        const cx = origin.x + t.m02 + (t.m00 * w + t.m01 * h) / 2;
        const cy = origin.y + t.m12 + (t.m10 * w + t.m11 * h) / 2;
        const x = cx - w / 2;
        const y = cy - h / 2;

        const fillSet = await paintsWithVars(c.fillPaints);
        const strokeSet = await paintsWithVars(c.strokePaints);
        const fills = fillSet.paints;
        const strokes = strokeSet.paints;
        let fillVars = fillSet.vars;
        let strokeVars = strokeSet.vars;
        let stagger: ReturnType<typeof figTextStagger> = null;
        const overrides: Partial<SceneNode> = {
            name: c.name || c.type || "Layer",
            visible: c.visible !== false,
            opacity: typeof c.opacity === "number" ? c.opacity : 1,
            fills,
            strokes,
            strokeWidth: strokes.length ? (c.strokeWeight ?? 1) : 0,
            strokeAlign: c.strokeAlign === "INSIDE" ? "inside" : c.strokeAlign === "OUTSIDE" ? "outside" : "center",
            strokeCap: c.strokeCap === "ROUND" ? "round" : c.strokeCap === "SQUARE" ? "square" : "butt",
            strokeJoin: c.strokeJoin === "ROUND" ? "round" : c.strokeJoin === "BEVEL" ? "bevel" : "miter",
            dash: c.dashPattern && c.dashPattern.length >= 2 ? [c.dashPattern[0] ?? 0, c.dashPattern[1] ?? 0] : null,
            radius: c.cornerRadius ?? 0,
            blendMode: BLENDS[String(c.blendMode ?? "NORMAL")] ?? "normal",
            rotation: Math.round(rotation * 100) / 100,
            flipY: det < 0,
        };
        if (c.rectangleCornerRadiiIndependent) overrides.radii = [c.rectangleTopLeftCornerRadius ?? 0, c.rectangleTopRightCornerRadius ?? 0, c.rectangleBottomRightCornerRadius ?? 0, c.rectangleBottomLeftCornerRadius ?? 0];
        if (typeof c.cornerSmoothing === "number" && c.cornerSmoothing > 0) overrides.cornerSmoothing = c.cornerSmoothing;
        if (c.arcData && (c.arcData.endingAngle - c.arcData.startingAngle < Math.PI * 2 - 1e-3 || c.arcData.innerRadius > 0)) {
            overrides.arc = { start: (c.arcData.startingAngle * 180) / Math.PI, sweep: ((c.arcData.endingAngle - c.arcData.startingAngle) * 180) / Math.PI, inner: c.arcData.innerRadius };
        }
        if (c.mask) {
            overrides.isMask = true;
            overrides.maskType = c.maskType === "VECTOR" ? "vector" : c.maskType === "LUMINANCE" ? "luminance" : "alpha";
        }
        const cap = (v: string | undefined): SceneNode["strokeCapStart"] =>
            v === "ARROW_LINES" ? "arrow-lines" : v === "ARROW_EQUILATERAL" ? "arrow-equilateral" : v === "TRIANGLE_FILLED" || v === "TRIANGLE_ARROW" ? "triangle" : v === "CIRCLE_FILLED" ? "circle" : v === "DIAMOND_FILLED" ? "diamond" : undefined;
        const capStart = cap(c.strokeCapStart ?? c.strokeCap);
        const capEnd = cap(c.strokeCapEnd ?? c.strokeCap);
        if (capStart) overrides.strokeCapStart = capStart;
        if (capEnd) overrides.strokeCapEnd = capEnd;
        // Path trim: the stroke drawn only between two fractions of the outline.
        const trim = ((c as Fig).pathTrim as { value?: { x?: number; y?: number } } | undefined)?.value;
        if (trim && ((trim.x ?? 0) > 0 || (trim.y ?? 1) < 1)) {
            overrides.trimStart = trim.x ?? 0;
            overrides.trimEnd = trim.y ?? 1;
        }
        // Variable width: the format's width points (ascent + descent, as multiples of the stroke weight)
        // read at the start, middle and end of the path.
        const widths = ((c as Fig).variableWidthPoints as { position: number; ascent?: number; descent?: number }[] | undefined) ?? [];
        if (widths.length >= 2) {
            const sorted = [...widths].sort((a, b) => a.position - b.position);
            const at = (pos: number) => {
                let i = 0;
                while (i < sorted.length - 1 && (sorted[i + 1]?.position ?? 1) < pos) i++;
                const a = sorted[i] as (typeof sorted)[number];
                const b = (sorted[i + 1] ?? a) as (typeof sorted)[number];
                const f = b.position > a.position ? Math.max(0, Math.min(1, (pos - a.position) / (b.position - a.position))) : 0;
                const wa = (a.ascent ?? 0.5) + (a.descent ?? 0.5);
                const wb = (b.ascent ?? 0.5) + (b.descent ?? 0.5);
                return wa + (wb - wa) * f;
            };
            const profile: [number, number, number] = [at(0), at(0.5), at(1)];
            if (profile.some((v) => Math.abs(v - 1) > 1e-3)) overrides.strokeProfile = profile;
        }
        if (typeof c.minWidth === "number") overrides.minW = c.minWidth;
        if (typeof c.maxWidth === "number") overrides.maxW = c.maxWidth;
        if (typeof c.minHeight === "number") overrides.minH = c.minHeight;
        if (typeof c.maxHeight === "number") overrides.maxH = c.maxHeight;
        if (c.stackPositioning === "ABSOLUTE") overrides.positioning = "absolute";
        // Effects: every shadow and blur, in order (with the variables their fields are bound to).
        const effectVars: Record<string, string> = {};
        for (const e of c.effects ?? []) {
            if (e.visible === false) continue;
            const at = overrides.effects?.length ?? 0;
            const pending: Record<string, string> = {};
            for (const [field, key] of [["colorVar", "color"], ["radiusVar", "blur"], ["spreadVar", "spread"], ["xVar", "x"], ["yVar", "y"]] as const) {
                const v = variableOf((e as Fig)[field]);
                if (v) pending[`effect:${at}:${key}`] = v;
            }
            const kind = String(e.type ?? "");
            const color = e.color as { r: number; g: number; b: number; a?: number } | undefined;
            const offset = (e.offset as { x: number; y: number } | undefined) ?? { x: 0, y: 4 };
            const blend = BLENDS[String(e.blendMode ?? "NORMAL")] ?? "normal";
            const effect = { visible: true, x: offset.x, y: offset.y, blur: Number(e.radius ?? 4), spread: Number(e.spread ?? 0), color: hex(color), opacity: color?.a ?? 0.25, ...(blend !== "normal" && blend !== "pass-through" ? { blend } : {}) };
            if (kind === "DROP_SHADOW") overrides.effects = [...(overrides.effects ?? []), { ...effect, type: "drop-shadow", showBehind: e.showShadowBehindNode === true }];
            else if (kind === "INNER_SHADOW") overrides.effects = [...(overrides.effects ?? []), { ...effect, type: "inner-shadow" }];
            else if (kind === "FOREGROUND_BLUR" || kind === "LAYER_BLUR") overrides.effects = [...(overrides.effects ?? []), { ...effect, type: "layer-blur" }];
            else if (kind === "BACKGROUND_BLUR") overrides.effects = [...(overrides.effects ?? []), { ...effect, type: "background-blur" }];
            // Files exported in 2026 have no motion blur effect type (their EffectType list is shadows,
            // blurs, repeat, symmetry, grain, noise, glass and custom); a later one is read by name,
            // its direction from the offset.
            else if (kind === "MOTION_BLUR" || kind === "DIRECTIONAL_BLUR") overrides.effects = [...(overrides.effects ?? []), { ...effect, type: "motion-blur", x: 0, y: 0, angle: (Math.atan2(offset.y, offset.x) * 180) / Math.PI }];
            else if (kind === "SHADER" && (typeof e.code === "string" || typeof (e.shader as Fig | undefined)?.code === "string")) {
                const code = typeof e.code === "string" ? e.code : String((e.shader as Fig).code);
                overrides.effects = [...(overrides.effects ?? []), { ...effect, type: "shader", x: 0, y: 0, blur: 0, opacity: 1, shader: { code, uniforms: parseUniforms(code) } }];
            }
            else skipped.add(`${kind.toLowerCase().replace(/_/g, " ")} effects`);
            if ((overrides.effects?.length ?? 0) > at) Object.assign(effectVars, pending);
        }

        // Auto layout sizing. The format leaves the primary axis out when it hugs; the counter axis says
        // so when it hugs. A child grows along its parent's direction or stretches across it.
        let sizing: SceneNode["sizing"] = { h: "fixed", v: "fixed" };
        const stacked = c.stackMode === "HORIZONTAL" || c.stackMode === "VERTICAL";
        if (stacked) {
            const primaryHug = c.stackPrimarySizing !== "FIXED";
            const counterHug = c.stackCounterSizing === "RESIZE_TO_FIT" || c.stackCounterSizing === "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE";
            if (c.stackMode === "HORIZONTAL") sizing = { h: primaryHug ? "hug" : "fixed", v: counterHug ? "hug" : "fixed" };
            else sizing = { h: counterHug ? "hug" : "fixed", v: primaryHug ? "hug" : "fixed" };
        }
        if (type === "text") sizing = c.textAutoResize === "WIDTH_AND_HEIGHT" ? { h: "hug", v: "hug" } : c.textAutoResize === "HEIGHT" ? { h: "fixed", v: "hug" } : { h: "fixed", v: "fixed" };
        const parentDir = parentChange?.stackMode === "HORIZONTAL" ? "h" : parentChange?.stackMode === "VERTICAL" ? "v" : null;
        if (parentDir && c.stackPositioning !== "ABSOLUTE") {
            const across = parentDir === "h" ? "v" : "h";
            if (c.stackChildPrimaryGrow && c.stackChildPrimaryGrow > 0) sizing = { ...sizing, [parentDir]: "fill" };
            if (c.stackChildAlignSelf === "STRETCH") sizing = { ...sizing, [across]: "fill" };
        }
        overrides.sizing = sizing;
        // A hugging stack keeps its constraints, so it grows from the side they pin (a frame pinned
        // to the bottom grows upwards when its padding or content changes).
        if (stacked && (sizing.h === "hug" || sizing.v === "hug")) {
            const ch = FIG_H_CONSTRAINTS[String((c as Fig).horizontalConstraint ?? "MIN")] ?? "left";
            const cv = FIG_V_CONSTRAINTS[String((c as Fig).verticalConstraint ?? "MIN")] ?? "top";
            if (ch !== "left" || cv !== "top") overrides.constraints = { h: ch, v: cv };
        }

        if (type === "frame" || type === "component") {
            overrides.clip = !c.frameMaskDisabled;
            if (c.type === "SECTION") {
                overrides.isSection = true;
                overrides.clip = false;
            }
            if (stacked) {
                const pr = c.stackPrimaryAlignItems ?? c.stackJustify ?? "MIN";
                const co = c.stackCounterAlignItems ?? c.stackCounterAlign ?? "MIN";
                const align = (v: string): "start" | "center" | "end" => (v === "CENTER" ? "center" : v === "MAX" ? "end" : "start");
                overrides.layout = {
                    direction: c.stackMode === "HORIZONTAL" ? "horizontal" : "vertical",
                    gap: Number.isFinite(c.stackSpacing) ? (c.stackSpacing as number) : 0,
                    // The left and top fields are only the left and top padding: a missing right or
                    // bottom is 0 (older files used one stackPadding for every side).
                    padding: [
                        c.stackVerticalPadding ?? c.stackPadding ?? 0,
                        c.stackPaddingRight ?? (c.stackHorizontalPadding === undefined ? (c.stackPadding ?? 0) : 0),
                        c.stackPaddingBottom ?? (c.stackVerticalPadding === undefined ? (c.stackPadding ?? 0) : 0),
                        c.stackHorizontalPadding ?? c.stackPadding ?? 0,
                    ],
                    primary: pr === "SPACE_EVENLY" || pr === "SPACE_BETWEEN" ? "between" : align(pr),
                    counter: align(co),
                    wrap: c.stackWrap === "WRAP",
                    // The format writes NaN for an automatic row gap.
                    counterGap: Number.isFinite(c.stackCounterSpacing) ? c.stackCounterSpacing : undefined,
                    reverseZ: c.stackReverseZIndex ? true : undefined,
                    strokesIncluded: (c as Fig).bordersTakeSpace ? true : undefined,
                    loneCenter: pr === "SPACE_EVENLY" ? true : undefined,
                };
            }
            const guides: LayoutGuide[] = [];
            for (const g of c.layoutGrids ?? []) {
                const pattern = String(g.pattern ?? "COLUMNS");
                const color = g.color as { r: number; g: number; b: number; a?: number } | undefined;
                const kind = String(g.type ?? "STRETCH");
                const sections = Number(g.numSections ?? 5);
                guides.push({
                    // Stripes split one axis: across X they are columns, across Y rows.
                    kind: pattern === "GRID" ? "grid" : pattern === "ROWS" || String(g.axis ?? "X") === "Y" ? "rows" : "columns",
                    // The format stores an automatic count as a huge or non-positive number.
                    count: sections > 0 && sections < 1000 ? sections : 5,
                    countAuto: !(sections > 0 && sections < 1000) && kind !== "STRETCH" ? true : undefined,
                    gutter: Number(g.gutterSize ?? 20),
                    margin: Number(g.offset ?? 0),
                    size: Number(g.sectionSize ?? 8),
                    color: hex(color ?? { r: 1, g: 0.3, b: 0.3 }),
                    opacity: typeof color?.a === "number" ? color.a : undefined,
                    align: kind === "MIN" ? "start" : kind === "MAX" ? "end" : kind === "CENTER" ? "center" : "stretch",
                    visible: g.visible !== false,
                });
            }
            if (guides.length) overrides.guides = guides;
        }
        if (type === "text") {
            // The format's paragraph separator is a newline here; its soft line break (U+2028) is kept.
            overrides.text = (c.textData?.characters ?? "").replace(/\u2029/g, "\n");
            overrides.name = c.name || overrides.text.slice(0, 24) || "Text";
            overrides.fontSize = c.fontSize ?? 16;
            overrides.fontFamily = c.fontName?.family ?? "Inter";
            overrides.fontWeight = weightOf(c.fontName?.style);
            overrides.italic = /italic|oblique/i.test(c.fontName?.style ?? "");
            overrides.textAlign = c.textAlignHorizontal === "CENTER" ? "center" : c.textAlignHorizontal === "RIGHT" ? "right" : c.textAlignHorizontal === "JUSTIFIED" ? "justify" : "left";
            overrides.textAlignV = c.textAlignVertical === "CENTER" ? "middle" : c.textAlignVertical === "BOTTOM" ? "bottom" : "top";
            if (c.lineHeight) {
                if (c.lineHeight.units === "PERCENT") overrides.lineHeight = c.lineHeight.value / 100;
                else if (c.lineHeight.units === "RAW") overrides.lineHeight = c.lineHeight.value;
                else overrides.lineHeight = c.lineHeight.value / (c.fontSize ?? 16);
            }
            if (c.letterSpacing) overrides.letterSpacing = c.letterSpacing.units === "PERCENT" ? c.letterSpacing.value : (c.letterSpacing.value / (c.fontSize ?? 16)) * 100;
            overrides.decoration = c.textDecoration === "UNDERLINE" ? "underline" : c.textDecoration === "STRIKETHROUGH" ? "strikethrough" : "none";
            overrides.textCase = c.textCase === "UPPER" ? "upper" : c.textCase === "LOWER" ? "lower" : c.textCase === "TITLE" ? "title" : c.textCase === "SMALL_CAPS" || c.textCase === "SMALL_CAPS_FORCED" ? "small-caps" : "none";
            if (typeof c.maxLines === "number" && c.maxLines > 0) overrides.maxLines = c.maxLines;
            if (typeof c.paragraphSpacing === "number") overrides.paragraphSpacing = c.paragraphSpacing;
            if (typeof c.paragraphIndent === "number") overrides.paragraphIndent = c.paragraphIndent;
            // Rich text (styled runs), lists, OpenType features and variable axes (engine/fig-text.ts).
            const f = c as Fig;
            if (typeof f.listSpacing === "number" && f.listSpacing) overrides.listSpacing = f.listSpacing;
            if (f.hangingList === true) overrides.hangingList = true;
            if (f.hangingPunctuation === true) overrides.hangingPunctuation = true;
            if (f.leadingTrim === "CAP_HEIGHT") overrides.leadingTrim = "cap";
            const features = figFeatures(f);
            if (features) overrides.openType = features;
            const axes = figVariations(f);
            if (axes) overrides.fontVariations = axes;
            const rich = await figRichText(
                c.textData as Fig | undefined,
                { fontFamily: overrides.fontFamily, fontWeight: overrides.fontWeight, italic: overrides.italic, fontSize: overrides.fontSize, lineHeight: overrides.lineHeight ?? null, lineHeightPx: c.lineHeight?.units === "PIXELS" ? c.lineHeight.value : null },
                overrides.text.length,
                { styleOf: (ref) => styleOf(ref) as Fig | undefined, paints: async (list) => (await paintsWithVars(list)).paints, weightOf },
            );
            if (rich.spans) overrides.spans = rich.spans;
            if (rich.paragraphs) overrides.paragraphs = rich.paragraphs;
            stagger = figTextStagger(f, { node: (k) => byGuid.get(k) as Fig | undefined, tracks, key: (g) => guidKey(g as Guid), codeComponent: (k) => codeComponents.get(k) });
        }
        if (type === "vector") {
            // The fill outline is the shape itself; for strokes-only shapes (lines) the path is the stroke's centre.
            let subs = geometry(c, "fillGeometry");
            let fromStroke = false;
            // Stroke-only vectors: the centreline from the vector network, so the stroke stays a stroke.
            const vd = (c as Fig).vectorData as { vectorNetworkBlob?: number; normalizedSize?: { x: number; y: number }; styleOverrideTable?: { styleID: number; cornerRadius?: number }[] } | undefined;
            const netBlob = typeof vd?.vectorNetworkBlob === "number" ? blobs[vd.vectorNetworkBlob] : undefined;
            if (!fills.length && strokes.length && netBlob && vd?.normalizedSize) {
                const table = new Map((vd.styleOverrideTable ?? []).map((t) => [t.styleID, t.cornerRadius]));
                const base = c.cornerRadius ?? 0;
                const net = parseVectorNetwork(netBlob, vd.normalizedSize.x ? w / vd.normalizedSize.x : 1, vd.normalizedSize.y ? h / vd.normalizedSize.y : 1, (style) => table.get(style) ?? base);
                if (net.length) subs = net;
            }
            if (!subs.length) {
                const stroked = geometry(c, "strokeGeometry");
                if (stroked.length) {
                    subs = stroked;
                    fromStroke = true;
                }
            }
            if (!subs.length && c.type === "LINE") subs = [{ closed: false, points: [{ x: 0, y: 0, in: null, out: null }, { x: w, y: 0, in: null, out: null }] }];
            if (subs.length) {
                // Geometry is in the layer's own space; keep it there so it lines up with the box.
                overrides.path = { w, h, subpaths: subs };
                // A brush or outlined stroke comes as filled geometry: paint it with the stroke colour.
                if (fromStroke && !fills.length && strokes.length) {
                    overrides.fills = strokes;
                    overrides.strokes = [];
                    overrides.strokeWidth = 0;
                    fillVars = strokeVars;
                    strokeVars = [];
                }
            } else skipped.add("vector shapes without stored geometry");
        }
        if (type === "boolean") {
            const op = String(c.booleanOperation ?? "UNION");
            overrides.booleanOp = op === "SUBTRACT" ? "subtract" : op === "INTERSECT" ? "intersect" : op === "EXCLUDE" ? "exclude" : "union";
        }

        // Colours bound to variables stay bound (solid paints at full paint opacity; others just take
        // the variable's colour once the document is built).
        const bound: Record<string, string> = {};
        fillVars.forEach((v, i) => {
            if (v) bound[`fill:${i}`] = v;
        });
        strokeVars.forEach((v, i) => {
            if (v) bound[`stroke:${i}`] = v;
        });
        for (const [k, v] of Object.entries(fillSet.stopVars)) bound[`fill:${k}`] = v;
        for (const [k, v] of Object.entries(strokeSet.stopVars)) bound[`stroke:${k}`] = v;
        Object.assign(bound, effectVars);
        Object.assign(bound, fieldBindings(c));
        if (Object.keys(bound).length) overrides.boundVariables = bound;
        const modes = modesOf(c);
        if (modes) overrides.variableModes = modes;
        // The format's "Hide when publishing" on this file's own components (a "." or "_" name already says it).
        const local = !(c as Fig).sourceLibraryKey;
        if (local && (c.type === "SYMBOL" ? (c as Fig).isSymbolPublishable === false : (c as Fig).isStateGroup && (c as Fig).isPublishable === false) && !/^\s*[._]/.test(c.name ?? "")) overrides.hiddenFromPublishing = true;
        // Layers keep their link to the file's styles, like the format's style references.
        const styleId = (ref: unknown) => {
            const st = styleOf(ref);
            return st ? `fig-style-${refKeys(st)[0]}` : null;
        };
        const fsId = styleId((c as Fig).styleIdForFill);
        if (fsId && fills.length) overrides.fillStyleId = fsId;
        const ssId = styleId((c as Fig).styleIdForStrokeFill);
        if (ssId && strokes.length) overrides.strokeStyleId = ssId;
        const tsId = c.type === "TEXT" ? styleId((c as Fig).styleIdForText) : null;
        if (tsId) overrides.textStyleId = tsId;
        const esId = styleId((c as Fig).styleIdForEffect);
        if (esId) overrides.effectStyleId = esId;

        const node = makeNode(naming, type, { x: 0, y: 0, w: 1, h: 1 }, parentId, overrides);
        ids[key] ??= node.id;
        // Keep the format's exact geometry (makeNode rounds).
        // The format occasionally stores NaN geometry (seen on a boolean in Untitled UI); one such layer
        // must not turn the camera or the layout around it into NaN.
        node.x = Number.isFinite(x) ? x : (origin.x ?? 0);
        node.y = Number.isFinite(y) ? y : (origin.y ?? 0);
        node.w = Number.isFinite(w) ? w : 1;
        node.h = Number.isFinite(h) ? h : 1;
        if (!Number.isFinite(node.rotation)) node.rotation = 0;
        const motion = motionOf(c, node);
        if (motion) node.animation = motion;
        if (stagger) node.animation = { ...(node.animation ?? { tracks: {} }), stagger };
        add(node, parentId);
        if (link) linkOf.set(node.id, { root: link.root, key: pathKey([...link.path, pathId(src)]) });
        if (!ctx && !nodeByGuid.has(key)) nodeByGuid.set(key, node);
        const rawInteractions = ((c as Fig).prototypeInteractions as Fig[] | undefined)?.filter((it) => !it.isDeleted);
        if (rawInteractions?.length) pendingInteractions.push({ node, raw: rawInteractions });
        const start = (c as Fig).prototypeStartingPoint as { name?: string; description?: string } | undefined;
        if (start && !ctx) {
            node.flowStart = true;
            if (start.name) node.flowName = start.name;
            if (start.description) node.flowDescription = start.description;
        }
        if (src.type === "SYMBOL") symbolNode.set(key, node.id);
        // Inside a component, keys are relative to the component; a component's children start fresh.
        const childLink: LinkCtx | null = src.type === "SYMBOL" ? { root: node.id, path: [] } : link;

        if (src.type === "INSTANCE") {
            // Rebuild the instance's layers from its component.
            if (!expansion) return;
            node.name = c.name || expansion.symbol.name || "Instance";
            instanceSymbol.set(node.id, guidKey(expansion.symbol.guid));
            const inner: LinkCtx = link ? { root: link.root, path: [...link.path, pathId(src)] } : { root: node.id, path: [] };
            for (const child of children.get(guidKey(expansion.symbol.guid)) ?? []) await visit(child, node.id, { x, y }, expansion.symbol, expansion.ctx, expansion.prefix, inner);
            return;
        }
        for (const child of children.get(key) ?? []) await visit(child, node.id, { x, y }, c, ctx, prefix, childLink);
    };

    const roots_ = changes.filter((c) => !c.parentIndex || !byGuid.has(guidKey(c.parentIndex.guid)));
    for (const root of roots_) await visit(root, null, { x: 0, y: 0 }, null, null, []);
    // The internal page goes last, so the file opens on its first real page.
    if (internalPageId) {
        const at = roots.indexOf(internalPageId);
        if (at >= 0) roots.push(...roots.splice(at, 1));
    }
    // Linking gives instance layers new ids: the guid → layer map follows them.
    const relinked = linkInstances(nodes, roots, linkOf, symbolNode, instanceSymbol);
    for (const [guid, id] of Object.entries(ids)) ids[guid] = relinked.get(id) ?? id;
    for (const { node, raw } of pendingInteractions) {
        const refs: FigRefs = { ...prototypeRefs, node: (guid) => nodeByGuid.get(guid)?.id ?? null };
        const list = raw.map((it) => figInteraction(it, refs)).filter((it): it is Interaction => it !== null);
        if (list.length) node.interactions = list;
    }
    // Instances (and their layers) inherit interactions from their components, like any other
    // property they don't override: interactive components animate in every instance.
    for (let pass = 0; pass < 6; pass++) {
        let changed = false;
        for (const node of Object.values(nodes)) {
            if (node.interactions?.length || node.overrides?.includes("interactions")) continue;
            const from = node.sourceId ? nodes[node.sourceId] : node.type === "instance" && node.componentId ? nodes[node.componentId] : undefined;
            if (from?.interactions?.length) {
                node.interactions = from.interactions;
                changed = true;
            }
        }
        if (!changed) break;
    }
    // The file's colour, text and effect styles, so they show in the Design panel and libraries.
    const docStyles: Styles = { colors: [], texts: [], effects: [] };
    const seenStyles = new Set<string>();
    for (const st of changes) {
        const kind = (st as Fig).styleType;
        if (!kind) continue;
        const id = `fig-style-${refKeys(st)[0]}`;
        if (seenStyles.has(id)) continue;
        seenStyles.add(id);
        const name = st.name || "Style";
        const hide = !(st as Fig).sourceLibraryKey && (st as Fig).isPublishable === false && !/^\s*[._]/.test(name) ? { hiddenFromPublishing: true } : {};
        if (kind === "FILL") {
            const set = await paintsWithVars(st.fillPaints);
            const paint = set.paints[0];
            if (paint) docStyles.colors.push({ id, name, paint, ...(set.vars[0] ? { variableId: set.vars[0] } : {}), ...hide });
        } else if (kind === "TEXT") {
            const lh = st.lineHeight;
            const size = st.fontSize ?? 16;
            docStyles.texts.push({
                ...hide,
                id,
                name,
                fontFamily: st.fontName?.family ?? "Inter",
                fontSize: size,
                fontWeight: weightOf(st.fontName?.style),
                italic: /italic|oblique/i.test(st.fontName?.style ?? ""),
                lineHeight: !lh ? null : lh.units === "PERCENT" ? lh.value / 100 : lh.units === "RAW" ? lh.value : lh.value / size,
                letterSpacing: !st.letterSpacing ? 0 : st.letterSpacing.units === "PERCENT" ? (st.letterSpacing.value / 100) * size : st.letterSpacing.value,
            });
        } else if (kind === "EFFECT") {
            const effects = ((st as Fig).effects as Fig[] | undefined) ?? [];
            const drop = effects.find((e) => e.visible !== false && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"));
            const blur = effects.find((e) => e.visible !== false && (e.type === "FOREGROUND_BLUR" || e.type === "LAYER_BLUR"));
            const color = drop?.color as { r: number; g: number; b: number; a?: number } | undefined;
            const offset = (drop?.offset as { x: number; y: number } | undefined) ?? { x: 0, y: 4 };
            docStyles.effects?.push({
                ...hide,
                id,
                name,
                shadow: drop ? { x: offset.x, y: offset.y, blur: Number(drop.radius ?? 4), color: hex(color), opacity: color?.a ?? 0.25 } : null,
                blur: blur ? Number(blur.radius ?? 0) : 0,
            });
        }
    }
    let doc: NagmaDocument = { name, nodes, roots, images: docImages };
    if (docStyles.colors.length || docStyles.texts.length || docStyles.effects?.length) doc = { ...doc, styles: docStyles };
    if (collections.length) doc = resolveImportedVariables({ ...doc, variables: collections });
    if (!doc.roots.length) {
        const page = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Page 1" });
        doc = { ...doc, nodes: { ...doc.nodes, [page.id]: page }, roots: [page.id] };
    }
    return { doc, skipped: [...skipped], kind, ids, product: flat.product };
}

// Imported colours bound to variables take the variable's value in the mode each layer resolves
// in. Our binding keeps the paint at the variable's opacity, so a paint with its own opacity just
// takes the colour and is left unbound.
function resolveImportedVariables(doc: NagmaDocument): NagmaDocument {
    for (const node of Object.values(doc.nodes)) {
        const bound = node.boundVariables;
        if (!bound) continue;
        for (const [key, id] of Object.entries(bound)) {
            const m = /^(fill|stroke):(\d+)$/.exec(key);
            if (!m) continue;
            const list = m[1] === "fill" ? node.fills : node.strokes;
            const paint = list[Number(m[2])];
            if (!paint || paint.type !== "solid" || paint.opacity === 1) continue;
            const r = resolveVariable(doc, id, node);
            if (r && typeof r.value === "string") paint.color = r.value;
            delete bound[key];
        }
        if (!Object.keys(bound).length) delete node.boundVariables;
    }
    return resolveVariables(doc);
}

// Reads a .fig (zip or bare canvas) into a document.
export async function importFig(file: File): Promise<FigImportResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const images = new Map<string, Uint8Array>();
    let canvas: Uint8Array | null = null;
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (isZip) {
        const entries = unzipSync(bytes);
        for (const [path, data] of Object.entries(entries)) {
            if (path === "canvas.fig" || path.endsWith("/canvas.fig")) canvas = data;
            const m = /(?:^|\/)images\/([0-9a-f]+)$/i.exec(path);
            if (m?.[1]) images.set(m[1].toLowerCase(), data);
        }
    } else canvas = bytes;
    if (!canvas) throw new Error("No canvas.fig inside the file.");
    const { message, blobs } = decodeFig(canvas);
    const name = file.name.replace(/\.(fig|deck|buzz|jam)$/i, "") || "Imported";
    return figToDocument(message, blobs, images, name, figKind(canvas));
}

// .fig (design), .deck (slides) and .buzz (campaign) share one container.
export function isFigFile(file: File): boolean {
    return /\.(fig|deck|buzz)$/i.test(file.name);
}

// ---- Linked instances ----

// Turns every imported instance (built as a frame of copied layers) into a real instance of its
// component: the instance keeps a link to the component, its layers become mirrors of the
// component's layers (with the ids engine/components.ts gives mirrors), and whatever differs from
// the component is recorded as an override, so editing the component updates the instance and the
// instance keeps the format's own changes (text, colours, visibility, sizes, swaps).
const LINK_SKIP = new Set(["id", "type", "parentId", "children", "componentId", "sourceId", "overrides", "x", "y", "propValues", "componentProps", "animation"]);

// Returns the ids it changed (old → new).
function linkInstances(nodes: Record<string, SceneNode>, roots: string[], linkOf: Map<string, { root: string; key: string }>, symbolNode: Map<string, string>, instanceSymbol: Map<string, string>): Map<string, string> {
    const compOf = (instanceId: string): string | undefined => {
        const sym = instanceSymbol.get(instanceId);
        return sym ? symbolNode.get(sym) : undefined;
    };
    // Each component's layers by their key inside it.
    const index = new Map<string, Map<string, string>>();
    for (const [id, l] of linkOf) {
        let m = index.get(l.root);
        if (!m) index.set(l.root, (m = new Map()));
        m.set(l.key, id);
    }
    const rel = (key: string, base: string) => (base ? (key.startsWith(`${base}/`) ? key.slice(base.length + 1) : null) : key);
    const remap = new Map<string, string>();
    const finalId = (id: string) => remap.get(id) ?? id;
    // A mirror gets a final id once its owner is processed; work on copies keyed by the old id.
    const done = new Set<string>();
    const busy = new Set<string>();

    const differs = (a: unknown, b: unknown) => a !== b && JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    const overridesOf = (mirror: SceneNode, source: SceneNode, expectX: number, expectY: number): string[] => {
        const out: string[] = [];
        const m = mirror as unknown as Record<string, unknown>;
        const s = source as unknown as Record<string, unknown>;
        for (const k of new Set([...Object.keys(m), ...Object.keys(s)])) {
            if (LINK_SKIP.has(k)) continue;
            if (differs(m[k], s[k])) out.push(k);
        }
        if (Math.abs(mirror.x - expectX) > 0.01) out.push("x");
        if (Math.abs(mirror.y - expectY) > 0.01) out.push("y");
        return out;
    };

    // Maps the layers under `parent` (an instance, or a swapped nested instance) onto the component.
    const linkChildren = (parentOld: string, comp: string, keyBase: string, prefix: string, dx: number, dy: number) => {
        const compIndex = index.get(comp);
        for (const childOld of nodes[parentOld]?.children ?? []) {
            const node = nodes[childOld];
            const l = linkOf.get(childOld);
            const r = l ? rel(l.key, keyBase) : null;
            const sourceOld = r !== null ? compIndex?.get(r) : undefined;
            if (!node || !sourceOld || !nodes[sourceOld]) continue;
            const sourceId = finalId(sourceOld);
            const id = `${prefix};${sourceId}`;
            remap.set(childOld, id);
            const source = nodes[sourceOld] as SceneNode;
            const overrides = overridesOf(node, source, source.x + dx, source.y + dy);
            node.sourceId = sourceId;
            if (instanceSymbol.has(childOld)) {
                const eff = compOf(childOld);
                node.type = "instance";
                if (eff) {
                    processComponent(eff);
                    node.componentId = eff;
                }
                const sourceComp = source.componentId;
                if (eff && sourceComp && eff !== sourceComp) {
                    // Swapped: its styling is compared with its own component; its place with the layer it replaces.
                    const effNode = nodes[eff];
                    const swapped = effNode ? overridesOf({ ...node, name: node.name }, { ...effNode, x: source.x, y: source.y }, source.x + dx, source.y + dy) : overrides;
                    if (effNode && node.name !== effNode.name && !swapped.includes("name")) swapped.push("name");
                    swapped.push("componentId");
                    node.overrides = swapped;
                    linkChildren(childOld, eff, l?.key ?? "", id, node.x - (effNode?.x ?? 0), node.y - (effNode?.y ?? 0));
                    continue;
                }
            }
            node.overrides = overrides;
            linkChildren(childOld, comp, keyBase, prefix, dx, dy);
        }
    };

    const linkInstance = (instOld: string, keyBase: string) => {
        const comp = compOf(instOld);
        const inst = nodes[instOld];
        const compNode = comp ? nodes[comp] : undefined;
        if (!comp || !inst || !compNode) return;
        processComponent(comp);
        inst.type = "instance";
        inst.componentId = comp;
        const own: string[] = [];
        const a = inst as unknown as Record<string, unknown>;
        const b = compNode as unknown as Record<string, unknown>;
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (LINK_SKIP.has(k) || k === "hiddenFromPublishing" || k === "description" || k === "docLinks") continue;
            if (differs(a[k], b[k])) own.push(k);
        }
        inst.overrides = own;
        linkChildren(instOld, comp, keyBase, finalId(instOld), inst.x - compNode.x, inst.y - compNode.y);
    };

    // Instances that aren't inside another instance's layers: walk a subtree and link them.
    const linked = new Set<string>();
    const linkWithin = (id: string, insideInstance: boolean, top = false) => {
        const node = nodes[id];
        if (!node) return;
        // Components are linked on their own (processComponent), once.
        if (!top && done.has(id)) return;
        if (instanceSymbol.has(id) && !insideInstance) {
            if (linked.has(id)) return;
            linked.add(id);
            const l = linkOf.get(id);
            // Inside a component its layers' keys start with its own key; at the top they start fresh.
            linkInstance(id, l ? l.key : "");
            return;
        }
        for (const c of node.children) linkWithin(c, insideInstance);
    };

    function processComponent(comp: string) {
        if (done.has(comp) || busy.has(comp)) return;
        busy.add(comp);
        linkWithin(comp, false, true);
        busy.delete(comp);
        done.add(comp);
    }

    for (const comp of symbolNode.values()) processComponent(comp);
    for (const root of roots) linkWithin(root, false);

    if (!remap.size) return remap;
    // Apply the new ids everywhere.
    const renamed: Record<string, SceneNode> = {};
    for (const [id, node] of Object.entries(nodes)) {
        const next = finalId(id);
        node.id = next;
        if (node.parentId) node.parentId = finalId(node.parentId);
        node.children = node.children.map(finalId);
        if (node.sourceId) node.sourceId = finalId(node.sourceId);
        if (node.componentId) node.componentId = finalId(node.componentId);
        renamed[next] = node;
    }
    for (const id of Object.keys(nodes)) delete nodes[id];
    Object.assign(nodes, renamed);
    return remap;
}

// ---- Prototype interactions ----

const FIG_TRIGGERS: Record<string, Trigger> = {
    ON_CLICK: "click",
    ON_HOVER: "hover",
    ON_PRESS: "press",
    ON_DRAG: "drag",
    DRAG: "drag",
    AFTER_TIMEOUT: "delay",
    MOUSE_ENTER: "mouse-enter",
    MOUSE_LEAVE: "mouse-leave",
    MOUSE_IN: "mouse-enter",
    MOUSE_OUT: "mouse-leave",
    MOUSE_DOWN: "mouse-down",
    MOUSE_UP: "mouse-up",
    ON_KEY_DOWN: "key",
    ON_MEDIA_END: "video-end",
    ON_MEDIA_HIT: "video-time",
};

const FIG_TRANSITIONS: Record<string, TransitionType> = {
    INSTANT_TRANSITION: "instant",
    DISSOLVE: "dissolve",
    FADE: "dissolve",
    SMART_ANIMATE: "smart",
    MOVE_IN: "move-in",
    MOVE_OUT: "move-out",
    PUSH: "push",
    SLIDE_IN: "slide-in",
    SLIDE_OUT: "slide-out",
    SCROLL_ANIMATE: "smart",
};

const FIG_EASINGS: Record<string, Easing> = {
    LINEAR: "linear",
    EASE_IN: "ease-in",
    EASE_OUT: "ease-out",
    EASE_IN_AND_OUT: "ease-in-out",
    EASE_IN_BACK: "ease-in-back",
    EASE_OUT_BACK: "ease-out-back",
    EASE_IN_AND_OUT_BACK: "ease-in-out-back",
    CUSTOM_CUBIC: "custom-bezier",
    GENTLE_SPRING: "spring-gentle",
    SPRING_PRESET_ONE: "spring-gentle",
    QUICK_SPRING: "spring-quick",
    SPRING_PRESET_TWO: "spring-quick",
    BOUNCY_SPRING: "spring-bouncy",
    SPRING_PRESET_THREE: "spring-bouncy",
    SLOW_SPRING: "spring-slow",
    CUSTOM_SPRING: "custom-spring",
};

const FIG_DIRECTIONS: Record<string, Transition["direction"]> = { LEFT: "left", RIGHT: "right", TOP: "up", BOTTOM: "down" };

const FIG_H_CONSTRAINTS: Record<string, Constraints["h"]> = { MIN: "left", MAX: "right", CENTER: "center", STRETCH: "left-right", SCALE: "scale" };
const FIG_V_CONSTRAINTS: Record<string, Constraints["v"]> = { MIN: "top", MAX: "bottom", CENTER: "center", STRETCH: "top-bottom", SCALE: "scale" };

// Layer fields the format binds to variables, as binding keys (engine/variables.ts).
const FIG_FIELDS: Record<string, string> = {
    VISIBLE: "visible",
    WIDTH: "w",
    HEIGHT: "h",
    MIN_WIDTH: "minW",
    MAX_WIDTH: "maxW",
    MIN_HEIGHT: "minH",
    MAX_HEIGHT: "maxH",
    OPACITY: "opacity",
    CORNER_RADIUS: "radius",
    RECTANGLE_TOP_LEFT_CORNER_RADIUS: "radius:0",
    RECTANGLE_TOP_RIGHT_CORNER_RADIUS: "radius:1",
    RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS: "radius:2",
    RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS: "radius:3",
    STROKE_WEIGHT: "strokeWidth",
    STACK_SPACING: "gap",
    STACK_COUNTER_SPACING: "counterGap",
    STACK_PADDING_TOP: "padding:0",
    STACK_PADDING_RIGHT: "padding:1",
    STACK_PADDING_BOTTOM: "padding:2",
    STACK_PADDING_LEFT: "padding:3",
    TEXT_DATA: "text",
    FONT_FAMILY: "fontFamily",
    FONT_SIZE: "fontSize",
    PARAGRAPH_SPACING: "paragraphSpacing",
    PARAGRAPH_INDENT: "paragraphIndent",
};

// What prototype actions point at, resolved to Nagma ids.
interface FigRefs {
    node: (guid: string) => string | null;
    variable: (ref: unknown) => string | null;
    collection: (ref: unknown) => string | null;
}

const FIG_OPERATORS: Record<string, string> = {
    ADDITION: "+",
    SUBTRACTION: "-",
    MULTIPLY: "*",
    DIVIDE: "/",
    EQUALS: "==",
    NOT_EQUAL: "!=",
    LESS_THAN: "<",
    LESS_THAN_OR_EQUAL: "<=",
    GREATER_THAN: ">",
    GREATER_THAN_OR_EQUAL: ">=",
    AND: "and",
    OR: "or",
};

// Browser key names for the key codes the format stores on a key trigger.
const FIG_KEYS: Record<number, string> = {
    8: "Backspace",
    9: "Tab",
    13: "Enter",
    27: "Escape",
    32: " ",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    36: "Home",
    37: "ArrowLeft",
    38: "ArrowUp",
    39: "ArrowRight",
    40: "ArrowDown",
    46: "Delete",
    186: ";",
    187: "=",
    188: ",",
    189: "-",
    190: ".",
    191: "/",
    192: "`",
    219: "[",
    220: "\\",
    221: "]",
    222: "'",
};

function figKey(codes: unknown): string | null {
    // Modifiers (shift, control, alt, command) come with the key they modify; the key decides.
    const list = ((codes as number[] | undefined) ?? []).filter((c) => c !== 16 && c !== 17 && c !== 18 && c !== 91 && c !== 93);
    const code = list[list.length - 1];
    if (code === undefined) return null;
    if (FIG_KEYS[code]) return FIG_KEYS[code];
    if (code >= 65 && code <= 90) return String.fromCharCode(code).toLowerCase();
    if (code >= 48 && code <= 57) return String.fromCharCode(code);
    if (code >= 96 && code <= 105) return String(code - 96);
    if (code >= 112 && code <= 123) return `F${code - 111}`;
    return null;
}

// An imported variable value or expression as expression text (engine/expressions.ts), or null when it
// uses something the expressions can't say.
function figExpression(data: Fig | undefined, refs: FigRefs): string | null {
    const value = (data?.value ?? {}) as Fig;
    if (value.alias) {
        const id = refs.variable(value.alias);
        return id ? `{{${id}}}` : null;
    }
    if (typeof value.boolValue === "boolean") return literal(value.boolValue);
    if (typeof value.floatValue === "number") return literal(Math.fround(value.floatValue) === value.floatValue ? Number(value.floatValue.toPrecision(7)) : value.floatValue);
    if (typeof value.textValue === "string") return literal(value.textValue);
    if (value.colorValue) return hex(value.colorValue as { r: number; g: number; b: number });
    const expr = value.expressionValue as { expressionFunction?: string; expressionArguments?: Fig[] } | undefined;
    if (!expr) return null;
    const args = (expr.expressionArguments ?? []).map((a) => figExpression(a, refs));
    if (args.some((a) => a === null)) return null;
    const [a, b] = args as string[];
    const fn = String(expr.expressionFunction);
    const op = FIG_OPERATORS[fn];
    if (op && a !== undefined && b !== undefined) return `(${a} ${op} ${b})`;
    if (a === undefined) return null;
    if (fn === "NOT") return `(not ${a})`;
    if (fn === "NEGATE") return `(-${a})`;
    if (fn === "IS_TRUTHY") return `(not (not ${a}))`;
    // Joining with empty text turns a number into text.
    if (fn === "STRINGIFY") return `("" + ${a})`;
    return null;
}

// One action of an imported interaction, conditionals with their branches.
function figAction(a: Fig, refs: FigRefs): PrototypeAction | null {
    const nav = String(a.navigationType ?? "NAVIGATE");
    const conn = String(a.connectionType ?? "INTERNAL_NODE");
    if (conn === "CONDITIONAL") {
        const blocks = ((a.conditionalActions as Fig[] | undefined) ?? []).map((branch) => {
            // No condition: the "else". A condition the expressions can't read never matches.
            const condition = branch.condition ? (figExpression(branch.condition as Fig, refs) ?? "false") : null;
            const actions = ((branch.actions as Fig[] | undefined) ?? []).map((x) => figAction(x, refs)).filter((x): x is PrototypeAction => x !== null);
            return { condition, actions };
        });
        return blocks.length ? { type: "conditional", blocks } : null;
    }
    if (conn === "SET_VARIABLE") {
        const variableId = refs.variable((a.targetVariable as Fig | undefined)?.id) ?? refs.variable(a.targetVariableID ? { guid: a.targetVariableID } : null);
        const data = (a.targetVariableData as Fig | undefined) ?? (a.targetVariableValue ? { value: a.targetVariableValue } : undefined);
        const expression = figExpression(data, refs);
        return variableId && expression ? { type: "set-variable", variableId, expression } : null;
    }
    if (conn === "SET_VARIABLE_MODE") {
        const collectionId = refs.collection(a.targetVariableSetID);
        const modeId = a.targetVariableModeID ? guidKey(a.targetVariableModeID as Guid) : null;
        return collectionId && modeId ? { type: "set-mode", collectionId, modeId } : null;
    }
    const target = a.transitionNodeID ? refs.node(guidKey(a.transitionNodeID as Guid)) : null;
    const easingName = String(a.easingType ?? "EASE_OUT");
    const fn = a.easingFunction as number[] | undefined;
    const transition: Transition = {
        type: FIG_TRANSITIONS[String(a.transitionType ?? "INSTANT_TRANSITION")] ?? "instant",
        direction: FIG_DIRECTIONS[String(a.transitionDirection ?? "LEFT")] ?? "left",
        duration: Math.round(Number(a.transitionDuration ?? 0.3) * 1000),
        easing: FIG_EASINGS[easingName] ?? (fn && fn.length === 4 ? "custom-bezier" : "ease-out"),
        ...(fn && fn.length === 4 && (easingName === "CUSTOM_CUBIC" || !FIG_EASINGS[easingName]) ? { bezier: [fn[0], fn[1], fn[2], fn[3]] as [number, number, number, number] } : {}),
        ...(a.easingFunction && easingName === "CUSTOM_SPRING" && fn && fn.length >= 3 ? { spring: { mass: fn[0] ?? 1, stiffness: fn[1] ?? 100, damping: fn[2] ?? 15 } } : {}),
    };
    let type: PrototypeAction["type"] | null = null;
    if (conn === "BACK") type = "back";
    else if (conn === "CLOSE") type = "close";
    else if (conn === "URL") type = "url";
    else if (conn !== "INTERNAL_NODE" && conn !== "NONE") type = null;
    else if (nav === "SWAP_STATE") type = "change-to";
    else if (nav === "OVERLAY") type = "overlay";
    else if (nav === "SWAP") type = "swap";
    else if (nav === "SCROLL_TO") type = "scroll-to";
    else if (nav === "NAVIGATE") type = "navigate";
    if (!type) return null;
    if ((type === "navigate" || type === "change-to" || type === "overlay" || type === "swap" || type === "scroll-to") && !target) return null;
    return { type, target, transition, ...(type === "url" ? { url: String(a.connectionURL ?? ""), newTab: Boolean(a.openUrlInNewTab ?? true) } : {}), ...(a.transitionPreserveScroll === false ? { resetScroll: true } : {}) };
}

// One imported prototype interaction (trigger plus actions) in Nagma's form.
function figInteraction(raw: Fig, refs: FigRefs): Interaction | null {
    const event = (raw.event ?? {}) as Fig;
    const trigger = FIG_TRIGGERS[String(event.interactionType ?? "ON_CLICK")];
    if (!trigger) return null;
    const actions = ((raw.actions as Fig[] | undefined) ?? []).map((a) => figAction(a, refs)).filter((a): a is PrototypeAction => a !== null);
    if (!actions.length) return null;
    const key = trigger === "key" ? figKey(((event.keyTrigger as Fig | undefined)?.keyCodes as unknown) ?? event.keyCodes) : null;
    if (trigger === "key" && !key) return null;
    return {
        trigger,
        delay: trigger === "delay" ? Math.round(Number(event.transitionTimeout ?? 0) * 1000) : 0,
        ...(key ? { key } : {}),
        ...(trigger === "video-time" ? { videoTime: Number(event.mediaHitTime ?? 0) } : {}),
        actions,
    };
}
