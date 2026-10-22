// The toolbar popup: capture the page (sent to Nagma, or saved as a file) and the options.

import type { Capture } from "../../web/src/engine/capture-format";
import { ADDRESSES, DEFAULT_SETTINGS, type Settings } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>("status");
const captureButton = $<HTMLButtonElement>("capture");
const downloadButton = $<HTMLButtonElement>("download");
const address = $<HTMLSelectElement>("address");
const custom = $<HTMLInputElement>("custom");

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

type Reply = { ok: true; capture?: Capture } | { ok: false; error: string };

async function ask(type: "capture-send" | "capture-get"): Promise<Reply> {
    const tabId = await activeTab();
    if (tabId === null) return { ok: false, error: "No page to capture." };
    return (await chrome.runtime.sendMessage({ type, tabId })) as Reply;
}

captureButton.addEventListener("click", async () => {
    busy(true);
    say("Capturing…");
    const reply = await ask("capture-send");
    busy(false);
    if (reply.ok) say("Sent to Nagma. It opens as a new file.");
    else say(reply.error, true);
});

function fileName(title: string): string {
    const safe = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return `${safe || "Page"}.nagma-capture.json`;
}

downloadButton.addEventListener("click", async () => {
    busy(true);
    say("Capturing…");
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

async function load() {
    const s = { ...DEFAULT_SETTINGS, ...((await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Settings) };
    if (ADDRESSES.includes(s.address)) address.value = s.address;
    else {
        address.value = "custom";
        custom.hidden = false;
        custom.value = s.address;
    }
}

async function save() {
    const value = address.value === "custom" ? custom.value.trim() : address.value;
    custom.hidden = address.value !== "custom";
    if (!value) return;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
        await chrome.storage.sync.set({ address: url.origin });
        say("");
    } catch {
        say("That address isn't a web address.", true);
    }
}

address.addEventListener("change", () => void save());
custom.addEventListener("change", () => void save());
void load();
