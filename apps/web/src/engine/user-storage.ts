// What this browser keeps for a person (drafts and their index, open tabs, recents, stars, folders,
// where each page was last viewed, per-user preferences…) belongs to the account signed in, or to
// "guest" when nobody is. Each account's localStorage keys carry its id
// (`nagma@<account>:<key>`) and its drafts live in an IndexedDB database of its own, so switching
// accounts never shows another account's drafts. Device settings (theme, interface scale, panel
// layout, the session list itself) stay shared by everyone on the device.
//
// Upgrading: data from before this existed belongs to whoever was signed in at the time (or guest),
// so nothing is lost. The localStorage keys move once; the drafts database stays where it is and
// simply becomes that account's.

import { authStorageKey, scopeSuffix } from "./servers";

export const GUEST = "guest";
const META_KEY = "nagma.storage.v1";
const LEGACY_DOCS_DB = "nagma.docs";

// Keys that hold someone's own things or choices.
export const USER_KEYS = [
    "nagma.files.v1",
    "nagma.doc.v1",
    "nagma.tabs.v1",
    "nagma.protoTabs.v1",
    "nagma.starredFiles.v1",
    "nagma.starred.v1",
    "nagma.folders.v1",
    "nagma.cameras.v1",
    "nagma.actions.recents.v1",
    "nagma.tools.recents.v1",
    "nagma.search.recent.v1",
    "nagma.plugins.last",
    "nagma.home.v1",
    "nagma.home.tree.v1",
    "nagma.home.recommended.hidden",
    "nagma.board.templates.v1",
    "nagma.board.mentions.seen",
    "nagma.agent.chats.v1",
    "nagma.docSignature.v1",
    "nagma.notifications.pushed.v1",
    "nagma.admin.dismissed",
    "nagma.defaultProps.v1",
    "nagma.devNotify.v1",
    "nagma.guestDrafts.answered",
];
// And families of keys, one per file or plugin.
export const USER_PREFIXES = ["nagma.file.", "nagma.pending.", "nagma.linkPass.", "nagma.comments.", "nagma.comment-reads.", "nagma.defaultLibraries.", "nagma.plugin."];

export const isUserKey = (key: string) => USER_KEYS.includes(key) || USER_PREFIXES.some((p) => key.startsWith(p));

const SCOPE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const clean = (id: unknown) => (typeof id === "string" && SCOPE_RE.test(id) ? id : GUEST);

// Each server keeps its own (engine/servers.ts): on a server other than This computer, scopes carry
// the server's key ("<account>~<server>", "guest~<server>").
const scopeFor = (accountId: unknown) => `${clean(accountId)}${scopeSuffix()}`;
// Signed out, on the server in use.
export const guestScope = () => scopeFor(null);

// The account this page was loaded for, from the saved session on the server in use.
function scopeFromSession(): string {
    try {
        const raw = localStorage.getItem(authStorageKey());
        return scopeFor(raw ? (JSON.parse(raw) as { user?: { id?: unknown } | null }).user?.id : null);
    } catch {
        return guestScope();
    }
}

let scope: string | null = null;

export function currentScope(): string {
    if (scope === null) {
        scope = scopeFromSession();
        migrateUnscoped(scope);
    }
    return scope;
}

export const userScopedKey = (key: string, owner: string = currentScope()) => `nagma@${owner}:${key}`;

// localStorage, for the current account (or `owner`). Throws like localStorage does.
export const userStorage = {
    getItem: (key: string, owner?: string) => localStorage.getItem(userScopedKey(key, owner)),
    setItem: (key: string, value: string, owner?: string) => {
        if (!frozen) localStorage.setItem(userScopedKey(key, owner), value);
    },
    removeItem: (key: string, owner?: string) => {
        if (!frozen) localStorage.removeItem(userScopedKey(key, owner));
    },
    // The account's keys that start with `prefix`, without the account part.
    keys(prefix = "", owner: string = currentScope()): string[] {
        const head = userScopedKey("", owner);
        return Object.keys(localStorage)
            .filter((k) => k.startsWith(head + prefix))
            .map((k) => k.slice(head.length));
    },
};

function readMeta(): { v: number; docsOwner: string } | null {
    try {
        const raw = localStorage.getItem(META_KEY);
        return raw ? (JSON.parse(raw) as { v: number; docsOwner: string }) : null;
    } catch {
        return null;
    }
}

// Moves keys from before accounts had storage of their own to `owner`, once.
export function migrateUnscoped(owner: string) {
    try {
        if (readMeta()) return;
        for (const key of Object.keys(localStorage)) {
            if (!isUserKey(key)) continue;
            const value = localStorage.getItem(key);
            const target = userScopedKey(key, owner);
            if (value !== null && localStorage.getItem(target) === null) localStorage.setItem(target, value);
            localStorage.removeItem(key);
        }
        localStorage.setItem(META_KEY, JSON.stringify({ v: 1, docsOwner: owner }));
    } catch {
        // Storage blocked or full: tried again at the next start.
    }
}

// The IndexedDB database holding an account's drafts. The one from before (nagma.docs) is the
// account's that was signed in when this version first ran.
export function docsDbName(owner: string = currentScope()): string {
    currentScope();
    return readMeta()?.docsOwner === owner ? LEGACY_DOCS_DB : `${LEGACY_DOCS_DB}@${owner}`;
}

// ---- Switching: the page's state is reloaded for the next account ----

const before = new Set<() => void>();
const after = new Set<(owner: string) => void>();
// The app reloads the page for the next account (main.tsx). Until it has, nothing more is written:
// what's still in memory belongs to the account just left.
let reload: (() => void) | null = null;
let frozen = false;
export function reloadOnScopeChange(run: () => void) {
    reload = run;
}
export const storageFrozen = () => frozen;

// Runs while the old account is still current (to write what's waiting).
export function beforeScopeChange(listener: () => void) {
    before.add(listener);
    return () => before.delete(listener);
}
// Runs once the new account is current.
export function onScopeChange(listener: (owner: string) => void) {
    after.add(listener);
    return () => after.delete(listener);
}

function runBefore() {
    for (const l of [...before]) {
        try {
            l();
        } catch {
            // One failed write mustn't keep the old account's state on screen.
        }
    }
}

// Called by engine/auth.ts whenever the signed-in account changes (null: signed out).
export function switchScope(accountId: string | null) {
    const next = scopeFor(accountId);
    if (next === currentScope()) return;
    runBefore();
    become(next);
}

// Another server (engine/auth.ts connectToServer): what's waiting is written for the account and
// server being left, `apply` then makes the next server current, and the page always starts over,
// even when the scope's name stays the same (the server behind everything changed).
export function changeServer(apply: () => void) {
    currentScope();
    runBefore();
    apply();
    become(scopeFromSession());
}

function become(next: string) {
    scope = next;
    if (reload) {
        frozen = true;
        reload();
        return;
    }
    for (const l of [...after]) l(next);
}
