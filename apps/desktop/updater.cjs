// Updates: checks for a newer Nagma when the app starts and from "Check for Updates…", downloads it
// in the background, then offers "Restart to Update". Where it looks is decided in update-feed.cjs:
// NAGMA_UPDATE_URL, the "updateUrl" preference or the feed the build was made with (a folder of
// electron-builder's update files, the generic provider), otherwise the project's GitHub Releases. NAGMA_NO_UPDATES=1 (at run time, or
// when the build was made) and Preferences > Update Feed > Turn Off Updates switch it off.
//
// macOS installs updates only into signed builds: electron-updater (Squirrel.Mac) refuses an update
// whose signature doesn't match the running app. An unsigned Mac build (build-flags.json says so)
// therefore doesn't download: it says "Nagma X is available" and opens the release page, where the
// new build is downloaded and installed by hand.

const { app, dialog, shell } = require("electron");
const feeds = require("./update-feed.cjs");

let updater = null;
let state = { status: "idle", version: null, error: null, progress: 0 };
let onChange = () => {};
let manual = false;
let current = { provider: null };
let flags = null;

const buildFlags = () => (flags ??= app.isPackaged ? feeds.readFlags(process.resourcesPath) : { unsigned: false, noUpdates: false, updateUrl: null });
const choose = (settings) => feeds.chooseFeed({ env: process.env, settings, packaged: app.isPackaged, flags: buildFlags() });
const installs = () => feeds.installsUpdates({ platform: process.platform, flags: buildFlags() });

// The feed address shown in Preferences > Update Feed.
function feedUrl(settings) {
    const feed = choose(settings);
    if (feed.provider === "generic") return feed.url;
    if (feed.provider === "github") return feeds.RELEASES_PAGE;
    return "";
}

function set(patch) {
    state = { ...state, ...patch };
    onChange(state);
}

// Sets up the updater (once), pointed at the feed, on the chosen channel.
function setup(settings) {
    current = choose(settings);
    if (!current.provider) return null;
    if (!updater) {
        ({ autoUpdater: updater } = require("electron-updater"));
        updater.autoInstallOnAppQuit = true;
        // NAGMA_UPDATE_DEBUG=1 prints what the updater does.
        updater.logger = process.env.NAGMA_UPDATE_DEBUG ? console : null;
        updater.on("checking-for-update", () => set({ status: "checking", error: null }));
        updater.on("update-available", (info) => {
            if (installs()) return set({ status: "downloading", version: info.version, progress: 0 });
            // Unsigned on macOS: point at the release instead of downloading what can't be installed.
            const announce = manual || state.version !== info.version;
            set({ status: "available", version: info.version });
            if (announce) void offerReleasePage();
            manual = false;
        });
        updater.on("download-progress", (p) => set({ progress: Math.round(p.percent ?? 0) }));
        updater.on("update-not-available", () => {
            set({ status: "current" });
            if (manual) void dialog.showMessageBox({ type: "info", message: "Nagma is up to date.", detail: `You're on version ${app.getVersion()}.` });
            manual = false;
        });
        updater.on("update-downloaded", (info) => {
            set({ status: "ready", version: info.version, progress: 100 });
            manual = false;
            void promptRestart();
        });
        updater.on("error", (error) => {
            set({ status: "error", error: error?.message ?? String(error) });
            if (manual) void dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates.", detail: state.error ?? "" });
            manual = false;
        });
    }
    const beta = Boolean(settings.betaUpdates);
    updater.autoDownload = installs();
    updater.setFeedURL(feeds.feedOptions(current, { beta }));
    updater.allowPrerelease = beta;
    updater.channel = beta ? "beta" : "latest";
    // Setting the channel allows downgrades; leaving the beta channel shouldn't install an older build.
    updater.allowDowngrade = false;
    return updater;
}

// An unsigned Mac build: the new version is downloaded from its release page.
async function offerReleasePage() {
    const { response } = await dialog.showMessageBox({
        type: "info",
        buttons: ["Open Download Page", "Later"],
        defaultId: 0,
        cancelId: 1,
        message: `Nagma ${state.version ?? ""} is available.`.replace(/ +\./, "."),
        detail: `You're on version ${app.getVersion()}. This build isn't signed, so macOS can't update it in place: download the new version from the releases page and replace Nagma in Applications. Your files and settings are kept.`,
    });
    if (response === 0) openReleasePage();
}

function openReleasePage() {
    void shell.openExternal(feeds.releasePage(current, state.version));
}

async function promptRestart() {
    const { response } = await dialog.showMessageBox({
        type: "info",
        buttons: ["Restart to Update", "Later"],
        defaultId: 0,
        cancelId: 1,
        message: `Nagma ${state.version ?? ""} is ready.`.replace(/ +\./, "."),
        detail: "Restart now to finish updating, or it installs the next time you quit.",
    });
    if (response === 0) restartToUpdate();
}

function restartToUpdate() {
    if (state.status !== "ready" || !updater) return;
    app.isQuitting = true;
    updater.quitAndInstall();
}

// On launch: a quiet check a few seconds in, then every six hours.
function start(settings, listener) {
    onChange = listener;
    if (!setup(settings)) return;
    setTimeout(() => void (current.provider && updater.checkForUpdates().catch(() => undefined)), 8000).unref?.();
    setInterval(() => void (current.provider && updater?.checkForUpdates().catch(() => undefined)), 6 * 60 * 60 * 1000).unref?.();
}

const OFF_DETAIL = {
    "disabled-build": "Updates are turned off in this build. Install a new Nagma build to update.",
    unpackaged: "Updates are checked only in packaged builds.",
    "turned-off": "Updates are turned off. Turn them back on under Preferences > Update Feed.",
    "bad-url": "The update feed address isn't a web address. Change it under Preferences > Update Feed.",
};

// "Check for Updates…": says what happened either way.
async function checkNow(settings) {
    const feed = choose(settings);
    if (!feed.provider) {
        await dialog.showMessageBox({ type: "info", message: `You're on Nagma ${app.getVersion()}.`, detail: OFF_DETAIL[feed.reason] ?? "" });
        return;
    }
    if (state.status === "ready") return promptRestart();
    if (state.status === "downloading") {
        await dialog.showMessageBox({ type: "info", message: `Downloading Nagma ${state.version ?? ""}…`, detail: `${state.progress}% done. You'll be asked to restart when it's ready.` });
        return;
    }
    manual = true;
    setup(settings);
    await updater.checkForUpdates().catch(() => undefined);
}

module.exports = { start, checkNow, restartToUpdate, openReleasePage, setup, getState: () => state, feedUrl };
