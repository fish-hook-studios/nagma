// The app was called Migfa before it was Nagma. Its new name moves the app's data folder (userData
// is named after the app), so on the first start the old folder is copied over: settings, the local
// server's files (data/), and the editor's browser storage, which the editor then moves to its new
// keys (apps/web/src/engine/legacy-names.ts). The old app is left as it was. Links with the old
// scheme (migfa://) still open, MIGFA_* settings are still read (as NAGMA_*), and pages from a server
// that hasn't been updated still reach the menu bar through their old names. Nothing here needs
// Electron, so the builder config and tests can load it. tools/rename-nagma.sh leaves this file as it is.
const path = require("node:path");

const OLD = "migfa";
const OLD_NAME = "Migfa";

const LEGACY = {
    scheme: OLD,
    envPrefix: `${OLD.toUpperCase()}_`,
    // What a page from before the rename calls the bridge and its menu hook.
    bridge: `${OLD}Desktop`,
    menu: `__${OLD}Menu`,
};

const SCHEMES = ["nagma", LEGACY.scheme];
const isAppLink = (arg) => typeof arg === "string" && SCHEMES.some((s) => arg.startsWith(`${s}://`));

/** Copies MIGFA_X to NAGMA_X where NAGMA_X isn't set; says once that the old names are deprecated. */
function adoptLegacyEnv(env = process.env, log = (line) => console.warn(line)) {
    const read = [];
    for (const key of Object.keys(env)) {
        if (!key.startsWith(LEGACY.envPrefix)) continue;
        const next = `NAGMA_${key.slice(LEGACY.envPrefix.length)}`;
        if (env[next] !== undefined) continue;
        env[next] = env[key];
        read.push(key);
    }
    if (read.length) log(`Deprecated: ${read.join(", ")} ${read.length === 1 ? "is" : "are"} read as NAGMA_*. Rename ${read.length === 1 ? "it" : "them"}.`);
    return read;
}

// Chromium's lock files and caches stay behind: the lock belongs to the old app, and caches rebuild.
const SKIP = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort", "Cache", "Code Cache", "GPUCache", "GPUPersistentCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GraphiteDawnCache", "ShaderCache", "Crashpad", "Shared Dictionary"]);
const MARKER = "migrated-from-previous-name.json";
// What makes a data folder "in use": anything the new app would have written by now.
const IN_USE = ["settings.json", "data", "Local Storage", "IndexedDB", MARKER];

/**
 * On the first start under the new name: if `userData` (…/Nagma) has nothing of its own yet and the
 * old folder (…/Migfa, beside it) exists, copies the old one in. Returns what happened.
 */
function migrateUserData(userData, { fs = require("node:fs"), log = (line) => console.log(line) } = {}) {
    const oldDir = path.join(path.dirname(userData), OLD_NAME);
    try {
        if (path.resolve(oldDir) === path.resolve(userData)) return { copied: false, reason: "same folder" };
        if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) return { copied: false, reason: "no old folder" };
        if (fs.existsSync(userData) && IN_USE.some((name) => fs.existsSync(path.join(userData, name)))) return { copied: false, reason: "already in use" };
        fs.mkdirSync(userData, { recursive: true });
        const entries = fs.readdirSync(oldDir).filter((name) => !SKIP.has(name));
        for (const name of entries) {
            fs.cpSync(path.join(oldDir, name), path.join(userData, name), { recursive: true, force: false, errorOnExist: false, verbatimSymlinks: true });
        }
        fs.writeFileSync(path.join(userData, MARKER), JSON.stringify({ from: oldDir, at: new Date().toISOString(), entries }, null, 2));
        log(`Copied the app's data from ${oldDir} (its name before the rename) to ${userData}.`);
        return { copied: true, from: oldDir, entries };
    } catch (error) {
        log(`Couldn't copy the app's data from ${oldDir}: ${error instanceof Error ? error.message : String(error)}`);
        return { copied: false, reason: "error" };
    }
}

module.exports = { LEGACY, SCHEMES, isAppLink, adoptLegacyEnv, migrateUserData };
