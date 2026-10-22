import { addBreakpointCommands, bpFrames, breakpointsOf, createSiteDocument, deleteBreakpointCommand, mirrorIdFor, PRIMARY_BP, updateBreakpointCommand, webData } from "../site/model";
import type { BreakpointId, SiteNodeData } from "../site/types";
import type { Capture } from "./capture-format";
import { buildCaptureLayers, CAPTURE_AT, CAPTURE_PATH, CAPTURE_URL, CAPTURE_WIDTH, cssColor, pageWidths, reanchor, type Anchor, type CaptureImportOptions, type CaptureWidth } from "./capture-import";
import { applyCommand, settle } from "./commands";
import { solid } from "./paint";
import type { Command, NagmaDocument, SceneNode } from "./types";

// A page capture taken at several widths as a site ("Open as a site"): the Home page with one
// breakpoint per width (the widest is the primary), each holding the page as it was at that width.
//
// The site is made with Sites' own helpers (createSiteDocument, the breakpoint commands) and its
// breakpoint sync does the rest: a layer on a narrower breakpoint that is the same element as one
// on the primary (the same DOM path, under the same parent) becomes that layer's copy, with what
// differs at that width as its overrides, so editing the primary's text or colour reaches every
// width. Elements the narrower page doesn't show are hidden there; elements only it has are its own.

export interface CaptureSiteResult {
    doc: NagmaDocument;
    pageId: string;
    // The breakpoint frames, widest first.
    frameIds: string[];
    families: string[];
    substituted: string[];
    missingImages: number;
}

// Never compared between a breakpoint's layer and the primary's (the sync's own list, plus where
// the importer keeps the DOM path).
const SKIP = new Set(["id", "parentId", "children", "site", "overrides", "locked", "pluginData"]);
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function ownWeb(node: SceneNode | undefined): SiteNodeData {
    const { src: _src, ov: _ov, rep: _rep, ...rest } = webData(node);
    return rest;
}

// The properties a breakpoint's layer changes from the primary's (positions relative to their parents).
function differences(copy: SceneNode, source: SceneNode, copyParent: SceneNode | undefined, sourceParent: SceneNode | undefined): string[] {
    const out: string[] = [];
    for (const key of new Set([...Object.keys(copy), ...Object.keys(source)])) {
        if (SKIP.has(key)) continue;
        const a = (copy as unknown as Record<string, unknown>)[key];
        const b = (source as unknown as Record<string, unknown>)[key];
        if (key === "x" || key === "y") {
            const rel = (n: SceneNode, p: SceneNode | undefined) => (n[key] as number) - (p ? (p[key] as number) : 0);
            if (Math.abs(rel(copy, copyParent) - rel(source, sourceParent)) > 0.01) out.push(key);
            continue;
        }
        if (!same(a, b)) out.push(key);
    }
    return out;
}

// The breakpoint ids for the widths (widest first), made from the page's default three: renamed,
// resized, added to or deleted from, each through the Sites helpers.
function setUpBreakpoints(start: NagmaDocument, pageId: string, widths: CaptureWidth[]): { doc: NagmaDocument; ids: BreakpointId[] } {
    let doc = start;
    const run = (command: Command | { error: string } | null) => {
        if (command && !("error" in command)) doc = applyCommand(doc, command);
    };
    const existing = breakpointsOf(doc, pageId).map((b) => b.id);
    // Fewer widths than breakpoints: the narrowest ones go.
    for (const id of existing.slice(Math.max(1, widths.length))) run(deleteBreakpointCommand(doc, pageId, id));
    const ids = existing.slice(0, widths.length);
    const isDefault = widths.length === 3 && widths.map((w) => w.width).join() === "1280,800,375";
    if (!isDefault) {
        // Starts: each narrower width from its own width up; the primary above the widest of them.
        // Moved out of the way first (tiny starts), so no step clashes with a start still in place.
        const second = widths[1]?.width ?? 0;
        const primaryMin = Math.max(second + 1, Math.min(widths[0]?.width ?? 1024, 1024));
        ids.slice(1).forEach((id, i) => run(updateBreakpointCommand(doc, pageId, id, { min: i + 1 })));
        run(updateBreakpointCommand(doc, pageId, PRIMARY_BP, { min: primaryMin }));
        ids.slice(1).forEach((id, i) => run(updateBreakpointCommand(doc, pageId, id, { min: widths[i + 1]?.width })));
    }
    widths.forEach((w, i) => {
        if (i < ids.length) {
            run(updateBreakpointCommand(doc, pageId, ids[i] as BreakpointId, { label: w.label, width: w.width }));
            return;
        }
        const added = addBreakpointCommands(doc, pageId, { label: w.label, width: w.width, min: w.width });
        if ("error" in added) return;
        doc = applyCommand(doc, { type: "batch", commands: added.commands });
        ids.push(added.bp);
    });
    return { doc, ids };
}

export function captureToSite(capture: Capture, options: CaptureImportOptions = {}): CaptureSiteResult {
    const name = capture.title?.trim() || (() => {
        try {
            return new URL(capture.url).hostname;
        } catch {
            return "";
        }
    })() || "Captured page";
    const widths = pageWidths(capture);
    const base = createSiteDocument(name);
    const pageId = base.roots[0] as string;
    const set = setUpBreakpoints(base, pageId, widths);
    let doc = set.doc;
    const frames = bpFrames(doc, pageId);
    const images: Record<string, string> = {};
    const nodes: Record<string, SceneNode> = { ...doc.nodes };
    const anchors: Anchor[] = [];
    const rename = new Map<string, string>();
    const families = new Set<string>();
    const substituted = new Set<string>();
    let missing = 0;
    const frameIds: string[] = [];
    const primary = frames[PRIMARY_BP] as SceneNode;
    // Paths of the primary's layers, to find the same element at the other widths.
    const byPath = new Map<string, SceneNode>();
    widths.forEach((at, i) => {
        const bp = set.ids[i] as BreakpointId;
        const frame = frames[bp];
        if (!frame) return;
        frameIds.push(frame.id);
        const made = buildCaptureLayers(capture, at, frame, options, images);
        made.families.forEach((f) => families.add(f));
        made.substituted.forEach((f) => substituted.add(f));
        missing += made.missingImages;
        anchors.push(...made.anchors);
        const bg = cssColor(at.background);
        const host: SceneNode = { ...(made.nodes[frame.id] as SceneNode), fills: [bg && bg.alpha > 0 ? solid(bg.hex, bg.alpha) : solid("#FFFFFF")], pluginData: { [CAPTURE_URL]: capture.url ?? "", [CAPTURE_AT]: capture.capturedAt ?? "", [CAPTURE_WIDTH]: String(at.width) } };
        made.nodes[frame.id] = host;
        if (i === 0) {
            Object.assign(nodes, made.nodes);
            for (const n of Object.values(made.nodes)) {
                const path = n.pluginData?.[CAPTURE_PATH];
                if (path && n.id !== frame.id && !byPath.has(path)) byPath.set(path, n);
            }
            return;
        }
        Object.assign(nodes, mirror(nodes, made.nodes, primary.id, frame.id, bp, byPath, rename));
    });
    const raw: NagmaDocument = { ...doc, nodes, images: { ...doc.images, ...images } };
    doc = settle({ ...doc, nodes: {}, roots: [] }, raw);
    doc = reanchor(doc, anchors, rename);
    return { doc, pageId, frameIds, families: [...families], substituted: [...substituted], missingImages: missing };
}

// A narrower width's layers, linked to the primary's: the same element under the same parent
// becomes that layer's breakpoint copy ("<primary id>@<bp>") with its differences as overrides;
// the rest stay this breakpoint's own; primary layers it lacks are put in hidden.
function mirror(primaryNodes: Record<string, SceneNode>, made: Record<string, SceneNode>, primaryFrame: string, frameId: string, bp: BreakpointId, byPath: Map<string, SceneNode>, rename: Map<string, string>): Record<string, SceneNode> {
    // This breakpoint's layer → the primary layer it is the same element as.
    const sourceOf = new Map<string, string>([[frameId, primaryFrame]]);
    const used = new Set<string>();
    const ids = new Map<string, string>([[frameId, frameId]]);
    const visit = (id: string) => {
        const n = made[id];
        if (!n) return;
        const parentSource = n.parentId ? sourceOf.get(n.parentId) : undefined;
        const path = n.pluginData?.[CAPTURE_PATH];
        const d = path ? byPath.get(path) : undefined;
        if (d && parentSource && d.parentId === parentSource && !used.has(d.id) && d.type === n.type) {
            sourceOf.set(id, d.id);
            used.add(d.id);
            ids.set(id, mirrorIdFor(d.id, bp));
        } else ids.set(id, id);
        n.children.forEach(visit);
    };
    (made[frameId]?.children ?? []).forEach(visit);
    const out: Record<string, SceneNode> = {};
    for (const [old, n] of Object.entries(made)) {
        const id = ids.get(old) ?? old;
        if (id !== old) rename.set(old, id);
        let node: SceneNode = { ...n, id, parentId: n.parentId ? (ids.get(n.parentId) ?? n.parentId) : null, children: n.children.map((c) => ids.get(c) ?? c) };
        const src = sourceOf.get(old);
        if (src && old !== frameId) {
            const d = primaryNodes[src] as SceneNode;
            const ov = differences(n, d, n.parentId ? made[n.parentId] : undefined, d.parentId ? primaryNodes[d.parentId] : undefined);
            // Its children keep this width's order.
            if (n.children.length) ov.push("children");
            node = { ...node, site: { ...ownWeb(n), src, ov: [...new Set(ov)] } };
            if (!same(ownWeb(n), ownWeb(d))) (node.site as SiteNodeData).ov = [...new Set([...(webData(node).ov ?? []), "site"])];
        }
        out[id] = node;
    }
    // The primary's layers this width doesn't have, under a parent it does: hidden here.
    const parentCopy = (primaryId: string) => (primaryId === primaryFrame ? frameId : used.has(primaryId) ? mirrorIdFor(primaryId, bp) : null);
    const hide = (primaryId: string) => {
        const d = primaryNodes[primaryId];
        if (!d) return;
        for (const c of d.children) {
            const child = primaryNodes[c];
            if (!child) continue;
            if (used.has(c)) {
                hide(c);
                continue;
            }
            const parentId = parentCopy(primaryId);
            const parent = parentId ? out[parentId] : undefined;
            if (!parent || !parentId) continue;
            const id = mirrorIdFor(c, bp);
            const x = parent.x + (child.x - d.x);
            const y = parent.y + (child.y - d.y);
            out[id] = { ...child, id, parentId, children: [], x, y, visible: false, site: { ...ownWeb(child), src: c, ov: ["visible"] } };
            out[parentId] = { ...parent, children: [...parent.children, id] };
        }
    };
    hide(primaryFrame);
    return out;
}
