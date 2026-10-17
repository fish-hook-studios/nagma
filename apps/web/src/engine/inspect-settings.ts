import { useSyncExternalStore } from "react";
import { authHeaders } from "./auth";
import { collab, currentLinkKey } from "./collab";
import { httpBase } from "./server-url";

// The Inspect settings of the team that owns the open file (set by team admins under Team ›
// Integrations and Inspect): who may use Inspect, the code language it starts with, and the plugins
// allowed there. Read from the sync server when a shared file opens; local files have none.

export type InspectAccess = "everyone" | "edit" | "admins";

export interface InspectSettings {
    access: InspectAccess;
    defaultLanguage: string;
    // Plugin ids allowed in Inspect; null allows every installed plugin.
    pluginAllowlist: string[] | null;
}

interface State {
    fileId: string | null;
    teamId: string | null;
    settings: InspectSettings | null;
    canInspect: boolean;
    // Whether the team connected Slack or Teams for status notifications.
    chat: boolean;
}

let state: State = { fileId: null, teamId: null, settings: null, canInspect: true, chat: false };
const listeners = new Set<() => void>();

export const inspectSettings = {
    get: () => state,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

function set(patch: Partial<State>) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
}

export function useInspectSettings<T>(selector: (s: State) => T): T {
    return useSyncExternalStore(inspectSettings.subscribe, () => selector(state));
}

export const ACCESS_LABELS: Record<InspectAccess, string> = { everyone: "Everyone with access to the file", edit: "People who can edit", admins: "Team admins only" };

export async function refreshInspectSettings(fileId: string | null = collab.get().fileId) {
    if (!fileId) {
        set({ fileId: null, teamId: null, settings: null, canInspect: true, chat: false });
        return;
    }
    try {
        const key = currentLinkKey();
        const res = await fetch(`${httpBase()}/files/${fileId}/team-settings${key ? `?key=${encodeURIComponent(key)}` : ""}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { teamId: string | null; inspect: InspectSettings; canInspect: boolean; chat: boolean };
        if (collab.get().fileId !== fileId) return;
        set({ fileId, teamId: data.teamId, settings: data.teamId ? data.inspect : null, canInspect: data.canInspect, chat: data.chat });
    } catch {
        // Without the server's answer nothing is restricted.
        set({ fileId, teamId: null, settings: null, canInspect: true, chat: false });
    }
}

// Whether a plugin may run in Inspect under the team's allowlist.
export function pluginAllowedInInspect(pluginId: string): boolean {
    const list = state.settings?.pluginAllowlist;
    return !list || list.includes(pluginId);
}

// The code language Inspect starts with when you haven't picked one.
export function teamDefaultLanguage(): string | null {
    return state.settings?.defaultLanguage ?? null;
}

// Follows the open file (subscribed once the modules have loaded, as collab imports this chain).
let lastFile: string | null = null;
queueMicrotask(() =>
    collab.subscribe(() => {
        const { fileId, status } = collab.get();
        if (fileId === lastFile || (fileId && status !== "live")) return;
        lastFile = fileId;
        void refreshInspectSettings(fileId);
    }),
);

// ---- Team admins: Slack and Teams channels, and the Inspect settings ----

export interface ChatHook {
    id: string;
    service: "slack" | "teams";
    label: string;
    host: string;
    hint: string;
    addedAt: number;
}

export interface TeamIntegrations {
    hooks: ChatHook[];
    inspect: InspectSettings;
    admin: boolean;
}

export interface IntegrationsChange {
    addHook?: { service: "slack" | "teams"; url: string; label?: string };
    removeHook?: string;
    testHook?: string;
    inspect?: Partial<InspectSettings>;
}

async function integrationsCall(teamId: string, body?: IntegrationsChange): Promise<TeamIntegrations> {
    const res = await fetch(`${httpBase()}/teams/${teamId}/integrations`, body ? { method: "PUT", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(body) } : { headers: authHeaders() });
    const data = (await res.json().catch(() => ({}))) as TeamIntegrations & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

export const getTeamIntegrations = (teamId: string) => integrationsCall(teamId);

export async function updateTeamIntegrations(teamId: string, change: IntegrationsChange): Promise<TeamIntegrations> {
    const next = await integrationsCall(teamId, change);
    // The open file follows its team's new settings straight away.
    if (state.teamId === teamId) void refreshInspectSettings(state.fileId);
    return next;
}
