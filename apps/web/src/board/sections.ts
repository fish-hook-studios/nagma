import { editor } from "../engine/store";
import type { Command } from "../engine/types";

// Sections on a board: hiding a section's contents (for everyone, until shown again) keeps the
// section and its title on the board and remembers which of its objects were showing.

export function sectionHidden(id: string): boolean {
    const node = editor.get().doc.nodes[id];
    return node?.jam?.kind === "section" && Boolean(node.jam.hidden);
}

// "Lock background only": the section stays put (it can't be picked up from its background) while
// what's in it can still be moved and edited.
export function setSectionLockBg(id: string, on: boolean) {
    const node = editor.get().doc.nodes[id];
    if (!node?.isSection) return;
    const jam = node.jam?.kind === "section" ? node.jam : { kind: "section" as const };
    editor.execute({ type: "node.update", id, patch: { jam: { ...jam, lockBg: on || undefined } } });
    if (on) editor.set({ selection: [] });
}

export function toggleSectionHidden(id: string) {
    const doc = editor.get().doc;
    const node = doc.nodes[id];
    if (!node?.isSection) return;
    const jam = node.jam?.kind === "section" ? node.jam : { kind: "section" as const };
    const commands: Command[] = [];
    if (jam.hidden) {
        const shown = new Set(jam.shown ?? node.children);
        for (const child of node.children) if (shown.has(child)) commands.push({ type: "node.update", id: child, patch: { visible: true } });
        commands.push({ type: "node.update", id, patch: { jam: { ...jam, hidden: false, shown: undefined } } });
    } else {
        const shown = node.children.filter((c) => doc.nodes[c]?.visible !== false);
        for (const child of shown) commands.push({ type: "node.update", id: child, patch: { visible: false } });
        commands.push({ type: "node.update", id, patch: { jam: { ...jam, hidden: true, shown } } });
    }
    editor.execute({ type: "batch", commands });
    // Selected objects inside a hidden section drop out of the selection.
    if (!jam.hidden) editor.set({ selection: editor.get().selection.filter((s) => !node.children.includes(s)) });
}
