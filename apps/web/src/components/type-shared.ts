import { useSyncExternalStore } from "react";
import { BUNDLED, familyMeta, fontStatus, fontsVersion, subscribeFonts } from "../engine/fonts";

// Constants and hooks shared by the type controls.

export const FIELD = "h-6 min-w-0 rounded-md border border-transparent bg-field px-1 text-ink outline-none hover:border-panel-border focus:border-brand-500";

export const WEIGHTS: [number, string][] = [
    [100, "Thin"],
    [200, "Extra Light"],
    [300, "Light"],
    [400, "Regular"],
    [500, "Medium"],
    [600, "Semi Bold"],
    [700, "Bold"],
    [800, "Extra Bold"],
    [900, "Black"],
];

export const SIZE_PRESETS = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64, 72, 96];

export function styleLabel(weight: number, italic: boolean): string {
    const named = WEIGHTS.find(([w]) => w === weight)?.[1] ?? String(weight);
    if (!italic) return named;
    return weight === 400 ? "Italic" : `${named} Italic`;
}

// A font's named style: its weight and italic flag with the name the font gives it.
export interface FontStyle {
    weight: number;
    italic: boolean;
    label: string;
}

const styleCache = new Map<string, FontStyle[] | null>();
const styleListeners = new Set<() => void>();
let stylesVersion = 0;

function noteStyles(family: string, styles: FontStyle[] | null) {
    styleCache.set(family, styles);
    stylesVersion++;
    for (const l of styleListeners) l();
}

function dedupe(list: FontStyle[]): FontStyle[] {
    const seen = new Set<string>();
    return list
        .filter((s) => {
            const key = `${s.weight}${s.italic ? "i" : ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
}

// The styles a font really has: the bundled faces, the faces the browser has loaded for the family
// (from Google Fonts' CSS), the family's metadata, or the fonts installed on this computer when
// the page may read them. Null until known (callers fall back to the weight table).
export function familyStyles(family: string): FontStyle[] | null {
    const cached = styleCache.get(family);
    if (cached !== undefined) return cached;
    const bundled = BUNDLED[family];
    if (bundled) {
        const styles = dedupe(bundled.map(([, weight, italic]) => ({ weight, italic, label: styleLabel(weight, italic) })));
        styleCache.set(family, styles);
        return styles;
    }
    styleCache.set(family, null);
    void (async () => {
        // Variable fonts offer every weight in their range.
        const meta = await familyMeta(family);
        const wght = meta?.axes.find((a) => a.tag === "wght");
        if (wght) {
            const italic = meta?.files.some((f) => f.style === "italic") ?? false;
            const weights = WEIGHTS.filter(([w]) => w >= wght.min && w <= wght.max).map(([w]) => w);
            return noteStyles(family, dedupe(weights.flatMap((w) => [{ weight: w, italic: false, label: styleLabel(w, false) }, ...(italic ? [{ weight: w, italic: true, label: styleLabel(w, true) }] : [])])));
        }
        if (meta?.files.length) return noteStyles(family, dedupe(meta.files.map((f) => ({ weight: f.weight, italic: f.style === "italic", label: styleLabel(f.weight, f.style === "italic") }))));
        // Faces the browser holds for the family (loaded web fonts).
        if (typeof document !== "undefined" && document.fonts) {
            const faces: FontStyle[] = [];
            document.fonts.forEach((face) => {
                if (face.family.replace(/^"|"$/g, "") !== family) return;
                const weight = parseInt(face.weight, 10);
                if (!Number.isFinite(weight)) return;
                faces.push({ weight, italic: face.style === "italic" || face.style === "oblique", label: styleLabel(weight, face.style === "italic" || face.style === "oblique") });
            });
            if (faces.length) return noteStyles(family, dedupe(faces));
        }
        // Installed locally: the real style names, when the page already has permission to read them.
        const local = await localStyles(family);
        if (local) return noteStyles(family, local);
        noteStyles(family, null);
    })();
    return null;
}

async function localStyles(family: string): Promise<FontStyle[] | null> {
    const query = (globalThis as { queryLocalFonts?: () => Promise<{ family: string; style: string }[]> }).queryLocalFonts;
    if (!query || fontStatus(family) !== "ready") return null;
    try {
        const permissions = (navigator as Navigator & { permissions?: { query(d: { name: string }): Promise<{ state: string }> } }).permissions;
        const state = permissions ? await permissions.query({ name: "local-fonts" }).then((p) => p.state).catch(() => "prompt") : "prompt";
        if (state !== "granted") return null;
        const fonts = (await query()).filter((f) => f.family === family);
        if (!fonts.length) return null;
        return dedupe(
            fonts.map((f) => {
                const italic = /italic|oblique/i.test(f.style);
                const plain = f.style.replace(/\s*(italic|oblique)\s*/i, "").trim();
                const weight = WEIGHTS.find(([, name]) => name.replace(/ /g, "").toLowerCase() === plain.replace(/ /g, "").toLowerCase())?.[0] ?? (/^\d{3}$/.test(plain) ? Number(plain) : 400);
                return { weight, italic, label: f.style };
            }),
        );
    } catch {
        return null;
    }
}

// Re-renders when a family's style list arrives.
export function useFamilyStyles(family: string | null): FontStyle[] | null {
    useSyncExternalStore((l) => {
        styleListeners.add(l);
        return () => styleListeners.delete(l);
    }, () => stylesVersion);
    return family ? familyStyles(family) : null;
}

// Re-renders when fonts finish loading or turn out to be missing.
export function useFonts() {
    return useSyncExternalStore(subscribeFonts, fontsVersion);
}

