import { worldToScreen } from "../engine/camera";
import { editor, useEditor } from "../engine/store";
import { worldBounds } from "../engine/transform";
import { board, useBoard } from "./state";

// Renaming a section in place: a field over its title pill. Return or clicking away keeps the
// name, Esc leaves it; an empty name removes the title.

export function SectionTitleEditor() {
    const id = useBoard((s) => s.renamingSection);
    const node = useEditor((s) => (id ? s.doc.nodes[id] : undefined));
    const camera = useEditor((s) => s.camera);
    const doc = useEditor((s) => s.doc);
    if (!id || !node?.isSection) return null;
    const box = worldBounds(doc, node);
    const at = worldToScreen(camera, box.x, box.y);
    const done = (name: string | null) => {
        board.set({ renamingSection: null });
        if (name !== null && name.trim() !== node.name) editor.execute({ type: "node.update", id: node.id, patch: { name: name.trim() } });
    };
    return (
        <input
            autoFocus
            aria-label="Section name"
            defaultValue={node.name}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => done(e.currentTarget.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") done(null);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 h-[22px] rounded-md border-2 border-[#0D99FF] bg-white px-1.5 text-[12px] font-semibold text-[#1E1E1E] outline-none"
            style={{ left: at.x + 4, top: at.y + 2, width: Math.max(120, Math.min(320, box.w * camera.zoom - 8)) }}
        />
    );
}
