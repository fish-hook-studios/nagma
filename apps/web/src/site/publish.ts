import { authHeaders } from "../engine/auth";
import { collab, lanAddress, shareCurrent } from "../engine/collab";
import { download, safeName, zipFiles } from "../engine/export";
import { fileMeta } from "../engine/files";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import { buildSite, siteFiles } from "./html";

// Publishing: the built site goes to the sync server, which serves it at /sites/<file id>/ (only the
// file's editors can publish or take it down). Download makes the same files as a zip to host anywhere.

export interface PublishStatus {
    published: boolean;
    publishedAt: number | null;
    by: string | null;
    pages: number;
    bytes: number;
}

function key(): string {
    const keys = collab.get().keys;
    return keys?.edit ?? fileMeta(editor.get().fileId)?.key ?? "";
}

export function sharedId(): string | null {
    const s = collab.get();
    return s.status !== "local" && s.fileId ? s.fileId : null;
}

// The published site's address, using this computer's network address when opened on localhost.
export function siteUrl(id: string): string {
    const url = new URL(`${httpBase()}/sites/${id}/`);
    const lan = lanAddress();
    if (lan && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.hostname = lan;
    return url.toString();
}

export async function publishStatus(id: string): Promise<PublishStatus | null> {
    try {
        const res = await fetch(`${httpBase()}/files/${id}/site?key=${encodeURIComponent(key())}`, { headers: authHeaders() });
        if (!res.ok) return null;
        return (await res.json()) as PublishStatus;
    } catch {
        return null;
    }
}

async function toBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
}

// Shares a local file first (a published site lives with the shared file), then waits for the server.
export async function ensureShared(): Promise<string | null> {
    const existing = sharedId();
    if (existing && collab.get().status === "live") return existing;
    if (!existing) shareCurrent();
    const started = performance.now();
    while (performance.now() - started < 10000) {
        const s = collab.get();
        if (s.status === "live" && s.fileId) return s.fileId;
        await new Promise((r) => setTimeout(r, 150));
    }
    return null;
}

export async function publishSite(onProgress?: (text: string) => void): Promise<{ ok: true; status: PublishStatus; warnings: string[] } | { ok: false; error: string }> {
    if (collab.get().role && collab.get().role !== "edit") return { ok: false, error: "Only people who can edit this file can publish it." };
    onProgress?.("Saving the file to the server…");
    const id = await ensureShared();
    if (!id) return { ok: false, error: "The server can't be reached, so the site can't be published right now." };
    onProgress?.("Building the pages…");
    const build = await buildSite(editor.get().doc, "publish");
    const files = await siteFiles(build);
    onProgress?.(`Uploading ${files.length} files…`);
    const body = JSON.stringify({ files: await Promise.all(files.map(async (f) => ({ path: f.path, data: await toBase64(f.blob) }))) });
    try {
        const res = await fetch(`${httpBase()}/files/${id}/site?key=${encodeURIComponent(key())}`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body });
        const reply = (await res.json().catch(() => ({}))) as PublishStatus & { error?: string };
        if (!res.ok) return { ok: false, error: reply.error ?? "Publishing failed." };
        return { ok: true, status: reply, warnings: build.warnings };
    } catch {
        return { ok: false, error: "The server can't be reached, so the site can't be published right now." };
    }
}

export async function unpublishSite(id: string): Promise<boolean> {
    try {
        const res = await fetch(`${httpBase()}/files/${id}/site?key=${encodeURIComponent(key())}`, { method: "DELETE", headers: authHeaders() });
        return res.ok;
    } catch {
        return false;
    }
}

export async function siteZip(): Promise<Blob> {
    const build = await buildSite(editor.get().doc, "publish");
    const files = await siteFiles(build);
    return zipFiles(files.map((f) => ({ name: f.path, blob: f.blob })));
}

export async function downloadSite() {
    const blob = await siteZip();
    download(blob, `${safeName(editor.get().doc.name || "Site")}.zip`);
}

// ---- Address and access: a name (/s/<name>/ and <name>.<sites domain>), a custom domain checked
// through DNS, and who may view it (anyone, a password, or people signed in to this server). Sites
// and Make's apps share this; each passes where its settings live on the server. ----

export interface SiteHosting {
    slug: string | null;
    domain: string | null;
    verified: boolean;
    checkedAt: number | null;
    access: "public" | "password" | "team";
    sitesDomain: string;
    records: { type: string; name: string; value: string }[];
    checks?: { type: string; ok: boolean }[];
}

export interface HostingPatch {
    slug?: string | null;
    domain?: string | null;
    access?: "public" | "password" | "team";
    password?: string;
}

export interface HostingApi {
    load(): Promise<SiteHosting | { error: string }>;
    save(patch: HostingPatch): Promise<SiteHosting | { error: string }>;
    verify(): Promise<SiteHosting | { error: string }>;
    ticket(): Promise<string | null>;
}

// Where one published thing's settings live on the server, and the file key to send.
export function hostingApi(paths: { settings: string; verify: string; ticket: string }, key: string): HostingApi {
    const call = async <T>(path: string, init?: RequestInit): Promise<T | { error: string }> => {
        try {
            const res = await fetch(`${httpBase()}${path}${key ? `?key=${encodeURIComponent(key)}` : ""}`, { ...init, headers: { "content-type": "application/json", ...authHeaders() } });
            const body = (await res.json().catch(() => ({}))) as T & { error?: string };
            return res.ok ? body : { error: body.error ?? "The server didn't accept that." };
        } catch {
            return { error: "The server can't be reached." };
        }
    };
    return {
        load: () => call<SiteHosting>(paths.settings),
        save: (patch) => call<SiteHosting>(paths.settings, { method: "PUT", body: JSON.stringify(patch) }),
        verify: () => call<SiteHosting>(paths.verify, { method: "POST" }),
        ticket: async () => {
            const out = await call<{ ticket: string }>(paths.ticket, { method: "POST" });
            return "ticket" in out ? out.ticket : null;
        },
    };
}

export const siteHostingApi = (id: string) => hostingApi({ settings: `/files/${id}/site/settings`, verify: `/files/${id}/site/verify`, ticket: `/files/${id}/site/ticket` }, key());

// The addresses a published site or app answers at.
export function hostedUrls(h: SiteHosting): { label: string; url: string }[] {
    const base = new URL(httpBase());
    const out: { label: string; url: string }[] = [];
    if (h.slug) {
        out.push({ label: "Address", url: `${base.origin}/s/${h.slug}/` });
        out.push({ label: "Subdomain", url: `${base.protocol}//${h.slug}.${h.sitesDomain}${base.port ? `:${base.port}` : ""}/` });
    }
    if (h.domain && h.verified) out.push({ label: "Custom domain", url: `https://${h.domain}/` });
    return out;
}
