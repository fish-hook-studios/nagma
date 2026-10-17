// The Frame tool's helpers: preset frames from the right sidebar's list, and the quick-add "+"
// beside a frame that makes a neighbour of the same size.
import { nextCopyName, viewCenter } from "./actions";
import { isFrameLike } from "./components";
import { cloneSubtree, makeNode, selectionBounds } from "./nodes";
import { activePage, isTopLevel } from "./page";
import { type FramePreset, rememberFrameSize } from "./presets";
import { editor } from "./store";
import { worldBounds } from "./transform";
import type { Command, NagmaDocument, SceneNode } from "./types";

const GAP = 40;

// Top-level frames on the current page, in layer order.
function topFrames(doc: NagmaDocument): SceneNode[] {
    const page = doc.nodes[activePage.id];
    return (page?.children ?? doc.roots).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n) && isFrameLike(n) && !n.isSection);
}

// A preset frame lands to the right of the last top-level frame on the page, or at the view's
// centre on an empty page, and takes the preset's name.
export function createPresetFrame(preset: FramePreset) {
    const s = editor.get();
    if (s.readOnly) return;
    const frames = topFrames(s.doc);
    const last = frames[frames.length - 1];
    let x: number;
    let y: number;
    if (last) {
        const box = worldBounds(s.doc, last);
        x = Math.round(box.x + box.w + GAP);
        y = Math.round(box.y);
    } else {
        const c = viewCenter();
        x = Math.round(c.x - preset.w / 2);
        y = Math.round(c.y - preset.h / 2);
    }
    const frame = makeNode(s.doc, "frame", { x, y, w: preset.w, h: preset.h }, activePage.id, { name: preset.name });
    editor.execute({ type: "node.create", node: frame });
    rememberFrameSize(preset.w, preset.h, preset.name);
    editor.set({ selection: [frame.id], ...(s.prefs.keepTool ? {} : { tool: "move" as const }) });
}

// The frame the quick-add "+" belongs to: the hovered or selected top-level frame while the Frame
// tool is active.
export function quickAddTarget(s = editor.get()): SceneNode | null {
    if (s.tool !== "frame" || s.readOnly || s.editingTextId) return null;
    const id = s.hoverId ?? (s.selection.length === 1 ? s.selection[0] : null);
    const node = id ? s.doc.nodes[id] : undefined;
    if (!node || !isFrameLike(node) || node.isSection || node.isSlice || !isTopLevel(s.doc, node)) return null;
    return node;
}

// "+" on either side of a frame: a copy of the frame and its contents beside it (⌥ for a blank frame
// of the same size). Frames further along that side move to make room. One undo step.
export function quickAddFrame(id: string, duplicate = true, side: "left" | "right" = "right") {
    const s = editor.get();
    const source = s.doc.nodes[id];
    if (!source || s.readOnly) return;
    const box = worldBounds(s.doc, source);
    const shift = (box.w + GAP) * (side === "left" ? -1 : 1);
    const commands: Command[] = [];
    // Neighbours that overlap the new frame's row and sit on that side slide over.
    for (const frame of topFrames(s.doc)) {
        if (frame.id === id) continue;
        const b = worldBounds(s.doc, frame);
        const sameRow = b.y < box.y + box.h && b.y + b.h > box.y;
        if (sameRow && (side === "right" ? b.x >= box.x + box.w : b.x + b.w <= box.x)) commands.push({ type: "node.move", ids: [frame.id], dx: shift, dy: 0 });
    }
    const siblings = source.parentId ? (s.doc.nodes[source.parentId]?.children ?? []) : s.doc.roots;
    const index = siblings.indexOf(id) + 1;
    let created: string;
    if (duplicate) {
        const copies = cloneSubtree(s.doc, id, 0, source.parentId);
        const root = copies[0];
        if (!root) return;
        created = root.id;
        // "Rename duplicated layers": the copy beside its original takes the next number, as ⌘D does.
        if (s.prefs.renameDuplicates) root.name = nextCopyName(s.doc, root.name, source.parentId);
        // Layers keep page coordinates, so the whole copy moves over, contents too.
        copies.forEach((node, i) => commands.push({ type: "node.create", node: { ...node, x: node.x + shift, children: [] }, ...(i === 0 ? { index } : {}) }));
    } else {
        const frame = makeNode(s.doc, "frame", { x: source.x + shift, y: source.y, w: source.w, h: source.h }, source.parentId, { rotation: source.rotation });
        created = frame.id;
        commands.push({ type: "node.create", node: frame, index });
    }
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [created] });
}

// The quick-add buttons' places: just past the frame's left and right edges, level with its top.
export function quickAddAnchor(doc: NagmaDocument, node: SceneNode): { x: number; left: number; y: number; h: number } | null {
    const box = selectionBounds(doc, [node.id]);
    if (!box) return null;
    return { x: box.x + box.w, left: box.x, y: box.y, h: box.h };
}
