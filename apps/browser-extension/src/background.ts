// Nagma Capture's service worker: captures a tab (the page script, then the pictures the page
// couldn't read itself), and hands the capture to Nagma open in another tab, or to the popup to
// save as a file.

import type { Capture } from "../../web/src/engine/capture-format";
import type { CaptureResult, PendingAsset } from "./capture";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

const MAX_BYTES = 40 * 1024 * 1024;

async function settings(): Promise<Settings> {
    const stored = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Settings;
    return { ...DEFAULT_SETTINGS, ...stored };
}

function toDataUrl(bytes: ArrayBuffer, type: string): string {
    const view = new Uint8Array(bytes);
    let bin = "";
    for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000));
    return `data:${type || "application/octet-stream"};base64,${btoa(bin)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const [{ result: start } = { result: null }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ x: window.scrollX, y: window.scrollY, h: window.innerHeight }) });
    const view = start as { x: number; y: number; h: number } | null;
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
        const k = capture.dpr || 1;
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

export async function captureTab(tabId: number): Promise<Capture> {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !/^(https?|file):/.test(tab.url)) throw new Error("This page can't be captured (only web pages can).");
    await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] });
    const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
            const run = (globalThis as unknown as { __nagmaCapture?: (o: object) => Promise<unknown> }).__nagmaCapture;
            return run ? run({ inlineAssets: false }) : null;
        },
    });
    const result = first?.result as CaptureResult | null | undefined;
    if (!result) throw new Error("The page didn't answer. Reload it and try again.");
    const { capture, pending } = result;
    const used = Object.values(capture.assets).reduce((n, a) => n + (a.data?.length ?? 0) * 0.75, 0);
    const budget = { left: MAX_BYTES - used };
    const failed = await fetchAssets(capture, pending, budget);
    await screenshotAssets(tabId, tab.windowId, capture, failed, budget);
    return capture;
}

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
    const { address } = await settings();
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

type Request = { type: "capture-send"; tabId: number } | { type: "capture-get"; tabId: number };

chrome.runtime.onMessage.addListener((message: Request, _sender, reply) => {
    const run = async () => {
        const capture = await captureTab(message.tabId);
        if (message.type === "capture-send") {
            await sendToNagma(capture);
            return { ok: true };
        }
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
            await sendToNagma(await captureTab(tab.id));
            await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
        } catch {
            await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
        }
    });
});
