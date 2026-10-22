// Nagma Capture's service worker: captures a tab (the page script, then what the page couldn't do
// itself: other origins' style sheets, pictures and font files, interaction states and other
// window widths) and hands the capture to Nagma open in another tab, to a Nagma server, or to the
// popup to save as a file.
//
// The debugger permission is optional. With it, states are forced the way the browser's own
// developer tools force them and widths are set without touching the window; without it (or in
// Firefox, which has no chrome.debugger) the page script forces states by twins of the page's
// rules and the window itself is resized.

import type { Capture, CaptureBreakpoint, CaptureNode, CaptureStateName, CaptureStates } from "../../web/src/engine/capture-format";
import type { CaptureOptions, CaptureResult, PendingAsset } from "./capture";
import { sendThroughServer } from "./send";
import { loadSettings, loadToken, parseBreakpoints, type BreakpointSpec } from "./settings";
import type { ExtraSheet } from "./states";

declare const __FIREFOX__: boolean;

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_FONT_BYTES = 12 * 1024 * 1024;
const MAX_SHEET_BYTES = 4 * 1024 * 1024;

function toDataUrl(bytes: ArrayBuffer, type: string): string {
    const view = new Uint8Array(bytes);
    let bin = "";
    for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000));
    return `data:${type || "application/octet-stream"};base64,${btoa(bin)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Api = Record<string, (...args: unknown[]) => unknown>;

// Runs one of the page script's functions in the tab (the extension's own world there).
async function call<T>(tabId: number, name: string, ...args: unknown[]): Promise<T> {
    const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (fn: string, rest: unknown[]) => {
            const f = (globalThis as unknown as Api)[fn];
            return f ? f(...rest) : null;
        },
        args: [name, args],
    });
    return first?.result as T;
}

// ---- The devtools protocol (optional) ----

class Devtools {
    private constructor(private readonly target: chrome.debugger.Debuggee) {}

    static async open(tabId: number): Promise<Devtools | null> {
        if (__FIREFOX__ || typeof chrome.debugger === "undefined") return null;
        try {
            if (!(await chrome.permissions.contains({ permissions: ["debugger"] }))) return null;
            await chrome.debugger.attach({ tabId }, "1.3");
            return new Devtools({ tabId });
        } catch {
            // Developer tools already open on the tab, or another debugger attached.
            return null;
        }
    }

    send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
        return chrome.debugger.sendCommand(this.target, method, params) as Promise<T>;
    }

    async close() {
        try {
            await chrome.debugger.detach(this.target);
        } catch {
            // Already detached (the tab closed, or the person cancelled the bar).
        }
    }
}

// ---- Pictures ----

// Pictures by URL: the extension may read any address the page showed, so CORS doesn't stop it.
async function fetchAssets(capture: Capture, pending: PendingAsset[], budget: { left: number }): Promise<PendingAsset[]> {
    const failed: PendingAsset[] = [];
    const queue = [...pending];
    const worker = async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
            if (!p.url) {
                failed.push(p);
                continue;
            }
            try {
                const res = await fetch(p.url, { credentials: "omit" });
                if (!res.ok) throw new Error(String(res.status));
                const bytes = await res.arrayBuffer();
                if (bytes.byteLength > budget.left) throw new Error("over the size limit");
                budget.left -= bytes.byteLength;
                const entry = capture.assets[p.id];
                if (entry) entry.data = toDataUrl(bytes, res.headers.get("content-type")?.split(";")[0] ?? "");
            } catch {
                failed.push(p);
            }
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return failed;
}

// What couldn't be read is taken from the screen: the page is scrolled to each box in turn and
// the visible tab captured (at most twice a second), then cropped to the box.
async function screenshotAssets(tabId: number, windowId: number, capture: Capture, pending: PendingAsset[], budget: { left: number }): Promise<void> {
    if (!pending.length) return;
    const [{ result: start } = { result: null }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ x: window.scrollX, y: window.scrollY, h: window.innerHeight, w: window.innerWidth }) });
    const view = start as { x: number; y: number; h: number; w: number } | null;
    if (!view) return;
    const sorted = [...pending].sort((a, b) => a.box.y - b.box.y);
    let shot: { y: number; bitmap: ImageBitmap } | null = null;
    for (const p of sorted) {
        if (budget.left <= 0) break;
        const fits = shot && p.box.y >= shot.y && p.box.y + Math.min(p.box.h, view.h) <= shot.y + view.h;
        if (!fits) {
            const y = Math.max(0, p.box.y - 16);
            await chrome.scripting.executeScript({ target: { tabId }, func: (top: number) => window.scrollTo(window.scrollX, top), args: [y] });
            await sleep(600);
            const [{ result: at } = { result: y }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.scrollY });
            const url = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
            const blob = await (await fetch(url)).blob();
            shot = { y: (at as number) ?? y, bitmap: await createImageBitmap(blob) };
        }
        if (!shot) continue;
        // The shot's pixels per CSS pixel (an emulated width can be drawn smaller than the window).
        const k = shot.bitmap.width / Math.max(1, view.w) || capture.dpr || 1;
        const sx = Math.max(0, (p.box.x - view.x) * k);
        const sy = Math.max(0, (p.box.y - shot.y) * k);
        const sw = Math.min(shot.bitmap.width - sx, p.box.w * k);
        const sh = Math.min(shot.bitmap.height - sy, p.box.h * k);
        if (sw <= 0 || sh <= 0) continue;
        const canvas = new OffscreenCanvas(Math.round(sw), Math.round(sh));
        canvas.getContext("2d")?.drawImage(shot.bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        const out = await canvas.convertToBlob({ type: "image/png" });
        budget.left -= out.size;
        const entry = capture.assets[p.id];
        if (entry) {
            entry.data = toDataUrl(await out.arrayBuffer(), "image/png");
            entry.bitmap = true;
        }
    }
    await chrome.scripting.executeScript({ target: { tabId }, func: (x: number, y: number) => window.scrollTo(x, y), args: [view.x, view.y] });
}

// ---- Style sheets and fonts ----

// The text of style sheets the page can't read (other origins): the extension may fetch them.
async function fetchSheets(tabId: number): Promise<ExtraSheet[]> {
    const hrefs = (await call<string[] | null>(tabId, "__nagmaUnreadableSheets")) ?? [];
    let left = MAX_SHEET_BYTES;
    const out: ExtraSheet[] = [];
    for (const href of hrefs.slice(0, 40)) {
        try {
            const res = await fetch(href, { credentials: "omit" });
            if (!res.ok) continue;
            const text = await res.text();
            if (text.length > left) continue;
            left -= text.length;
            out.push({ href, text });
        } catch {
            // Left out: its rules don't count for states and fonts.
        }
    }
    return out;
}

const FONT_TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", truetype: "font/ttf", opentype: "font/otf" };

// The page's own font files, for the families its text uses, so Nagma can set the text in them.
async function fetchFonts(capture: Capture): Promise<void> {
    let left = MAX_FONT_BYTES;
    let n = 0;
    for (const font of capture.fonts) {
        for (const face of font.faces ?? []) {
            if (left <= 0 || n >= 24 || !/^(https?|file|data):/.test(face.url)) continue;
            try {
                let data: string;
                if (face.url.startsWith("data:")) data = face.url;
                else {
                    const res = await fetch(face.url, { credentials: "omit" });
                    if (!res.ok) continue;
                    const bytes = await res.arrayBuffer();
                    if (bytes.byteLength > left) continue;
                    left -= bytes.byteLength;
                    const type = FONT_TYPES[face.format ?? ""] ?? res.headers.get("content-type")?.split(";")[0] ?? "font/woff2";
                    data = toDataUrl(bytes, type);
                }
                const id = `f${++n}`;
                capture.assets[id] = { url: face.url, data };
                face.asset = id;
            } catch {
                // The face stays listed without its file.
            }
        }
    }
}

// ---- Live frames: their pictures and fonts as data ----

async function inlineLiveUrls(capture: Capture, budget: { left: number }): Promise<void> {
    const lives: CaptureNode[] = [];
    const visit = (n: CaptureNode) => {
        if (n.live) lives.push(n);
        n.children.forEach(visit);
    };
    visit(capture.root);
    for (const b of capture.breakpoints ?? []) visit(b.root);
    if (!lives.length) return;
    const cache = new Map<string, string | null>();
    const read = async (url: string): Promise<string | null> => {
        if (url.startsWith("data:")) return url;
        if (cache.has(url)) return cache.get(url) ?? null;
        let out: string | null = null;
        try {
            const res = await fetch(url, { credentials: "omit" });
            if (res.ok) {
                const bytes = await res.arrayBuffer();
                if (bytes.byteLength <= budget.left && bytes.byteLength <= 4 * 1024 * 1024) {
                    budget.left -= bytes.byteLength;
                    out = toDataUrl(bytes, res.headers.get("content-type")?.split(";")[0] ?? "");
                }
            }
        } catch {
            out = null;
        }
        cache.set(url, out);
        return out;
    };
    const replaceAll = async (text: string, re: RegExp, group: number): Promise<string> => {
        const found = [...text.matchAll(re)];
        let out = text;
        for (const m of found) {
            const url = m[group] as string;
            if (!/^https?:|^file:/.test(url)) continue;
            const data = await read(url);
            // Unreadable: dropped, since the frame can't reach the network.
            out = out.split(url).join(data ?? "data:,");
        }
        return out;
    };
    for (const n of lives) {
        const live = n.live;
        if (!live) continue;
        live.css = await replaceAll(live.css, /url\(\s*["']?([^"')]+)["']?\s*\)/g, 1);
        live.html = await replaceAll(live.html, /\s(?:src|poster)="([^"]+)"/g, 1);
        // Pictures in style attributes (url() with its quotes written as &quot;).
        live.html = await replaceAll(live.html, /url\(\s*(?:&quot;|["'])?([^"')&]+)(?:&quot;|["'])?\s*\)/g, 1);
    }
}

// ---- States ----

function keyedNodes(root: CaptureNode): Map<number, CaptureNode> {
    const out = new Map<number, CaptureNode>();
    const visit = (n: CaptureNode) => {
        const key = (n as CaptureNode & { stateKey?: number }).stateKey;
        if (key !== undefined) out.set(key, n);
        n.children.forEach(visit);
    };
    visit(root);
    return out;
}

function stripKeys(n: CaptureNode) {
    delete (n as CaptureNode & { stateKey?: number }).stateKey;
    n.children.forEach(stripKeys);
}

// Each element's states, forced by the devtools protocol one element and state at a time (the
// element and, for hover and press, its ancestors, as a pointer would), read by the page script.
async function statesWithDevtools(dt: Devtools, tabId: number, capture: Capture): Promise<void> {
    const keyed = keyedNodes(capture.root);
    const list = (await call<{ key: number; states: CaptureStateName[]; transition: CaptureStates["transition"] }[] | null>(tabId, "__nagmaStateBegin")) ?? [];
    await dt.send("DOM.enable");
    await dt.send("CSS.enable");
    const { root } = await dt.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
    for (const { key, states, transition } of list) {
        const node = keyed.get(key);
        const { nodeId } = await dt.send<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-nagma-state="${key}"]` });
        if (!node || !nodeId) continue;
        const { nodeIds: ancestors } = await dt.send<{ nodeIds: number[] }>("DOM.querySelectorAll", { nodeId: root.nodeId, selector: `:has([data-nagma-state="${key}"])` });
        for (const state of states) {
            const forced = state === "focus" ? ["focus", "focus-visible"] : state === "active" ? ["hover", "active"] : ["hover"];
            const targets = state === "focus" ? [nodeId] : [nodeId, ...ancestors];
            for (const id of targets) await dt.send("CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: forced });
            const read = await call<{ node: CaptureNode; changes: Record<string, [string, string]> } | null>(tabId, "__nagmaStateRead", key, state);
            for (const id of targets) await dt.send("CSS.forcePseudoState", { nodeId: id, forcedPseudoClasses: [] });
            if (!read) continue;
            node.states ??= { changes: {}, transition };
            node.states[state] = read.node;
            node.states.changes[state] = read.changes;
        }
    }
    await dt.send("CSS.disable").catch(() => undefined);
}

async function finishStates(tabId: number, capture: Capture, dt: Devtools | null, sheets: ExtraSheet[]): Promise<PendingAsset[]> {
    let usedDevtools = false;
    if (dt) {
        try {
            await statesWithDevtools(dt, tabId, capture);
            usedDevtools = true;
        } catch {
            usedDevtools = false;
        }
    }
    if (!usedDevtools) {
        const all = (await call<Record<number, CaptureStates> | null>(tabId, "__nagmaStateAll", sheets)) ?? {};
        const keyed = keyedNodes(capture.root);
        for (const [key, states] of Object.entries(all)) {
            const node = keyed.get(Number(key));
            if (node) node.states = states;
        }
    }
    const end = (await call<{ assets: Capture["assets"]; pending: PendingAsset[] } | null>(tabId, "__nagmaStateEnd")) ?? { assets: {}, pending: [] };
    for (const [id, a] of Object.entries(end.assets)) if (!capture.assets[id]) capture.assets[id] = a;
    stripKeys(capture.root);
    return end.pending.filter((p) => !capture.assets[p.id]?.data);
}

// ---- Widths ----

// Sets the page's width: emulated through the devtools protocol, else by resizing the window
// (browsers keep windows from getting very narrow, so the width reached is what's recorded).
async function setWidth(tabId: number, windowId: number, dt: Devtools | null, width: number): Promise<number> {
    const view = await call<{ w: number; h: number }>(tabId, "__nagmaViewport");
    if (dt) {
        await dt.send("Emulation.setDeviceMetricsOverride", { width, height: view?.h ?? 800, deviceScaleFactor: 0, mobile: false });
    } else {
        const win = await chrome.windows.get(windowId);
        const frame = Math.max(0, (win.width ?? 0) - (view?.w ?? 0));
        if (win.state === "maximized" || win.state === "fullscreen") await chrome.windows.update(windowId, { state: "normal" });
        await chrome.windows.update(windowId, { width: width + frame });
    }
    // Layout, lazy pictures and fonts settle.
    await sleep(700);
    await call(tabId, "__nagmaSettle");
    return (await call<{ w: number; h: number }>(tabId, "__nagmaViewport"))?.w ?? width;
}

async function restoreWidth(windowId: number, dt: Devtools | null, before: chrome.windows.Window | null) {
    if (dt) {
        await dt.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
        return;
    }
    if (!before) return;
    if (before.state && before.state !== "normal") await chrome.windows.update(windowId, { state: before.state });
    else await chrome.windows.update(windowId, { width: before.width, height: before.height });
}

// ---- Capturing ----

export interface CaptureChoices {
    states: boolean;
    breakpoints: BreakpointSpec[] | null;
    interactive: boolean;
}

// The page script is injected once per capture (each injection starts afresh), then called.
async function runPageScript(tabId: number, options: CaptureOptions): Promise<CaptureResult> {
    const result = await call<CaptureResult | null>(tabId, "__nagmaCapture", options);
    if (!result) throw new Error("The page didn't answer. Reload it and try again.");
    return result;
}

// Elements with script listeners the page added (devtools only): marked for the page script,
// which looks for a pattern it can keep working around them.
async function markListeners(dt: Devtools, tabId: number): Promise<void> {
    try {
        await dt.send("DOM.enable");
        const candidates = (await call<number>(tabId, "__nagmaListenerCandidates")) ?? 0;
        for (let i = 0; i < candidates; i++) {
            const { result } = await dt.send<{ result: { objectId?: string } }>("Runtime.evaluate", { expression: `document.querySelector('[data-nagma-candidate="${i}"]')` });
            if (!result.objectId) continue;
            const { listeners } = await dt.send<{ listeners: { type: string }[] }>("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: 0 });
            if (listeners.some((l) => /^(click|pointerdown|pointerup|mousedown|keydown|input|change|touchstart)$/.test(l.type))) await call(tabId, "__nagmaMarkListener", i);
            await dt.send("Runtime.releaseObject", { objectId: result.objectId }).catch(() => undefined);
        }
    } catch {
        // Heuristics alone, then.
    }
}

export async function captureTab(tabId: number, choices: CaptureChoices = { states: false, breakpoints: null, interactive: false }): Promise<Capture> {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !/^(https?|file):/.test(tab.url)) throw new Error("This page can't be captured (only web pages can).");
    await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] });
    const wantsDevtools = choices.states || Boolean(choices.breakpoints?.length) || choices.interactive;
    const dt = wantsDevtools ? await Devtools.open(tabId) : null;
    const before = choices.breakpoints?.length && !dt ? await chrome.windows.get(tab.windowId) : null;
    try {
        const sheets = choices.states || choices.interactive ? await fetchSheets(tabId) : [];
        if (choices.interactive && dt) await markListeners(dt, tabId);
        const widths = choices.breakpoints?.length ? choices.breakpoints : [null];
        let main: Capture | null = null;
        const others: CaptureBreakpoint[] = [];
        const budget = { left: MAX_BYTES };
        for (const [i, bp] of widths.entries()) {
            const width = bp ? await setWidth(tabId, tab.windowId, dt, bp.width) : null;
            const first = i === 0;
            const states = first && choices.states ? (dt ? "external" : "rules") : false;
            const result = await runPageScript(tabId, { inlineAssets: false, states, sheets, assetPrefix: first ? "a" : `b${i}-`, live: choices.interactive });
            const { capture } = result;
            let pending = result.pending;
            if (states === "external") pending = [...pending, ...(await finishStates(tabId, capture, dt, sheets))];
            budget.left -= Object.values(capture.assets).reduce((n, a) => n + (a.data?.length ?? 0) * 0.75, 0);
            const target: Capture = main ?? capture;
            if (main) Object.assign(main.assets, capture.assets);
            const failed = await fetchAssets(target, pending, budget);
            await screenshotAssets(tabId, tab.windowId, target, failed, budget);
            if (!main) {
                main = capture;
                if (bp) main.label = bp.label;
            } else others.push({ label: bp?.label ?? `${width}`, width: width ?? capture.viewport.w, viewport: capture.viewport, scroll: capture.scroll, background: capture.background, root: capture.root });
        }
        if (!main) throw new Error("Nothing was captured.");
        if (others.length) main.breakpoints = others;
        await fetchFonts(main);
        await inlineLiveUrls(main, budget);
        return main;
    } finally {
        if (choices.breakpoints?.length) await restoreWidth(tab.windowId, dt, before).catch(() => undefined);
        await dt?.close();
    }
}

// ---- Handing over ----

// Runs on the Nagma page (an isolated world): waits for the app to say it's listening, then
// posts the capture to the page's own window.
function relay(capture: unknown): Promise<boolean> {
    return new Promise((resolve) => {
        let stage: "hello" | "sent" | "done" = "hello";
        let tries = 0;
        const onMessage = (e: MessageEvent) => {
            if (e.source !== window || e.origin !== location.origin) return;
            const type = (e.data as { type?: string } | null)?.type;
            if (type === "nagma-capture-ready" && stage === "hello") {
                stage = "sent";
                window.postMessage({ type: "nagma-capture", capture }, location.origin);
            } else if (type === "nagma-capture-received") {
                stage = "done";
                window.removeEventListener("message", onMessage);
                resolve(true);
            }
        };
        window.addEventListener("message", onMessage);
        const timer = setInterval(() => {
            if (stage === "done") return clearInterval(timer);
            if (++tries > 120) {
                clearInterval(timer);
                window.removeEventListener("message", onMessage);
                resolve(false);
                return;
            }
            if (stage === "hello") window.postMessage({ type: "nagma-capture-hello" }, location.origin);
        }, 250);
        window.postMessage({ type: "nagma-capture-hello" }, location.origin);
    });
}

function waitForLoad(tabId: number): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };
        const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
            if (id === tabId && info.status === "complete") done();
        };
        chrome.tabs.onUpdated.addListener(listener);
        void chrome.tabs.get(tabId).then((t) => {
            if (t.status === "complete") done();
        });
    });
}

export async function sendToNagma(capture: Capture): Promise<void> {
    const { address } = await loadSettings();
    const base = address.replace(/\/+$/, "");
    const origin = new URL(base).origin;
    const open = (await chrome.tabs.query({})).find((t) => {
        try {
            return t.url !== undefined && new URL(t.url).origin === origin;
        } catch {
            return false;
        }
    });
    let tabId: number;
    if (open?.id !== undefined) {
        tabId = open.id;
        await chrome.tabs.update(tabId, { active: true });
        if (open.windowId !== undefined) await chrome.windows.update(open.windowId, { focused: true });
    } else {
        const created = await chrome.tabs.create({ url: `${base}/#capture` });
        if (created.id === undefined) throw new Error("Couldn't open Nagma.");
        tabId = created.id;
    }
    await waitForLoad(tabId);
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: relay, args: [capture] });
    if (!res?.result) throw new Error(`Nagma at ${base} didn't take the capture. Is it up to date?`);
}

// Through the server: POST /captures, then open the address it answers with.
export async function sendToServer(capture: Capture): Promise<string> {
    const { address } = await loadSettings();
    const sent = await sendThroughServer(JSON.stringify(capture), address, await loadToken());
    await chrome.tabs.create({ url: sent.url });
    return sent.url;
}

async function choicesFromSettings(): Promise<CaptureChoices> {
    const s = await loadSettings();
    const bps = s.breakpointsOn ? parseBreakpoints(s.breakpoints) : [];
    return { states: s.states, breakpoints: bps.length > 1 ? bps : null, interactive: s.interactive };
}

async function deliver(capture: Capture): Promise<{ ok: true; via: "tab" | "server" }> {
    const { viaServer } = await loadSettings();
    if (viaServer) {
        await sendToServer(capture);
        return { ok: true, via: "server" };
    }
    await sendToNagma(capture);
    return { ok: true, via: "tab" };
}

type Request = { type: "capture-send"; tabId: number } | { type: "capture-get"; tabId: number };

chrome.runtime.onMessage.addListener((message: Request, _sender, reply) => {
    const run = async () => {
        const capture = await captureTab(message.tabId, await choicesFromSettings());
        if (message.type === "capture-send") return deliver(capture);
        return { ok: true, capture };
    };
    run().then(reply, (error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
});

chrome.commands.onCommand.addListener((command) => {
    if (command !== "capture-page") return;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (tab?.id === undefined) return;
        try {
            await chrome.action.setBadgeText({ tabId: tab.id, text: "…" });
            await deliver(await captureTab(tab.id, await choicesFromSettings()));
            await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
        } catch {
            await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
        }
    });
});
