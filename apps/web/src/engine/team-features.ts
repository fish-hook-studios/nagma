import { fileMeta, getServerFiles } from "./files";
import { editor } from "./store";
import { projectOf } from "./teams";

// Products a team's admins can turn off (admin console › Settings › Products). Inspect is checked
// here, for files in the team's folders: switching to it goes back to Design with a note. Make and
// publishing sites are refused by the server.

export function teamOfOpenFile() {
    const meta = fileMeta(editor.get().fileId);
    const project = meta?.project ?? (meta?.shared ? getServerFiles().find((f) => f.id === meta.shared)?.project : null) ?? null;
    return projectOf(project)?.team ?? null;
}

let lastMode = editor.get().mode;
editor.subscribe(() => {
    const mode = editor.get().mode;
    if (mode === lastMode) return;
    lastMode = mode;
    if (mode !== "dev") return;
    const team = teamOfOpenFile();
    if (team?.features && !team.features.devMode) {
        lastMode = "design";
        editor.set({ mode: "design" });
        editor.notify(`Inspect is turned off for ${team.name}. A team admin can turn it on in the admin console.`);
    }
});
