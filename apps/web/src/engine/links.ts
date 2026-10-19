import { fitRect, startPresenting } from "./camera";
import { collab, lanAddress, onLinkOpened, privateHost, publicAddress } from "./collab";
import { setMode } from "./modes";
import { devView, openFocus } from "./dev-view";
import { selectionBounds } from "./nodes";
import { pageOf } from "./page";
import { startScreen } from "./prototype";
import { editor } from "./store";
import { refuseExport } from "./share-settings";
import { isLocalOnlyLink, remoteLinkBase, shareableUrl, withServer } from "./servers";

// Share links: the file, a frame inside it, the file in Inspect, the prototype, and an embed.
// Opening one lands on what it points at.

export type LinkKind = "file" | "selection" | "dev" | "prototype" | "focus";


// `local`: a link for a tool on this computer (the Inspect panel's prompt): the server's public
// address when it has one, otherwise this computer's own address (localhost), never the machine's
// network address.
export function fileLink(kind: LinkKind = "file", options: { embed?: boolean; local?: boolean } = {}): string {
    const s = collab.get();
    let url = new URL(location.origin + location.pathname);
    const pub = options.local ? publicAddress() : null;
    // On a server other than This computer, its own address (engine/servers.ts).
    if (remoteLinkBase()) url = shareableUrl();
    else if (pub) url = new URL(`${pub}/`);
    else if (options.local) {
        if (privateHost(url.hostname)) url.hostname = "localhost";
    } else {
        // On localhost, the network address, so links work from other devices.
        const lan = lanAddress();
        if (lan) url.hostname = lan;
    }
    if (s.fileId) url.searchParams.set("file", s.fileId);
    // Only invited people: the link carries no key; people open it signed in.
    const link = s.access?.link ?? "none";
    const key = link === "none" ? null : link === "view" ? s.keys?.view : s.keys?.edit;
    if (key) url.searchParams.set("key", key);
    const e = editor.get();
    const target = targetFrame();
    if (kind === "selection" && target) url.searchParams.set("node-id", target);
    if (kind === "dev") {
        url.searchParams.set("mode", "dev");
        if (target) url.searchParams.set("node-id", target);
    }
    if (kind === "focus") {
        const v = devView.get();
        url.searchParams.set("mode", "dev");
        if (v?.kind === "focus") url.searchParams.set("focus", v.id);
        else if (target) url.searchParams.set("focus", target);
    }
    if (kind === "prototype") {
        const start = startScreen(e.doc, e.selection);
        if (start) url.searchParams.set("present", start);
    }
    if (options.embed) url.searchParams.set("embed", "1");
    return withServer(url).toString();
}

// The layer a deep link points at: the selection (or the page when nothing is selected).
function targetFrame(): string | null {
    const e = editor.get();
    return e.selection[0] ?? null;
}

export function embedCode(kind: LinkKind = "file"): string {
    return `<iframe style="border: 1px solid rgba(0, 0, 0, 0.1);" width="800" height="450" src="${fileLink(kind, { embed: true })}" allowfullscreen></iframe>`;
}

// A file only on this device has no address another browser (or this one, at the network address
// links use) can open: a link copied from it would land on some other file.
export function linkUnavailable(): boolean {
    if (collab.get().fileId) return false;
    editor.notify("This file is only on this device. Share it to get a link that opens it.");
    return true;
}

// A link that only opens on this computer or its network (localhost, a private address) isn't
// handed out as if it worked anywhere: copying one needs `allowLocal`, the share menu's "Copy local
// link (same network only)".
export const LOCAL_LINK_REFUSED = "This link only works on this computer's network. Share through Nagma for a link that works anywhere, or copy a local link from the Share menu.";

export async function copyLink(kind: LinkKind, { allowLocal = false }: { allowLocal?: boolean } = {}) {
    if (refuseExport() || linkUnavailable()) return;
    const labels: Record<LinkKind, string> = { file: "Link copied.", selection: "Link to selection copied.", dev: "Inspect link copied.", prototype: "Prototype link copied.", focus: "Link to focus view copied." };
    const link = fileLink(kind);
    const local = isLocalOnlyLink(link);
    if (local && !allowLocal) {
        editor.notify(LOCAL_LINK_REFUSED);
        return;
    }
    try {
        await navigator.clipboard.writeText(link);
        editor.notify(local ? `${labels[kind].replace(/\.$/, "")} (same network only).` : labels[kind]);
    } catch {
        editor.notify("The browser didn't allow copying.");
    }
}

// Landing from a link: select and frame a layer, switch to Inspect, present, or embed.
onLinkOpened((params) => {
    const s = editor.get();
    const nodeId = params.get("node-id");
    const node = nodeId ? s.doc.nodes[nodeId] : undefined;
    if (node) {
        const page = node.type === "page" ? node.id : pageOf(s.doc, node);
        if (page && page !== s.pageId) editor.setPage(page);
        if (node.type !== "page") {
            editor.set({ selection: [node.id] });
            const box = selectionBounds(editor.get().doc, [node.id]);
            if (box) setTimeout(() => fitRect(box, 80, 4), 50);
        }
    }
    if (params.get("mode") === "dev") setMode("dev");
    const focus = params.get("focus");
    if (focus && s.doc.nodes[focus]) openFocus(focus, "list");
    if (params.get("embed") === "1") editor.set({ uiHidden: true });
    const present = params.get("present");
    if (present && s.doc.nodes[present]) startPresenting(present);
});

// "Can view prototypes": the file opens straight into the prototype player, and stays there.
collab.subscribe(() => {
    const c = collab.get();
    if (c.status !== "live" || c.role !== "prototype") return;
    const e = editor.get();
    if (e.presentingId) return;
    const start = startScreen(e.doc, []);
    if (start) setTimeout(() => editor.get().presentingId || startPresenting(start), 0);
});
editor.subscribe(() => {
    const c = collab.get();
    if (c.status !== "live" || c.role !== "prototype" || editor.get().presentingId) return;
    const start = startScreen(editor.get().doc, []);
    if (start) setTimeout(() => editor.get().presentingId || startPresenting(start), 0);
});
