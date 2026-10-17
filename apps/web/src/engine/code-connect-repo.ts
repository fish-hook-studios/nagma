import { nanoid } from "nanoid";
import { authHeaders } from "./auth";
import { httpBase } from "./server-url";
import { editor } from "./store";
import type { CodeConnectSnippet, NagmaDocument, SceneNode } from "./types";

// Code Connect from a repository, without a command-line tool: read a GitHub repository's component
// files, match them to this file's components by name, and attach a snippet to each match (Inspect
// then shows that code for every instance). Reads go straight to GitHub with a token pasted for this
// session (kept in memory only), or through the sync server with its own GITHUB_TOKEN.

export interface RepoRef {
    owner: string;
    repo: string;
    // The branch or tag (the default branch when empty) and a folder to look in.
    ref: string;
    path: string;
}

export interface CodeComponent {
    name: string;
    file: string;
    lang: CodeConnectSnippet["lang"];
    props: string[];
    url: string;
}

export interface Match {
    componentId: string;
    componentName: string;
    code: CodeComponent;
    snippet: string;
}

// The pasted token lives only as long as this page.
let sessionToken = "";
export const setSessionToken = (token: string) => {
    sessionToken = token.trim();
};
export const hasSessionToken = () => Boolean(sessionToken);

// "owner/repo", or a github.com address (…/owner/repo/tree/branch/folder).
export function parseRepo(input: string): RepoRef | null {
    const raw = input.trim().replace(/\.git$/, "");
    const url = /github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/]+)\/?(.*))?/.exec(raw);
    if (url) return { owner: url[1] as string, repo: url[2] as string, ref: url[3] ?? "", path: url[4] ?? "" };
    const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(raw);
    return short ? { owner: short[1] as string, repo: short[2] as string, ref: "", path: "" } : null;
}

async function github<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const query = new URLSearchParams(params).toString();
    if (sessionToken) {
        const res = await fetch(`https://api.github.com${path}${query ? `?${query}` : ""}`, { headers: { authorization: `Bearer ${sessionToken}`, accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(res.status === 401 ? "GitHub didn't accept the token." : res.status === 404 ? "No such repository, or the token can't see it." : `GitHub answered ${res.status}.`);
        return (await res.json()) as T;
    }
    const res = await fetch(`${httpBase()}/code-connect/github?${new URLSearchParams({ path, ...params })}`, { headers: authHeaders() });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (res.status === 501) throw new Error("Paste a GitHub token for this session (the server has none).");
    if (!res.ok) throw new Error(data.error ?? data.message ?? `The server answered ${res.status}.`);
    return data;
}

const LANG_BY_EXT: Record<string, CodeConnectSnippet["lang"]> = { tsx: "css", jsx: "css", vue: "css", svelte: "css", swift: "swiftui", kt: "compose" };
const pascal = (s: string) => /^[A-Z][A-Za-z0-9]*$/.test(s);
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The components in the repository: files named like components (Button.tsx, Card/index.tsx,
// Badge.swift…), with the props their source declares.
export async function findCodeComponents(ref: RepoRef): Promise<CodeComponent[]> {
    const base = `/repos/${ref.owner}/${ref.repo}`;
    const branch = ref.ref || (await github<{ default_branch: string }>(base)).default_branch;
    const tree = await github<{ tree: { path: string; type: string }[]; truncated?: boolean }>(`${base}/git/trees/${encodeURIComponent(branch)}`, { recursive: "1" });
    const prefix = ref.path.replace(/^\/|\/$/g, "");
    const out: CodeComponent[] = [];
    for (const entry of tree.tree) {
        if (entry.type !== "blob" || (prefix && !entry.path.startsWith(`${prefix}/`))) continue;
        if (/(^|\/)(node_modules|test|tests|__tests__|stories)\//.test(entry.path) || /\.(test|spec|stories)\./.test(entry.path)) continue;
        const m = /([^/]+)\/(?:index)\.(tsx|jsx)$|([^/]+)\.(tsx|jsx|vue|svelte|swift|kt)$/.exec(entry.path);
        if (!m) continue;
        const name = (m[1] ?? m[3]) as string;
        const ext = (m[2] ?? m[4]) as string;
        if (!pascal(name)) continue;
        out.push({ name, file: entry.path, lang: LANG_BY_EXT[ext] ?? "css", props: [], url: `https://github.com/${ref.owner}/${ref.repo}/blob/${branch}/${entry.path}` });
    }
    return out;
}

// The prop names a component's source declares (TypeScript props types, Swift and Kotlin parameters).
export async function readProps(ref: RepoRef, c: CodeComponent): Promise<string[]> {
    const branch = /\/blob\/([^/]+)\//.exec(c.url)?.[1] ?? ref.ref;
    const file = await github<{ content?: string; encoding?: string }>(`/repos/${ref.owner}/${ref.repo}/contents/${c.file.split("/").map(encodeURIComponent).join("/")}`, { ref: branch });
    const text = file.content && file.encoding === "base64" ? new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, "")), (ch) => ch.charCodeAt(0))) : "";
    const props = new Set<string>();
    const block = new RegExp(`(?:interface|type)\\s+${c.name}Props\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(text)?.[1] ?? "";
    for (const m of block.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)) props.add(m[1] as string);
    if (c.lang === "swiftui") for (const m of text.matchAll(/^\s*(?:let|var)\s+([a-z][A-Za-z0-9_]*)\s*:/gm)) props.add(m[1] as string);
    if (c.lang === "compose") {
        const sig = new RegExp(`fun\\s+${c.name}\\s*\\(([\\s\\S]*?)\\)\\s*\\{`).exec(text)?.[1] ?? "";
        for (const m of sig.matchAll(/([a-z][A-Za-z0-9_]*)\s*:/g)) props.add(m[1] as string);
    }
    return [...props].filter((p) => p !== "children" && p !== "className" && p !== "modifier");
}

// A component's property names: its own properties plus its variants' ("Size=Small, State=Default").
function designProps(doc: NagmaDocument, node: SceneNode): string[] {
    const names = new Set((node.componentProps ?? []).map((p) => p.name.replace(/#.*$/, "")));
    for (const id of node.type === "componentSet" ? node.children : []) {
        for (const part of (doc.nodes[id]?.name ?? "").split(",")) {
            const k = part.split("=")[0]?.trim();
            if (k && part.includes("=")) names.add(k);
        }
    }
    return [...names];
}

// The snippet for a match: the code component with the design's properties passed through.
function snippetFor(code: CodeComponent, props: string[]): string {
    const shared = props.filter((p) => code.props.length === 0 || code.props.some((c) => key(c) === key(p)));
    const codeName = (p: string) => code.props.find((c) => key(c) === key(p)) ?? p.charAt(0).toLowerCase() + p.slice(1).replace(/\s+(\w)/g, (_, ch: string) => ch.toUpperCase());
    if (code.lang === "swiftui") return `${code.name}(${shared.map((p) => `${codeName(p)}: "{${p}}"`).join(", ")})`;
    if (code.lang === "compose") return `${code.name}(${shared.map((p) => `${codeName(p)} = "{${p}}"`).join(", ")})`;
    return `<${code.name}${shared.map((p) => ` ${codeName(p)}="{${p}}"`).join("")} />`;
}

// This file's components (sets count once) matched to code components by name.
export function matchComponents(doc: NagmaDocument, code: CodeComponent[]): Match[] {
    const byKey = new Map(code.map((c) => [key(c.name), c]));
    const out: Match[] = [];
    for (const node of Object.values(doc.nodes)) {
        const isSetChild = node.type === "component" && doc.nodes[node.parentId ?? ""]?.type === "componentSet";
        if ((node.type !== "component" && node.type !== "componentSet") || isSetChild) continue;
        const found = byKey.get(key(node.name));
        if (found) out.push({ componentId: node.id, componentName: node.name, code: found, snippet: snippetFor(found, designProps(doc, node)) });
    }
    return out.sort((a, b) => a.componentName.localeCompare(b.componentName));
}

// Fills in each match's props from its source, then rebuilds the snippet.
export async function withProps(ref: RepoRef, doc: NagmaDocument, matches: Match[]): Promise<Match[]> {
    return Promise.all(
        matches.map(async (m) => {
            try {
                const props = await readProps(ref, m.code);
                const code = { ...m.code, props };
                const node = doc.nodes[m.componentId];
                return { ...m, code, snippet: node ? snippetFor(code, designProps(doc, node)) : m.snippet };
            } catch {
                return m;
            }
        }),
    );
}

// Attaches the chosen matches as connected code (replacing an earlier snippet from the same file).
export function connectMatches(matches: Match[]) {
    const doc = editor.get().doc;
    const commands = matches
        .filter((m) => doc.nodes[m.componentId])
        .map((m) => {
            const node = doc.nodes[m.componentId] as SceneNode;
            const kept = (node.codeConnect ?? []).filter((c) => c.source !== m.code.url);
            const snippet: CodeConnectSnippet = { id: nanoid(6), lang: m.code.lang, name: m.code.name, source: m.code.url, code: m.snippet };
            return { type: "node.update" as const, id: node.id, patch: { codeConnect: [...kept, snippet] } };
        });
    if (!commands.length) return;
    editor.execute({ type: "batch", commands });
    editor.notify(`Connected ${commands.length} component${commands.length === 1 ? "" : "s"} to code.`);
}
