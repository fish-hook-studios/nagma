import { useRef } from "react";
import { applyCommand } from "../engine/commands";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, NodePatch, SceneNode } from "../engine/types";

// Helpers the Design panel's sections share: a value common to every selected layer, writing a
// patch to all of them, and binding a number field (typed edits, relative edits, scrubbing).

export function shared<T>(nodes: SceneNode[], pick: (node: SceneNode) => T): T | null {
    const first = nodes[0];
    if (!first) return null;
    const value = pick(first);
    return nodes.every((node) => pick(node) === value) ? value : null;
}

export function updateAll(nodes: SceneNode[], patch: (node: SceneNode) => NodePatch) {
    editor.execute({ type: "batch", commands: nodes.map((node) => ({ type: "node.update" as const, id: node.id, patch: patch(node) })) });
}

export function useNumberField(nodes: SceneNode[], read: (node: SceneNode) => number, write: (doc: NagmaDocument, node: SceneNode, value: number) => Command[]) {
    const base = useRef<NagmaDocument | null>(null);
    const ids = nodes.map((node) => node.id);
    const build = (doc: NagmaDocument, value: number | ((current: number) => number)): Command => ({
        type: "batch",
        commands: ids.flatMap((id) => {
            const node = doc.nodes[id];
            return node ? write(doc, node, typeof value === "function" ? value(read(node)) : value) : [];
        }),
    });
    return {
        value: shared(nodes, (node) => Math.round(read(node) * 100) / 100),
        onCommit: (value: number) => editor.execute(build(editor.get().doc, value)),
        // "+10" on a Mixed field moves each layer's own value.
        onRelative: (apply: (current: number) => number) => editor.execute(build(editor.get().doc, apply)),
        onScrub: (value: number) => {
            base.current ??= editor.get().doc;
            editor.preview(applyCommand(base.current, build(base.current, value)));
        },
        onScrubEnd: (value: number) => {
            const start = base.current ?? editor.get().doc;
            base.current = null;
            editor.execute(build(start, value), start);
        },
    };
}
