import type { Command, NagmaDocument, SceneNode } from "../engine/types";
import { postEditFixes } from "./connectors";
import { stickyHeightFor } from "./paint";

// Stickies grow taller as their text outgrows them, and shrink back to their own size (never
// smaller) as text is removed. The size they had before growing is kept on the note.

function textChanged(a: SceneNode | undefined, b: SceneNode): boolean {
    return !a || a.text !== b.text || a.fontSize !== b.fontSize || a.fontFamily !== b.fontFamily || a.fontWeight !== b.fontWeight || a.w !== b.w || a.list !== b.list;
}

export function stickyGrowth(before: NagmaDocument, after: NagmaDocument): Command[] {
    const commands: Command[] = [];
    for (const node of Object.values(after.nodes)) {
        const jam = node.jam;
        if (jam?.kind !== "sticky" || !textChanged(before.nodes[node.id], node)) continue;
        const base = jam.baseH ?? node.h;
        const needed = Math.max(base, Math.ceil(stickyHeightFor(node)));
        if (Math.abs(needed - node.h) < 0.5) continue;
        commands.push({ type: "node.update", id: node.id, patch: { h: needed, jam: { ...jam, baseH: needed > base ? base : undefined } } });
    }
    return commands;
}

postEditFixes.push(stickyGrowth);
