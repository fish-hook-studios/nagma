import { nanoid } from "nanoid";
import { editor } from "../engine/store";
import type { Command, SceneNode } from "../engine/types";
import { libraryPage, webData } from "./model";

// Shared components: a section made into a component moves to the Components page as the main
// component, and an instance takes its place, so other pages can use the same one (Insert panel)
// and editing the main component changes it everywhere.
export function makeSharedComponent(id: string) {
    const doc = editor.get().doc;
    const node = doc.nodes[id];
    const lib = libraryPage(doc);
    if (!node || !lib || !node.parentId) return;
    const parent = doc.nodes[node.parentId];
    if (!parent) return;
    // To the right of what's already on the Components page.
    const others = lib.children.map((c) => doc.nodes[c]).filter((c): c is SceneNode => Boolean(c));
    const x = others.length ? Math.max(...others.map((o) => o.x + o.w)) + 120 : 0;
    const y = 0;
    const map = new Map<string, string>();
    const creates: Command[] = [];
    const copy = (sourceId: string, parentId: string, root: boolean) => {
        const src = doc.nodes[sourceId];
        if (!src || webData(src).rep) return;
        const newId = nanoid(10);
        map.set(sourceId, newId);
        const web = webData(src);
        const site = src.site && !("kind" in src.site && src.site.kind) ? { ...web, src: undefined, ov: undefined } : src.site;
        const node: SceneNode = {
            ...src,
            id: newId,
            parentId,
            children: [],
            x: src.x - (doc.nodes[id] as SceneNode).x + x,
            y: src.y - (doc.nodes[id] as SceneNode).y + y,
            site,
            ...(root ? { type: "component" as const, sizing: { h: "fixed" as const, v: src.sizing.v === "fill" ? ("hug" as const) : src.sizing.v }, name: src.name, description: "Shared across the site's pages." } : {}),
        };
        creates.push({ type: "node.create", node });
        if (src.type !== "instance") for (const c of src.children) copy(c, newId, false);
    };
    copy(id, lib.id, true);
    const componentId = map.get(id);
    if (!componentId) return;
    const index = parent.children.indexOf(id);
    const instanceId = nanoid(10);
    const instance: SceneNode = {
        ...(creates[0] as { node: SceneNode }).node,
        id: instanceId,
        type: "instance",
        componentId,
        parentId: parent.id,
        children: [],
        // The instance keeps its own resizing (fill the page's width) rather than the component's.
        overrides: ["sizing"],
        x: node.x,
        y: node.y,
        sizing: node.sizing,
        site: undefined,
        description: undefined,
    };
    editor.execute({ type: "batch", commands: [...creates, { type: "node.delete", ids: [id] }, { type: "node.create", node: instance, index }] });
    editor.set({ selection: [instanceId] });
    editor.notify(`${node.name} is now a shared component. Find it under Insert to use it on other pages.`);
}
