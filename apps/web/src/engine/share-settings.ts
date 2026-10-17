import { collab } from "./collab";
import { editor } from "./store";

// The share setting "Viewers can copy, share and export": when an editor turns it off, people
// with view access can still look and comment, but not copy layers out, export or hand out links.

export function exportBlocked(): boolean {
    const s = collab.get();
    return s.status !== "local" && s.role !== "edit" && s.access?.viewersCanExport === false;
}

// For the copy and export actions: true (and a note) when the file doesn't allow it.
export function refuseExport(): boolean {
    if (!exportBlocked()) return false;
    editor.notify("This file's editors turned off copying, sharing and exporting for people with view access.");
    return true;
}
