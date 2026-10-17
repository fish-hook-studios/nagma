import { runPlugin, usePlugins } from "../engine/plugins";
import { useEditor } from "../engine/store";
import type { SceneNode } from "../engine/types";

type Relaunch = Record<string, Record<string, string>> | undefined;

interface Button {
    pluginId: string;
    command: string;
    name: string;
    description: string;
}

// Relaunch buttons plugins put on layers (setRelaunchData): shown at the top of the Design panel for
// the selection, or for the page and the file when nothing is selected. With several layers selected
// only buttons every layer has, and that the plugin allows for several layers, show. A click runs the
// plugin with that command.
export function RelaunchButtons({ nodes }: { nodes: SceneNode[] }) {
    const plugins = usePlugins((s) => s.plugins);
    const page = useEditor((s) => s.doc.nodes[s.pageId]);
    const docRelaunch = useEditor((s) => s.doc.relaunchData);
    const sources: Relaunch[] = nodes.length ? nodes.map((n) => n.relaunchData) : [page?.relaunchData, docRelaunch];
    const buttons: Button[] = [];
    const seen = new Set<string>();
    for (const plugin of plugins) {
        for (const def of plugin.manifest.relaunchButtons ?? []) {
            const key = `${plugin.id}:${def.command}`;
            if (seen.has(key)) continue;
            const holders = sources.filter((r) => r?.[plugin.id]?.[def.command] !== undefined);
            if (nodes.length > 1 && (!def.multipleSelection || holders.length !== nodes.length)) continue;
            if (!holders.length) continue;
            seen.add(key);
            const descriptions = holders.map((r) => r?.[plugin.id]?.[def.command] ?? "");
            buttons.push({ pluginId: plugin.id, command: def.command, name: def.name, description: descriptions.every((d) => d === descriptions[0]) ? (descriptions[0] ?? "") : "" });
        }
    }
    if (!buttons.length) return null;
    return (
        <section aria-label="Plugin buttons" className="space-y-1 border-b border-panel-border px-3 py-2.5">
            {buttons.map((b) => (
                <button
                    key={`${b.pluginId}:${b.command}`}
                    type="button"
                    onClick={() => runPlugin(b.pluginId, b.command)}
                    className="flex w-full flex-col items-start rounded-md border border-panel-border px-2 py-1.5 text-left hover:bg-panel-hover"
                >
                    <span className="font-medium text-ink">{b.name}</span>
                    {b.description && <span className="text-[11px] text-ink-muted">{b.description}</span>}
                </button>
            ))}
        </section>
    );
}
