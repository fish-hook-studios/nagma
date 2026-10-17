import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const feeds = require("../update-feed.cjs");

describe("where the desktop app looks for updates", () => {
    it("uses the project's GitHub Releases when no feed is set", () => {
        assert.deepEqual(feeds.chooseFeed({ env: {}, settings: {} }), { provider: "github", owner: "fish-hook-studios", repo: "nagma" });
        assert.deepEqual(feeds.chooseFeed({ env: {}, settings: { updateUrl: "   " } }).provider, "github");
    });
    it("prefers NAGMA_UPDATE_URL, then the updateUrl preference (generic provider)", () => {
        assert.deepEqual(feeds.chooseFeed({ env: { NAGMA_UPDATE_URL: "https://env.example/nagma" }, settings: { updateUrl: "https://pref.example/x" } }), { provider: "generic", url: "https://env.example/nagma" });
        assert.deepEqual(feeds.chooseFeed({ env: {}, settings: { updateUrl: " https://pref.example/x " } }), { provider: "generic", url: "https://pref.example/x" });
    });
    it("falls back to the feed the build was made with (NAGMA_UPDATE_URL when building)", () => {
        const flags = { updateUrl: "https://build.example/feed" };
        assert.deepEqual(feeds.chooseFeed({ settings: { updateUrl: "" }, flags }), { provider: "generic", url: "https://build.example/feed" });
        assert.equal(feeds.chooseFeed({ settings: { updateUrl: "https://pref.example/x" }, flags }).url, "https://pref.example/x");
        assert.equal(feeds.chooseFeed({ env: { NAGMA_UPDATE_URL: "https://env.example" }, flags }).url, "https://env.example");
    });
    it("is off for NAGMA_NO_UPDATES (run time or build time), when turned off, unpackaged, or with a bad address", () => {
        assert.equal(feeds.chooseFeed({ env: { NAGMA_NO_UPDATES: "1" } }).reason, "disabled-build");
        assert.equal(feeds.chooseFeed({ env: { NAGMA_NO_UPDATES: "true", NAGMA_UPDATE_URL: "https://x.example" } }).provider, null);
        assert.equal(feeds.chooseFeed({ flags: { noUpdates: true } }).reason, "disabled-build");
        assert.equal(feeds.chooseFeed({ env: { NAGMA_NO_UPDATES: "0" } }).provider, "github");
        assert.equal(feeds.chooseFeed({ packaged: false }).reason, "unpackaged");
        assert.equal(feeds.chooseFeed({ settings: { updatesOff: true } }).reason, "turned-off");
        assert.equal(feeds.chooseFeed({ settings: { updateUrl: "file:///tmp/feed" } }).reason, "bad-url");
    });
    it("gives electron-updater the provider options, with the beta channel for the generic feed", () => {
        assert.deepEqual(feeds.feedOptions({ provider: "github", owner: "o", repo: "r" }), { provider: "github", owner: "o", repo: "r" });
        assert.deepEqual(feeds.feedOptions({ provider: "generic", url: "https://u" }, { beta: true }), { provider: "generic", url: "https://u", channel: "beta" });
        assert.equal(feeds.feedOptions({ provider: null }), null);
    });
    it("installs updates itself except in unsigned Mac builds", () => {
        assert.equal(feeds.installsUpdates({ platform: "darwin", flags: { unsigned: true } }), false);
        assert.equal(feeds.installsUpdates({ platform: "darwin", flags: { unsigned: false } }), true);
        assert.equal(feeds.installsUpdates({ platform: "win32", flags: { unsigned: true } }), true);
        assert.equal(feeds.installsUpdates({ platform: "linux", flags: {} }), true);
    });
    it("links an unsigned build to the release page of the new version", () => {
        assert.equal(feeds.releasePage({ provider: "github" }, "0.2.0"), "https://github.com/fish-hook-studios/nagma/releases/tag/v0.2.0");
        assert.equal(feeds.releasePage({ provider: "github" }, null), "https://github.com/fish-hook-studios/nagma/releases/latest");
        assert.equal(feeds.releasePage({ provider: "generic", url: "https://u/feed" }, "0.2.0"), "https://u/feed");
    });
    it("writes and reads the build flags", () => {
        const flags = feeds.buildFlags({ env: {}, macSigned: false, winSigned: true });
        assert.deepEqual(flags, { unsigned: { darwin: true, win32: false }, noUpdates: false, updateUrl: null });
        assert.equal(feeds.buildFlags({ env: { NAGMA_UPDATE_URL: "https://u/f" } }).updateUrl, "https://u/f");
        const dir = mkdtempSync(join(tmpdir(), "nagma-flags-"));
        writeFileSync(join(dir, feeds.FLAGS_FILE), JSON.stringify(feeds.buildFlags({ env: { NAGMA_NO_UPDATES: "1" } })));
        assert.deepEqual(feeds.readFlags(dir, "darwin"), { unsigned: true, noUpdates: true, updateUrl: null });
        // No file (a build from before the flags, or unpackaged): signed and updating.
        assert.deepEqual(feeds.readFlags(join(dir, "missing"), "darwin"), { unsigned: false, noUpdates: false, updateUrl: null });
    });
    it("publishes to GitHub by default, to the generic feed when NAGMA_UPDATE_URL is set, nowhere for NAGMA_NO_UPDATES", () => {
        assert.deepEqual(feeds.publishConfig({}), [{ provider: "github", owner: "fish-hook-studios", repo: "nagma", releaseType: "release" }]);
        assert.deepEqual(feeds.publishConfig({ NAGMA_UPDATE_URL: "https://u", NAGMA_UPDATE_CHANNEL: "beta" }), [{ provider: "generic", url: "https://u", channel: "beta" }]);
        assert.equal(feeds.publishConfig({ NAGMA_NO_UPDATES: "1", NAGMA_UPDATE_URL: "https://u" }), null);
    });
});

describe("the electron-builder config", () => {
    it("has Linux targets, both Mac architectures, and update-feed.cjs in the app", () => {
        const { build } = require("../package.json");
        assert.deepEqual(build.linux.target.map((t) => t.target), ["AppImage", "deb"]);
        assert.equal(build.linux.category, "Graphics");
        for (const t of build.mac.target) assert.deepEqual([...t.arch].sort(), ["arm64", "x64"]);
        assert.ok(build.files.includes("update-feed.cjs"));
    });
});
