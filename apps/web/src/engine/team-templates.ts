import { useSyncExternalStore } from "react";
import { authHeaders } from "./auth";
import { join } from "./collab";
import { type FileKind, refreshServerFiles, rememberShared } from "./files";
import { httpBase } from "./server-url";
import { editor } from "./store";
import type { NagmaDocument } from "./types";

// Team templates: copies of files kept on the sync server that anyone on the team starts new files
// from (Resources, and Create › From a team template in Home).

export interface TeamTemplate {
    id: string;
    name: string;
    description: string;
    kind: FileKind;
    fileId: string;
    thumb: string | null;
    createdBy: { id: string; name: string; email: string; color: string } | null;
    createdAt: number;
    uses: number;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

const lists = new Map<string, TeamTemplate[]>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
    version++;
    for (const l of listeners) l();
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export async function loadTeamTemplates(teamId: string): Promise<TeamTemplate[]> {
    const list = await api<TeamTemplate[]>(`/teams/${teamId}/templates`);
    lists.set(teamId, list);
    emit();
    return list;
}

export function useTeamTemplates(teamId: string | null): TeamTemplate[] | null {
    useSyncExternalStore(subscribe, () => version);
    return teamId ? (lists.get(teamId) ?? null) : null;
}

export async function createTeamTemplate(teamId: string, body: { fileId?: string; key?: string | null; doc?: NagmaDocument; kind?: FileKind; name: string; description?: string }): Promise<void> {
    lists.set(teamId, await api<TeamTemplate[]>(`/teams/${teamId}/templates`, { method: "POST", body: JSON.stringify(body) }));
    emit();
}

export async function updateTeamTemplate(teamId: string, id: string, body: { name?: string; description?: string }): Promise<void> {
    lists.set(teamId, await api<TeamTemplate[]>(`/teams/${teamId}/templates/${id}`, { method: "PUT", body: JSON.stringify(body) }));
    emit();
}

export async function deleteTeamTemplate(teamId: string, id: string): Promise<void> {
    lists.set(teamId, await api<TeamTemplate[]>(`/teams/${teamId}/templates/${id}`, { method: "DELETE" }));
    emit();
}

// A new file from a template, in your drafts (or a project), opened straight away.
export async function startFromTemplate(teamId: string, template: TeamTemplate, project?: string | null): Promise<void> {
    const made = await api<{ id: string; keys: { edit: string }; name: string; kind: FileKind }>(`/teams/${teamId}/templates/${template.id}/use`, { method: "POST", body: JSON.stringify({ project: project ?? null }) });
    const meta = rememberShared(made.id, made.name, made.keys.edit, made.kind);
    editor.set({ fileId: meta.id, homeOpen: false, sequenceView: made.kind === "video" });
    join(made.id, undefined, made.keys.edit);
    void refreshServerFiles();
}

// Home's Create menu opens the template picker through this.
let pickerTeam: string | null = null;
const pickerListeners = new Set<() => void>();
export function openTemplatePicker(teamId: string) {
    pickerTeam = teamId;
    for (const l of pickerListeners) l();
}
export function closeTemplatePicker() {
    pickerTeam = null;
    for (const l of pickerListeners) l();
}
export function useTemplatePicker(): string | null {
    return useSyncExternalStore(
        (l) => (pickerListeners.add(l), () => void pickerListeners.delete(l)),
        () => pickerTeam,
    );
}
