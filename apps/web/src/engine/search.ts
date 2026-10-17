import { authHeaders } from "./auth";
import type { FileKind, FileMeta } from "./files";
import { httpBase } from "./server-url";
import { userStorage } from "./user-storage";

// Search on Home: the server looks through file names, page names and the text inside every file
// you can open (its index is rebuilt as files change); recent searches are remembered in this browser.

export type SearchSort = "relevance" | "modified" | "name";

export interface SearchFile {
    id: string;
    name: string;
    kind: FileKind;
    thumb: string | null;
    updatedAt: number;
    createdAt: number | null;
    owner: SearchPerson | null;
    role: "edit" | "view" | "prototype";
    project: string | null;
    team: { id: string; name: string } | null;
    location: string;
    keys: { edit: string; view: string } | null;
    // Why it matched when its name didn't: a page name or a line of text.
    match: { type: "page" | "text"; text: string } | null;
}

export interface SearchPerson {
    id: string;
    name: string;
    email: string;
    color: string;
    avatar: string | null;
    handle: string;
}

export interface SearchResults {
    files: SearchFile[];
    total: number;
    people: SearchPerson[];
    creators: { id: string; name: string }[];
}

export interface SearchParams {
    q: string;
    type?: FileKind | "all";
    creator?: string;
    location?: string;
    sort?: SearchSort;
    limit?: number;
}

export async function searchServer(p: SearchParams, signal?: AbortSignal): Promise<SearchResults | null> {
    const url = new URL(`${httpBase()}/search`);
    url.searchParams.set("q", p.q);
    if (p.type && p.type !== "all") url.searchParams.set("type", p.type);
    if (p.creator && p.creator !== "all") url.searchParams.set("creator", p.creator);
    if (p.location && p.location !== "all") url.searchParams.set("location", p.location);
    if (p.sort) url.searchParams.set("sort", p.sort);
    if (p.limit) url.searchParams.set("limit", String(p.limit));
    try {
        const res = await fetch(url, { headers: authHeaders(), signal });
        if (!res.ok) return null;
        return (await res.json()) as SearchResults;
    } catch {
        return null;
    }
}

const RECENT_KEY = "nagma.search.recent.v1";
export function recentSearches(): string[] {
    try {
        return (JSON.parse(userStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 6);
    } catch {
        return [];
    }
}
export function rememberSearch(q: string) {
    const clean = q.trim();
    if (!clean) return;
    try {
        userStorage.setItem(RECENT_KEY, JSON.stringify([clean, ...recentSearches().filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 6)));
    } catch {
        // Not remembered.
    }
}
export function clearRecentSearches() {
    try {
        userStorage.removeItem(RECENT_KEY);
    } catch {
        // Nothing to clear.
    }
}

// ---- Results as file browser entries ----

export interface Hit {
    file: FileMeta;
    location: string;
    // Why it matched when its name didn't.
    match: { type: "page" | "text"; text: string } | null;
    owner: SearchPerson | null;
}

// The resource types search filters by.
export const RESOURCE_TYPES: [FileKind, string][] = [
    ["design", "Design"],
    ["board", "Board"],
    ["slides", "Slides"],
    ["campaign", "Campaign"],
    ["site", "Site"],
    ["make", "Make"],
    ["video", "Video"],
    ["docs", "Document"],
];

// Server results as file browser entries (the one already listed when there is one), plus drafts in
// this browser whose names match.
export function hitsFrom(res: SearchResults | null, q: string, files: FileMeta[], locationOf: (f: FileMeta) => string, opts: { type?: string; location?: string; creator?: string } = {}): Hit[] {
    const byShared = new Map(files.filter((f) => f.shared).map((f) => [f.shared as string, f]));
    const out: Hit[] = (res?.files ?? []).map((r) => ({
        file: byShared.get(r.id) ?? { id: `server:${r.id}`, name: r.name, kind: r.kind, createdAt: r.createdAt ?? r.updatedAt, updatedAt: r.updatedAt, thumb: r.thumb ?? undefined, shared: r.id, key: r.keys?.edit ?? null, project: r.project, ownerId: r.owner?.id ?? null, owner: r.owner?.name },
        location: r.location,
        match: r.match,
        owner: r.owner,
    }));
    const needle = q.trim().toLowerCase();
    // Drafts only in this browser: not on the server, so not created by anyone else and in Drafts.
    if ((!opts.creator || opts.creator === "all" || opts.creator === "me") && (!opts.location || opts.location === "all" || opts.location === "drafts"))
        for (const f of files) if (!f.shared && !f.trashed && f.name.toLowerCase().includes(needle) && (!opts.type || opts.type === "all" || f.kind === opts.type)) out.push({ file: f, location: locationOf(f), match: null, owner: null });
    return out;
}

