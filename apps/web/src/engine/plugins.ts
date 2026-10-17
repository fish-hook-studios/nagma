import { useSyncExternalStore } from "react";
import { fitRect } from "./camera";
import { cssFor } from "./dev-css";
import { renderExport } from "./export";
import { exportSvg } from "./export-svg";
import { cloneSubtree, makeNode, selectionBounds } from "./nodes";
import { SANDBOX_SOURCE } from "./plugin-sandbox";
import { pluginAllowedInInspect } from "./inspect-settings";
import { legacyStorageReady } from "./legacy-names";
import { editor } from "./store";
import type { Command, NagmaDocument, NodePatch, NodeType, SceneNode } from "./types";
import { userStorage } from "./user-storage";

// Plugins: small programs people write against the `nagma` API (modelled on the public plugin API's
// shape). A plugin is a manifest plus a main script, and optionally an HTML file for its window. They
// are imported from disk (Plugins › Development › Import plugin from manifest…) and kept in this
// browser's IndexedDB. Each run happens in a sandboxed iframe with an opaque origin, which sees a
// snapshot of the file and sends back operations the editor applies as one undoable step. Codegen
// plugins add languages to Inspect's Code section and answer "generate" for the selected layer.

export interface PluginManifest {
    name: string;
    id: string;
    api?: string;
    main: string;
    ui?: string | Record<string, string>;
    // "design" (the editor) and "inspect" (Inspect); "dev" is read as "inspect".
    editorType?: string[];
    capabilities?: string[];
    codegenLanguages?: { label: string; value: string }[];
    menu?: PluginMenuItem[];
    // Buttons the plugin can put on layers with setRelaunchData (shown in the Design panel).
    relaunchButtons?: { command: string; name: string; multipleSelection?: boolean }[];
    networkAccess?: { allowedDomains?: string[] };
}

export type PluginMenuItem = { name: string; command: string } | { separator: true } | { name: string; menu: PluginMenuItem[] };

export interface StoredPlugin {
    id: string;
    manifest: PluginManifest;
    code: string;
    // The UI files by their manifest key ("" for a single `ui`).
    ui: Record<string, string>;
    importedAt: number;
}

export interface ConsoleEntry {
    id: number;
    plugin: string;
    level: "log" | "info" | "warn" | "error" | "debug";
    text: string;
    at: number;
}

export interface PluginWindow {
    sessionId: number;
    title: string;
    html: string;
    width: number;
    height: number;
    visible: boolean;
    x: number | null;
    y: number | null;
}

interface PluginState {
    plugins: StoredPlugin[];
    loaded: boolean;
    console: ConsoleEntry[];
    consoleOpen: boolean;
    window: PluginWindow | null;
    // The plugin running now (one at a time, as in the reference), and the last one run.
    running: { sessionId: number; pluginId: string } | null;
    last: { pluginId: string; command: string } | null;
}

const LAST_KEY = "nagma.plugins.last";

function readLast(): PluginState["last"] {
    try {
        return JSON.parse(userStorage.getItem(LAST_KEY) ?? "null") as PluginState["last"];
    } catch {
        return null;
    }
}

let state: PluginState = { plugins: [], loaded: false, console: [], consoleOpen: false, window: null, running: null, last: readLast() };
const listeners = new Set<() => void>();

export const pluginStore = {
    get: () => state,
    set(patch: Partial<PluginState>) {
        state = { ...state, ...patch };
        for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function usePlugins<T>(selector: (s: PluginState) => T): T {
    return useSyncExternalStore(pluginStore.subscribe, () => selector(state));
}

// ---- Storage ----------------------------------------------------------------------------------

const DB = "nagma.plugins";
const STORE = "plugins";

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
    dbPromise ??= legacyStorageReady().then(() => new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    })).catch((error: unknown) => {
        dbPromise = null;
        throw error;
    });
    return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function loadPlugins(): Promise<StoredPlugin[]> {
    try {
        const d = await db();
        const req = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
        const list = await new Promise<StoredPlugin[]>((resolve, reject) => {
            req.onsuccess = () => resolve(req.result as StoredPlugin[]);
            req.onerror = () => reject(req.error);
        });
        list.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
        pluginStore.set({ plugins: list, loaded: true });
        return list;
    } catch {
        pluginStore.set({ loaded: true });
        return [];
    }
}

async function savePlugin(plugin: StoredPlugin) {
    const d = await db();
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(plugin, plugin.id);
    await done(tx);
    await loadPlugins();
}

export async function removePlugin(id: string) {
    const d = await db();
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await done(tx);
    stopCodegen(id);
    if (state.last?.pluginId === id) setLast(null);
    await loadPlugins();
    editor.notify("Plugin removed.");
}

// ---- Import -----------------------------------------------------------------------------------

function parseManifest(text: string): PluginManifest {
    let raw: Partial<PluginManifest>;
    try {
        raw = JSON.parse(text) as Partial<PluginManifest>;
    } catch {
        throw new Error("The manifest isn't valid JSON.");
    }
    if (!raw.name || typeof raw.name !== "string") throw new Error("The manifest needs a name.");
    if (!raw.main || typeof raw.main !== "string") throw new Error("The manifest needs a main file.");
    const id = typeof raw.id === "string" && raw.id ? raw.id : raw.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return { ...raw, id, name: raw.name, main: raw.main } as PluginManifest;
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function uiEntries(manifest: PluginManifest): [string, string][] {
    if (!manifest.ui) return [];
    return typeof manifest.ui === "string" ? [["", manifest.ui]] : Object.entries(manifest.ui);
}

// From files picked together: the manifest and the files it names (matched by name).
export async function importPluginFiles(files: File[]): Promise<StoredPlugin> {
    const manifestFile = files.find((f) => f.name === "manifest.json") ?? files.find((f) => f.name.endsWith(".json"));
    if (!manifestFile) throw new Error("Pick the plugin's manifest.json.");
    const manifest = parseManifest(await manifestFile.text());
    const byName = (path: string) => files.find((f) => f.name === baseName(path));
    const main = byName(manifest.main);
    if (!main) throw new Error(`Pick ${baseName(manifest.main)} together with the manifest.`);
    const ui: Record<string, string> = {};
    for (const [key, path] of uiEntries(manifest)) {
        const file = byName(path);
        if (!file) throw new Error(`Pick ${baseName(path)} together with the manifest.`);
        ui[key] = await file.text();
    }
    return finishImport(manifest, await main.text(), ui);
}

// From a manifest's URL, with its files next to it (the sample plugins under /plugins/).
export async function importPluginFromUrl(url: string): Promise<StoredPlugin> {
    const base = new URL(url, location.href);
    const res = await fetch(base);
    if (!res.ok) throw new Error("Couldn't load the manifest.");
    const manifest = parseManifest(await res.text());
    const fetchText = async (path: string) => {
        const r = await fetch(new URL(path, base));
        if (!r.ok) throw new Error(`Couldn't load ${path}.`);
        return r.text();
    };
    const ui: Record<string, string> = {};
    for (const [key, path] of uiEntries(manifest)) ui[key] = await fetchText(path);
    return finishImport(manifest, await fetchText(manifest.main), ui);
}

async function finishImport(manifest: PluginManifest, code: string, ui: Record<string, string>): Promise<StoredPlugin> {
    const plugin: StoredPlugin = { id: manifest.id, manifest, code, ui, importedAt: Date.now() };
    const existed = state.plugins.some((p) => p.id === plugin.id);
    await savePlugin(plugin);
    stopCodegen(plugin.id);
    editor.notify(existed ? `Updated ${manifest.name}.` : `Imported ${manifest.name}.`);
    return plugin;
}

// Plugins › Development › Import plugin from manifest…
export function pickPluginManifest() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.js,.html,application/json,text/javascript,text/html";
    input.onchange = () => {
        const files = Array.from(input.files ?? []);
        if (files.length) void importPluginFiles(files).catch((e: unknown) => editor.notify(e instanceof Error ? e.message : String(e)));
    };
    input.click();
}

// ---- Kinds ------------------------------------------------------------------------------------

export function isCodegen(p: StoredPlugin): boolean {
    return Boolean(p.manifest.capabilities?.includes("codegen") && p.manifest.codegenLanguages?.length);
}

export function runsIn(p: StoredPlugin, where: "design" | "inspect"): boolean {
    const types = (p.manifest.editorType ?? ["design"]).map((t) => (t === "dev" ? "inspect" : t));
    if (isCodegen(p) || isWidget(p)) return false;
    // The file's team may allow only some plugins in Inspect.
    if (where === "inspect" && !pluginAllowedInInspect(p.id)) return false;
    return types.includes(where) || (where === "design" && !types.length);
}

// Menu commands, flattened with their paths ("Sub › Command").
export function pluginCommands(p: StoredPlugin): { label: string; command: string }[] {
    const out: { label: string; command: string }[] = [];
    const walk = (items: PluginMenuItem[], path: string[]) => {
        for (const item of items) {
            if ("command" in item) out.push({ label: [...path, item.name].join(" › "), command: item.command });
            else if ("menu" in item) walk(item.menu, [...path, item.name]);
        }
    };
    walk(p.manifest.menu ?? [], []);
    return out;
}

// Inspect's languages from codegen plugins: ids are "plugin:<plugin id>:<language value>".
export interface PluginLanguage {
    id: string;
    pluginId: string;
    plugin: string;
    label: string;
    value: string;
}

export function pluginLanguages(plugins: StoredPlugin[] = state.plugins): PluginLanguage[] {
    return plugins.filter(isCodegen).flatMap((p) => (p.manifest.codegenLanguages ?? []).map((l) => ({ id: `plugin:${p.id}:${l.value}`, pluginId: p.id, plugin: p.manifest.name, label: l.label, value: l.value })));
}

export function parsePluginLang(id: string): { pluginId: string; value: string } | null {
    const m = /^plugin:(.+):([^:]+)$/.exec(id);
    return m ? { pluginId: m[1] as string, value: m[2] as string } : null;
}

// ---- Console ----------------------------------------------------------------------------------

let consoleSeq = 0;
function log(plugin: string, level: ConsoleEntry["level"], text: string) {
    const entry: ConsoleEntry = { id: ++consoleSeq, plugin, level, text, at: Date.now() };
    pluginStore.set({ console: [...state.console, entry].slice(-500) });
}

export function openPluginConsole() {
    pluginStore.set({ consoleOpen: true });
}

export function closePluginConsole() {
    pluginStore.set({ consoleOpen: false });
}

export function clearPluginConsole() {
    pluginStore.set({ console: [] });
}

// ---- Sessions ---------------------------------------------------------------------------------

type Mode = "default" | "codegen" | "inspect" | "widget";

// A widget's layers as its code described them (engine/widgets.ts turns them into layers).
export interface WidgetElement {
    type: string;
    props: Record<string, unknown>;
    // Index of the element's click handler in the widget's code, if it has one.
    handler: number | null;
    text?: string;
    children: WidgetElement[];
}

interface Session {
    id: number;
    plugin: StoredPlugin;
    mode: Mode;
    frame: HTMLIFrameElement;
    ready: Promise<void>;
    pending: Map<number, { resolve: (v: { title: string; code: string; language: string }[]) => void; reject: (e: Error) => void; timer: number }>;
    unsubscribe: () => void;
    // The undo entry of its last edit: a plugin run is one undo step while nothing else edits between.
    committed: unknown;
    widgetPending?: Map<number, { resolve: (v: { tree: WidgetElement; state: Record<string, unknown> }) => void; reject: (e: Error) => void; timer: number }>;
}

let sessionSeq = 0;
let requestSeq = 0;
const sessions = new Map<number, Session>();
const codegenSessions = new Map<string, Session>();

const NODE_SKIP = new Set(["devReady"]);

function snapshot(doc: NagmaDocument = editor.get().doc) {
    const s = editor.get();
    const nodes: Record<string, Partial<SceneNode>> = {};
    for (const [id, node] of Object.entries(doc.nodes)) {
        const copy: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) if (!NODE_SKIP.has(k)) copy[k] = v;
        nodes[id] = copy as Partial<SceneNode>;
    }
    const pageIds = Object.values(doc.nodes)
        .filter((n) => n.type === "page")
        .map((n) => n.id);
    const docData = { pluginData: doc.pluginData ?? {}, relaunchData: doc.relaunchData ?? {} };
    return { nodes, pageIds: doc.roots.filter((id) => pageIds.includes(id)), pageId: s.pageId, selection: s.selection, docName: doc.name, docData, editorType: s.mode === "dev" ? "inspect" : "design" };
}

function csp(manifest: PluginManifest): string {
    const domains = (manifest.networkAccess?.allowedDomains ?? []).filter((d) => d !== "none");
    const connect = domains.includes("*") ? "*" : domains.length ? domains.join(" ") : "'none'";
    return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src ${connect}; img-src data: blob:`;
}

function startSession(plugin: StoredPlugin, mode: Mode, command: string): Session {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.title = `${plugin.manifest.name} runtime`;
    frame.style.display = "none";
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp(plugin.manifest)}"><script>${SANDBOX_SOURCE.replace(/<\/script/gi, "<\\/script")}</script>`;
    frame.srcdoc = html;
    let markReady: () => void = () => undefined;
    const session: Session = { id: ++sessionSeq, plugin, mode, frame, ready: new Promise((r) => (markReady = r)), pending: new Map(), unsubscribe: () => undefined, committed: null };
    const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow) return;
        const msg = event.data as { kind: string } & Record<string, unknown>;
        if (msg.kind === "ready") {
            const ui = plugin.ui[""] ?? "";
            frame.contentWindow?.postMessage({ kind: "init", code: plugin.code, manifest: plugin.manifest, html: ui, uiFiles: plugin.ui, snapshot: { ...snapshot(), mode, command } }, "*");
        } else {
            // Its top-level code has run (or failed): requests can go in now.
            if (msg.kind === "started" || msg.kind === "close") markReady();
            handleMessage(session, msg);
        }
    };
    window.addEventListener("message", onMessage);
    // Selection, page and document changes reach the plugin as events, with a fresh snapshot.
    let last = editor.get();
    let timer = 0;
    const unsubEditor = editor.subscribe(() => {
        const s = editor.get();
        const selection = s.selection !== last.selection;
        const page = s.pageId !== last.pageId;
        const docChanged = s.doc !== last.doc;
        last = s;
        if (!selection && !page && !docChanged) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            const post = (event: string, args: unknown[] = []) => frame.contentWindow?.postMessage({ kind: "event", event, args, snapshot: snapshot() }, "*");
            if (page) post("currentpagechange");
            if (selection) post("selectionchange");
            if (docChanged && !selection && !page) post("documentchange", [{ documentChanges: [] }]);
        }, 30);
    });
    session.unsubscribe = () => {
        window.removeEventListener("message", onMessage);
        unsubEditor();
        window.clearTimeout(timer);
    };
    document.body.appendChild(frame);
    sessions.set(session.id, session);
    return session;
}

function endSession(session: Session) {
    session.unsubscribe();
    session.frame.remove();
    sessions.delete(session.id);
    for (const p of [...session.pending.values(), ...(session.widgetPending?.values() ?? [])]) {
        window.clearTimeout(p.timer);
        p.reject(new Error("The plugin stopped."));
    }
    if (codegenSessions.get(session.plugin.id) === session) codegenSessions.delete(session.plugin.id);
    if (state.running?.sessionId === session.id) pluginStore.set({ running: null, window: state.window?.sessionId === session.id ? null : state.window });
}

function setLast(last: PluginState["last"]) {
    pluginStore.set({ last });
    try {
        userStorage.setItem(LAST_KEY, JSON.stringify(last));
    } catch {
        // Fine: "Run last plugin" lasts for the session.
    }
}

// Runs a plugin (or one of its menu commands). Only one runs at a time; starting another closes it.
export function runPlugin(pluginId: string, command = "") {
    const plugin = state.plugins.find((p) => p.id === pluginId);
    if (!plugin) {
        editor.notify("That plugin isn't installed any more.");
        return;
    }
    if (editor.get().mode === "dev" && !pluginAllowedInInspect(pluginId)) {
        editor.notify("Your team's admins haven't allowed this plugin in Inspect.");
        return;
    }
    if (state.running) {
        const current = sessions.get(state.running.sessionId);
        if (current) endSession(current);
    }
    const mode: Mode = editor.get().mode === "dev" ? "inspect" : "default";
    const session = startSession(plugin, mode, command);
    pluginStore.set({ running: { sessionId: session.id, pluginId } });
    setLast({ pluginId, command });
}

// ⌥⌘P
export function runLastPlugin() {
    const last = state.last;
    if (!last || !state.plugins.some((p) => p.id === last.pluginId)) {
        editor.notify("No plugin has run yet. Import one from Plugins › Development.");
        return;
    }
    runPlugin(last.pluginId, last.command);
}

export function closeRunningPlugin(message?: string | null) {
    const running = state.running && sessions.get(state.running.sessionId);
    if (running) endSession(running);
    if (message) editor.notify(message);
}

// The plugin's window sends a message to its main code.
export function postFromPluginUi(sessionId: number, data: unknown) {
    sessions.get(sessionId)?.frame.contentWindow?.postMessage({ kind: "ui-message", data, snapshot: snapshot() }, "*");
}

const PATCH_KEYS = new Set(["name", "x", "y", "w", "h", "rotation", "opacity", "visible", "locked", "fills", "strokes", "strokeWidth", "strokeAlign", "radius", "radii", "text", "fontSize", "fontFamily", "fontWeight", "italic", "textAlign", "layout", "pluginData", "relaunchData"]);
// What a plugin may keep on a layer even where it can't edit it (Inspect, view-only files).
const DATA_KEYS = new Set(["pluginData", "relaunchData"]);
const CREATE_TYPES = new Set<NodeType>(["rect", "ellipse", "frame", "text"]);

function cleanPatch(patch: Record<string, unknown>): NodePatch {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (PATCH_KEYS.has(k)) out[k] = v;
    return out as NodePatch;
}

type Op =
    | { op: "update"; id: string; patch: Record<string, unknown> }
    | { op: "create"; nodeType: NodeType; node: Record<string, unknown> }
    | { op: "reparent"; id: string; parentId: string; index: number }
    | { op: "move"; id: string; dx: number; dy: number }
    | { op: "delete"; id: string }
    | { op: "clone"; id: string; newId: string }
    | { op: "select"; ids: string[] }
    | { op: "zoom"; ids: string[] }
    | { op: "page"; id: string }
    | { op: "doc"; patch: { pluginData?: Record<string, string>; relaunchData?: Record<string, Record<string, string>> } };

function applyOps(session: Session, ops: Op[]) {
    const s = editor.get();
    // Inspect is read-only: plugins there may only keep their own data on layers.
    const readOnly = s.readOnly || s.mode === "dev";
    const commands: Command[] = [];
    let doc = s.doc;
    let refused = false;
    // Selection, viewport and page changes wait until the edits are in.
    const after: (() => void)[] = [];
    for (const op of ops) {
        if (op.op === "select") {
            after.push(() => editor.set({ selection: op.ids.filter((id) => editor.get().doc.nodes[id]) }));
            continue;
        }
        if (op.op === "zoom") {
            after.push(() => {
                const d = editor.get().doc;
                const box = selectionBounds(d, op.ids.filter((id) => d.nodes[id]));
                if (box) fitRect(box);
            });
            continue;
        }
        if (op.op === "page") {
            after.push(() => {
                if (editor.get().doc.nodes[op.id]?.type === "page") editor.setPage(op.id);
            });
            continue;
        }
        if (op.op === "doc") {
            const patch: { pluginData?: Record<string, string>; relaunchData?: Record<string, Record<string, string>> } = {};
            if (op.patch.pluginData) patch.pluginData = op.patch.pluginData;
            if (op.patch.relaunchData) patch.relaunchData = op.patch.relaunchData;
            if (s.readOnly) refused = true;
            else commands.push({ type: "doc.settings", patch });
            continue;
        }
        if (readOnly && !(op.op === "update" && Object.keys(op.patch).every((k) => DATA_KEYS.has(k)) && !s.readOnly)) {
            refused = true;
            continue;
        }
        if (op.op === "update") {
            if (!doc.nodes[op.id]) continue;
            commands.push({ type: "node.update", id: op.id, patch: cleanPatch(op.patch) });
        } else if (op.op === "create") {
            if (!CREATE_TYPES.has(op.nodeType)) continue;
            const n = op.node;
            const parentId = typeof n.parentId === "string" && doc.nodes[n.parentId] ? n.parentId : s.pageId;
            const node = makeNode(doc, op.nodeType, { x: Number(n.x) || 0, y: Number(n.y) || 0, w: Number(n.w) || 100, h: Number(n.h) || 100 }, parentId, { ...cleanPatch(n), id: String(n.id) });
            commands.push({ type: "node.create", node });
            doc = { ...doc, nodes: { ...doc.nodes, [node.id]: node } };
        } else if (op.op === "reparent") {
            if (doc.nodes[op.id] && doc.nodes[op.parentId]) commands.push({ type: "node.reparent", id: op.id, parentId: op.parentId, index: op.index });
        } else if (op.op === "move") {
            if (doc.nodes[op.id] && Number.isFinite(op.dx) && Number.isFinite(op.dy)) commands.push({ type: "node.move", ids: [op.id], dx: op.dx, dy: op.dy });
        } else if (op.op === "delete") {
            if (doc.nodes[op.id]) commands.push({ type: "node.delete", ids: [op.id] });
        } else if (op.op === "clone") {
            const source = doc.nodes[op.id];
            if (!source) continue;
            const copies = cloneSubtree(doc, op.id, 0, source.parentId, (old) => (old === op.id ? op.newId : `${op.newId}-${Math.random().toString(36).slice(2, 8)}`));
            for (const node of copies) commands.push({ type: "node.create", node });
        }
    }
    if (refused) log(session.plugin.manifest.name, "error", "Inspect is read-only: the plugin's changes to layers were not applied.");
    if (commands.length) {
        editor.execute(commands.length === 1 ? (commands[0] as Command) : { type: "batch", commands });
        if (session.committed && editor.get().past.at(-2) === session.committed) editor.mergeLast();
        session.committed = editor.get().past.at(-1) ?? null;
    }
    for (const fn of after) fn();
}

async function answer(method: string, args: Record<string, unknown>, plugin: StoredPlugin): Promise<unknown> {
    const doc = editor.get().doc;
    if (method === "css") {
        const node = doc.nodes[String(args.id)];
        if (!node) throw new Error("The node was removed.");
        const out: Record<string, string> = {};
        for (const line of cssFor(node, doc.images, doc).split("\n")) {
            const m = /^\s*([\w-]+)\s*:\s*(.+?);?\s*$/.exec(line);
            if (m) out[m[1] as string] = m[2] as string;
        }
        return out;
    }
    if (method === "export") {
        const id = String(args.id);
        const format = String(args.format).toUpperCase();
        if (format === "SVG_STRING") return exportSvg(doc, id) ?? "";
        const file = await renderExport(doc, id, { format: format === "JPG" ? "jpg" : format === "SVG" ? "svg" : format === "PDF" ? "pdf" : "png", scale: Number(args.scale) || 1, suffix: "" });
        if (!file) throw new Error("Couldn't export the node.");
        return new Uint8Array(await file.blob.arrayBuffer());
    }
    if (method === "group") {
        const ids = (args.ids as string[]).filter((id) => doc.nodes[id]);
        if (!ids.length) throw new Error("Nothing to group.");
        const { groupSelection } = await import("./actions");
        editor.set({ selection: ids });
        groupSelection();
        return editor.get().selection[0] ?? null;
    }
    const storageKey = (key: string) => `nagma.plugin.${plugin.id}.${key}`;
    if (method === "storage-get") {
        const raw = userStorage.getItem(storageKey(String(args.key)));
        return raw == null ? undefined : (JSON.parse(raw) as unknown);
    }
    if (method === "storage-set") {
        if (args.value === undefined) userStorage.removeItem(storageKey(String(args.key)));
        else userStorage.setItem(storageKey(String(args.key)), JSON.stringify(args.value));
        return undefined;
    }
    if (method === "storage-keys") {
        const prefix = storageKey("");
        return userStorage.keys(prefix).map((k) => k.slice(prefix.length));
    }
    throw new Error(`Unknown request ${method}.`);
}

function handleMessage(session: Session, msg: { kind: string } & Record<string, unknown>) {
    const name = session.plugin.manifest.name;
    const post = (data: unknown) => session.frame.contentWindow?.postMessage(data, "*");
    switch (msg.kind) {
        case "console":
            log(name, (msg.level as ConsoleEntry["level"]) ?? "log", String(msg.text));
            break;
        case "ops":
            applyOps(session, msg.ops as Op[]);
            break;
        case "request":
            void answer(String(msg.method), (msg.args as Record<string, unknown>) ?? {}, session.plugin).then(
                (result) => post({ kind: "response", id: msg.id, result, snapshot: snapshot() }),
                (e: unknown) => post({ kind: "response", id: msg.id, error: e instanceof Error ? e.message : String(e) }),
            );
            break;
        case "notify":
            editor.notify(String(msg.message));
            if (msg.error) log(name, "error", String(msg.message));
            break;
        case "notify-cancel":
            editor.set({ toast: null });
            break;
        case "ui-show": {
            if (session.mode === "codegen") break;
            const o = (msg.options ?? {}) as { width?: number; height?: number; title?: string; visible?: boolean; position?: { x: number; y: number } };
            pluginStore.set({ window: { sessionId: session.id, html: String(msg.html), title: o.title ?? name, width: Math.max(70, o.width ?? 300), height: Math.max(0, o.height ?? 200), visible: o.visible !== false, x: o.position?.x ?? null, y: o.position?.y ?? null } });
            break;
        }
        case "ui-visible":
        case "ui-resize":
        case "ui-move":
        case "ui-close": {
            const w = state.window;
            if (!w || w.sessionId !== session.id) break;
            if (msg.kind === "ui-close") pluginStore.set({ window: null });
            else if (msg.kind === "ui-visible") pluginStore.set({ window: { ...w, visible: Boolean(msg.visible) } });
            else if (msg.kind === "ui-resize") pluginStore.set({ window: { ...w, width: Math.max(70, Number(msg.width) || w.width), height: Math.max(0, Number(msg.height) || w.height) } });
            else pluginStore.set({ window: { ...w, x: Number(msg.x), y: Number(msg.y) } });
            break;
        }
        case "ui-post":
            window.dispatchEvent(new CustomEvent("nagma-plugin-ui", { detail: { sessionId: session.id, data: msg.data } }));
            break;
        case "widget-tree": {
            const p = session.widgetPending?.get(Number(msg.id));
            if (!p) break;
            session.widgetPending?.delete(Number(msg.id));
            window.clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(String(msg.error)));
            else p.resolve({ tree: msg.tree as WidgetElement, state: (msg.state as Record<string, unknown>) ?? {} });
            break;
        }
        case "close":
            if ((session.mode === "codegen" || session.mode === "widget") && !msg.failed) break;
            endSession(session);
            if (msg.message) editor.notify(String(msg.message));
            if (msg.failed) {
                editor.notify(`${name} stopped with an error. Open the console to see it.`);
            }
            break;
        case "generated": {
            const p = session.pending.get(Number(msg.id));
            if (!p) break;
            session.pending.delete(Number(msg.id));
            window.clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(String(msg.error)));
            else p.resolve(msg.results as { title: string; code: string; language: string }[]);
            break;
        }
        case "codegen-refresh":
            window.dispatchEvent(new CustomEvent("nagma-codegen-refresh"));
            break;
    }
}

// ---- Widgets ----------------------------------------------------------------------------------

// Widgets are plugins whose manifest says containsWidget (or names a widgetApi).
export function isWidget(p: StoredPlugin): boolean {
    const m = p.manifest as PluginManifest & { containsWidget?: boolean; widgetApi?: string };
    return Boolean(m.containsWidget || m.widgetApi);
}

// Runs a widget's code once: renders it with `state`, after running the clicked element's handler
// when there is one. Each run is its own sandbox, closed when it answers.
export async function runWidget(pluginId: string, widgetState: Record<string, unknown>, handler: number | null, nodeId = ""): Promise<{ tree: WidgetElement; state: Record<string, unknown> }> {
    if (!state.loaded) await loadPlugins();
    const plugin = state.plugins.find((p) => p.id === pluginId);
    if (!plugin) throw new Error("This widget isn't installed in this browser. Import it from Widgets.");
    const session = startSession(plugin, "widget", "");
    session.widgetPending = new Map();
    try {
        await session.ready;
        if (!sessions.has(session.id)) throw new Error(`${plugin.manifest.name} stopped with an error. Open the plugin console to see it.`);
        const id = ++requestSeq;
        const pending = session.widgetPending;
        return await new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                pending.delete(id);
                reject(new Error(`${plugin.manifest.name} took too long to answer.`));
            }, GENERATE_TIMEOUT);
            pending.set(id, { resolve, reject, timer });
            session.frame.contentWindow?.postMessage({ kind: "widget-run", id, state: widgetState, handler, snapshot: { ...snapshot(), widgetNodeId: nodeId } }, "*");
        });
    } finally {
        endSession(session);
    }
}

// ---- Codegen ----------------------------------------------------------------------------------

function stopCodegen(pluginId: string) {
    const session = codegenSessions.get(pluginId);
    if (session) endSession(session);
}

const GENERATE_TIMEOUT = 5000;

// Code for a layer from a codegen plugin's language. Its sandbox stays up while Inspect uses it.
export async function generateCode(languageId: string, nodeId: string): Promise<{ title: string; code: string; language: string }[]> {
    const parsed = parsePluginLang(languageId);
    if (!parsed) throw new Error("Not a plugin language.");
    if (!state.loaded) await loadPlugins();
    const plugin = state.plugins.find((p) => p.id === parsed.pluginId);
    if (!plugin) throw new Error("The plugin for this language isn't installed.");
    let session = codegenSessions.get(plugin.id);
    if (!session) {
        session = startSession(plugin, "codegen", "");
        codegenSessions.set(plugin.id, session);
    }
    await session.ready;
    if (!sessions.has(session.id)) throw new Error(`${plugin.manifest.name} stopped with an error. Open the plugin console to see it.`);
    const id = ++requestSeq;
    const live = session;
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            live.pending.delete(id);
            reject(new Error(`${plugin.manifest.name} took too long to answer.`));
        }, GENERATE_TIMEOUT);
        live.pending.set(id, { resolve, reject, timer });
        live.frame.contentWindow?.postMessage({ kind: "generate", id, nodeId, language: parsed.value, snapshot: snapshot() }, "*");
    });
}

void loadPlugins();
