import { useSyncExternalStore } from "react";

// Which Nagma server this device talks to. "This computer" is the server the app came with: the one
// built into the desktop app, the one that served this page on the web (or VITE_SYNC_URL / the
// development server). Anyone can run a server of their own (docs/self-hosting.md) and connect to it
// here; the list of servers and the one in use are kept for the device, not per account
// (engine/user-storage.ts). Each server has its own sessions, and what this browser keeps for a
// person (drafts, tabs, recents…) is kept apart per server, as it is per account: switching servers
// reloads the page like switching accounts does (engine/auth.ts connectToServer).

export interface ServerInfo {
    // http(s) origin, without a trailing slash.
    origin: string;
    name: string;
    version: string | null;
    publicUrl?: string | null;
}

interface Registry {
    servers: ServerInfo[];
    // The origin in use, or null for This computer.
    current: string | null;
}

export const SERVERS_KEY = "nagma.servers.v1";
const AUTH_KEY = "nagma.auth.v1";
const DEV_SERVER_PORT = 8787;

// ---- This computer ----

// The server the app came with, as a ws(s):// base: VITE_SYNC_URL if set; the separate development
// server (port 8787) under Vite; otherwise the address the editor was loaded from (the server hosts both).
export function defaultSyncBase(): string {
    const configured = import.meta.env.VITE_SYNC_URL as string | undefined;
    if (configured) return configured.replace(/\/$/, "");
    const secure = location.protocol === "https:";
    if (import.meta.env.DEV) return `${secure ? "wss" : "ws"}://${location.hostname}:${DEV_SERVER_PORT}`;
    return `${secure ? "wss" : "ws"}://${location.host}`;
}
export const defaultOrigin = () => toOrigin(defaultSyncBase().replace(/^ws/, "http")) ?? location.origin;

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;
const inDesktopApp = () => typeof window !== "undefined" && Boolean((window as unknown as { nagmaDesktop?: unknown }).nagmaDesktop);

// What This computer is called: in the desktop app (and on a server running on this machine) it is
// this computer's; on a server elsewhere, that server's address.
export function localServerLabel(): string {
    if (inDesktopApp()) return "This computer";
    try {
        const host = new URL(defaultOrigin()).hostname;
        return LOOPBACK.test(host) ? "This computer" : new URL(defaultOrigin()).host;
    } catch {
        return "This computer";
    }
}

// ---- The project's hosted server ----

// The server the Nagma project runs for everyone: free, needs an account (with a verified email
// before sharing). A fork can point the app at its own with VITE_HOSTED_SERVER_URL at build time, or
// set it to "" to leave the hosted choice out.
export const HOSTED_SERVER = { name: "Nagma", url: "https://api.nagma.app" } as const;
export interface HostedServer {
    name: string;
    // http(s) origin, without a trailing slash.
    origin: string;
}

// The hosted server for a build setting: unset is the project's, "" turns it off, anything else is
// that address (null when it isn't one).
export function hostedServerFrom(setting: string | undefined): HostedServer | null {
    if (setting === undefined) return { name: HOSTED_SERVER.name, origin: HOSTED_SERVER.url };
    if (!setting.trim()) return null;
    const origin = normalizeServerUrl(setting);
    return origin ? { name: HOSTED_SERVER.name, origin } : null;
}
export const hostedServer = (): HostedServer | null => hostedServerFrom(import.meta.env.VITE_HOSTED_SERVER_URL as string | undefined);
export const isHostedOrigin = (origin: string | null | undefined) => Boolean(origin) && hostedServer()?.origin === origin;

// ---- Addresses ----

function toOrigin(url: string): string | null {
    try {
        const u = new URL(url);
        return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
    } catch {
        return null;
    }
}

// What someone typed as a server's address, as an origin: "nagma.example.com" is https, a machine on
// this computer or the local network ("localhost:8080", "192.168.1.4:8080") is http unless they said
// otherwise. Paths are dropped (the server answers at its root). Null when it isn't an address.
export function normalizeServerUrl(input: string): string | null {
    const raw = input.trim().replace(/\/+$/, "");
    if (!raw || /\s/.test(raw)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return toOrigin(raw.replace(/^ws(s?):/i, "http$1:"));
    const host = raw.split(/[/?#]/)[0] ?? "";
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(host) || /^[^.]+(:\d+)?$/.test(host);
    return toOrigin(`${local ? "http" : "https"}://${raw}`);
}

const sameServer = (a: string | null, b: string | null) => (a ?? defaultOrigin()) === (b ?? defaultOrigin());

// ---- The list, kept for the device ----

let cache: Registry | null = null;
const listeners = new Set<() => void>();

function clean(raw: unknown): Registry {
    const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Registry>;
    const servers = (Array.isArray(r.servers) ? r.servers : [])
        .map((s): ServerInfo | null => {
            const origin = typeof s?.origin === "string" ? toOrigin(s.origin) : null;
            return origin ? { origin, name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 80) : new URL(origin).host, version: typeof s.version === "string" ? s.version.slice(0, 40) : null, publicUrl: typeof s.publicUrl === "string" ? s.publicUrl : null } : null;
        })
        .filter((s): s is ServerInfo => s !== null)
        .filter((s, i, all) => all.findIndex((o) => o.origin === s.origin) === i);
    const current = typeof r.current === "string" ? toOrigin(r.current) : null;
    // A current server that isn't on the list (or is This computer's own address) is This computer.
    return { servers, current: current && servers.some((s) => s.origin === current) && current !== defaultOrigin() ? current : null };
}

function read(): Registry {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(SERVERS_KEY);
        cache = clean(raw ? JSON.parse(raw) : null);
    } catch {
        cache = { servers: [], current: null };
    }
    return cache;
}

function write(next: Registry) {
    cache = clean(next);
    try {
        localStorage.setItem(SERVERS_KEY, JSON.stringify(cache));
    } catch {
        // Kept for this page only.
    }
    for (const l of [...listeners]) l();
}

// Another tab changed the list: read it again. Returns whether the server in use changed.
export function reloadServers(): boolean {
    const was = read().current;
    cache = null;
    for (const l of [...listeners]) l();
    return read().current !== was;
}

export const knownServers = () => read().servers;
// The server in use, or null for This computer.
export const currentServer = (): ServerInfo | null => {
    const r = read();
    return r.current ? (r.servers.find((s) => s.origin === r.current) ?? null) : null;
};
export const currentServerOrigin = () => currentServer()?.origin ?? defaultOrigin();
export const currentServerLabel = () => currentServer()?.name ?? localServerLabel();

// Remembers a server (or refreshes its name and version), without connecting to it.
export function rememberServer(info: ServerInfo) {
    const r = read();
    const servers = r.servers.some((s) => s.origin === info.origin) ? r.servers.map((s) => (s.origin === info.origin ? { ...s, ...info } : s)) : [...r.servers, info];
    write({ ...r, servers });
}

// Takes a server off the list. The one in use can't be: switch away first.
export function forgetServer(origin: string): boolean {
    const r = read();
    if (r.current === origin) return false;
    write({ ...r, servers: r.servers.filter((s) => s.origin !== origin) });
    return true;
}

// Only writes which server is in use (null: This computer). Switching goes through
// engine/auth.ts connectToServer, which also changes the session and reloads the page.
export function setCurrentServer(origin: string | null) {
    const r = read();
    write({ ...r, current: origin === null || sameServer(origin, null) ? null : origin });
}

export function subscribeServers(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function useServers(): Registry {
    return useSyncExternalStore(subscribeServers, read);
}

// ---- What depends on the server in use ----

// The sync server as a ws(s):// base (engine/server-url.ts).
export function serverSyncBase(): string {
    const current = currentServer();
    return current ? current.origin.replace(/^http/, "ws") : defaultSyncBase();
}

// A short, stable id for a server, for names that must stay apart per server.
export function serverKey(origin: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < origin.length; i++) h = Math.imul(h ^ origin.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36);
}

// Added to the storage scope of whoever is signed in (engine/user-storage.ts): nothing on This
// computer, so what was kept before servers could be switched stays where it was.
export function scopeSuffix(): string {
    const current = currentServer();
    return current ? `~${serverKey(current.origin)}` : "";
}

// Where the session for the server in use is kept (engine/auth.ts).
export function authStorageKey(): string {
    const current = currentServer();
    return current ? `${AUTH_KEY}@${current.origin}` : AUTH_KEY;
}

// ---- Asking a server who it is ----

// Fetches <origin>/health: a Nagma server answers with its name and version. Throws a sentence
// saying what went wrong.
export async function checkServer(input: string, timeoutMs = 8000): Promise<ServerInfo> {
    const origin = normalizeServerUrl(input);
    if (!origin) throw new Error("Enter the server's address, like nagma.example.com.");
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
        res = await fetch(`${origin}/health`, { headers: { accept: "application/json" }, signal: controller?.signal });
    } catch {
        throw new Error(`Couldn't reach ${new URL(origin).host}. Check the address and that the server is running.`);
    } finally {
        if (timer) clearTimeout(timer);
    }
    const body = (await res.json().catch(() => null)) as { ok?: unknown; name?: unknown; version?: unknown; publicUrl?: unknown } | null;
    if (!res.ok || !body || body.ok !== true) throw new Error(`${new URL(origin).host} doesn't look like a Nagma server.`);
    return {
        origin,
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : new URL(origin).host,
        version: typeof body.version === "string" ? body.version.slice(0, 40) : null,
        publicUrl: typeof body.publicUrl === "string" ? body.publicUrl : null,
    };
}

// ---- Links ----

// On a server other than This computer, links meant for other people point at that server's own
// address (it serves the editor too), not at this app's (null on This computer).
export function remoteLinkBase(): string | null {
    const current = currentServer();
    return current ? (current.publicUrl ? toOrigin(current.publicUrl) : null) ?? current.origin : null;
}
// The address a link for other people starts from: the page's own, or the server's (above).
export function shareableUrl(): URL {
    const remote = remoteLinkBase();
    return remote ? new URL(`${remote}/`) : new URL(location.origin + location.pathname);
}

// A link whose host only answers on this computer or its local network: localhost and loopback,
// private and link-local IPv4 (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10), IPv6 loopback,
// unique-local and link-local, names without a dot and .local/.lan/.internal/.home.arpa names. The
// app never offers such a link to copy unless someone asks for a local link (same network only).
export function isLocalOnlyLink(href: string): boolean {
    let host: string;
    try {
        host = new URL(href).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    } catch {
        return true;
    }
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
    const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
    if (v4) {
        const a = Number(v4[1]);
        const b = Number(v4[2]);
        return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host);
    if (!host.includes(".")) return true;
    return /\.(local|lan|internal|home\.arpa)$/.test(host);
}

// Links to files carry the server they're on when it isn't This computer and the link doesn't
// already point at it (?server=<origin>), so whoever opens them is offered to switch to it.
export function withServer(url: URL): URL {
    const current = currentServer();
    if (current && url.origin !== current.origin && url.origin !== remoteLinkBase()) url.searchParams.set("server", current.origin);
    else url.searchParams.delete("server");
    return url;
}

// The server a link in the address bar is for, when it isn't the one in use (null otherwise).
export function linkedServer(href: string = typeof location === "undefined" ? "" : location.href): string | null {
    try {
        const value = new URL(href).searchParams.get("server");
        if (!value) return null;
        const origin = normalizeServerUrl(value);
        if (!origin || sameServer(origin, currentServer()?.origin ?? null)) return null;
        return origin;
    } catch {
        return null;
    }
}

// ---- The server picker (components/server-picker.tsx), opened from Home's account menu, the
// sign-in dialog and the desktop app's menu ----

let pickerOpen = false;
const pickerListeners = new Set<() => void>();
function setPicker(open: boolean) {
    pickerOpen = open;
    for (const l of [...pickerListeners]) l();
}
export const openServerPicker = () => setPicker(true);
export const closeServerPicker = () => setPicker(false);
export function useServerPickerOpen(): boolean {
    return useSyncExternalStore(
        (l) => {
            pickerListeners.add(l);
            return () => pickerListeners.delete(l);
        },
        () => pickerOpen,
    );
}
