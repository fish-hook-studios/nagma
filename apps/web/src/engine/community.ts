import { authHeaders } from "./auth";
import type { FileKind } from "./files";
import { httpBase } from "./server-url";

// The community: files and templates people on this server publish for everyone else here to
// browse, like and duplicate into their drafts. Publishing makes a copy, so later edits stay private
// until the file is published again.

export interface CommunityEntry {
    id: string;
    name: string;
    description: string;
    kind: FileKind;
    template: boolean;
    tags: string[];
    publishedAt: number;
    updatedAt: number;
    thumb: string | null;
    // The published copy, opened view-only with its key.
    fileId: string;
    viewKey: string | null;
    by: { id: string; name: string; color: string; avatar: string | null; handle: string };
    team: { id: string; name: string } | null;
    likes: number;
    liked: boolean;
    duplicates: number;
    mine: boolean;
}

export interface CommunityProfile {
    id: string;
    name: string;
    color: string;
    avatar: string | null;
    handle: string;
    bio: string;
    joinedAt: number | null;
    likes: number;
    files: CommunityEntry[];
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

export function browseCommunity(p: { q?: string; kind?: string; sort?: "popular" | "recent"; by?: string }): Promise<CommunityEntry[]> {
    const params = new URLSearchParams();
    if (p.q) params.set("q", p.q);
    if (p.kind && p.kind !== "all") params.set("kind", p.kind);
    if (p.sort) params.set("sort", p.sort);
    if (p.by) params.set("by", p.by);
    return api<CommunityEntry[]>(`/community?${params}`);
}

export const publishToCommunity = (body: { fileId: string; key?: string | null; name: string; description: string; tags: string; template: boolean }) => api<CommunityEntry>("/community", { method: "POST", body: JSON.stringify(body) });
export const unpublish = (id: string) => api(`/community/${id}`, { method: "DELETE" });
export const toggleLike = (id: string) => api<CommunityEntry>(`/community/${id}/like`, { method: "POST" });
export const duplicateCommunityFile = (id: string) => api<{ id: string; keys: { edit: string; view: string }; name: string; kind: FileKind }>(`/community/${id}/duplicate`, { method: "POST" });
export const communityProfile = (who: string) => api<CommunityProfile>(`/community/people/${encodeURIComponent(who)}`);
