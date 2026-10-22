import { useSyncExternalStore } from "react";
import { setAiSettingsOpener } from "./ai-settings";
import { auth, authHeaders, mailLinkOrigin, refreshSession } from "./auth";
import { httpBase } from "./server-url";
import { editor } from "./store";
import { getStarredFiles, replaceStarredFiles, subscribeStarredFiles } from "./files";
import { getStarred, replaceStarred, subscribeStarred } from "./teams";

// Account settings on the sync server: name and picture, email (changed through a confirmation link
// sent to the new address), notification preferences by email and on the desktop, the community
// profile, connected sign-in methods, and deleting the account. Starred files and folders follow
// the account too.

export const NOTICE_KINDS = ["comments", "mentions", "invites", "requests", "devStatus", "reviews"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_KIND_LABELS: Record<NoticeKind, [string, string]> = {
    comments: ["Comments", "Replies in threads you're part of and new comments on your files"],
    mentions: ["Mentions", "When someone @mentions you in a comment or on a board"],
    invites: ["Invites", "When you're invited to a file, folder or team"],
    requests: ["Requests", "Access, seat and credit requests that need your answer"],
    devStatus: ["Dev status", "Designs marked ready for dev or completed"],
    reviews: ["Reviews", "Branch and asset reviews you're asked for or that are answered"],
};

export type NotifyPrefs = Record<NoticeKind, { email: boolean; desktop: boolean }>;

export interface AccountView {
    id: string;
    name: string;
    email: string;
    color: string;
    avatar: string | null;
    handle: string;
    profile: { handle: string; bio: string };
    notify: NotifyPrefs;
    emailDigests: boolean;
    emailPending: string | null;
    connected: { id: string; name: string; detail: string; removable: boolean }[];
    createdAt: number | null;
}

// A server path for a picture (/avatars/…) as an address the browser can load.
export const avatarSrc = (path: string | null | undefined) => (path ? `${httpBase()}${path}` : null);

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

let view: AccountView | null = null;
const listeners = new Set<() => void>();
function setView(next: AccountView | null) {
    view = next;
    for (const l of listeners) l();
    // The name and picture shown everywhere come from the session's account.
    if (next) void refreshSession();
}
export function useAccountView(): AccountView | null {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => view,
    );
}
export function accountView(): AccountView | null {
    return view;
}

export async function loadAccount(): Promise<AccountView | null> {
    if (!auth.get().user) return (setView(null), null);
    try {
        const next = await api<AccountView>("/account");
        setView(next);
        return next;
    } catch {
        return view;
    }
}

export const saveAccount = async (patch: { name?: string; profile?: { handle: string; bio: string }; notify?: Partial<NotifyPrefs>; disconnect?: string }) => setView(await api<AccountView>("/account", { method: "PUT", body: JSON.stringify(patch) }));

// A picture from this computer, made square and small before it's sent.
export async function uploadAvatar(file: File): Promise<void> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(256, side);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't resize pictures.");
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.9);
    setView(await api<AccountView>("/account/avatar", { method: "PUT", body: JSON.stringify({ data }) }));
}
export const removeAvatar = async () => setView(await api<AccountView>("/account/avatar", { method: "DELETE" }));

// Starts an email change: the current password, then a link mailed to the new address.
// `mailConfigured` is false when the server has no SMTP set up; `kept` when it wrote the link to its
// data folder instead (development servers with NAGMA_DEV_MAIL_FILE=1).
export async function changeEmail(email: string, password: string): Promise<{ sent: boolean; mailConfigured: boolean; kept: boolean }> {
    const next = await api<AccountView & { sent: boolean; mailConfigured?: boolean; kept?: boolean }>("/account/email", { method: "POST", body: JSON.stringify({ email, password, origin: mailLinkOrigin() }) });
    setView(next);
    return { sent: next.sent, mailConfigured: Boolean(next.mailConfigured), kept: Boolean(next.kept) };
}
export const cancelEmailChange = async () => setView(await api<AccountView>("/account/email", { method: "DELETE" }));

export const transferInfo = () => api<{ owned: number; people: { id: string; name: string; email: string; color: string; avatar: string | null }[]; blocking: string[] }>("/account/transfer");

export async function deleteAccount(password: string, transferTo: string | null): Promise<void> {
    await api("/account", { method: "DELETE", body: JSON.stringify({ password, transferTo }) });
}

// Back from the confirmation mail (?verify-email=…): the new email takes over and the address is cleaned up.
async function finishEmailChange() {
    const params = new URLSearchParams(location.search);
    const token = params.get("verify-email");
    if (!token) return;
    params.delete("verify-email");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    try {
        const res = await fetch(`${httpBase()}/account/email/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
        const data = (await res.json().catch(() => ({}))) as { email?: string; error?: string };
        editor.notify(res.ok ? `Your email is now ${data.email}.` : (data.error ?? "That confirmation link didn't work."));
        if (res.ok) void refreshSession();
    } catch {
        editor.notify("The server can't be reached to confirm your email.");
    }
}
void finishEmailChange();

// ---- The settings dialog (components/account-settings.tsx): which tab is open, if any ----

export type SettingsTab = "account" | "notifications" | "security" | "community" | "tokens" | "ai" | "stats";

let openTab: SettingsTab | null = null;
const settingsListeners = new Set<() => void>();
export function openAccountSettings(tab: SettingsTab = "account") {
    openTab = tab;
    for (const l of settingsListeners) l();
}
// The AI tab opens signed out too (a key for this browser or this computer).
setAiSettingsOpener(() => openAccountSettings("ai"));
export function closeAccountSettings() {
    openTab = null;
    for (const l of settingsListeners) l();
}

export function useSettingsTab(): SettingsTab | null {
    return useSyncExternalStore(
        (l) => {
            settingsListeners.add(l);
            return () => settingsListeners.delete(l);
        },
        () => openTab,
    );
}

// ---- Appearance: dark, light, or whatever the system uses ----

const SYSTEM_KEY = "nagma.theme.system.v1";
export type Appearance = "dark" | "light" | "system";
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
let followSystem = (() => {
    try {
        return localStorage.getItem(SYSTEM_KEY) === "1";
    } catch {
        return false;
    }
})();
const applySystem = () => followSystem && media && editor.setPrefs({ theme: media.matches ? "dark" : "light" });
media?.addEventListener("change", applySystem);
applySystem();
export function appearance(): Appearance {
    return followSystem ? "system" : editor.get().prefs.theme;
}
export function setAppearance(next: Appearance) {
    followSystem = next === "system";
    try {
        localStorage.setItem(SYSTEM_KEY, followSystem ? "1" : "0");
    } catch {
        // Not remembered.
    }
    if (next === "system") applySystem();
    else editor.setPrefs({ theme: next });
}

// ---- Stars follow the account: merged on sign-in, saved after each change ----

let syncing = false;
let starTimer = 0;
function pushStars() {
    if (syncing || !auth.get().user) return;
    window.clearTimeout(starTimer);
    starTimer = window.setTimeout(() => void api("/account/stars", { method: "PUT", body: JSON.stringify({ files: getStarredFiles(), folders: getStarred() }) }).catch(() => undefined), 400);
}
subscribeStarred(pushStars);
subscribeStarredFiles(pushStars);
async function pullStars() {
    if (!auth.get().user) return;
    try {
        const saved = await api<{ files: string[]; folders: string[] }>("/account/stars");
        syncing = true;
        replaceStarredFiles([...new Set([...saved.files, ...getStarredFiles()])]);
        replaceStarred([...new Set([...saved.folders, ...getStarred()])]);
    } catch {
        // Stars stay as they are in this browser.
    } finally {
        syncing = false;
    }
    pushStars();
}
auth.onChange(() => void pullStars().then(() => loadAccount()));
void pullStars();
