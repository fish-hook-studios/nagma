// Where the desktop app looks for updates. No Electron here, so the builder config and the tests
// can load it.
//
// In order:
//   1. Off when NAGMA_NO_UPDATES=1 (at run time, or when the build was made: custom builds that
//      must never update themselves), when the person turned updates off in Preferences, and in
//      unpackaged runs.
//   2. NAGMA_UPDATE_URL, the "updateUrl" preference, or the NAGMA_UPDATE_URL the build was made with:
//      a folder of electron-builder's update files (latest-mac.yml, latest.yml and the builds), read
//      with the generic provider.
//   3. Otherwise the project's GitHub Releases (fish-hook-studios/nagma), where the release workflow
//      (.github/workflows/release.yml) uploads the installers and the latest*.yml files.
//
// macOS installs an update only into a signed build (Squirrel.Mac checks the new app's signature
// against the running one). An unsigned Mac build is marked at build time (build-flags.json in the
// app's resources, written by electron-builder.config.cjs) and, instead of downloading, says an
// update is available and links to its release page.

const GITHUB = { owner: "fish-hook-studios", repo: "nagma" };
const RELEASES_PAGE = `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases`;
const FLAGS_FILE = "build-flags.json";

const isOn = (value) => /^(1|true|yes|on)$/i.test(String(value ?? "").trim());

/**
 * The feed for these settings, or why there is none.
 * @returns {{ provider: "github" | "generic" | null, url?: string, owner?: string, repo?: string, reason?: string }}
 */
function chooseFeed({ env = {}, settings = {}, packaged = true, flags = {} } = {}) {
    if (isOn(env.NAGMA_NO_UPDATES) || flags.noUpdates) return { provider: null, reason: "disabled-build" };
    if (!packaged) return { provider: null, reason: "unpackaged" };
    if (settings.updatesOff) return { provider: null, reason: "turned-off" };
    const custom = String(env.NAGMA_UPDATE_URL ?? (String(settings.updateUrl ?? "").trim() || flags.updateUrl) ?? "").trim();
    if (custom) {
        if (!/^https?:\/\/\S+$/.test(custom)) return { provider: null, reason: "bad-url" };
        return { provider: "generic", url: custom };
    }
    return { provider: "github", ...GITHUB };
}

/** What electron-updater's setFeedURL takes for a feed from chooseFeed. */
function feedOptions(feed, { beta = false } = {}) {
    if (feed.provider === "generic") return { provider: "generic", url: feed.url, channel: beta ? "beta" : "latest" };
    // Betas come through allowPrerelease and the "beta" channel (set by updater.cjs), not here.
    if (feed.provider === "github") return { provider: "github", owner: feed.owner, repo: feed.repo };
    return null;
}

/** Whether this build downloads and installs updates itself, or only points at the release page. */
function installsUpdates({ platform = process.platform, flags = {} } = {}) {
    return !(platform === "darwin" && flags.unsigned);
}

/** The page an update is downloaded from by hand. */
function releasePage(feed, version) {
    if (feed?.provider === "generic") return feed.url;
    return version ? `${RELEASES_PAGE}/tag/v${String(version).replace(/^v/, "")}` : `${RELEASES_PAGE}/latest`;
}

/** The flags a build writes into its resources (see electron-builder.config.cjs). */
function buildFlags({ env = {}, macSigned = false, winSigned = false } = {}) {
    return { unsigned: { darwin: !macSigned, win32: !winSigned }, noUpdates: isOn(env.NAGMA_NO_UPDATES), updateUrl: String(env.NAGMA_UPDATE_URL ?? "").trim() || null };
}

/** Reads build-flags.json from the resources folder, for one platform. Missing: a signed, updating build. */
function readFlags(resourcesPath, platform = process.platform, fs = require("node:fs"), path = require("node:path")) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(resourcesPath, FLAGS_FILE), "utf8"));
        return { unsigned: Boolean(raw?.unsigned?.[platform]), noUpdates: Boolean(raw?.noUpdates), updateUrl: typeof raw?.updateUrl === "string" && raw.updateUrl ? raw.updateUrl : null };
    } catch {
        return { unsigned: false, noUpdates: false, updateUrl: null };
    }
}

/** The publish setting for electron-builder: the custom feed, GitHub Releases, or nothing. */
function publishConfig(env = {}) {
    if (isOn(env.NAGMA_NO_UPDATES)) return null;
    if (env.NAGMA_UPDATE_URL) return [{ provider: "generic", url: env.NAGMA_UPDATE_URL, channel: env.NAGMA_UPDATE_CHANNEL || "latest" }];
    return [{ provider: "github", ...GITHUB, releaseType: "release" }];
}

module.exports = { GITHUB, RELEASES_PAGE, FLAGS_FILE, chooseFeed, feedOptions, installsUpdates, releasePage, buildFlags, readFlags, publishConfig };
