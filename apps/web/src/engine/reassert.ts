import { editor } from "./store";
import type { Command, NagmaDocument } from "./types";

// Shared tallies (board votes, poll answers) keep everyone's entries in one layer property, and a
// collaborator's edit replaces a property whole: when two people vote at the same moment, the
// later write drops the earlier vote. Each person keeps what they last chose here and, whenever
// the shared document stops showing it (someone's write landed on top of theirs), writes it back
// on top of the newer state. Everyone re-asserts only their own entry, so all copies settle on
// every vote.

interface Entry {
    // Still wanted (the session is open, the layer exists).
    alive: (doc: NagmaDocument) => boolean;
    // The command that puts your entry back, or null when the document already shows it.
    restore: (doc: NagmaDocument) => Command | null;
}

const entries = new Map<string, Entry>();
let scheduled = false;

function run() {
    scheduled = false;
    const s = editor.get();
    if (s.readOnly) return;
    for (const [key, entry] of [...entries]) {
        if (!entry.alive(s.doc)) {
            entries.delete(key);
            continue;
        }
        const command = entry.restore(s.doc);
        if (command) editor.executeSilently(command);
    }
}

// Keeps your entry `key` in the document (see above).
export function reassert(key: string, entry: Entry) {
    entries.set(key, entry);
}

export function forget(key: string) {
    entries.delete(key);
}

// After the document changes (a collaborator's patch or your own edit), outside the store's update.
editor.subscribe(() => {
    if (!entries.size || scheduled) return;
    scheduled = true;
    queueMicrotask(run);
});
