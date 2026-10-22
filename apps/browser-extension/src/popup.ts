// The toolbar popup: capture the page (sent to Nagma, or saved as a file), what to capture with it
// (states, breakpoints, interactive parts) and the options.

import type { Capture } from "../../web/src/engine/capture-format";
import { ADDRESSES, DEFAULT_BREAKPOINTS, DEFAULT_SETTINGS, loadSettings, loadToken, parseBreakpoints, type Settings } from "./settings";

declare const __FIREFOX__: boolean;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>("status");
const captureButton = $<HTMLButtonElement>("capture");
const downloadButton = $<HTMLButtonElement>("download");
const address = $<HTMLSelectElement>("address");
const custom = $<HTMLInputElement>("custom");
const states = $<HTMLInputElement>("states");
const breakpointsOn = $<HTMLInputElement>("breakpointsOn");
const breakpoints = $<HTMLInputElement>("breakpoints");
const interactive = $<HTMLInputElement>("interactive");
const viaServer = $<HTMLInputElement>("viaServer");
const token = $<HTMLInputElement>("token");
const precise = $<HTMLParagraphElement>("precise");
const askDebugger = $<HTMLAnchorElement>("ask-debugger");

// Kept in memory so a click can ask for the debugger permission straight away (the browser only
// asks in answer to a click).
let current: Settings = { ...DEFAULT_SETTINGS };
let debuggerGranted = false;

function say(text: string, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
}

function busy(on: boolean) {
    captureButton.disabled = on;
    downloadButton.disabled = on;
}

async function activeTab(): Promise<number | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
}

const wantsDevtools = () => current.states || current.breakpointsOn || current.interactive;
const canDebug = () => !__FIREFOX__ && typeof chrome.permissions !== "undefined";

// The debugger permission, asked at the moment it's first of use: states, widths and interactive
// parts are exact with it. Declined: the fallbacks, and no asking again until the person does.
function maybeAskDebugger(force = false): Promise<void> {
    if (!canDebug() || debuggerGranted || !wantsDevtools() || (current.debuggerDeclined && !force)) return Promise.resolve();
    return chrome.permissions.request({ permissions: ["debugger"] }).then(
        async (granted) => {
            debuggerGranted = granted;
            current.debuggerDeclined = !granted;
            await chrome.storage.sync.set({ debuggerDeclined: !granted });
            refresh();
        },
        () => undefined,
    );
}

type Reply = { ok: true; capture?: Capture; via?: "tab" | "server" } | { ok: false; error: string };

async function ask(type: "capture-send" | "capture-get"): Promise<Reply> {
    const tabId = await activeTab();
    if (tabId === null) return { ok: false, error: "No page to capture." };
    return (await chrome.runtime.sendMessage({ type, tabId })) as Reply;
}

function capturingText(): string {
    const parts = [current.states ? "states" : "", current.breakpointsOn && parseBreakpoints(current.breakpoints).length > 1 ? "every width" : "", current.interactive ? "interactive parts" : ""].filter(Boolean);
    return parts.length ? `Capturing (with ${parts.join(", ")})…` : "Capturing…";
}

captureButton.addEventListener("click", async () => {
    const asking = maybeAskDebugger();
    busy(true);
    await asking;
    say(capturingText());
    const reply = await ask("capture-send");
    busy(false);
    if (reply.ok) say(reply.via === "server" ? "Sent to the server. It opens in a new tab." : "Sent to Nagma. It opens as a new file.");
    else say(reply.error, true);
});

function fileName(title: string): string {
    const safe = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return `${safe || "Page"}.nagma-capture.json`;
}

downloadButton.addEventListener("click", async () => {
    const asking = maybeAskDebugger();
    busy(true);
    await asking;
    say(capturingText());
    const reply = await ask("capture-get");
    busy(false);
    if (!reply.ok || !reply.capture) {
        say(reply.ok ? "Nothing was captured." : reply.error, true);
        return;
    }
    const blob = new Blob([JSON.stringify(reply.capture)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(reply.capture.title);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say("Saved. Drop the file on Nagma's Home, or use File › Import.");
});

askDebugger.addEventListener("click", (e) => {
    e.preventDefault();
    void maybeAskDebugger(true);
});

function refresh() {
    breakpoints.disabled = !current.breakpointsOn;
    precise.hidden = !canDebug() || debuggerGranted || !current.debuggerDeclined || !wantsDevtools();
}

async function load() {
    current = await loadSettings();
    if (canDebug()) debuggerGranted = await chrome.permissions.contains({ permissions: ["debugger"] });
    if (ADDRESSES.includes(current.address)) address.value = current.address;
    else {
        address.value = "custom";
        custom.hidden = false;
        custom.value = current.address;
    }
    states.checked = current.states;
    breakpointsOn.checked = current.breakpointsOn;
    breakpoints.value = current.breakpoints || DEFAULT_BREAKPOINTS;
    interactive.checked = current.interactive;
    viaServer.checked = current.viaServer;
    token.value = await loadToken();
    refresh();
}

async function saveAddress() {
    const value = address.value === "custom" ? custom.value.trim() : address.value;
    custom.hidden = address.value !== "custom";
    if (!value) return;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
        current.address = url.origin;
        await chrome.storage.sync.set({ address: url.origin });
        say("");
    } catch {
        say("That address isn't a web address.", true);
    }
}

async function saveChoices() {
    current = { ...current, states: states.checked, breakpointsOn: breakpointsOn.checked, interactive: interactive.checked, viaServer: viaServer.checked };
    const parsed = parseBreakpoints(breakpoints.value);
    if (current.breakpointsOn && parsed.length < 2) say("Breakpoints need two widths or more, such as “Desktop 1280, Phone 375”.", true);
    else {
        current.breakpoints = breakpoints.value.trim() || DEFAULT_BREAKPOINTS;
        say("");
    }
    await chrome.storage.sync.set({ states: current.states, breakpointsOn: current.breakpointsOn, breakpoints: current.breakpoints, interactive: current.interactive, viaServer: current.viaServer });
    refresh();
}

address.addEventListener("change", () => void saveAddress());
custom.addEventListener("change", () => void saveAddress());
for (const input of [states, breakpointsOn, interactive, viaServer]) input.addEventListener("change", () => void saveChoices());
breakpoints.addEventListener("change", () => void saveChoices());
token.addEventListener("change", () => void chrome.storage.local.set({ token: token.value.trim() }));
void load();
