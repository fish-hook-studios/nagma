import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { LEGACY, adoptLegacyEnv, isAppLink, migrateUserData } = require("../legacy.cjs");
const guards = require("../guards.cjs");

// The app was called Migfa before it was Nagma (legacy.cjs).
describe("the app's name before the rename", () => {
    const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), "nagma-legacy-"));
    const seedOld = (root) => {
        const old = path.join(root, "Migfa");
        fs.mkdirSync(path.join(old, "data", "rooms"), { recursive: true });
        fs.mkdirSync(path.join(old, "Local Storage", "leveldb"), { recursive: true });
        fs.mkdirSync(path.join(old, "Cache"), { recursive: true });
        fs.writeFileSync(path.join(old, "settings.json"), JSON.stringify({ interfaceScale: 1.25 }));
        fs.writeFileSync(path.join(old, "data", "rooms", "abc.json"), "{}");
        fs.writeFileSync(path.join(old, "Local Storage", "leveldb", "000003.log"), "x");
        fs.writeFileSync(path.join(old, "Cache", "big"), "cache");
        fs.symlinkSync("host-123", path.join(old, "SingletonLock"));
        return old;
    };

    it("copies the old data folder into an empty new one, without locks and caches", () => {
        const root = fresh();
        const old = seedOld(root);
        const userData = path.join(root, "Nagma");
        const lines = [];
        const result = migrateUserData(userData, { log: (l) => lines.push(l) });
        assert.equal(result.copied, true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8")).interfaceScale, 1.25);
        assert.ok(fs.existsSync(path.join(userData, "data", "rooms", "abc.json")));
        assert.ok(fs.existsSync(path.join(userData, "Local Storage", "leveldb", "000003.log")));
        assert.ok(!fs.existsSync(path.join(userData, "Cache")));
        assert.ok(!fs.existsSync(path.join(userData, "SingletonLock")));
        // The old app's folder is left as it was.
        assert.ok(fs.existsSync(path.join(old, "settings.json")));
        assert.match(lines[0], /Copied the app's data/);
        // Only once: the new folder is in use now.
        fs.writeFileSync(path.join(old, "settings.json"), JSON.stringify({ interfaceScale: 2 }));
        assert.equal(migrateUserData(userData, { log: () => {} }).copied, false);
        assert.equal(JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8")).interfaceScale, 1.25);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("leaves a new folder that already has data alone, and does nothing without an old one", () => {
        const root = fresh();
        seedOld(root);
        const userData = path.join(root, "Nagma");
        fs.mkdirSync(path.join(userData, "data"), { recursive: true });
        assert.deepEqual(migrateUserData(userData, { log: () => {} }), { copied: false, reason: "already in use" });
        assert.ok(!fs.existsSync(path.join(userData, "settings.json")));
        const lonely = fresh();
        assert.deepEqual(migrateUserData(path.join(lonely, "Nagma"), { log: () => {} }), { copied: false, reason: "no old folder" });
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(lonely, { recursive: true, force: true });
    });

    it("reads MIGFA_* settings as NAGMA_*, saying so once", () => {
        const env = { MIGFA_UPDATE_URL: "https://u.example/", MIGFA_DEV_URL: "http://a", NAGMA_DEV_URL: "http://b" };
        const lines = [];
        assert.deepEqual(adoptLegacyEnv(env, (l) => lines.push(l)), ["MIGFA_UPDATE_URL"]);
        assert.equal(env.NAGMA_UPDATE_URL, "https://u.example/");
        assert.equal(env.NAGMA_DEV_URL, "http://b");
        assert.equal(lines.length, 1);
    });

    it("opens links with either scheme", () => {
        assert.equal(LEGACY.scheme, "migfa");
        assert.ok(isAppLink("nagma://file/abcdef123?key=k") && isAppLink("migfa://file/abcdef123?key=k"));
        assert.ok(!isAppLink("https://x.example") && !isAppLink("/a/b.fig"));
        assert.deepEqual(guards.protocolLink("migfa://file/abcdef123?key=k-1"), { kind: "file", id: "abcdef123", key: "k-1" });
        assert.deepEqual(guards.protocolLink("migfa://open?url=https%3A%2F%2Fteam.example%2F%3Ffile%3Dabc"), { kind: "url", url: "https://team.example/?file=abc" });
        assert.equal(guards.protocolLink("other://file/abcdef123"), null);
    });
});
