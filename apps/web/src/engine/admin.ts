import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authHeaders } from "./auth";
import { httpBase } from "./server-url";
import { refreshTeams, type TeamRole } from "./teams";

// The team admin console's data on the sync server: seats, plan and statements, AI credits,
// requests, user groups, unassigned drafts, settings and the token registry. Billing is bookkeeping
// set by admins; nothing here charges money or takes payment details.

export type Seat = "full" | "dev" | "collab" | "view";
export const SEATS: Seat[] = ["view", "collab", "dev", "full"];
export const SEAT_LABELS: Record<Seat, string> = { full: "Full", dev: "Dev", collab: "Collab", view: "View" };

export interface AdminPerson {
    id: string;
    name: string;
    email: string;
    color: string;
    role: TeamRole;
    seat: Seat;
    lastActive: number | null;
    joinedAt: number | null;
    aiUsed: number;
    aiAllowance: number;
    aiToday?: number;
    groups: string[];
    billingGroup?: string | null;
}

export interface CostLine {
    label: string;
    qty: number;
    unit: number;
    amount: number;
}

export interface Billing {
    plan: string;
    interval: "monthly" | "annual";
    currency: string;
    prices: Record<Seat, number>;
    startedAt: number;
    periodStart: number;
    periodEnd: number;
    renewsAt: number;
    cancelAtPeriodEnd: boolean;
    seatsPurchased: number;
    seats: Record<Seat, number>;
    assigned: number;
    available: number;
    lines: CostLine[];
    adjustments: { at: number; label: string; amount: number }[];
    cycleCost: number;
    nextInvoice: { due: number; amount: number };
    extraCredits: number;
    // Annual plans: fewer seats from the renewal, and seats added mid-year billed then.
    pendingSeats?: { count: number; at: number } | null;
    deferred?: boolean;
    groups?: (BillingGroup & { cost: number })[];
}

export interface BillingGroup {
    id: string;
    name: string;
    members: string[];
    manager: string | null;
    createdAt: number;
}

export interface Workspace {
    id: string;
    name: string;
    description: string;
    folders: string[];
    admins: string[];
    createdAt: number;
}

export interface Connection {
    projectId: string;
    name: string;
    team: { id: string; name: string };
    owner: { id: string; name: string };
    role: "edit" | "view";
    connectedAt: number | null;
}

export interface AdminRequest {
    id: string;
    userId: string;
    kind: "seat" | "credits" | "access";
    seat: Seat;
    note: string;
    at: number;
    status: "pending" | "approved" | "denied";
    user?: { id: string; name: string; email: string; color: string } | null;
}

export interface UserGroup {
    id: string;
    name: string;
    members: string[];
    createdAt: number;
}

export interface UnassignedDrafts {
    id: string;
    userId: string;
    name: string;
    email: string;
    color: string;
    removedAt: number;
    files: number;
}

export interface TeamSettings {
    displayName: string;
    handle: string;
    invoiceDetails: { company: string; address: string; note: string };
    taxId: string;
    seatApproval: "admins" | "auto";
    autoApproveDigests: boolean;
    billingContacts: string[];
    aiCreditRequests: boolean;
    uiKits: boolean;
    sourceControl: { provider: string; organization: string; repositories: string; access: "admins" | "everyone" };
    contentTraining: boolean;
    devMode: boolean;
    make: boolean;
    sitesPublishing: boolean;
}

export interface RegistryVersion {
    version: string;
    at: number;
    by: { id: string; name: string; email: string; color: string } | null;
    source: string;
    notes: string;
    counts: { colors: number; texts: number; variables: number };
}

export interface AdminData {
    isAdmin: true;
    team: { id: string; name: string; createdAt: number | null };
    me: string;
    people: AdminPerson[];
    billing: Billing;
    ai: {
        allowance: Record<Seat, number>;
        extraCredits: number;
        periodStart: number;
        resetAt: number;
        using: number;
        atLimit: number;
        // The team's monthly pool, a per-person daily limit (0: none), and where credits beyond the seat allowances came from.
        pool: number;
        daily: number;
        sources: { overage: number; pool: number; fromPool: number; payg: { enabled: boolean; budget: number; price: number; used: number; cost: number }; blocked: number };
    };
    connected: { incoming: Connection[]; outgoing: Connection[]; teams: { id: string; name: string }[]; folders: { id: string; name: string }[] };
    workspaces: Workspace[];
    requests: AdminRequest[];
    groups: UserGroup[];
    unassigned: UnassignedDrafts[];
    settings: TeamSettings;
    registry: { name: string; versions: RegistryVersion[] };
}

export interface MemberData {
    isAdmin: false;
    team: { id: string; name: string; createdAt: number | null };
    me: string;
    role: TeamRole;
    seat: Seat;
    plan: string;
    admins: { id: string; name: string; email: string; color: string }[];
    aiUsed: number;
    aiAllowance: number;
    resetAt: number;
    requests: AdminRequest[];
}

export interface Invoice {
    id: string;
    number: string;
    start: number;
    end: number;
    issuedAt: number;
    plan: string;
    interval: "monthly" | "annual";
    lines: CostLine[];
    adjustments: { at: number; label: string; amount: number }[];
    total: number;
    currency: string;
}

export interface TeamFile {
    id: string;
    name: string;
    kind: string;
    project: string;
    updatedAt: number;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

// One cached copy per team, shared by every admin page, refreshed after each change.
const cache = new Map<string, AdminData | MemberData>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let version = 0;

export async function loadAdmin(teamId: string): Promise<void> {
    try {
        cache.set(teamId, await api<AdminData | MemberData>(`/teams/${teamId}/admin`));
        errors.delete(teamId);
    } catch (error) {
        errors.set(teamId, error instanceof Error ? error.message : String(error));
    }
    version++;
    emit();
}

export function useAdmin(teamId: string): { data: AdminData | MemberData | null; error: string | null } {
    useSyncExternalStore(
        (l) => (listeners.add(l), () => listeners.delete(l)),
        () => version,
    );
    useEffect(() => {
        void loadAdmin(teamId);
    }, [teamId]);
    return { data: cache.get(teamId) ?? null, error: errors.get(teamId) ?? null };
}

// Runs an admin action and takes the answer as the new state.
export async function adminAction<T = AdminData>(teamId: string, action: string, body: unknown): Promise<T> {
    const data = await api<T>(`/teams/${teamId}/admin/${action}`, { method: "POST", body: JSON.stringify(body) });
    if (data && typeof data === "object" && "isAdmin" in data) {
        cache.set(teamId, data as unknown as AdminData | MemberData);
        version++;
        emit();
    }
    if (action === "role" || action === "remove" || action === "invite" || action === "settings") void refreshTeams();
    return data;
}

export const listInvoices = (teamId: string) => api<Invoice[]>(`/teams/${teamId}/admin/invoices`);
export const filesOf = (teamId: string, userId: string) => api<TeamFile[]>(`/teams/${teamId}/admin/files/${userId}`);
export const registryVersion = (teamId: string, version: string) => api<RegistryVersion & { tokens: unknown }>(`/teams/${teamId}/admin/registry/${version}`);

// Loads something when `key` changes (or on reload), keeping the latest answer.
export function useAsync<T>(load: () => Promise<T>, key: string): { value: T | null; error: string | null; reload: () => void } {
    const [state, setState] = useState<{ value: T | null; error: string | null }>({ value: null, error: null });
    const [tick, setTick] = useState(0);
    const loader = useRef(load);
    useEffect(() => {
        loader.current = load;
    });
    useEffect(() => {
        let live = true;
        loader.current().then(
            (value) => live && setState({ value, error: null }),
            (error: unknown) => live && setState({ value: null, error: error instanceof Error ? error.message : String(error) }),
        );
        return () => {
            live = false;
        };
    }, [key, tick]);
    return { ...state, reload: () => setTick((n) => n + 1) };
}

// Runs an async step, reporting its error (or clearing the last one); true when it worked.
export function useRun(setError: (e: string | null) => void) {
    return async (fn: () => Promise<unknown>) => {
        setError(null);
        try {
            await fn();
            return true;
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            return false;
        }
    };
}

export const SEAT_HINTS: Record<Seat, string> = {
    full: "Design files, boards, slides and dev tools",
    dev: "Dev tools and inspecting, viewing and commenting",
    collab: "Boards and slides, viewing and commenting",
    view: "Viewing and commenting only, free",
};

// ---- Formatting ----

export function money(amount: number, currency = "USD"): string {
    try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

export const longDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
export const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function relative(t: number | null): string {
    if (!t) return "Never";
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "Just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
    const mo = Math.round(d / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
    return longDate(t);
}

export const daysUntil = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000)));

// ---- SAML single sign-on for the team (admins only; server saml.mjs) ----

export type SamlConfig = {
    enabled: boolean;
    domains: string[];
    idpEntityId: string;
    ssoUrl: string;
    binding: "redirect" | "post";
    certs: { subject: string; validTo: string; fingerprint: string; pem: string }[];
    source: "xml" | "url" | "manual";
    updatedAt: number | null;
    sp: { entityId: string; acsUrl: string; metadataUrl: string };
};
export type SamlUpdate = { enabled?: boolean; domains?: string[]; idpEntityId?: string; ssoUrl?: string; binding?: "redirect" | "post"; certs?: string[]; source?: "manual" };

export const loadSaml = (teamId: string) => api<SamlConfig>(`/teams/${teamId}/saml`);
export const saveSaml = (teamId: string, update: SamlUpdate) => api<SamlConfig>(`/teams/${teamId}/saml`, { method: "PUT", body: JSON.stringify(update) });
// The identity provider's metadata, pasted or uploaded (xml) or fetched once by the server (url).
export const importSamlMetadata = (teamId: string, from: { xml: string } | { url: string }) => api<SamlConfig>(`/teams/${teamId}/saml/metadata`, { method: "POST", body: JSON.stringify(from) });
