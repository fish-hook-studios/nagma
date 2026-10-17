import { nanoid } from "nanoid";
import { rehome, siblingsOf } from "./actions";
import { applyCommand } from "./commands";
import { isFrameLike, propsOf, setProperties, variantName, variantProps, wouldNestItself } from "./components";
import { makeNode } from "./nodes";
import { editor } from "./store";
import type { Command, ComponentProp, NagmaDocument, SceneNode } from "./types";

// Design system actions on components and instances: properties (create, edit, bind), pushing and
// resetting instance overrides, combining components as variants, nested instances and slots.

// ---- Where properties live ----

// The component a layer belongs to (itself when it is one), walking up.
export function owningComponent(doc: NagmaDocument, node: SceneNode | undefined): SceneNode | undefined {
    let current = node;
    while (current) {
        if (current.type === "component") return current;
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return undefined;
}

// Properties are kept on the component set when the component is a variant (shared by every
// variant), else on the component.
export function propHost(doc: NagmaDocument, node: SceneNode | undefined): SceneNode | undefined {
    if (node?.type === "componentSet") return node;
    const component = owningComponent(doc, node);
    if (!component) return undefined;
    const parent = doc.nodes[component.parentId ?? ""];
    return parent?.type === "componentSet" ? parent : component;
}

export function hostProps(doc: NagmaDocument, hostId: string): ComponentProp[] {
    return doc.nodes[hostId]?.componentProps ?? [];
}

export type BindField = "visible" | "text" | "swap" | "slot";

export const FIELD_KIND: Record<BindField, ComponentProp["kind"]> = { visible: "boolean", text: "text", swap: "swap", slot: "slot" };

// The current value of a layer's field, as a property default.
function defaultFor(node: SceneNode, field: BindField): boolean | string {
    if (field === "visible") return node.visible !== false;
    if (field === "text") return node.text ?? "";
    if (field === "swap") return node.componentId ?? "";
    return "";
}

export function createProp(hostId: string, prop: Omit<ComponentProp, "id">, bind?: { nodeId: string; field: BindField }): ComponentProp | null {
    const { doc } = editor.get();
    const host = doc.nodes[hostId];
    if (!host) return null;
    const created: ComponentProp = { ...prop, id: nanoid(8) };
    const commands: Command[] = [{ type: "node.update", id: hostId, patch: { componentProps: [...(host.componentProps ?? []), created] } }];
    if (bind) {
        const node = doc.nodes[bind.nodeId];
        if (node) commands.push({ type: "node.update", id: node.id, patch: { propBindings: { ...(node.propBindings ?? {}), [bind.field]: created.id } } });
    }
    editor.execute({ type: "batch", commands });
    return created;
}

export function propDefaultFrom(doc: NagmaDocument, nodeId: string, field: BindField): boolean | string {
    const node = doc.nodes[nodeId];
    return node ? defaultFor(node, field) : field === "visible";
}

export function updateProp(hostId: string, propId: string, patch: Partial<ComponentProp>) {
    const { doc } = editor.get();
    const host = doc.nodes[hostId];
    if (!host) return;
    editor.execute({ type: "node.update", id: hostId, patch: { componentProps: (host.componentProps ?? []).map((p) => (p.id === propId ? { ...p, ...patch } : p)) } });
}

// Removes a property: layers bound to it keep their current look, instances drop their values.
export function deleteProp(hostId: string, propId: string) {
    const { doc } = editor.get();
    const host = doc.nodes[hostId];
    if (!host) return;
    const commands: Command[] = [{ type: "node.update", id: hostId, patch: { componentProps: (host.componentProps ?? []).filter((p) => p.id !== propId) } }];
    for (const node of Object.values(doc.nodes)) {
        const b = node.propBindings;
        if (b && Object.values(b).includes(propId)) {
            const next = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== propId));
            commands.push({ type: "node.update", id: node.id, patch: { propBindings: Object.keys(next).length ? next : null } });
        }
        if (node.propValues && propId in node.propValues) {
            const { [propId]: _gone, ...rest } = node.propValues;
            commands.push({ type: "node.update", id: node.id, patch: { propValues: rest } });
        }
    }
    editor.execute({ type: "batch", commands });
}

export function bindProp(nodeId: string, field: BindField, propId: string | null) {
    const { doc } = editor.get();
    const node = doc.nodes[nodeId];
    if (!node) return;
    const next = { ...(node.propBindings ?? {}) };
    if (propId) next[field] = propId;
    else delete next[field];
    editor.execute({ type: "node.update", id: nodeId, patch: { propBindings: Object.keys(next).length ? next : null } });
}

// ---- Variant properties (they live in the variants' names) ----

// Adds a variant property: every variant gets `name=value`. A lone component becomes a set first.
export function addVariantProperty(nodeId: string, name: string, value: string) {
    const { doc } = editor.get();
    const node = doc.nodes[nodeId];
    const component = node?.type === "component" ? node : undefined;
    let setId = node?.type === "componentSet" ? node.id : component && doc.nodes[component.parentId ?? ""]?.type === "componentSet" ? (component.parentId as string) : null;
    const commands: Command[] = [];
    let working = doc;
    if (!setId && component) {
        const set = makeNode(doc, "componentSet", { x: component.x - 20, y: component.y - 20, w: component.w + 40, h: component.h + 40 }, component.parentId, {
            name: component.name,
            layout: { direction: "horizontal", gap: 20, padding: [20, 20, 20, 20], primary: "start", counter: "start" },
            sizing: { h: "hug", v: "hug" },
            strokes: [],
            fills: [],
        });
        const index = siblingsOf(doc, component).indexOf(component.id);
        commands.push({ type: "node.create", node: set, index });
        working = applyCommand(doc, { type: "node.create", node: set, index });
        commands.push(...rehome(working, component.id, set.id));
        commands.push({ type: "node.update", id: component.id, patch: { name: variantName({ [name]: value }) } });
        editor.execute({ type: "batch", commands });
        return;
    }
    if (!setId) return;
    for (const id of working.nodes[setId]?.children ?? []) {
        const child = working.nodes[id];
        if (child?.type !== "component") continue;
        const props = child.name.includes("=") ? variantProps(child.name) : {};
        if (name in props) continue;
        commands.push({ type: "node.update", id, patch: { name: variantName({ ...props, [name]: value }) } });
    }
    setId = null;
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function renameVariantProperty(setId: string, from: string, to: string) {
    const { doc } = editor.get();
    const commands: Command[] = [];
    for (const id of doc.nodes[setId]?.children ?? []) {
        const child = doc.nodes[id];
        if (child?.type !== "component") continue;
        const props = variantProps(child.name);
        if (!(from in props)) continue;
        const next = Object.fromEntries(Object.entries(props).map(([k, v]) => [k === from ? to : k, v]));
        commands.push({ type: "node.update", id, patch: { name: variantName(next) } });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function removeVariantProperty(setId: string, name: string) {
    const { doc } = editor.get();
    const commands: Command[] = [];
    for (const id of doc.nodes[setId]?.children ?? []) {
        const child = doc.nodes[id];
        if (child?.type !== "component") continue;
        const props = variantProps(child.name);
        delete props[name];
        commands.push({ type: "node.update", id, patch: { name: Object.keys(props).length ? variantName(props) : "Default" } });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Variants whose property values are the same as another's (the reference warns about these).
export function variantConflicts(doc: NagmaDocument, setId: string): string[][] {
    const seen = new Map<string, string[]>();
    const keys = setProperties(doc, setId).map(([k]) => k);
    for (const id of doc.nodes[setId]?.children ?? []) {
        const child = doc.nodes[id];
        if (child?.type !== "component") continue;
        const props = variantProps(child.name);
        const sig = keys.map((k) => `${k}=${props[k] ?? ""}`).join("|");
        seen.set(sig, [...(seen.get(sig) ?? []), id]);
    }
    return [...seen.values()].filter((ids) => ids.length > 1);
}

// ---- Combine as variants, create multiple components ----

// Names like "Button/Primary/Large" become a set "Button" with Property 1=Primary, Property 2=Large.
export function combineAsVariants(ids: string[]) {
    const { doc } = editor.get();
    const components = ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => n?.type === "component" && doc.nodes[n.parentId ?? ""]?.type !== "componentSet");
    if (components.length < 2) {
        editor.notify("Select two or more components to combine them as variants.");
        return;
    }
    const parentId = components[0]?.parentId ?? null;
    const parts = components.map((c) => c.name.split("/").map((p) => p.trim()));
    let common = 0;
    while (parts.every((p) => p.length > common + 1 && p[common] === parts[0]?.[common])) common++;
    const setName = common ? (parts[0] ?? []).slice(0, common).join("/") : (components[0]?.name.split("/")[0]?.trim() ?? "Component");
    const minX = Math.min(...components.map((c) => c.x));
    const minY = Math.min(...components.map((c) => c.y));
    const maxX = Math.max(...components.map((c) => c.x + c.w));
    const maxY = Math.max(...components.map((c) => c.y + c.h));
    const set = makeNode(doc, "componentSet", { x: minX - 20, y: minY - 20, w: maxX - minX + 40, h: maxY - minY + 40 }, parentId, {
        name: setName,
        strokes: [{ type: "solid", color: "#9747FF", opacity: 1, visible: true, blend: "normal" }],
        dash: [4, 4],
        strokeWidth: 1,
        fills: [],
        radius: 5,
    });
    const index = Math.min(...components.map((c) => siblingsOf(doc, c).indexOf(c.id)));
    const commands: Command[] = [{ type: "node.create", node: set, index }];
    let working = applyCommand(doc, { type: "node.create", node: set, index });
    components.forEach((c, i) => {
        const reparent = rehome(working, c.id, set.id);
        commands.push(...reparent);
        working = applyCommand(working, { type: "batch", commands: reparent });
        let name: string;
        if (c.name.includes("=")) name = c.name;
        else {
            const rest = (parts[i] ?? []).slice(common);
            name = rest.length ? variantName(Object.fromEntries(rest.map((v, k) => [`Property ${k + 1}`, v]))) : variantName({ "Property 1": i === 0 ? "Default" : `Variant${i + 1}` });
        }
        commands.push({ type: "node.update", id: c.id, patch: { name } });
    });
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [set.id] });
}

// Each selected layer becomes its own component (frames in place, other layers wrapped).
export function createMultipleComponents(ids: string[]) {
    const { doc } = editor.get();
    const commands: Command[] = [];
    let working = doc;
    const made: string[] = [];
    for (const id of ids) {
        const node = working.nodes[id];
        if (!node || node.sourceId || node.type === "component" || node.type === "componentSet" || node.type === "instance") continue;
        if (node.type === "frame" && !node.isSection) {
            const c: Command = { type: "node.convert", id, to: "component" };
            commands.push(c);
            working = applyCommand(working, c);
            made.push(id);
            continue;
        }
        const frame = makeNode(working, "frame", { x: node.x, y: node.y, w: node.w, h: node.h }, node.parentId, { name: node.name, fills: [], clip: false });
        const index = siblingsOf(working, node).indexOf(id);
        const create: Command = { type: "node.create", node: frame, index };
        working = applyCommand(working, create);
        const move = rehome(working, id, frame.id);
        working = applyCommand(working, { type: "batch", commands: move });
        const convert: Command = { type: "node.convert", id: frame.id, to: "component" };
        working = applyCommand(working, convert);
        commands.push(create, ...move, convert);
        made.push(frame.id);
    }
    if (!commands.length) return;
    editor.execute({ type: "batch", commands });
    editor.set({ selection: made });
}

// ---- Instance overrides ----

const PROP_LABELS: Record<string, string> = {
    fills: "Fill",
    fillStyleId: "Fill",
    strokes: "Stroke",
    strokeStyleId: "Stroke",
    strokeWidth: "Stroke",
    strokeAlign: "Stroke",
    effects: "Effects",
    effectStyleId: "Effects",
    shadow: "Effects",
    blur: "Effects",
    text: "Text content",
    fontSize: "Text style",
    fontWeight: "Text style",
    fontFamily: "Text style",
    italic: "Text style",
    lineHeight: "Text style",
    letterSpacing: "Text style",
    textStyleId: "Text style",
    textAlign: "Text style",
    textAlignV: "Text style",
    decoration: "Text style",
    visible: "Visibility",
    opacity: "Opacity",
    blendMode: "Opacity",
    name: "Name",
    radius: "Corner radius",
    w: "Size",
    h: "Size",
    rotation: "Rotation",
    flipX: "Rotation",
    flipY: "Rotation",
    layout: "Auto layout",
    sizing: "Auto layout",
    clip: "Clip content",
    componentId: "Swapped instances",
    propValues: "Nested instance properties",
    variableModes: "Variable modes",
    boundVariables: "Variables",
    locked: "Lock",
    children: "Slot contents",
};

export function overrideLabel(key: string): string {
    return PROP_LABELS[key] ?? key;
}

// The overrides in an instance, grouped by what they change ("Fill", "Text content", …), plus
// property values set on the instance.
export function instanceOverrides(doc: NagmaDocument, instanceId: string): { label: string; keys: string[] }[] {
    const labels = new Map<string, Set<string>>();
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        for (const key of node.overrides ?? []) {
            const label = overrideLabel(key);
            labels.set(label, (labels.get(label) ?? new Set()).add(key));
        }
        node.children.forEach(visit);
    };
    visit(instanceId);
    return [...labels.entries()].map(([label, keys]) => ({ label, keys: [...keys] }));
}

// Takes some overrides off an instance (all of them for each listed key), so those properties
// follow the main component again. Slot contents go back to the slot's defaults.
export function resetOverrideKeys(instanceId: string, keys: string[]) {
    const { doc } = editor.get();
    const drop = new Set(keys);
    const commands: Command[] = [];
    const removeIds: string[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        const kept = (node.overrides ?? []).filter((k) => !drop.has(k));
        if (kept.length !== (node.overrides ?? []).length) {
            const patch: Partial<SceneNode> = { overrides: kept };
            if (drop.has("children") && node.overrides?.includes("children")) removeIds.push(...node.children.filter((c) => !doc.nodes[c]?.sourceId));
            if (drop.has("propValues")) patch.propValues = undefined;
            commands.push({ type: "node.update", id, patch });
        }
        node.children.forEach(visit);
    };
    visit(instanceId);
    if (removeIds.length) commands.unshift({ type: "node.delete", ids: removeIds });
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Resets every override on the instances (and their slot contents and property values).
export function resetAllOverrides(instanceIds: string[]) {
    const { doc } = editor.get();
    const commands: Command[] = [];
    const removeIds: string[] = [];
    const visit = (id: string, root: boolean) => {
        const node = doc.nodes[id];
        if (!node) return;
        if (node.overrides?.includes("children")) removeIds.push(...node.children.filter((c) => !doc.nodes[c]?.sourceId));
        if (node.overrides?.length || (root && node.propValues && Object.keys(node.propValues).length)) commands.push({ type: "node.update", id, patch: { overrides: [], ...(root ? { propValues: {} } : {}) } });
        node.children.forEach((c) => visit(c, false));
    };
    for (const id of instanceIds) visit(id, true);
    if (removeIds.length) commands.unshift({ type: "node.delete", ids: removeIds });
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Resets one component property on an instance to its default.
export function resetPropValue(instanceId: string, propId: string) {
    const { doc } = editor.get();
    const node = doc.nodes[instanceId];
    if (!node?.propValues || !(propId in node.propValues)) return;
    const { [propId]: _gone, ...rest } = node.propValues;
    editor.execute({ type: "node.update", id: instanceId, patch: { propValues: rest } });
}

// Push overrides to the main component: the instance's changes become the component's, and the
// instance goes back to following it (the reference's "Push changes to main component").
export function pushOverridesToMain(instanceId: string) {
    const { doc } = editor.get();
    const instance = doc.nodes[instanceId];
    const component = instance?.componentId ? doc.nodes[instance.componentId] : undefined;
    if (!instance || !component) return;
    if (component.libraryId) {
        editor.notify("This instance's main component is in a library. Push changes from the library file.");
        return;
    }
    const commands: Command[] = [];
    const clear: Command[] = [];
    const visit = (id: string, root: boolean) => {
        const node = doc.nodes[id];
        if (!node) return;
        const keys = (node.overrides ?? []).filter((k) => k !== "children" && (!root || !["name", "componentId"].includes(k)));
        const target = root ? component.id : node.sourceId;
        if (keys.length && target && doc.nodes[target]) {
            const patch: Record<string, unknown> = {};
            for (const k of keys) patch[k] = (node as unknown as Record<string, unknown>)[k];
            commands.push({ type: "node.update", id: target, patch: patch as Partial<SceneNode> });
        }
        if (node.overrides?.length) clear.push({ type: "node.update", id, patch: { overrides: node.overrides.filter((k) => k === "children") } });
        node.children.forEach((c) => visit(c, false));
    };
    visit(instanceId, true);
    if (!commands.length) {
        editor.notify("This instance has no changes to push.");
        return;
    }
    editor.execute({ type: "batch", commands: [...commands, ...clear] });
    editor.notify("Changes pushed to the main component.");
}

// ---- Nested instances ----

// Nested instances directly inside a component (not inside another nested instance).
export function nestedInstances(doc: NagmaDocument, componentId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        for (const c of node.children) {
            const child = doc.nodes[c];
            if (!child) continue;
            if (child.type === "instance") out.push(child);
            else visit(c);
        }
    };
    visit(componentId);
    return out;
}

// Exposed nested instances inside an instance: their mirrors, outermost first.
export function exposedInInstance(doc: NagmaDocument, instanceId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        for (const c of node.children) {
            const child = doc.nodes[c];
            if (!child) continue;
            if (child.type === "instance" && child.sourceId) {
                if (doc.nodes[child.sourceId]?.exposed || child.exposed) out.push(child);
                continue;
            }
            visit(c);
        }
    };
    visit(instanceId);
    return out;
}

export function setExposed(ids: string[], exposed: boolean) {
    editor.execute({ type: "batch", commands: ids.map((id) => ({ type: "node.update" as const, id, patch: { exposed } })) });
}

// ---- Slots ----

// Turns a frame inside a component into a slot, with a new slot property (or an existing one).
export function convertToSlot(frameId: string, propId?: string) {
    const { doc } = editor.get();
    const node = doc.nodes[frameId];
    if (!node) return;
    if (node.type === "component" || node.type === "componentSet") {
        editor.notify("A slot can't be the component itself. Select a frame inside the component.");
        return;
    }
    const host = propHost(doc, node);
    if (!host || node.sourceId) {
        editor.notify("Slots go on frames inside a main component.");
        return;
    }
    if (!isFrameLike(node) || node.type === "instance") {
        wrapInSlot([frameId]);
        return;
    }
    if (propId) {
        bindProp(frameId, "slot", propId);
        return;
    }
    const count = (host.componentProps ?? []).filter((p) => p.kind === "slot").length;
    createProp(host.id, { name: count ? `Slot ${count + 1}` : "Slot", kind: "slot", defaultValue: "", preferred: [], minItems: null, maxItems: null, onlyPreferred: false }, { nodeId: frameId, field: "slot" });
}

// Wraps layers (text, groups, instances) in a new frame and makes it a slot.
export function wrapInSlot(ids: string[]) {
    const { doc } = editor.get();
    const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    const first = nodes[0];
    if (!first) return;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const frame = makeNode(doc, "frame", { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, first.parentId, {
        name: "Slot",
        fills: [],
        clip: false,
        layout: { direction: "vertical", gap: 8, padding: [0, 0, 0, 0], primary: "start", counter: "start" },
        sizing: { h: "hug", v: "hug" },
    });
    const index = siblingsOf(doc, first).indexOf(first.id);
    const commands: Command[] = [{ type: "node.create", node: frame, index }];
    let working = applyCommand(doc, { type: "node.create", node: frame, index });
    for (const n of nodes) {
        const move = rehome(working, n.id, frame.id);
        working = applyCommand(working, { type: "batch", commands: move });
        commands.push(...move);
    }
    editor.execute({ type: "batch", commands });
    convertToSlot(frame.id);
    editor.mergeLast();
    editor.set({ selection: [frame.id] });
}

// The slot property a mirrored slot frame belongs to, with its instance.
export function slotInfo(doc: NagmaDocument, node: SceneNode | undefined): { prop: ComponentProp; instance: SceneNode; source: SceneNode } | null {
    if (!node?.sourceId) return null;
    const source = doc.nodes[node.sourceId];
    const propId = source?.propBindings?.slot;
    if (!source || !propId) return null;
    const component = owningComponent(doc, source);
    let instance: SceneNode | undefined = node.parentId ? doc.nodes[node.parentId] : undefined;
    while (instance && !(instance.type === "instance" && instance.componentId === component?.id)) instance = instance.parentId ? doc.nodes[instance.parentId] : undefined;
    const prop = propsOf(doc, component).find((p) => p.id === propId);
    return prop && instance ? { prop, instance, source } : null;
}

// Mirrored slot frames inside an instance.
export function slotsInInstance(doc: NagmaDocument, instanceId: string): SceneNode[] {
    const out: SceneNode[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        for (const c of node.children) {
            const child = doc.nodes[c];
            if (!child?.sourceId) continue;
            if (doc.nodes[child.sourceId]?.propBindings?.slot) out.push(child);
            else if (child.type !== "instance") visit(c);
        }
    };
    visit(instanceId);
    return out;
}

// Places an instance of a component into a slot on an instance.
export function addToSlot(slotId: string, componentId: string) {
    const { doc } = editor.get();
    const slot = doc.nodes[slotId];
    const component = doc.nodes[componentId];
    if (!slot || component?.type !== "component") return;
    if (wouldNestItself(doc, componentId, slot.id)) {
        editor.notify("A component can't contain an instance of itself.");
        return;
    }
    const last = slot.children.map((c) => doc.nodes[c]).filter(Boolean).pop();
    const node = makeNode(doc, "instance", { x: slot.x + (slot.layout ? 0 : 8), y: last && !slot.layout ? last.y + last.h + 8 : slot.y, w: component.w, h: component.h }, slot.id, { name: component.name, componentId, fills: [], overrides: [] });
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id] });
}

// Empties a slot on an instance (the reference's "Delete contents").
export function clearSlot(slotId: string) {
    const { doc } = editor.get();
    const slot = doc.nodes[slotId];
    if (!slot) return;
    const commands: Command[] = [];
    if (!slot.overrides?.includes("children")) commands.push({ type: "node.update", id: slotId, patch: { overrides: [...(slot.overrides ?? []), "children"] } });
    const own = slot.children.filter((c) => !doc.nodes[c]?.sourceId);
    const mirrored = slot.children.filter((c) => doc.nodes[c]?.sourceId);
    if (own.length || mirrored.length) commands.push({ type: "node.delete", ids: [...own, ...mirrored] });
    editor.execute({ type: "batch", commands });
}

export function resetSlot(slotId: string) {
    const { doc } = editor.get();
    const slot = doc.nodes[slotId];
    if (!slot) return;
    const own = slot.children.filter((c) => !doc.nodes[c]?.sourceId);
    editor.execute({ type: "batch", commands: [...(own.length ? [{ type: "node.delete" as const, ids: own }] : []), { type: "node.update", id: slotId, patch: { overrides: (slot.overrides ?? []).filter((k) => k !== "children") } }] });
}

// ⇧⌘S on the selection: one frame converts, anything else is wrapped in a new slot.
export function slotSelection(ids: string[]) {
    const { doc } = editor.get();
    const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    if (!nodes.length) return;
    if (nodes.length === 1 && nodes[0] && isFrameLike(nodes[0]) && nodes[0].type !== "instance") convertToSlot(nodes[0].id);
    else if (nodes.every((n) => propHost(doc, n) && !n.sourceId)) wrapInSlot(ids);
    else editor.notify("Slots go on layers inside a main component.");
}

// Extra layer menu entries for components: convert to slot, combine as variants, create multiple
// components, push changes to the main component.
export function systemsMenuItems(doc: NagmaDocument, nodes: SceneNode[]): { id: string; label: string; shortcut?: string; run: () => void }[] {
    const ids = nodes.map((n) => n.id);
    const out: { id: string; label: string; shortcut?: string; run: () => void }[] = [];
    const single = nodes.length === 1 ? nodes[0] : undefined;
    if (single && !single.sourceId && single.type !== "component" && single.type !== "componentSet" && propHost(doc, single) && !single.propBindings?.slot)
        out.push({ id: "slot", label: isFrameLike(single) && single.type !== "instance" ? "Convert to slot" : "Wrap in new slot", shortcut: "⇧ ⌘ S", run: () => slotSelection(ids) });
    if (nodes.length > 1 && nodes.every((n) => n.type === "component" && doc.nodes[n.parentId ?? ""]?.type !== "componentSet")) out.push({ id: "combine", label: "Combine as variants", run: () => combineAsVariants(ids) });
    if (nodes.length > 1 && nodes.every((n) => !n.sourceId && n.type !== "component" && n.type !== "componentSet" && n.type !== "instance")) out.push({ id: "multiple", label: "Create multiple components", run: () => createMultipleComponents(ids) });
    if (single?.type === "instance" && !single.sourceId) out.push({ id: "push", label: "Push changes to main component", run: () => pushOverridesToMain(single.id) });
    return out;
}
