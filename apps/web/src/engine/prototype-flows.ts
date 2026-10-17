import { collab, shareLink } from "./collab";
import { layerRoots } from "./page";
import { editor } from "./store";
import { actionsOf, resolveDestination, screens, subtree, walkActions } from "./prototype";
import type { NagmaDocument, SceneNode } from "./types";

// Flows: named starting points on top-level frames, and the frames a flow reaches.

export function flowsOf(doc: NagmaDocument): SceneNode[] {
    return screens(doc).filter((s) => s.flowStart);
}

export function flowLabel(doc: NagmaDocument, flow: SceneNode): string {
    return flow.flowName ?? `Flow ${flowsOf(doc).indexOf(flow) + 1}`;
}

// Screens a screen leads to through its layers' interactions, in the order they appear.
export function linksFrom(doc: NagmaDocument, screenId: string): string[] {
    const out: string[] = [];
    for (const node of subtree(doc, screenId)) {
        for (const it of node.interactions ?? []) {
            walkActions(actionsOf(it), (a) => {
                if (a.type !== "navigate" && a.type !== "overlay" && a.type !== "swap") return;
                const to = resolveDestination(doc, a.target);
                if (to && to !== screenId && !out.includes(to)) out.push(to);
            });
        }
    }
    return out;
}

// Every screen reachable from a start, breadth first.
export function reachable(doc: NagmaDocument, startId: string): string[] {
    const seen = [startId];
    for (let i = 0; i < seen.length; i++) for (const next of linksFrom(doc, seen[i] ?? "")) if (!seen.includes(next)) seen.push(next);
    return seen.filter((id) => doc.nodes[id]);
}

// Top-level frames in reading order: rows from the top, left to right within a row.
export function canvasOrder(doc: NagmaDocument): string[] {
    const all = screens(doc).filter((s) => !s.isSection && s.type !== "componentSet");
    const sorted = [...all].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: SceneNode[][] = [];
    for (const s of sorted) {
        const row = rows.find((r) => {
            const first = r[0];
            return first && s.y < first.y + first.h / 2;
        });
        if (row) row.push(s);
        else rows.push([s]);
    }
    return rows.flatMap((r) => r.sort((a, b) => a.x - b.x).map((s) => s.id));
}

// The flow a screen belongs to: its own starting point, or the first flow that reaches it.
export function flowFor(doc: NagmaDocument, screenId: string): SceneNode | null {
    const flows = flowsOf(doc);
    return flows.find((f) => f.id === screenId) ?? flows.find((f) => reachable(doc, f.id).includes(screenId)) ?? null;
}

// The frames the player steps through with next and previous: the flow's frames, or every frame in
// canvas order when the flow has no connections.
export function frameList(doc: NagmaDocument, flowId: string | null): string[] {
    if (flowId && doc.nodes[flowId]) {
        const list = reachable(doc, flowId);
        if (list.length > 1) return list;
    }
    return canvasOrder(doc);
}

// Whether a screen is part of any flow already.
export function inAnyFlow(doc: NagmaDocument, screenId: string): boolean {
    return flowsOf(doc).some((f) => reachable(doc, f.id).includes(screenId));
}

// A free "Flow N" name.
export function nextFlowName(doc: NagmaDocument): string {
    const names = new Set(flowsOf(doc).map((f) => flowLabel(doc, f)));
    let n = flowsOf(doc).length + 1;
    while (names.has(`Flow ${n}`)) n++;
    return `Flow ${n}`;
}

// A link that opens the file presenting a flow.
export function flowLink(base: string, flowId: string, hideUi = false): string {
    const url = new URL(base);
    url.searchParams.set("present", flowId);
    if (hideUi) url.searchParams.set("hide-ui", "1");
    else url.searchParams.delete("hide-ui");
    return url.toString();
}

export function topLevelIds(doc: NagmaDocument): string[] {
    return layerRoots(doc);
}

// Copies a link that opens the file presenting a flow (a view link when the file is shared).
// `hideUi`: the link opens the player without its toolbar, footer and sidebar.
export function copyFlowLink(flowId: string, hideUi = false) {
    const base = collab.get().fileId ? shareLink("view") : location.href;
    const link = flowLink(base, flowId, hideUi);
    const done = () => editor.notify("Link to flow copied");
    if (navigator.clipboard) void navigator.clipboard.writeText(link).then(done, () => editor.notify("Couldn't copy the link"));
}

