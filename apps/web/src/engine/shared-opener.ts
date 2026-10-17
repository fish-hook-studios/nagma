import type { FileMeta } from "./files";

// How a file on the server is opened (collab.ts joins its room), set by collab.ts as it loads and
// used by files.ts openFile. It lives here, not in files.ts, because files.ts and collab.ts import
// each other: registering into files.ts from collab.ts could run before files.ts had set up the
// variable ("Cannot access 'openShared' before initialization").
let opener: ((meta: FileMeta) => boolean) | null = null;

export function setSharedOpener(fn: (meta: FileMeta) => boolean) {
    opener = fn;
}

export function sharedOpener(): ((meta: FileMeta) => boolean) | null {
    return opener;
}
