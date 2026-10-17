import { editor } from "../engine/store";
import { layoutText } from "../engine/text-layout";
import type { Command, SceneNode } from "../engine/types";

// Auto-fit text: a text layer with a fixed box and auto-fit on keeps the largest size (up to the
// size it was set to) at which its text fits the box, the way presentation tools shrink text that
// overflows. Sizes are worked out a moment after an edit and applied without an undo step.

// The largest font size, at most `max`, at which the layer's text fits its height.
export function fittedSize(node: SceneNode, max: number): number {
    const at = (size: number) => {
        const k = size / Math.max(1, node.fontSize ?? size);
        const trial: SceneNode = { ...node, fontSize: size, spans: node.spans?.map((s) => (s.fontSize ? { ...s, fontSize: s.fontSize * k } : s)) };
        return layoutText(trial).height <= node.h + 0.5;
    };
    if (at(max)) return max;
    let lo = 6;
    let hi = max;
    for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid)) lo = mid;
        else hi = mid;
    }
    return Math.floor(lo);
}

export function fitCommand(node: SceneNode): Command | null {
    const data = node.deck;
    if (node.type !== "text" || data?.kind !== "text" || !data.fit) return null;
    const size = fittedSize(node, data.fit);
    if (Math.abs(size - (node.fontSize ?? size)) < 0.5) return null;
    const k = size / Math.max(1, node.fontSize ?? size);
    return { type: "node.update", id: node.id, patch: { fontSize: size, spans: node.spans?.map((s) => (s.fontSize ? { ...s, fontSize: Math.round(s.fontSize * k) } : s)) } };
}

// The texts waiting add up, so a second edit within the wait doesn't drop the first one's fit.
let pending = 0;
const waiting = new Set<string>();
editor.onCommit((before, after) => {
    if (!after.slides) return;
    let any = false;
    for (const node of Object.values(after.nodes)) {
        if (node.type !== "text" || node.deck?.kind !== "text" || !node.deck.fit) continue;
        if (before.nodes[node.id] !== node) {
            waiting.add(node.id);
            any = true;
        }
    }
    if (!any) return;
    window.clearTimeout(pending);
    const run = () => {
        const s = editor.get();
        if (s.readOnly) return;
        if (s.editingTextId) {
            pending = window.setTimeout(run, 400);
            return;
        }
        const commands = [...waiting].map((id) => s.doc.nodes[id]).flatMap((n) => (n ? [fitCommand(n)].filter((c): c is Command => Boolean(c)) : []));
        waiting.clear();
        if (commands.length) editor.executeSilently({ type: "batch", commands });
    };
    pending = window.setTimeout(run, 250);
});
