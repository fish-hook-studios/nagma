import { diffCaptures, changesPage, latestCaptureFrame, normalizeUrl } from "./capture-diff";
import { chooseCaptureOpen } from "./capture-dialog";
import { NotACapture, parseCapture, type Capture, type CaptureNode } from "./capture-format";
import { CAPTURE_AT, captureToDocument, isGenericFamily, pageWidths, standInFamily } from "./capture-import";
import { loadFont } from "./fonts";
import { isMediaRef, storeImage } from "./image-store";
import { editor } from "./store";
import type { Command, NagmaDocument } from "./types";

// Opening a page capture (Nagma Capture, apps/browser-extension) as a new Design file in Drafts:
// handed over by the extension as a window message, or opened as a .nagma-capture.json file from
// Import… and Home. The page's fonts are loaded first (a family Nagma can't find falls back to
// Inter), and its pictures go to the media store.

export { CAPTURE_EXTENSION, isCaptureFile } from "./capture-format";

function familiesIn(capture: Capture): string[] {
    const out = new Set<string>();
    const visit = (n: CaptureNode) => {
        if (n.text) {
            out.add(n.text.style.family);
            for (const r of n.text.runs) if (r.style.family) out.add(r.style.family);
        }
        n.children.forEach(visit);
        for (const look of [n.states?.hover, n.states?.active, n.states?.focus]) if (look) visit(look);
    };
    visit(capture.root);
    for (const b of capture.breakpoints ?? []) visit(b.root);
    return [...out];
}

const within = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

// Which captured families Nagma can draw: the page's own when it loads (Google Fonts, bundled, or
// installed here), else a close stand-in, else none (Inter is used).
async function availableFamilies(capture: Capture): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    // Still loading after a while counts as there; it draws once it arrives.
    const usable = async (family: string) => (await within(loadFont(family), 6000, "ready" as const)) !== "missing";
    await Promise.all(
        familiesIn(capture).map(async (family) => {
            const stand = standInFamily(family);
            if (!isGenericFamily(family) && (await usable(family))) out.set(family, family);
            else if (stand !== family && (await usable(stand))) out.set(family, stand);
            else out.set(family, null);
        }),
    );
    return out;
}

// How a capture opens: its widths as frames side by side or as a site (asked when there are
// several and nothing says), or compared with the file an earlier capture of the page opened as
// (asked when there is one).
export interface OpenChoice {
    layout?: "frames" | "site";
    // A file id to compare with, or null for a new file whatever there is.
    compare?: string | null;
}

// Which file each page's last capture opened as, on this device (the file itself keeps the address
// on its page frame, capture:url).
const FILES_KEY = "nagma.captureFiles";

function captureFiles(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(FILES_KEY) ?? "{}") as Record<string, string>;
    } catch {
        return {};
    }
}

function rememberCaptureFile(url: string, fileId: string) {
    if (!url) return;
    try {
        localStorage.setItem(FILES_KEY, JSON.stringify({ ...captureFiles(), [normalizeUrl(url)]: fileId }));
    } catch {
        // Storage full or off: the next capture opens as a new file.
    }
}

// The Design file a capture of this address opened as before, if it's still there.
export async function captureFileFor(url: string): Promise<{ id: string; name: string } | null> {
    const id = url ? captureFiles()[normalizeUrl(url)] : undefined;
    if (!id) return null;
    const { fileMeta } = await import("./files");
    const meta = fileMeta(id);
    return meta && !meta.trashed && meta.kind === "design" ? { id, name: meta.name } : null;
}

function widthsText(capture: Capture): string {
    const ws = pageWidths(capture).map((w) => String(w.width));
    return ws.length > 1 ? `${ws.slice(0, -1).join(", ")} and ${ws[ws.length - 1]}` : (ws[0] ?? "");
}

export async function openCapture(input: unknown, choice: OpenChoice = {}): Promise<{ id: string; name: string } | null> {
    const capture = parseCapture(input);
    const title = capture.title?.trim() || "this page";
    let layout = choice.layout;
    const earlier = choice.compare === undefined ? await captureFileFor(capture.url) : null;
    let compareWith = choice.compare ?? null;
    if ((!layout && capture.breakpoints?.length) || earlier) {
        const several = Boolean(capture.breakpoints?.length);
        const options = [
            ...(several
                ? [
                      { id: "frames", label: "Frames side by side", hint: "A Design file with a frame for each width" },
                      { id: "site", label: "Open as a site", hint: "A Sites page with a breakpoint for each width" },
                  ]
                : [{ id: "frames", label: "Open as a new file" }]),
            ...(earlier ? [{ id: "compare", label: `Compare with ${earlier.name}`, hint: "A new page in that file showing what changed" }] : []),
        ];
        const hint = several ? `Captured at ${widthsText(capture)} pixels wide.` : "This page was captured before.";
        const picked = await chooseCaptureOpen(`Open ${title}`, earlier && several ? `${hint} It was captured before too.` : hint, options);
        if (!picked) return null;
        if (picked === "compare" && earlier) compareWith = earlier.id;
        else layout = picked as OpenChoice["layout"];
    }
    if (compareWith) {
        const compared = await compareCapture(capture, compareWith);
        if (compared) return compared;
    }
    // The page's own font files first, so its families count as there.
    const { installCaptureFonts } = await import("./capture-fonts");
    const installed = await installCaptureFonts(capture).catch(() => [] as string[]);
    const fonts = await availableFamilies(capture);
    const fontFor = (f: string) => (fonts.has(f) ? (fonts.get(f) ?? null) : standInFamily(f));
    let doc: NagmaDocument;
    let select: string;
    let substituted: string[];
    let missingImages: number;
    if (layout === "site") {
        const { captureToSite } = await import("./capture-site");
        const made = captureToSite(capture, { fontFor });
        doc = made.doc;
        select = made.frameIds[0] as string;
        substituted = made.substituted;
        missingImages = made.missingImages;
    } else {
        const made = captureToDocument(capture, { fontFor });
        doc = made.doc;
        select = made.frameId;
        substituted = made.substituted;
        missingImages = made.missingImages;
    }
    const images = await storeImages(doc);
    const { createFile, openFile } = await import("./files");
    const meta = createFile(layout === "site" ? "site" : "design", { ...doc, images }, doc.name);
    if (layout !== "site") rememberCaptureFile(capture.url, meta.id);
    await openFile(meta.id);
    await new Promise((r) => setTimeout(r, 50));
    if (layout === "site") {
        const page = doc.nodes[select]?.parentId;
        if (page && editor.get().doc.nodes[page]) editor.setPage(page);
    }
    editor.set({ selection: [select] });
    const { zoomToFit } = await import("./camera");
    zoomToFit();
    if (installed.length) editor.refreshText();
    const notes = [installed.length ? `${installed.join(", ")} installed on this device from the page` : "", substituted.length ? `${substituted.join(", ")} shown in Inter` : "", missingImages ? `${missingImages} picture${missingImages === 1 ? "" : "s"} couldn't be read` : ""].filter(Boolean);
    editor.notify(`Captured ${doc.name}.${notes.length ? ` ${notes.join("; ")}.` : ""}`);
    return { id: meta.id, name: doc.name };
}

// Pictures into the media store; the document keeps references.
async function storeImages(doc: NagmaDocument): Promise<Record<string, string>> {
    const images: Record<string, string> = {};
    const { blobFromDataUrl } = await import("./local-copy");
    for (const [id, data] of Object.entries(doc.images)) {
        const blob = !isMediaRef(data) && data.startsWith("data:") ? blobFromDataUrl(data, "image/png") : null;
        images[id] = blob ? await storeImage(blob).catch(() => data) : data;
    }
    return images;
}

// A capture compared with the file an earlier one opened as: a new page there, "Changes <date>",
// with the new capture, its changed layers outlined and a list of the changes. Null when that file
// holds no capture of the page any more (the caller opens a new file instead).
export async function compareCapture(capture: Capture, fileId: string): Promise<{ id: string; name: string } | null> {
    const { installCaptureFonts } = await import("./capture-fonts");
    const installed = await installCaptureFonts(capture).catch(() => [] as string[]);
    const fonts = await availableFamilies(capture);
    const fontFor = (f: string) => (fonts.has(f) ? (fonts.get(f) ?? null) : standInFamily(f));
    // The width it was captured at (others aren't compared).
    const made = captureToDocument({ ...capture, breakpoints: undefined }, { fontFor });
    const images = await storeImages(made.doc);
    const { fileMeta, openFile } = await import("./files");
    const meta = fileMeta(fileId);
    if (!meta || !(await openFile(fileId))) return null;
    await new Promise((r) => setTimeout(r, 50));
    const doc = editor.get().doc;
    const old = latestCaptureFrame(doc, capture.url);
    if (!old) return null;
    const changes = diffCaptures(doc.nodes, old.id, made.doc.nodes, made.frameId);
    const { page, nodes } = changesPage({ ...made.doc, images }, made.frameId, changes, new Date(), old.pluginData?.[CAPTURE_AT]);
    const commands: Command[] = [
        ...Object.entries(images).map(([id, data]): Command => ({ type: "image.add", id, data })),
        ...nodes.map((node): Command => ({ type: "node.create", node: { ...node, children: [] } })),
    ];
    editor.execute({ type: "batch", commands });
    editor.setPage(page.id);
    editor.set({ selection: [made.frameId] });
    const { zoomToFit } = await import("./camera");
    zoomToFit();
    if (installed.length) editor.refreshText();
    rememberCaptureFile(capture.url, fileId);
    editor.notify(changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} since the last capture of ${capture.title || "this page"}.` : `No changes since the last capture of ${capture.title || "this page"}.`);
    return { id: fileId, name: meta.name };
}

// A .nagma-capture.json file from Import… or a drop on Home.
export async function importCaptureFile(file: File): Promise<void> {
    try {
        await openCapture(await file.text());
    } catch (error) {
        editor.notify(`Couldn't open ${file.name}: ${error instanceof NotACapture || error instanceof Error ? error.message : String(error)}`);
    }
}

// The extension's hand-over: it says hello until the app answers that it's listening, then posts
// the capture to this window. Only messages from this window and origin count (the extension's
// script runs in the page; other frames and sites can't reach here).
let listening = false;
const seen = new Set<string>();

export function listenForCaptures() {
    if (listening || typeof window === "undefined") return;
    listening = true;
    // Fonts kept from earlier captures on this device.
    void import("./capture-fonts")
        .then(({ registerCapturedFonts }) => registerCapturedFonts())
        .then((families) => families.length && editor.refreshText())
        .catch(() => undefined);
    window.addEventListener("message", (event: MessageEvent) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data as { type?: string; capture?: unknown } | null;
        if (data?.type === "nagma-capture-hello") {
            window.postMessage({ type: "nagma-capture-ready" }, location.origin);
            return;
        }
        if (data?.type !== "nagma-capture") return;
        window.postMessage({ type: "nagma-capture-received" }, location.origin);
        const c = data.capture as Partial<Capture> | undefined;
        const key = `${c?.url ?? ""}|${c?.capturedAt ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (location.hash === "#capture") history.replaceState(null, "", `${location.pathname}${location.search}`);
        openCapture(data.capture).catch((error: unknown) => editor.notify(`Couldn't open the capture: ${error instanceof Error ? error.message : String(error)}`));
    });
}
