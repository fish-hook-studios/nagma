import { useEffect, useRef, useState } from "react";
import { FRAME_LABEL_SIZE, frameLabelRect } from "../canvas/hit-test";
import { editor, useEditor } from "../engine/store";
import { ui, useUi } from "../engine/ui-state";

// Renaming a frame or section in place: double-click its name on the canvas and type. Return or
// clicking away keeps the name, Esc leaves it as it was.
export function LabelRename() {
    const id = useUi((s) => s.labelRename);
    const node = useEditor((s) => (id ? s.doc.nodes[id] : undefined));
    const camera = useEditor((s) => s.camera);
    const doc = useEditor((s) => s.doc);
    const [value, setValue] = useState("");
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!node) return;
        setValue(node.name);
        requestAnimationFrame(() => input.current?.select());
        // Only when another layer's name opens.
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!id || !node) return null;
    const rect = frameLabelRect(doc, node, camera);
    const done = (keep: boolean) => {
        const name = value.trim();
        if (keep && name && name !== node.name) editor.execute({ type: "node.update", id: node.id, patch: { name } });
        ui.set({ labelRename: null });
    };
    return (
        <input
            ref={input}
            aria-label="Layer name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") done(true);
                else if (e.key === "Escape") done(false);
            }}
            onBlur={() => done(true)}
            onPointerDown={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute rounded-sm border border-brand-500 bg-canvas px-0.5 text-ink outline-none"
            style={{ left: rect.x - 3, top: rect.y - 2, width: Math.max(rect.w + 40, 80), height: rect.h + 4, fontSize: FRAME_LABEL_SIZE, fontWeight: 500 }}
        />
    );
}
