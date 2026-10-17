import { nanoid } from "nanoid";
import { auth, authHeaders, openSignIn } from "../engine/auth";
import { collab } from "../engine/collab";
import { ensureShared, hostingApi } from "../site/publish";
import { saveBlob } from "../engine/design-tokens";
import { fileMeta } from "../engine/files";
import { httpBase } from "../engine/server-url";
import { editor } from "../engine/store";
import { buildStatic, previewHtml, projectZip } from "./bundle";
import { applyAnswer, makeData, setPublished, updateMake } from "./model";
import { shareableUrl, withServer } from "../engine/servers";

// Publishing the app (built once here, uploaded as static files to the sync server's /apps/<id>/),
// downloading its code, and opening the preview in a tab of its own.

export const appUrl = (id: string) => `${httpBase()}/apps/${id}/`;

export async function publishApp(): Promise<string> {
    if (!auth.get().user) {
        openSignIn();
        throw new Error("Sign in to publish.");
    }
    const s = editor.get();
    if (s.readOnly) throw new Error("Only editors can publish this app.");
    const data = makeData(s.doc);
    if (!Object.keys(data.files).length) throw new Error("There's nothing to publish yet.");
    const meta = fileMeta(s.fileId);
    const sharedId = meta?.shared ?? (collab.get().status !== "local" ? collab.get().fileId : null);
    // The address stays the same when a file moves to the server after publishing.
    const appId = data.appId ?? sharedId ?? nanoid(12);
    const key = collab.get().keys?.edit ?? meta?.key ?? null;
    const built = await buildStatic(withCurrentBackend(data.files, data.appId, data.backend));
    if (built.errors.length) throw new Error(`Fix these first: ${built.errors.slice(0, 3).join(" ")}`);
    const res = await fetch(`${httpBase()}/apps/${appId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ fileId: sharedId, key, name: s.doc.name, files: built.files }),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string; publishedAt?: number };
    if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
    setPublished({ id: appId, at: out.publishedAt ?? Date.now() }, appId);
    return appUrl(appId);
}

export async function unpublishApp() {
    const s = editor.get();
    const data = makeData(s.doc);
    if (!data.published) return;
    const key = collab.get().keys?.edit ?? fileMeta(s.fileId)?.key ?? "";
    const res = await fetch(`${httpBase()}/apps/${data.published.id}${key ? `?key=${encodeURIComponent(key)}` : ""}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok && res.status !== 404) {
        const out = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(out.error ?? `The server answered ${res.status}.`);
    }
    setPublished(null);
}

export function downloadCode() {
    const s = editor.get();
    const name = s.doc.name || "App";
    saveBlob(projectZip(name, makeData(s.doc).files), `${name.replace(/[^\w.-]+/g, "-") || "app"}.zip`);
}

// The preview in a tab of its own: a page holding the app in the same sandboxed frame as here (the
// app never runs with the editor's origin).
export async function openPreviewTab() {
    const { html } = await previewHtml(makeData(editor.get().doc).files);
    const wrapper = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${(editor.get().doc.name || "App").replace(/[<&]/g, "")}</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style></head><body><iframe sandbox="allow-scripts allow-forms allow-modals allow-popups" srcdoc="${html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></body></html>`;
    const url = URL.createObjectURL(new Blob([wrapper], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- GitHub ----

// A token pasted for this session: kept in memory only (gone when the tab closes), sent only with a
// push, which the server passes straight to the GitHub API.
let githubToken = "";
export const setGitHubToken = (token: string) => (githubToken = token.trim());
export const hasGitHubToken = () => Boolean(githubToken);

export async function pushToGitHub(repo: string, opts: { create: boolean; private: boolean; message: string }): Promise<{ repo: string; url: string; created: boolean }> {
    if (!auth.get().user) {
        openSignIn();
        throw new Error("Sign in to push to GitHub.");
    }
    const s = editor.get();
    const data = makeData(s.doc);
    if (!Object.keys(data.files).length) throw new Error("There's nothing to push yet.");
    const meta = fileMeta(s.fileId);
    const fileId = meta?.shared ?? (collab.get().status !== "local" ? collab.get().fileId : null);
    const key = collab.get().keys?.edit ?? meta?.key ?? null;
    const files = Object.entries(data.files).map(([path, content]) => ({ path, content }));
    const res = await fetch(`${httpBase()}/ai/make/github`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ fileId, key, repo, token: githubToken || undefined, create: opts.create, private: opts.private, message: opts.message, description: s.doc.name, files }),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string; repo?: string; url?: string; created?: boolean };
    if (!res.ok || !out.repo || !out.url) throw new Error(out.error ?? `The server answered ${res.status}.`);
    updateMake((d) => ({ ...d, github: { repo: out.repo as string, url: out.url as string, at: Date.now() } }));
    return { repo: out.repo, url: out.url, created: Boolean(out.created) };
}

// ---- The built-in backend ----

const BACKEND_FILE = (base: string, appId: string) => `// The app's backend: collections of items kept on the Nagma server (written by Make; don't edit).
const BASE = ${JSON.stringify(`${base}/app-data/${appId}`)};

export interface Item {
    id: string;
    createdAt: number;
    [key: string]: unknown;
}

// A password or team-only app gets a token with its page; its data needs it.
const TOKEN = typeof document === "undefined" ? null : document.querySelector<HTMLMetaElement>('meta[name="nagma-app-token"]')?.content ?? null;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(TOKEN ? { "x-nagma-app-token": TOKEN } : {}) } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? \`Backend error \${res.status}\`);
    return res.json() as Promise<T>;
}

export function collection<T extends Record<string, unknown>>(name: string) {
    return {
        list: () => call<(T & Item)[]>(\`/\${name}\`),
        add: (item: T) => call<T & Item>(\`/\${name}\`, { method: "POST", body: JSON.stringify(item) }),
        update: (id: string, patch: Partial<T>) => call<T & Item>(\`/\${name}/\${id}\`, { method: "PUT", body: JSON.stringify(patch) }),
        remove: (id: string) => call<{ ok: true }>(\`/\${name}/\${id}\`, { method: "DELETE" }),
    };
}
`;

const BACKEND_PATH = "src/lib/backend.ts";
const BACKEND_MARK = "// The app's backend: collections of items kept on the Nagma server";

// The project's files with the backend helper brought up to date (projects made before it sent the
// data token of protected apps get the current one; a helper someone rewrote is left alone).
export function withCurrentBackend(files: Record<string, string>, appId: string | undefined, backend: boolean | undefined): Record<string, string> {
    const have = files[BACKEND_PATH];
    if (!backend || !appId || !have?.startsWith(BACKEND_MARK)) return files;
    const want = BACKEND_FILE(httpBase(), appId);
    return have === want ? files : { ...files, [BACKEND_PATH]: want };
}

// A data token for the preview of a password or team-only app (null for public apps).
export async function previewDataToken(appId: string): Promise<string | null> {
    if (!auth.get().user) return null;
    const s = editor.get();
    const meta = fileMeta(s.fileId);
    const fileId = meta?.shared ?? (collab.get().status !== "local" ? collab.get().fileId : null);
    const key = collab.get().keys?.edit ?? meta?.key ?? null;
    const res = await fetch(`${httpBase()}/ai/make/backend/token`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ appId, fileId, key }) }).catch(() => null);
    if (!res?.ok) return null;
    return ((await res.json().catch(() => ({}))) as { token?: string | null }).token ?? null;
}

export async function setBackend(on: boolean) {
    if (!on) {
        updateMake((d) => ({ ...d, backend: false }));
        return;
    }
    if (!auth.get().user) {
        openSignIn();
        throw new Error("Sign in to add a backend.");
    }
    const s = editor.get();
    const data = makeData(s.doc);
    const meta = fileMeta(s.fileId);
    const appId = data.appId ?? meta?.shared ?? (collab.get().status !== "local" ? collab.get().fileId : null) ?? nanoid(12);
    const res = await fetch(`${httpBase()}/ai/make/backend`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ appId }) });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
    updateMake((d) => ({ ...d, appId, backend: true, files: { ...d.files, "src/lib/backend.ts": BACKEND_FILE(httpBase(), appId) } }));
}

// ---- Kits and templates ----

export interface LibraryItem {
    id: string;
    kind: "kit" | "template";
    name: string;
    description: string;
    by: string;
    updatedAt: number;
    files: number;
    mine: boolean;
}

export async function listLibrary(kind?: "kit" | "template"): Promise<LibraryItem[]> {
    const res = await fetch(`${httpBase()}/ai/make/library${kind ? `?kind=${kind}` : ""}`, { headers: authHeaders() });
    const out = (await res.json().catch(() => ({}))) as { items?: LibraryItem[] };
    return out.items ?? [];
}

// What a kit carries: the components, styles, guidelines and helpers to build with (not the app's
// own pages); a template carries the whole project.
const KIT_PATH = /^(guidelines\.md|guidelines\/.*|src\/(components|ui|lib|hooks|styles)\/.*|src\/design-system\.css|src\/index\.css|package\.json)$/;

export async function publishToLibrary(kind: "kit" | "template", name: string, description: string): Promise<LibraryItem> {
    if (!auth.get().user) {
        openSignIn();
        throw new Error("Sign in to publish.");
    }
    const data = makeData(editor.get().doc);
    const files = Object.fromEntries(Object.entries(data.files).filter(([path]) => kind === "template" || KIT_PATH.test(path)));
    if (!Object.keys(files).length) throw new Error(kind === "kit" ? "A kit needs components, styles or guidelines (src/components, guidelines.md…)." : "There's nothing to publish yet.");
    const same = data.libraryItem?.kind === kind ? data.libraryItem.id : undefined;
    const res = await fetch(`${httpBase()}/ai/make/library`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ id: same, kind, name, description, files }) });
    const out = (await res.json().catch(() => ({}))) as LibraryItem & { error?: string };
    if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
    updateMake((d) => ({ ...d, libraryItem: { id: out.id, kind } }));
    return out;
}

// Starts from a kit (its files join the project) or a template (the project becomes a copy of it).
export async function startFromLibraryItem(id: string) {
    const res = await fetch(`${httpBase()}/ai/make/library?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
    const out = (await res.json().catch(() => ({}))) as { kind?: "kit" | "template"; name?: string; files?: Record<string, string>; error?: string };
    if (!res.ok || !out.files) throw new Error(out.error ?? "That couldn't be loaded.");
    const files = out.files;
    const removed = out.kind === "template" ? Object.keys(makeData(editor.get().doc).files).filter((p) => !(p in files)) : [];
    applyAnswer(out.kind === "template" ? `Started from the template "${out.name}".` : `Added the kit "${out.name}". Its guidelines and components are now part of this project.`, files, removed);
}

export async function removeLibraryItem(id: string) {
    const res = await fetch(`${httpBase()}/ai/make/library?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That couldn't be removed.");
}

// A link that opens just the running app, full screen, for anyone with view access to the file
// (the file is shared first if it lives only in this browser).
export async function copyViewLink() {
    const id = await ensureShared();
    const view = collab.get().keys?.view;
    if (!id || !view) return editor.notify("The server can't be reached, so there's no link to share yet.");
    const url = shareableUrl();
    url.searchParams.set("file", id);
    url.searchParams.set("key", view);
    url.searchParams.set("makeView", "preview");
    await navigator.clipboard?.writeText(withServer(url).toString()).catch(() => undefined);
    editor.notify("View-only preview link copied.");
}

export const isViewOnlyPreview = () => new URLSearchParams(location.search).get("makeView") === "preview";

// The app's address and access settings (shared with sites: site/hosting-section.tsx).
export function appHostingApi(appId: string) {
    const key = collab.get().keys?.edit ?? fileMeta(editor.get().fileId)?.key ?? "";
    return hostingApi({ settings: `/apps/${appId}/hosting`, verify: `/apps/${appId}/hosting/verify`, ticket: `/apps/${appId}/hosting/ticket` }, key);
}

// Opens the published app; for team-only apps, with a short-lived ticket that lets the browser in.
export async function openWithTicket(appId: string, url: string) {
    const win = window.open("about:blank", "_blank");
    const ticket = await appHostingApi(appId).ticket();
    const target = ticket ? `${url}?ticket=${encodeURIComponent(ticket)}` : url;
    if (win) win.location.href = target;
    else window.open(target, "_blank", "noopener");
}
