import { resizeChildren } from "./constraints";
import type { ComponentProp, NagmaDocument, SceneNode } from "./types";

// Frames, components and instances all draw, clip and lay out the same way.
export function isFrameLike(node: SceneNode | undefined): boolean {
    return node?.type === "frame" || node?.type === "component" || node?.type === "componentSet" || node?.type === "instance";
}

// Whether a layer is part of an instance's contents (and so mirrors a component).
export function insideInstance(node: SceneNode | undefined): boolean {
    return Boolean(node?.sourceId);
}

// Properties an instance (or a layer inside one) may change without detaching. Position, size
// and structure always follow the main component.
export const OVERRIDABLE = new Set<string>([
    "name",
    "visible",
    "locked",
    "opacity",
    "fills",
    "strokes",
    "strokeWidth",
    "strokeAlign",
    "blendMode",
    "radius",
    "shadow",
    "blur",
    "text",
    "fontSize",
    "fontWeight",
    "fontFamily",
    "italic",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "textAlignV",
    "decoration",
    "spans",
    "paragraphs",
    "list",
    "listSpacing",
    "hangingList",
    "hangingPunctuation",
    "leadingTrim",
    "textCase",
    "textWrap",
    "openType",
    "fontVariations",
    "textStyleId",
    "clip",
    "layout",
    "sizing",
    // Prototype interactions come from the main component until an instance changes them.
    "interactions",
    "effects",
    "fillStyleId",
    "strokeStyleId",
    "textStyleId",
    "effectStyleId",
    // Nested instances: swapped to another component, or their own property values set.
    "componentId",
    "propValues",
    // Variables: a different mode for this copy, or a field bound to another variable.
    "variableModes",
    "boundVariables",
    // Size and geometry of a layer inside an instance (the reference keeps these per instance when the
    // instance is resized, and .fig import brings them in as overrides).
    "w",
    "h",
    "rotation",
    "flipX",
    "flipY",
    "path",
]);

// An instance's own size and placement can be changed too (swapping it isn't an override), and so
// can its web settings in a site (an instance's own link or interactions, such as Change to).
const INSTANCE_OVERRIDABLE = new Set<string>([...[...OVERRIDABLE].filter((key) => key !== "componentId"), "w", "h", "rotation", "flipX", "flipY", "site"]);

// Fields that never copy from the component onto a mirror.
const STRUCTURAL = new Set<string>(["id", "type", "parentId", "children", "componentId", "sourceId", "overrides", "x", "y", "propValues", "componentProps", "hiddenFromPublishing", "description", "descriptionMarkdown", "docLinks"]);

export function overridableFor(node: SceneNode): Set<string> {
    return node.type === "instance" && !node.sourceId ? INSTANCE_OVERRIDABLE : OVERRIDABLE;
}

// The id of a mirrored layer is derived from the instance and the source layer, so every copy of the
// document (and every collaborator) generates the same ids.
export function mirrorId(instanceId: string, sourceId: string): string {
    return `${instanceId};${sourceId}`;
}

function sameNode(a: SceneNode | undefined, b: SceneNode): boolean {
    if (!a) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SceneNode>;
    for (const key of keys) {
        const x = a[key];
        const y = b[key];
        if (x === y) continue;
        if (typeof x === "object" && typeof y === "object" && JSON.stringify(x) === JSON.stringify(y)) continue;
        return false;
    }
    return true;
}

// Copies a component property onto a mirror unless the mirror overrides it.
function inherit(source: SceneNode, mirror: SceneNode | undefined, base: SceneNode): SceneNode {
    const result: SceneNode = { ...base };
    const keep = new Set(mirror?.overrides ?? []);
    const record = result as unknown as Record<string, unknown>;
    const from = source as unknown as Record<string, unknown>;
    const old = (mirror ?? {}) as unknown as Record<string, unknown>;
    for (const key of Object.keys(from)) {
        if (STRUCTURAL.has(key)) continue;
        // An override also covers a property the copy doesn't have (a style link removed on it).
        if (keep.has(key) && !(key in old) && mirror) delete record[key];
        else record[key] = keep.has(key) && key in old ? old[key] : from[key];
    }
    for (const key of keep) if (!(key in from) && key in old) record[key] = old[key];
    return result;
}

// A component's properties: those of its component set (shared by every variant) and its own.
export function propsOf(doc: NagmaDocument, component: SceneNode | undefined): ComponentProp[] {
    if (!component) return [];
    const set = doc.nodes[component.parentId ?? ""];
    const fromSet = set?.type === "componentSet" ? (set.componentProps ?? []) : [];
    return [...fromSet, ...(component.componentProps ?? [])];
}

// Variables resolve through engine/variables.ts, which registers itself here (it depends on the
// editor store, which depends on this module, so it can't be imported directly).
let resolveVariable: (doc: NagmaDocument, id: string, node: SceneNode | null) => { value: string | number | boolean } | null = () => null;
export function setPropVariableResolver(fn: typeof resolveVariable) {
    resolveVariable = fn;
}

// The value an instance uses for a property: its own, else the default (or the default's variable).
export function propValue(doc: NagmaDocument, prop: ComponentProp, instance: SceneNode | undefined): boolean | string {
    const own = instance?.propValues?.[prop.id];
    if (own !== undefined) return own;
    if (prop.defaultVariable) {
        const r = resolveVariable(doc, prop.defaultVariable, instance ?? null);
        if (r && typeof r.value === typeof prop.defaultValue) return r.value as boolean | string;
    }
    return prop.defaultValue;
}

// Component properties: a mirrored layer bound to a property takes the instance's value for it
// (or the property's default), for visibility, text and nested-instance swaps.
function applyPropBindings(doc: NagmaDocument, mirror: SceneNode, source: SceneNode, component: SceneNode, instance: SceneNode) {
    const bindings = source.propBindings;
    if (!bindings) return;
    const props = propsOf(doc, component);
    const valueOf = (id: string | undefined) => {
        if (!id) return undefined;
        const prop = props.find((p) => p.id === id);
        return prop ? propValue(doc, prop, instance) : undefined;
    };
    const visible = valueOf(bindings.visible);
    if (typeof visible === "boolean" && !(mirror.overrides ?? []).includes("visible")) mirror.visible = visible;
    const text = valueOf(bindings.text);
    if (typeof text === "string" && mirror.type === "text" && !(mirror.overrides ?? []).includes("text")) mirror.text = text;
    const swap = valueOf(bindings.swap);
    if (typeof swap === "string" && swap && mirror.type === "instance" && doc.nodes[swap]?.type === "component") mirror.componentId = swap;
}

interface BuildContext {
    // Mirror ids are `${prefix};${sourceId}`.
    prefix: string;
    component: SceneNode;
    instance: SceneNode;
    dx: number;
    dy: number;
    depth: number;
}

// Rebuilds every instance's contents from its main component, keeping overrides. Runs after each edit.
// Instances nested inside other instances get their contents from the outer component's copy, so only
// "outermost" instances are rebuilt here; a few passes settle components that contain instances.
// A nested instance that was swapped (or whose properties were set) on this instance is rebuilt from
// its own component instead. A slot keeps the layers placed in it on this instance.
// Which instances an edit can affect: those whose own layers changed, and those using a component
// (directly, or through a nested instance) whose layers changed, following components that contain
// instances of changed components. Null when everything should be rebuilt.
function affectedInstances(doc: NagmaDocument, before: NagmaDocument | undefined): Set<string> | null {
    if (!before || before === doc) return before === doc ? new Set() : null;
    const changed: string[] = [];
    for (const id in doc.nodes) if (doc.nodes[id] !== before.nodes[id]) changed.push(id);
    const removed: string[] = [];
    for (const id in before.nodes) if (!doc.nodes[id]) removed.push(id);
    if (changed.length + removed.length > 20000) return null;
    const outer = new Map<string, string>(); // instance (or mirror instance) -> its outermost rebuilt instance
    const usersOf = new Map<string, Set<string>>(); // component -> outermost instances that use it
    const holderOf = new Map<string, string[]>(); // outermost instance -> components it sits in
    const ancestors = (nodes: Record<string, SceneNode>, id: string): SceneNode[] => {
        const out: SceneNode[] = [];
        let n: SceneNode | undefined = nodes[nodes[id]?.parentId ?? ""];
        while (n) {
            out.push(n);
            n = n.parentId ? nodes[n.parentId] : undefined;
        }
        return out;
    };
    for (const node of Object.values(doc.nodes)) {
        if (node.type !== "instance" || !node.componentId) continue;
        const chain = ancestors(doc.nodes, node.id);
        let owner = !node.sourceId ? node.id : "";
        if (!owner) for (const a of chain) if (a.type === "instance" && !a.sourceId) { owner = a.id; break; }
        if (!owner) continue;
        outer.set(node.id, owner);
        let set = usersOf.get(node.componentId);
        if (!set) usersOf.set(node.componentId, (set = new Set()));
        set.add(owner);
        if (owner === node.id) holderOf.set(owner, chain.filter((a) => a.type === "component").map((a) => a.id));
    }
    const dirty = new Set<string>();
    const dirtyComponents = new Set<string>();
    const mark = (nodes: Record<string, SceneNode>, id: string) => {
        const self = nodes[id];
        if (self?.type === "component") dirtyComponents.add(id);
        if (self?.type === "componentSet") for (const c of self.children) dirtyComponents.add(c);
        if (self?.type === "instance" && !self.sourceId) dirty.add(id);
        for (const a of ancestors(nodes, id)) {
            if (a.type === "component") dirtyComponents.add(a.id);
            if (a.type === "instance" && !a.sourceId) dirty.add(a.id);
        }
    };
    for (const id of changed) mark(doc.nodes, id);
    for (const id of removed) mark(before.nodes, id);
    const queue = [...dirtyComponents];
    for (let i = 0; i < queue.length; i++) {
        for (const inst of usersOf.get(queue[i] as string) ?? []) {
            dirty.add(inst);
            for (const comp of holderOf.get(inst) ?? []) {
                if (dirtyComponents.has(comp)) continue;
                dirtyComponents.add(comp);
                queue.push(comp);
            }
        }
    }
    return dirty;
}

export function syncInstances(doc: NagmaDocument, before?: NagmaDocument): NagmaDocument {
    const affected = affectedInstances(doc, before);
    const instances = Object.values(doc.nodes).filter((node) => node.type === "instance" && !node.sourceId && node.componentId && (!affected || affected.has(node.id)));
    if (instances.length === 0) return doc;
    let nodes = doc.nodes;
    let changed = false;
    for (let pass = 0; pass < 4; pass++) {
        let passChanged = false;
        for (const stale of instances) {
            const instance = nodes[stale.id];
            const component = instance?.componentId ? nodes[instance.componentId] : undefined;
            if (!instance || !component || component.type !== "component") continue;
            const next: Record<string, SceneNode> = {};
            const keepIds = new Set<string>();
            const working = { ...doc, nodes };

            // The instance itself: component styling unless overridden; its own place in the tree.
            const self = inherit(component, instance, instance);
            self.propValues = instance.propValues;
            // Variants are named "Size=Large, …"; instances show the set's name instead.
            if (!(instance.overrides ?? []).includes("name")) self.name = assetName(working, component.id);
            const keepTree = (id: string) => {
                keepIds.add(id);
                for (const child of nodes[id]?.children ?? []) keepTree(child);
            };
            const build = (sourceIds: string[], parentId: string, ctx: BuildContext): string[] =>
                sourceIds.flatMap((sourceId) => {
                    const source = nodes[sourceId];
                    if (!source) return [];
                    const id = mirrorId(ctx.prefix, sourceId);
                    keepIds.add(id);
                    const existing = nodes[id];
                    const kept = existing?.overrides ?? [];
                    const base: SceneNode = {
                        ...source,
                        id,
                        parentId,
                        sourceId,
                        overrides: kept,
                        x: source.x + ctx.dx,
                        y: source.y + ctx.dy,
                        children: [],
                    };
                    let mirror = inherit(source, existing, base);
                    // A layer moved inside this instance keeps its place (x/y overrides).
                    if (existing && kept.includes("x")) mirror.x = existing.x;
                    if (existing && kept.includes("y")) mirror.y = existing.y;
                    applyPropBindings(working, mirror, source, ctx.component, ctx.instance);
                    if (existing && kept.includes("propValues")) mirror.propValues = existing.propValues;
                    if (existing?.componentId && kept.includes("componentId") && nodes[existing.componentId]?.type === "component") mirror.componentId = existing.componentId;
                    // A swapped nested instance (or one with its own property values) mirrors its own component.
                    const inner = mirror.type === "instance" && mirror.componentId ? nodes[mirror.componentId] : undefined;
                    if (inner?.type === "component" && ctx.depth < 8 && (mirror.componentId !== source.componentId || kept.includes("propValues"))) {
                        if (mirror.componentId !== source.componentId) {
                            // Styling and size come from the new component, keeping this copy's overrides.
                            const restyled = inherit(inner, existing, { ...mirror, w: inner.w, h: inner.h });
                            restyled.componentId = mirror.componentId;
                            restyled.propValues = mirror.propValues;
                            restyled.name = (kept.includes("name") && existing?.name) || assetName(working, inner.id);
                            mirror = restyled;
                        }
                        mirror.children = build(inner.children, id, { prefix: id, component: inner, instance: mirror, dx: mirror.x - inner.x, dy: mirror.y - inner.y, depth: ctx.depth + 1 });
                        next[id] = mirror;
                        return [id];
                    }
                    // A slot: once layers are placed in it on this instance, they're this copy's own.
                    if (source.propBindings?.slot && existing) {
                        const owned = existing.children.filter((c) => nodes[c] && !nodes[c]?.sourceId);
                        if (owned.length || kept.includes("children")) {
                            const content = existing.children.filter((c) => nodes[c]);
                            if (!kept.includes("children")) {
                                // First change: the default content becomes this instance's own layers.
                                mirror.overrides = [...kept, "children"];
                                for (const c of content) ownSubtree(nodes, next, c);
                            }
                            content.forEach(keepTree);
                            mirror.children = content;
                            next[id] = mirror;
                            return [id];
                        }
                    }
                    mirror.children = build(source.children, id, ctx);
                    next[id] = mirror;
                    return [id];
                });
            self.children = build(component.children, instance.id, { prefix: instance.id, component, instance: self, dx: instance.x - component.x, dy: instance.y - component.y, depth: 0 });
            next[instance.id] = self;
            // A resized instance arranges its contents by their constraints, like a resized frame.
            if (!self.layout && (self.w !== component.w || self.h !== component.h)) {
                const resizing: Record<string, SceneNode> = { ...nodes, ...next };
                resizeChildren(resizing, instance.id, { x: instance.x, y: instance.y, w: component.w, h: component.h }, { x: instance.x, y: instance.y, w: self.w, h: self.h });
                for (const id of keepIds) {
                    const node = resizing[id];
                    if (node) next[id] = node;
                }
            }

            // Drop layers that no longer exist in the component.
            const stale_: string[] = [];
            const walk = (ids: string[]) => {
                for (const id of ids) {
                    if (!keepIds.has(id)) stale_.push(id);
                    walk(nodes[id]?.children ?? []);
                }
            };
            walk(instance.children);

            const updates = Object.values(next).filter((node) => !sameNode(nodes[node.id], node));
            if (updates.length === 0 && stale_.length === 0) continue;
            nodes = { ...nodes };
            for (const node of updates) nodes[node.id] = node;
            for (const id of stale_) delete nodes[id];
            passChanged = true;
            changed = true;
        }
        if (!passChanged) break;
    }
    return changed ? { ...doc, nodes } : doc;
}

// Turns mirrored layers into the instance's own (as detaching does): they stop following the
// component. Nested instances stay instances and keep mirroring their own components.
function ownSubtree(nodes: Record<string, SceneNode>, next: Record<string, SceneNode>, id: string) {
    const node = next[id] ?? nodes[id];
    if (!node) return;
    const { sourceId: _source, overrides: _overrides, ...clean } = node;
    next[id] = { ...clean, overrides: [] } as SceneNode;
    if (node.type === "instance") {
        delete next[id]?.overrides;
        return;
    }
    for (const child of node.children) ownSubtree(nodes, next, child);
}

// A nested instance whose outer instance is detached becomes an instance of its own, rebuilt from its
// component alone: what the outer component (and the outer instance) changed on it and its layers must
// become its own overrides, or detaching would undo them. For each layer of the nested instance, the
// overrides along its source chain up to the layer it will mirror (inside `componentId`).
export function inheritedOverrides(nodes: Record<string, SceneNode>, id: string, componentId: string): string[] | undefined {
    const inside = (nodeId: string) => {
        let current: SceneNode | undefined = nodes[nodeId];
        while (current) {
            if (current.id === componentId) return true;
            current = current.parentId ? nodes[current.parentId] : undefined;
        }
        return false;
    };
    const keys = new Set<string>();
    let found = false;
    let current: SceneNode | undefined = nodes[id];
    for (let depth = 0; current && depth < 16 && !inside(current.id); depth++) {
        if (current.overrides) {
            found = true;
            for (const key of current.overrides) keys.add(key);
        }
        current = current.sourceId ? nodes[current.sourceId] : undefined;
    }
    return found ? [...keys] : undefined;
}

// Ids of every main component in the document, for pickers.
export function allComponents(doc: NagmaDocument): SceneNode[] {
    return Object.values(doc.nodes).filter((node) => node.type === "component");
}

// What the assets panel offers: standalone components, and each component set once.
export function reusableAssets(doc: NagmaDocument): SceneNode[] {
    return Object.values(doc.nodes).filter(
        (node) => node.type === "componentSet" || (node.type === "component" && doc.nodes[node.parentId ?? ""]?.type !== "componentSet"),
    );
}

// "Size=Large, State=Hover" → { Size: "Large", State: "Hover" }. A plain name is one "Variant" value.
export function variantProps(name: string): Record<string, string> {
    const props: Record<string, string> = {};
    if (!name.includes("=")) return { Variant: name.trim() };
    for (const part of name.split(",")) {
        const [key, ...rest] = part.split("=");
        const k = key?.trim();
        if (k) props[k] = rest.join("=").trim();
    }
    return props;
}

export function variantName(props: Record<string, string>): string {
    return Object.entries(props)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
}

// Every property in a set, with its values in the order they first appear.
export function setProperties(doc: NagmaDocument, setId: string): [string, string[]][] {
    const set = doc.nodes[setId];
    const props = new Map<string, string[]>();
    for (const id of set?.children ?? []) {
        const child = doc.nodes[id];
        if (child?.type !== "component") continue;
        for (const [key, value] of Object.entries(variantProps(child.name))) {
            const values = props.get(key) ?? [];
            if (!values.includes(value)) values.push(value);
            props.set(key, values);
        }
    }
    return [...props.entries()];
}

// The variant in a set closest to the wanted properties (all match, else the most matches).
export function findVariant(doc: NagmaDocument, setId: string, wanted: Record<string, string>): string | null {
    let best: string | null = null;
    let bestScore = -1;
    for (const id of doc.nodes[setId]?.children ?? []) {
        const child = doc.nodes[id];
        if (child?.type !== "component") continue;
        const props = variantProps(child.name);
        const score = Object.entries(wanted).filter(([key, value]) => props[key] === value).length;
        if (score > bestScore) {
            best = id;
            bestScore = score;
        }
    }
    return best;
}

// The display name for an instance: its set's name for variants, else the component's.
export function assetName(doc: NagmaDocument, componentId: string | undefined): string {
    const component = componentId ? doc.nodes[componentId] : undefined;
    if (!component) return "Missing component";
    const parent = doc.nodes[component.parentId ?? ""];
    return parent?.type === "componentSet" ? parent.name : component.name;
}

// Whether placing an instance of `componentId` inside `parentId` would put a component inside itself:
// directly (the destination is in that component), or through instances (the component contains,
// at any depth, an instance of a component the destination is in).
export function wouldNestItself(doc: NagmaDocument, componentId: string, parentId: string | null): boolean {
    const hosts = new Set<string>();
    let current = parentId ? doc.nodes[parentId] : undefined;
    while (current) {
        if (current.id === componentId) return true;
        if (current.type === "component") hosts.add(current.id);
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    if (!hosts.size) return false;
    const seen = new Set<string>();
    const reaches = (id: string): boolean => {
        if (hosts.has(id)) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        const visit = (nodeId: string): boolean => {
            const node = doc.nodes[nodeId];
            if (!node) return false;
            if (node.type === "instance" && node.componentId && reaches(node.componentId)) return true;
            return node.children.some(visit);
        };
        return (doc.nodes[id]?.children ?? []).some(visit);
    };
    return reaches(componentId);
}

// Whether moving layer `id` (with everything inside it) into `parentId` would put a component inside
// itself: any instance in the moved layers whose component would then contain itself.
export function moveWouldNestItself(doc: NagmaDocument, id: string, parentId: string | null): boolean {
    const check = (nodeId: string): boolean => {
        const node = doc.nodes[nodeId];
        if (!node) return false;
        if (node.type === "instance" && node.componentId && wouldNestItself(doc, node.componentId, parentId)) return true;
        return node.children.some(check);
    };
    return check(id);
}
