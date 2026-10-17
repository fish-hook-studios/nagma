import { editor } from "../engine/store";
import type { SceneNode } from "../engine/types";

// A component's description (the reference shows it in the component's panel; Inspect's component info reads it).
export function ComponentDescription({ node }: { node: SceneNode }) {
    return (
        <textarea
            key={`${node.id}-${node.description ?? ""}`}
            defaultValue={node.description ?? ""}
            rows={2}
            placeholder="Add a description"
            aria-label="Component description"
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== (node.description ?? "")) editor.execute({ type: "node.update", id: node.id, patch: { description: next || undefined } });
            }}
            className="mt-1 w-full resize-none rounded-md border border-transparent bg-field px-1.5 py-1 text-[11px] text-ink outline-none hover:border-panel-border focus:border-brand-500"
        />
    );
}
