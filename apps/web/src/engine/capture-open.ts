import { NotACapture, parseCapture, type Capture, type CaptureNode } from "./capture-format";
import { captureToDocument, isGenericFamily, standInFamily } from "./capture-import";
import { loadFont } from "./fonts";
import { isMediaRef, storeImage } from "./image-store";
import { editor } from "./store";

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
    };
    visit(capture.root);
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

export async function openCapture(input: unknown): Promise<{ id: string; name: string }> {
    const capture = parseCapture(input);
    const fonts = await availableFamilies(capture);
    const made = captureToDocument(capture, { fontFor: (f) => (fonts.has(f) ? (fonts.get(f) ?? null) : standInFamily(f)) });
    const doc = made.doc;
    // Pictures into the media store; the document keeps references.
    const images: Record<string, string> = {};
    const { blobFromDataUrl } = await import("./local-copy");
    for (const [id, data] of Object.entries(doc.images)) {
        const blob = !isMediaRef(data) && data.startsWith("data:") ? blobFromDataUrl(data, "image/png") : null;
        images[id] = blob ? await storeImage(blob).catch(() => data) : data;
    }
    const { createFile, openFile } = await import("./files");
    const meta = createFile("design", { ...doc, images }, doc.name);
    await openFile(meta.id);
    await new Promise((r) => setTimeout(r, 50));
    editor.set({ selection: [made.frameId] });
    const { zoomToFit } = await import("./camera");
    zoomToFit();
    const notes = [made.substituted.length ? `${made.substituted.join(", ")} shown in Inter` : "", made.missingImages ? `${made.missingImages} picture${made.missingImages === 1 ? "" : "s"} couldn't be read` : ""].filter(Boolean);
    editor.notify(`Captured ${doc.name}.${notes.length ? ` ${notes.join("; ")}.` : ""}`);
    return { id: meta.id, name: doc.name };
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
