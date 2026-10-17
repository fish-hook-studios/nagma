// Nagma for the desktop: starts the bundled sync server (which also serves the editor) on a free
// local port, with the files kept in the app's own data folder, and opens the editor in a window.
// Collaborators on the same network can join the files this laptop shares, as with the web build.

// First: the app's data folder and settings from before the product's rename (legacy.cjs).
const legacy = require("./legacy.cjs");
legacy.adoptLegacyEnv(process.env);
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, session, shell } = require("electron");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const updater = require("./updater.cjs");
const { openableFiles, readOpenFile } = require("./open-files.cjs");
const guards = require("./guards.cjs");
const menuItems = require("./menu-items.cjs");

let server = null;
let baseUrl = null;
let tray = null;
let closedTabs = [];
// The open file's menus, per window (apps/web/src/engine/desktop.ts), shown while it's in front.
const fileMenus = new Map();
const windows = new Set();
// .fig files opened from Finder or dropped on the Dock icon, waiting for a window to import them.
const pendingFigs = [];
// nagma:// links that came in before the local server was up.
const pendingLinks = [];

// Preferences kept between launches: interface scale, tabs while presenting, the menu bar icon,
// hardware acceleration, and the windows "Quit and Keep Windows" leaves open.
// The data folder is named after the app; the first start under the new name copies the old one in.
legacy.migrateUserData(app.getPath("userData"));
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
let settings = { interfaceScale: 1, presentTabs: false, showInMenuBar: false, disableHardwareAcceleration: false, keptWindows: null, updateUrl: "", updatesOff: false, betaUpdates: false, trustedOrigins: [] };
// The newest notifications from the open editor (comments, invites, requests), for the menu bar icon.
let notices = [];
const mac = process.platform === "darwin";
try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
} catch {
    // First launch.
}
function saveSettings() {
    try {
        fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
        fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    } catch {
        // Settings are a nicety.
    }
}
if (settings.disableHardwareAcceleration) app.disableHardwareAcceleration();

// Packaged: the editor and server ship as extra resources. From the repo: the sibling apps.
function resourcePaths() {
    if (app.isPackaged) {
        return { server: path.join(process.resourcesPath, "server", "server.mjs"), web: path.join(process.resourcesPath, "web") };
    }
    return { server: path.join(__dirname, "..", "server", "server.mjs"), web: path.join(__dirname, "..", "web", "dist") };
}

function freePort(preferred) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once("error", () => {
            const any = net.createServer();
            any.listen(0, "127.0.0.1", () => {
                const port = any.address().port;
                any.close(() => resolve(port));
            });
        });
        probe.listen(preferred, "0.0.0.0", () => probe.close(() => resolve(preferred)));
    });
}

function waitForServer(url, tries = 100) {
    return new Promise((resolve, reject) => {
        const attempt = (left) => {
            http.get(url, (res) => {
                res.resume();
                resolve();
            }).on("error", () => {
                if (left <= 0) reject(new Error("The local server didn't start."));
                else setTimeout(() => attempt(left - 1), 100);
            });
        };
        attempt(tries);
    });
}

async function startServer() {
    if (process.env.NAGMA_DEV_URL) {
        baseUrl = process.env.NAGMA_DEV_URL;
        return;
    }
    const { server: serverPath, web } = resourcePaths();
    const port = await freePort(47878);
    const dataDir = path.join(app.getPath("userData"), "data");
    // Electron runs the server as plain Node (no window), with its own copy of the runtime.
    // NAGMA_LOCAL_DEVICE: this computer's own server keeps an AI key for drafts without an account
    // (only for this computer's pages) and may reach local model servers.
    server = fork(serverPath, [], {
        env: { NAGMA_SERVER_NAME: "This computer", ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), DATA_DIR: dataDir, STATIC_DIR: web, NAGMA_LOCAL_DEVICE: "1", NAGMA_VERSION: app.getVersion() },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    server.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
    server.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
    server.on("exit", (code) => {
        server = null;
        if (code && !app.isQuitting) dialog.showErrorBox("Nagma", `The local server stopped (code ${code}). Restart Nagma to keep working.`);
    });
    baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl);
}

const originOf = (url) => {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
};

// The Nagma servers whose pages may use the app: this laptop's own, and the ones the person chose to
// open here (a teammate's server from a link). Only their pages get the camera, microphone and
// clipboard without asking, and only their messages (menus, notifications) are listened to.
// Links to anywhere else ask first, and can open in the browser instead.
const trustedOrigins = () => new Set([originOf(baseUrl), ...(Array.isArray(settings.trustedOrigins) ? settings.trustedOrigins : [])].filter(Boolean));
const isTrusted = (url) => {
    const origin = originOf(url);
    return Boolean(origin) && trustedOrigins().has(origin);
};
// An IPC message from the top frame of a page on a trusted server.
const fromTrusted = (event) => {
    const frame = event.senderFrame;
    return Boolean(frame && !frame.parent && isTrusted(frame.url));
};

// Opening a link to a server this app hasn't opened before: here (and trusted from now on), in the
// browser, or not at all.
async function allowOrigin(url) {
    if (isTrusted(url)) return "app";
    const origin = originOf(url);
    if (!origin || !/^https?:/.test(url)) return null;
    const { response } = await dialog.showMessageBox({
        type: "question",
        buttons: ["Open in Nagma", "Open in Browser", "Cancel"],
        defaultId: 1,
        cancelId: 2,
        message: `Open ${new URL(url).host} in Nagma?`,
        detail: "Only open Nagma servers you trust here: pages opened in the app can use your camera, microphone and clipboard. Anything else is safer in your browser.",
    });
    if (response === 1) {
        void shell.openExternal(url);
        return "browser";
    }
    if (response !== 0) return null;
    settings.trustedOrigins = [...new Set([...(settings.trustedOrigins ?? []), origin])].slice(-50);
    saveSettings();
    return "app";
}

function createWindow(url = baseUrl, bounds) {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        ...bounds,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: "#1e1e1e",
        // macOS keeps its window buttons inset; Windows draws its own over the top bar.
        ...(mac ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 12, y: 12 } } : { titleBarStyle: "hidden", titleBarOverlay: { color: "#1e1e1e", symbolColor: "#ffffff", height: 38 } }),
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            sandbox: true,
        },
    });
    // A window stays on the Nagma it opened (this laptop's, or a teammate's from a link).
    const home = originOf(url) ?? originOf(baseUrl);
    windows.add(win);
    const contentsId = win.webContents.id;
    win.on("closed", () => {
        windows.delete(win);
        fileMenus.delete(contentsId);
        buildMenu();
    });
    win.on("focus", () => buildMenu());
    // Full screen hides the window buttons, so the top bar stops leaving room for them.
    const sendFullScreen = () => win.webContents.send("nagma:full-screen", win.isFullScreen());
    win.on("enter-full-screen", sendFullScreen);
    win.on("leave-full-screen", sendFullScreen);
    win.once("ready-to-show", () => win.show());
    win.webContents.on("did-finish-load", () => {
        deliverFigs(win);
        win.webContents.setZoomFactor(settings.interfaceScale);
        menuCall(win, "presentTabs", settings.presentTabs);
        sendFullScreen();
    });
    // Links to other sites open in the browser; Nagma's own pages open in a new window.
    win.webContents.setWindowOpenHandler(({ url: target }) => {
        if (originOf(target) === home) {
            createWindow(target);
            return { action: "deny" };
        }
        if (/^https?:/.test(target)) void shell.openExternal(target);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, target) => {
        if (originOf(target) !== home) {
            event.preventDefault();
            if (/^https?:/.test(target)) void shell.openExternal(target);
        }
    });
    void win.loadURL(url);
    return win;
}

// Hands the waiting .fig files to a loaded window, which imports each as a new file.
function deliverFigs(win) {
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
    while (pendingFigs.length) {
        const file = pendingFigs.shift();
        try {
            void menuCall(win, "openFig", readOpenFile(fs, file));
        } catch (error) {
            dialog.showErrorBox("Nagma", `Couldn't open ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
function openFigs(files) {
    // Every kind of file Import… takes (only .fig, .deck, .buzz, .pptx and .pdf were let through:
    // a .sketch or a picture dropped on the Dock icon did nothing).
    pendingFigs.push(...openableFiles(files));
    if (!pendingFigs.length) return;
    const win = focused();
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
        deliverFigs(win);
    } else if (baseUrl) {
        // With every window closed (macOS keeps the app running), a window opens to take them;
        // they waited until one was opened by hand.
        createWindow();
    }
}
app.on("open-file", (event, file) => {
    event.preventDefault();
    openFigs([file]);
});

const focused = () => BrowserWindow.getFocusedWindow() ?? [...windows][0] ?? null;

// Runs one of the editor's menu actions (apps/web/src/engine/desktop.ts) and returns its answer.
function menuCall(win, action, arg) {
    if (!win || win.isDestroyed()) return Promise.resolve(undefined);
    return win.webContents.executeJavaScript(`(window.__nagmaMenu ?? window.${legacy.LEGACY.menu})?.(${JSON.stringify(action)}, ${JSON.stringify(arg ?? null)})`).catch(() => undefined);
}
const act = (action, arg) => (_item, win) => void menuCall(win ?? focused(), action, arg);

// Nagma > Server…: the editor's server picker (apps/web/src/components/server-picker.tsx), in the
// window in front, or a new one when none is open.
function openServerPicker(_item, win) {
    const target = win ?? focused();
    if (target) return void menuCall(target, "servers");
    if (!baseUrl) return;
    const fresh = createWindow();
    fresh.webContents.once("did-finish-load", () => void menuCall(fresh, "servers"));
}

// File > Open File URL From Clipboard: a Nagma link (a file, or a flow to present).
function openUrlFromClipboard() {
    const text = clipboard.readText().trim();
    const origin = originOf(text);
    if (!origin || !/^https?:/.test(text)) {
        dialog.showMessageBox({ type: "info", message: "There's no Nagma link on the clipboard.", detail: "Copy a file's link with Share > Copy link, then try again." });
        return;
    }
    void openLink(text);
}

// View > Interface Scale.
const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
function setScale(scale) {
    settings.interfaceScale = scale;
    saveSettings();
    for (const win of windows) win.webContents.setZoomFactor(scale);
    buildMenu();
}
function stepScale(dir) {
    const at = SCALES.findIndex((s) => s >= settings.interfaceScale - 1e-6);
    const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, (at < 0 ? 2 : at) + dir))];
    setScale(next);
}

// Nagma > Preferences > Show Nagma in Menu Bar.
function syncTray() {
    if (settings.showInMenuBar && !tray) {
        const icon = nativeImage.createFromPath(path.join(__dirname, "build", "trayTemplate.png"));
        icon.setTemplateImage(true);
        tray = new Tray(icon);
        tray.setToolTip("Nagma");
    }
    if (!settings.showInMenuBar && tray) {
        tray.destroy();
        tray = null;
    }
    if (!tray) return;
    // The notification feed: the newest few, each opening its file.
    const unread = notices.filter((n) => n.unread).length;
    if (mac) tray.setTitle(unread ? String(unread) : "");
    tray.setToolTip(unread ? `Nagma, ${unread} new notification${unread === 1 ? "" : "s"}` : "Nagma");
    const feed = notices.slice(0, 8).map((n) => ({
        label: `${n.unread ? "• " : ""}${n.title}`.slice(0, 80),
        sublabel: n.text?.slice(0, 80),
        click: () => void openLink(n.url),
    }));
    tray.setContextMenu(
        Menu.buildFromTemplate([
            ...(feed.length ? [{ label: "Notifications", enabled: false }, ...feed, { type: "separator" }] : [{ label: "No new notifications", enabled: false }, { type: "separator" }]),
            { label: "Open Nagma", click: () => (focused() ? focused().show() : createWindow()) },
            { label: "New Window", click: () => createWindow() },
            { type: "separator" },
            { label: "Quit Nagma", click: () => app.quit() },
        ]),
    );
}

// A Nagma link from anywhere: this laptop's own files open on its local address; others as they are.
async function openLink(url) {
    if (!url) return;
    let target = url;
    try {
        const u = new URL(url, baseUrl ?? "http://127.0.0.1");
        target = /^(127\.0\.0\.1|localhost)$/.test(u.hostname) && baseUrl ? `${baseUrl}${u.pathname}${u.search}${u.hash}` : u.toString();
    } catch {
        return;
    }
    // A file on another Nagma server opens in this app's editor, which offers to connect to that
    // server (guards.localFileLink): no need to trust the other server's pages.
    if (baseUrl) target = guards.localFileLink(target, baseUrl) ?? target;
    if ((await allowOrigin(target)) !== "app") return;
    const win = [...windows].find((w) => originOf(w.webContents.getURL()) === originOf(target));
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
        void win.loadURL(target);
    } else createWindow(target);
}

// nagma:// links (from a browser's "Open in the desktop app"): nagma://open?url=<a Nagma link>, or
// nagma://file/<id>?key=… for a file on this laptop.
function openProtocolUrl(raw) {
    const link = guards.protocolLink(raw);
    if (!link) return false;
    // Still starting: opened once the local server is up.
    if (!baseUrl) {
        pendingLinks.push(raw);
        return true;
    }
    if (link.kind === "url") void openLink(link.url);
    else if (link.kind === "file") void openLink(`${baseUrl}/?file=${link.id}${link.key ? `&key=${encodeURIComponent(link.key)}` : ""}`);
    else createWindow();
    return true;
}
app.on("open-url", (event, url) => {
    event.preventDefault();
    openProtocolUrl(url);
});
// nagma://, and the scheme from before the product's rename so links made then still open.
for (const scheme of legacy.SCHEMES) {
    if (process.defaultApp) app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1] ?? ".")]);
    else app.setAsDefaultProtocolClient(scheme);
}

// Preferences > Update Feed…: Nagma's releases on GitHub (the default), the address of a folder your
// team publishes builds to (taken from the clipboard), or no updates.
async function chooseUpdateFeed() {
    const current = updater.feedUrl(settings);
    const copied = clipboard.readText().trim();
    const usable = /^https?:\/\/\S+$/.test(copied) ? copied : null;
    const { response } = await dialog.showMessageBox({
        type: "question",
        buttons: [usable ? "Use Copied Address" : "Copy an Address First", "Use Nagma Releases", "Turn Off Updates", "Cancel"],
        defaultId: usable ? 0 : 3,
        cancelId: 3,
        message: "Update feed",
        detail: `${process.env.NAGMA_UPDATE_URL ? "Set by NAGMA_UPDATE_URL: " : "Now: "}${current || "none (updates are off)"}\n\nNagma updates from its releases on GitHub. To use builds your team publishes instead, copy the address of that folder, then choose Use Copied Address.${usable ? `\n\nCopied: ${usable}` : ""}`,
    });
    if (response === 0 && usable) Object.assign(settings, { updateUrl: usable, updatesOff: false });
    else if (response === 1) Object.assign(settings, { updateUrl: "", updatesOff: false });
    else if (response === 2) settings.updatesOff = true;
    else return;
    saveSettings();
    updater.setup(settings);
    buildMenu();
}

// Changes that haven't reached a server yet, across the open windows.
async function unsyncedChanges() {
    let total = 0;
    // A window that doesn't answer (busy, or stuck) doesn't hold up quitting.
    const answers = await Promise.all([...windows].map((win) => Promise.race([menuCall(win, "unsynced"), new Promise((r) => setTimeout(() => r(0), 2000))])));
    for (const n of answers) total += Number(n) || 0;
    return total;
}

function relaunch() {
    app.isQuitting = true;
    app.relaunch();
    app.quit();
}

async function saveDebugInfo() {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath("downloads"), "Nagma debug info.json") });
    if (canceled || !filePath) return;
    const info = {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        memory: { total: os.totalmem(), free: os.freemem() },
        server: baseUrl,
        hardwareAcceleration: !settings.disableHardwareAcceleration,
        gpu: app.getGPUFeatureStatus(),
        interfaceScale: settings.interfaceScale,
        windows: windows.size,
    };
    fs.writeFileSync(filePath, JSON.stringify(info, null, 2));
    shell.showItemInFolder(filePath);
}

async function resetAndRestart() {
    const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Reset and Restart", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: "Reset Nagma and restart?",
        detail: "This clears Nagma's cache and preferences. Your files are kept.",
    });
    if (response !== 0) return;
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ["cachestorage", "serviceworkers", "shadercache"] });
    settings = { interfaceScale: 1, presentTabs: false, showInMenuBar: false, disableHardwareAcceleration: false, keptWindows: null, updateUrl: settings.updateUrl ?? "", updatesOff: Boolean(settings.updatesOff), betaUpdates: Boolean(settings.betaUpdates), trustedOrigins: [] };
    saveSettings();
    relaunch();
}

// Quit and Keep Windows: the open windows come back at the next launch.
function quitKeepingWindows() {
    settings.keptWindows = [...windows].map((win) => ({ url: win.webContents.getURL(), bounds: win.getBounds() }));
    saveSettings();
    app.quit();
}

// A file menu item from the editor: runs the action there (with a text field focused, its shortcut
// goes to the field instead).
const fileItem = (entry) => menuItems.fileItem(entry, (win, id) => void menuCall(win ?? focused(), "run", id));
const fileSection = (items) => (items?.length ? [{ type: "separator" }, ...items.map(fileItem)] : []);

// "Check for Updates…", or where an update has got to.
function updateItem() {
    const u = updater.getState();
    if (u.status === "ready") return { label: `Restart to Update${u.version ? ` (${u.version})` : ""}`, click: () => updater.restartToUpdate() };
    if (u.status === "downloading") return { label: `Downloading Update… ${u.progress}%`, enabled: false };
    // An unsigned Mac build can't install updates itself (updater.cjs): the release page has the new one.
    if (u.status === "available") return { label: `Download Nagma ${u.version ?? ""}…`.replace(/ +…/, "…"), click: () => updater.openReleasePage() };
    if (u.status === "checking") return { label: "Checking for Updates…", enabled: false };
    return { label: "Check for Updates…", click: () => void updater.checkNow(settings) };
}

// The editor's Help items: the ones above Troubleshooting, and the ones above Log Out.
function helpParts(items) {
    const at = items.indexOf("-");
    return at < 0 ? [items, []] : [items.slice(0, at), items.slice(at + 1)];
}

function buildMenu() {
    const win = focused();
    const file = win ? fileMenus.get(win.webContents.id) : null;
    const editTail = file?.edit ?? [];
    const matching = editTail.findIndex((e) => e !== "-" && e.id === "selectMatching");
    const percent = `${Math.round(settings.interfaceScale * 100)}%`;
    const template = [
        {
            label: "Nagma",
            submenu: [
                { role: "about", label: "About Nagma" },
                updateItem(),
                { type: "separator" },
                {
                    label: "Preferences",
                    submenu: [
                        // The editor's preferences while a file is open, then the app's own.
                        ...(file?.prefs?.length ? [...file.prefs.map(fileItem), { type: "separator" }] : []),
                        {
                            label: "Show Nagma in Menu Bar",
                            type: "checkbox",
                            checked: settings.showInMenuBar,
                            click: (item) => {
                                settings.showInMenuBar = item.checked;
                                saveSettings();
                                syncTray();
                            },
                        },
                        // Electron has no trackpad haptics API; listed so the menu reads the same.
                        { label: "Enable Trackpad Haptic Feedback", type: "checkbox", checked: false, enabled: false },
                        { type: "separator" },
                        { label: "Update Feed…", click: () => void chooseUpdateFeed() },
                        {
                            label: "Get Beta Updates",
                            type: "checkbox",
                            checked: Boolean(settings.betaUpdates),
                            click: (item) => {
                                settings.betaUpdates = item.checked;
                                saveSettings();
                                updater.setup(settings);
                            },
                        },
                    ],
                },
                // Which Nagma server the windows use: this computer's own, or one run for a team.
                { label: "Server…", click: openServerPicker },
                ...(file ? [{ type: "separator" }, ...file.app.map(fileItem)] : []),
                { type: "separator" },
                ...(mac ? [{ role: "services" }, { type: "separator" }, { role: "hide", label: "Hide Nagma" }, { role: "hideOthers" }, { role: "unhide", label: "Show All" }, { type: "separator" }] : []),
                // On macOS a "quit" role gets the system's own "Quit and Keep Windows" alternate,
                // which showed beside this one; a plain item keeps the one that restores windows.
                ...(mac ? [{ label: "Quit Nagma", accelerator: "Cmd+Q", click: () => app.quit() }, { label: "Quit and Keep Windows", accelerator: "Alt+Cmd+Q", click: quitKeepingWindows }] : [{ role: "quit", label: "Quit Nagma" }]),
            ],
        },
        {
            label: "File",
            submenu: [
                { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => createWindow() },
                { label: "New Tab", accelerator: "CmdOrCtrl+T", click: act("newTab") },
                { label: "Open File Browser", accelerator: "CmdOrCtrl+O", click: act("openHome") },
                { label: "Open File URL From Clipboard", click: openUrlFromClipboard },
                { type: "separator" },
                { label: "Close Window", accelerator: "Shift+CmdOrCtrl+W", click: (_i, win) => (win ?? focused())?.close() },
                {
                    label: "Close Tab",
                    accelerator: "CmdOrCtrl+W",
                    click: async (_i, win) => {
                        const target = win ?? focused();
                        if ((await menuCall(target, "closeTab")) === false) target?.close();
                    },
                },
                { label: "Reopen Closed Tab", accelerator: "Shift+CmdOrCtrl+T", enabled: closedTabs.length > 0, click: act("reopenClosedTab") },
                {
                    label: "Recently Closed Tabs",
                    enabled: closedTabs.length > 0,
                    submenu: closedTabs.length ? closedTabs.map((t) => ({ label: t.name || "Untitled", click: act("reopenClosedTab", t.id) })) : [{ label: "No closed tabs", enabled: false }],
                },
                ...fileSection(file?.file),
            ],
        },
        {
            // macOS menu shortcuts take the key press before the page: Undo, Redo and Select All
            // ask the editor (a text field, else the canvas), and Cut, Copy and Paste run as the
            // usual editing commands, which the canvas answers through the copy, cut and paste events.
            label: "Edit",
            submenu: [
                { label: "Undo", accelerator: "CmdOrCtrl+Z", click: act("undo") },
                { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: act("redo") },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                ...(file ? editTail.slice(0, 1).map(fileItem) : []),
                { role: "paste" },
                ...(file ? editTail.slice(1, matching < 0 ? undefined : matching).map(fileItem) : []),
                { label: "Select All", accelerator: "CmdOrCtrl+A", click: act("selectAll") },
                ...(file && matching >= 0 ? editTail.slice(matching).map(fileItem) : []),
            ],
        },
        {
            label: "View",
            submenu: [
                ...(file ? [...file.view.map(fileItem), { type: "separator" }] : []),
                {
                    label: "Interface Scale",
                    submenu: [
                        { label: percent, enabled: false },
                        { type: "separator" },
                        { label: "Reset to Default", accelerator: "Alt+Shift+CmdOrCtrl+0", enabled: settings.interfaceScale !== 1, click: () => setScale(1) },
                        { label: "Make Larger", accelerator: "Alt+Shift+CmdOrCtrl+=", enabled: settings.interfaceScale < SCALES[SCALES.length - 1], click: () => stepScale(1) },
                        { label: "Make Smaller", accelerator: "Alt+Shift+CmdOrCtrl+-", enabled: settings.interfaceScale > SCALES[0], click: () => stepScale(-1) },
                    ],
                },
                { type: "separator" },
                { role: "togglefullscreen", label: "Toggle Full Screen" },
                {
                    label: "Always Show Tabs When Presenting",
                    type: "checkbox",
                    checked: settings.presentTabs,
                    click: (item) => {
                        settings.presentTabs = item.checked;
                        saveSettings();
                        for (const win of windows) void menuCall(win, "presentTabs", item.checked);
                    },
                },
            ],
        },
        ...(file
            ? [
                  ["Object", file.object],
                  ["Text", file.text],
                  ["Arrange", file.arrange],
                  ["Vector", file.vector],
                  ["Plugins", file.plugins],
                  ["Widgets", file.widgets],
              ].map(([label, items]) => ({ label, submenu: items.map(fileItem) }))
            : []),
        {
            role: "window",
            submenu: [
                { role: "minimize" },
                { role: "zoom" },
                { type: "separator" },
                { label: "Select Previous Tab", accelerator: "Ctrl+Shift+Tab", click: act("previousTab") },
                { label: "Select Next Tab", accelerator: "Ctrl+Tab", click: act("nextTab") },
                { type: "separator" },
                { role: "front" },
            ],
        },
        {
            role: "help",
            submenu: [
                ...(file ? [...helpParts(file.help)[0].map(fileItem), { type: "separator" }] : [{ label: "Get Started", click: act("gettingStarted") }, { type: "separator" }]),
                {
                    label: "Troubleshooting",
                    submenu: [
                        { label: "Toggle Web App Developer Tools", accelerator: "Alt+CmdOrCtrl+I", click: (_i, win) => (win ?? focused())?.webContents.toggleDevTools() },
                        { type: "separator" },
                        { label: "Save Debug Info…", click: () => void saveDebugInfo() },
                        { type: "separator" },
                        {
                            label: "Disable Hardware Acceleration",
                            type: "checkbox",
                            checked: settings.disableHardwareAcceleration,
                            click: async (item) => {
                                settings.disableHardwareAcceleration = item.checked;
                                saveSettings();
                                const { response } = await dialog.showMessageBox({ type: "info", buttons: ["Restart Now", "Later"], message: "Restart Nagma to apply this change." });
                                if (response === 0) relaunch();
                            },
                        },
                        { type: "separator" },
                        { label: "Reload All Tabs", click: () => windows.forEach((win) => win.webContents.reload()) },
                        { label: "Reset Nagma and Restart", click: () => void resetAndRestart() },
                    ],
                },
                {
                    label: "Legal Summary",
                    click: () =>
                        dialog.showMessageBox({
                            type: "info",
                            message: "Nagma",
                            detail: `Version ${app.getVersion()}\n\nBuilt with Electron ${process.versions.electron}, Chromium ${process.versions.chrome} and Node.js ${process.versions.node}, and other open source software under their own licenses.`,
                        }),
                },
                { type: "separator" },
                ...(file ? helpParts(file.help)[1].map(fileItem) : []),
                { label: "Log Out", click: act("logOut") },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Messages from the editor: only from Nagma's own pages, and checked for shape (guards.cjs).
ipcMain.on("nagma:file-menus", (event, menus) => {
    if (!fromTrusted(event)) return;
    const clean = guards.fileMenus(menus);
    if (clean) fileMenus.set(event.sender.id, clean);
    else fileMenus.delete(event.sender.id);
    if (focused()?.webContents.id === event.sender.id) buildMenu();
});
ipcMain.on("nagma:notifications", (event, list) => {
    if (!fromTrusted(event)) return;
    notices = guards.notices(list, event.senderFrame.url);
    syncTray();
});
// A notification from the editor, shown by the system; clicking it opens what it's about (on the
// same server as the page that sent it).
ipcMain.on("nagma:notify", (event, n) => {
    if (!fromTrusted(event) || !Notification.isSupported()) return;
    const clean = guards.notice(n, event.senderFrame.url);
    if (!clean) return;
    const note = new Notification({ title: clean.title, body: clean.text, silent: false });
    note.on("click", () => (clean.url ? void openLink(clean.url) : focused()?.show()));
    note.show();
});
// The clipboard's picture for a paste whose event carried no image data (PNG bytes, capped), only
// for Nagma's own pages, and only while a window of the app is focused (a paste just happened there).
ipcMain.handle("nagma:clipboard-image", (event) => {
    if (!fromTrusted(event) || !BrowserWindow.fromWebContents(event.sender)?.isFocused()) return null;
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const size = image.getSize();
    if (size.width * size.height > 100_000_000) return null;
    return guards.clipboardImage(image.toPNG());
});
ipcMain.on("nagma:closed-tabs", (event, tabs) => {
    if (!fromTrusted(event)) return;
    closedTabs = guards.closedTabs(tabs);
    buildMenu();
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
    openFigs(process.argv.slice(1));
    pendingLinks.push(...process.argv.filter(legacy.isAppLink));
    app.on("second-instance", (_event, argv) => {
        openFigs(argv.slice(1));
        // Windows and Linux hand nagma:// links to a second instance.
        for (const a of argv) if (legacy.isAppLink(a)) openProtocolUrl(a);
        const win = [...windows][0];
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
    app.whenReady().then(async () => {
        app.setAboutPanelOptions({ applicationName: "Nagma", applicationVersion: app.getVersion(), copyright: `© ${new Date().getFullYear()} Ashwath` });
        // Clipboard (paste from other design tools), installed fonts and the camera/mic the editor may ask for.
        // Only for pages on the Nagma servers this app trusts (an identity provider's sign-in page,
        // or anything else a window ends up on, gets none of them).
        const allowed = ["clipboard-read", "clipboard-sanitized-write", "local-fonts", "media", "fullscreen"];
        session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => callback(allowed.includes(permission) && isTrusted(details?.requestingUrl ?? wc?.getURL() ?? "")));
        session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => allowed.includes(permission) && isTrusted(requestingOrigin || wc?.getURL() || ""));
        buildMenu();
        syncTray();
        try {
            await startServer();
        } catch (error) {
            dialog.showErrorBox("Nagma", error instanceof Error ? error.message : String(error));
            app.quit();
            return;
        }
        // Windows kept by "Quit and Keep Windows" come back on this laptop's new address.
        const kept = settings.keptWindows;
        settings.keptWindows = null;
        saveSettings();
        if (kept?.length) {
            for (const k of kept) {
                let url = baseUrl;
                try {
                    const u = new URL(k.url);
                    url = /^(127\.0\.0\.1|localhost)$/.test(u.hostname) ? `${baseUrl}${u.pathname}${u.search}${u.hash}` : isTrusted(k.url) ? k.url : baseUrl;
                } catch {
                    // Fall back to Home.
                }
                createWindow(url, k.bounds);
            }
        } else createWindow();
        app.on("activate", () => {
            if (!windows.size) createWindow();
        });
        for (const link of pendingLinks.splice(0)) openProtocolUrl(link);
        updater.start(settings, () => buildMenu());
    });
}

// Quitting with changes that haven't reached a server yet asks first (they'd wait in this window's
// storage until the file opens again).
let quitChecked = false;
app.on("before-quit", (event) => {
    if (!quitChecked && !app.isQuitting && windows.size) {
        event.preventDefault();
        void unsyncedChanges().then(async (count) => {
            if (count > 0) {
                const { response } = await dialog.showMessageBox({
                    type: "warning",
                    buttons: ["Keep Working", "Quit Anyway"],
                    defaultId: 0,
                    cancelId: 0,
                    message: `${count} change${count === 1 ? " hasn't" : "s haven't"} synced yet.`,
                    detail: "Nagma can't reach the server for some of your files. If you quit now, the changes stay in this computer's storage and sync the next time you open the file.",
                });
                if (response === 0) return;
            }
            quitChecked = true;
            app.quit();
        });
        return;
    }
    app.isQuitting = true;
    if (server) server.kill();
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
