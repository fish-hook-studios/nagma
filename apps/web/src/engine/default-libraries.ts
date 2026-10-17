import { collab } from "./collab";
import { enabledLibraries, loadManifest, setLibraryEnabled } from "./library";
import { editor } from "./store";
import { getTeams, projectOf, subscribeTeams } from "./teams";
import { userStorage } from "./user-storage";

// Default libraries: a team's admins pick libraries that are on in the team's files. Each one is
// turned on once per file (someone can turn it off again, and it stays off).

const KEY = (fileId: string) => `nagma.defaultLibraries.${fileId}`;

function applied(fileId: string): string[] {
    try {
        return JSON.parse(userStorage.getItem(KEY(fileId)) ?? "[]") as string[];
    } catch {
        return [];
    }
}

let busy = false;
async function apply() {
    const s = collab.get();
    if (busy || s.status !== "live" || s.role !== "edit" || !s.fileId || s.previewing) return;
    const team = projectOf(s.access?.project ?? null)?.team;
    const defaults = team?.defaultLibraries ?? [];
    if (!defaults.length) return;
    const done = applied(s.fileId);
    const on = new Set(enabledLibraries(editor.get().doc).map((l) => l.id));
    const todo = defaults.filter((id) => !done.includes(id) && !on.has(id) && id !== s.fileId);
    if (!todo.length) return;
    busy = true;
    try {
        for (const id of todo) {
            const manifest = await loadManifest(id);
            if (manifest) setLibraryEnabled(manifest, true);
        }
        try {
            userStorage.setItem(KEY(s.fileId), JSON.stringify([...done, ...todo]));
        } catch {
            // Applied again next time.
        }
    } finally {
        busy = false;
    }
}

// Checked when the open file, its access or the teams change (not on every cursor move).
let last = "";
function check(force = false) {
    const s = collab.get();
    const key = `${s.fileId}|${s.status}|${s.role}|${s.access?.project ?? ""}|${getTeams().length}`;
    if (!force && key === last) return;
    last = key;
    void apply();
}
collab.subscribe(() => check());
subscribeTeams(() => check(true));
