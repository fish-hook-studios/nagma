import { token } from "./auth";
import { collab, join } from "./collab";
import { duplicateFile, duplicateServerFile, fileMeta, openFile, putServerMeta, refreshServerFiles, rememberShared, trashFile } from "./files";
import { editor } from "./store";
import { moveDraftToProject, moveToProject, projectOf } from "./teams";

// The file menu's file-level actions for the open file, local or on the server.

// Duplicate: a server file is copied on the server into your drafts; a local one in this browser.
// Either way the copy opens, like a design tool opening the duplicate in a new tab.
export async function duplicateCurrentFile() {
    const id = editor.get().fileId;
    const meta = fileMeta(id);
    if (!id || !meta) return;
    try {
        if (meta.shared && token()) {
            const made = await duplicateServerFile(meta.shared);
            const copy = rememberShared(made.id, made.name, made.keys.edit);
            editor.set({ fileId: copy.id, homeOpen: false });
            join(made.id, undefined, made.keys.edit);
            editor.notify(`Duplicated as "${made.name}" in your drafts.`);
            return;
        }
        const copy = await duplicateFile(id);
        if (!copy) throw new Error("Couldn't duplicate.");
        await openFile(copy.id);
        editor.notify(`Duplicated as "${copy.name}".`);
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}

// Move to project (or back to Drafts with null). A local draft goes to the server inside the project.
export async function moveCurrentFile(project: string | null) {
    const id = editor.get().fileId;
    const meta = fileMeta(id);
    if (!id || !meta) return;
    try {
        if (meta.shared) await moveToProject(meta.shared, project);
        else if (project) {
            const sharedId = await moveDraftToProject(id, meta.kind, project);
            join(sharedId, editor.committed());
        }
        editor.notify(project ? `Moved to ${projectOf(project)?.project.name ?? "the project"}.` : "Moved to Drafts.");
    } catch (error) {
        editor.notify(error instanceof Error ? error.message : String(error));
    }
}

// Move to trash: a server file goes to everyone's trash, not just this browser's list.
export function trashCurrentFile() {
    const id = editor.get().fileId;
    const meta = fileMeta(id);
    if (!id || !meta) return;
    const editing = collab.get().status === "local" || collab.get().role === "edit";
    if (meta.shared && editing) void putServerMeta(meta.shared, { trashed: true }).then(refreshServerFiles);
    trashFile(id);
    editor.notify(editing ? `Moved "${meta.name}" to the trash. Restore it from Trash on Home.` : `Removed "${meta.name}" from your recents.`);
}
