import { useSyncExternalStore } from "react";
import { authHeaders } from "./auth";
import { httpBase } from "./server-url";
import { loadFileDocument, markShared, refreshServerFiles } from "./files";
import { editor } from "./store";
import type { NagmaDocument } from "./types";
import { onScopeChange, userStorage } from "./user-storage";

// Teams and their projects on the sync server, the way a design tool organises work: a team has
// members with roles (admin, can edit, can view), projects belong to a team, files sit in projects.

export type TeamRole = "admin" | "edit" | "view";

export type ProjectAccess = "edit" | "view" | "none";

// A project is a team folder: it may sit inside another folder of the same team (parentId), to any depth.
export interface Project {
    // Per-member overrides of the team role; absent means the team role applies.
    members?: Record<string, ProjectAccess>;
    id: string;
    name: string;
    teamId: string;
    parentId?: string | null;
    // Your role in this folder (the nearest override around it, else the team role).
    role?: TeamRole | null;
    createdAt?: number;
    updatedAt?: number;
    trashed?: boolean;
    // The folder whose deletion sent this one to the trash (itself when it was deleted directly).
    trashedWith?: string | null;
    trashedAt?: number | null;
    trashedBy?: string | null;
    createdBy?: string | null;
    // The folder's colour in the file browser (null: the default).
    color?: string | null;
    // Who has access: the whole team (by their roles), or only people invited.
    audience?: "team" | "invited";
    // People invited who aren't on the team (by account, or by email until they have one).
    guests?: { id: string; name: string; email: string; color: string; role: "edit" | "view" }[];
    invites?: { email: string; role: "edit" | "view" }[];
    // Other teams this folder is connected to (admin console › Content).
    connections?: { id: string; name: string; role: "edit" | "view" }[];
    // A folder of another team connected to this one: that team's name.
    connectedFrom?: string;
}

export interface Team {
    id: string;
    name: string;
    role: TeamRole | null;
    members: { id: string; name: string; email: string; color: string; role: TeamRole }[];
    projects: Project[];
    // Libraries on by default in the team's files (admins choose them).
    defaultLibraries?: string[];
    // The plan from the team's billing, and the products its admins allow.
    plan?: string;
    features?: { devMode: boolean; make: boolean; sitesPublishing: boolean };
}

let teams: Team[] = [];
const listeners = new Set<() => void>();

function set(next: Team[]) {
    teams = next;
    for (const l of listeners) l();
}

export function subscribeTeams(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getTeams(): Team[] {
    return teams;
}

export function useTeams(): Team[] {
    return useSyncExternalStore(subscribeTeams, getTeams);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

export async function refreshTeams(): Promise<void> {
    try {
        set(await api<Team[]>("/teams"));
    } catch {
        set([]);
    }
}

function replace(team: Team) {
    set(teams.some((t) => t.id === team.id) ? teams.map((t) => (t.id === team.id ? team : t)) : [...teams, team]);
}

export async function createTeam(name: string): Promise<Team> {
    const team = await api<Team>("/teams", { method: "POST", body: JSON.stringify({ name }) });
    replace(team);
    return team;
}

export async function updateTeam(id: string, body: { name?: string; invite?: { email: string; role: TeamRole }; role?: { userId: string; role: TeamRole }; remove?: string }): Promise<Team> {
    const team = await api<Team>(`/teams/${id}`, { method: "PUT", body: JSON.stringify(body) });
    replace(team);
    return team;
}

export async function leaveTeam(id: string): Promise<void> {
    await api(`/teams/${id}/leave`, { method: "POST" });
    set(teams.filter((t) => t.id !== id));
}

export async function deleteTeam(id: string): Promise<void> {
    await api(`/teams/${id}`, { method: "DELETE" });
    set(teams.filter((t) => t.id !== id));
}

// Creates a folder in a team, at the top level or inside `parentId`. Returns the new folder's id.
export async function createProject(teamId: string, name: string, parentId: string | null = null): Promise<string> {
    const team = await api<Team & { created: string }>(`/teams/${teamId}/projects`, { method: "POST", body: JSON.stringify({ name, parentId }) });
    replace(team);
    return team.created;
}

export async function renameProject(id: string, name: string): Promise<void> {
    replace(await api<Team>(`/projects/${id}`, { method: "PUT", body: JSON.stringify({ name }) }));
}

// Moves a folder (with everything inside it) into another folder of its team, or to the top level.
export async function moveProject(id: string, parentId: string | null): Promise<void> {
    replace(await api<Team>(`/projects/${id}`, { method: "PUT", body: JSON.stringify({ parentId }) }));
    await refreshServerFiles();
}

// Sets one member's access to a project (null goes back to the team role). Team admins only.
export async function setProjectAccess(id: string, userId: string, role: ProjectAccess | null): Promise<void> {
    replace(await api<Team>(`/projects/${id}`, { method: "PUT", body: JSON.stringify({ access: { userId, role } }) }));
}

// A folder's colour, who has access to it, and inviting people to it by email (on the team or not).
export async function updateFolderSharing(id: string, body: { color?: string | null; audience?: "team" | "invited"; invite?: { emails: string; role: "edit" | "view" }; guest?: { userId?: string; email?: string; role: "edit" | "view" | null } }): Promise<void> {
    replace(await api<Team>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(body) }));
}

// Sends a folder, the folders inside it and their files to the trash.
export async function deleteProject(id: string): Promise<void> {
    replace(await api<Team>(`/projects/${id}`, { method: "DELETE" }));
    await refreshServerFiles();
}

export async function restoreProject(id: string): Promise<void> {
    replace(await api<Team>(`/projects/${id}`, { method: "PUT", body: JSON.stringify({ restore: true }) }));
    await refreshServerFiles();
}

export async function deleteProjectForever(id: string): Promise<void> {
    replace(await api<Team>(`/projects/${id}/forever`, { method: "DELETE" }));
    await refreshServerFiles();
}

// Copies a folder with its folders and files, next to it. Returns the copy's id.
export async function duplicateProject(id: string): Promise<string> {
    const team = await api<Team & { created: string }>(`/projects/${id}/duplicate`, { method: "POST" });
    replace(team);
    await refreshServerFiles();
    return team.created;
}

export function projectOf(id: string | null): { project: Project; team: Team } | null {
    if (!id) return null;
    for (const team of teams) for (const project of team.projects) if (project.id === id) return { project, team };
    return null;
}

export interface Invite {
    token: string;
    role: TeamRole;
    createdAt: number;
    uses: number;
}

export async function listInvites(teamId: string): Promise<Invite[]> {
    return api(`/teams/${teamId}/invites`);
}

export async function createInvite(teamId: string, role: TeamRole): Promise<Invite> {
    const r = await api<{ token: string; role: TeamRole }>(`/teams/${teamId}/invites`, { method: "POST", body: JSON.stringify({ role }) });
    return { ...r, createdAt: Date.now(), uses: 0 };
}

export async function revokeInvite(teamId: string, token: string): Promise<void> {
    await api(`/teams/${teamId}/invites/${token}`, { method: "DELETE" });
}

export function inviteUrl(token: string): string {
    const url = new URL(location.origin);
    url.searchParams.set("invite", token);
    return url.toString();
}

export async function lookupInvite(token: string): Promise<{ team: string; role: TeamRole; members: number }> {
    const res = await fetch(`${httpBase()}/invites/${token}`);
    const data = (await res.json().catch(() => ({}))) as { team?: string; role?: TeamRole; members?: number; error?: string };
    if (!res.ok || !data.team) throw new Error(data.error ?? "That invite link isn't valid any more.");
    return { team: data.team, role: data.role ?? "edit", members: data.members ?? 0 };
}

export async function acceptInvite(token: string): Promise<Team> {
    const team = await api<Team>(`/invites/${token}/accept`, { method: "POST" });
    replace(team);
    return team;
}

// Creates a file on the server (owned by you) in a project, from a document.
export async function createServerFile(doc: NagmaDocument, kind: string, project: string | null): Promise<{ id: string; keys: { edit: string; view: string } }> {
    return api(`/files`, { method: "POST", body: JSON.stringify({ doc, kind, project }) });
}

// Moves a server file into a project (or out, with null).
export async function moveToProject(sharedId: string, project: string | null): Promise<void> {
    const res = await fetch(`${httpBase()}/files/${sharedId}/meta`, { method: "PUT", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ project }) });
    if (!res.ok) throw new Error(await res.text());
    await refreshServerFiles();
}

// Puts a local draft on the server inside a project.
export async function moveDraftToProject(localId: string, kind: string, project: string | null): Promise<string> {
    const doc = editor.get().fileId === localId ? editor.committed() : await loadFileDocument(localId);
    if (!doc) throw new Error("That file couldn't be read.");
    const created = await createServerFile(doc, kind, project);
    markShared(localId, created.id);
    await refreshServerFiles();
    return created.id;
}

// Starred projects, kept in this browser like a design tool's sidebar favourites.
const STAR_KEY = "nagma.starred.v1";
let starred: string[] = [];
try {
    starred = JSON.parse(userStorage.getItem(STAR_KEY) ?? "[]") as string[];
} catch {
    starred = [];
}
const starListeners = new Set<() => void>();
onScopeChange(() => {
    try {
        starred = JSON.parse(userStorage.getItem(STAR_KEY) ?? "[]") as string[];
    } catch {
        starred = [];
    }
    for (const l of starListeners) l();
});
export function subscribeStarred(listener: () => void) {
    starListeners.add(listener);
    return () => starListeners.delete(listener);
}
export function getStarred(): string[] {
    return starred;
}
export function toggleStar(projectId: string) {
    replaceStarred(starred.includes(projectId) ? starred.filter((id) => id !== projectId) : [...starred, projectId]);
}
// The whole list at once (from the account's saved stars).
export function replaceStarred(list: string[]) {
    starred = list;
    try {
        userStorage.setItem(STAR_KEY, JSON.stringify(starred));
    } catch {
        // Kept for this session.
    }
    for (const l of starListeners) l();
}
