import type { HandleMirror, VectorTool, VertexRef } from "../canvas/vector-edit";
import { useSyncExternalStore } from "react";
import { applyCommand, remeasureAllText } from "./commands";
import { type DocPatch, applyPatch, diffDocs, invertPatch } from "./patch";
import { saveDoc } from "./doc-store";
import { makeNode, normalizeNode } from "./nodes";
import { activePage } from "./page";
import { pixelGrid } from "./pixel-grid";
import { createSampleDocument } from "./sample";
import type { Camera, Command, EditorMode, NagmaDocument, Tool } from "./types";
import { userStorage } from "./user-storage";

export type Theme = "dark" | "light";
export type LeftPanel = "layers" | "agents" | "assets" | "tools" | "variables" | "history" | "settings";

// Per-viewer preferences, remembered in this browser.
export interface Prefs {
    theme: Theme;
    rulers: boolean;
    leftPanel: LeftPanel;
    leftPanelOpen: boolean;
    // View menu toggles.
    pixelGrid: boolean;
    outlines: boolean;
    layoutGuides: boolean;
    multiplayerCursors: boolean;
    // Annotations and saved measurements on the canvas (Inspect shows them unless this is off).
    showAnnotations: boolean;
    // Preferences menu.
    snapToObjects: boolean;
    // Point editing: dragged points snap to other layers' points.
    snapToGeometry: boolean;
    snapToPixel: boolean;
    keepTool: boolean;
    highlightHover: boolean;
    showDimensions: boolean;
    invertZoom: boolean;
    // Navigation: the scroll wheel zooms instead of panning; a right-button drag pans.
    scrollZoom: boolean;
    rightClickPan: boolean;
    numberKeysOpacity: boolean;
    renameDuplicates: boolean;
    // Color profile: managed shows colours in the file's profile (sRGB or Display P3); unmanaged
    // always draws the canvas in sRGB.
    colorManaged: boolean;
    // Accessibility: keyboard focus rings on every control, and no interface animations.
    alwaysFocusRings: boolean;
    reduceMotion: boolean;
    // In the browser: file links open in the desktop app (through nagma:// links).
    openLinksInDesktop: boolean;
    // Text: typographic substitutions as you type ("->" to an arrow, "(c)" to ©, "..." to …).
    smartSymbols: boolean;
    pixelPreview: boolean;
    // Pixel preview density: 1x or 2x (a retina screen).
    pixelPreviewScale: 1 | 2;
    // View › Property labels: names under the Design panel's fields.
    propertyLabels: boolean;
    hideUiDuringChanges: boolean;
    flipWhileResizing: boolean;
    nudgeSmall: number;
    nudgeBig: number;
    // Typography: the units the line height and letter spacing fields show.
    lineHeightUnit: "%" | "px";
    letterSpacingUnit: "%" | "px";
    // Draw mode: the pen, marker and pencil share a colour, a size and a stroke style.
    drawColor: string;
    drawSize: number;
    drawStyle: DrawStyle;
    drawHintSeen: boolean;
    // Motion mode's timeline: its height, whether it's collapsed to its header, the unit its time
    // fields use, and how playback repeats.
    timelineHeight: number;
    timelineCollapsed: boolean;
    timeUnit: "ms" | "s";
    playback: "loop" | "once" | "ping-pong";
    // View menu: slices' dashed outlines, outlines on masks and on frames, the memory readout, and
    // the left navigation bar (the rail) folded away while the left panel is open.
    showSlices: boolean;
    maskOutlines: boolean;
    frameOutlines: boolean;
    memoryUsage: boolean;
    railMinimized: boolean;
    // Preferences menu: + and − zoom into the selection; ⌃-click opens the context menu (macOS);
    // ⌘Y toggles outlines too; a sound when the AI chat answers; spell checking while typing text.
    keyboardZoomSelection: boolean;
    ctrlClickMenus: boolean;
    oldOutlineShortcuts: boolean;
    aiChatSound: boolean;
    spellCheck: boolean;
}

export type DrawStyle = "pencil" | "marker" | "ink";

const PREFS_KEY = "nagma.prefs.v1";
const DEFAULT_PREFS: Prefs = {
    theme: "dark",
    rulers: true,
    leftPanel: "layers",
    leftPanelOpen: true,
    pixelGrid: true,
    outlines: false,
    layoutGuides: true,
    multiplayerCursors: true,
    showAnnotations: true,
    snapToObjects: true,
    snapToGeometry: true,
    snapToPixel: true,
    keepTool: false,
    highlightHover: true,
    showDimensions: true,
    invertZoom: false,
    scrollZoom: false,
    rightClickPan: false,
    numberKeysOpacity: true,
    renameDuplicates: true,
    smartSymbols: false,
    colorManaged: true,
    alwaysFocusRings: false,
    reduceMotion: false,
    openLinksInDesktop: false,
    pixelPreview: false,
    pixelPreviewScale: 1,
    propertyLabels: false,
    hideUiDuringChanges: true,
    flipWhileResizing: true,
    nudgeSmall: 1,
    nudgeBig: 10,
    lineHeightUnit: "%",
    letterSpacingUnit: "%",
    drawColor: "#000000",
    drawSize: 4,
    drawStyle: "pencil",
    drawHintSeen: false,
    timelineHeight: 208,
    timelineCollapsed: false,
    timeUnit: "ms",
    playback: "loop",
    showSlices: true,
    maskOutlines: false,
    frameOutlines: false,
    memoryUsage: false,
    railMinimized: false,
    keyboardZoomSelection: false,
    ctrlClickMenus: true,
    oldOutlineShortcuts: false,
    aiChatSound: false,
    spellCheck: false,
};

function loadPrefs(): Prefs {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
    } catch {
        // Fall back to defaults when storage is unavailable.
    }
    return DEFAULT_PREFS;
}

interface HistoryEntry {
    before: NagmaDocument;
    after: NagmaDocument;
    command: Command;
    // The layers the edit touched, so undo and redo bring them back into the selection.
    touched: string[];
    // The selection and page around the step: undo puts the selection back the way it was, and a
    // change of selection on its own is a step too.
    selectionBefore: string[];
    selectionAfter: string[];
    pageId: string;
    selectionOnly?: boolean;
    at: number;
}

// The undo step an edit made in the current task (cleared once the task ends): a selection change
// right after it joins that step instead of becoming one of its own.
let freshEdit: HistoryEntry | null = null;
let freshTask = 0;
function markFresh(entry: HistoryEntry): HistoryEntry {
    freshEdit = entry;
    const task = ++freshTask;
    // The entry may be replaced within the task (a selection folded in, steps merged); whatever is
    // fresh then stops being fresh when the task ends.
    queueMicrotask(() => {
        if (freshTask === task) freshEdit = null;
    });
    return entry;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

// Top-level layers an edit changed, created or removed.
function touchedBy(before: NagmaDocument, after: NagmaDocument): string[] {
    const out: string[] = [];
    const ids = new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)]);
    for (const id of ids) if (before.nodes[id] !== after.nodes[id] && after.nodes[id]?.type !== "page" && before.nodes[id]?.type !== "page") out.push(id);
    // Keep only the outermost of them, as a drag of a frame also changes its children.
    const set = new Set(out);
    return out.filter((id) => {
        let p = (after.nodes[id] ?? before.nodes[id])?.parentId ?? null;
        while (p) {
            if (set.has(p)) return false;
            p = (after.nodes[p] ?? before.nodes[p])?.parentId ?? null;
        }
        return true;
    });
}

export interface EditorState {
    doc: NagmaDocument;
    // The page on screen (per viewer, not part of the document).
    pageId: string;
    selection: string[];
    hoverId: string | null;
    // The colour picker's eyedropper: where the next sampled colour goes (instead of the selection's fill).
    pickColorInto: ((hex: string) => void) | null;
    editingTextId: string | null;
    tool: Tool;
    mode: EditorMode;
    // Motion mode: the playhead in milliseconds, whether it's playing, and auto-keyframing.
    time: number;
    playing: boolean;
    autoKey: boolean;
    // The Actions (⌘K) palette.
    actionsOpen: boolean;
    // The Home screen (file browser) and the file open in the editor (engine/files.ts).
    homeOpen: boolean;
    fileId: string | null;
    // Video files: the sequence editor, or the design canvas (editing a title).
    sequenceView: boolean;
    camera: Camera;
    toast: string | null;
    // A button on the toast ("Undo", "Go to page"), when the message offers one.
    toastAction: { label: string; run: () => void } | null;
    uiHidden: boolean;
    // Minimized UI (⌘⇧\\): the rail and left sidebar fold away; the right sidebar shows only with a selection.
    uiMinimized: boolean;
    prefs: Prefs;
    // The frame being presented full screen, if any.
    presentingId: string | null;
    // Where the right-click menu is open, in window coordinates.
    contextMenu: { x: number; y: number } | null;
    // A layer whose name should open for editing in the layers panel (⌘R).
    renameRequest: string | null;
    // Vector point editing: the vector being edited and the selected point or handle.
    editingVectorId: string | null;
    vertices: VertexRef[];
    // The tool of the floating vector bar, and how dragging one handle moves its twin.
    vectorTool: VectorTool;
    handleMirror: HandleMirror;
    // The pen tool's path in progress, and where the pointer is (for the rubber-band segment).
    penNodeId: string | null;
    penCursor: { x: number; y: number } | null;
    // The right panel's tab; the canvas shows prototype connections on the Prototype tab.
    rightTab: "design" | "prototype";
    // View-only links and version previews: the file can be looked at and commented on, not edited.
    readOnly: boolean;
    // The image fill open in the photo editor (PhotoCraft).
    photoEdit: { nodeId: string; paintIndex: number } | null;
    // The PDF open in the page organizer (PdfCraft), by its image id.
    pdfEdit: { source: string; name: string } | null;
    past: HistoryEntry[];
    future: HistoryEntry[];
    // Every committed command in order. Phase 1 sends these to the sync server.
    journal: Command[];
}

const STORAGE_KEY = "nagma.doc.v1";
const HISTORY_LIMIT = 200;

// Brings a saved or received document up to the current format (paints, pages, defaults).
export function prepareDocument(parsed: NagmaDocument | null | undefined): NagmaDocument | null {
    if (!parsed || !parsed.nodes || !Array.isArray(parsed.roots)) return null;
    const nodes: NagmaDocument["nodes"] = {};
    for (const [id, node] of Object.entries(parsed.nodes)) nodes[id] = normalizeNode(node);
    return withPages({ ...parsed, nodes, images: parsed.images ?? {} });
}

// Shared files are stored on the server; only the local draft is kept in this browser.
let storageKey: string | null = STORAGE_KEY;

function loadDocument(): NagmaDocument {
    try {
        const raw = userStorage.getItem(STORAGE_KEY);
        const prepared = raw ? prepareDocument(JSON.parse(raw) as NagmaDocument) : null;
        if (prepared) return prepared;
    } catch {
        // Storage can be blocked or hold a stale shape; fall back to a new, empty file.
    }
    // A new file is an empty canvas with one page, as in the reference (the sample app is a template).
    return withPages({ name: "Untitled", nodes: {}, roots: [], images: {} });
}

// Files saved before pages existed keep their layers at the top level; move them onto "Page 1".
function withPages(doc: NagmaDocument): NagmaDocument {
    const loose = doc.roots.filter((id) => doc.nodes[id]?.type !== "page");
    if (loose.length === 0 && doc.roots.length > 0) return doc;
    const page = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Page 1", children: loose });
    const nodes = { ...doc.nodes, [page.id]: page };
    for (const id of loose) {
        const node = nodes[id];
        if (node) nodes[id] = { ...node, parentId: page.id };
    }
    return { ...doc, nodes, roots: [...doc.roots.filter((id) => doc.nodes[id]?.type === "page"), page.id] };
}

const initialDoc = loadDocument();
activePage.id = initialDoc.roots[0] ?? "";

let state: EditorState = {
    doc: initialDoc,
    pageId: activePage.id,
    selection: [],
    hoverId: null,
    pickColorInto: null,
    editingTextId: null,
    tool: "move",
    mode: "design",
    time: 0,
    playing: false,
    autoKey: true,
    actionsOpen: false,
    homeOpen: false,
    fileId: null,
    sequenceView: true,
    toast: null,
    toastAction: null,
    uiHidden: false,
    uiMinimized: false,
    prefs: loadPrefs(),
    presentingId: null,
    contextMenu: null,
    renameRequest: null,
    editingVectorId: null,
    vertices: [],
    vectorTool: "move",
    handleMirror: "angle",
    penNodeId: null,
    penCursor: null,
    rightTab: "design",
    readOnly: false,
    photoEdit: null,
    pdfEdit: null,
    camera: { x: 0, y: 0, zoom: 1 },
    past: [],
    future: [],
    journal: [],
};
pixelGrid.snap = state.prefs.snapToPixel;

const listeners = new Set<() => void>();
const commitListeners = new Set<(before: NagmaDocument, after: NagmaDocument) => void>();
// Told when a file opens (a document loaded, or a shared file's first snapshot).
const openListeners = new Set<(doc: NagmaDocument) => void>();
// The document as of the last committed change (previews during drags don't count).
let committed: NagmaDocument = state.doc;

let lastBlocked = 0;
// Edits in a read-only view put the document back and explain why (at most every few seconds).
function blocked() {
    if (state.doc !== committed) state = { ...state, doc: committed };
    const now = Date.now();
    if (now - lastBlocked > 3000) {
        lastBlocked = now;
        editor.notify("This file is view only. You can still look around and comment.");
    } else emit();
}

function commit(before: NagmaDocument, after: NagmaDocument) {
    committed = after;
    for (const listener of commitListeners) listener(before, after);
}
// Where you last were on each page (of any file), kept between sessions so a file reopens where you left it.
const CAMERAS_KEY = "nagma.cameras.v1";
const pageCameras = new Map<string, Camera>(
    (() => {
        try {
            return JSON.parse(userStorage.getItem(CAMERAS_KEY) ?? "[]") as [string, Camera][];
        } catch {
            return [];
        }
    })(),
);
function rememberCamera(pageId: string, camera: Camera) {
    if (!pageId) return;
    pageCameras.delete(pageId);
    pageCameras.set(pageId, camera);
    while (pageCameras.size > 300) pageCameras.delete(pageCameras.keys().next().value as string);
    try {
        userStorage.setItem(CAMERAS_KEY, JSON.stringify([...pageCameras]));
    } catch {
        // The view is a nicety.
    }
}
// Called when a page is shown for the first time, so the canvas can zoom to fit it.
let pageOpened: (() => void) | null = null;
export function onPageOpened(callback: () => void) {
    pageOpened = callback;
}
let saveTimer: number | undefined;
let toastTimer: number | undefined;

function emit() {
    // If the page on screen was deleted (or undone away), fall back to the first page.
    if (!state.doc.nodes[state.pageId] && state.doc.roots[0]) {
        state = { ...state, pageId: state.doc.roots[0], selection: [] };
    }
    activePage.id = state.pageId;
    for (const listener of listeners) listener();
}

// Closing or hiding the page writes the waiting autosave at once (it was dropped when the tab
// closed within 300 ms of an edit).
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => flushSave());
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushSave();
    });
}

// Called before the open document is replaced or stops autosaving (editor.onLeave).
const leaveListeners = new Set<() => void>();

// Where the waiting autosave goes, while one waits.
let pendingSaveKey: string | null = null;

function scheduleSave() {
    window.clearTimeout(saveTimer);
    pendingSaveKey = storageKey;
    if (!storageKey) return;
    const key = storageKey;
    saveTimer = window.setTimeout(() => {
        pendingSaveKey = null;
        // Autosave is a convenience; a failed write is ignored.
        void saveDoc(key, state.doc).catch(() => undefined);
    }, 300);
}

// Writes a waiting autosave now. Called before another document or key takes over: the next
// scheduleSave would otherwise cancel it, losing the last 300 ms of edits (an image dropped just
// before a dropped .fig opened, a change made just before switching tabs).
function flushSave() {
    // Products with their own pending writes (a Document's PDF) put them in the document first.
    for (const listener of [...leaveListeners]) {
        try {
            listener();
        } catch {
            // One product's failed write mustn't stop the autosave.
        }
    }
    window.clearTimeout(saveTimer);
    const key = pendingSaveKey;
    pendingSaveKey = null;
    if (key) void saveDoc(key, state.doc).catch(() => undefined);
}

function reselect(touched: string[], current: string[], existing: Set<string>): string[] {
    const back = touched.filter((id) => existing.has(id));
    return back.length ? back : current.filter((id) => existing.has(id));
}

export const editor = {
    get: () => state,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    // `history: false` changes the selection without an undo step of its own (and so keeps redo):
    // for views that narrow a selection by themselves, not for anything a person picked.
    set(patch: Partial<EditorState>, options?: { history?: boolean }) {
        const leavingPen = state.penNodeId && patch.tool && patch.tool !== "pen";
        // A selection change is an undo step of its own; quick successive changes (a marquee, a
        // run of clicks) fold into one.
        if (patch.selection && options?.history !== false && !same(patch.selection, state.selection)) {
            const last = state.past.at(-1);
            const now = Date.now();
            if (last && last === freshEdit) {
                // Selecting what an edit just made (in the same task) belongs to that edit's step, so
                // one undo removes the result and puts the selection back.
                freshEdit = { ...last, selectionAfter: patch.selection };
                state = { ...state, past: [...state.past.slice(0, -1), freshEdit] };
            } else if (last?.selectionOnly && now - last.at < 600) {
                state = { ...state, past: [...state.past.slice(0, -1), { ...last, selectionAfter: patch.selection, at: now }] };
            } else {
                const entry: HistoryEntry = { before: committed, after: committed, command: { type: "batch", commands: [] }, touched: [], selectionBefore: state.selection, selectionAfter: patch.selection, pageId: state.pageId, selectionOnly: true, at: now };
                state = { ...state, past: [...state.past, entry].slice(-HISTORY_LIMIT), future: [] };
            }
        }
        state = { ...state, ...patch };
        if (leavingPen) editor.finishPen();
        else emit();
    },
    // Applies and syncs a command without an undo step (housekeeping such as moving images to the media store).
    // It keeps the redo stack too: housekeeping that follows an undo (re-fitting text, re-colouring
    // code) must not cost you your redos.
    executeSilently(command: Command) {
        const before = state.past.length;
        const future = state.future;
        editor.execute(command);
        if (state.past.length > before) state = { ...state, past: state.past.slice(0, before), future };
    },
    // Shows a document without recording history, for live drags.
    preview(doc: NagmaDocument) {
        state = { ...state, doc };
        emit();
    },
    // Applies a command on top of `base` (default: the current doc) and records it as one undo step.
    execute(command: Command, base: NagmaDocument = state.doc) {
        if (state.readOnly) {
            blocked();
            return;
        }
        let after = applyCommand(base, command);
        if (after === base) {
            if (state.doc !== committed) state = { ...state, doc: committed };
            emit();
            return;
        }
        // If collaborators' changes arrived since `base` (say, during a drag), replay just this edit on
        // top of the latest document instead of overwriting theirs.
        if (base !== committed) after = applyPatch(committed, diffDocs(base, after));
        const before = committed;
        const existing = new Set(Object.keys(after.nodes));
        const selectionAfter = state.selection.filter((id) => existing.has(id));
        const entry: HistoryEntry = { before, after, command, touched: touchedBy(before, after), selectionBefore: state.selection, selectionAfter, pageId: state.pageId, at: Date.now() };
        const past = [...state.past, entry].slice(-HISTORY_LIMIT);
        markFresh(entry);
        state = {
            ...state,
            doc: after,
            past,
            future: [],
            journal: [...state.journal, command],
            selection: selectionAfter,
        };
        commit(before, after);
        scheduleSave();
        emit();
    },
    // Folds the last two edits into one undo step (for actions that need two passes).
    mergeLast() {
        const last = state.past.at(-1);
        const prev = state.past.at(-2);
        if (!last || !prev) return;
        const merged: HistoryEntry = { ...last, before: prev.before, after: last.after, command: { type: "batch" as const, commands: [prev.command, last.command] }, touched: Array.from(new Set([...prev.touched, ...last.touched])), selectionBefore: prev.selectionBefore, selectionOnly: prev.selectionOnly && last.selectionOnly };
        if (last === freshEdit || prev === freshEdit) freshEdit = merged.selectionOnly ? null : merged;
        state = { ...state, past: [...state.past.slice(0, -2), merged] };
    },
    // Undo and redo replay only the properties your edit touched, so collaborators' changes stay.
    undo() {
        freshEdit = null;
        const entry = state.past.at(-1);
        if (!entry || state.readOnly) return;
        if (entry.pageId !== state.pageId && state.doc.nodes[entry.pageId]) editor.setPage(entry.pageId);
        if (entry.selectionOnly) {
            const existing = new Set(Object.keys(state.doc.nodes));
            state = { ...state, past: state.past.slice(0, -1), future: [entry, ...state.future], selection: entry.selectionBefore.filter((id) => existing.has(id)) };
            emit();
            return;
        }
        const before = committed;
        const doc = applyPatch(committed, invertPatch(entry.before, diffDocs(entry.before, entry.after)));
        const existing = new Set(Object.keys(doc.nodes));
        commit(before, doc);
        // The selection goes back to what it was before the edit; failing that, what the edit touched.
        const back = entry.selectionBefore.filter((id) => existing.has(id));
        state = {
            ...state,
            doc,
            past: state.past.slice(0, -1),
            future: [entry, ...state.future],
            selection: back.length ? back : reselect(entry.touched, state.selection, existing),
            editingTextId: null,
        };
        scheduleSave();
        emit();
    },
    redo() {
        freshEdit = null;
        const entry = state.future[0];
        if (!entry || state.readOnly) return;
        if (entry.pageId !== state.pageId && state.doc.nodes[entry.pageId]) editor.setPage(entry.pageId);
        if (entry.selectionOnly) {
            const existing = new Set(Object.keys(state.doc.nodes));
            state = { ...state, past: [...state.past, entry], future: state.future.slice(1), selection: entry.selectionAfter.filter((id) => existing.has(id)) };
            emit();
            return;
        }
        const before = committed;
        const doc = applyPatch(committed, diffDocs(entry.before, entry.after));
        const existing = new Set(Object.keys(doc.nodes));
        commit(before, doc);
        const forward = entry.selectionAfter.filter((id) => existing.has(id));
        state = {
            ...state,
            doc,
            past: [...state.past, entry],
            future: state.future.slice(1),
            selection: forward.length ? forward : reselect(entry.touched, state.selection, existing),
            editingTextId: null,
        };
        scheduleSave();
        emit();
    },
    setPrefs(patch: Partial<Prefs>) {
        state = { ...state, prefs: { ...state.prefs, ...patch } };
        pixelGrid.snap = state.prefs.snapToPixel;
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
        } catch {
            // Preferences still apply for this session.
        }
        emit();
    },
    // Ends the pen's current path; a path with a single point is removed.
    finishPen() {
        const id = state.penNodeId;
        if (!id) return;
        const node = state.doc.nodes[id];
        const points = node?.path?.subpaths.reduce((sum, sub) => sum + sub.points.length, 0) ?? 0;
        state = { ...state, penNodeId: null, penCursor: null };
        if (node && points < 2) editor.execute({ type: "node.delete", ids: [id] });
        else if (node) state = { ...state, selection: [id] };
        emit();
    },
    notify(message: string, action: { label: string; run: () => void } | null = null) {
        window.clearTimeout(toastTimer);
        state = { ...state, toast: message, toastAction: action };
        emit();
        // A toast with a button stays a little longer, to give time to press it.
        toastTimer = window.setTimeout(
            () => {
                state = { ...state, toast: null, toastAction: null };
                emit();
            },
            action ? 5000 : 2600,
        );
    },
    // Shows another page, restoring where you last were on it.
    setPage(pageId: string) {
        if (!state.doc.nodes[pageId] || pageId === state.pageId) return;
        rememberCamera(state.pageId, state.camera);
        const camera = pageCameras.get(pageId);
        // A ⌘R rename waiting for its row ends too (else the row opens in rename mode whenever it next shows).
        state = { ...state, pageId, selection: [], hoverId: null, editingTextId: null, renameRequest: null, ...(camera ? { camera } : {}) };
        activePage.id = pageId;
        emit();
        if (!camera) pageOpened?.();
    },
    // Re-measures text once a web font has loaded; not an edit, so no undo step.
    refreshText() {
        const doc = remeasureAllText(state.doc);
        if (state.doc === committed) committed = doc;
        state = { ...state, doc };
        emit();
    },
    // Applies a change computed elsewhere (restoring a version) as one undoable, synced edit.
    applyLocalPatch(patch: DocPatch) {
        if (state.readOnly) return blocked();
        const before = committed;
        const after = applyPatch(committed, patch);
        if (after === before) return;
        const command: Command = { type: "batch", commands: [] };
        const existing = new Set(Object.keys(after.nodes));
        commit(before, after);
        state = {
            ...state,
            doc: after,
            past: [...state.past, markFresh({ before, after, command, touched: touchedBy(before, after), selectionBefore: state.selection, selectionAfter: state.selection.filter((id) => existing.has(id)), pageId: state.pageId, at: Date.now() })].slice(-HISTORY_LIMIT),
            future: [],
            selection: state.selection.filter((id) => existing.has(id)),
        };
        scheduleSave();
        emit();
    },
    // Shows a document that came from elsewhere (collaborators, or opening a shared file). Not an
    // edit of yours: no undo step and nothing is sent back.
    receive(doc: NagmaDocument, options: { resetHistory?: boolean; opened?: boolean } = {}) {
        committed = doc;
        if (options.opened) for (const l of openListeners) l(doc);
        const existing = new Set(Object.keys(doc.nodes));
        state = {
            ...state,
            doc,
            selection: state.selection.filter((id) => existing.has(id)),
            ...(options.resetHistory ? { past: [], future: [], journal: [] } : {}),
            editingTextId: state.editingTextId && existing.has(state.editingTextId) ? state.editingTextId : null,
        };
        scheduleSave();
        emit();
    },
    // Where this browser autosaves the document (null for shared files, which live on the server).
    setStorageKey(key: string | null) {
        if (key !== storageKey) flushSave();
        storageKey = key;
    },
    // The last committed document (excluding a drag in progress).
    committed: () => committed,
    // Called after every committed local change with the document before and after.
    onCommit(listener: (before: NagmaDocument, after: NagmaDocument) => void) {
        commitListeners.add(listener);
        return () => commitListeners.delete(listener);
    },
    resetDocument() {
        editor.loadDocument(createSampleDocument());
    },
    // Called when a file opens, before the editor shows it.
    onOpen(listener: (doc: NagmaDocument) => void) {
        openListeners.add(listener);
        return () => openListeners.delete(listener);
    },
    // Opens another document in the editor: history starts fresh; `key` is where it autosaves.
    loadDocument(doc: NagmaDocument, key: string | null = storageKey) {
        flushSave();
        const before = committed;
        for (const l of openListeners) l(doc);
        storageKey = key;
        commit(before, doc);
        rememberCamera(state.pageId, state.camera);
        activePage.id = doc.roots[0] ?? "";
        // The file opens where you last were on its first page, or zoomed to fit it the first time.
        const camera = pageCameras.get(activePage.id);
        state = { ...state, doc, pageId: activePage.id, selection: [], past: [], future: [], journal: [], editingTextId: null, editingVectorId: null, renameRequest: null, vertices: [], penNodeId: null, photoEdit: null, pdfEdit: null, mode: "design", time: 0, playing: false, ...(camera ? { camera } : {}) };
        scheduleSave();
        emit();
        if (!camera) pageOpened?.();
    },
    // The key this browser autosaves to right now.
    storageKey: () => storageKey,
    // Writes a waiting autosave now (before a file is read back from storage).
    flushSave,
    // Called just before the open document is replaced (another file opens, its tab closes): a
    // listener may still execute commands on it, and they're saved with it.
    onLeave(listener: () => void) {
        leaveListeners.add(listener);
        return () => leaveListeners.delete(listener);
    },
};

export function useEditor<T>(selector: (s: EditorState) => T): T {
    return useSyncExternalStore(editor.subscribe, () => selector(state));
}

// Keeps the remembered view current as you pan and zoom, so it survives a reload or quit.
let cameraTimer = 0;
editor.subscribe(() => {
    window.clearTimeout(cameraTimer);
    cameraTimer = window.setTimeout(() => {
        const s = editor.get();
        if (pageCameras.get(s.pageId) !== s.camera) rememberCamera(s.pageId, s.camera);
    }, 500);
});
