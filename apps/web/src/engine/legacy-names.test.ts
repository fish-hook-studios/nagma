import { describe, expect, it } from "vitest";
import { legacy, migrateWebStorage, renamedKey } from "./legacy-names";

// What a browser kept before the product was renamed (Migfa) moves to the new names (Nagma).
describe("storage from before the rename", () => {
    it("renames migfa.* keys and nothing else", () => {
        expect(renamedKey("migfa.files.v1")).toBe("nagma.files.v1");
        expect(renamedKey("migfa.file.abc#img#x")).toBe("nagma.file.abc#img#x");
        expect(renamedKey("nagma.files.v1")).toBe("nagma.files.v1");
        expect(renamedKey("other.migfa.x")).toBe("other.migfa.x");
        expect(legacy.databases.map(renamedKey)).toEqual(["nagma.docs", "nagma.libraries", "nagma.media", "nagma.plugins"]);
    });

    it("moves old keys once, keeping a newer value under the new name", () => {
        localStorage.clear();
        localStorage.setItem("migfa.files.v1", '[{"id":"a"}]');
        localStorage.setItem("migfa.cameras.v1", "{}");
        localStorage.setItem("migfa.prefs.v1", "old");
        localStorage.setItem("nagma.prefs.v1", "new");
        localStorage.setItem("unrelated", "1");
        expect(migrateWebStorage(localStorage)).toBe(2);
        expect(localStorage.getItem("nagma.files.v1")).toBe('[{"id":"a"}]');
        expect(localStorage.getItem("migfa.files.v1")).toBeNull();
        expect(localStorage.getItem("nagma.cameras.v1")).toBe("{}");
        expect(localStorage.getItem("nagma.prefs.v1")).toBe("new");
        expect(localStorage.getItem("unrelated")).toBe("1");
        expect(migrateWebStorage(localStorage)).toBe(0);
        localStorage.clear();
    });

    it("puts the old value back when the new key can't be written", () => {
        const data = new Map<string, string>([["migfa.big", "x"]]);
        const storage = {
            get length() {
                return data.size;
            },
            key: (i: number) => [...data.keys()][i] ?? null,
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => {
                if (k.startsWith("nagma.")) throw new Error("QuotaExceededError");
                data.set(k, v);
            },
            removeItem: (k: string) => void data.delete(k),
            clear: () => data.clear(),
        } as Storage;
        expect(migrateWebStorage(storage)).toBe(0);
        expect(data.get("migfa.big")).toBe("x");
    });
});
