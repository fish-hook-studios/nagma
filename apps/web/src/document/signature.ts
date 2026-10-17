import { type Signature, docView, edit, me, rectJson, run } from "./state";
import { userStorage } from "../engine/user-storage";

// Signatures for Fill & Sign: one drawn, typed or uploaded, remembered in this browser so it can
// be placed again, and placed with a click on the page.

const KEY = "nagma.docSignature.v1";

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

export function rememberedSignature(): Signature | null {
    try {
        const raw = userStorage.getItem(KEY);
        if (!raw) return null;
        const v = JSON.parse(raw) as Signature & { data?: string };
        if (v.kind === "image") return { kind: "image", name: v.name, aspect: v.aspect, bytes: fromBase64(v.data ?? "") };
        return v;
    } catch {
        return null;
    }
}

export function chooseSignature(sig: Signature) {
    docView.set({ signature: sig, dialog: null, tool: "sign" });
    try {
        userStorage.setItem(KEY, JSON.stringify(sig.kind === "image" ? { kind: "image", name: sig.name, aspect: sig.aspect, data: toBase64(sig.bytes) } : sig));
    } catch {
        // Placing still works; it just isn't remembered.
    }
}

export function forgetSignature() {
    try {
        userStorage.removeItem(KEY);
    } catch {
        // Nothing stored.
    }
    docView.set({ signature: null });
}

// Puts the chosen signature on `page`, centred on `at` (view space).
export function placeSignature(page: number, at: [number, number]) {
    const sig = docView.get().signature ?? rememberedSignature();
    if (!sig) {
        docView.set({ dialog: "signature" });
        return;
    }
    const width = 160;
    if (sig.kind === "type") {
        edit({ op: "annotate", page, kind: "typedSignature", at: [at[0] - width / 2, at[1]], text: sig.text, height: 30, author: me() }, { tool: "select" });
        return;
    }
    const height = width / Math.max(0.2, sig.aspect);
    const x0 = at[0] - width / 2;
    const y0 = at[1] - height / 2;
    if (sig.kind === "draw") {
        const strokes = sig.strokes.map((s) => s.map(([x, y]) => [x0 + x * width, y0 + y * height]));
        edit({ op: "annotate", page, kind: "signature", strokes, author: me(), color: [0.05, 0.1, 0.35], width: 1.6 }, { tool: "select" });
        return;
    }
    run((w) => w.addPicture(page, rectJson([x0, y0, x0 + width, y0 + height]), sig.name || "Signature", sig.bytes, me()), { tool: "select" });
}
