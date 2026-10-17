import { useRef } from "react";
import { applyCommand } from "../engine/commands";
import { editor } from "../engine/store";
import type { Command, NagmaDocument, NodePatch, SceneNode } from "../engine/types";
import { parametricPath } from "../engine/vector";
import { NumberField } from "./number-field";

// Polygon and star properties in the Appearance section: corner radius, point count and (stars)
// the inner ratio. Typed values commit; scrubbing previews and commits once.

function sharedValue(nodes: SceneNode[], pick: (n: SceneNode) => number): number | null {
    const first = nodes[0];
    if (!first) return null;
    const v = pick(first);
    return nodes.every((n) => Math.abs(pick(n) - v) < 1e-9) ? v : null;
}

function useParamField(nodes: SceneNode[], read: (n: SceneNode) => number, write: (n: SceneNode, v: number) => NodePatch) {
    const base = useRef<NagmaDocument | null>(null);
    const command = (doc: NagmaDocument, v: number): Command => ({
        type: "batch",
        commands: nodes.flatMap((stale) => {
            const node = doc.nodes[stale.id];
            if (!node) return [];
            const patch = write(node, v);
            return [{ type: "node.update" as const, id: node.id, patch: { ...patch, path: parametricPath({ ...node, ...patch } as SceneNode) } }];
        }),
    });
    return {
        value: sharedValue(nodes, read),
        onCommit: (v: number) => editor.execute(command(editor.get().doc, v)),
        onScrub: (v: number) => {
            base.current ??= editor.get().doc;
            editor.preview(applyCommand(base.current, command(base.current, v)));
        },
        onScrubEnd: (v: number) => {
            const b = base.current ?? editor.get().doc;
            base.current = null;
            editor.execute(command(b, v), b);
        },
    };
}

export function ShapeParams({ nodes }: { nodes: SceneNode[] }) {
    const stars = nodes.every((n) => n.parametric?.kind === "star");
    const radius = useParamField(nodes, (n) => n.radius, (_n, v) => ({ radius: v }));
    const count = useParamField(nodes, (n) => n.parametric?.count ?? 3, (n, v) => ({ parametric: { ...(n.parametric ?? { kind: "polygon", ratio: 0.382 }), count: Math.round(v) } }));
    const ratio = useParamField(nodes, (n) => Math.round((n.parametric?.ratio ?? 0.382) * 1000) / 10, (n, v) => ({ parametric: { ...(n.parametric ?? { kind: "star", count: 5 }), ratio: v / 100 } }));
    return (
        <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="◜" title="Corner radius" min={0} {...radius} />
            <NumberField label="#" title="Count" min={3} max={60} {...count} />
            {stars && <NumberField label="✳" title="Ratio" suffix="%" min={1} max={100} step={0.1} {...ratio} />}
        </div>
    );
}
