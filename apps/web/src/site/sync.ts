import { addSettler } from "../engine/commands";
import { imagePaint } from "../engine/paint";
import type { NagmaDocument, SceneNode } from "../engine/types";
import { BP_COPY, bpData, bpFrames, collectionsOf, fieldText, libraryPage, mirrorIdFor, pageData, parentBreakpoint, PRIMARY_BP, webData } from "./model";
import type { BreakpointId, Collection, CollectionItem, SiteNodeData } from "./types";

// Keeps a site's derived layers in step after every edit, local or from collaborators (it runs in
// the engine's settle pass, so undo, sync and version history see its results as ordinary changes):
//
// - Breakpoints. Every breakpoint other than the primary (desktop) holds copies of the desktop layers
//   (ids "<desktop id>@<bp>"). Changes cascade from wider to narrower: desktop to the widest other
//   breakpoint, that one to the next, and so on. A change reaches a copy unless that copy changed
//   the property itself (its overrides, kept in site.ov), so what Tablet changes also reaches Mobile
//   unless Mobile changed it too. Editing a copy records the override. Deleting a copy hides it on
//   that breakpoint only. Layers added straight to a breakpoint's frame belong to it alone.
// - CMS. A collection list repeats its first child (the template) once per item; the copies are
//   derived layers ("<template layer>~<item>") the editor rebuilds. Layers bound to a field show the
//   item's value (the template shows the first item; an item page shows its preview item).

// Never copied between breakpoints. Geometry on the breakpoint frames is their own.
const NOSYNC = new Set(["id", "parentId", "children", "site", "overrides", "locked"]);
const ROOT_NOSYNC = new Set([...NOSYNC, "x", "y", "w", "h", "name"]);

type Nodes = Record<string, SceneNode>;

const same = (a: unknown, b: unknown) => a === b || (typeof a === "object" && typeof b === "object" && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

// The web data minus what links copies (compared and copied as one property, "site").
function ownWeb(node: SceneNode | undefined): SiteNodeData {
    const { src: _src, ov: _ov, rep: _rep, ...rest } = webData(node);
    return rest;
}

// The desktop layer a breakpoint copy follows: from its web data, or (for instances, whose web data
// comes from their component) from its id.
export function sourceIdOf(nodes: Record<string, SceneNode>, copy: SceneNode | undefined): string | null {
    if (!copy) return null;
    const src = webData(copy).src;
    if (src && nodes[src]) return src;
    const m = BP_COPY.exec(copy.id);
    return m && m[1] && nodes[m[1]] && !m[1].includes(";") ? m[1] : null;
}

function inside(nodes: Nodes, id: string, ancestor: string): boolean {
    let node: SceneNode | undefined = nodes[id];
    while (node) {
        if (node.id === ancestor) return true;
        node = node.parentId ? nodes[node.parentId] : undefined;
    }
    return false;
}

// Position and size an auto layout works out are not the designer's to override.
function layoutOwned(nodes: Nodes, node: SceneNode, key: string): boolean {
    const parent = node.parentId ? nodes[node.parentId] : undefined;
    if (key === "x" || key === "y") return Boolean(parent?.layout) && node.positioning !== "absolute";
    if (key === "w") return node.sizing.h !== "fixed" || Boolean(parent?.layout?.grid);
    if (key === "h") return node.sizing.v !== "fixed" || Boolean(parent?.layout?.grid);
    return false;
}

// What a copy's property should be, following its primary layer.
function expected(nodes: Nodes, source: SceneNode, copy: SceneNode, key: string): unknown {
    if (key === "x" || key === "y") {
        const sp = source.parentId ? nodes[source.parentId] : undefined;
        const cp = copy.parentId ? nodes[copy.parentId] : undefined;
        if (!sp || !cp) return source[key];
        return cp[key] + (source[key] - sp[key]);
    }
    return (source as unknown as Record<string, unknown>)[key];
}

function subtreeIds(nodes: Nodes, id: string, out: string[] = []): string[] {
    const node = nodes[id];
    if (!node) return out;
    out.push(id);
    for (const c of node.children) subtreeIds(nodes, c, out);
    return out;
}

function syncSite(before: NagmaDocument, raw: NagmaDocument): NagmaDocument {
    if (!raw.site) return raw;
    const changed: string[] = [];
    for (const id in raw.nodes) if (raw.nodes[id] !== before.nodes[id]) changed.push(id);
    const removed: string[] = [];
    for (const id in before.nodes) if (!raw.nodes[id]) removed.push(id);
    if (!changed.length && !removed.length) return raw;
    const nodes: Nodes = { ...raw.nodes };
    let dirty = false;
    const changedSet = new Set(changed);
    // What one breakpoint's pass changes is a change for the narrower breakpoints after it.
    const put = (node: SceneNode) => {
        nodes[node.id] = node;
        changedSet.add(node.id);
        dirty = true;
    };

    for (const pageId of raw.roots) {
        const page = nodes[pageId];
        if (!pageData(page) || !page) continue;
        const frames: { bp: BreakpointId; node: SceneNode; min: number }[] = [];
        for (const id of page.children) {
            const data = bpData(nodes[id]);
            if (data && nodes[id] && !frames.some((f) => f.bp === data.bp)) frames.push({ bp: data.bp, node: nodes[id] as SceneNode, min: data.min ?? (data.bp === "tablet" ? 768 : (nodes[id] as SceneNode).w) });
        }
        const primary = frames.find((f) => f.bp === PRIMARY_BP)?.node;
        if (!primary) continue;
        // Only pages with changes need a pass.
        const touches = (id: string, map: Nodes) => {
            let n: SceneNode | undefined = map[id];
            while (n) {
                if (n.id === pageId) return true;
                n = n.parentId ? map[n.parentId] : undefined;
            }
            return false;
        };
        if (!changed.some((id) => touches(id, nodes)) && !removed.some((id) => touches(id, before.nodes))) continue;
        // Widest first, each following the one before it.
        const order = frames.filter((f) => f.bp !== PRIMARY_BP).sort((a, b) => b.min - a.min || b.node.w - a.node.w);
        let parent: { bp: BreakpointId; id: string } = { bp: PRIMARY_BP, id: primary.id };
        for (const f of order) {
            syncBreakpoint(before, nodes, put, changedSet, removed, primary.id, parent, f.node.id, f.bp);
            parent = { bp: f.bp, id: f.node.id };
        }
    }
    if (syncCms(before, nodes, put, changed, removed)) dirty = true;
    return dirty ? { ...raw, nodes } : raw;
}

function syncBreakpoint(before: NagmaDocument, nodes: Nodes, put: (n: SceneNode) => void, changed: Set<string>, removed: string[], primaryId: string, parentBp: { bp: BreakpointId; id: string }, mirrorRootId: string, bp: BreakpointId) {
    // The parent breakpoint's layer → this breakpoint's copy of it (null for layers the parent
    // breakpoint has alone, which stay there).
    const primary = { id: parentBp.id };
    const baseOf = (id: string): string | null => {
        if (parentBp.bp === PRIMARY_BP) return id;
        const suffix = `@${parentBp.bp}`;
        return id.endsWith(suffix) && !id.includes(";") ? id.slice(0, -suffix.length) : null;
    };
    const midOrNull = (id: string): string | null => {
        if (id === primary.id) return mirrorRootId;
        const base = baseOf(id);
        return base ? mirrorIdFor(base, bp) : null;
    };
    const mid = (id: string) => midOrNull(id) ?? `${id}@${bp}`;
    const sourceOf = (copy: SceneNode): SceneNode | undefined => {
        if (copy.id === mirrorRootId) return nodes[primary.id];
        const base = sourceIdOf(nodes, copy);
        if (!base) return undefined;
        return parentBp.bp === PRIMARY_BP ? nodes[base] : (nodes[mirrorIdFor(base, parentBp.bp)] ?? nodes[base]);
    };
    // An instance's own changes are also kept by the engine (its overrides), since its web data
    // follows its component.
    const ovOf = (copy: SceneNode): string[] => (copy.id === mirrorRootId ? (bpData(copy)?.ov ?? []) : copy.type === "instance" ? [...(webData(copy).ov ?? []), ...(copy.overrides ?? [])] : (webData(copy).ov ?? []));
    const withOv = (copy: SceneNode, ov: string[]): SceneNode => (copy.id === mirrorRootId ? { ...copy, site: { ...(bpData(copy) ?? { kind: "bp", bp }), ov } } : { ...copy, site: { ...webData(copy), ov } });
    void primaryId;

    // 1. Edits made on this breakpoint become its overrides.
    for (const id of changed) {
        const copy = nodes[id];
        const old = before.nodes[id];
        if (!copy || !old || !inside(nodes, id, mirrorRootId)) continue;
        const source = sourceOf(copy);
        if (!source || webData(copy).rep) continue;
        const root = id === mirrorRootId;
        const ov = new Set(ovOf(copy));
        const size = ov.size;
        const keys = new Set([...Object.keys(copy), ...Object.keys(old)]);
        for (const key of keys) {
            if ((root ? ROOT_NOSYNC : NOSYNC).has(key)) continue;
            const now = (copy as unknown as Record<string, unknown>)[key];
            if (same(now, (old as unknown as Record<string, unknown>)[key])) continue;
            if (layoutOwned(nodes, copy, key)) continue;
            if (!same(now, expected(nodes, source, copy, key))) ov.add(key);
        }
        if (!root && !same(ownWeb(copy), ownWeb(old)) && !same(ownWeb(copy), ownWeb(source))) ov.add("site");
        // Children reordered here (or added only here) stop following desktop's order.
        if (!same(copy.children, old.children) && copy.children.some((c) => !webData(nodes[c]).src && !webData(nodes[c]).rep && nodes[c])) ov.add("children");
        if (ov.size !== size) put(withOv(copy, [...ov]));
    }

    // 2. A copy deleted here (while its desktop layer stays) comes back hidden on this breakpoint.
    for (const id of removed) {
        const old = before.nodes[id];
        const src = sourceIdOf(before.nodes, old);
        if (!old || !src || !nodes[src] || nodes[id] || !old.parentId) continue;
        const parent = nodes[old.parentId];
        if (!parent || !inside(nodes, parent.id, mirrorRootId)) continue;
        // Bring back the whole removed branch.
        for (const sub of subtreeIds(before.nodes, id)) if (!nodes[sub] && before.nodes[sub]) put(before.nodes[sub] as SceneNode);
        const ov = new Set(webData(old).ov ?? []);
        ov.add("visible");
        put({ ...old, visible: false, site: { ...webData(old), ov: [...ov] } });
        const index = before.nodes[old.parentId]?.children.indexOf(id) ?? parent.children.length;
        const children = parent.children.filter((c) => c !== id);
        children.splice(Math.min(Math.max(index, 0), children.length), 0, id);
        put({ ...parent, children });
    }

    // 3. Desktop layers removed: their copies go too.
    for (const id of removed) {
        const old = before.nodes[id];
        if (!old || !inside(before.nodes, id, primary.id) || id === primary.id) continue;
        const copyId = midOrNull(id);
        const copy = copyId ? nodes[copyId] : undefined;
        if (!copy || !copyId) continue;
        for (const sub of subtreeIds(nodes, copyId)) {
            delete nodes[sub];
            // Narrower breakpoints lose their copies of it in their own pass.
            removed.push(sub);
        }
        const parent = copy.parentId ? nodes[copy.parentId] : undefined;
        if (parent) put({ ...parent, children: parent.children.filter((c) => c !== copyId) });
    }

    // 4. Desktop to this breakpoint, top down so parents exist before their children.
    const visit = (sourceId: string) => {
        const source = nodes[sourceId];
        if (!source) return;
        const isRoot = sourceId === primary.id;
        const maybe = midOrNull(sourceId);
        if (!maybe) return;
        const copyId = maybe;
        const base = isRoot ? sourceId : (baseOf(sourceId) as string);
        let copy = nodes[copyId];
        const old = before.nodes[sourceId];
        if (!isRoot && webData(source).rep) return;
        if (!copy) {
            const parentId = source.parentId ? mid(source.parentId) : null;
            const parent = parentId ? nodes[parentId] : undefined;
            if (!parent) return;
            copy = makeCopy(nodes, source, copyId, parent, base);
            put(copy);
            if (!parent.children.includes(copyId)) {
                const siblings = nodes[source.parentId as string]?.children ?? [];
                const at = siblings.indexOf(sourceId);
                const children = [...parent.children];
                // After the copy of the sibling just before it, else first.
                const prev = at > 0 ? children.indexOf(mid(siblings[at - 1] as string)) : -1;
                children.splice(prev + 1, 0, copyId);
                put({ ...parent, children });
            }
        } else if (changed.has(sourceId) && old) {
            const ov = new Set(ovOf(copy));
            const next = { ...copy } as unknown as Record<string, unknown>;
            let any = false;
            const keys = new Set([...Object.keys(source), ...Object.keys(old)]);
            for (const key of keys) {
                if ((isRoot ? ROOT_NOSYNC : NOSYNC).has(key) || ov.has(key)) continue;
                const now = (source as unknown as Record<string, unknown>)[key];
                if (same(now, (old as unknown as Record<string, unknown>)[key])) continue;
                const value = expected(nodes, source, copy, key);
                if (value === undefined) delete next[key];
                else next[key] = value;
                any = true;
            }
            if (!isRoot && !ov.has("site") && !same(ownWeb(source), ownWeb(old))) {
                next.site = { ...ownWeb(source), src: base, ov: [...ov] };
                any = true;
            }
            if (any) {
                copy = next as unknown as SceneNode;
                put(copy);
            }
            // Moved to another parent on desktop.
            if (!isRoot && source.parentId && copy.parentId !== mid(source.parentId) && nodes[mid(source.parentId)]) {
                const from = copy.parentId ? nodes[copy.parentId] : undefined;
                if (from) put({ ...from, children: from.children.filter((c) => c !== copyId) });
                const to = nodes[mid(source.parentId)] as SceneNode;
                const siblings = nodes[source.parentId]?.children ?? [];
                const at = siblings.indexOf(sourceId);
                const children = to.children.filter((c) => c !== copyId);
                const prev = at > 0 ? children.indexOf(mid(siblings[at - 1] as string)) : -1;
                children.splice(prev + 1, 0, copyId);
                put({ ...to, children });
                copy = { ...(nodes[copyId] as SceneNode), parentId: to.id };
                put(copy);
            }
        }
        // Instances fill themselves from their component; component copies are instances of it.
        if (source.type === "instance" || source.type === "component") return;
        for (const child of source.children) visit(child);
        // Children in desktop's order, keeping layers added only here where they were.
        const current = nodes[copyId];
        if (current && !ovOf(current).includes("children") && (changed.has(sourceId) || !old)) {
            const wanted = source.children
                .filter((c) => !webData(nodes[c]).rep)
                .map((c) => midOrNull(c))
                .filter((c): c is string => Boolean(c) && nodes[c as string]?.parentId === copyId);
            const extras = current.children.filter((c) => !wanted.includes(c) && nodes[c]);
            const order = [...wanted];
            for (const extra of extras) {
                const at = current.children.indexOf(extra);
                order.splice(Math.min(at, order.length), 0, extra);
            }
            if (!same(order, current.children)) put({ ...current, children: order });
        }
    };
    visit(primary.id);
}

// A new copy of a desktop layer for a breakpoint (its children are copied as the walk reaches them).
function makeCopy(nodes: Nodes, source: SceneNode, id: string, parent: SceneNode, primaryId: string): SceneNode {
    const sp = source.parentId ? nodes[source.parentId] : undefined;
    const x = sp ? parent.x + (source.x - sp.x) : source.x;
    const y = sp ? parent.y + (source.y - sp.y) : source.y;
    const site = { ...ownWeb(source), src: primaryId, ov: [] as string[] };
    if (source.type === "component") {
        return { ...source, id, type: "instance", componentId: source.id, overrides: [], parentId: parent.id, children: [], x, y, site, componentProps: undefined, description: undefined } as SceneNode;
    }
    return { ...source, id, parentId: parent.id, children: [], x, y, site, ...(source.type === "instance" ? { overrides: [...(source.overrides ?? [])] } : {}) };
}

// ---- CMS ----

function syncCms(before: NagmaDocument, nodes: Nodes, put: (n: SceneNode) => void, changed: string[], removed: string[]): boolean {
    const doc = { ...before, nodes } as NagmaDocument;
    const lib = libraryPage(doc);
    const libChanged = Boolean(lib && changed.includes(lib.id));
    const collections = collectionsOf(doc);
    let any = false;
    const changedOrRemoved = [...changed, ...removed];
    // Lists anywhere in the site.
    const lists = Object.values(nodes).filter((n) => webData(n).list && !webData(n).rep);
    for (const list of lists) {
        const relevant = libChanged || changedOrRemoved.some((id) => (nodes[id] || before.nodes[id]) && (inside(nodes, id, list.id) || inside(before.nodes, id, list.id)));
        if (!relevant) continue;
        if (fillList(nodes, put, list.id, collections)) any = true;
    }
    // Item pages: bound layers show the preview item.
    for (const node of Object.values(nodes)) {
        const data = pageData(node);
        if (!data?.collectionId || !node) continue;
        const relevant = libChanged || changed.some((id) => inside(nodes, id, node.id));
        if (!relevant) continue;
        const collection = collections.find((c) => c.id === data.collectionId);
        const item = collection?.items.find((i) => i.id === data.previewItem) ?? collection?.items[0];
        if (!collection || !item) continue;
        const walk = (id: string) => {
            const n = nodes[id];
            if (!n || webData(n).list) return;
            if (bindNode(nodes, put, n, collection, item)) any = true;
            n.children.forEach(walk);
        };
        node.children.forEach(walk);
    }
    return any;
}

// Shows an item's values in the bound layers of one node (not its children).
function bindNode(nodes: Nodes, put: (n: SceneNode) => void, node: SceneNode, collection: Collection, item: CollectionItem): boolean {
    const bind = webData(node).bind;
    if (!bind) return false;
    const field = bind.field === "slug" ? null : collection.fields.find((f) => f.id === bind.field);
    if (bind.field !== "slug" && !field) return false;
    if (node.type === "text" || field?.type !== "image") {
        if (node.type !== "text") return false;
        const text = fieldText(collection, item, bind.field) || " ";
        if (node.text === text) return false;
        put({ ...(nodes[node.id] as SceneNode), text, spans: undefined, paragraphs: undefined });
        return true;
    }
    const image = item.values[field.id];
    if (!image) return false;
    const fills = node.fills.some((f) => f.type === "image") ? node.fills.map((f) => (f.type === "image" ? { ...f, id: image } : f)) : [...node.fills, imagePaint(image, "fill")];
    if (same(fills, node.fills)) return false;
    put({ ...(nodes[node.id] as SceneNode), fills });
    return true;
}

// Rebuilds a list's copies of its template, one per item after the first.
function fillList(nodes: Nodes, put: (n: SceneNode) => void, listId: string, collections: Collection[]): boolean {
    const list = nodes[listId];
    const spec = webData(list).list;
    if (!list || !spec) return false;
    const collection = collections.find((c) => c.id === spec.collectionId);
    const templateId = list.children.find((c) => nodes[c] && !webData(nodes[c]).rep);
    const items = (collection?.items ?? []).slice(0, spec.limit && spec.limit > 0 ? spec.limit : undefined);
    let any = false;
    const keep = new Set<string>();
    const repeats: string[] = [];
    if (templateId && collection) {
        // The template shows the first item.
        const first = items[0];
        if (first) {
            const walk = (id: string) => {
                const n = nodes[id];
                if (!n) return;
                if (bindNode(nodes, put, n, collection, first)) any = true;
                if (n.type !== "instance") n.children.forEach(walk);
            };
            walk(templateId);
        }
        for (const item of items.slice(1)) {
            const copy = (id: string, parentId: string, root: boolean): string => {
                const src = nodes[id] as SceneNode;
                const cid = `${id}~${item.id}`;
                keep.add(cid);
                const children = src.type === "instance" ? [] : src.children.filter((c) => nodes[c]).map((c) => copy(c, cid, false));
                const base: SceneNode = {
                    ...src,
                    id: cid,
                    parentId,
                    children: src.type === "instance" ? (nodes[cid]?.children ?? []) : children,
                    locked: root ? true : src.locked,
                    site: { ...webData(src), src: undefined, ov: undefined, rep: { of: id, item: item.id } },
                };
                if (root && nodes[cid]) {
                    // Keep where layout put it, so the copy doesn't jump about.
                    base.x = (nodes[cid] as SceneNode).x;
                    base.y = (nodes[cid] as SceneNode).y;
                }
                const bound = { ...base };
                const scratch = { [cid]: bound } as Nodes;
                bindNode(scratch, (n) => (scratch[cid] = n), bound, collection, item);
                const final = scratch[cid] as SceneNode;
                if (!same(nodes[cid], final)) {
                    put(final);
                    any = true;
                }
                return cid;
            };
            repeats.push(copy(templateId, listId, true));
        }
        // Instances inside the copies keep the children the engine gave them.
        for (const id of [...keep]) for (const c of nodes[id]?.type === "instance" ? (nodes[id]?.children ?? []) : []) markKeep(nodes, c, keep);
    }
    // Copies for items that are gone.
    const stale = Object.keys(nodes).filter((id) => {
        const rep = webData(nodes[id]).rep;
        return rep && !keep.has(id) && inside(nodes, id, listId) && !id.includes(";");
    });
    for (const id of stale) {
        delete nodes[id];
        any = true;
    }
    const current = nodes[listId] as SceneNode;
    const children = [...current.children.filter((c) => nodes[c] && !webData(nodes[c]).rep), ...repeats];
    if (!same(children, current.children)) {
        put({ ...current, children });
        any = true;
    }
    return any;
}

function markKeep(nodes: Nodes, id: string, keep: Set<string>) {
    keep.add(id);
    for (const c of nodes[id]?.children ?? []) markKeep(nodes, c, keep);
}

addSettler(syncSite);

// Puts a breakpoint copy back in step with the breakpoint it follows (the next wider one): the given
// overridden properties (all of them by default) take that breakpoint's values again, and follow it
// from now on.
export function resetOverridesCommand(doc: NagmaDocument, copyId: string, keys?: string[]): import("../engine/types").Command | null {
    const nodes = doc.nodes;
    const copy = nodes[copyId];
    if (!copy) return null;
    const root = bpData(copy);
    let frame: SceneNode | undefined = copy;
    while (frame && !bpData(frame)) frame = frame.parentId ? nodes[frame.parentId] : undefined;
    const bp = bpData(frame)?.bp;
    const pageId = frame?.parentId;
    if (!bp || !pageId || bp === PRIMARY_BP) return null;
    const parentBp = parentBreakpoint(doc, pageId, bp) ?? PRIMARY_BP;
    const parentFrame = bpFrames(doc, pageId)[parentBp];
    let source: SceneNode | undefined;
    if (root) source = parentFrame;
    else {
        const base = sourceIdOf(nodes, copy);
        source = base ? (parentBp === PRIMARY_BP ? nodes[base] : (nodes[mirrorIdFor(base, parentBp)] ?? nodes[base])) : undefined;
    }
    if (!source) return null;
    const ov = root ? (root.ov ?? []) : (webData(copy).ov ?? []);
    const reset = keys ?? ov;
    if (!reset.length) return null;
    const patch: Record<string, unknown> = {};
    const toHere = (id: string) => {
        if (id === parentFrame?.id) return frame?.id ?? id;
        const m = BP_COPY.exec(id);
        const base = parentBp === PRIMARY_BP ? id : m && m[2] === parentBp ? m[1] : null;
        return base ? mirrorIdFor(base, bp) : "";
    };
    for (const key of reset) {
        if (key === "site") continue;
        if (key === "children") {
            const wanted = source.children.map(toHere).filter((c) => c && nodes[c]?.parentId === copyId);
            patch.children = [...wanted, ...copy.children.filter((c) => !wanted.includes(c))];
            continue;
        }
        patch[key] = expected(nodes, source, copy, key);
    }
    const left = ov.filter((k) => !reset.includes(k));
    const primaryId = sourceIdOf(nodes, copy) ?? source.id;
    if (root) patch.site = { ...root, ov: left };
    else patch.site = reset.includes("site") ? { ...ownWeb(source), src: primaryId, ov: left } : { ...webData(copy), ov: left };
    return { type: "node.update", id: copyId, patch: patch as Partial<SceneNode> };
}
