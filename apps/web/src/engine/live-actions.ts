import { viewCenter } from "./actions";
import { LIVE_APP_SIZE, LIVE_STARTERS, makeLiveAppNode, makeLiveNode } from "./live";
import { makeAppFiles } from "./live-app";
import { editor } from "./store";

// Insert › Live frame: a starter placed in the middle of the view, selected, ready for its props.
export function insertLiveFrame(starterId: string) {
    const starter = LIVE_STARTERS.find((s) => s.id === starterId) ?? LIVE_STARTERS[0];
    const s = editor.get();
    if (!starter || s.readOnly) return;
    const c = viewCenter();
    const node = makeLiveNode(s.doc, starter, { x: c.x - starter.w / 2, y: c.y - starter.h / 2 }, s.pageId);
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id], tool: "move", rightTab: "design" });
}

// The person's Make apps, for Insert › Live frame: drafts in this browser and files on the server.
export interface MakeAppChoice {
    id: string;
    name: string;
}

export async function makeAppChoices(): Promise<MakeAppChoice[]> {
    const { getServerFiles, listFiles } = await import("./files");
    const out: MakeAppChoice[] = [];
    const seen = new Set<string>();
    for (const f of listFiles()) {
        if (f.kind !== "make" || f.trashed || f.id === editor.get().fileId) continue;
        // A shared app by its server id, so everyone the file reaches can find it.
        out.push({ id: f.shared ?? f.id, name: f.name });
        seen.add(f.id);
        if (f.shared) seen.add(f.shared);
    }
    for (const f of getServerFiles()) if (f.kind === "make" && !f.trashed && !seen.has(f.id)) out.push({ id: f.id, name: f.name });
    return out;
}

// Same, from what is already known (no waiting): for the Actions palette.
export function knownMakeApps(): MakeAppChoice[] {
    return cachedChoices;
}
let cachedChoices: MakeAppChoice[] = [];
export async function refreshMakeApps(): Promise<MakeAppChoice[]> {
    const { refreshServerFiles } = await import("./files");
    await refreshServerFiles().catch(() => undefined);
    cachedChoices = await makeAppChoices();
    return cachedChoices;
}

// A Live frame running this Make app, in the middle of the view.
export async function insertLiveApp(id: string): Promise<void> {
    const s = editor.get();
    if (s.readOnly) return;
    const app = await makeAppFiles(id);
    if (!app) return void editor.notify("That Make app has no files yet, or it can't be opened from here.");
    const now = editor.get();
    const c = viewCenter();
    const node = makeLiveAppNode(now.doc, { id, name: app.name, files: app.files }, { x: c.x - LIVE_APP_SIZE.w / 2, y: c.y - LIVE_APP_SIZE.h / 2 }, now.pageId);
    editor.execute({ type: "node.create", node });
    editor.set({ selection: [node.id], tool: "move", rightTab: "design" });
}
