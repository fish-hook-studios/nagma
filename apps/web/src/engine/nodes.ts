import { nanoid } from "nanoid";
import { activePage, layerRoots } from "./page";
import { boundsOfPoints, containsPoint, corners } from "./transform";
import { effectsOf } from "./effects";
import { migratePaints, solid } from "./paint";
import { snapPx } from "./pixel-grid";
import type { Animation, Effect, NagmaDocument, NodeType, Paint, Rect, SceneNode, TrackProp } from "./types";

const TYPE_LABELS: Record<NodeType, string> = {
    page: "Page",
    frame: "Frame",
    component: "Component",
    componentSet: "Component set",
    instance: "Instance",
    group: "Group",
    boolean: "Boolean",
    vector: "Vector",
    rect: "Rectangle",
    ellipse: "Ellipse",
    text: "Text",
};

// "Rectangle 3": numbers count the siblings in the same container (a frame numbers its own
// contents from 1), not every layer in the file. Without a parent the page's top level counts.
export function nextName(doc: NagmaDocument, type: NodeType, parentId: string | null = null): string {
    return nextLabelName(doc, TYPE_LABELS[type], parentId);
}

// "<label> N" with N one past the highest among the siblings (lines, arrows, polygons and stars are
// vectors with names of their own: "Line 1", "Star 2").
export function nextLabelName(doc: NagmaDocument, label: string, parentId: string | null = null): string {
    const scope = parentId && doc.nodes[parentId] ? doc.nodes[parentId].children : parentId ? [] : (doc.nodes[activePage.id]?.children ?? doc.roots);
    const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`);
    let highest = 0;
    const count = (id: string) => {
        const match = doc.nodes[id]?.name.match(pattern);
        if (match) highest = Math.max(highest, Number(match[1]));
    };
    for (const id of scope) count(id);
    // Names inside the page's components count too, so a new layer never shares a name with one
    // of a component's layers (instances would show two layers of that name).
    const walk = (id: string, inside: boolean) => {
        const node = doc.nodes[id];
        if (!node) return;
        const within = inside || node.type === "component" || node.type === "componentSet";
        if (inside) count(id);
        for (const child of node.children) walk(child, within);
    };
    for (const id of doc.nodes[activePage.id]?.children ?? doc.roots) walk(id, false);
    return `${label} ${highest + 1}`;
}

function defaultFills(type: NodeType): Paint[] {
    if (type === "frame" || type === "component") return [solid("#FFFFFF")];
    if (type === "text") return [solid("#000000")];
    if (type === "rect" || type === "ellipse" || type === "boolean") return [solid("#D9D9D9")];
    return [];
}

export function makeNode(
    doc: NagmaDocument,
    type: NodeType,
    rect: Rect,
    parentId: string | null,
    overrides: Partial<SceneNode> = {},
): SceneNode {
    const grid = type === "frame" || type === "component" || type === "componentSet" ? Math.round : snapPx;
    const base: SceneNode = {
        id: nanoid(10),
        type,
        name: type === "text" ? (overrides.text ?? "Text") : nextName(doc, type, parentId),
        parentId,
        children: [],
        // Frames, sections and components always sit on whole pixels; other layers follow
        // "Snap to pixel grid".
        x: grid(rect.x),
        y: grid(rect.y),
        w: Math.max(1, grid(rect.w)),
        h: Math.max(1, grid(rect.h)),
        rotation: 0,
        flipX: false,
        flipY: false,
        fills: defaultFills(type),
        strokes: [],
        strokeAlign: "inside",
        // Frames and groups pass their children's blending through.
        blendMode: type === "frame" || type === "group" || type === "component" || type === "componentSet" || type === "instance" ? "pass-through" : "normal",
        strokeWidth: 1,
        radius: 0,
        opacity: 1,
        shadow: null,
        blur: 0,
        clip: true,
        layout: null,
        sizing: type === "text" ? { h: "hug", v: "hug" } : { h: "fixed", v: "fixed" },
        visible: true,
        locked: false,
    };
    if (type === "text") {
        // New text: 12px Inter Regular, black, auto width, left aligned.
        base.text = "Text";
        base.fontSize = 12;
        base.fontWeight = 400;
        base.textAlign = "left";
    }
    return { ...base, ...overrides };
}

// Fills in fields added after a document was saved, so older autosaves still open.
export function normalizeNode(node: Partial<SceneNode> & Pick<SceneNode, "id" | "type">): SceneNode {
    const defaults = makeNode({ name: "", nodes: {}, roots: [], images: {} }, node.type, { x: 0, y: 0, w: 1, h: 1 }, null);
    const legacy = migratePaints(node as unknown as Record<string, unknown>);
    const merged = { ...defaults, ...node, ...legacy, children: node.children ?? [], parentId: node.parentId ?? null } as SceneNode & Record<string, unknown>;
    // Drop the old single-paint fields once converted.
    delete merged.fill;
    delete merged.fillOpacity;
    delete merged.fillVisible;
    delete merged.stroke;
    delete merged.image;
    return migrateTracks(merged);
}

// Keyframe tracks saved under older names: per-side stroke weights as "strokeTop"..., and the
// first shadow, blur, glass or noise effect's values by name ("shadowX", "glassDepth"...). They
// become "borderTop"... and effect-index tracks ("fx0.x"), the one encoding Motion now uses.
const LEGACY_SIDES: Record<string, TrackProp> = { strokeTop: "borderTop", strokeRight: "borderRight", strokeBottom: "borderBottom", strokeLeft: "borderLeft" };
const SHADOW_KINDS: Effect["type"][] = ["drop-shadow", "inner-shadow"];
const BLUR_KINDS: Effect["type"][] = ["layer-blur", "background-blur"];
const LEGACY_EFFECTS: Record<string, { kinds: Effect["type"][]; field: string }> = {
    shadowX: { kinds: SHADOW_KINDS, field: "x" },
    shadowY: { kinds: SHADOW_KINDS, field: "y" },
    shadowBlur: { kinds: SHADOW_KINDS, field: "blur" },
    shadowSpread: { kinds: SHADOW_KINDS, field: "spread" },
    shadowColor: { kinds: SHADOW_KINDS, field: "color" },
    blur: { kinds: BLUR_KINDS, field: "blur" },
    blurStart: { kinds: BLUR_KINDS, field: "startBlur" },
    glassRefraction: { kinds: ["glass"], field: "refraction" },
    glassDepth: { kinds: ["glass"], field: "depth" },
    glassLightAngle: { kinds: ["glass"], field: "lightAngle" },
    glassLightIntensity: { kinds: ["glass"], field: "lightIntensity" },
    glassDispersion: { kinds: ["glass"], field: "dispersion" },
    glassSplay: { kinds: ["glass"], field: "splay" },
    noiseSizeX: { kinds: ["noise", "texture"], field: "noiseSize" },
    noiseSizeY: { kinds: ["noise", "texture"], field: "noiseSizeY" },
    noiseDensity: { kinds: ["noise"], field: "density" },
    noiseOpacity: { kinds: ["noise"], field: "opacity" },
    noiseColor2: { kinds: ["noise"], field: "color2" },
};

export function migrateTracks(node: SceneNode): SceneNode {
    const tracks = node.animation?.tracks as Record<string, Animation["tracks"][TrackProp]> | undefined;
    if (!tracks || !Object.keys(tracks).some((k) => k in LEGACY_SIDES || k in LEGACY_EFFECTS)) return node;
    // The old names found their effect through the legacy shadow and blur fields too: fold those
    // into the effects list so the indices line up.
    const effects = effectsOf(node);
    const out: Record<string, Animation["tracks"][TrackProp]> = {};
    let usesEffects = false;
    for (const [key, track] of Object.entries(tracks)) {
        const side = LEGACY_SIDES[key];
        const fx = LEGACY_EFFECTS[key];
        if (side) {
            if (!out[side]) out[side] = track;
        } else if (fx) {
            const i = effects.findIndex((e) => fx.kinds.includes(e.type));
            if (i < 0) continue;
            usesEffects = true;
            const name = `fx${i}.${fx.field}`;
            if (!out[name]) out[name] = track;
        } else out[key] = track;
    }
    const patch: Partial<SceneNode> = { animation: { ...node.animation!, tracks: out as Animation["tracks"] } };
    if (usesEffects && (node.shadow || node.blur > 0)) Object.assign(patch, { effects, shadow: null, blur: 0 });
    return { ...node, ...patch };
}

export function cloneSubtree(
    doc: NagmaDocument,
    id: string,
    offset: number,
    parentId: string | null,
    rename: (oldId: string) => string = () => nanoid(10),
): SceneNode[] {
    const node = doc.nodes[id];
    if (!node) return [];
    const copyId = rename(id);
    const copy: SceneNode = { ...node, id: copyId, parentId, children: [], x: node.x + offset, y: node.y + offset };
    // Layers inside a copied instance keep ids derived from the new instance, so their overrides carry over.
    let childRename: (oldId: string) => string = () => nanoid(10);
    if (node.type === "instance" && !node.sourceId) childRename = (oldId) => (oldId.startsWith(`${id};`) ? copyId + oldId.slice(id.length) : nanoid(10));
    else if (node.sourceId) childRename = rename;
    const out: SceneNode[] = [copy];
    for (const child of node.children) {
        const childCopies = cloneSubtree(doc, child, offset, copyId, childRename);
        const first = childCopies[0];
        if (first) copy.children.push(first.id);
        out.push(...childCopies);
    }
    return out;
}

// Selected ids without any whose ancestor is also selected, so subtrees are handled once.
export function topLevel(doc: NagmaDocument, ids: string[]): string[] {
    const set = new Set(ids);
    return ids.filter((id) => {
        let parent = doc.nodes[id]?.parentId ?? null;
        while (parent) {
            if (set.has(parent)) return false;
            parent = doc.nodes[parent]?.parentId ?? null;
        }
        return true;
    });
}

// Replaces groups with the layers inside them (recursively), for edits that act on real shapes.
export function expandGroups(doc: NagmaDocument, ids: string[]): string[] {
    return ids.flatMap((id) => {
        const node = doc.nodes[id];
        if (!node) return [];
        return node.type === "group" || node.type === "boolean" ? expandGroups(doc, node.children) : [id];
    });
}

// Back-to-front paint order of every node.
export function paintOrder(doc: NagmaDocument): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (ids: string[]) => {
        for (const id of ids) {
            const node = doc.nodes[id];
            if (!node) continue;
            out.push(node);
            visit(node.children);
        }
    };
    visit(layerRoots(doc));
    return out;
}

export function isEffectivelyVisible(doc: NagmaDocument, node: SceneNode): boolean {
    let current: SceneNode | undefined = node;
    while (current) {
        if (!current.visible) return false;
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return true;
}

export function isEffectivelyLocked(doc: NagmaDocument, node: SceneNode): boolean {
    let current: SceneNode | undefined = node;
    while (current) {
        if (current.locked) return true;
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return false;
}

// World-space bounding box of the given layers, including rotation.
export function selectionBounds(doc: NagmaDocument, ids: string[]): Rect | null {
    const points = ids.flatMap((id) => {
        const node = doc.nodes[id];
        return node ? corners(doc, node) : [];
    });
    return boundsOfPoints(points);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

// The deepest visible frame under a world point, used as the parent for new and dropped layers;
// the active page when the point is on bare canvas.
// The section under a point, or the page: sections are the one container that collects frames,
// and a section can only sit on the canvas or inside another section.
export function sectionAt(doc: NagmaDocument, x: number, y: number, exclude: Set<string> = new Set()): string {
    let found: string = activePage.id;
    const visit = (ids: string[]) => {
        for (const id of ids) {
            const node = doc.nodes[id];
            if (!node || !node.visible || !node.isSection || exclude.has(id)) continue;
            if (containsPoint(doc, node, x, y)) {
                found = id;
                visit(node.children);
            }
        }
    };
    visit(layerRoots(doc));
    return found;
}

export function frameAt(doc: NagmaDocument, x: number, y: number, exclude: Set<string> = new Set()): string {
    let found: string = activePage.id;
    const visit = (ids: string[]) => {
        for (const id of ids) {
            const node = doc.nodes[id];
            // Frames and components take dropped layers; instances don't (their contents come from the
            // component), except in their slots.
            if (!node || !node.visible || exclude.has(id) || node.isSlice) continue;
            const inInstance = node.type === "instance" || Boolean(node.sourceId);
            const slot = Boolean(node.sourceId && doc.nodes[node.sourceId]?.propBindings?.slot);
            if (!inInstance && node.type !== "frame" && node.type !== "component" && node.type !== "componentSet") continue;
            if (inInstance && !slot && node.type !== "instance" && node.type !== "frame") continue;
            if (containsPoint(doc, node, x, y)) {
                if (!inInstance || slot) found = id;
                visit(node.children);
            }
        }
    };
    visit(layerRoots(doc));
    return found;
}
