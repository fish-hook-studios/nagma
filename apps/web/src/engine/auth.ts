import { useSyncExternalStore } from "react";
import { httpBase } from "./server-url";
import { SERVERS_KEY, authStorageKey, reloadServers, remoteLinkBase, setCurrentServer } from "./servers";
import { changeServer, storageFrozen, switchScope } from "./user-storage";

// Accounts on the sync server: who you are, kept as a session token in this browser. Everything
// that talks to the server sends it, so files know their owner and who was invited.

export interface Account {
    id: string;
    name: string;
    email: string;
    color: string;
    // The account's picture (a server path, see engine/account.ts avatarSrc).
    avatar?: string | null;
    prefs?: { emailDigests: boolean; chatWebhook?: boolean };
    // This account runs the server: setup hints name the server's settings for them only.
    serverAdmin?: boolean;
    // Whether the account has proven its email (false until the link from sign-up is opened),
    // whether this server holds unverified accounts back, and whether it can send the link.
    emailVerified?: boolean;
    verifyRequired?: boolean;
    mailReady?: boolean;
}

// What sign-up did about the verification link.
export interface Verification {
    sent: boolean;
    kept: boolean;
    mailConfigured: boolean;
}

interface AuthState {
    user: Account | null;
    token: string | null;
    // The sign-in dialog, and whether it adds another account (keeping this one signed in too).
    open: boolean;
    adding: boolean;
    // Other accounts signed in on this device, to switch to.
    others: { user: Account; token: string }[];
}

// Sessions belong to a server: each one's are kept under its own key (engine/servers.ts).
const EMPTY: AuthState = { user: null, token: null, open: false, adding: false, others: [] };
function loadState(): AuthState {
    try {
        const raw = localStorage.getItem(authStorageKey());
        if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<AuthState>), open: false, adding: false };
    } catch {
        // Signed out.
    }
    return { ...EMPTY };
}
let state: AuthState = loadState();
const listeners = new Set<() => void>();
const onSignIn = new Set<(user: Account | null) => void>();

function set(patch: Partial<AuthState>) {
    const was = state.user?.id ?? null;
    state = { ...state, ...patch };
    try {
        localStorage.setItem(authStorageKey(), JSON.stringify({ user: state.user, token: state.token, others: state.others }));
    } catch {
        // Session lives for this page only.
    }
    for (const l of listeners) l();
    // Another account (or nobody): this browser's drafts, tabs, recents… become that account's
    // (engine/user-storage.ts; the app reloads for it).
    if ((state.user?.id ?? null) !== was) switchScope(state.user?.id ?? null);
}

// Tells listeners who's signed in now, unless the page is reloading for them (it starts over then).
function announce(user: Account | null) {
    if (storageFrozen()) return;
    for (const l of onSignIn) l(user);
}

// Connects to another server (null: This computer). Sessions are per server, so whoever is signed in
// there (or nobody) becomes current, and the page starts over for them: drafts stay on this device,
// shared files and their tabs are the other server's.
// The open file's address goes too, as it's the old server's, unless the switch is for that link
// (`keepLink`, from a link to a file on the other server).
export function connectToServer(origin: string | null, { keepLink = false }: { keepLink?: boolean } = {}) {
    if (!keepLink && typeof location !== "undefined") {
        const url = new URL(location.href);
        for (const k of FILE_LINK_PARAMS) url.searchParams.delete(k);
        if (url.href !== location.href) history.replaceState(null, "", url);
    }
    changeServer(() => {
        setCurrentServer(origin);
        state = loadState();
        for (const l of listeners) l();
    });
    announce(state.user);
}

// What in a page's address points at a file on its server.
export const FILE_LINK_PARAMS = ["file", "key", "server", "node-id", "comment", "present", "embed", "mode", "focus", "makeView"];

// Another tab signed in, out or switched (accounts or servers): this one follows.
if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
        if (e.key === SERVERS_KEY) {
            if (reloadServers()) {
                changeServer(() => {
                    state = loadState();
                    for (const l of listeners) l();
                });
                announce(state.user);
            }
            return;
        }
        if (e.key !== authStorageKey()) return;
        try {
            const next = e.newValue ? (JSON.parse(e.newValue) as Partial<AuthState>) : {};
            if ((next.user?.id ?? null) === (state.user?.id ?? null)) return;
            set({ user: next.user ?? null, token: next.token ?? null, others: next.others ?? [] });
            announce(state.user);
        } catch {
            // Unreadable: left as it is.
        }
    });
}

// Setup hints that name the server's settings (environment variables) are for whoever runs it; other
// people get a plain sentence.
export const setupHint = (forAdmins: string, forEveryone: string) => (state.user?.serverAdmin ? forAdmins : forEveryone);

export const auth = {
    get: () => state,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    // Called with the account after signing in, and with null after signing out.
    onChange(listener: (user: Account | null) => void) {
        onSignIn.add(listener);
        return () => onSignIn.delete(listener);
    },
};

export function useAuth<T>(selector: (s: AuthState) => T): T {
    return useSyncExternalStore(auth.subscribe, () => selector(state));
}

export function openSignIn() {
    set({ open: true });
}

export function closeSignIn() {
    set({ open: false, adding: false });
}

// Adds another account: the sign-in dialog opens, and the account you're on stays a click away.
export function addAccount() {
    set({ open: true, adding: true });
}

// The new session becomes current; adding keeps the previous one in the list to switch back to.
function become(user: Account, token: string) {
    const keep = state.adding && state.user && state.token && state.user.id !== user.id ? [{ user: state.user, token: state.token }] : [];
    const others = [...keep, ...state.others].filter((o) => o.user.id !== user.id);
    set({ user, token, open: false, adding: false, others });
    announce(user);
}

export function switchAccount(id: string) {
    const next = state.others.find((o) => o.user.id === id);
    if (!next || !state.user || !state.token) return;
    set({ user: next.user, token: next.token, others: [{ user: state.user, token: state.token }, ...state.others.filter((o) => o.user.id !== id)] });
    announce(next.user);
}

export function token(): string | null {
    return state.token;
}

export function authHeaders(): Record<string, string> {
    return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

async function call(path: string, body: Record<string, unknown>): Promise<{ token: string; user: Account; verification?: Verification }> {
    const res = await fetch(`${httpBase()}${path}`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { token?: string; user?: Account; error?: string; verification?: Verification };
    if (!res.ok || !data.token || !data.user) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return { token: data.token, user: data.user, verification: data.verification };
}

// An emailed invitation's link carries a token for the address it went to (?email-token=…): kept for
// this tab so signing up with that address verifies it at once.
const EMAIL_TOKEN_KEY = "nagma.emailToken";
function takeEmailTokenFromAddress() {
    if (typeof location === "undefined") return;
    const params = new URLSearchParams(location.search);
    const value = params.get("email-token");
    if (!value) return;
    params.delete("email-token");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    try {
        sessionStorage.setItem(EMAIL_TOKEN_KEY, value);
    } catch {
        // Verified by the sign-up mail instead.
    }
    // Already signed in (as the person invited): the link verifies the account.
    if (state.user && state.user.emailVerified === false) void verifyWith(value).catch(() => undefined);
}
const emailToken = () => {
    try {
        return sessionStorage.getItem(EMAIL_TOKEN_KEY);
    } catch {
        return null;
    }
};

// Where links in mail from the server (verification, password reset) should open: on a server other
// than This computer, that server's own public address (it serves the editor too), since this page's
// address may be the desktop app's own (localhost), which the mail's reader can't use; otherwise here.
export const mailLinkOrigin = () => remoteLinkBase() ?? location.origin;

// Sign-up on a server that can send mail proves the address first: the server answers "pending"
// and mails a six-digit code, and the account only exists once confirmSignUp has it. Elsewhere (no
// mail, or an invitation's token for this address) the account is made and signed in at once.
export interface PendingSignUp {
    pending: true;
    email: string;
    verification: Verification;
}

export async function signUp(name: string, email: string, password: string): Promise<PendingSignUp | Verification | undefined> {
    const token = emailToken();
    const res = await fetch(`${httpBase()}/auth/signup`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ name, email, password, origin: mailLinkOrigin(), ...(token ? { emailToken: token } : {}) }) });
    const data = (await res.json().catch(() => ({}))) as { token?: string; user?: Account; error?: string; verification?: Verification; pending?: boolean; email?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    if (data.pending) return { pending: true, email: data.email ?? email, verification: data.verification ?? { sent: false, kept: false, mailConfigured: false } };
    if (!data.token || !data.user) throw new Error(`The server answered ${res.status}.`);
    if (data.user.emailVerified) {
        try {
            sessionStorage.removeItem(EMAIL_TOKEN_KEY);
        } catch {
            // Nothing kept.
        }
    }
    become(data.user, data.token);
    return data.verification;
}

export const isPendingSignUp = (r: PendingSignUp | Verification | undefined): r is PendingSignUp => Boolean(r && (r as PendingSignUp).pending);

// The code from the sign-up mail: the account is created, verified, and signed in.
export async function confirmSignUp(email: string, code: string): Promise<void> {
    const r = await call("/auth/signup/confirm", { email, code });
    become(r.user, r.token);
}

export async function resendSignUpCode(email: string): Promise<Verification> {
    const res = await fetch(`${httpBase()}/auth/signup/resend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, origin: mailLinkOrigin() }) });
    const data = (await res.json().catch(() => ({}))) as Verification & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}

// ---- Email verification ----

// Opens a verification link's token: the account is verified and signed in on this device (the
// account you were on stays a click away). An invitation's token verifies the account you're on.
async function verifyWith(value: string): Promise<Account> {
    const res = await fetch(`${httpBase()}/auth/verify`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ token: value }) });
    const data = (await res.json().catch(() => ({}))) as { token?: string; user?: Account; error?: string };
    if (!res.ok || !data.user) throw new Error(data.error ?? `The server answered ${res.status}.`);
    if (data.token) {
        if (state.user && state.user.id !== data.user.id) set({ adding: true });
        become(data.user, data.token);
    } else if (state.user?.id === data.user.id) set({ user: { ...state.user, ...data.user } });
    return data.user;
}

// Back from the verification mail (?verify-account=…).
async function finishVerification() {
    if (typeof location === "undefined") return;
    const params = new URLSearchParams(location.search);
    const value = params.get("verify-account");
    if (!value) return;
    params.delete("verify-account");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    try {
        const user = await verifyWith(value);
        verifyNotice(`Thanks, ${user.email} is verified.`);
    } catch (e) {
        verifyNotice(e instanceof Error ? e.message : "That verification link didn't work.");
    }
}

// Where the result of a verification link is said (the app shows it as a toast).
let verifyNotice: (text: string) => void = () => undefined;
export function onVerifyNotice(show: (text: string) => void) {
    verifyNotice = show;
}

// Sends the verification link again. Throws the server's reason (too soon, no mail on this server).
export async function resendVerification(): Promise<Verification & { verified?: boolean }> {
    const res = await fetch(`${httpBase()}/auth/verify/resend`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ origin: mailLinkOrigin() }) });
    const data = (await res.json().catch(() => ({}))) as Verification & { verified?: boolean; error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    if (data.verified) void refreshSession();
    return data;
}

// Server admins: accounts waiting to verify their email, and verifying one by hand.
export async function unverifiedAccounts(): Promise<{ id: string; name: string; email: string; createdAt: number | null }[]> {
    const res = await fetch(`${httpBase()}/auth/admin/unverified`, { headers: authHeaders() });
    if (!res.ok) return [];
    return (await res.json()) as { id: string; name: string; email: string; createdAt: number | null }[];
}
// Server admins: how the server is used, counted on the server (engine/server-stats.tsx shows it).
export interface UsageDay { day: string; loads: number; devices: number; signups: number; verified: number; files: number; captures?: number; peakEditors: number; peakConnections: number }
export interface UsageReport { today: string; since: string; days: UsageDay[]; totals: { accounts: number; verifiedAccounts: number; files: number; teams: number }; now: { connections: number; rooms: number; joined: number; editors: number } }
export async function usageReport(): Promise<UsageReport> {
    const res = await fetch(`${httpBase()}/auth/admin/stats`, { headers: authHeaders() });
    const data = (await res.json().catch(() => ({}))) as UsageReport & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return data;
}
export async function verifyAccountAsAdmin(userId: string) {
    const res = await fetch(`${httpBase()}/auth/admin/verify`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ userId }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    if (userId === state.user?.id) void refreshSession();
}

export async function signIn(email: string, password: string) {
    const r = await call("/auth/signin", { email, password });
    become(r.user, r.token);
}

export async function signOut() {
    try {
        await fetch(`${httpBase()}/auth/signout`, { method: "POST", headers: authHeaders() });
    } catch {
        // The session is dropped here regardless.
    }
    // Another account signed in on this device takes over.
    const [next, ...rest] = state.others;
    set({ user: next?.user ?? null, token: next?.token ?? null, others: rest });
    announce(next?.user ?? null);
}

// Asks for a password reset. The server writes the link to its log for the person running it.
// Whether the server can mail the link (`mailConfigured`) or, on a development server, keeps it in
// its data folder (`devMailFile`). Neither says whether the account exists.
export async function requestReset(email: string): Promise<{ mailConfigured: boolean; devMailFile: boolean }> {
    const res = await fetch(`${httpBase()}/auth/reset-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, origin: mailLinkOrigin() }) });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const data = (await res.json().catch(() => ({}))) as { mailConfigured?: boolean; devMailFile?: boolean };
    return { mailConfigured: data.mailConfigured !== false, devMailFile: Boolean(data.devMailFile) };
}

export async function resetPassword(resetToken: string, password: string) {
    const r = await call("/auth/reset", { token: resetToken, password });
    set({ user: r.user, token: r.token, open: false });
    announce(r.user);
}

export async function changePassword(current: string, password: string) {
    const res = await fetch(`${httpBase()}/auth/password`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ current, password }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
}

// Checks the saved session still exists on the server (it may have been signed out elsewhere).
export async function refreshSession() {
    if (!state.token) return;
    try {
        const res = await fetch(`${httpBase()}/auth/me`, { headers: authHeaders() });
        if (res.status === 401) set({ user: null, token: null });
        else if (res.ok) set({ user: (await res.json()) as Account });
    } catch {
        // Offline: keep what we have.
    }
}

// Email digests of unread mentions and replies (sent hourly by the server when it has mail set up).
export async function setEmailDigests(on: boolean) {
    const res = await fetch(`${httpBase()}/auth/prefs`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ emailDigests: on }) });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    if (state.user) set({ user: { ...state.user, prefs: { emailDigests: on } } });
}

// ---- Single sign-on (when the server has a provider set up) ----

export async function ssoInfo(): Promise<{ enabled: boolean; name: string }> {
    try {
        const res = await fetch(`${httpBase()}/auth/sso`);
        if (!res.ok) return { enabled: false, name: "" };
        const data = (await res.json()) as { available?: boolean; name?: string | null };
        return { enabled: Boolean(data.available), name: data.name ?? "" };
    } catch {
        return { enabled: false, name: "" };
    }
}

// Sign in with SSO: the email's domain picks the way, the team's SAML identity provider or the
// server's OpenID Connect provider. Throws when neither covers it.
export async function startSso(email: string) {
    const res = await fetch(`${httpBase()}/auth/sso?email=${encodeURIComponent(email)}`);
    const data = (await res.json().catch(() => ({}))) as { method?: "saml" | "oidc" | null; start?: string; error?: string };
    if (!res.ok || !data.method || !data.start) throw new Error(data.error ?? "Single sign-on isn't set up for that email.");
    // SAML only returns to a path on the app's own origin; OpenID Connect takes the whole address.
    const back = data.method === "saml" ? `${location.pathname}${location.search}` : location.href.replace(/#.*$/, "");
    location.href = `${httpBase()}${data.start}${data.start.includes("?") ? "&" : "?"}return=${encodeURIComponent(back)}`;
}

// Back from the provider: the new session arrives in the address (#sso=…), which is cleared at once.
async function finishSso() {
    const match = /(?:^#|&)sso=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!match?.[1]) return;
    const fresh = match[1];
    history.replaceState(null, "", location.href.replace(/#.*$/, ""));
    try {
        const res = await fetch(`${httpBase()}/auth/me`, { headers: { authorization: `Bearer ${fresh}` } });
        if (!res.ok) return;
        become((await res.json()) as Account, fresh);
    } catch {
        // The session stays unused.
    }
}
void finishSso();
takeEmailTokenFromAddress();
void finishVerification();

// ---- Sessions: where this account is signed in ----

export async function listSessions(): Promise<{ current: boolean; createdAt: number; lastUsed: number; expiresAt: number }[]> {
    const res = await fetch(`${httpBase()}/auth/sessions`, { headers: authHeaders() });
    if (!res.ok) return [];
    return (await res.json()) as { current: boolean; createdAt: number; lastUsed: number; expiresAt: number }[];
}

export async function signOutOtherSessions(): Promise<number> {
    const res = await fetch(`${httpBase()}/auth/sessions`, { method: "DELETE", headers: authHeaders() });
    const data = (await res.json().catch(() => ({}))) as { ended?: number };
    return data.ended ?? 0;
}

// A personal Slack or Teams incoming webhook for comment digests ("" turns it off).
export async function setChatWebhook(url: string) {
    const res = await fetch(`${httpBase()}/auth/prefs`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ chatWebhook: url }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    if (state.user) set({ user: { ...state.user, prefs: { emailDigests: state.user.prefs?.emailDigests !== false, chatWebhook: Boolean(url) } } });
}
