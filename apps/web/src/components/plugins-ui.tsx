import { Code02, Trash01, XClose } from "@untitledui/icons";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Menu as AriaMenu, MenuTrigger as AriaMenuTrigger, Popover as AriaPopover } from "react-aria-components";
import { insertWidget } from "../engine/widgets";
import { clearPluginConsole, closePluginConsole, closeRunningPlugin, isCodegen, isWidget, openPluginConsole, pickPluginManifest, pluginCommands, postFromPluginUi, removePlugin, runLastPlugin, runPlugin, runsIn, type StoredPlugin, usePlugins } from "../engine/plugins";
import { useEditor } from "../engine/store";
import { MenuRow } from "./left-sidebar";

// The plugin's window (its UI in a sandboxed frame, moved by its title bar) and the plugin console.
export function PluginHost() {
    return (
        <>
            <PluginWindowView />
            <PluginConsole />
        </>
    );
}

function useDrag(initial: { x: number; y: number }) {
    const [pos, setPos] = useState(initial);
    const start = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const from = { x: e.clientX - pos.x, y: e.clientY - pos.y };
        const move = (ev: PointerEvent) => setPos({ x: Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - from.x)), y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - from.y)) });
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    return { pos, setPos, start };
}

function PluginWindowView() {
    const win = usePlugins((s) => s.window);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const { pos, setPos, start } = useDrag({ x: window.innerWidth - 380, y: 72 });
    const sessionId = win?.sessionId;
    const wx = win?.x;
    const wy = win?.y;
    useEffect(() => {
        if (wx != null && wy != null) setPos({ x: wx, y: wy });
    }, [wx, wy, setPos]);
    useEffect(() => {
        if (sessionId == null) return;
        // Messages from the window's page: { pluginMessage } to the plugin's main code.
        const fromUi = (event: MessageEvent) => {
            if (event.source !== frameRef.current?.contentWindow) return;
            const data = event.data as { pluginMessage?: unknown } | null;
            if (data && typeof data === "object" && "pluginMessage" in data) postFromPluginUi(sessionId, data.pluginMessage);
        };
        // And back: nagma.ui.postMessage arrives as { pluginMessage }.
        const toUi = (event: Event) => {
            const detail = (event as CustomEvent<{ sessionId: number; data: unknown }>).detail;
            if (detail.sessionId === sessionId) frameRef.current?.contentWindow?.postMessage({ pluginMessage: detail.data }, "*");
        };
        window.addEventListener("message", fromUi);
        window.addEventListener("nagma-plugin-ui", toUi);
        return () => {
            window.removeEventListener("message", fromUi);
            window.removeEventListener("nagma-plugin-ui", toUi);
        };
    }, [sessionId]);
    if (!win) return null;
    return (
        <div role="dialog" aria-label={win.title} className="fixed z-40 overflow-hidden rounded-lg border border-panel-border bg-panel shadow-2xl" style={{ left: pos.x, top: pos.y, width: win.width, display: win.visible ? undefined : "none" }}>
            <div onPointerDown={start} className="flex h-9 cursor-grab items-center justify-between gap-2 border-b border-panel-border pr-1 pl-3 select-none">
                <span className="truncate text-[11px] font-semibold text-ink">{win.title}</span>
                <button type="button" aria-label="Close plugin" onClick={() => closeRunningPlugin()} className="flex size-7 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                    <XClose className="size-3.5" />
                </button>
            </div>
            <iframe ref={frameRef} key={win.sessionId} title={win.title} sandbox="allow-scripts allow-forms allow-popups allow-modals" srcDoc={win.html} className="block w-full border-0 bg-white" style={{ height: win.height }} />
        </div>
    );
}

const LEVEL_TINT = { log: "text-ink", info: "text-ink", debug: "text-ink-muted", warn: "text-amber-600", error: "text-red-500" } as const;

function PluginConsole() {
    const open = usePlugins((s) => s.consoleOpen);
    const entries = usePlugins((s) => s.console);
    const listRef = useRef<HTMLDivElement>(null);
    const { pos, start } = useDrag({ x: 80, y: Math.max(60, window.innerHeight - 320) });
    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [entries.length, open]);
    if (!open) return null;
    return (
        <div role="dialog" aria-label="Plugin console" className="fixed z-40 flex h-[260px] w-[460px] flex-col overflow-hidden rounded-lg border border-panel-border bg-panel shadow-2xl" style={{ left: pos.x, top: pos.y }}>
            <div onPointerDown={start} className="flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-panel-border pr-1 pl-3 select-none">
                <span className="text-[11px] font-semibold text-ink">Console</span>
                <span className="flex items-center">
                    <button type="button" aria-label="Clear console" title="Clear" onClick={clearPluginConsole} className="flex size-7 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                        <Trash01 className="size-3.5" />
                    </button>
                    <button type="button" aria-label="Close console" onClick={closePluginConsole} className="flex size-7 items-center justify-center rounded text-ink-muted hover:bg-panel-hover hover:text-ink">
                        <XClose className="size-3.5" />
                    </button>
                </span>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[10.5px] leading-4" aria-live="polite">
                {entries.length === 0 && <p className="px-3 py-2 font-sans text-[11px] text-ink-muted">Output from console.log in a plugin shows here.</p>}
                {entries.map((e) => (
                    <div key={e.id} className={`flex gap-2 border-b border-panel-border/50 px-3 py-0.5 ${LEVEL_TINT[e.level]}`}>
                        <span className="shrink-0 text-ink-subtle">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                        <span className="shrink-0 text-ink-muted">{e.plugin}</span>
                        <span className="min-w-0 break-words whitespace-pre-wrap">{e.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// The Tools panel's plugin list: the plugins imported here (run, their commands, remove) and the
// Development area (import, run last, console).
export function PluginsSection({ query }: { query: string }) {
    const plugins = usePlugins((s) => s.plugins);
    const last = usePlugins((s) => s.last);
    const dev = useEditor((s) => s.mode === "dev");
    const q = query.trim().toLowerCase();
    const shown = plugins.filter((p) => !isWidget(p) && (!q || p.manifest.name.toLowerCase().includes(q)));
    const lastPlugin = last && plugins.find((p) => p.id === last.pluginId);
    return (
        <div className="pb-2">
            <div className="flex items-center justify-between px-2 pt-2 pb-1">
                <span className="text-ink-muted">Plugins</span>
            </div>
            {shown.length === 0 && <p className="px-2 py-1 text-ink-muted">{plugins.length ? "No plugins match." : "Plugins you import show here."}</p>}
            {shown.map((p) => (
                <PluginRow key={p.id} plugin={p} dev={dev} />
            ))}
            <div className="px-2 pt-3 pb-1 text-ink-muted">Development</div>
            <DevRow label="Import plugin from manifest…" onPress={pickPluginManifest} />
            <DevRow label={lastPlugin ? `Run last plugin: ${lastPlugin.manifest.name}` : "Run last plugin"} shortcut="⌥⌘P" disabled={!lastPlugin} onPress={runLastPlugin} />
            <DevRow label="Open console" onPress={openPluginConsole} />
        </div>
    );
}

// Widgets: the ones imported here, each inserted on the canvas, and importing more from a manifest.
export function WidgetsSection({ query }: { query: string }) {
    const plugins = usePlugins((s) => s.plugins);
    const dev = useEditor((s) => s.mode === "dev");
    const q = query.trim().toLowerCase();
    const widgets = plugins.filter((p) => isWidget(p) && (!q || p.manifest.name.toLowerCase().includes(q)));
    return (
        <div id="tools-widgets" className="pb-2">
            <div className="px-2 pt-2 pb-1 text-ink-muted">Widgets</div>
            {widgets.length === 0 && <p className="px-2 py-1 text-ink-muted">{q ? "No widgets match." : "Widgets you import show here. A widget puts interactive layers on the canvas."}</p>}
            {widgets.map((w) => (
                <div key={w.id} className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-panel-hover">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#5B3FB8] text-[16px] text-white">✦</span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px]">{w.manifest.name}</span>
                        <span className="block truncate text-ink-muted">Development · Widget</span>
                    </span>
                    <button type="button" disabled={dev} onClick={() => void insertWidget(w.id, w.manifest.name)} className="flex h-7 items-center rounded-md border border-panel-border px-2 text-ink hover:bg-panel disabled:opacity-40">
                        Insert
                    </button>
                </div>
            ))}
            <DevRow label="Import widget from manifest…" onPress={pickPluginManifest} />
        </div>
    );
}

function DevRow({ label, shortcut, disabled, onPress }: { label: string; shortcut?: string; disabled?: boolean; onPress: () => void }) {
    return (
        <button type="button" disabled={disabled} onClick={onPress} className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left hover:bg-panel-hover disabled:opacity-40">
            <span className="truncate">{label}</span>
            {shortcut && <span className="text-ink-subtle">{shortcut}</span>}
        </button>
    );
}

function PluginRow({ plugin, dev }: { plugin: StoredPlugin; dev: boolean }) {
    const codegen = isCodegen(plugin);
    const commands = pluginCommands(plugin);
    const runnable = runsIn(plugin, dev ? "inspect" : "design");
    const kind = codegen ? `Code: ${(plugin.manifest.codegenLanguages ?? []).map((l) => l.label).join(", ")}` : (plugin.manifest.editorType ?? ["design"]).map((t) => (t === "dev" || t === "inspect" ? "Inspect" : "Design")).join(", ");
    return (
        <div className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-panel-hover">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#394760] text-white">
                <Code02 className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px]">{plugin.manifest.name}</span>
                <span className="block truncate text-ink-muted">Development · {kind}</span>
            </span>
            <AriaMenuTrigger>
                <AriaButton aria-label={`${plugin.manifest.name} options`} className="flex h-7 items-center rounded-md border border-panel-border px-2 text-ink outline-none hover:bg-panel">
                    {codegen ? "Options" : "Run"}
                </AriaButton>
                <AriaPopover placement="bottom end" className="w-60 rounded-lg bg-tooltip p-1 text-white shadow-xl outline-none">
                    <AriaMenu
                        className="outline-none"
                        disabledKeys={runnable ? [] : ["run", ...commands.map((c) => `cmd:${c.command}`)]}
                        onAction={(k) => {
                            const key = String(k);
                            if (key === "run") runPlugin(plugin.id);
                            else if (key.startsWith("cmd:")) runPlugin(plugin.id, key.slice(4));
                            else if (key === "remove") void removePlugin(plugin.id);
                            else if (key === "console") openPluginConsole();
                        }}
                    >
                        {!codegen && commands.length === 0 && <MenuRow id="run" label={runnable ? "Run" : dev ? "Runs in Design" : "Runs in Inspect"} />}
                        {!codegen && commands.map((c) => <MenuRow key={c.command} id={`cmd:${c.command}`} label={c.label} />)}
                        <MenuRow id="console" label="Open console" />
                        <MenuRow id="remove" label="Remove plugin" />
                    </AriaMenu>
                </AriaPopover>
            </AriaMenuTrigger>
        </div>
    );
}
