import { useSyncExternalStore } from "react";
import { auth, signOut } from "./auth";
import { unsyncedCount } from "./collab";
import { inboxState, isUnread, noticeTitle, noticeUrl, subscribeInbox } from "./notifications";
import { activateTab, closedTabs, closeTab, createFile, currentTab, fileMeta, getTabs, openFile, openHome, refreshServerFiles, reopenClosedTab, subscribeTabs } from "./files";
import { VIDEO_ACTION_BY_ID, VIDEO_DESKTOP_SPEC, runVideoAction } from "./video/menu";
import { vui } from "./video/state";
import { ACTION_BY_ID, actionEnabled, actionLabel, runAction } from "./menu-actions";
import { editor } from "./store";
import { openServerPicker } from "./servers";
import { openWelcome } from "./onboarding";

// The desktop app's menu bar (apps/desktop/main.cjs) reaches the editor through window.__nagmaMenu:
// Undo, Redo and Select All act on a text field when one has focus, else run the editor's own
// shortcut; the File and Window menus open, close and step through the tabs; and the app keeps
// the menu's list of recently closed tabs current through the preload bridge.

type Bridge = { platform: string; closedTabs?: (tabs: { id: string; name: string }[]) => void; fileMenus?: (menus: unknown) => void; notifications?: (list: { title: string; text: string; url: string; unread: boolean }[]) => void; notify?: (n: { title: string; text: string; url: string }) => void };
const bridge = (window as unknown as { nagmaDesktop?: Bridge }).nagmaDesktop;
export const isDesktop = Boolean(bridge);

// View > Always Show Tabs When Presenting.
let presentTabs = false;
const presentListeners = new Set<() => void>();
export function usePresentTabs(): boolean {
    return useSyncExternalStore(
        (l) => {
            presentListeners.add(l);
            return () => presentListeners.delete(l);
        },
        () => presentTabs,
    );
}

function textFocused(): boolean {
    const el = document.activeElement as HTMLElement | null;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

// The same key press the shortcut handler answers (hooks/use-shortcuts.ts), so vector editing,
// text editing and the canvas each get their own Undo, Redo and Select All.
function shortcut(key: string, shift = false) {
    const mac = /Mac/i.test(navigator.platform);
    window.dispatchEvent(new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, metaKey: mac, ctrlKey: !mac, shiftKey: shift, bubbles: true, cancelable: true }));
}

// Home, then the file and prototype tabs, as the tab bar shows them.
function stepTab(dir: 1 | -1) {
    const order: (string | null)[] = [null, ...getTabs()];
    const at = Math.max(0, order.indexOf(currentTab()));
    const next = order[(at + dir + order.length) % order.length];
    if (next === null || next === undefined) openHome();
    else void activateTab(next);
}

function run(action: string, arg?: unknown): unknown {
    switch (action) {
        case "undo":
        case "redo":
        case "selectAll":
            if (textFocused()) document.execCommand(action);
            else if (action === "undo") shortcut("z");
            else if (action === "redo") shortcut("z", true);
            else shortcut("a");
            return true;
        case "newTab":
            void openFile(createFile("design").id);
            return true;
        case "openHome":
            openHome();
            return true;
        // False when there's no file or prototype tab to close, so the window closes instead.
        case "closeTab": {
            const tab = currentTab();
            if (!tab) return false;
            closeTab(tab);
            return true;
        }
        case "reopenClosedTab":
            return reopenClosedTab(typeof arg === "string" ? arg : undefined);
        case "nextTab":
            stepTab(1);
            return true;
        case "previousTab":
            stepTab(-1);
            return true;
        case "presentTabs":
            presentTabs = Boolean(arg);
            document.documentElement.classList.toggle("present-tabs", presentTabs);
            for (const l of presentListeners) l();
            return true;
        // An item of a file's menus (below). With a text field focused, its shortcut goes to the
        // field instead, so typing and the field's own shortcuts keep working. Text fields have no
        // ⌥ shortcuts, so those (⌥L Collapse layers) always run.
        case "run": {
            const id = String(arg);
            const video = VIDEO_ACTION_BY_ID.get(id);
            if (video) {
                const el = document.activeElement as HTMLElement | null;
                if (textFocused() && video.shortcut && !video.shortcut.includes("⌥") && el) el.dispatchEvent(keyFor(video.shortcut));
                else runVideoAction(id);
                return true;
            }
            const action = ACTION_BY_ID.get(id);
            if (!action) return false;
            const el = document.activeElement as HTMLElement | null;
            if (textFocused() && action.shortcut && !action.shortcut.includes("⌥") && el) el.dispatchEvent(keyFor(action.shortcut));
            else runAction(id);
            return true;
        }
        // A file opened from Finder (or dropped on the Dock icon) is imported as a new file.
        case "openFig": {
            const { name, data } = (arg ?? {}) as { name?: string; data?: string };
            if (!name || !data) return false;
            const raw = atob(data);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            void import("./images").then((m) => m.importAsNewFiles([new File([bytes], name, { type: typeForName(name) })]));
            return true;
        }
        // Asked before quitting: how many changes haven't reached the server.
        case "unsynced":
            return unsyncedCount();
        // App menu › Server…: the server picker (components/server-picker.tsx).
        case "servers":
            openServerPicker();
            return true;
        case "logOut":
            void signOut().then(refreshServerFiles);
            return true;
        // Help › Get Started on Home (in a file it's the editor's own action).
        case "gettingStarted":
            openWelcome();
            return true;
        default:
            return false;
    }
}

// The type of a file the app hands over by name (Finder gives no type): pictures are only read as
// pictures with an image type.
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", pdf: "application/pdf" };
export function typeForName(name: string): string {
    return TYPES[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "";
}

if (bridge) {
    (window as unknown as { __nagmaMenu?: typeof run }).__nagmaMenu = run;
    const report = () => bridge.closedTabs?.(closedTabs());
    subscribeTabs(report);
    report();
    // The menu bar icon's notification feed: the inbox the bell shows, kept current while signed in.
    const feed = () => {
        if (!bridge.notifications) return;
        if (!auth.get().user) return bridge.notifications([]);
        bridge.notifications(inboxState().list.slice(0, 20).map((n) => ({ title: noticeTitle(n), text: n.text, url: noticeUrl(n), unread: isUnread(n) })));
    };
    subscribeInbox(feed);
    feed();
}

// A file's menus in the desktop menu bar, laid out like the reference's while a design file is
// open: each item is an action of the editor's own table (engine/menu-actions.ts), with its
// shortcut, tick and whether it can run now. Home and presenting show the app's base menus only.
// "Name:a,b,-,c" is a submenu (with separators); "prefs" fills (app) › Preferences above the app's
// own items; "help" is split at its separator around Troubleshooting and Legal Summary.
type Item = { id: string; label: string; accelerator?: string; hint?: boolean; enabled: boolean; checked?: boolean } | { sub: string; items: Item[] } | "-";
export const SPEC: Record<string, string[]> = {
    app: ["actions"],
    prefs: [
        "snapGeometry",
        "snapObjects",
        "snapPixel",
        "-",
        "keepTool",
        "hover",
        "renameDup",
        "dims",
        "hideUi",
        "smartSymbols",
        "flipResize",
        "keyZoomSel",
        "invert",
        "ctrlClick",
        "opacityKeys",
        "oldOutlines",
        "rotateKeys",
        "aiSound",
        "prefTextSuggestions",
        "toolSuggestions",
        "agentsOnCanvas",
        "-",
        "scrollZoom",
        "rightPan",
        "-",
        "nudge",
    ],
    file: ["save", "saveVersion", "history", "-", "export", "pdf"],
    edit: [
        "Copy As:copyText,copyCss,copyCssAll,-,copySvg,copyAnimSvg,copyPng",
        "pasteOver",
        "pasteReplace",
        "duplicate",
        "delete",
        "-",
        "find",
        "findNext",
        "findPrev",
        "findReplace",
        "-",
        "setDefaults",
        "copyProps",
        "pasteProps",
        "pickColor",
        "-",
        "selectMatching",
        "selectNone",
        "selectInverse",
        "Select All With:sameProps,sameFill,sameStroke,sameEffect,sameText,sameFont,sameInstance,sameVariant",
    ],
    view: [
        "pixelGrid",
        "layoutGuides",
        "rulers",
        "showSlices",
        "comments",
        "annotations",
        "outlines",
        "pixelPreview",
        "maskOutlines",
        "frameOutlines",
        "propertyLabels",
        "-",
        "memoryUsage",
        "railMinimized",
        "minimize",
        "panels",
        "cursors",
        "-",
        "switchMode",
        "Panels:layersPanel,librariesPanel,designPanel,prototypePanel,variablesPanel",
        "-",
        "zoomIn",
        "zoomOut",
        "zoom100",
        "fit",
        "zoomSelection",
        "-",
        "prevPage",
        "nextPage",
        "-",
        "prevFrame",
        "nextFrame",
        "findPrevFrame",
        "findNextFrame",
    ],
    object: [
        "frame",
        "group",
        "ungroup",
        "section",
        "toSection",
        "toFrame",
        "mask",
        "-",
        "layout",
        "More Layout Options:suggestLayout,noLayout,-,lockAspect,unlockAspect,resizeToFit,-,hugW,hugH,fillW,fillH",
        "-",
        "component",
        "Slots:toSlot,slotToFrame,wrapSlot,resetSlot",
        "resetInstance",
        "detach",
        "Main Component:mainComponent,pushMain,restoreMain",
        "-",
        "front",
        "forward",
        "backward",
        "back",
        "-",
        "flipx",
        "flipy",
        "rot180",
        "rotL",
        "rotR",
        "-",
        "flatten",
        "outline",
        "editPoints",
        "Boolean Groups:union,subtract,intersect,exclude",
        "-",
        "visible",
        "lock",
        "hideOthers",
        "collapseLayers",
        "-",
        "removeFill",
        "removeStroke",
        "swapPaints",
        "-",
        "removeInteractions",
        "deleteContents",
    ],
    text: [
        "bold",
        "italic",
        "underline",
        "strike",
        "link",
        "-",
        "bullets",
        "numbers",
        "-",
        "Alignment:alignL,alignC,alignR,alignJ,-,alignTop,alignMiddle,alignBottom",
        "Adjust:indentMore,indentLess,-,sizeUp,sizeDown,weightUp,weightDown,-,lineUp,lineDown,spacingUp,spacingDown",
        "Case:originalCase,upper,lower,title",
        "Text Direction:ltr,rtl",
        "-",
        "spellCheck",
        "textSuggestions",
    ],
    arrange: ["roundPixel", "-", "aLeft", "aH", "aRight", "aTop", "aV", "aBottom", "-", "tidy", "packH", "packV", "-", "distH", "distV", "-", "distLeft", "distHC", "distRight", "distTop", "distVC", "distBottom"],
    vector: ["join", "smoothJoin", "heal", "-", "splitVector", "simplifyPath", "offsetPath"],
    plugins: ["runLastPlugin", "Development:newPlugin,importPlugin,-,pluginDocs,pluginConsole,-,devVm,hotReload", "-", "plugins"],
    widgets: ["Development:importWidget", "-", "manageWidgets", "selectWidgets"],
    help: ["gettingStarted", "help", "shortcuts", "forum", "tutorials", "releaseNotes", "-", "account"],
};
// The menu bar spells items in title case, except the Plugins and Widgets menus (sentence case).
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
export const titleCase = (label: string) => label.replace(/[A-Za-z][^\s/]*/g, (w, at: number) => (at > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1)));
const SENTENCE = new Set(["plugins", "widgets"]);
const LABELS: Record<string, string> = {
    home: "Open File Browser",
    save: "Save Local Copy…",
    plugins: "Manage plugins…",
    help: "Help Page",
    account: "Account Settings",
    copyCss: "CSS",
    copyCssAll: "CSS (all Layers)",
    zoomIn: "Zoom In",
    resetInstance: "Reset Instance",
    visible: "Show/Hide Selection",
    lock: "Lock/Unlock Selection",
    noLayout: "Remove All Auto Layout",
    rot180: "Rotate 180˚",
    rotL: "Rotate 90˚ Left",
    rotR: "Rotate 90˚ Right",
    union: "Union",
    subtract: "Subtract",
    intersect: "Intersect",
    exclude: "Exclude",
    smartSymbols: "Use Smart Quotes/symbols",
    keyZoomSel: "Keyboard Zooms into Selection",
};

// "⇧ ⌘ Z" as an Electron accelerator. Shortcuts without ⌘ or ⌃ are shown but not registered (the
// page answers them), so typing a letter in a field never runs a menu item.
const KEYS: Record<string, string> = { "⌫": "Backspace", Esc: "Escape", "+": "Plus", "−": "-", "→": "Right", "←": "Left", "↑": "Up", "↓": "Down", "↵": "Return", "⇞": "PageUp", "⇟": "PageDown" };
export function accelerator(shortcut: string | undefined): { accelerator: string; hint: boolean } | undefined {
    if (!shortcut) return undefined;
    const parts = shortcut.split(" ").filter(Boolean);
    const mods = parts.filter((p) => "⌘⌃⌥⇧".includes(p)).map((p) => ({ "⌘": "CmdOrCtrl", "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift" })[p as "⌘"]);
    const key = parts.filter((p) => !"⌘⌃⌥⇧".includes(p)).join("");
    if (!key) return undefined;
    return { accelerator: [...mods, KEYS[key] ?? key.toUpperCase()].join("+"), hint: !/[⌘⌃]/.test(shortcut) };
}
function keyFor(shortcut: string): KeyboardEvent {
    const parts = shortcut.split(" ");
    const key = parts.filter((p) => !"⌘⌃⌥⇧".includes(p)).join("");
    const mac = /Mac/i.test(navigator.platform);
    return new KeyboardEvent("keydown", {
        key: key.length === 1 ? key.toLowerCase() : key,
        code: /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : "",
        metaKey: parts.includes("⌘") && mac,
        ctrlKey: (parts.includes("⌘") && !mac) || parts.includes("⌃"),
        altKey: parts.includes("⌥"),
        shiftKey: parts.includes("⇧"),
        bubbles: true,
        cancelable: true,
    });
}

function item(id: string, sentence = false): Item | null {
    const action = ACTION_BY_ID.get(id);
    if (!action) return null;
    const s = editor.get();
    const label = actionLabel(action, s);
    const acc = accelerator(action.shortcut);
    return { id, label: LABELS[id] ?? (sentence ? label : titleCase(label)), ...(acc ? { accelerator: acc.accelerator, ...(acc.hint ? { hint: true } : {}) } : {}), enabled: actionEnabled(action, s), ...(action.checked ? { checked: action.checked(s) } : {}) };
}
function videoItem(id: string): Item | null {
    const action = VIDEO_ACTION_BY_ID.get(id);
    if (!action) return null;
    const acc = accelerator(action.shortcut);
    return { id, label: titleCase(action.label), ...(acc && !acc.hint ? { accelerator: acc.accelerator } : {}), enabled: action.enabled?.() ?? true, ...(action.checked ? { checked: action.checked() } : {}) };
}

// One menu's entries from the spec.
export function specItems(menu: string, entries: string[]): Item[] {
    const sentence = SENTENCE.has(menu);
    return entries.flatMap((e): Item[] => {
        if (e === "-") return ["-"];
        const at = e.indexOf(":");
        if (at < 0) return [item(e, sentence)].filter(Boolean) as Item[];
        const name = e.slice(0, at);
        const items = e
            .slice(at + 1)
            .split(",")
            .map((id) => (id === "-" ? "-" : item(id, sentence)))
            .filter(Boolean) as Item[];
        return [{ sub: name, items }];
    });
}

function fileMenus(): Record<string, Item[]> | null {
    const s = editor.get();
    if (s.homeOpen || !s.fileId || s.presentingId) return null;
    const out: Record<string, Item[]> = {};
    // A video file's menus come from the video editor's own commands.
    const video = s.sequenceView && fileMeta(s.fileId)?.kind === "video";
    if (video) {
        for (const [menu, entries] of Object.entries(VIDEO_DESKTOP_SPEC)) out[menu] = entries.flatMap((e): Item[] => (typeof e !== "string" ? [] : e === "-" ? ["-"] : ([videoItem(e)].filter(Boolean) as Item[])));
        return out;
    }
    for (const [menu, entries] of Object.entries(SPEC)) out[menu] = specItems(menu, entries);
    return out;
}

if (bridge?.fileMenus) {
    let last = "";
    let timer = 0;
    const send = () => {
        timer = 0;
        const menus = fileMenus();
        const json = JSON.stringify(menus);
        if (json === last) return;
        last = json;
        bridge.fileMenus?.(menus);
    };
    editor.subscribe(() => {
        if (!timer) timer = window.setTimeout(send, 120);
    });
    vui.subscribe(() => {
        if (!timer) timer = window.setTimeout(send, 120);
    });
    send();
}
