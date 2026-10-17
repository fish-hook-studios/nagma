// Editing actions shared by keyboard shortcuts, the context menu and the panels.
import { flipGroup } from "./group-transform";
// Each one reads the current selection and commits a single undoable command.
import { refuseExport } from "./share-settings";
import { fitRect, screenToWorld, viewport, zoomToSelection } from "./camera";
import { applyCommand } from "./commands";
import { askConfirm } from "../components/ask-text";
import { cloneSubtree, frameAt, makeNode, nextName, selectionBounds, topLevel } from "./nodes";
import { textSize } from "./text";
import { assetName, findVariant, isFrameLike, setProperties, variantName, variantProps, wouldNestItself } from "./components";
import { activePage, layerRoots, pageOf } from "./page";
import { legacy } from "./legacy-names";
import { editor } from "./store";
import { apply, applyVector, normalizeAngle, spaceMatrix, worldMatrix, corners } from "./transform";
import type { BooleanOp, Command, NagmaDocument, Rect, SceneNode, Subpath } from "./types";
import { fitPath, placedSubpaths, samplePath, shapeSubpaths } from "./vector";
import { solid } from "./paint";
import { flattenText } from "./text-flatten";
import { flattenSelection as flattenAny } from "./flatten";
import { loadTextOutlines } from "./font-outlines";
import { registerBrushCommands } from "./custom-brushes";

const CLIPBOARD_MARKER = "nagma/layers:";

// Layers copied with ⌘C, kept with the document they came from so pasting works after edits.
// The layers copied here, and the file they came from (main components pasted into another file
// remember where they moved from).
let clipboard: { doc: NagmaDocument; ids: string[]; fromFile?: string | null } | null = null;

export function siblingsOf(doc: NagmaDocument, node: SceneNode): string[] {
    return node.parentId ? (doc.nodes[node.parentId]?.children ?? []) : doc.roots;
}

function angleOf(m: DOMMatrix): number {
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

// Moves a layer to a new parent without moving it on screen.
export function rehome(doc: NagmaDocument, id: string, parentId: string | null, index?: number): Command[] {
    const node = doc.nodes[id];
    if (!node) return [];
    const reparent: Command = { type: "node.reparent", id, parentId, index };
    if (node.parentId === parentId) return [reparent];
    const pts = corners(doc, node);
    const center = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
    const at = apply(spaceMatrix(doc, parentId).inverse(), center.x, center.y);
    const rotation = normalizeAngle(angleOf(worldMatrix(doc, node)) - angleOf(spaceMatrix(doc, parentId)));
    return [reparent, { type: "node.update", id, patch: { x: at.x - node.w / 2, y: at.y - node.h / 2, rotation } }];
}

function selected(): { doc: NagmaDocument; ids: string[] } {
    const { doc, selection } = editor.get();
    // Pages are never acted on as layers (deleting one here would empty it with no confirmation).
    return { doc, ids: topLevel(doc, selection).filter((id) => doc.nodes[id]?.type !== "page") };
}

// Selection in back-to-front order, so grouping and moving keep the stacking.
function inStackOrder(doc: NagmaDocument, ids: string[]): string[] {
    const order = new Map<string, number>();
    let i = 0;
    const visit = (list: string[]) => {
        for (const id of list) {
            order.set(id, i++);
            visit(doc.nodes[id]?.children ?? []);
        }
    };
    visit(doc.roots);
    return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

// Whether the last copy reached the system clipboard. When it didn't, the system clipboard holds
// something older than the layers copied here, so ⌘V prefers the in-app clipboard.
let mirrored = false;

export function clipboardMirrored(): boolean {
    return mirrored;
}

export function copySelection() {
    const { doc, ids } = selected();
    if (!ids.length || refuseExport()) return;
    clipboard = { doc, ids, fromFile: editor.get().fileId };
    mirrored = false;
    // Mirror to the system clipboard so another Nagma tab can paste; ignore if the browser refuses.
    try {
        const payload = JSON.stringify({ nodes: ids.flatMap((id) => cloneSubtree(doc, id, 0, null)) });
        void navigator.clipboard
            ?.writeText(CLIPBOARD_MARKER + payload)
            .then(() => (mirrored = true))
            .catch(() => undefined);
    } catch {
        // The in-memory clipboard still works.
    }
}

// Puts layers made elsewhere (Make's preview copied as design layers) on the clipboard, as if they
// had been copied: ⌘V pastes them into any design file, in this tab or another.
export function copyLayers(doc: NagmaDocument, ids: string[]): Promise<boolean> {
    clipboard = { doc, ids, fromFile: null };
    mirrored = false;
    const payload = JSON.stringify({ nodes: ids.flatMap((id) => cloneSubtree(doc, id, 0, null)) });
    return (navigator.clipboard?.writeText(CLIPBOARD_MARKER + payload) ?? Promise.reject(new Error("no clipboard")))
        .then(() => (mirrored = true))
        .catch(() => false);
}

export function cutSelection() {
    copySelection();
    deleteSelection();
}

export function deleteSelection() {
    const { ids } = selected();
    if (!ids.length || blockedInsideInstance(ids, "deleted")) return;
    editor.execute({ type: "node.delete", ids });
    editor.set({ selection: [] });
}

// Copies layers into the document. Top-level frames land to the right of the originals, like a new
// screen; everything else lands exactly in place, or inside the selected frame if one is selected.
export function nextCopyName(doc: NagmaDocument, name: string, parentId: string | null): string {
    const siblings = (parentId ? (doc.nodes[parentId]?.children ?? []) : doc.roots).map((id) => doc.nodes[id]?.name ?? "");
    const m = /^(.*?)(?: (\d+))?$/.exec(name);
    const base = m?.[1] ?? name;
    let n = Number(m?.[2] ?? 1) + 1;
    while (siblings.includes(`${base} ${n}`)) n++;
    return `${base} ${n}`;
}

// Where copies go: `offset` moves every root by a parent-space delta; `fit` centres the copies on
// any axis of the target frame they can't keep their source position on (the reference's paste
// rule for a different container).
interface PlaceOptions {
    offset?: { x: number; y: number };
    rotation?: number;
    fit?: boolean;
    // The file the layers were copied from, when it's another one.
    movedFrom?: string;
}

export function placeCopies(source: NagmaDocument, ids: string[], intoFrame: string | null, inPlace = false, options: PlaceOptions = {}) {
    const { doc } = editor.get();
    const roots = topLevel(source, ids);
    const bounds = selectionBounds(source, roots);
    const allTopFrames = roots.every((id) => {
        const node = source.nodes[id];
        return isFrameLike(node) && (!node?.parentId || !source.nodes[node.parentId] || source.nodes[node.parentId]?.type === "page");
    });
    const dx = allTopFrames && bounds && !intoFrame && !inPlace ? bounds.w + 40 : 0;
    // Layer coordinates are in the page's space, so a position "relative to its container" is
    // measured from the nearest frame around the layer (the page's origin for loose layers).
    const originOf = (id: string) => {
        let parent = source.nodes[source.nodes[id]?.parentId ?? ""];
        while (parent && parent.type !== "page" && !isFrameLike(parent)) parent = source.nodes[parent.parentId ?? ""];
        return parent && parent.type !== "page" ? { x: parent.x, y: parent.y } : { x: 0, y: 0 };
    };
    // The copies' box relative to their container, for keeping that position inside the target
    // frame, or centring inside a frame that can't hold it.
    const local = roots.reduce(
        (acc, id) => {
            const n = source.nodes[id];
            if (!n) return acc;
            const o = originOf(id);
            return { x1: Math.min(acc.x1, n.x - o.x), y1: Math.min(acc.y1, n.y - o.y), x2: Math.max(acc.x2, n.x - o.x + n.w), y2: Math.max(acc.y2, n.y - o.y + n.h) };
        },
        { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity },
    );
    let fitX = 0;
    let fitY = 0;
    const target = intoFrame ? doc.nodes[intoFrame] : undefined;
    const fitting = Boolean(options.fit && target && Number.isFinite(local.x1));
    if (fitting && target) {
        const w = local.x2 - local.x1;
        const h = local.y2 - local.y1;
        if (local.x1 < 0 || local.x2 > target.w) fitX = (target.w - w) / 2 - local.x1;
        if (local.y1 < 0 || local.y2 > target.h) fitY = (target.h - h) / 2 - local.y1;
    }
    const commands: Command[] = [];
    const created: string[] = [];
    for (const id of inStackOrder(source, roots)) {
        const original = source.nodes[id];
        if (!original) continue;
        // Into the selected frame, else back into the original's frame if it's on this page, else onto this page.
        const originalParent = original.parentId ? doc.nodes[original.parentId] : undefined;
        const sameContext = originalParent && originalParent.type !== "page" && pageOf(doc, originalParent) === activePage.id;
        const parentId = intoFrame ?? (sameContext && originalParent ? originalParent.id : activePage.id);
        const copies = cloneSubtree(source, id, 0, parentId);
        const root = copies[0];
        if (!root) continue;
        // A main component arriving from another file keeps a note of where it was.
        if (options.movedFrom && (original.type === "component" || original.type === "componentSet") && !original.libraryId) root.movedFrom = { fileId: options.movedFrom, key: original.movedFrom?.key && original.movedFrom.fileId === options.movedFrom ? original.movedFrom.key : original.id };
        // "Rename duplicated layers": a copy beside its original gets the next number ("Card" →
        // "Card 2"). A copy pasted into another frame keeps its name.
        if (editor.get().prefs.renameDuplicates && parentId === (original.parentId ?? activePage.id)) root.name = nextCopyName(doc, root.name, parentId);
        created.push(root.id);
        // The whole copy moves together (children's coordinates are in the page's space too).
        const o = fitting && target ? originOf(id) : { x: 0, y: 0 };
        const moveX = dx + fitX + (fitting && target ? target.x - o.x : 0) + (options.offset?.x ?? 0);
        const moveY = fitY + (fitting && target ? target.y - o.y : 0) + (options.offset?.y ?? 0);
        for (const node of copies) {
            node.x += moveX;
            node.y += moveY;
        }
        if (options.rotation) root.rotation = normalizeAngle(root.rotation + options.rotation);
        for (const node of copies) commands.push({ type: "node.create", node: { ...node, children: [] } });
    }
    if (!commands.length) return;
    // Strokes drawn with a custom brush bring the brush into this file's brush menu.
    commands.push(...registerBrushCommands(doc, roots.flatMap((id) => cloneSubtree(source, id, 0, null))));
    editor.execute({ type: "batch", commands });
    editor.set({ selection: created });
}

// ⌘D repeats the last move of a duplicate: after ⌥-dragging a copy (or moving a fresh copy), each
// ⌘D makes the next copy the same distance (and turn) further on, laying them out in a line.
// The last duplicate: its copies and the layers they were copied from. ⌘D on those copies repeats
// how far (and how much turned) they now are from their originals, however they got there: a
// canvas drag, the arrow keys or the X / Y fields.
let lastDuplicate: { ids: string[]; sources: string[] } | null = null;

function sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
}

// Kept for the canvas: a move of the last duplicate's copies needs no bookkeeping now (the offset is
// read from the copies' positions when ⌘D is pressed).
export function recordDuplicateMove(ids: string[], dx: number, dy: number, rotation = 0) {
    void ids;
    void dx;
    void dy;
    void rotation;
}

export function isLastDuplicate(ids: string[]): boolean {
    return Boolean(lastDuplicate && sameIds(lastDuplicate.ids, ids));
}

// How far the last duplicate's first copy sits from its original (in its own coordinates), or null
// when the selection isn't that duplicate or its original is gone.
function duplicateOffset(doc: NagmaDocument, ids: string[]): { x: number; y: number; rotation: number } | null {
    if (!lastDuplicate || !sameIds(lastDuplicate.ids, ids)) return null;
    const copyIds = topLevel(doc, lastDuplicate.ids);
    const copy = doc.nodes[copyIds[0] ?? ""];
    const index = lastDuplicate.ids.indexOf(copy?.id ?? "");
    const source = doc.nodes[lastDuplicate.sources[index] ?? ""];
    if (!copy || !source || copy.parentId !== source.parentId) return null;
    const offset = { x: copy.x - source.x, y: copy.y - source.y, rotation: normalizeAngle(copy.rotation - source.rotation) };
    return offset.x || offset.y || offset.rotation ? offset : null;
}

function rememberDuplicate(sources: string[]) {
    const copies = editor.get().selection;
    const roots = topLevel(editor.get().doc, sources);
    // placeCopies creates one copy per top-level layer, in stack order.
    const ordered = inStackOrder(editor.get().doc, roots);
    lastDuplicate = copies.length === ordered.length ? { ids: copies, sources: ordered } : null;
}

// ⌘D: a copy in place, on top of the original. After the copy is moved (or turned), the next ⌘D
// repeats that offset from the copy, laying the copies out in a line.
export function duplicateSelection() {
    const { doc, ids } = selected();
    if (blockedInsideInstance(ids, "duplicated")) return;
    if (!ids.length) return;
    const repeat = duplicateOffset(doc, ids);
    placeCopies(doc, ids, null, true, repeat ? { offset: { x: repeat.x, y: repeat.y }, rotation: repeat.rotation } : {});
    rememberDuplicate(ids);
}

// Pastes layers copied in another Nagma tab (read from the system clipboard text).
export function pasteFromText(text: string): boolean {
    // Layers copied before the rename carry the old marker.
    const marker = [CLIPBOARD_MARKER, legacy.layersMarker].find((m) => text.startsWith(m));
    if (!marker) return false;
    try {
        const payload = JSON.parse(text.slice(marker.length)) as { nodes: SceneNode[] };
        const nodes: NagmaDocument["nodes"] = {};
        for (const node of payload.nodes) nodes[node.id] = node;
        const ids = payload.nodes.filter((node) => node.parentId === null || !nodes[node.parentId]).map((node) => node.id);
        const source: NagmaDocument = { name: "", nodes, roots: ids, images: editor.get().doc.images };
        clipboard = { doc: source, ids };
        paste();
        return true;
    } catch {
        return false;
    }
}

// Whether a world-space box shows in the viewport.
function inView(box: Rect): boolean {
    const { camera } = editor.get();
    const tl = screenToWorld(camera, 0, 0);
    const br = screenToWorld(camera, viewport.width, viewport.height);
    return box.x < br.x && box.x + box.w > tl.x && box.y < br.y && box.y + box.h > tl.y;
}

// Moves the pasted layers to the middle of the view when they would land off screen.
function bringIntoView(ids: string[]) {
    const { doc } = editor.get();
    const box = selectionBounds(doc, ids);
    if (!box || inView(box)) return;
    const c = viewCenter();
    editor.execute({ type: "batch", commands: ids.flatMap((id) => moveInParent(doc, id, c.x - box.w / 2 - box.x, c.y - box.h / 2 - box.y)) });
}

function moveInParent(doc: NagmaDocument, id: string, dx: number, dy: number): Command[] {
    const node = doc.nodes[id];
    if (!node) return [];
    const d = applyVector(spaceMatrix(doc, node.parentId).inverse(), dx, dy);
    return [{ type: "node.move", ids: [id], dx: d.x, dy: d.y }];
}

function pasteTargets(): SceneNode[] {
    const { doc, selection } = editor.get();
    const source = clipboard;
    return selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n) && (n.type === "frame" || n.type === "component") && !n.isSlice && !source?.ids.includes(n.id));
}

// ⌘V. Into a selected frame the copies keep their position relative to their source container,
// centred on any axis the frame can't match; with several frames selected each gets a copy; with
// nothing selected the copies go back where they came from, or to the middle of the view when that
// is off screen.
// Folds every history step since `mark` into one, so a paste made of several edits (and the
// selection changes between them) is undone in one go.
function foldSince(mark: number) {
    while (editor.get().past.length > mark + 1) editor.mergeLast();
}

export function paste() {
    if (!clipboard) return;
    const source = clipboard;
    const { selection } = editor.get();
    const targets = pasteTargets();
    const mark = editor.get().past.length;
    if (targets.length >= 2 && targets.length === selection.length) {
        const created: string[] = [];
        targets.forEach((target) => {
            placeCopies(source.doc, source.ids, target.id, false, { fit: true });
            created.push(...editor.get().selection);
        });
        editor.set({ selection: created });
        foldSince(mark);
        return;
    }
    const into = targets.length === 1 ? targets[0] : undefined;
    placeCopies(source.doc, source.ids, into?.id ?? null, false, { fit: Boolean(into), movedFrom: movedFrom(source) });
    bringIntoView(editor.get().selection);
    foldSince(mark);
    // Something bigger than the view: zoom out until it fits.
    const pasted = selectionBounds(editor.get().doc, editor.get().selection);
    const zoom = editor.get().camera.zoom;
    if (pasted && (pasted.w * zoom > viewport.width * 0.9 || pasted.h * zoom > viewport.height * 0.9)) fitRect(pasted, 80, zoom);
}

// "Paste here": the copies' top-left lands at the pointer, inside the frame under it (beside an
// auto layout frame rather than inside it, as the reference does).
export function pasteAt(world: { x: number; y: number }) {
    if (!clipboard) return;
    const source = clipboard;
    const { doc } = editor.get();
    const roots = topLevel(source.doc, source.ids);
    const box = selectionBounds(source.doc, roots);
    if (!box) return;
    let parentId = frameAt(doc, world.x, world.y, new Set(source.ids));
    while (parentId && doc.nodes[parentId]?.layout) parentId = doc.nodes[parentId]?.parentId ?? activePage.id;
    const parent = doc.nodes[parentId];
    const into = parent && parent.type !== "page" ? parent.id : null;
    const mark = editor.get().past.length;
    placeCopies(source.doc, source.ids, into, true, { movedFrom: movedFrom(source) });
    const created = editor.get().selection;
    const placed = selectionBounds(editor.get().doc, created);
    if (!placed) return;
    editor.execute({ type: "batch", commands: created.flatMap((id) => moveInParent(editor.get().doc, id, world.x - placed.x, world.y - placed.y)) });
    foldSince(mark);
}

// ⇧⌘V: the copies land exactly where the originals were (no new-screen offset), inside the selection's frame.
export function pasteOverSelection() {
    if (!clipboard) return;
    const { doc, selection } = editor.get();
    const target = selection[0] ? doc.nodes[selection[0]] : undefined;
    const parent = target?.parentId && doc.nodes[target.parentId]?.type !== "page" ? target.parentId : null;
    placeCopies(clipboard.doc, clipboard.ids, parent, true, { movedFrom: movedFrom(clipboard) });
}

// The file the clipboard's layers came from, when that's another file.
function movedFrom(source: NonNullable<typeof clipboard>): string | undefined {
    const here = editor.get().fileId;
    return source.fromFile && source.fromFile !== here ? source.fromFile : undefined;
}

// ⇧⌘R: the clipboard replaces each selected layer, taking its position and size.
export function pasteToReplace() {
    if (!clipboard) return;
    const { doc, ids } = selected();
    if (!ids.length || blockedInsideInstance(ids, "replaced")) return;
    const source = clipboard;
    const sourceBounds = selectionBounds(source.doc, topLevel(source.doc, source.ids));
    const commands: Command[] = [];
    const created: string[] = [];
    for (const id of ids) {
        const old = doc.nodes[id];
        if (!old) continue;
        const box = selectionBounds(doc, [id]);
        for (const rootId of topLevel(source.doc, source.ids)) {
            const copies = cloneSubtree(source.doc, rootId, 0, old.parentId);
            const root = copies[0];
            if (!root) continue;
            created.push(root.id);
            // Scale the copy's box onto the old layer's box.
            const sx = sourceBounds && sourceBounds.w > 0 && box ? box.w / sourceBounds.w : 1;
            const sy = sourceBounds && sourceBounds.h > 0 && box ? box.h / sourceBounds.h : 1;
            // The replacement takes the old layer's place in its parent and its constraints and
            // layout settings, as the reference does.
            const siblings = old.parentId ? (doc.nodes[old.parentId]?.children ?? []) : doc.roots;
            const index = siblings.indexOf(id);
            const keep = { constraints: old.constraints, positioning: old.positioning, sizing: old.sizing };
            const rootX = box && sourceBounds ? old.x + (root.x - sourceBounds.x) * sx : root.x;
            const rootY = box && sourceBounds ? old.y + (root.y - sourceBounds.y) * sy : root.y;
            for (const node of copies) {
                const isRoot = node.id === root.id;
                // The layers inside move with the root (their coordinates are in the page's space too).
                const placed = isRoot && box && sourceBounds ? { ...node, ...keep, x: rootX, y: rootY, w: Math.max(1, Math.round(node.w * sx)), h: Math.max(1, Math.round(node.h * sy)) } : { ...node, x: node.x + rootX - root.x, y: node.y + rootY - root.y };
                commands.push({ type: "node.create", node: { ...placed, children: [] }, ...(isRoot && index >= 0 ? { index } : {}) });
            }
        }
        commands.push({ type: "node.delete", ids: [id] });
    }
    if (!commands.length) return;
    editor.execute({ type: "batch", commands });
    editor.set({ selection: created });
}

// ⌥drag: copies of the selection, in place, ready to be moved. Returns the copies' ids.
export function duplicateInPlace(): string[] {
    const { doc, ids } = selected();
    if (!ids.length || blockedInsideInstance(ids, "duplicated")) return [];
    placeCopies(doc, ids, null, true);
    rememberDuplicate(ids);
    return editor.get().selection;
}

// Plain text from outside Nagma becomes a text layer (12px, the default style) in the middle of
// the view, or inside the selected frame.
export function pasteText(text: string) {
    const content = text.replace(/\r\n?/g, "\n").trim();
    if (!content) return;
    const { doc } = editor.get();
    const target = pasteTargets()[0];
    const parentId = target ? target.id : activePage.id;
    const at = target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : apply(spaceMatrix(doc, parentId).inverse(), viewCenter().x, viewCenter().y);
    const name = content.split("\n")[0]?.slice(0, 40) || "Text";
    const draft = makeNode(doc, "text", { x: 0, y: 0, w: 1, h: 20 }, parentId, { text: content, name });
    const size = textSize(draft);
    const node = { ...draft, x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2), w: size.w, h: size.h };
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id] });
}

export function hasClipboard() {
    return clipboard !== null;
}

export function selectAll() {
    const { doc, selection } = editor.get();
    const first = doc.nodes[selection[0] ?? ""];
    // The selected layers' siblings, or (nothing selected) the layers on the page, never the pages.
    const scope = first?.parentId && first.type !== "page" ? (doc.nodes[first.parentId]?.children ?? []) : layerRoots(doc);
    editor.set({ selection: scope.filter((id) => doc.nodes[id]?.visible && !doc.nodes[id]?.locked) });
}

export function groupSelection() {
    const { doc, ids } = selected();
    if (!ids.length || blockedInsideInstance(ids, "grouped")) return;
    const ordered = inStackOrder(doc, ids);
    const top = doc.nodes[ordered[ordered.length - 1] ?? ""];
    const bounds = selectionBounds(doc, ordered);
    if (!top || !bounds) return;
    const parentId = top.parentId;
    const group = makeNode(doc, "group", bounds, parentId);
    const index = siblingsOf(doc, top).indexOf(top.id) + 1;
    // A scratch copy with the group in place, so children can be measured into its space.
    const working = { ...doc, nodes: { ...doc.nodes, [group.id]: group } };
    const commands: Command[] = [{ type: "node.create", node: group, index }];
    for (const id of ordered) commands.push(...rehome(working, id, group.id));
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [group.id] });
}

export function ungroupSelection() {
    const { doc, ids } = selected();
    // Groups, frames and sections all ungroup: their children take their place.
    const groups = ids.filter((id) => ["group", "frame"].includes(doc.nodes[id]?.type ?? "") && doc.nodes[id]?.children.length);
    if (!groups.length) return;
    const commands: Command[] = [];
    const freed: string[] = [];
    for (const id of groups) {
        const group = doc.nodes[id];
        if (!group) continue;
        const index = siblingsOf(doc, group).indexOf(id);
        // Insert children where the group was, keeping their order.
        group.children.forEach((child, i) => {
            commands.push({ type: "node.reparent", id: child, parentId: group.parentId, index: index + i });
            freed.push(child);
        });
        if (group.type === "frame") commands.push({ type: "node.delete", ids: [group.id] });
    }
    editor.execute({ type: "batch", commands });
    editor.set({ selection: freed });
}

// Resize to fit (⌥⇧⌘R): a frame shrinks or grows to the box around its children.
export function resizeToFit() {
    const { doc, ids } = selected();
    const commands: Command[] = [];
    for (const id of ids) {
        const node = doc.nodes[id];
        if (!node || !isFrameLike(node) || !node.children.length || node.layout) continue;
        const box = selectionBounds(doc, node.children);
        if (!box) continue;
        const at = apply(spaceMatrix(doc, node.parentId).inverse(), box.x, box.y);
        commands.push({ type: "node.update", id, patch: { x: at.x, y: at.y, w: Math.max(1, box.w), h: Math.max(1, box.h) } });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function frameSelection() {
    const { doc, ids } = selected();
    if (blockedInsideInstance(ids, "framed")) return;
    const ordered = inStackOrder(doc, ids);
    const top = doc.nodes[ordered[ordered.length - 1] ?? ""];
    const bounds = selectionBounds(doc, ordered);
    if (!top || !bounds) return;
    const parentId = top.parentId;
    const at = apply(spaceMatrix(doc, parentId).inverse(), bounds.x, bounds.y);
    const frame = makeNode(doc, "frame", { x: at.x, y: at.y, w: bounds.w, h: bounds.h }, parentId);
    const index = siblingsOf(doc, top).indexOf(top.id) + 1;
    const working = applyCommand(doc, { type: "node.create", node: frame, index });
    const commands: Command[] = [{ type: "node.create", node: frame, index }];
    for (const id of ordered) commands.push(...rehome(working, id, frame.id));
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [frame.id] });
}

// ⌘S: a section around the selection, a labelled region that doesn't clip.
export function sectionSelection() {
    const { doc, ids } = selected();
    if (!ids.length || blockedInsideInstance(ids, "sectioned")) return;
    const ordered = inStackOrder(doc, ids);
    const top = doc.nodes[ordered[ordered.length - 1] ?? ""];
    const bounds = selectionBounds(doc, ordered);
    if (!top || !bounds) return;
    const parentId = top.parentId;
    const pad = 40;
    const at = apply(spaceMatrix(doc, parentId).inverse(), bounds.x - pad, bounds.y - pad);
    const frame = makeNode(doc, "frame", { x: at.x, y: at.y, w: bounds.w + pad * 2, h: bounds.h + pad * 2 }, parentId, { name: "Section", isSection: true, clip: false, fills: [solid("#FFFFFF", 0.04)] });
    const index = siblingsOf(doc, top).indexOf(top.id) + 1;
    const working = applyCommand(doc, { type: "node.create", node: frame, index });
    const commands: Command[] = [{ type: "node.create", node: frame, index }];
    for (const id of ordered) commands.push(...rehome(working, id, frame.id));
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [frame.id] });
}

// Convert to section (a frame) or back to a frame.
export function toggleSection() {
    const { doc, ids } = selected();
    const frames = ids.filter((id) => isFrameLike(doc.nodes[id]) && doc.nodes[id]?.type === "frame");
    if (!frames.length) return;
    editor.execute({ type: "batch", commands: frames.map((id) => ({ type: "node.update", id, patch: { isSection: !doc.nodes[id]?.isSection, clip: Boolean(doc.nodes[id]?.isSection) } })) });
}

// ⌃⌘M: the bottom-most selected layer becomes a mask for the ones above it (or stops being one).
export function toggleMask() {
    const { doc, ids } = selected();
    const ordered = inStackOrder(doc, ids);
    const bottom = doc.nodes[ordered[0] ?? ""];
    if (!bottom) return;
    if (bottom.isMask) {
        editor.execute({ type: "node.update", id: bottom.id, patch: { isMask: false } });
        return;
    }
    // Several layers: group them so the mask only applies inside the group, as design tools do.
    if (ordered.length > 1) {
        groupSelection();
        editor.execute({ type: "node.update", id: bottom.id, patch: { isMask: true, maskType: bottom.maskType ?? "alpha" } });
        editor.mergeLast();
        const group = editor.get().selection;
        editor.set({ selection: group });
        return;
    }
    editor.execute({ type: "node.update", id: bottom.id, patch: { isMask: true, maskType: bottom.maskType ?? "alpha" } });
}

// ⌥⌘O: the stroke becomes a filled shape of its own. Rectangles and ellipses get an exact ring;
// vectors get an offset outline built from a sampled path.
export function outlineStroke() {
    const { doc, ids } = selected();
    const commands: Command[] = [];
    const created: string[] = [];
    for (const id of ids) {
        const node = doc.nodes[id];
        if (!node || node.strokeWidth <= 0 || !node.strokes.length || (node.type !== "rect" && node.type !== "ellipse" && node.type !== "vector")) continue;
        const outline = strokeOutline(node);
        if (!outline) continue;
        const fitted = fitPath(outline);
        const ring = makeNode(doc, "vector", { x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }, node.parentId, {
            name: node.name,
            fills: node.strokes,
            strokes: [],
            strokeWidth: 0,
            rotation: node.rotation,
            flipX: node.flipX,
            flipY: node.flipY,
            opacity: node.opacity,
            path: fitted.path,
        });
        const index = siblingsOf(doc, node).indexOf(node.id) + 1;
        commands.push({ type: "node.create", node: ring, index });
        commands.push({ type: "node.update", id, patch: { strokes: [] } });
        created.push(ring.id);
    }
    if (!commands.length) {
        editor.notify("Select a shape with a stroke to outline it.");
        return;
    }
    editor.execute({ type: "batch", commands });
    editor.set({ selection: created });
}

// The stroke's outline as subpaths in the layer's parent space.
function strokeOutline(node: SceneNode): Subpath[] | null {
    const w = node.strokeWidth;
    const align = node.strokeAlign;
    const grow = align === "center" ? w / 2 : align === "outside" ? w : 0;
    const shrink = align === "center" ? w / 2 : align === "inside" ? w : 0;
    if (node.type === "rect" || node.type === "ellipse") {
        const outer = shapeSubpaths({ ...node, x: node.x - grow, y: node.y - grow, w: node.w + grow * 2, h: node.h + grow * 2, radius: node.radius > 0 ? node.radius + grow : 0 });
        const innerW = node.w - shrink * 2;
        const innerH = node.h - shrink * 2;
        if (innerW <= 0 || innerH <= 0) return outer;
        const inner = shapeSubpaths({ ...node, x: node.x + shrink, y: node.y + shrink, w: innerW, h: innerH, radius: Math.max(0, node.radius - shrink) });
        // The hole winds the other way, so a nonzero fill leaves it empty.
        return [...outer, ...inner.map((s) => ({ closed: true, points: [...s.points].reverse().map((p) => ({ x: p.x, y: p.y, in: p.out, out: p.in })) }))];
    }
    const out: Subpath[] = [];
    for (const pts of samplePath(placedSubpaths(node), 12)) {
        if (pts.length < 2) continue;
        const left: { x: number; y: number }[] = [];
        const right: { x: number; y: number }[] = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i] as { x: number; y: number };
            const q = (pts[Math.min(i + 1, pts.length - 1)] as { x: number; y: number }) ?? p;
            const o = (pts[Math.max(i - 1, 0)] as { x: number; y: number }) ?? p;
            const dx = q.x - o.x;
            const dy = q.y - o.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            left.push({ x: p.x + nx * (w / 2), y: p.y + ny * (w / 2) });
            right.push({ x: p.x - nx * (w / 2), y: p.y - ny * (w / 2) });
        }
        out.push({ closed: true, points: [...left, ...right.reverse()].map((p) => ({ x: p.x, y: p.y, in: null, out: null })) });
    }
    return out.length ? out : null;
}

export type StackMove = "forward" | "backward" | "front" | "back";

export function reorder(direction: StackMove) {
    const { doc, ids } = selected();
    if (blockedInsideInstance(ids, "reordered")) return;
    const commands: Command[] = [];
    const ordered = inStackOrder(doc, ids);
    // Move the front-most first when bringing forward, so neighbours don't swap back.
    const sequence = direction === "forward" || direction === "front" ? [...ordered].reverse() : ordered;
    for (const id of sequence) {
        const node = doc.nodes[id];
        if (!node) continue;
        const siblings = siblingsOf(doc, node);
        const index = siblings.indexOf(id);
        const target =
            direction === "front" ? siblings.length : direction === "back" ? 0 : direction === "forward" ? index + 1 : Math.max(0, index - 1);
        commands.push({ type: "node.reparent", id, parentId: node.parentId, index: target });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function flipSelection(axis: "x" | "y") {
    const { doc, ids } = selected();
    const commands: Command[] = ids.flatMap((id): Command[] => {
        const node = doc.nodes[id];
        if (!node) return [];
        // A group mirrors the layers inside it about its centre.
        if (node.type === "group") return flipGroup(doc, node, axis);
        return [{ type: "node.update", id, patch: axis === "x" ? { flipX: !node.flipX } : { flipY: !node.flipY } }];
    });
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function toggleVisibility() {
    const { doc, ids } = selected();
    const show = ids.some((id) => !doc.nodes[id]?.visible);
    editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update" as const, id, patch: { visible: show } })) });
}

export function toggleLock() {
    const { doc, ids } = selected();
    const lock = ids.some((id) => !doc.nodes[id]?.locked);
    // Locked layers stay selected (they can still be edited from the panel).
    editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update" as const, id, patch: { locked: lock } })) });
}

export function nudge(dx: number, dy: number) {
    const { doc, ids } = selected();
    if (!ids.length || blockedInsideInstance(ids, "moved")) return;
    editor.execute({
        type: "batch",
        commands: ids.flatMap((id): Command[] => {
            const node = doc.nodes[id];
            if (!node) return [];
            const d = applyVector(spaceMatrix(doc, node.parentId).inverse(), dx, dy);
            return [{ type: "node.move", ids: [id], dx: d.x, dy: d.y }];
        }),
    });
}

export function selectParent() {
    const { doc, selection } = editor.get();
    const parent = doc.nodes[selection[0] ?? ""]?.parentId;
    editor.set({ selection: parent && doc.nodes[parent]?.type !== "page" ? [parent] : [] });
}

export function selectChildren() {
    const { doc, selection } = editor.get();
    const node = doc.nodes[selection[0] ?? ""];
    if (node?.type === "text") editor.set({ editingTextId: node.id });
    else if (node?.children.length) editor.set({ selection: [...node.children] });
}

// Tab and shift-tab walk through siblings, front to back like the layers list.
export function selectSibling(step: 1 | -1) {
    const { doc, selection } = editor.get();
    const node = doc.nodes[selection[selection.length - 1] ?? ""];
    if (!node) return;
    const siblings = [...siblingsOf(doc, node)].reverse();
    const index = siblings.indexOf(node.id);
    const next = siblings[(index + step + siblings.length) % siblings.length];
    if (next) editor.set({ selection: [next] });
}

// Where pasted or dropped things go when there is no better place: the middle of the view.
export function viewCenter() {
    const { camera } = editor.get();
    return screenToWorld(camera, viewport.width / 2, viewport.height / 2);
}

// ⇧A: turn the selected frame into an auto-layout stack, or wrap the selected layers in one.
// Direction, order and gap are read from how the layers are already arranged.
export function addAutoLayout() {
    const { doc, ids } = selected();
    if (!ids.length) return;
    const single = ids.length === 1 ? doc.nodes[ids[0] ?? ""] : undefined;
    let frameId: string;
    if (single?.type === "frame" || single?.type === "component") {
        if (single.layout) return;
        frameId = single.id;
    } else {
        const steps = editor.get().past.length;
        frameSelection();
        const created = editor.get().selection[0];
        // Framing refused (say, inside an instance): nothing to lay out.
        if (!created || editor.get().past.length === steps) return;
        frameId = created;
    }
    const current = editor.get().doc;
    const frame = current.nodes[frameId];
    if (!frame) return;
    const kids = frame.children.map((id) => current.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    const spread = (pick: (n: SceneNode) => number) => (kids.length ? Math.max(...kids.map(pick)) - Math.min(...kids.map(pick)) : 0);
    const vertical = spread((n) => n.y + n.h / 2) >= spread((n) => n.x + n.w / 2);
    const sorted = [...kids].sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
    let gapSum = 0;
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const next = sorted[i];
        if (prev && next) gapSum += vertical ? next.y - (prev.y + prev.h) : next.x - (prev.x + prev.w);
    }
    const gap = sorted.length > 1 ? Math.max(0, Math.round(gapSum / (sorted.length - 1))) : 10;
    const wrapped = single?.type !== "frame" && single?.type !== "component";
    // An existing frame keeps the space between its edges and its contents as padding.
    const inset = (pick: (n: SceneNode) => number) => (kids.length ? Math.max(0, Math.round(Math.min(...kids.map(pick)))) : 16);
    const padding: [number, number, number, number] = wrapped
        ? [0, 0, 0, 0]
        : [inset((n) => n.y - frame.y), inset((n) => frame.x + frame.w - (n.x + n.w)), inset((n) => frame.y + frame.h - (n.y + n.h)), inset((n) => n.x - frame.x)];
    const commands: Command[] = sorted.map((node, index) => ({ type: "node.reparent", id: node.id, parentId: frameId, index }));
    // A frame hugs its contents once it lays them out, except where its size is set elsewhere: a
    // campaign asset keeps its size preset, and a site's breakpoint frame its width.
    const asset = frame.campaign?.kind === "asset";
    const breakpoint = Boolean(frame.site && "kind" in frame.site && frame.site.kind === "bp");
    const sizing = asset ? ({ h: "fixed", v: "fixed" } as const) : breakpoint ? { h: "fixed" as const, v: frame.sizing.v } : ({ h: "hug", v: "hug" } as const);
    commands.push({
        type: "node.update",
        id: frameId,
        patch: {
            layout: { direction: vertical ? "vertical" : "horizontal", gap, padding, primary: "start", counter: "start" },
            sizing,
            ...(wrapped ? { fills: [] } : {}),
        },
    });
    editor.execute({ type: "batch", commands });
    // Wrapping in a frame and adding the layout are one step.
    if (wrapped) editor.mergeLast();
    editor.set({ selection: [frameId] });
}

export function removeAutoLayout() {
    const { doc, ids } = selected();
    const frames = ids.filter((id) => doc.nodes[id]?.layout);
    if (!frames.length) return;
    editor.execute({
        type: "batch",
        commands: frames.map((id) => ({ type: "node.update" as const, id, patch: { layout: null, sizing: { h: "fixed" as const, v: "fixed" as const } } })),
    });
}

export function addPage(): string {
    const { doc } = editor.get();
    const used = new Set(doc.roots.map((id) => doc.nodes[id]?.name));
    let n = doc.roots.length + 1;
    while (used.has(`Page ${n}`)) n++;
    // A new page takes the canvas colour of the page you're on.
    const current = doc.nodes[editor.get().pageId];
    const page = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: `Page ${n}`, ...(current?.type === "page" && current.fills.length ? { fills: current.fills.map((p) => ({ ...p })) } : {}) });
    editor.execute({ type: "node.create", node: page });
    editor.setPage(page.id);
    return page.id;
}

export async function deletePage(id: string) {
    const { doc } = editor.get();
    // Dividers (empty pages named with a leading dash) don't count as pages and can't be opened.
    const divider = (pid: string) => doc.nodes[pid]?.children.length === 0 && Boolean(doc.nodes[pid]?.name.trimStart().startsWith("-"));
    const pages = doc.roots.filter((pid) => !divider(pid));
    if (!divider(id) && pages.length <= 1) {
        editor.notify("A file needs at least one page.");
        return;
    }
    // A page with layers on it asks first.
    const page = doc.nodes[id];
    if (page && page.children.length && !(await askConfirm(`Delete "${page.name}"?`, `Its ${page.children.length === 1 ? "layer" : `${page.children.length} layers`} will be deleted too. You can undo this.`, "Delete page", true))) return;
    if (id === editor.get().pageId) {
        const index = pages.indexOf(id);
        const next = pages[index === 0 ? 1 : index - 1];
        if (next) editor.setPage(next);
    }
    editor.execute({ type: "node.delete", ids: [id] });
    if (page) editor.notify(`Deleted "${page.name}".`, { label: "Undo", run: () => editor.undo() });
}

export function duplicatePage(id: string) {
    const { doc } = editor.get();
    const page = doc.nodes[id];
    if (!page) return;
    const copies = cloneSubtree(doc, id, 0, null);
    const root = copies[0];
    if (!root) return;
    const commands: Command[] = copies.map((node, i) => ({
        type: "node.create",
        node: { ...node, children: [], ...(i === 0 ? { name: `Copy of ${page.name}` } : {}) },
        ...(i === 0 ? { index: doc.roots.indexOf(id) + 1 } : {}),
    }));
    editor.execute({ type: "batch", commands });
    editor.setPage(root.id);
}

// ⌥⌘K: make the selection a component. A single frame becomes one in place; anything else is
// wrapped in a new component first.
export function createComponent() {
    const { doc, ids } = selected();
    if (!ids.length) return;
    if (ids.some((id) => doc.nodes[id]?.sourceId)) {
        editor.notify("Layers inside an instance can't become components. Detach the instance first.");
        return;
    }
    const single = ids.length === 1 ? doc.nodes[ids[0] ?? ""] : undefined;
    if (single?.type === "component") return;
    if (single?.type === "frame") {
        editor.execute({ type: "node.convert", id: single.id, to: "component" });
        return;
    }
    const mark = editor.get().past.at(-1);
    frameSelection();
    const frameId = editor.get().selection[0];
    if (!frameId || doc.nodes[frameId]) return;
    const frame = editor.get().doc.nodes[frameId];
    // Wrapped layers sit flush in the new component, without a white background.
    editor.execute({
        type: "batch",
        commands: [
            { type: "node.convert", id: frameId, to: "component" },
            // One layer names the component after itself; several get the next "Component N".
            { type: "node.update", id: frameId, patch: { fills: [], name: frame?.children.length === 1 ? (doc.nodes[frame.children[0] ?? ""]?.name ?? "Component") : nextName(editor.get().doc, "component", frame?.parentId ?? null) } },
        ],
    });
    // Framing, selecting the frame and converting it are one undo step.
    while (editor.get().past.length >= 2 && editor.get().past.at(-2) !== mark) editor.mergeLast();
}

// Places an instance of a component: next to the component when it's on this page, else mid-view.
export function createInstance(assetId: string, at?: { x: number; y: number }) {
    const { doc } = editor.get();
    const asset = doc.nodes[assetId];
    // A component set places its first variant.
    const componentId = asset?.type === "componentSet" ? (asset.children.find((id) => doc.nodes[id]?.type === "component") ?? "") : assetId;
    const component = doc.nodes[componentId];
    if (!component || component.type !== "component") return;
    const sameView = pageOf(doc, component) === activePage.id;
    const center = at ?? viewCenter();
    const position = !at && sameView ? { x: component.x + component.w + 40, y: component.y } : { x: center.x - component.w / 2, y: center.y - component.h / 2 };
    if (wouldNestItself(doc, componentId, activePage.id)) return;
    const node = makeNode(doc, "instance", { x: position.x, y: position.y, w: component.w, h: component.h }, activePage.id, {
        name: assetName(doc, componentId),
        componentId,
        fills: [],
        overrides: [],
    });
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id], tool: "move" });
}

// ⌥⌘B: turn instances back into ordinary frames that no longer follow their component.
export function detachInstance() {
    const { doc, ids } = selected();
    const instances = ids.filter((id) => doc.nodes[id]?.type === "instance");
    if (!instances.length) return;
    editor.execute({ type: "batch", commands: instances.map((id) => ({ type: "node.convert" as const, id, to: "frame" as const })) });
}

export function goToMainComponent() {
    const { doc, selection } = editor.get();
    const instance = doc.nodes[selection[0] ?? ""];
    const component = instance?.componentId ? doc.nodes[instance.componentId] : undefined;
    if (!component) {
        editor.notify("The main component for this instance was deleted.");
        return;
    }
    const page = pageOf(doc, component);
    if (page) editor.setPage(page);
    editor.set({ selection: [component.id] });
    requestAnimationFrame(() => zoomToSelection());
}

export function resetOverrides() {
    const { doc, ids } = selected();
    const commands: Command[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        if (node.overrides?.length) commands.push({ type: "node.update", id, patch: { overrides: [] } });
        node.children.forEach(visit);
    };
    ids.forEach(visit);
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Layers inside an instance mirror the component, so they can't be moved, deleted or regrouped there.
export function blockedInsideInstance(ids: string[], verb: string): boolean {
    const { doc } = editor.get();
    if (!ids.some((id) => doc.nodes[id]?.sourceId)) return false;
    editor.notify(`Layers inside an instance can't be ${verb}. Change the main component, or detach the instance.`);
    return true;
}

// Switches an instance to another component (or variant). Changes made on layers whose names match
// in the new component carry over, as they do in other design tools.
export function swapComponent(instanceId: string, componentId: string) {
    const { doc } = editor.get();
    const instance = doc.nodes[instanceId];
    if (!instance || instance.type !== "instance" || instance.componentId === componentId) return;
    if (wouldNestItself(doc, componentId, instance.parentId)) {
        editor.notify("A component can't contain an instance of itself.");
        return;
    }
    // Remember overrides by layer-name path inside the instance.
    const carried = new Map<string, Partial<SceneNode>>();
    const collect = (ids: string[], path: string) => {
        for (const id of ids) {
            const node = doc.nodes[id];
            if (!node) continue;
            const key = `${path}/${node.name}`;
            if (node.overrides?.length) {
                const values: Record<string, unknown> = {};
                for (const prop of node.overrides) values[prop] = (node as unknown as Record<string, unknown>)[prop];
                carried.set(key, values as Partial<SceneNode>);
            }
            collect(node.children, key);
        }
    };
    collect(instance.children, "");
    editor.execute({ type: "node.update", id: instanceId, patch: { componentId } });
    const after = editor.get().doc;
    const commands: Command[] = [];
    const apply_ = (ids: string[], path: string) => {
        for (const id of ids) {
            const node = after.nodes[id];
            if (!node) continue;
            const key = `${path}/${node.name}`;
            const values = carried.get(key);
            if (values) commands.push({ type: "node.update", id, patch: values });
            apply_(node.children, key);
        }
    };
    apply_(after.nodes[instanceId]?.children ?? [], "");
    if (commands.length) {
        editor.execute({ type: "batch", commands });
        editor.mergeLast();
    }
}

// Picks the variant of an instance's set with one property changed.
export function setVariant(instanceId: string, property: string, value: string) {
    const { doc } = editor.get();
    const instance = doc.nodes[instanceId];
    const component = instance?.componentId ? doc.nodes[instance.componentId] : undefined;
    const set = component?.parentId ? doc.nodes[component.parentId] : undefined;
    if (!instance || !component || set?.type !== "componentSet") return;
    const target = findVariant(doc, set.id, { ...variantProps(component.name), [property]: value });
    if (target) swapComponent(instanceId, target);
}

// Adds a variant next to a component, turning it into a component set first if needed.
export function addVariant(componentId: string) {
    const { doc } = editor.get();
    const component = doc.nodes[componentId];
    if (!component || component.type !== "component") return;
    const commands: Command[] = [];
    let setId = component.parentId ?? "";
    let working = doc;
    if (doc.nodes[setId]?.type !== "componentSet") {
        // Wrap the component in a set that lays its variants out in a row.
        const set = makeNode(doc, "componentSet", { x: component.x - 20, y: component.y - 20, w: component.w + 40, h: component.h + 40 }, component.parentId, {
            name: component.name,
            layout: { direction: "horizontal", gap: 20, padding: [20, 20, 20, 20], primary: "start", counter: "start" },
            sizing: { h: "hug", v: "hug" },
            strokes: [],
        });
        const index = siblingsOf(doc, component).indexOf(component.id);
        commands.push({ type: "node.create", node: set, index });
        working = applyCommand(doc, { type: "node.create", node: set, index });
        commands.push(...rehome(working, component.id, set.id));
        if (!component.name.includes("=")) commands.push({ type: "node.update", id: component.id, patch: { name: "Property 1=Default" } });
        setId = set.id;
    }
    // Copy the last variant and give it the next free value of its first property.
    const settled = applyCommand(doc, { type: "batch", commands });
    const set = settled.nodes[setId];
    const last = settled.nodes[set?.children[set.children.length - 1] ?? ""] ?? settled.nodes[componentId];
    if (!last) return;
    const props = variantProps(last.name);
    const [firstKey] = Object.keys(props);
    const used = new Set(setProperties(settled, setId).find(([key]) => key === firstKey)?.[1] ?? []);
    let n = 2;
    while (used.has(`Variant${n}`)) n++;
    const copies = cloneSubtree(settled, last.id, 0, setId);
    copies.forEach((node, i) =>
        commands.push({ type: "node.create", node: { ...node, children: [], ...(i === 0 ? { name: variantName({ ...props, [firstKey ?? "Property 1"]: `Variant${n}` }) } : {}) } }),
    );
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [copies[0]?.id ?? componentId] });
}

// Renames one property value of a variant (e.g. State: Default → Hover).
export function renameVariantValue(componentId: string, property: string, value: string) {
    const { doc } = editor.get();
    const component = doc.nodes[componentId];
    if (!component) return;
    editor.execute({ type: "node.update", id: componentId, patch: { name: variantName({ ...variantProps(component.name), [property]: value }) } });
}

const BOOLEAN_NAMES: Record<BooleanOp, string> = { union: "Union", subtract: "Subtract", intersect: "Intersect", exclude: "Exclude" };

// ⌥⌘U / S / I / X: combine the selected shapes into a live boolean group, or change an existing one.
export function booleanSelection(op: BooleanOp) {
    const { doc, ids } = selected();
    const single = ids.length === 1 ? doc.nodes[ids[0] ?? ""] : undefined;
    if (single?.type === "boolean") {
        editor.execute({ type: "node.update", id: single.id, patch: { booleanOp: op, name: BOOLEAN_NAMES[op] } });
        return;
    }
    if (ids.length < 2) {
        editor.notify("Select two or more shapes to combine them.");
        return;
    }
    if (blockedInsideInstance(ids, "combined")) return;
    if (ids.some((id) => isFrameLike(doc.nodes[id]))) {
        editor.notify("Frames can't be combined. Use shapes, vectors or groups.");
        return;
    }
    const ordered = inStackOrder(doc, ids);
    const bottom = doc.nodes[ordered[0] ?? ""];
    const top = doc.nodes[ordered[ordered.length - 1] ?? ""];
    const bounds = selectionBounds(doc, ordered);
    if (!top || !bottom || !bounds) return;
    // Like the reference, the result takes the top layer's fills and strokes; subtract keeps the bottom's.
    const source = op === "subtract" ? bottom : top;
    const node = makeNode(doc, "boolean", bounds, top.parentId, {
        name: BOOLEAN_NAMES[op],
        booleanOp: op,
        fills: source.type === "group" || source.type === "boolean" ? (source.fills.length ? source.fills : [solid("#D9D9D9")]) : source.fills,
        strokes: source.strokes,
        strokeWidth: source.strokeWidth,
        strokeAlign: source.strokeAlign,
        strokeCap: source.strokeCap,
        strokeJoin: source.strokeJoin,
        dash: source.dash ?? null,
    });
    const index = siblingsOf(doc, top).indexOf(top.id) + 1;
    const working = { ...doc, nodes: { ...doc.nodes, [node.id]: node } };
    const commands: Command[] = [{ type: "node.create", node, index }];
    for (const id of ordered) commands.push(...rehome(working, id, node.id));
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [node.id] });
}

// ⌘E and ⌥⇧F: the selection becomes one vector (engine/flatten.ts). Text alone becomes its glyph
// outlines (one vector per fill); text inside a mixed selection has its outlines loaded first so
// the merged vector uses the letters.
export function flattenSelection() {
    const { doc, ids } = selected();
    if (!ids.length) return;
    const texts = ids.filter((id) => doc.nodes[id]?.type === "text");
    if (texts.length === ids.length) {
        void flattenText(texts);
        return;
    }
    const nested = new Set<string>();
    const walk = (id: string) => {
        const n = doc.nodes[id];
        if (!n) return;
        if (n.type === "text") nested.add(id);
        n.children.forEach(walk);
    };
    ids.forEach(walk);
    if (!nested.size) return flattenAny();
    void Promise.all([...nested].map((id) => loadTextOutlines(doc.nodes[id] as SceneNode).catch(() => undefined))).then(() => flattenAny());
}

// A rectangle or ellipse opened for point editing: the step that turned it into a vector, taken
// back on leaving when no point was edited, so it stays a rectangle or ellipse (as in the reference).
let convertedOnEntry: { id: string; entry: unknown } | null = null;

// Starts editing a vector's points. Rectangles and ellipses are flattened into vectors first.
export function enterVectorEdit(id: string) {
    const { doc } = editor.get();
    const node = doc.nodes[id];
    if (!node || node.sourceId) return;
    if (node.type === "rect" || node.type === "ellipse") {
        editor.execute({ type: "node.convert", id, to: "vector", path: fitPath(shapeSubpaths(node)).path });
        convertedOnEntry = { id, entry: editor.get().past.at(-1) ?? null };
    } else if (node.type !== "vector") return;
    editor.set({ selection: [id], editingVectorId: id, vertices: [], vectorTool: "move", tool: "move" });
}

export function leaveVectorEdit() {
    const s = editor.get();
    if (!s.editingVectorId) return;
    editor.set({ editingVectorId: null, vertices: [], vectorTool: "move" });
    const converted = convertedOnEntry;
    convertedOnEntry = null;
    if (!converted || converted.id !== s.editingVectorId) return;
    // Only selection steps since the conversion: no point was edited, so the shape comes back.
    const at = s.past.indexOf(converted.entry as (typeof s.past)[number]);
    const entry = s.past[at];
    if (!entry || !s.past.slice(at + 1).every((e) => e.selectionOnly)) return;
    const original = entry.before.nodes[converted.id];
    const parent = original?.parentId ? s.doc.nodes[original.parentId] : undefined;
    if (!original || !parent) return;
    editor.executeSilently({ type: "batch", commands: [{ type: "node.delete", ids: [converted.id] }, { type: "node.create", node: original, index: parent.children.indexOf(converted.id) }] });
    editor.set({ past: editor.get().past.filter((e) => e !== entry), selection: s.selection });
}
