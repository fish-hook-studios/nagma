import { exportLayers } from "../engine/export";
import { editor } from "../engine/store";
import { renderThumb } from "../engine/thumb";
import type { NagmaDocument, SceneNode } from "../engine/types";

// Inspect's icon assets: vector artwork in the selection (small layers made only of shapes) is
// offered as SVG or PNG downloads, the way a developer wants icons, without exporting by hand.

const SHAPE_TYPES = new Set<SceneNode["type"]>(["vector", "boolean", "ellipse", "rect", "group", "frame", "instance", "component"]);
const MAX_ICON = 96;

function onlyShapes(doc: NagmaDocument, node: SceneNode, depth = 0): boolean {
    if (depth > 20 || !SHAPE_TYPES.has(node.type)) return false;
    if (node.fills.some((p) => p.visible && p.type === "image")) return false;
    return node.children.every((id) => {
        const c = doc.nodes[id];
        return !c || !c.visible || onlyShapes(doc, c, depth + 1);
    });
}

function isIcon(doc: NagmaDocument, node: SceneNode): boolean {
    if (!node.visible || node.w > MAX_ICON || node.h > MAX_ICON || node.w < 4 || node.h < 4) return false;
    // A lone rectangle or ellipse is a box, not an icon.
    if ((node.type === "rect" || node.type === "ellipse") && !node.children.length) return false;
    const containers = node.type === "group" || node.type === "frame" || node.type === "instance" || node.type === "component";
    if (containers && !node.children.length) return false;
    return onlyShapes(doc, node);
}

// The outermost icons in the layer (the layer itself when it is one).
function iconsIn(doc: NagmaDocument, node: SceneNode): SceneNode[] {
    const out: SceneNode[] = [];
    const walk = (n: SceneNode, depth: number) => {
        if (out.length >= 12 || depth > 30) return;
        if (isIcon(doc, n)) {
            out.push(n);
            return;
        }
        for (const id of n.children) {
            const c = doc.nodes[id];
            if (c) walk(c, depth + 1);
        }
    };
    walk(node, 0);
    return out;
}

export function IconAssets({ node, doc }: { node: SceneNode; doc: NagmaDocument }) {
    const icons = iconsIn(doc, node);
    if (!icons.length) return null;
    const save = (id: string, format: "svg" | "png") => {
        exportLayers(doc, [id], format, format === "png" ? 2 : 1).catch(() => editor.notify("Couldn't export that icon."));
    };
    return (
        <div className="border-b border-panel-border px-3 py-2.5">
            <div className="mb-1.5 flex h-6 items-center justify-between">
                <span className="font-semibold">Assets</span>
                <span className="text-ink-subtle">{icons.length === 1 ? "1 icon" : `${icons.length} icons`}</span>
            </div>
            <div className="space-y-1">
                {icons.map((icon) => (
                    <div key={icon.id} className="flex items-center gap-2">
                        <img src={renderThumb(doc, 48, 48, icon.id)} alt="" className="size-8 shrink-0 rounded border border-panel-border" />
                        <span className="min-w-0 flex-1 truncate">{icon.name}</span>
                        <button type="button" onClick={() => save(icon.id, "svg")} className="h-6 rounded px-1.5 text-brand-500 hover:bg-panel-hover" aria-label={`Download ${icon.name} as SVG`}>
                            SVG
                        </button>
                        <button type="button" onClick={() => save(icon.id, "png")} className="h-6 rounded px-1.5 text-brand-500 hover:bg-panel-hover" aria-label={`Download ${icon.name} as PNG at 2x`}>
                            PNG
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
