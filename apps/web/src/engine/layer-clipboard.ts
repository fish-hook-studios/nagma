import { placeCopies, viewCenter } from "./actions";
import { copiedImageUrls, loadPendingImages, pastedImageId, type PendingImage } from "./clipboard-images";
import { decodeFig, figToDocument } from "./fig-import";
import { CLIPBOARD_BUFFER_PATTERN, CLIPBOARD_MARKERS } from "./interop-format";
import { makeNode, selectionBounds } from "./nodes";
import { editor } from "./store";
import type { Command, NagmaDocument, SceneNode } from "./types";

// Pasting layers copied in another design tool. Its clipboard's HTML carries them as a base64
// buffer between markers (interop-format.ts) in the same format as a .fig file's canvas, next to a
// JSON note between markers of its own. The buffer is read with the .fig importer, so pasted layers keep
// their fills, strokes, effects, text, auto layout, variables and styles, and instances stay linked
// to their components (which come along onto the file's internal page). Images aren't in the buffer,
// only their hashes; the note lists a short-lived download link per hash. The layers are placed at
// once with their image fills pointing at ids made from the hashes (drawn as placeholders), and the
// images are fetched and filled in as they arrive (clipboard-images.ts).

export function copiedLayersBuffer(html: string): Uint8Array | null {
    const m = CLIPBOARD_BUFFER_PATTERN.exec(html);
    if (!m?.[1]) return null;
    try {
        const raw = atob(m[1].replace(/\s+/g, ""));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}

export function hasCopiedLayers(html: string): boolean {
    return html.includes(CLIPBOARD_MARKERS.buffer.open);
}

// The copied layers as a document of their own: their page and, if any, the internal page holding
// the components their instances use. `hashes` lists the images their fills need.
async function importedClipboardDoc(html: string): Promise<{ doc: NagmaDocument; roots: string[]; skipped: string[]; hashes: string[]; thumbnails: Map<string, string> } | null> {
    const bytes = copiedLayersBuffer(html);
    if (!bytes) return null;
    const { message, blobs } = decodeFig(bytes);
    const hashes = new Set<string>();
    const { doc, skipped } = await figToDocument(message, blobs, new Map(), "Pasted layers", "design", {
        pendingImage: (hash) => {
            hashes.add(hash);
            return pastedImageId(hash);
        },
    });
    const roots: string[] = [];
    for (const pageId of doc.roots) {
        const page = doc.nodes[pageId];
        if (!page || page.internal) continue;
        roots.push(...page.children);
    }
    return { doc, roots, skipped, hashes: [...hashes], thumbnails: imageThumbnails(message) };
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// Each image paint's image hash → its smaller preview's hash, a fallback when the image itself can't be fetched.
function imageThumbnails(message: unknown): Map<string, string> {
    const out = new Map<string, string>();
    const seen = new Set<object>();
    const walk = (v: unknown, depth: number) => {
        if (!v || typeof v !== "object" || v instanceof Uint8Array || seen.has(v) || depth > 40) return;
        seen.add(v);
        if (Array.isArray(v)) {
            for (const x of v) walk(x, depth + 1);
            return;
        }
        const o = v as Record<string, unknown>;
        const image = (o.image as { hash?: unknown } | undefined)?.hash;
        const thumb = (o.imageThumbnail as { hash?: unknown } | undefined)?.hash;
        if (image instanceof Uint8Array && thumb instanceof Uint8Array) out.set(toHex(image), toHex(thumb));
        for (const x of Object.values(o)) walk(x, depth + 1);
    };
    walk((message as { nodeChanges?: unknown }).nodeChanges, 0);
    return out;
}

// Every component the given layers use (directly or through nested instances), with their sets.
function componentsUsed(doc: NagmaDocument, roots: string[]): string[] {
    const out = new Set<string>();
    const queue = [...roots];
    const seen = new Set<string>();
    while (queue.length) {
        const id = queue.pop() as string;
        if (seen.has(id)) continue;
        seen.add(id);
        const node = doc.nodes[id];
        if (!node) continue;
        if (node.componentId && doc.nodes[node.componentId]) {
            // A variant brings its whole set, so swapping variants keeps working.
            const comp = doc.nodes[node.componentId] as SceneNode;
            const set = comp.parentId ? doc.nodes[comp.parentId] : undefined;
            const top = set?.type === "componentSet" ? set : comp;
            if (!out.has(top.id)) {
                out.add(top.id);
                queue.push(top.id);
            }
        }
        queue.push(...node.children);
    }
    return [...out];
}

function subtree(doc: NagmaDocument, id: string): SceneNode[] {
    const out: SceneNode[] = [];
    const walk = (nid: string) => {
        const n = doc.nodes[nid];
        if (!n) return;
        out.push(n);
        n.children.forEach(walk);
    };
    walk(id);
    return out;
}

// ⌘V with copied design layers on the clipboard: places them at the middle of the view (or into the selected frame).
export async function pasteCopiedLayers(html: string): Promise<boolean> {
    let parsed: Awaited<ReturnType<typeof importedClipboardDoc>>;
    try {
        parsed = await importedClipboardDoc(html);
    } catch (error) {
        editor.notify(`Couldn't read the copied layers: ${error instanceof Error ? error.message : String(error)}`);
        return true;
    }
    if (!parsed || !parsed.roots.length) return false;
    const { doc: source, roots } = parsed;
    const { doc, selection } = editor.get();

    // Components the pasted instances use go onto this file's internal page once (same ids), so
    // the instances stay linked.
    const commands: Command[] = [];
    const comps = componentsUsed(source, roots).filter((id) => !doc.nodes[id]);
    if (comps.length) {
        let pageId = doc.roots.find((id) => doc.nodes[id]?.internal) ?? null;
        if (!pageId) {
            const page = makeNode(doc, "page", { x: 0, y: 0, w: 1, h: 1 }, null, { name: "Internal Only Canvas", internal: true, libraries: [] });
            commands.push({ type: "node.create", node: page });
            pageId = page.id;
        }
        for (const id of comps) {
            for (const node of subtree(source, id)) {
                commands.push({ type: "node.create", node: { ...node, parentId: node.id === id ? pageId : node.parentId, children: [] } });
            }
        }
    }
    // Styles and variables those layers use come along too.
    const styles = source.styles;
    const mergedStyles = styles
        ? {
              colors: [...(doc.styles?.colors ?? []), ...styles.colors.filter((s) => !doc.styles?.colors.some((x) => x.id === s.id))],
              texts: [...(doc.styles?.texts ?? []), ...styles.texts.filter((s) => !doc.styles?.texts.some((x) => x.id === s.id))],
              effects: [...(doc.styles?.effects ?? []), ...(styles.effects ?? []).filter((s) => !(doc.styles?.effects ?? []).some((x) => x.id === s.id))],
              ...(doc.styles?.grids ? { grids: doc.styles.grids } : {}),
          }
        : null;
    if (mergedStyles) commands.push({ type: "styles.set", styles: mergedStyles });
    const newCollections = (source.variables ?? []).filter((c) => !(doc.variables ?? []).some((x) => x.id === c.id));
    if (newCollections.length) commands.push({ type: "variables.set", variables: [...(doc.variables ?? []), ...newCollections] });
    if (commands.length) editor.execute({ type: "batch", commands });

    // Centre the pasted layers in the view (or keep their place inside the selected frame).
    const target = selection.length === 1 ? editor.get().doc.nodes[selection[0] ?? ""] : undefined;
    const intoFrame = target && (target.type === "frame" || target.type === "component") ? target.id : null;
    const bounds = selectionBounds(source, roots);
    if (bounds) {
        const centre = intoFrame && target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : viewCenter();
        const dx = centre.x - (bounds.x + bounds.w / 2);
        const dy = centre.y - (bounds.y + bounds.h / 2);
        const moved: NagmaDocument = { ...source, nodes: { ...source.nodes } };
        for (const id of roots) for (const node of subtree(source, id)) moved.nodes[node.id] = { ...node, x: node.x + dx, y: node.y + dy };
        placeCopies(moved, roots, intoFrame, true);
    } else placeCopies(source, roots, intoFrame, true);
    void fillPastedImages(parsed.hashes, parsed.thumbnails, copiedImageUrls(html));
    return true;
}

const LOAD_FAILED = "Some images couldn't be loaded. Copy the layers again and paste within a few minutes.";

// Fetches the images the pasted layers need (those the document doesn't have yet) and fills them in.
async function fillPastedImages(hashes: string[], thumbnails: Map<string, string>, urls: Record<string, string>, quiet = false) {
    const { images } = editor.get().doc;
    const pending: PendingImage[] = hashes
        .filter((hash) => !images[pastedImageId(hash)])
        .map((hash) => {
            const thumb = thumbnails.get(hash);
            return { id: pastedImageId(hash), hash, urls: [urls[hash], thumb ? urls[thumb] : undefined].filter((u): u is string => Boolean(u)) };
        });
    if (!pending.length) {
        if (!quiet) editor.notify("Pasted.");
        return;
    }
    if (!quiet) editor.notify(pending.length > 1 ? `Pasted. Fetching ${pending.length} images…` : "Pasted. Fetching images…");
    const { failed } = await loadPendingImages(pending, (done, total) => {
        if (total > 3 && done < total) editor.notify(`Fetching images… ${done} of ${total}`);
    });
    if (!failed.length) {
        editor.notify(pending.length > 1 ? "Images loaded." : "Image loaded.");
        return;
    }
    editor.notify(LOAD_FAILED, { label: "Retry loading images", run: () => void retryPastedImages(failed) });
}

// Tries again with the links on the clipboard now (the layers copied again), then the earlier links.
export async function retryPastedImages(failed: PendingImage[]) {
    let fresh: Record<string, string> = {};
    try {
        for (const item of await navigator.clipboard.read()) {
            if (!item.types.includes("text/html")) continue;
            fresh = { ...fresh, ...copiedImageUrls(await (await item.getType("text/html")).text()) };
        }
    } catch {
        // No clipboard access: the earlier links are tried again.
    }
    const again = failed.filter((item) => !editor.get().doc.images[item.id]).map((item) => ({ ...item, urls: [...(fresh[item.hash] ? [fresh[item.hash] as string] : []), ...item.urls] }));
    if (!again.length) return;
    editor.notify("Fetching images…");
    const { failed: still } = await loadPendingImages(again);
    if (still.length) editor.notify(LOAD_FAILED, { label: "Retry loading images", run: () => void retryPastedImages(still) });
    else editor.notify(again.length > 1 ? "Images loaded." : "Image loaded.");
}

// The look of the first copied design layer, for Paste properties.
export async function copiedLayerProperties(html: string): Promise<SceneNode | null> {
    try {
        const parsed = await importedClipboardDoc(html);
        const id = parsed?.roots[0];
        // An image fill among the properties gets its image like a paste does.
        if (parsed?.hashes.length) void fillPastedImages(parsed.hashes, parsed.thumbnails, copiedImageUrls(html), true);
        return id ? (parsed?.doc.nodes[id] ?? null) : null;
    } catch {
        return null;
    }
}
