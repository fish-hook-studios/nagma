// Menu bar commands beyond the editing basics: round to pixel, pack and edge distribution, layer
// visibility and contents, sizing shortcuts, find next and previous, set default properties, and
// the plugin development helpers. Each one commits a single undoable command.
import { viewport } from "./camera";
import { clearSlot } from "./component-actions";
import { exportAnimatedSvg } from "./export-svg";
import { findLayers, revealResult } from "./find";
import { selectionBounds, topLevel } from "./nodes";
import { layerRoots } from "./page";
import { importPluginFiles } from "./plugins";
import { refuseExport } from "./share-settings";
import { editor } from "./store";
import { applyVector, spaceMatrix, worldBounds } from "./transform";
import { ui } from "./ui-state";
import type { Command, NagmaDocument, NodeType, SceneNode } from "./types";
import { userStorage } from "./user-storage";

function selectedNodes(): { doc: NagmaDocument; nodes: SceneNode[] } {
    const { doc, selection } = editor.get();
    return { doc, nodes: topLevel(doc, selection).map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n) && n?.type !== "page") };
}

function moveBy(doc: NagmaDocument, node: SceneNode, dx: number, dy: number): Command {
    const d = applyVector(spaceMatrix(doc, node.parentId).inverse(), dx, dy);
    return { type: "node.move", ids: [node.id], dx: d.x, dy: d.y };
}

// Arrange › Round to pixel: position and size on whole pixels.
export function roundToPixel() {
    const { nodes } = selectedNodes();
    const commands: Command[] = nodes.flatMap((n): Command[] => {
        const patch = { x: Math.round(n.x), y: Math.round(n.y), w: Math.max(1, Math.round(n.w)), h: Math.max(1, Math.round(n.h)) };
        return patch.x === n.x && patch.y === n.y && patch.w === n.w && patch.h === n.h ? [] : [{ type: "node.update", id: n.id, patch }];
    });
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Arrange › Pack horizontal / vertical: the layers side by side with no gap, in their current order,
// starting from the first one.
export function packSelection(axis: "h" | "v") {
    const { doc, nodes } = selectedNodes();
    if (nodes.length < 2) return;
    const boxed = nodes.map((node) => ({ node, box: worldBounds(doc, node) })).sort((a, b) => (axis === "h" ? a.box.x - b.box.x : a.box.y - b.box.y));
    let cursor = axis === "h" ? (boxed[0]?.box.x ?? 0) : (boxed[0]?.box.y ?? 0);
    const commands: Command[] = [];
    for (const { node, box } of boxed) {
        const at = axis === "h" ? box.x : box.y;
        if (Math.abs(cursor - at) > 0.01) commands.push(axis === "h" ? moveBy(doc, node, cursor - at, 0) : moveBy(doc, node, 0, cursor - at));
        cursor += axis === "h" ? box.w : box.h;
    }
    if (commands.length) editor.execute({ type: "batch", commands });
}

export type Edge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

// Arrange › Distribute left / centers / right / top / bottom: the chosen edge of each layer evenly
// spaced, the first and last staying where they are.
export function distributeEdges(edge: Edge) {
    const { doc, nodes } = selectedNodes();
    if (nodes.length < 3) return;
    const horizontal = edge === "left" || edge === "hcenter" || edge === "right";
    const at = (b: { x: number; y: number; w: number; h: number }) =>
        edge === "left" ? b.x : edge === "hcenter" ? b.x + b.w / 2 : edge === "right" ? b.x + b.w : edge === "top" ? b.y : edge === "vcenter" ? b.y + b.h / 2 : b.y + b.h;
    const boxed = nodes.map((node) => ({ node, box: worldBounds(doc, node) })).sort((a, b) => at(a.box) - at(b.box));
    const first = at((boxed[0] as (typeof boxed)[number]).box);
    const last = at((boxed[boxed.length - 1] as (typeof boxed)[number]).box);
    const step = (last - first) / (boxed.length - 1);
    const commands: Command[] = [];
    boxed.forEach(({ node, box }, i) => {
        const d = first + step * i - at(box);
        if (Math.abs(d) > 0.01) commands.push(horizontal ? moveBy(doc, node, d, 0) : moveBy(doc, node, 0, d));
    });
    if (commands.length) editor.execute({ type: "batch", commands });
}

// Object › Hide other layers: every other top-level layer on the page is hidden; again (when the
// rest are already hidden) shows them.
export function hideOtherLayers() {
    const { doc, selection } = editor.get();
    if (!selection.length) return;
    const keep = new Set<string>();
    for (const id of selection) {
        let cur: SceneNode | undefined = doc.nodes[id];
        while (cur && cur.type !== "page") {
            keep.add(cur.id);
            cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
        }
    }
    const others = layerRoots(doc).filter((id) => !keep.has(id));
    if (!others.length) return;
    const show = others.every((id) => doc.nodes[id]?.visible === false);
    editor.execute({ type: "batch", commands: others.map((id) => ({ type: "node.update" as const, id, patch: { visible: show } })) });
}

// Object › Delete contents: empties the selected frames (an instance's slot through its override).
export function deleteContents() {
    const { nodes } = selectedNodes();
    const commands: Command[] = [];
    for (const node of nodes) {
        if (!node.children.length) continue;
        if (node.sourceId) {
            clearSlot(node.id);
            continue;
        }
        if (node.type === "instance") continue;
        commands.push({ type: "node.delete", ids: [...node.children] });
    }
    if (commands.length) editor.execute({ type: "batch", commands });
    else if (!nodes.some((n) => n.children.length)) editor.notify("The selection has no contents to delete.");
}

// Object › Convert to frame: sections become frames again.
export function convertToFrame() {
    const { nodes } = selectedNodes();
    const sections = nodes.filter((n) => n.isSection);
    if (sections.length) editor.execute({ type: "batch", commands: sections.map((n) => ({ type: "node.update" as const, id: n.id, patch: { isSection: false, clip: true } })) });
}

// Object › More layout options: aspect ratio lock, and hug or fill on one axis where it applies
// (hug on auto layout frames and text, fill inside an auto layout frame).
export function setAspectLock(lock: boolean) {
    const { nodes } = selectedNodes();
    const commands = nodes.filter((n) => Boolean(n.lockAspect) !== lock).map((n) => ({ type: "node.update" as const, id: n.id, patch: { lockAspect: lock } }));
    if (commands.length) editor.execute({ type: "batch", commands });
}

export function setSizing(axis: "h" | "v", mode: "hug" | "fill") {
    const { doc, nodes } = selectedNodes();
    const fits = (n: SceneNode) => (mode === "hug" ? Boolean(n.layout) || n.type === "text" : Boolean(n.parentId && doc.nodes[n.parentId]?.layout));
    const commands = nodes.filter(fits).map((n) => ({ type: "node.update" as const, id: n.id, patch: { sizing: { ...n.sizing, [axis]: mode } } }));
    if (commands.length) editor.execute({ type: "batch", commands });
    else editor.notify(mode === "hug" ? "Hug contents works on auto layout frames and text." : "Fill container works on layers inside an auto layout frame.");
}

// Edit › Find next / previous: steps through the Find panel's results (opening Find when it's closed).
export function findStep(dir: 1 | -1) {
    const { query, allPages, kind } = ui.get().findQuery;
    if (!query.trim()) {
        void import("./ui-state").then((m) => m.openFind(false));
        return;
    }
    const s = editor.get();
    const results = findLayers(s.doc, query, { pageId: allPages ? null : s.pageId, kind });
    if (!results.length) return editor.notify("No matches.");
    const current = results.findIndex((r) => s.selection.includes(r.id));
    const next = results[(current + dir + results.length) % results.length];
    if (next) revealResult(next);
}

// Edit › Copy as › Copy as animated SVG: the first selected layer with its Motion keyframes.
export async function copyAnimatedSvg() {
    if (refuseExport()) return;
    const { doc, selection } = editor.get();
    const id = selection[0];
    const svg = id ? exportAnimatedSvg(doc, id) : null;
    if (!svg) return;
    try {
        await navigator.clipboard.writeText(svg);
        editor.notify("Animated SVG copied.");
    } catch {
        editor.notify("The clipboard isn't available here.");
    }
}

// Edit › Set default properties: new text takes the selected text's type and paints; new shapes
// take the selected shape's fills, strokes, corners and effects. Kept on this device.
const DEFAULTS_KEY = "nagma.defaultProps.v1";
const SHAPE_KEYS: (keyof SceneNode)[] = ["fills", "strokes", "strokeWidth", "strokeAlign", "strokeJoin", "strokeCap", "dash", "radius", "radii", "cornerSmoothing", "opacity", "shadow", "blur", "effects", "blendMode"];
const TEXT_KEYS: (keyof SceneNode)[] = ["fills", "strokes", "strokeWidth", "opacity", "effects", "fontFamily", "fontSize", "fontWeight", "italic", "lineHeight", "letterSpacing", "textAlign", "decoration", "textCase"];
type Defaults = { text?: Partial<SceneNode>; shape?: Partial<SceneNode> };

function readDefaults(): Defaults {
    try {
        return JSON.parse(userStorage.getItem(DEFAULTS_KEY) ?? "{}") as Defaults;
    } catch {
        return {};
    }
}

export function setDefaultProperties() {
    const { doc, selection } = editor.get();
    const node = selection[0] ? doc.nodes[selection[0]] : undefined;
    if (!node) return;
    const text = node.type === "text";
    const keys = text ? TEXT_KEYS : SHAPE_KEYS;
    const props: Partial<SceneNode> = {};
    for (const key of keys) if (node[key] !== undefined) (props as Record<string, unknown>)[key] = structuredClone(node[key]);
    const next = { ...readDefaults(), [text ? "text" : "shape"]: props };
    try {
        userStorage.setItem(DEFAULTS_KEY, JSON.stringify(next));
    } catch {
        // Storage can be unavailable (private windows); the defaults just don't stick.
    }
    editor.notify(text ? "New text uses these properties." : "New shapes use these properties.");
}

const SHAPES = new Set<NodeType>(["rect", "ellipse", "vector"]);
// The properties a new layer of this kind starts with (none until Set default properties was used).
export function defaultPropsFor(type: NodeType): Partial<SceneNode> {
    const d = readDefaults();
    return type === "text" ? (d.text ?? {}) : SHAPES.has(type) ? (d.shape ?? {}) : {};
}

// Plugins › Development › New plugin…: a starter plugin, imported straight away so it can run.
export async function newPlugin() {
    const manifest = { name: "New plugin", id: `new-plugin-${Date.now().toString(36)}`, api: "1.0.0", main: "code.js", editorType: ["design"] };
    const code = `// Runs in the editor's plugin sandbox. Change this file and import the manifest again.\nconst count = nagma.currentPage.selection.length;\nnagma.notify(count ? \`\${count} layer\${count === 1 ? "" : "s"} selected\` : "Hello from your plugin");\nnagma.closePlugin();\n`;
    try {
        await importPluginFiles([new File([JSON.stringify(manifest, null, 2)], "manifest.json", { type: "application/json" }), new File([code], "code.js", { type: "text/javascript" })]);
        editor.setPrefs({ leftPanel: "tools", leftPanelOpen: true });
    } catch (e) {
        editor.notify(e instanceof Error ? e.message : String(e));
    }
}

// Widgets › Select all widgets: every widget on this page.
export function selectAllWidgets() {
    const { doc, pageId } = editor.get();
    const ids: string[] = [];
    const visit = (id: string) => {
        const node = doc.nodes[id];
        if (!node) return;
        if (node.widget) ids.push(id);
        else node.children.forEach(visit);
    };
    doc.nodes[pageId]?.children.forEach(visit);
    if (!ids.length) return editor.notify("There are no widgets on this page.");
    editor.set({ selection: ids });
}

// View › Find previous / next frame: selects the neighbouring top-level frame and brings it into
// view without changing the zoom (Zoom to previous / next frame also fits it).
export function findFrame(step: 1 | -1) {
    const { doc, selection } = editor.get();
    const frames = layerRoots(doc).filter((id) => {
        const n = doc.nodes[id];
        return n && (n.type === "frame" || n.type === "component" || n.type === "componentSet");
    });
    if (!frames.length) return;
    const current = frames.findIndex((id) => selection.includes(id));
    const next = frames[(current + step + frames.length) % frames.length] as string;
    const box = selectionBounds(doc, [next]);
    editor.set({ selection: [next] });
    if (!box) return;
    const { camera } = editor.get();
    editor.set({ camera: { ...camera, x: viewport.width / 2 - (box.x + box.w / 2) * camera.zoom, y: viewport.height / 2 - (box.y + box.h / 2) * camera.zoom } });
}

// Help › AI balance: whether the agent can take more requests on your teams.
export async function showAiBalance() {
    const [{ auth, authHeaders }, { httpBase }] = await Promise.all([import("./auth"), import("./server-url")]);
    if (!auth.get().user) return editor.notify("Sign in to see your AI balance.");
    try {
        const res = await fetch(`${httpBase()}/ai/usage`, { headers: authHeaders() });
        const body = (await res.json()) as { allowed?: boolean; reason?: string | null };
        editor.notify(body.allowed ? "You have AI credits left for today." : (body.reason ?? "You've used your AI credits for now."));
    } catch {
        editor.notify("The AI balance isn't available offline.");
    }
}
