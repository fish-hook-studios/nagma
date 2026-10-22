import type { Capture } from "./capture-format";
import { isGenericFamily } from "./capture-import";
import { BUNDLED, DEFAULT_FAMILY, markFontsInstalled } from "./fonts";

// The page's own fonts from a capture (its @font-face files, read by Nagma Capture), installed so the
// captured text is set in them instead of a stand-in.
//
// Licences: a site's fonts are licensed to that site. They stay on this device: kept in this
// browser's own store (not the media store, which syncs to the server), never uploaded, shared,
// published with a site or put in a local copy. A file opened on another device shows the family's
// stand-in there, and the family's name stays on the layers so the font can be added properly.

export interface CapturedFace {
    // The SHA-256 of the file, so the same file is kept once.
    id: string;
    family: string;
    // As in the @font-face rule ("400", "700 800", "italic").
    weight: string;
    style: string;
    // Where it came from (the page's origin), shown nowhere but kept for knowing.
    origin: string;
}

const DB_NAME = "nagma-captured-fonts";
const STORE = "faces";
// Without IndexedDB (tests): kept for this session only.
const memory = new Map<string, { face: CapturedFace; blob: Blob }>();

function openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function put(face: CapturedFace, blob: Blob): Promise<void> {
    memory.set(face.id, { face, blob });
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ face, blob }, face.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
    db.close();
}

async function all(): Promise<{ face: CapturedFace; blob: Blob }[]> {
    const db = await openDb();
    if (!db) return [...memory.values()];
    const rows = await new Promise<{ face: CapturedFace; blob: Blob }[]>((resolve) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as { face: CapturedFace; blob: Blob }[]) ?? []);
        req.onerror = () => resolve([]);
    });
    db.close();
    return rows;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
    if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // A plain hash where there's no subtle crypto.
    let h = 2166136261;
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i++) h = Math.imul(h ^ (view[i] as number), 16777619);
    return `f${(h >>> 0).toString(16)}${view.length}`;
}

function bytesOf(dataUrl: string): ArrayBuffer | null {
    const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(dataUrl);
    if (!m) return null;
    try {
        if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2] as string)).buffer as ArrayBuffer;
        const bin = atob(m[2] as string);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out.buffer;
    } catch {
        return null;
    }
}

const registered = new Set<string>();

// One face into the document's fonts, so the canvas (and exports drawn from it) can use it.
async function register(face: CapturedFace, data: ArrayBuffer): Promise<boolean> {
    if (registered.has(face.id)) return true;
    if (typeof FontFace === "undefined" || typeof document === "undefined") {
        registered.add(face.id);
        return true;
    }
    try {
        const ff = new FontFace(face.family, data, { weight: face.weight || "400", style: face.style || "normal" });
        await ff.load();
        document.fonts.add(ff);
        registered.add(face.id);
        return true;
    } catch {
        // A file the browser can't use (a format it doesn't read, a damaged file).
        return false;
    }
}

// Families Nagma loads by itself never need the page's copy.
function needsInstall(family: string): boolean {
    return !isGenericFamily(family) && family !== DEFAULT_FAMILY && !BUNDLED[family];
}

// The capture's font files, kept on this device and installed. Answers the families now usable.
export async function installCaptureFonts(capture: Capture): Promise<string[]> {
    const families = new Set<string>();
    let origin = "";
    try {
        origin = new URL(capture.url).origin;
    } catch {
        origin = "";
    }
    for (const font of capture.fonts ?? []) {
        if (!needsInstall(font.family)) continue;
        for (const f of font.faces ?? []) {
            const data = f.asset ? capture.assets?.[f.asset]?.data : null;
            const bytes = data ? bytesOf(data) : null;
            if (!bytes || !bytes.byteLength) continue;
            const face: CapturedFace = { id: await sha256(bytes), family: font.family, weight: f.weight || "400", style: f.style || "normal", origin };
            if (!(await register(face, bytes))) continue;
            await put(face, new Blob([bytes], { type: f.format ? `font/${f.format === "truetype" ? "ttf" : f.format === "opentype" ? "otf" : f.format}` : "font/woff2" }));
            families.add(font.family);
        }
    }
    if (families.size) markFontsInstalled([...families]);
    return [...families];
}

// Every font kept from captures on this device, installed (when the app starts).
export async function registerCapturedFonts(): Promise<string[]> {
    const families = new Set<string>();
    for (const { face, blob } of await all()) {
        if (await register(face, await blob.arrayBuffer())) families.add(face.family);
    }
    if (families.size) markFontsInstalled([...families]);
    return [...families];
}

// The faces kept on this device (for tests and a future fonts list).
export async function capturedFaces(): Promise<CapturedFace[]> {
    return (await all()).map((r) => r.face);
}
