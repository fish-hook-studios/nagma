import { editor, useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";
import { useVectorUi, vectorUi } from "../engine/vector-ui";
import { widthPointsOf } from "../engine/width-profile";
import { NumberField } from "./number-field";

// Point editing with the Variable width tool: the selected width point's width (in pixels, like
// the stroke weight) and where it sits along the path.
export function WidthPointField({ node }: { node: SceneNode }) {
    const tool = useEditor((s) => s.vectorTool);
    const index = useVectorUi((s) => s.widthPoint);
    if (tool !== "width") return null;
    const points = widthPointsOf(node) ?? [];
    const point = index !== null ? points[index] : undefined;
    const write = (next: { t: number; w: number }) => {
        const all = points.map((p, i) => (i === index ? next : p));
        const sorted = [...all].sort((a, b) => a.t - b.t);
        editor.execute({ type: "node.update", id: node.id, patch: { widthPoints: sorted, strokeProfile: null } });
        vectorUi.set({ widthPoint: sorted.indexOf(next) });
    };
    return (
        <div className="mt-2 space-y-1.5">
            {point ? (
                <div className="grid grid-cols-2 gap-2">
                    <NumberField label="W" title="Width" min={0} value={Math.round(point.w * node.strokeWidth * 100) / 100} onCommit={(v) => write({ ...point, w: node.strokeWidth > 0 ? v / node.strokeWidth : 1 })} />
                    <NumberField label="%" title="Position along the path" min={0} max={100} value={Math.round(point.t * 1000) / 10} onCommit={(v) => write({ ...point, t: v / 100 })} />
                </div>
            ) : null}
            <p className="text-ink-subtle">
                {point ? "Drag the handles to change the width, or the point to move it. Delete removes it." : "Click the stroke to add a width point, then drag out to set its width."}
            </p>
        </div>
    );
}
