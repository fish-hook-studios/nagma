import { viewCenter } from "./actions";
import { makeNode } from "./nodes";
import { solid } from "./paint";
import { runWidget, type WidgetElement } from "./plugins";
import { editor } from "./store";
import type { AutoLayout, Command, NagmaDocument, Paint, SceneNode } from "./types";

// Widgets on the canvas: a widget's code describes its layers (auto layouts, frames, text,
// rectangles and ellipses), and they are drawn as ordinary layers under a root that remembers the
// widget and its state. Clicking a layer with a click handler runs the widget again with that
// handler, and its layers are redrawn from the new state, as one undo step.

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function paints(v: unknown): Paint[] {
    if (typeof v === "string" && /^#?[0-9a-f]{3,8}$/i.test(v)) return [solid(v.startsWith("#") ? v.toUpperCase() : `#${v.toUpperCase()}`)];
    if (Array.isArray(v)) return v.flatMap(paints);
    if (v && typeof v === "object" && "type" in v && (v as { type: string }).type === "solid" && "color" in v) {
        const c = (v as { color: unknown }).color;
        if (typeof c === "string") return [solid(c)];
        if (c && typeof c === "object") {
            const { r = 0, g = 0, b = 0 } = c as { r?: number; g?: number; b?: number };
            return [solid(`#${[r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase())];
        }
    }
    return [];
}

function sizing(v: unknown, auto: "hug" | "fixed"): "hug" | "fill" | "fixed" {
    if (v === "hug-contents") return "hug";
    if (v === "fill-parent") return "fill";
    if (typeof v === "number") return "fixed";
    return auto;
}

function padding(v: unknown): [number, number, number, number] {
    if (typeof v === "number") return [v, v, v, v];
    if (v && typeof v === "object") {
        const p = v as Record<string, number>;
        const vert = num(p.vertical, 0);
        const hor = num(p.horizontal, 0);
        return [num(p.top, vert), num(p.right, hor), num(p.bottom, vert), num(p.left, hor)];
    }
    return [0, 0, 0, 0];
}

const ALIGN: Record<string, AutoLayout["primary"]> = { start: "start", center: "center", end: "end" };

// The layers for an element and everything inside it, parents first.
function layersFor(doc: NagmaDocument, el: WidgetElement, parentId: string | null, at: { x: number; y: number }, out: SceneNode[]) {
    const p = el.props;
    const common: Partial<SceneNode> = {
        ...(typeof p.name === "string" ? { name: p.name } : {}),
        opacity: num(p.opacity, 1),
        ...(el.handler != null ? { widgetHandler: el.handler } : {}),
    };
    const strokes = paints(p.stroke);
    if (strokes.length) Object.assign(common, { strokes, strokeWidth: num(p.strokeWidth, 1), strokeAlign: "inside" as const });
    if (typeof p.cornerRadius === "number") common.radius = p.cornerRadius;
    const x = at.x + num(p.x, 0);
    const y = at.y + num(p.y, 0);
    if (el.type === "Text") {
        const node = makeNode(doc, "text", { x, y, w: 1, h: 1 }, parentId, {
            ...common,
            text: el.text ?? "",
            name: typeof p.name === "string" ? p.name : (el.text ?? "Text").slice(0, 40),
            fontSize: num(p.fontSize, 16),
            fontWeight: num(p.fontWeight, 400),
            ...(typeof p.fontFamily === "string" ? { fontFamily: p.fontFamily } : {}),
            fills: paints(p.fill).length ? paints(p.fill) : [solid("#000000")],
            ...(p.horizontalAlignText === "center" || p.horizontalAlignText === "right" ? { textAlign: p.horizontalAlignText } : {}),
            sizing: { h: typeof p.width === "number" ? "fixed" : sizing(p.width, "hug"), v: "hug" },
            ...(typeof p.width === "number" ? { w: p.width } : {}),
        });
        out.push(node);
        return;
    }
    if (el.type === "Rectangle" || el.type === "Ellipse") {
        const node = makeNode(doc, el.type === "Ellipse" ? "ellipse" : "rect", { x, y, w: num(p.width, 100), h: num(p.height, 100) }, parentId, {
            ...common,
            fills: paints(p.fill),
            sizing: { h: sizing(p.width, "fixed"), v: sizing(p.height, "fixed") },
        });
        out.push(node);
        return;
    }
    const auto = el.type === "AutoLayout";
    const direction = p.direction === "vertical" ? "vertical" : "horizontal";
    const along = direction === "horizontal" ? p.horizontalAlignItems : p.verticalAlignItems;
    const across = direction === "horizontal" ? p.verticalAlignItems : p.horizontalAlignItems;
    const node = makeNode(doc, "frame", { x, y, w: num(p.width, 100), h: num(p.height, 100) }, parentId, {
        ...common,
        name: typeof p.name === "string" ? p.name : auto ? "Auto layout" : "Frame",
        fills: paints(p.fill),
        clip: p.overflow !== "visible",
        layout: auto ? { direction, gap: p.spacing === "auto" ? 0 : num(p.spacing, 0), padding: padding(p.padding), primary: p.spacing === "auto" ? "between" : (ALIGN[String(along)] ?? "start"), counter: (ALIGN[String(across)] ?? "start") as AutoLayout["counter"] } : null,
        sizing: { h: sizing(p.width, auto ? "hug" : "fixed"), v: sizing(p.height, auto ? "hug" : "fixed") },
    });
    out.push(node);
    for (const child of el.children) layersFor(doc, child, node.id, { x: node.x, y: node.y }, out);
}

function createCommands(nodes: SceneNode[]): Command[] {
    return nodes.map((node) => ({ type: "node.create" as const, node: { ...node, children: [] } }));
}

// Widgets › Insert: draws the widget in the middle of the view.
export async function insertWidget(pluginId: string, name: string) {
    try {
        const { tree, state } = await runWidget(pluginId, {}, null);
        const s = editor.get();
        const c = viewCenter();
        const nodes: SceneNode[] = [];
        layersFor(s.doc, tree, s.pageId, c, nodes);
        const root = nodes[0];
        if (!root) return;
        nodes[0] = { ...root, name, widget: { pluginId, state } };
        editor.execute({ type: "batch", commands: createCommands(nodes) });
        // Centre it once its auto layout has its size.
        const placed = editor.get().doc.nodes[root.id];
        if (placed) editor.execute({ type: "node.move", ids: [root.id], dx: -placed.w / 2, dy: -placed.h / 2 });
        editor.mergeLast();
        editor.set({ selection: [root.id], tool: "move" });
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}

// The widget a layer belongs to (its root), and the click handler nearest the layer.
export function widgetAt(doc: NagmaDocument, node: SceneNode | undefined): { root: SceneNode; handler: number | null } | null {
    let handler: number | null = null;
    let cur = node;
    while (cur) {
        if (handler === null && cur.widgetHandler != null) handler = cur.widgetHandler;
        if (cur.widget) return { root: cur, handler };
        cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
    }
    return null;
}

// A click on a widget's button: run its handler, then redraw the widget's layers from its new state.
export async function clickWidget(rootId: string, handler: number) {
    const before = editor.get().doc.nodes[rootId];
    if (!before?.widget) return;
    try {
        const { tree, state } = await runWidget(before.widget.pluginId, before.widget.state, handler, rootId);
        const doc = editor.get().doc;
        const root = doc.nodes[rootId];
        if (!root) return;
        const nodes: SceneNode[] = [];
        layersFor(doc, tree, root.parentId, { x: root.x, y: root.y }, nodes);
        const fresh = nodes[0];
        if (!fresh) return;
        // The root keeps its id, place and name; what's inside is drawn again.
        const children = nodes.slice(1).map((n) => (n.parentId === fresh.id ? { ...n, parentId: rootId } : n));
        const { id: _id, parentId: _parent, x: _x, y: _y, name: _name, children: _kids, ...look } = fresh;
        editor.execute({
            type: "batch",
            commands: [{ type: "node.delete", ids: [...root.children] }, { type: "node.update", id: rootId, patch: { ...look, widget: { pluginId: root.widget?.pluginId ?? "", state } } }, ...createCommands(children)],
        });
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}
