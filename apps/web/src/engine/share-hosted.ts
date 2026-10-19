import { useSyncExternalStore } from "react";
import { type Account, auth, connectToServer, openSignIn } from "./auth";
import { setMyName, shareCurrent } from "./collab";
import { deleteDoc, docWritesSettled, loadDoc, saveDoc } from "./doc-store";
import { download } from "./export";
import { type FileKind, createFile, fileMeta, openFile } from "./files";
import { onThisComputer } from "./onboarding";
import { type ServerInfo, checkServer, closeServerPicker, currentServer, hostedServer, rememberServer } from "./servers";
import { editor } from "./store";

// Share for a file that only this computer can open (components/share-dialog.tsx): a link to it
// would carry this machine's own address, which nobody elsewhere can reach. Instead Share offers to
// move the file to a server: the project's hosted one (Share through Nagma), or one of your own.
//
// Sharing through a server switches to it like the server picker does, and switching starts the page
// over for that server (engine/auth.ts connectToServer). So the open file goes along: its document
// is kept on this device (IndexedDB, apart from any account or server), a note says where it's going,
// and once the page is back on that server and someone is signed in there, the document becomes a
// file of theirs on it (the usual Move to the server), and Share opens with a link that works.

// ---- What Share offers ----

export type ShareStep =
    // This computer is the server: Share through Nagma (hosted), or your own server, or export.
    | "through-hosted"
    // The same without a hosted server in this build: your own server, or export.
    | "pick-server"
    // On a server, the file only in this browser: move it there (as before).
    | "move"
    // On a server, the file on it: invite people and copy links (as before).
    | "share";

export interface ShareSituation {
    // The server in use is This computer: the desktop app's own, or one on loopback.
    thisComputer: boolean;
    // The file is open from a server (collab status isn't "local").
    fileOnServer: boolean;
    // This build knows a hosted server (engine/servers.ts hostedServer).
    hosted: boolean;
}

export function shareStep({ thisComputer, fileOnServer, hosted }: ShareSituation): ShareStep {
    if (thisComputer) return hosted ? "through-hosted" : "pick-server";
    return fileOnServer ? "share" : "move";
}

export const currentShareStep = (fileOnServer: boolean): ShareStep => shareStep({ thisComputer: onThisComputer(), fileOnServer, hosted: hostedServer() !== null });

// The server holds sharing back until the account's email is verified: the account says so up front,
// and a refused change answers 403 with code "email-unverified".
export const awaitingVerification = (user: Pick<Account, "emailVerified" | "verifyRequired"> | null | undefined) => Boolean(user && user.emailVerified === false && user.verifyRequired);
export const refusedUnverified = (status: number, body: { code?: unknown } | null | undefined) => status === 403 && body?.code === "email-unverified";

// ---- Moving the open file to another server ----

// A device key (not an account's or a server's): it has to survive the switch.
export const PENDING_SHARE_KEY = "nagma.shareThrough.v1";
// Where the document waits meanwhile: an IndexedDB database of its own (engine/doc-store.ts).
export const CARRY_OWNER = "share-carry";
const CARRY_KEY = "nagma.file.carry";
// A move nobody finished (no sign-in) is forgotten after a day.
const PENDING_TTL = 24 * 60 * 60 * 1000;

export interface PendingShare {
    // The server the file is going to.
    to: string;
    serverName: string;
    name: string;
    kind: FileKind;
    at: number;
}

export function pendingShare(now = Date.now()): PendingShare | null {
    try {
        const raw = localStorage.getItem(PENDING_SHARE_KEY);
        const p = raw ? (JSON.parse(raw) as Partial<PendingShare>) : null;
        if (!p || typeof p.to !== "string" || typeof p.at !== "number" || now - p.at > PENDING_TTL || now < p.at - 60_000) return null;
        return { to: p.to, serverName: typeof p.serverName === "string" ? p.serverName : p.to, name: typeof p.name === "string" ? p.name : "Untitled", kind: (typeof p.kind === "string" ? p.kind : "design") as FileKind, at: p.at };
    } catch {
        return null;
    }
}

// The move waiting for the server in use, if any (the sign-in dialog says what it's for).
export function pendingShareHere(): PendingShare | null {
    const p = pendingShare();
    return p && currentServer()?.origin === p.to ? p : null;
}

export function clearPendingShare() {
    try {
        localStorage.removeItem(PENDING_SHARE_KEY);
    } catch {
        // Expires on its own.
    }
    void deleteDoc(CARRY_KEY, CARRY_OWNER).catch(() => undefined);
}

// Keeps the open file for the server `target`, then switches to it (the page starts over there).
export async function moveOpenFileTo(target: ServerInfo): Promise<void> {
    editor.flushSave();
    const doc = editor.committed();
    const meta = fileMeta(editor.get().fileId);
    await saveDoc(CARRY_KEY, { ...doc, name: doc.name || meta?.name || "Untitled" }, CARRY_OWNER);
    await docWritesSettled();
    const pending: PendingShare = { to: target.origin, serverName: target.name, name: doc.name || meta?.name || "Untitled", kind: meta?.kind ?? "design", at: Date.now() };
    localStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(pending));
    rememberServer(target);
    connectToServer(target.origin);
}

// The server picker's and Get started's "Nagma (hosted)": connects once the server answers (its
// /health gives the public address links use). Returns the reason when it can't.
export async function connectToHosted(): Promise<string | null> {
    const hosted = hostedServer();
    if (!hosted) return "This build of Nagma has no hosted server.";
    try {
        const info = await checkServer(hosted.origin);
        rememberServer({ ...info, name: info.name || hosted.name });
        closeServerPicker();
        connectToServer(info.origin);
        return null;
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

// Share through Nagma: checks the hosted server answers, then moves the open file to it. Throws a
// sentence when it can't be reached.
export async function shareThroughHosted(): Promise<void> {
    const hosted = hostedServer();
    if (!hosted) throw new Error("This build of Nagma has no hosted server. Use your own server instead.");
    const info = await checkServer(hosted.origin);
    await moveOpenFileTo({ ...info, name: info.name || hosted.name });
}

// At start, on the server a file was going to: signed in, the file is made there and Share opens;
// signed out, the sign-in dialog asks first (signing in starts the page over, and this runs again).
// Returns whether it opened the file (the app then skips opening the last one).
export async function resumePendingShare(): Promise<boolean> {
    const p = pendingShare();
    if (!p) {
        if (localStorage.getItem(PENDING_SHARE_KEY) !== null) clearPendingShare();
        return false;
    }
    if (currentServer()?.origin !== p.to) return false;
    const user = auth.get().user;
    if (!user) {
        openSignIn();
        return false;
    }
    const doc = await loadDoc(CARRY_KEY, CARRY_OWNER);
    clearPendingShare();
    if (!doc) return false;
    const meta = createFile(p.kind, doc, p.name);
    await docWritesSettled();
    await openFile(meta.id);
    setMyName(user.name, user.color);
    shareCurrent();
    requestShareDialog();
    editor.notify(`"${p.name}" is on ${p.serverName} now. The original stays on This computer.`);
    return true;
}

// Export a copy: the document as a .nagma.json file (File › Save local copy).
export function exportCopy() {
    const doc = editor.get().doc;
    download(new Blob([JSON.stringify(doc)], { type: "application/json" }), `${doc.name || "Untitled"}.nagma.json`);
}

// ---- Opening Share from elsewhere (after a move) ----

let requested = false;
const listeners = new Set<() => void>();
function setRequested(next: boolean) {
    requested = next;
    for (const l of [...listeners]) l();
}
export const requestShareDialog = () => setRequested(true);
// The Share button that opens for a request takes it, so only one opens.
export const takeShareRequest = () => {
    if (!requested) return false;
    setRequested(false);
    return true;
};
export function useShareRequested(): boolean {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => requested,
    );
}
