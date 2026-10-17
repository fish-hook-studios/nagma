// Pages beyond the basics: dividers, reordering, links to a page, and moving layers between pages.
import { rehome } from "./actions";
import { applyCommand } from "./commands";
import { linkUnavailable } from "./links";
import { topLevel } from "./nodes";
import { editor } from "./store";
import type { Command, NagmaDocument, SceneNode } from "./types";

// The reference's page divider: an empty page whose name starts with a dash. It draws as a line in the
// pages list, can't be opened and can't hold layers. A page with content never becomes one.
export function isDivider(node: SceneNode | undefined): boolean {
    return Boolean(node && node.type === "page" && node.children.length === 0 && node.name.trimStart().startsWith("-"));
}

// Pages that can be opened or receive layers (dividers left out).
export function realPages(doc: NagmaDocument): string[] {
    return doc.roots.filter((id) => !isDivider(doc.nodes[id]) && !doc.nodes[id]?.internal);
}

// Moves a page to a new place in the list (an index into the list without it).
export function reorderPage(id: string, index: number) {
    const { doc } = editor.get();
    const from = doc.roots.indexOf(id);
    if (from < 0) return;
    const without = doc.roots.filter((r) => r !== id);
    const at = Math.max(0, Math.min(index, without.length));
    if (at === from) return;
    editor.execute({ type: "node.reparent", id, parentId: null, index: at });
}

const PAGE_PARAM = "page";

// A link that opens this file on the page: the file's own address plus the page.
export function pageLink(pageId: string): string {
    const url = new URL(location.href);
    url.searchParams.set(PAGE_PARAM, pageId);
    return url.toString();
}

export function copyPageLink(pageId: string) {
    if (linkUnavailable()) return;
    const link = pageLink(pageId);
    const name = editor.get().doc.nodes[pageId]?.name ?? "page";
    void navigator.clipboard
        ?.writeText(link)
        .then(() => editor.notify(`Link to "${name}" copied.`))
        .catch(() => editor.notify("Couldn't copy the link. Check the browser's clipboard permission."));
}

// Opening a page link: once the file is loaded, show the linked page and tidy the address.
export function openLinkedPage(doc: NagmaDocument) {
    const url = new URL(location.href);
    const id = url.searchParams.get(PAGE_PARAM);
    if (!id || !doc.nodes[id] || doc.nodes[id]?.type !== "page") return;
    url.searchParams.delete(PAGE_PARAM);
    history.replaceState(null, "", url);
    if (!isDivider(doc.nodes[id])) editor.setPage(id);
}

// Move to page: the selected layers go to another page at the same coordinates.
export function moveToPage(pageId: string) {
    const { doc, selection } = editor.get();
    const target = doc.nodes[pageId];
    if (!target || target.type !== "page" || isDivider(target)) return;
    const ids = topLevel(doc, selection).filter((id) => doc.nodes[id] && doc.nodes[id]?.type !== "page");
    if (!ids.length) return;
    if (ids.some((id) => doc.nodes[id]?.sourceId)) {
        editor.notify("Layers inside an instance can't move to another page. Move the whole instance.");
        return;
    }
    let working = doc;
    const commands: Command[] = [];
    for (const id of ids) {
        const step = rehome(working, id, pageId);
        commands.push(...step);
        working = applyCommand(working, { type: "batch", commands: step });
    }
    editor.execute({ type: "batch", commands });
    editor.set({ selection: [] });
    editor.notify(`Moved ${ids.length === 1 ? `"${doc.nodes[ids[0] ?? ""]?.name}"` : `${ids.length} layers`} to "${target.name}".`, {
        label: "Go to page",
        run: () => {
            editor.setPage(pageId);
            editor.set({ selection: ids.filter((id) => editor.get().doc.nodes[id]) });
        },
    });
}

// Pages the selection can move to.
export function moveTargets(doc: NagmaDocument, currentPageId: string): SceneNode[] {
    return realPages(doc)
        .filter((id) => id !== currentPageId)
        .map((id) => doc.nodes[id])
        .filter((n): n is SceneNode => Boolean(n));
}
