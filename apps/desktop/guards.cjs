// What the main process accepts from the outside: menus, notifications and closed tabs a page sends
// over IPC, nagma:// links, and what it hands back (the clipboard's picture). Pages can be anything a window loaded, so nothing here trusts its
// input: wrong shapes are dropped instead of reaching Menu.buildFromTemplate or Notification, where
// they threw in the main process. Kept free of Electron so it can be tested with plain Node.

const { SCHEMES } = require("./legacy.cjs");

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// Accelerators the menu can show: modifiers and one key, nothing else.
const ACCELERATOR = /^((CmdOrCtrl|CommandOrControl|Cmd|Command|Ctrl|Control|Alt|Option|AltGr|Shift|Super|Meta)\+){0,4}(F[1-9]|F1[0-9]|F2[0-4]|[!-~]|Plus|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc)$/;

// One menu entry from the editor ("-" for a separator, a submenu, or an action by id).
function menuEntry(e, depth = 0) {
    if (e === "-") return "-";
    if (!e || typeof e !== "object") return null;
    if (typeof e.sub === "string") {
        if (depth >= 3 || !Array.isArray(e.items)) return null;
        return { sub: e.sub.slice(0, 80), items: menuList(e.items, depth + 1) };
    }
    const id = str(e.id, 80);
    const label = str(e.label, 120);
    if (!id || !label) return null;
    const out = { id, label, enabled: e.enabled !== false };
    if (typeof e.accelerator === "string" && ACCELERATOR.test(e.accelerator)) out.accelerator = e.accelerator;
    if (out.accelerator && e.hint === true) out.hint = true;
    if (typeof e.checked === "boolean") out.checked = e.checked;
    return out;
}
const menuList = (list, depth = 0) => (Array.isArray(list) ? list.slice(0, 120).map((e) => menuEntry(e, depth)).filter(Boolean) : []);

const SECTIONS = ["app", "prefs", "file", "edit", "view", "object", "text", "arrange", "vector", "plugins", "widgets", "help"];

// The open file's menus, every section a list (missing ones empty), or null for none.
function fileMenus(menus) {
    if (!menus || typeof menus !== "object" || Array.isArray(menus)) return null;
    return Object.fromEntries(SECTIONS.map((k) => [k, menuList(menus[k])]));
}

// A notification's link, kept to the page's own server (a relative path resolves against it).
function sameOriginUrl(url, pageUrl) {
    try {
        const page = new URL(pageUrl);
        const u = new URL(String(url ?? ""), page);
        return u.origin === page.origin && /^https?:$/.test(u.protocol) ? u.toString() : "";
    } catch {
        return "";
    }
}

function notice(n, pageUrl) {
    if (!n || typeof n !== "object") return null;
    const title = str(n.title, 120);
    if (!title) return null;
    return { title, text: str(n.text, 200), url: n.url ? sameOriginUrl(n.url, pageUrl) : "", unread: Boolean(n.unread) };
}
const notices = (list, pageUrl) => (Array.isArray(list) ? list.slice(0, 20).map((n) => notice(n, pageUrl)).filter(Boolean) : []);

const closedTabs = (tabs) => (Array.isArray(tabs) ? tabs.slice(0, 10).filter((t) => t && typeof t === "object" && typeof t.id === "string" && t.id).map((t) => ({ id: t.id.slice(0, 80), name: str(t.name, 120) })) : []);

// A nagma:// link: { kind: "url", url } (nagma://open?url=<http(s) link>), { kind: "file", id, key }
// (nagma://file/<id>?key=…), { kind: "home" } for anything else that's still nagma://, or null.
function protocolLink(raw) {
    let u;
    try {
        u = new URL(String(raw));
    } catch {
        return null;
    }
    // nagma://, or the scheme from before the product's rename (legacy.cjs).
    if (!SCHEMES.some((s) => u.protocol === `${s}:`)) return null;
    const wrapped = u.searchParams.get("url");
    if (wrapped) {
        try {
            const w = new URL(wrapped);
            if ((w.protocol === "http:" || w.protocol === "https:") && !w.username && !w.password) return { kind: "url", url: w.toString() };
        } catch {
            // Not a link: Home.
        }
        return { kind: "home" };
    }
    if (u.hostname === "file" && /^\/[A-Za-z0-9_-]{6,64}$/.test(u.pathname)) {
        const key = u.searchParams.get("key");
        return { kind: "file", id: u.pathname.slice(1), key: key && /^[A-Za-z0-9_~-]{1,200}$/.test(key) ? key : null };
    }
    return { kind: "home" };
}

// A link to a file (…?file=<id>) on another Nagma server, as the same link opened in this app's own
// editor with ?server=<that server's origin>: the editor offers to connect to it
// (apps/web/src/engine/servers.ts). Null for links to this app's server, and for anything else.
function localFileLink(url, baseUrl) {
    try {
        const u = new URL(String(url));
        const base = new URL(String(baseUrl));
        if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.origin === base.origin) return null;
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(u.searchParams.get("file") ?? "")) return null;
        const out = new URL("/", base);
        for (const [k, v] of u.searchParams) out.searchParams.append(k, v);
        if (!out.searchParams.get("server")) out.searchParams.set("server", u.origin);
        out.hash = u.hash;
        return out.toString();
    } catch {
        return null;
    }
}

// The picture on the system clipboard as PNG bytes for the editor's paste (a paste event that
// carried no image data): PNG only, at most 50 MB, else null.
const MAX_CLIPBOARD_IMAGE = 50 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function clipboardImage(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length <= PNG_SIGNATURE.length || bytes.length > MAX_CLIPBOARD_IMAGE) return null;
    if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

module.exports = { fileMenus, notices, notice, closedTabs, protocolLink, sameOriginUrl, localFileLink, clipboardImage, MAX_CLIPBOARD_IMAGE };
