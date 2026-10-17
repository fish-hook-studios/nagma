import { groupSelection } from "./actions";
import { DEFAULT_REPEAT, bakeRepeat } from "./repeat";
import { editor } from "./store";
import type { Command, RepeatTransform } from "./types";

// The Transforms section's actions: add a linear or radial repeat to the selection (wrapping it in
// a transform group), change its settings, apply it (keep the copies as layers) or remove it.

export function addTransform(kind: RepeatTransform["kind"]) {
    let { doc, selection } = editor.get();
    if (!selection.length) return;
    const only = selection.length === 1 ? doc.nodes[selection[0] ?? ""] : undefined;
    // Grouping first is its own step; folded into the repeat below so one undo takes both back.
    const grouped = !(only?.type === "group" && !only.repeat);
    if (grouped) {
        const before = editor.get().past.length;
        groupSelection();
        if (editor.get().past.length === before) return;
        ({ doc, selection } = editor.get());
    }
    const group = doc.nodes[selection[0] ?? ""];
    if (!group || group.type !== "group") return;
    editor.execute({ type: "node.update", id: group.id, patch: { repeat: { ...DEFAULT_REPEAT[kind] }, name: group.name.startsWith("Group") ? `${kind === "radial" ? "Radial" : "Linear"} repeat` : group.name } });
    // Only fold in the grouping made here: a group that was already there has no step of its own,
    // and merging would take the previous, unrelated edit back with this one.
    if (grouped) editor.mergeLast();
}

export function updateTransform(groupId: string, patch: Partial<RepeatTransform>) {
    const group = editor.get().doc.nodes[groupId];
    if (!group?.repeat) return;
    editor.execute({ type: "node.update", id: groupId, patch: { repeat: { ...group.repeat, ...patch } } });
}

export function applyTransforms(groupIds: string[]) {
    const { doc } = editor.get();
    const commands: Command[] = [];
    for (const id of groupIds) for (const [nodeId, patch] of Object.entries(bakeRepeat(doc, id))) commands.push({ type: "node.update", id: nodeId, patch });
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function removeTransform(groupId: string) {
    const { doc } = editor.get();
    const group = doc.nodes[groupId];
    if (!group?.repeat) return;
    const copies = group.children.filter((id) => doc.nodes[id]?.repeatOf);
    editor.execute({
        type: "batch",
        commands: [{ type: "node.update", id: groupId, patch: { repeat: null } }, ...(copies.length ? [{ type: "node.delete" as const, ids: copies }] : [])],
    });
}
