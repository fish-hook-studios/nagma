import { deleteDoc, loadDoc, saveDoc } from "./doc-store";
import { type FileMeta, adoptDrafts, getStarredFiles, replaceStarredFiles } from "./files";
import { type LocalFolder, adoptFolders } from "./folders";
import { currentScope, guestScope, userStorage } from "./user-storage";

// Drafts made in this browser while signed out belong to "guest" (engine/user-storage.ts). Signing
// in offers, once, to move them into the account: yes moves them (documents, folders, stars, local
// comments), no leaves them with signed-out use.

const INDEX_KEY = "nagma.files.v1";
const FOLDERS_KEY = "nagma.folders.v1";
const STARS_KEY = "nagma.starredFiles.v1";
const ANSWERED_KEY = "nagma.guestDrafts.answered";
// Kept per file beside the document.
const PER_FILE = ["nagma.comments.", "nagma.comment-reads.", "nagma.defaultLibraries."];
const docKey = (id: string) => `nagma.file.${id}`;

function readJson<T>(key: string, owner: string, fallback: T): T {
    try {
        const raw = userStorage.getItem(key, owner);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

// The drafts kept for signed-out use (not files that live on the server).
function guestLocalFiles(): FileMeta[] {
    return readJson<FileMeta[]>(INDEX_KEY, guestScope(), []).filter((f) => !f.shared);
}

// The signed-out drafts to offer this account: none when signed out, or once it has answered.
export function guestDraftsToOffer(): FileMeta[] {
    if (currentScope() === guestScope()) return [];
    const answered = new Set(readJson<string[]>(ANSWERED_KEY, currentScope(), []));
    return guestLocalFiles().filter((f) => !f.trashed && !answered.has(f.id));
}

// "No": they stay with signed-out use, and this account isn't asked about them again.
export function keepGuestDrafts() {
    const answered = new Set(readJson<string[]>(ANSWERED_KEY, currentScope(), []));
    for (const f of guestLocalFiles()) answered.add(f.id);
    try {
        userStorage.setItem(ANSWERED_KEY, JSON.stringify([...answered]));
    } catch {
        // Asked again next time.
    }
}

// "Yes": every signed-out draft (those in the trash too) becomes this account's. Returns how many
// moved (not counting the trash).
export async function moveGuestDrafts(): Promise<number> {
    const to = currentScope();
    if (to === guestScope()) return 0;
    const all = readJson<FileMeta[]>(INDEX_KEY, guestScope(), []);
    const moving = all.filter((f) => !f.shared);
    if (!moving.length) return 0;
    // Documents first: copied, then removed from signed-out use once all of them are across.
    for (const f of moving) {
        const doc = await loadDoc(docKey(f.id), guestScope());
        if (doc) await saveDoc(docKey(f.id), doc, to);
    }
    for (const f of moving) {
        for (const prefix of PER_FILE) {
            const value = userStorage.getItem(prefix + f.id, guestScope());
            if (value === null) continue;
            if (userStorage.getItem(prefix + f.id, to) === null) userStorage.setItem(prefix + f.id, value, to);
            userStorage.removeItem(prefix + f.id, guestScope());
        }
    }
    adoptFolders(readJson<LocalFolder[]>(FOLDERS_KEY, guestScope(), []));
    adoptDrafts(moving);
    const ids = new Set(moving.map((f) => f.id));
    const stars = readJson<string[]>(STARS_KEY, guestScope(), []);
    const starred = stars.filter((k) => ids.has(k));
    if (starred.length) replaceStarredFiles([...new Set([...getStarredFiles(), ...starred])]);
    userStorage.setItem(STARS_KEY, JSON.stringify(stars.filter((k) => !ids.has(k))), guestScope());
    userStorage.setItem(INDEX_KEY, JSON.stringify(all.filter((f) => f.shared)), guestScope());
    userStorage.removeItem(FOLDERS_KEY, guestScope());
    for (const f of moving) await deleteDoc(docKey(f.id), guestScope());
    return moving.filter((f) => !f.trashed).length;
}
