import { useSyncExternalStore } from "react";
import { auth, authHeaders } from "./auth";
import { httpBase } from "./server-url";
import { editor } from "./store";

// AI with your own key (Account settings › AI). Signed in, the key is kept by the server with the
// account, encrypted; in the desktop app without an account, by the app's own server on this
// computer. In a browser without an account it stays in this browser (localStorage, for the whole
// device rather than one account) and goes with each AI request in the x-nagma-ai header.
//
// Every AI entry point reads the server's answer with `aiError`: code "ai-key-needed" means there's
// no key to use, and the entry point says so with a button to this tab (`notifyKeyNeeded`).

export type AiProvider = "anthropic" | "openai" | "compatible";
export type ImageProvider = "openai" | "compatible";
export type AiScope = "account" | "device" | "browser";

export interface AiModel {
    id: string;
    label: string;
}

export interface AiSettingsView {
    scope: AiScope;
    signedIn: boolean;
    text: { provider: AiProvider; model: string; baseUrl: string; keySet: boolean; keyEnd: string; models: AiModel[]; savedAt: number | null } | null;
    image: { provider: ImageProvider; model: string; baseUrl: string; keySet: boolean; keyEnd: string } | null;
    shared: { text: boolean; image: boolean; provider: string | null; disabled: boolean };
    usage: { requests: number; input: number; output: number; tokens: number; shared: { requests: number; tokens: number } | null };
    perMinute: number;
    privateUrls: boolean;
    providers: { id: AiProvider; label: string; defaultModel: string }[];
    imageProviders: { id: ImageProvider; label: string; defaultModel: string }[];
}

export const KEY_NEEDED = "Add your AI key in Account settings to use this.";
export const PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: "Claude", openai: "OpenAI", compatible: "OpenAI-compatible" };

// ---- The key kept in this browser (signed out, not in the desktop app) ----

const BROWSER_KEY = "nagma.ai.browser.v1";
interface BrowserAi {
    provider: AiProvider;
    key: string;
    model: string;
    baseUrl: string;
    models?: AiModel[];
    image?: { provider: ImageProvider; key: string; model: string; baseUrl: string } | null;
}

function readBrowser(): BrowserAi | null {
    try {
        const v = JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "null") as BrowserAi | null;
        return v && typeof v === "object" && v.provider ? v : null;
    } catch {
        return null;
    }
}
function writeBrowser(next: BrowserAi | null) {
    try {
        if (next) localStorage.setItem(BROWSER_KEY, JSON.stringify(next));
        else localStorage.removeItem(BROWSER_KEY);
    } catch {
        // Storage is off: the key lasts until the page closes.
    }
}

const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Headers for an AI request: the browser's key, only while signed out (an account's key is the server's).
export function aiHeaders(): Record<string, string> {
    if (auth.get().user) return {};
    const b = readBrowser();
    if (!b) return {};
    const { models: _models, ...send } = b;
    return { "x-nagma-ai": encode(send) };
}

// Everything an AI request sends: the session and, signed out, the browser's key.
export const aiRequestHeaders = (): Record<string, string> => ({ ...authHeaders(), ...aiHeaders() });

// ---- Errors from AI routes ----

export interface AiFailure {
    status: number;
    code: string | null;
    error: string;
}

// The JSON error of a failed AI request (or its text, from older servers).
export async function aiError(res: Response): Promise<AiFailure> {
    const text = await res.text().catch(() => "");
    try {
        const data = JSON.parse(text) as { error?: string; code?: string };
        return { status: res.status, code: data.code ?? null, error: data.error ?? `The server answered ${res.status}.` };
    } catch {
        return { status: res.status, code: null, error: text || `The server answered ${res.status}.` };
    }
}
export const keyNeeded = (f: AiFailure | null | undefined) => f?.code === "ai-key-needed";

// ---- The settings tab ----

let openHook: (() => void) | null = null;
// account.ts sets how the tab opens (kept apart so this module doesn't import the dialog's state).
export function setAiSettingsOpener(open: () => void) {
    openHook = open;
}
export function openAiSettings() {
    openHook?.();
}

// A notice with a button to the AI tab.
export function notifyKeyNeeded(message = KEY_NEEDED) {
    editor.notify(message, { label: "Open AI settings", run: openAiSettings });
}

let view: AiSettingsView | null = null;
let version = 0;
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
function setView(next: AiSettingsView | null) {
    view = next;
    for (const l of listeners) l();
}
// Called after a key or model changes (cached availability, such as image generation, is stale).
export function onAiChange(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
}
function changed() {
    version++;
    for (const l of changeListeners) l();
}
export const aiVersion = () => version;

export function useAiSettings(): AiSettingsView | null {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => view,
    );
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...aiRequestHeaders(), ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error((await aiError(res)).error);
    return (await res.json()) as T;
}

// The browser's own models list fills in what the server can't know.
function withBrowser(next: AiSettingsView): AiSettingsView {
    if (next.scope !== "browser" || !next.text) return next;
    return { ...next, text: { ...next.text, models: readBrowser()?.models ?? [] } };
}

export async function loadAiSettings(): Promise<AiSettingsView | null> {
    try {
        const next = withBrowser(await api<AiSettingsView>("/ai/settings"));
        setView(next);
        return next;
    } catch {
        return view;
    }
}

export interface TextSettings {
    provider: AiProvider;
    key?: string;
    model?: string;
    baseUrl?: string;
}

// Saves a provider, key and model: the server makes one test call first and refuses a key that fails.
export async function saveAiText(input: TextSettings): Promise<AiSettingsView> {
    const out = await api<AiSettingsView & { saved: { model: string; models: AiModel[] } }>("/ai/settings", { method: "PUT", body: JSON.stringify(input) });
    if (out.scope === "browser") {
        const before = readBrowser();
        const key = input.key?.trim() || (before?.provider === input.provider ? before.key : "");
        writeBrowser({ provider: input.provider, key, model: out.saved.model, baseUrl: input.baseUrl?.trim() ?? "", models: out.saved.models, image: before?.image ?? null });
    }
    changed();
    return (await loadAiSettings()) ?? out;
}

export async function removeAiText(): Promise<void> {
    if (view?.scope === "browser") {
        const b = readBrowser();
        writeBrowser(b?.image ? { ...b, provider: "anthropic", key: "", model: "", baseUrl: "", models: [] } : null);
    } else await api("/ai/settings", { method: "DELETE" });
    changed();
    await loadAiSettings();
}

export interface ImageSettings {
    provider: ImageProvider | "none";
    key?: string;
    model?: string;
    baseUrl?: string;
}

export async function saveAiImage(input: ImageSettings): Promise<void> {
    const out = await api<AiSettingsView & { saved: { model?: string } }>("/ai/settings/image", { method: "PUT", body: JSON.stringify(input) });
    if (out.scope === "browser") {
        const b = readBrowser() ?? { provider: "anthropic" as AiProvider, key: "", model: "", baseUrl: "" };
        const keep = b.image?.provider === input.provider ? b.image.key : "";
        writeBrowser({ ...b, image: input.provider === "none" ? null : { provider: input.provider, key: input.key?.trim() || keep, model: out.saved.model ?? input.model ?? "", baseUrl: input.baseUrl?.trim() ?? "" } });
    }
    changed();
    await loadAiSettings();
}

export async function removeAiImage(): Promise<void> {
    const b = readBrowser();
    if (b) writeBrowser({ ...b, image: null });
    if (view?.scope !== "browser") await api("/ai/settings/image", { method: "DELETE" });
    changed();
    await loadAiSettings();
}

export async function testAi(): Promise<{ ok: boolean; ms?: number; model?: string; error?: string }> {
    try {
        const out = await api<{ ok: boolean; ms?: number; model?: string; error?: string }>("/ai/settings/test", { method: "POST" });
        void loadAiSettings();
        return out;
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export async function refreshAiModels(): Promise<AiModel[]> {
    const { models } = await api<{ models: AiModel[] }>("/ai/settings/models", { method: "POST" });
    const b = readBrowser();
    if (view?.scope === "browser" && b) writeBrowser({ ...b, models });
    await loadAiSettings();
    return models;
}

// "~48k tokens" for the usage line.
export function roughTokens(n: number): string {
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${Math.round(n / 100) / 10}k`.replace(".0k", "k");
    return `${Math.round(n / 100_000) / 10}M`.replace(".0M", "M");
}

// Signing in or out changes whose key answers.
auth.onChange(() => {
    changed();
    if (view) void loadAiSettings();
});

// ---- The server's shared key, for the admin console ----

export interface SharedUsage {
    configured: boolean;
    enabled: boolean;
    model: string | null;
    image: boolean;
    perMinute: number;
    days: { day: string; requests: number; tokens: number }[];
    people: { id: string; name: string; requests: number; tokens: number }[];
}

// The shared key's use over the last two weeks by a team's members (team admins).
export const loadSharedUsage = (teamId: string) => api<SharedUsage>(`/ai/shared-usage?team=${encodeURIComponent(teamId)}`);
