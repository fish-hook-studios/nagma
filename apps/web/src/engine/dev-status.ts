// Inspect statuses on frames and sections: Ready for dev, Completed, and Changed.
// Marking takes a fingerprint of the design; any later edit inside it shows the status as Changed
// until someone marks it ready again (with a note on what changed). Exported for Inspect.
import { isFrameLike } from "./components";
import { collab } from "./collab";
import { notifyDevStatus } from "./dev-notify";
import { editor } from "./store";
import type { Command, NagmaDocument, SceneNode } from "./types";

export type DevStatus = "ready" | "completed" | "changed";

export const DEV_STATUS_LABELS: Record<DevStatus, string> = {
    ready: "Ready for dev",
    completed: "Completed",
    changed: "Changed",
};

// The one set of status colours (canvas badges, panel dots, the Ready for dev view): green for
// ready, orange for changed, grey for completed.
export const DEV_STATUS_COLORS: Record<DevStatus, string> = { ready: "#14AE5C", changed: "#FFA629", completed: "#8A8A94" };

// Fields that are about the status itself, not the design, so they never count as a change.
const IGNORED = new Set(["devStatus", "devStatusSig", "devStatusNote", "devReady", "devResources", "codeConnect", "annotations", "measurements", "rulerGuides", "editedAt", "pluginData", "relaunchData"]);

function fnv(text: string, seed = 0x811c9dc5): number {
    let h = seed;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// Layer objects are immutable, so each one's own hash is computed once.
// Layers keep absolute positions, so positions are hashed relative to the marked layer: moving a
// whole frame on the canvas isn't a design change, moving something inside it is.
const ownHashes = new WeakMap<SceneNode, number>();
function ownHash(node: SceneNode): number {
    let h = ownHashes.get(node);
    if (h === undefined) {
        h = fnv(JSON.stringify(node, (key, value) => (IGNORED.has(key) || key === "x" || key === "y" ? undefined : value)));
        ownHashes.set(node, h);
    }
    return h;
}

// A fingerprint of a layer and everything inside it.
export function designFingerprint(doc: NagmaDocument, id: string): string {
    const root = doc.nodes[id];
    if (!root) return "";
    let h = 0x811c9dc5;
    const visit = (nodeId: string) => {
        const node = doc.nodes[nodeId];
        if (!node) return;
        h = fnv(`${ownHash(node)}:${Math.round((node.x - root.x) * 100)}:${Math.round((node.y - root.y) * 100)}`, h);
        for (const child of node.children) visit(child);
    };
    visit(id);
    return h.toString(36);
}

// Frames and sections that can carry a status: sections, and frames on the canvas or in a section.
export function canHaveDevStatus(doc: NagmaDocument, node: SceneNode | undefined): node is SceneNode {
    if (!node || !isFrameLike(node) || node.isSlice || node.sourceId) return false;
    if (node.isSection) return true;
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    return Boolean(parent && (parent.type === "page" || parent.isSection));
}

// The status as it stands now: a ready or completed design that was edited since reads Changed.
export function devStatusOf(doc: NagmaDocument, node: SceneNode | undefined): DevStatus | null {
    if (!node?.devStatus) return null;
    if (node.devStatus === "changed") return "changed";
    if (node.devStatusSig && node.devStatusSig !== designFingerprint(doc, node.id)) return "changed";
    return node.devStatus;
}

// Every frame and section with a status, page by page (Inspect's "Ready for dev" view).
export function devStatusList(doc: NagmaDocument): { id: string; name: string; pageId: string; status: DevStatus; note: string | null }[] {
    const out: { id: string; name: string; pageId: string; status: DevStatus; note: string | null }[] = [];
    for (const pageId of doc.roots) {
        const visit = (ids: string[]) => {
            for (const id of ids) {
                const node = doc.nodes[id];
                if (!node) continue;
                const status = devStatusOf(doc, node);
                if (status) out.push({ id, name: node.name, pageId, status, note: node.devStatusNote ?? null });
                if (node.isSection) visit(node.children);
            }
        };
        visit(doc.nodes[pageId]?.children ?? []);
    }
    return out;
}

// The layers of a design when it's marked ready, for Inspect's Compare changes.
function readySnapshot(doc: NagmaDocument, id: string): Record<string, SceneNode> {
    const out: Record<string, SceneNode> = {};
    const walk = (nid: string) => {
        const n = doc.nodes[nid];
        if (!n) return;
        out[nid] = nid === id ? { ...n, devReady: null, devStatus: undefined } : n;
        n.children.forEach(walk);
    };
    walk(id);
    return out;
}

// The command that sets a status on layers; ready and completed take a fresh fingerprint, and
// ready keeps a snapshot (who, when, the layers) to compare later edits against.
export function devStatusCommand(doc: NagmaDocument, ids: string[], status: DevStatus | null, note?: string): Command {
    return {
        type: "batch",
        commands: ids
            .filter((id) => canHaveDevStatus(doc, doc.nodes[id]))
            .map((id) => ({
                type: "node.update" as const,
                id,
                patch: status
                    ? {
                          devStatus: status,
                          devStatusSig: status === "changed" ? null : designFingerprint(doc, id),
                          ...(note !== undefined ? { devStatusNote: note } : {}),
                          ...(status === "ready" ? { devReady: { at: Date.now(), by: collab.get().me.name || "Someone", snapshot: readySnapshot(doc, id) } } : {}),
                      }
                    : { devStatus: null, devStatusSig: null, devStatusNote: null, devReady: null },
            })),
    };
}

export function setDevStatus(ids: string[], status: DevStatus | null, note?: string) {
    const { doc } = editor.get();
    editor.execute(devStatusCommand(doc, ids, status, note));
    const targets = ids.filter((id) => canHaveDevStatus(doc, doc.nodes[id]));
    const names = targets.map((id) => doc.nodes[id]?.name ?? "Design");
    if (status && names.length) {
        editor.notify(`${names.length === 1 ? `"${names[0]}"` : `${names.length} designs`} marked ${DEV_STATUS_LABELS[status].toLowerCase()}.`);
        // Changed designs read as changed on their own; only ready and completed are announced.
        if (status !== "changed") notifyDevStatus(targets, names, status, note);
    }
}

// The selected frames and sections that can take a status.
export function devStatusTargets(doc: NagmaDocument, selection: string[]): SceneNode[] {
    return selection.map((id) => doc.nodes[id]).filter((node): node is SceneNode => canHaveDevStatus(doc, node));
}
