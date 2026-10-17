import "../test/prod-fixtures";
import { describe, expect, it } from "vitest";

// Loaded inside the tests, inspect-settings first: it and collab.ts import each other, and in the
// other order its start-up code runs before collab exists.
const load = async () => ({ ...(await import("./inspect-settings")), ...(await import("./collab")), ...(await import("./files")), ...(await import("./store")) });

// Regression from the Campaign/Sites/Make QA pass: switching to another file while a shared file's
// room was offline left the room joined; when the server answered, the room took the editor back
// and its document replaced the other file's (seen: an imported .buzz overwritten by the campaign).

describe("switching files while a room is offline", () => {
    it("leaves the room, so it can't take the editor back later", async () => {
        const { collab, createFile, editor, join, markShared } = await load();
        const shared = createFile("campaign", undefined, "On the server");
        markShared(shared.id, "roomAbc123");
        editor.set({ fileId: shared.id });
        // The test server address points nowhere: the room never gets past connecting / offline.
        join("roomAbc123", undefined, null);
        expect(collab.get().fileId).toBe("roomAbc123");
        expect(collab.get().status).not.toBe("live");
        expect(new URL(location.href).searchParams.get("file")).toBe("roomAbc123");
        await new Promise((r) => setTimeout(r, 50));

        const local = createFile("campaign", undefined, "Imported");
        editor.set({ fileId: local.id });

        expect(collab.get().status).toBe("local");
        expect(collab.get().fileId).toBeNull();
        expect(new URL(location.href).searchParams.get("file")).toBeNull();
    });

    it("stays joined when the file opened is the room's own", async () => {
        const { collab, createFile, editor, join, markShared } = await load();
        const shared = createFile("campaign", undefined, "Linked");
        markShared(shared.id, "roomDef456");
        join("roomDef456", undefined, null);
        editor.set({ fileId: shared.id });
        expect(collab.get().fileId).toBe("roomDef456");
        expect(collab.get().status).not.toBe("local");
    });
});

// Platform QA (apps/web/qa/QA-platform.md): a server file's tab, clicked after another file, opened
// it offline with the previous file's document still showing under its name.
describe("opening a server file's tab", () => {
    it("joins its room instead of showing the last file's document", async () => {
        const { collab, createFile, createEmptyDocument, editor, markShared, activateTab } = await load();
        const local = createFile("campaign", undefined, "Local campaign");
        editor.set({ fileId: local.id });
        editor.loadDocument(createEmptyDocument("Local campaign"), null);
        const shared = createFile("design", undefined, "Server file");
        markShared(shared.id, "roomTab789");
        await new Promise((r) => setTimeout(r, 0));
        await activateTab(shared.id);
        expect(editor.get().fileId).toBe(shared.id);
        // Its room is joined (the test server never answers, so it stays connecting), so the
        // server's document replaces the last file's when it arrives.
        expect(collab.get().fileId).toBe("roomTab789");
        expect(collab.get().status).not.toBe("local");
        expect(new URL(location.href).searchParams.get("file")).toBe("roomTab789");
    });
});
