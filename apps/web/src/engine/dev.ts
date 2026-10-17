import { nanoid } from "nanoid";
import { fitRect } from "./camera";
import { selectionBounds } from "./nodes";
import { pageOf } from "./page";
import { DEV_STATUS_COLORS, canHaveDevStatus, devStatusOf, setDevStatus } from "./dev-status";
import { editor } from "./store";
import { renderThumb } from "./thumb";
import type { NagmaDocument, SceneNode } from "./types";

// Inspect handoff: Ready for dev statuses (with a snapshot to compare against), dev resources,
// and the property-level differences since a frame was marked ready.

export type DevStatus = "ready" | "completed" | "changed";

export const STATUS_LABEL: Record<DevStatus, string> = { ready: "Ready for dev", changed: "Changed", completed: "Completed" };
export const STATUS_COLOR = DEV_STATUS_COLORS;

// One eligibility rule everywhere (engine/dev-status.ts): sections, and frames or components on
// the canvas or in a section.
export const canHaveStatus = canHaveDevStatus;

function subtreeIds(doc: NagmaDocument, id: string): string[] {
    const out: string[] = [];
    const walk = (nid: string) => {
        const n = doc.nodes[nid];
        if (!n) return;
        out.push(nid);
        n.children.forEach(walk);
    };
    walk(id);
    return out;
}

// Properties that are bookkeeping, not design.
const IGNORED = new Set(["devStatus", "devStatusSig", "devStatusNote", "devReady", "devResources", "codeConnect", "annotations", "measurements", "rulerGuides"]);

function sameNode(a: SceneNode, b: SceneNode): boolean {
    const ra = a as unknown as Record<string, unknown>;
    const rb = b as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (IGNORED.has(key)) continue;
        if (JSON.stringify(ra[key] ?? null) !== JSON.stringify(rb[key] ?? null)) return false;
    }
    return true;
}

// What the status reads as: a ready frame edited since is "Changed".
export function effectiveStatus(doc: NagmaDocument, node: SceneNode): DevStatus | null {
    if (!node.devStatus) return null;
    // The fingerprint (engine/dev-status.ts) decides; files marked before fingerprints compare
    // against their snapshot.
    if (node.devStatusSig !== undefined && node.devStatusSig !== null) return devStatusOf(doc, node);
    if (node.devStatus === "ready" && node.devReady && hasChanges(doc, node)) return "changed";
    return node.devStatus;
}

export function hasChanges(doc: NagmaDocument, node: SceneNode): boolean {
    const snap = node.devReady?.snapshot;
    if (!snap) return false;
    const now = subtreeIds(doc, node.id);
    if (now.length !== Object.keys(snap).length) return true;
    return now.some((id) => {
        const was = snap[id];
        const is = doc.nodes[id];
        return !was || !is || !sameNode(was, is);
    });
}

// One way to set a status everywhere (canvas badge, Design panel, Inspect).
export function setStatus(nodeId: string, status: DevStatus | null) {
    setDevStatus([nodeId], status);
}

// ---- Compare changes ----

export interface PropChange {
    key: string;
    before: string;
    after: string;
}

export interface LayerChange {
    id: string;
    name: string;
    kind: "added" | "removed" | "changed";
    props: PropChange[];
}

const show = (v: unknown): string => {
    if (v === undefined || v === null) return "None";
    if (typeof v === "number") return String(Math.round(v * 100) / 100);
    if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 59)}…` : v;
    if (typeof v === "boolean") return v ? "On" : "Off";
    const text = JSON.stringify(v);
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

export function compareChanges(doc: NagmaDocument, node: SceneNode): LayerChange[] {
    const snap = node.devReady?.snapshot ?? {};
    const now = subtreeIds(doc, node.id);
    const out: LayerChange[] = [];
    for (const id of now) {
        const is = doc.nodes[id];
        const was = snap[id];
        if (!is) continue;
        if (!was) {
            out.push({ id, name: is.name, kind: "added", props: [] });
            continue;
        }
        const ra = was as unknown as Record<string, unknown>;
        const rb = is as unknown as Record<string, unknown>;
        const props: PropChange[] = [];
        for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
            if (IGNORED.has(key) || key === "children") continue;
            if (JSON.stringify(ra[key] ?? null) !== JSON.stringify(rb[key] ?? null)) props.push({ key, before: show(ra[key]), after: show(rb[key]) });
        }
        const order = JSON.stringify(was.children) !== JSON.stringify(is.children);
        if (order && !props.length) props.push({ key: "layers", before: `${was.children.length} layers`, after: `${is.children.length} layers` });
        if (props.length) out.push({ id, name: is.name, kind: "changed", props });
    }
    for (const id of Object.keys(snap)) if (!doc.nodes[id] || !now.includes(id)) out.push({ id, name: snap[id]?.name ?? "Layer", kind: "removed", props: [] });
    return out;
}

// Pictures of the frame when it was marked ready and now.
export function comparePictures(doc: NagmaDocument, node: SceneNode): { before: string; after: string } {
    const snap = node.devReady?.snapshot ?? {};
    const nodes = { ...doc.nodes };
    for (const id of subtreeIds(doc, node.id)) delete nodes[id];
    Object.assign(nodes, snap);
    const page = node.parentId ? doc.nodes[node.parentId] : undefined;
    const pageFirst = (d: NagmaDocument) => {
        let p = page;
        while (p && p.type !== "page") p = p.parentId ? d.nodes[p.parentId] : undefined;
        return p ? { ...d, roots: [p.id, ...d.roots.filter((r) => r !== p?.id)] } : d;
    };
    return { before: renderThumb(pageFirst({ ...doc, nodes }), 480, 300, node.id), after: renderThumb(pageFirst(doc), 480, 300, node.id) };
}

// ---- Dev resources ----

export function addResource(nodeId: string, name: string, url: string) {
    const node = editor.get().doc.nodes[nodeId];
    if (!node) return;
    const clean = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
    let label = name.trim();
    if (!label) {
        try {
            label = new URL(clean).hostname.replace(/^www\./, "");
        } catch {
            label = clean;
        }
    }
    editor.execute({ type: "node.update", id: nodeId, patch: { devResources: [...(node.devResources ?? []), { id: nanoid(6), name: label, url: clean }] } });
}

export function removeResource(nodeId: string, id: string) {
    const node = editor.get().doc.nodes[nodeId];
    if (!node?.devResources) return;
    const rest = node.devResources.filter((r) => r.id !== id);
    editor.execute({ type: "node.update", id: nodeId, patch: { devResources: rest.length ? rest : undefined } });
}

// Every frame with a status, for the Inspect layers view.
export function statusFrames(doc: NagmaDocument): { node: SceneNode; status: DevStatus; page: SceneNode | undefined }[] {
    const out: { node: SceneNode; status: DevStatus; page: SceneNode | undefined }[] = [];
    for (const n of Object.values(doc.nodes)) {
        const status = n.devStatus ? effectiveStatus(doc, n) : null;
        if (!status) continue;
        let p: SceneNode | undefined = n;
        while (p && p.type !== "page") p = p.parentId ? doc.nodes[p.parentId] : undefined;
        out.push({ node: n, status, page: p });
    }
    return out;
}

// Selects a layer and frames it on the canvas (switching page when needed).
export function reveal(doc: NagmaDocument, id: string) {
    const node = doc.nodes[id];
    if (!node) return;
    const page = pageOf(doc, node);
    if (page && page !== editor.get().pageId) editor.setPage(page);
    editor.set({ selection: [id] });
    const box = selectionBounds(editor.get().doc, [id]);
    if (box) fitRect(box, 80, 4);
}

