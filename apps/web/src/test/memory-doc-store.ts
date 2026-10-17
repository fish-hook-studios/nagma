import type { NagmaDocument } from "../engine/types";
import { currentScope } from "../engine/user-storage";

// An in-memory stand-in for engine/doc-store.ts (jsdom has no IndexedDB), for tests that create,
// open and delete files: `vi.mock("../engine/doc-store", () => import("../test/memory-doc-store"))`.
// Each account's drafts are kept apart, as in the real store; `storedDocs` holds the current one's.
const byOwner = new Map<string, Map<string, NagmaDocument>>();
const docsOf = (owner: string) => byOwner.get(owner) ?? (byOwner.set(owner, new Map()), byOwner.get(owner) as Map<string, NagmaDocument>);

export const storedDocs = {
    get: (key: string) => docsOf(currentScope()).get(key),
    has: (key: string) => docsOf(currentScope()).has(key),
    get size() {
        return docsOf(currentScope()).size;
    },
    keys: () => docsOf(currentScope()).keys(),
};

export async function saveDoc(key: string, doc: NagmaDocument, owner: string = currentScope()): Promise<void> {
    docsOf(owner).set(key, structuredClone(doc));
}

export async function loadDoc(key: string, owner: string = currentScope()): Promise<NagmaDocument | null> {
    const doc = docsOf(owner).get(key);
    return doc ? structuredClone(doc) : null;
}

export async function deleteDoc(key: string, owner: string = currentScope()): Promise<void> {
    docsOf(owner).delete(key);
}

export async function docWritesSettled(): Promise<void> {}

export async function migrateLocalStorage(): Promise<number> {
    return 0;
}
