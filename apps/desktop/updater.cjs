// Updates: checks a feed for a newer Nagma when the app starts and from "Check for Updates…",
// downloads it in the background, then offers "Restart to Update". The feed is NAGMA_UPDATE_URL, or
// the "updateUrl" preference (settings.json); without one the updater stays off and the menu says so.
// The feed is a folder of electron-builder's update files (latest-mac.yml, latest.yml and the builds).
// On macOS updates install only into signed builds.

const { app, dialog } = require("electron");

let updater = null;
let state = { status: "idle", version: null, error: null, progress: 0 };
let onChange = () => {};
let manual = false;

const feedUrl = (settings) => String(process.env.NAGMA_UPDATE_URL ?? settings.updateUrl ?? "").trim();
const enabled = (settings) => app.isPackaged && /^https?:\/\//.test(feedUrl(settings));

function set(patch) {
    state = { ...state, ...patch };
    onChange(state);
}

// Sets up the updater (once), pointed at the feed, on the chosen channel.
function setup(settings) {
    if (!enabled(settings)) return null;
    if (!updater) {
        ({ autoUpdater: updater } = require("electron-updater"));
        updater.autoDownload = true;
        updater.autoInstallOnAppQuit = true;
        // NAGMA_UPDATE_DEBUG=1 prints what the updater does.
        updater.logger = process.env.NAGMA_UPDATE_DEBUG ? console : null;
        updater.on("checking-for-update", () => set({ status: "checking", error: null }));
        updater.on("update-available", (info) => set({ status: "downloading", version: info.version, progress: 0 }));
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
    updater.setFeedURL({ provider: "generic", url: feedUrl(settings), channel: settings.betaUpdates ? "beta" : "latest" });
    updater.allowPrerelease = Boolean(settings.betaUpdates);
    updater.channel = settings.betaUpdates ? "beta" : "latest";
    return updater;
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
    setTimeout(() => void updater.checkForUpdates().catch(() => undefined), 8000).unref?.();
    setInterval(() => void updater?.checkForUpdates().catch(() => undefined), 6 * 60 * 60 * 1000).unref?.();
}

// "Check for Updates…": says what happened either way.
async function checkNow(settings) {
    if (!enabled(settings)) {
        await dialog.showMessageBox({
            type: "info",
            message: `You're on Nagma ${app.getVersion()}.`,
            detail: app.isPackaged ? "Updates aren't set up for this build. Set an update feed under Preferences > Update Feed, or install a new Nagma build." : "Updates are checked only in packaged builds.",
        });
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

module.exports = { start, checkNow, restartToUpdate, setup, getState: () => state, feedUrl };
