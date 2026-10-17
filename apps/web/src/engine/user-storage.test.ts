import { describe, expect, it } from "vitest";

// A browser upgraded while account "acctA" was signed in, with things saved by the version before.
localStorage.setItem("nagma.auth.v1", JSON.stringify({ user: { id: "acctA", name: "A", email: "a@example.com", color: "#0D99FF" }, token: "t", others: [] }));
localStorage.setItem("nagma.files.v1", JSON.stringify([{ id: "draft1", name: "Old draft", kind: "design", createdAt: 1, updatedAt: 1 }]));
localStorage.setItem("nagma.tabs.v1", JSON.stringify(["draft1"]));
localStorage.setItem("nagma.cameras.v1", JSON.stringify([["page1", { x: 1, y: 2, zoom: 1 }]]));
localStorage.setItem("nagma.actions.recents.v1", JSON.stringify(["rect"]));
localStorage.setItem("nagma.comments.draft1", "[]");
localStorage.setItem("nagma.prefs.v1", JSON.stringify({ theme: "light" }));
localStorage.setItem("nagma.theme.system.v1", "1");

const { GUEST, beforeScopeChange, currentScope, docsDbName, isUserKey, onScopeChange, switchScope, userScopedKey, userStorage } = await import("./user-storage");

describe("per-account storage", () => {
    it("names keys by account", () => {
        expect(userScopedKey("nagma.tabs.v1", "acctB")).toBe("nagma@acctB:nagma.tabs.v1");
        expect(isUserKey("nagma.files.v1")).toBe(true);
        expect(isUserKey("nagma.comments.abc")).toBe(true);
        expect(isUserKey("nagma.prefs.v1")).toBe(false);
        expect(isUserKey("nagma.auth.v1")).toBe(false);
    });

    it("on upgrade, what was saved belongs to the account signed in; device settings stay shared", () => {
        expect(currentScope()).toBe("acctA");
        expect(localStorage.getItem("nagma.files.v1")).toBeNull();
        expect(JSON.parse(userStorage.getItem("nagma.files.v1") ?? "[]")).toHaveLength(1);
        expect(localStorage.getItem("nagma@acctA:nagma.tabs.v1")).toBe('["draft1"]');
        expect(localStorage.getItem("nagma@acctA:nagma.cameras.v1")).not.toBeNull();
        expect(localStorage.getItem("nagma@acctA:nagma.actions.recents.v1")).toBe('["rect"]');
        expect(localStorage.getItem("nagma@acctA:nagma.comments.draft1")).toBe("[]");
        expect(localStorage.getItem("nagma.prefs.v1")).toBe('{"theme":"light"}');
        expect(localStorage.getItem("nagma.theme.system.v1")).toBe("1");
        expect(localStorage.getItem("nagma.auth.v1")).not.toBeNull();
    });

    it("the drafts database from before becomes that account's; others get their own", () => {
        expect(docsDbName("acctA")).toBe("nagma.docs");
        expect(docsDbName(GUEST)).toBe("nagma.docs@guest");
        expect(docsDbName("acctB")).toBe("nagma.docs@acctB");
    });

    it("switching writes for the account being left first, then reads the next one's", () => {
        const order: string[] = [];
        const offBefore = beforeScopeChange(() => order.push(`before:${currentScope()}`));
        const offAfter = onScopeChange((s) => order.push(`after:${s}`));
        switchScope("acctB");
        expect(order).toEqual(["before:acctA", "after:acctB"]);
        expect(userStorage.getItem("nagma.files.v1")).toBeNull();
        userStorage.setItem("nagma.tabs.v1", '["b1"]');
        switchScope(null);
        expect(currentScope()).toBe(GUEST);
        expect(userStorage.getItem("nagma.tabs.v1")).toBeNull();
        switchScope("acctA");
        expect(userStorage.getItem("nagma.tabs.v1")).toBe('["draft1"]');
        expect(userStorage.getItem("nagma.tabs.v1", "acctB")).toBe('["b1"]');
        offBefore();
        offAfter();
    });

    it("migrates once: later un-namespaced keys aren't swept into anyone", () => {
        localStorage.setItem("nagma.search.recent.v1", '["late"]');
        switchScope("acctB");
        expect(localStorage.getItem("nagma.search.recent.v1")).toBe('["late"]');
        expect(userStorage.getItem("nagma.search.recent.v1")).toBeNull();
        expect(userStorage.keys("nagma.tabs")).toEqual(["nagma.tabs.v1"]);
    });
});
