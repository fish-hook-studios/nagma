import { useState } from "react";
import { timeAgo } from "../engine/comments";
import { pluginLanguages, usePlugins } from "../engine/plugins";
import { PluginsSection } from "./plugins-ui";
import { worldBounds } from "../engine/transform";
import { round } from "../engine/dev-css";
import { loadCodeSettings } from "../engine/dev-code";
import { useEditor } from "../engine/store";
import { CodeSection, CodeSettingsControls } from "./dev-code";
import { ColorsSection, VariableChip } from "./dev-variables";
import { IconAssets } from "./dev-assets";
import { interactionSummary } from "../engine/interaction-text";
import { AnnotationsSection, ComponentInfo, ConnectToCode, DevExport, DevResources, StatusControl } from "./dev-sections";
import { createElement } from "react";
import { Link01 } from "@untitledui/icons";
import { IconButton } from "./icon-button";
import { ZoomMenu } from "./zoom-menu";
import { copyLink } from "../engine/links";
import { layerIcon } from "./layer-kind";

// The layer's kind under its name, in words.
const KIND_NAMES: Partial<Record<SceneNode["type"], string>> = { frame: "Frame", component: "Component", componentSet: "Component set", instance: "Instance", group: "Group", boolean: "Boolean group", rect: "Rectangle", ellipse: "Ellipse", vector: "Vector", text: "Text" };
import type { SceneNode } from "../engine/types";
import { findVariable, resolveVariable } from "../engine/variables";

// Inspect's right panel, with its two tabs: Inspect (the selection's status, resources, component,
// annotations, code, variables, assets and export, ready to copy) and Plugins.
export function DevPanel() {
    const [tab, setTab] = useState<"inspect" | "plugins">("inspect");
    const tabClass = (on: boolean) => `h-6 rounded-[5px] px-[7.25px] font-semibold ${on ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"}`;
    return (
        <div className="flex h-full flex-col">
            {/* Under the header row, as in Design: the tabs and the zoom menu, then the rule (80 in all). */}
            <div role="tablist" aria-label="Inspect panel" className="flex h-[33px] shrink-0 items-start gap-1 border-b border-panel-border px-2">
                <button type="button" role="tab" aria-selected={tab === "inspect"} onClick={() => setTab("inspect")} className={tabClass(tab === "inspect")}>
                    Inspect
                </button>
                <button type="button" role="tab" aria-selected={tab === "plugins"} onClick={() => setTab("plugins")} className={tabClass(tab === "plugins")}>
                    Plugins
                </button>
                <div className="flex-1" />
                <ZoomMenu />
            </div>
            <div className="min-h-0 flex-1">{tab === "inspect" ? <InspectTab /> : <PluginsTab />}</div>
        </div>
    );
}

// Plugins that run in Inspect, the code languages from codegen plugins, and Development.
function PluginsTab() {
    const plugins = usePlugins((s) => s.plugins);
    const languages = pluginLanguages(plugins);
    return (
        <div className="h-full overflow-y-auto px-2 py-2">
            <PluginsSection query="" />
            {languages.length > 0 && (
                <div className="px-2 pt-1">
                    <div className="pb-1 text-ink-muted">Code languages from plugins</div>
                    {languages.map((l) => (
                        <div key={l.id} className="flex h-7 items-center justify-between gap-2">
                            <span className="truncate">{l.label}</span>
                            <span className="truncate text-ink-subtle">{l.plugin}</span>
                        </div>
                    ))}
                    <p className="mt-1 text-ink-subtle">Pick one in the Code section's language list.</p>
                </div>
            )}
        </div>
    );
}

function InspectTab() {
    const doc = useEditor((s) => s.doc);
    const selection = useEditor((s) => s.selection);
    const [code, setCode] = useState(loadCodeSettings);
    const nodes = selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => Boolean(n));
    const node = nodes[0];
    if (!node) {
        return (
            <div className="p-4 text-ink-muted">
                <div className="font-semibold text-ink">Inspect</div>
                <p className="mt-2">Select a layer to see its properties as code, its variables and its assets.</p>
                <div className="mt-4 mb-1.5 font-semibold text-ink">Code</div>
                <p className="mb-2">The language and unit used for every layer.</p>
                <CodeSettingsControls settings={code} onChange={setCode} />
            </div>
        );
    }
    const bounds = worldBounds(doc, node);
    // When the frame or section holding the selection was last changed.
    let top: SceneNode | undefined = node;
    while (top?.parentId && doc.nodes[top.parentId]?.type !== "page") top = doc.nodes[top.parentId];
    const edited = top?.editedAt;
    // Variables bound on this layer, with what they resolve to.
    const bound = Object.entries(node.boundVariables ?? {}).map(([key, id]) => {
        const found = findVariable(doc, id);
        const r = found ? resolveVariable(doc, id, node) : null;
        return { key, id, name: found?.variable.name ?? "Missing variable", value: r ? String(r.value) : "", color: found?.variable.type === "color" && typeof r?.value === "string" ? r.value : null };
    });
    const images = node.fills.filter((p) => p.type === "image").map((p) => (p.type === "image" ? p.id : "")).filter((id) => doc.images[id]);
    const header = (title: string, action?: React.ReactNode) => (
        <div className="mb-1.5 flex h-6 items-center justify-between">
            <span className="font-semibold">{title}</span>
            {action}
        </div>
    );
    return (
        <div className="flex h-full flex-col overflow-y-auto">
            <div className="border-b border-panel-border px-4 pt-3 pb-3">
                <div className="flex h-6 items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{nodes.length > 1 ? `${nodes.length} layers` : node.name}</span>
                    <IconButton size="sm" icon={Link01} label="Copy link to selection" onPress={() => void copyLink("dev")} />
                </div>
                <div className="mt-2 flex h-6 items-center gap-2 text-ink-muted">
                    {createElement(layerIcon(node), { className: "size-3.5 shrink-0" })}
                    <span className="truncate">{KIND_NAMES[node.type] ?? node.type}</span>
                </div>
                {edited && <div className="text-ink-subtle">Last edited {timeAgo(edited)}</div>}
                <div className="mt-1.5 grid grid-cols-4 gap-x-2 text-ink-muted">
                    <span>X {round(bounds.x)}</span>
                    <span>Y {round(bounds.y)}</span>
                    <span>W {round(node.w)}</span>
                    <span>H {round(node.h)}</span>
                </div>
                {nodes.length === 1 && <StatusControl node={node} doc={doc} />}
            </div>
            {/* Order: connect to code, status, dev resources, component, annotations, layer properties, styles, assets, export. */}
            {nodes.length === 1 && <ConnectToCode node={node} doc={doc} />}
            {nodes.length === 1 && <DevResources node={node} doc={doc} />}
            {nodes.length === 1 && <ComponentInfo node={node} doc={doc} />}
            {nodes.length === 1 && <AnnotationsSection node={node} doc={doc} />}
            <CodeSection node={node} doc={doc} settings={code} onSettings={setCode} />
            {bound.length > 0 && (
                <div className="border-b border-panel-border px-3 py-2.5">
                    {header("Styles and variables")}
                    {bound.map((b) => (
                        <div key={b.key} className="flex items-center">
                            <VariableChip doc={doc} variableId={b.id}>
                                {b.color && <span className="size-3.5 shrink-0 rounded border border-black/20" style={{ background: b.color }} />}
                                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                                <span className="truncate text-ink-muted">{b.value}</span>
                            </VariableChip>
                        </div>
                    ))}
                </div>
            )}
            {nodes.length === 1 && <ColorsSection node={node} doc={doc} />}
            {nodes.length === 1 && (node.interactions?.length ?? 0) > 0 && (
                <div className="border-b border-panel-border px-3 py-2.5">
                    {header("Interactions")}
                    {(node.interactions ?? []).map((it, i) => {
                        const sum = interactionSummary(doc, it);
                        return (
                            <div key={i} className="flex h-6 items-center gap-2 px-1">
                                <span className="shrink-0 text-ink-muted">{sum.trigger}</span>
                                <span className="min-w-0 flex-1 truncate text-right">{sum.action}</span>
                            </div>
                        );
                    })}
                </div>
            )}
            {nodes.length === 1 && <IconAssets node={node} doc={doc} />}
            {images.length > 0 && (
                <div className="border-b border-panel-border px-3 py-2.5">
                    {header("Assets")}
                    <div className="grid grid-cols-3 gap-1.5">
                        {images.map((id) => (
                            <a key={id} href={doc.images[id]} download={`${node.name}.png`} className="block aspect-square overflow-hidden rounded-md border border-panel-border bg-field bg-cover bg-center" style={{ backgroundImage: `url(${doc.images[id]})` }} title="Download" aria-label="Download image" />
                        ))}
                    </div>
                </div>
            )}
            <DevExport key={node.id} nodes={nodes} doc={doc} />
        </div>
    );
}
