// Tells the editor it's running in the desktop app (it leaves room for the window buttons and lets
// the top bar drag the window), and keeps the menu bar current: the file's menus and the recently closed tabs.
const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
    platform: process.platform,
    fileMenus: (menus) => ipcRenderer.send("nagma:file-menus", menus ?? null),
    notifications: (list) => ipcRenderer.send("nagma:notifications", Array.isArray(list) ? list.slice(0, 20).map((n) => ({ title: String(n.title).slice(0, 120), text: String(n.text ?? "").slice(0, 200), url: String(n.url ?? ""), unread: Boolean(n.unread) })) : []),
    onFullScreen: (listener) => ipcRenderer.on("nagma:full-screen", (_event, on) => listener(Boolean(on))),
    // One new notification, shown by the system (the app's own, not the browser's).
    notify: (n) => ipcRenderer.send("nagma:notify", n && typeof n === "object" ? { title: String(n.title ?? "").slice(0, 120), text: String(n.text ?? "").slice(0, 200), url: String(n.url ?? "") } : null),
    // The picture on the system clipboard as PNG bytes (or null), for a paste that carried none.
    readClipboardImage: () => ipcRenderer.invoke("nagma:clipboard-image"),
    closedTabs: (tabs) => ipcRenderer.send("nagma:closed-tabs", Array.isArray(tabs) ? tabs.slice(0, 10).map((t) => ({ id: String(t.id), name: String(t.name) })) : []),
};
contextBridge.exposeInMainWorld("nagmaDesktop", bridge);
// Pages from a server that hasn't been updated since the product's rename look for the old name.
// (A sandboxed preload can't load legacy.cjs, so the name is spelled out here.)
contextBridge.exposeInMainWorld("migfaDesktop", bridge); // legacy-name
