import { boundsOfPoints, apply as applyMatrix, localMatrix } from "./transform";
import { inheritedOverrides, isFrameLike, overridableFor, syncInstances } from "./components";
import { resizeChildren } from "./constraints";
import { syncLayouts } from "./layout";
import { syncRepeats } from "./repeat";
import { resolveVariables } from "./variables";
import { textSize } from "./text";
import { booleanResult } from "./booleans";
import { pathBounds } from "./vector";
import type { Command, NagmaDocument, SceneNode } from "./types";

// Applies a command to a document and returns a new document. Never mutates the input,
// so the previous document is a free undo snapshot. Group boxes are refitted afterwards.
export function applyCommand(doc: NagmaDocument, command: Command): NagmaDocument {
    const raw = applyRaw(doc, command);
    if (raw === doc) return doc;
    return settle(doc, raw);
}

// Derived-layer passes products register (site/sync.ts): given the settled document before an edit
// and the edited one, they return the edited one with their own copies brought up to date.
type Settler = (before: NagmaDocument, raw: NagmaDocument) => NagmaDocument;
const settlers: Settler[] = [];
export function addSettler(settler: Settler) {
    if (!settlers.includes(settler)) settlers.push(settler);
}

// Recomputes everything derived from the edited layers: instance contents, text sizes, group boxes
// and auto layout. `before` tells which layers changed, so only their text is re-measured.
export function settle(before: NagmaDocument, raw: NagmaDocument): NagmaDocument {
    // Products keep their own derived layers in step first (site breakpoints and CMS copies).
    for (const settler of settlers) raw = settler(before, raw);
    // Variables resolve before instances copy their components, and again after, so a copy in
    // another mode (set on it or an ancestor) shows that mode's values.
    const next = resolveVariables(syncInstances(resolveVariables(syncRepeats(raw)), before));
    // Text sizes feed layouts, and layouts can change text widths (fill), so text runs on both sides.
    const sized = syncText(before, next);
    let prev = sized;
    let current = syncLayouts(syncGroups(sized));
    // Layout passes repeat until nothing moves: a group refitted after a pass (a stack inside a
    // group inside a stack) changes what the outer stack holds, and a component the layout resized
    // (one hugging its contents) hands its new size to its instances.
    for (let pass = 0; pass < 4; pass++) {
        const rebuilt = touchesComponents(prev, current) ? syncInstances(current, prev) : current;
        const followed = rebuilt === current ? current : resolveVariables(rebuilt);
        const settled = syncGroups(syncLayouts(syncText(sized, followed)));
        if (settled === current) break;
        prev = current;
        current = settled;
    }
    return current;
}

// Whether anything inside a component changed from one document to the next.
function touchesComponents(from: NagmaDocument, to: NagmaDocument): boolean {
    if (from.nodes === to.nodes) return false;
    for (const id in to.nodes) {
        let node: SceneNode | undefined = to.nodes[id];
        if (node === from.nodes[id]) continue;
        while (node) {
            if (node.type === "component") return true;
            node = node.parentId ? to.nodes[node.parentId] : undefined;
        }
    }
    return false;
}

// Applies a command without running auto layout: used to ask "where would this land" mid-drag,
// before the stack snaps layers into place.
export function applyWithoutLayout(doc: NagmaDocument, command: Command): NagmaDocument {
    const next = applyRaw(doc, command);
    return next === doc ? doc : syncGroups(next);
}

function applyRaw(doc: NagmaDocument, command: Command): NagmaDocument {
    switch (command.type) {
        case "node.create":
            return createNode(doc, command.node, command.index);
        case "node.update": {
            const node = doc.nodes[command.id];
            if (!node) return doc;
            const updated = { ...node, ...command.patch };
            // Changes to an instance (or a layer inside one) are remembered as overrides,
            // so they survive later edits to the main component.
            if (node.sourceId || node.type === "instance") {
                const allowed = overridableFor(node);
                const added = Object.keys(command.patch).filter((key) => allowed.has(key) && !(node.overrides ?? []).includes(key));
                if (added.length && !("overrides" in command.patch)) updated.overrides = [...(node.overrides ?? []), ...added];
            }
            const nodes = { ...doc.nodes, [node.id]: updated };
            // Resizing a frame moves and stretches its children according to their constraints.
            const resized = updated.x !== node.x || updated.y !== node.y || updated.w !== node.w || updated.h !== node.h;
            if (resized && !command.ignoreConstraints && isFrameLike(node) && !node.layout && node.type !== "instance" && node.children.length) {
                resizeChildren(nodes, node.id, node, updated);
            }
            return { ...doc, nodes };
        }
        case "node.convert":
            if (command.to === "vector") {
                const node = doc.nodes[command.id];
                if (!node || !command.path || (node.type !== "rect" && node.type !== "ellipse" && node.type !== "vector")) return doc;
                return { ...doc, nodes: { ...doc.nodes, [node.id]: { ...node, type: "vector", path: command.path, radius: 0 } } };
            }
            return convertNode(doc, command.id, command.to);
        case "node.delete":
            return deleteNodes(doc, command.ids);
        case "node.move":
            return moveNodes(doc, command.ids, command.dx, command.dy);
        case "node.reparent":
            return reparent(doc, command.id, command.parentId, command.index);
        case "doc.rename":
            return { ...doc, name: command.name };
        case "doc.settings":
            return { ...doc, ...command.patch };
        case "sequence.set":
            return { ...doc, sequence: command.sequence };
        case "styles.set":
            return { ...doc, styles: command.styles };
        case "prototype.set":
            return { ...doc, prototype: command.prototype };
        case "variables.set":
            return { ...doc, variables: command.variables };
        case "image.add":
            if (doc.images[command.id]) return doc;
            return { ...doc, images: { ...doc.images, [command.id]: command.data } };
        case "image.set":
            if (!doc.images[command.id] || doc.images[command.id] === command.data) return doc;
            return { ...doc, images: { ...doc.images, [command.id]: command.data } };
        case "batch": {
            // Runs of layer creations (imports add thousands at once) are applied together, so
            // the document isn't copied once per layer.
            let next = doc;
            const list = command.commands;
            for (let i = 0; i < list.length; ) {
                if (list[i]?.type !== "node.create") {
                    next = applyRaw(next, list[i] as Command);
                    i++;
                    continue;
                }
                let j = i;
                while (j < list.length && list[j]?.type === "node.create") j++;
                next = j - i > 1 ? createNodes(next, list.slice(i, j) as Extract<Command, { type: "node.create" }>[]) : applyRaw(next, list[i] as Command);
                i = j;
            }
            return next;
        }
    }
}

// The same as creating each layer in turn, with one copy of the document.
function createNodes(doc: NagmaDocument, creates: Extract<Command, { type: "node.create" }>[]): NagmaDocument {
    const nodes = { ...doc.nodes };
    let roots = doc.roots;
    let rootsCopied = false;
    // Parents whose node (and children list) were copied in this run.
    const copied = new Set<string>();
    for (const { node, index } of creates) {
        if (nodes[node.id]) continue;
        if (node.parentId !== null && !nodes[node.parentId]) continue;
        nodes[node.id] = node;
        let list: string[];
        if (node.parentId === null) {
            if (!rootsCopied) {
                roots = [...roots];
                rootsCopied = true;
            }
            list = roots;
        } else {
            if (!copied.has(node.parentId)) {
                const parent = nodes[node.parentId] as SceneNode;
                nodes[node.parentId] = { ...parent, children: [...parent.children] };
                copied.add(node.parentId);
            }
            list = (nodes[node.parentId] as SceneNode).children;
        }
        const existing = list.indexOf(node.id);
        if (existing >= 0) list.splice(existing, 1);
        const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
        list.splice(at, 0, node.id);
    }
    return { ...doc, nodes, roots };
}

function siblingsOf(doc: NagmaDocument, parentId: string | null): string[] {
    if (parentId === null) return doc.roots;
    return doc.nodes[parentId]?.children ?? [];
}

function withSiblings(doc: NagmaDocument, parentId: string | null, siblings: string[]): NagmaDocument {
    if (parentId === null) return { ...doc, roots: siblings };
    const parent = doc.nodes[parentId];
    if (!parent) return doc;
    return { ...doc, nodes: { ...doc.nodes, [parentId]: { ...parent, children: siblings } } };
}

function insertAt(list: string[], id: string, index?: number): string[] {
    const next = list.filter((item) => item !== id);
    const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
    next.splice(at, 0, id);
    return next;
}

function createNode(doc: NagmaDocument, node: SceneNode, index?: number): NagmaDocument {
    if (doc.nodes[node.id]) return doc;
    if (node.parentId !== null && !doc.nodes[node.parentId]) return doc;
    const withNode = { ...doc, nodes: { ...doc.nodes, [node.id]: node } };
    return withSiblings(withNode, node.parentId, insertAt(siblingsOf(withNode, node.parentId), node.id, index));
}

export function descendants(doc: NagmaDocument, id: string): string[] {
    const out: string[] = [];
    const visit = (nodeId: string) => {
        const node = doc.nodes[nodeId];
        if (!node) return;
        for (const child of node.children) {
            out.push(child);
            visit(child);
        }
    };
    visit(id);
    return out;
}

function deleteNodes(doc: NagmaDocument, ids: string[]): NagmaDocument {
    let next = doc;
    for (const id of ids) {
        const node = next.nodes[id];
        if (!node) continue;
        next = withSiblings(
            next,
            node.parentId,
            siblingsOf(next, node.parentId).filter((item) => item !== id),
        );
        const nodes = { ...next.nodes };
        for (const gone of [id, ...descendants(next, id)]) delete nodes[gone];
        next = { ...next, nodes };
    }
    return next;
}

function moveNodes(doc: NagmaDocument, ids: string[], dx: number, dy: number): NagmaDocument {
    // Moving a frame moves everything inside it. Skip ids already covered by a moving ancestor.
    const moving = new Set<string>();
    for (const id of ids) {
        moving.add(id);
        for (const child of descendants(doc, id)) moving.add(child);
    }
    const nodes = { ...doc.nodes };
    for (const id of moving) {
        const node = nodes[id];
        if (node) nodes[id] = { ...node, x: node.x + dx, y: node.y + dy };
    }
    return { ...doc, nodes };
}

function reparent(doc: NagmaDocument, id: string, parentId: string | null, index?: number): NagmaDocument {
    const node = doc.nodes[id];
    if (!node) return doc;
    if (parentId !== null && (parentId === id || descendants(doc, id).includes(parentId))) return doc;
    if (parentId !== null && !doc.nodes[parentId]) return doc;
    let next = withSiblings(
        doc,
        node.parentId,
        siblingsOf(doc, node.parentId).filter((item) => item !== id),
    );
    next = { ...next, nodes: { ...next.nodes, [id]: { ...node, parentId } } };
    return withSiblings(next, parentId, insertAt(siblingsOf(next, parentId), id, index));
}

function depth(doc: NagmaDocument, node: SceneNode): number {
    let d = 0;
    let parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (parent) {
        d++;
        parent = parent.parentId ? doc.nodes[parent.parentId] : undefined;
    }
    return d;
}

// Fits every group's box to its children, deepest first, and removes groups left empty.
function syncGroups(doc: NagmaDocument): NagmaDocument {
    const groups = Object.values(doc.nodes)
        .filter((node) => node.type === "group" || node.type === "boolean")
        .sort((a, b) => depth(doc, b) - depth(doc, a));
    if (groups.length === 0) return doc;
    let next = doc;
    for (const stale of groups) {
        const group = next.nodes[stale.id];
        if (!group) continue;
        if (group.children.length === 0) {
            next = deleteNodes(next, [group.id]);
            continue;
        }
        const points = group.children.flatMap((id) => {
            const child = next.nodes[id];
            if (!child) return [];
            const m = localMatrix(child);
            return [
                applyMatrix(m, child.x, child.y),
                applyMatrix(m, child.x + child.w, child.y),
                applyMatrix(m, child.x + child.w, child.y + child.h),
                applyMatrix(m, child.x, child.y + child.h),
            ];
        });
        // A boolean's box is its result's extent (an intersection is only the overlap).
        const box = (group.type === "boolean" ? pathBounds(booleanResult(next, group)) : null) ?? boundsOfPoints(points);
        if (!box) continue;
        if (box.x !== group.x || box.y !== group.y || box.w !== group.w || box.h !== group.h) {
            next = { ...next, nodes: { ...next.nodes, [group.id]: { ...group, ...box, rotation: 0, flipX: false, flipY: false } } };
        }
    }
    return next;
}

// Re-measures text layers that changed since `before`, so auto width and auto height stay true.
function syncText(before: NagmaDocument, after: NagmaDocument): NagmaDocument {
    let nodes: NagmaDocument["nodes"] | null = null;
    for (const node of Object.values(after.nodes)) {
        if (node.type !== "text" || before.nodes[node.id] === node) continue;
        if (node.sizing.h !== "hug" && node.sizing.v !== "hug") continue;
        const size = textSize(node);
        if (size.w === node.w && size.h === node.h) continue;
        nodes ??= { ...after.nodes };
        nodes[node.id] = { ...node, ...size };
    }
    return nodes ? { ...after, nodes } : after;
}

// Re-measures every text layer (after a web font finishes loading).
export function remeasureAllText(doc: NagmaDocument): NagmaDocument {
    let nodes: NagmaDocument["nodes"] | null = null;
    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "text") continue;
        const size = textSize(node);
        if (size.w === node.w && size.h === node.h) continue;
        nodes ??= { ...doc.nodes };
        nodes[node.id] = { ...node, ...size };
    }
    return nodes ? syncGroups(syncLayouts({ ...doc, nodes })) : doc;
}

// Frame ⇄ component, and instance → frame ("detach"). A detached instance keeps its current look;
// its layers stop mirroring the component (nested instances stay instances).
function convertNode(doc: NagmaDocument, id: string, to: "frame" | "component"): NagmaDocument {
    const node = doc.nodes[id];
    if (!node) return doc;
    if (to === "component") {
        if (node.type !== "frame") return doc;
        return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, type: "component" } } };
    }
    if (node.type !== "component" && node.type !== "instance") return doc;
    const nodes = { ...doc.nodes };
    const { componentId: _component, overrides: _overrides, ...rest } = node;
    // A detached instance remembers where it came from, so it can be found or restored later.
    const main = node.type === "instance" && node.componentId ? doc.nodes[node.componentId] : undefined;
    nodes[id] = { ...rest, type: "frame", ...(node.type === "instance" && node.componentId ? { detachedInfo: { componentId: node.componentId, componentKey: main?.libraryKey } } : {}) };
    if (node.type === "instance") {
        // A nested instance becomes a normal instance; its own contents still mirror its component,
        // keeping what the detached instance's component and the instance itself changed on them.
        const keepNested = (nested: SceneNode, componentId: string) => {
            const walk = (ids: string[]) => {
                for (const id of ids) {
                    const layer = doc.nodes[id];
                    if (!layer) continue;
                    if (layer.sourceId) {
                        const kept = inheritedOverrides(doc.nodes, id, componentId);
                        if (kept) nodes[id] = { ...layer, overrides: kept };
                    }
                    walk(layer.children);
                }
            };
            walk(nested.children);
        };
        const visit = (ids: string[]) => {
            for (const childId of ids) {
                const child = nodes[childId];
                if (!child) continue;
                const { sourceId: _source, overrides: _o, ...clean } = child;
                if (child.type === "instance" && child.componentId) {
                    const kept = (inheritedOverrides(doc.nodes, childId, child.componentId) ?? []).filter((k) => k !== "componentId");
                    // A size it was given by the outer instance (constraints when that was resized, or a
                    // layout) is its own once it stands alone, or it would snap back to its component's.
                    const own = doc.nodes[child.componentId];
                    if (own && child.w !== own.w && !kept.includes("w")) kept.push("w");
                    if (own && child.h !== own.h && !kept.includes("h")) kept.push("h");
                    nodes[childId] = kept.length ? { ...clean, overrides: kept } : clean;
                    keepNested(child, child.componentId);
                    continue;
                }
                nodes[childId] = clean;
                if (child.type !== "instance") visit(child.children);
            }
        };
        visit(node.children);
    }
    return { ...doc, nodes };
}
