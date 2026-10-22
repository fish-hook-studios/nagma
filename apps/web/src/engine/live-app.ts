import { useEffect, useSyncExternalStore } from "react";
import type { NagmaDocument, SceneNode } from "./types";

// Live frames that run a project (kind "app": a Make app's files, or a React component): the files
// are bundled with Make's bundler (make/bundle.ts), and every module the bundle would load from the
// CDN (React, npm packages, and what those import) is fetched once here, kept in the browser's cache
// storage, and inlined into the frame's document as data: modules behind an import map, so the frame
// runs with the network off. A module that can't be fetched keeps its CDN address: only that origin
// is let through for scripts in that frame, and the Inspector lists it under Network.
//
// The app's default export is the component the frame shows, with nagma.props as its React props
// (re-rendered when they change). Without one, the project's own entry runs as it would in Make.

export interface LiveAppBuild {
    // Hash of the files: which build this is.
    key: string;
    // The head (import map, styles, the app's head) and body (the app's markup and entry) of the
    // frame's document.
    head: string;
    body: string;
    // Origins scripts still come from (modules that couldn't be kept offline).
    blocked: string[];
    errors: string[];
    // Whether the app's default export gets the props.
    component: boolean;
}

const CACHE_NAME = "nagma-live-modules-v1";
const MAX_MODULES = 600;
const MAX_BYTES = 40 * 1024 * 1024;

export function filesKey(files: Record<string, string>): string {
    const text = JSON.stringify(Object.keys(files).sort().map((k) => [k, files[k]]));
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
    }
    return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}${text.length.toString(36)}`;
}

function utf8Base64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}
const jsData = (code: string) => `data:text/javascript;base64,${utf8Base64(code)}`;
const escapeScript = (text: string) => text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

// ---- Modules from the CDN, fetched once ----

interface Fetched {
    // The address the module came from after redirects (its own imports resolve against it).
    url: string;
    code: string;
}

// "missing": the CDN has no such module (a 4xx). A false match in a module's text (an import
// written inside a string) lands here too, and is not a module the app needs.
const fetched = new Map<string, Promise<Fetched | "missing" | null>>();

async function openCache(): Promise<Cache | null> {
    try {
        return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
    } catch {
        return null;
    }
}

// A module's code: from memory, the cache storage, or the network (then kept). Null when it can't be
// had (no network, a server error).
export function fetchModule(url: string, fetcher: typeof fetch = fetch): Promise<Fetched | "missing" | null> {
    let hit = fetched.get(url);
    if (hit) return hit;
    hit = (async () => {
        const cache = await openCache();
        try {
            const kept = await cache?.match(url);
            if (kept) return { url: kept.headers.get("x-nagma-url") || url, code: await kept.text() };
        } catch {
            // Read from the network instead.
        }
        try {
            const res = await fetcher(url, { credentials: "omit" });
            if (res.status >= 400 && res.status < 500) return "missing" as const;
            if (!res.ok) return null;
            const code = await res.text();
            const final = res.url || url;
            void cache?.put(url, new Response(code, { headers: { "content-type": "text/javascript", "x-nagma-url": final } })).catch(() => undefined);
            return { url: final, code };
        } catch {
            return null;
        }
    })();
    fetched.set(url, hit);
    // A failure is tried again next time (the network may be back).
    void hit.then((r) => r === null && fetched.delete(url));
    return hit;
}

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\bexport\s*\*\s*from\s*)(["'])([^"'\n]+)\2/g;

// A fetched module with its own imports made absolute ("/react@19/x.mjs" → "https://esm.sh/react@19/x.mjs"),
// and the absolute addresses it imports. Bare names ("react") are left for the import map.
export function absoluteImports(code: string, base: string): { code: string; imports: string[] } {
    const imports: string[] = [];
    const out = code.replace(SPECIFIER, (whole, lead: string, quote: string, spec: string) => {
        if (!/^(\/|\.\.?\/|https?:)/.test(spec)) return whole;
        let abs: string;
        try {
            abs = new URL(spec, base).href;
        } catch {
            return whole;
        }
        if (!/^https?:/.test(abs)) return whole;
        imports.push(abs);
        return `${lead}${quote}${abs}${quote}`;
    });
    return { code: out, imports };
}

// Every CDN module the import map names, and what they import, as data: addresses. Addresses that
// couldn't be fetched stay as they are and their origins are returned.
export async function inlineModules(map: Record<string, string>, fetcher: typeof fetch = fetch): Promise<{ map: Record<string, string>; blocked: string[] }> {
    const out: Record<string, string> = { ...map };
    const data = new Map<string, string | null>();
    const missing = new Set<string>();
    let bytes = 0;
    const visit = async (url: string): Promise<string | null> => {
        if (data.has(url)) return data.get(url) ?? null;
        data.set(url, null);
        if (data.size > MAX_MODULES || bytes > MAX_BYTES) return null;
        const got = await fetchModule(url, fetcher);
        if (got === "missing") missing.add(url);
        if (!got || got === "missing") return null;
        const { code, imports } = absoluteImports(got.code, got.url);
        bytes += code.length;
        const encoded = jsData(code);
        data.set(url, encoded);
        await Promise.all(imports.map(visit));
        return encoded;
    };
    const blocked = new Set<string>();
    await Promise.all(Object.values(map).filter((url) => /^https?:/.test(url)).map(visit));
    // Each name straight to its module's data (an import map doesn't map an address twice).
    for (const [name, url] of Object.entries(map)) {
        const encoded = data.get(url);
        if (encoded) out[name] = encoded;
    }
    for (const [url, encoded] of data) {
        if (encoded) out[url] = encoded;
        else if (!missing.has(url)) blocked.add(new URL(url).origin);
    }
    for (const url of Object.values(out)) if (/^https?:/.test(url)) blocked.add(new URL(url).origin);
    return { map: out, blocked: [...blocked].sort() };
}

// A classic script (Tailwind's browser build), fetched once and kept.
async function fetchScript(url: string): Promise<string | null> {
    const got = await fetchModule(url);
    return got && got !== "missing" ? got.code : null;
}

// ---- The frame's entry ----

const APP_FILES = ["src/App.tsx", "src/App.jsx", "src/app.tsx", "src/app.jsx", "App.tsx", "App.jsx", "src/App.ts", "src/App.js"];
const ENTRY_FILES = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/main.ts", "src/index.jsx", "main.tsx", "index.tsx"];

// The component file whose default export the frame shows, or null.
export function appComponentFile(files: Record<string, string>): string | null {
    for (const path of APP_FILES) if (path in files && /\bexport\s+default\b/.test(files[path] ?? "")) return path;
    return null;
}

// The entry the frame runs: the app's stylesheets (as its own entry imports them), then the default
// export rendered with nagma.props, again whenever they change.
export function liveEntry(files: Record<string, string>, app: string): { path: string; code: string } {
    const dir = app.includes("/") ? app.slice(0, app.lastIndexOf("/")) : "";
    const path = `${dir ? `${dir}/` : ""}__nagma_live.jsx`;
    const original = ENTRY_FILES.find((p) => p in files);
    const styles: string[] = [];
    if (original) {
        const from = original.includes("/") ? original.slice(0, original.lastIndexOf("/")) : "";
        for (const m of (files[original] ?? "").matchAll(/^\s*import\s+(["'])([^"']+\.css)\1\s*;?/gm)) {
            const spec = m[2] ?? "";
            // Paths written relative to the entry's folder, made relative to this one.
            const target = spec.startsWith(".") ? joinPath(from, spec) : null;
            styles.push(`import ${JSON.stringify(target ? relative(dir, target) : spec)};`);
        }
    }
    const name = app.slice(dir ? dir.length + 1 : 0).replace(/\.(tsx|jsx|ts|js)$/, "");
    const code = `${styles.join("\n")}
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "./${name}";
const host = document.getElementById("root") || document.body.appendChild(document.createElement("div"));
const root = createRoot(host);
const draw = (props) => root.render(createElement(App, Object.assign({}, props)));
draw(window.nagma.props);
window.nagma.on("props", draw);
`;
    return { path, code };
}

function joinPath(base: string, rel: string): string {
    const out: string[] = base ? base.split("/") : [];
    for (const part of rel.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") out.pop();
        else out.push(part);
    }
    return out.join("/");
}

// `to` (a project path) as an import written from the folder `from`: "./x.css", "../styles/x.css".
function relative(from: string, to: string): string {
    const a = from ? from.split("/") : [];
    const b = to.split("/");
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    const ups = a.length - i;
    return `${ups ? "../".repeat(ups) : "./"}${b.slice(i).join("/")}`;
}

const usesClasses = (files: Record<string, string>) => Object.entries(files).some(([p, t]) => /\.(tsx|jsx|html)$/.test(p) && /\bclass(Name)?=/.test(t));

// ---- Building ----

const builds = new Map<string, Promise<LiveAppBuild>>();
const done = new Map<string, LiveAppBuild>();
const listeners = new Set<() => void>();
let version = 0;

function announce() {
    version++;
    for (const l of listeners) l();
}

export async function buildLiveAppNow(files: Record<string, string>, fetcher: typeof fetch = fetch): Promise<LiveAppBuild> {
    const key = filesKey(files);
    const { compileProject, reactImports, TAILWIND } = await import("../make/bundle");
    const app = appComponentFile(files);
    const entry = app ? liveEntry(files, app) : null;
    const source = entry ? { ...files, [entry.path]: entry.code } : files;
    const project = await compileProject(source, { dev: false, ...(entry ? { entry: entry.path } : {}) });
    const cdn: Record<string, string> = { ...reactImports(false, null), ...project.packages };
    const { map: inlined, blocked } = await inlineModules(cdn, fetcher);
    const map: Record<string, string> = { ...inlined };
    for (const [name, code] of project.modules) map[name] = jsData(code);
    let tailwind = "";
    const origins = new Set(blocked);
    if (usesClasses(files)) {
        const code = await fetchScript(TAILWIND);
        if (code) tailwind = `<script>${escapeScript(code)}</script>`;
        else {
            tailwind = `<script src="${TAILWIND}"></script>`;
            origins.add(new URL(TAILWIND).origin);
        }
    }
    const failed = `window.dispatchEvent(new ErrorEvent('error',{message:'The app could not start: one of its modules did not load.'}))`;
    const head =
        `<script type="importmap">${escapeScript(JSON.stringify({ imports: map }))}</script>` +
        tailwind +
        project.head.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "") +
        project.extraCss.map((css) => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`).join("");
    const body = `${project.body}<script type="module" onerror="${failed}">import ${JSON.stringify(project.entry)};</script>`;
    return { key, head, body, blocked: [...origins].sort(), errors: project.errors, component: Boolean(entry) };
}

// The build for these files: started once, shared by every frame and the Inspector.
export function buildLiveApp(files: Record<string, string>): Promise<LiveAppBuild> {
    const key = filesKey(files);
    let build = builds.get(key);
    if (!build) {
        build = buildLiveAppNow(files).then(
            (b) => {
                done.set(key, b);
                announce();
                return b;
            },
            (error: unknown) => {
                const b: LiveAppBuild = { key, head: "", body: "", blocked: [], errors: [error instanceof Error ? error.message : String(error)], component: false };
                done.set(key, b);
                builds.delete(key);
                announce();
                return b;
            },
        );
        builds.set(key, build);
    }
    return build;
}

export function cachedLiveApp(files: Record<string, string> | undefined): LiveAppBuild | null {
    return files ? (done.get(filesKey(files)) ?? null) : null;
}

export function subscribeLiveApps(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

// The build for a frame's files, starting it when needed; null until it is ready.
export function useLiveApp(files: Record<string, string> | undefined): LiveAppBuild | null {
    useSyncExternalStore(subscribeLiveApps, () => version);
    useEffect(() => {
        if (files) void buildLiveApp(files);
    }, [files]);
    return cachedLiveApp(files);
}

// Before an export, a thumbnail or a publish: every app frame in the document (or these layers) built.
export async function prepareLiveApps(doc: NagmaDocument, ids?: string[]): Promise<void> {
    const nodes: SceneNode[] = [];
    if (ids) {
        const walk = (id: string) => {
            const n = doc.nodes[id];
            if (!n) return;
            nodes.push(n);
            n.children.forEach(walk);
        };
        ids.forEach(walk);
    } else nodes.push(...Object.values(doc.nodes));
    await Promise.all(nodes.filter((n) => n.type === "live" && n.live?.kind === "app" && n.live.files).map((n) => buildLiveApp(n.live?.files ?? {})));
}

// ---- A Make app's files ----

// The files of the Make app with this id: a draft in this browser, or a file on the server.
export async function makeAppFiles(id: string): Promise<{ files: Record<string, string>; name: string } | null> {
    const { fileMeta, loadFileDocument } = await import("./files");
    const { makeData } = await import("../make/model");
    const meta = fileMeta(id);
    const fromDoc = (doc: NagmaDocument | null, name: string) => {
        const files = doc ? makeData(doc).files : null;
        return files && Object.keys(files).length ? { files, name } : null;
    };
    if (meta && !meta.shared) return fromDoc(await loadFileDocument(id), meta.name);
    const serverId = meta?.shared ?? id;
    const { httpBase } = await import("./server-url");
    const { authHeaders } = await import("./auth");
    try {
        const key = meta?.key ? `?key=${encodeURIComponent(meta.key)}` : "";
        const res = await fetch(`${httpBase()}/files/${encodeURIComponent(serverId)}/doc${key}`, { headers: authHeaders() });
        if (!res.ok) return meta ? fromDoc(await loadFileDocument(id), meta.name) : null;
        const body = (await res.json()) as { doc: NagmaDocument; name: string };
        const { prepareDocument } = await import("./store");
        return fromDoc(prepareDocument(body.doc), meta?.name ?? body.name);
    } catch {
        return meta ? fromDoc(await loadFileDocument(id), meta.name) : null;
    }
}
