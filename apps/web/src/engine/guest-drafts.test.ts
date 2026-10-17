import { describe, expect, it, vi } from "vitest";

vi.mock("./doc-store", () => import("../test/memory-doc-store"));

// Signed out at first: drafts are made for "guest".
localStorage.clear();
const { auth, signIn, signOut, switchAccount, addAccount } = await import("./auth");
const { createFile, listFiles, loadFileDocument, getStarredFiles, toggleStarFile, setFileFolder, getTabs, addTab } = await import("./files");
const { createLocalFolder, listLocalFolders } = await import("./folders");
const { guestDraftsToOffer, keepGuestDrafts, moveGuestDrafts } = await import("./guest-drafts");
const { currentScope } = await import("./user-storage");

const account = (id: string) => ({ id, name: id, email: `${id}@example.com`, color: "#0D99FF", emailVerified: true });
// The server signs in whichever account is asked for.
async function signInAs(id: string, adding = false) {
    if (adding) addAccount();
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({ token: `token-${id}`, user: account(id) }), { status: 200 }));
    await signIn(`${id}@example.com`, "correct horse battery");
}
const names = () => listFiles().map((f) => f.name);

describe("drafts belong to the account", () => {
    it("signed out, drafts are the guest's", () => {
        expect(auth.get().user).toBeNull();
        expect(currentScope()).toBe("guest");
        const folder = createLocalFolder("Sketches", null);
        const draft = createFile("design", undefined, "Guest sketch");
        setFileFolder(draft.id, folder.id);
        toggleStarFile(draft.id);
        addTab(draft.id);
        createFile("design", undefined, "Guest notes");
        expect(names().sort()).toEqual(["Guest notes", "Guest sketch"]);
    });

    it("signing in shows the account's drafts, not the guest's, and offers to move them", async () => {
        await signInAs("acctA");
        expect(currentScope()).toBe("acctA");
        expect(names()).toEqual([]);
        expect(getTabs()).toEqual([]);
        expect(getStarredFiles()).toEqual([]);
        expect(guestDraftsToOffer().map((f) => f.name).sort()).toEqual(["Guest notes", "Guest sketch"]);
    });

    it("no: they stay with signed-out use and this account isn't asked again", () => {
        keepGuestDrafts();
        expect(guestDraftsToOffer()).toEqual([]);
        createFile("design", undefined, "A's file");
        expect(names()).toEqual(["A's file"]);
    });

    it("another account sees none of A's drafts, is offered the guest's, and yes moves them", async () => {
        await signInAs("acctB", true);
        expect(currentScope()).toBe("acctB");
        expect(names()).toEqual([]);
        expect(guestDraftsToOffer()).toHaveLength(2);
        expect(await moveGuestDrafts()).toBe(2);
        expect(names().sort()).toEqual(["Guest notes", "Guest sketch"]);
        const sketch = listFiles().find((f) => f.name === "Guest sketch");
        expect(sketch && (await loadFileDocument(sketch.id))?.name).toBe("Guest sketch");
        expect(getStarredFiles()).toEqual([sketch?.id]);
        expect(listLocalFolders().map((f) => f.name)).toEqual(["Sketches"]);
        expect(listLocalFolders()[0]?.id).toBe(sketch?.folderId);
        expect(guestDraftsToOffer()).toEqual([]);
    });

    it("switching back shows A's drafts again; signing out shows the guest's (now moved)", async () => {
        switchAccount("acctA");
        expect(currentScope()).toBe("acctA");
        expect(names()).toEqual(["A's file"]);
        vi.mocked(fetch).mockImplementationOnce(async () => new Response("{}", { status: 200 }));
        await signOut();
        // acctB was still signed in on this device, so it takes over.
        expect(auth.get().user?.id).toBe("acctB");
        expect(names().sort()).toEqual(["Guest notes", "Guest sketch"]);
        vi.mocked(fetch).mockImplementationOnce(async () => new Response("{}", { status: 200 }));
        await signOut();
        expect(currentScope()).toBe("guest");
        expect(names()).toEqual([]);
        expect(listLocalFolders()).toEqual([]);
    });
});
