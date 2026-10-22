import { viewCenter } from "./actions";
import { LIVE_STARTERS, makeLiveNode } from "./live";
import { editor } from "./store";

// Insert › Live frame: a starter placed in the middle of the view, selected, ready for its props.
export function insertLiveFrame(starterId: string) {
    const starter = LIVE_STARTERS.find((s) => s.id === starterId) ?? LIVE_STARTERS[0];
    const s = editor.get();
    if (!starter || s.readOnly) return;
    const c = viewCenter();
    const node = makeLiveNode(s.doc, starter, { x: c.x - starter.w / 2, y: c.y - starter.h / 2 }, s.pageId);
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id], tool: "move", rightTab: "design" });
}
