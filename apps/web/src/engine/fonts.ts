// Font loading for text layers: Google Fonts (and the families bundled with Nagma) by name, with a
// status per family so missing fonts can be reported and replaced, alias faces that carry OpenType
// features and variable axis values for the canvas, and the font files themselves for outlines.

export const DEFAULT_FAMILY = "Inter";

// Fonts shipped with Nagma (public/fonts, OFL): the exact files DesignCraft sets type with, so
// imported layouts measure the same. Each face is [file, weight, italic].
export const BUNDLED: Record<string, [string, number, boolean][]> = {
    "Source Serif 4": [
        ["SourceSerif4-Regular.ttf", 400, false],
        ["SourceSerif4-It.ttf", 400, true],
        ["SourceSerif4-Semibold.ttf", 600, false],
        ["SourceSerif4-Bold.ttf", 700, false],
        ["SourceSerif4-BoldIt.ttf", 700, true],
    ],
    "Source Sans 3": [
        ["SourceSans3-Regular.ttf", 400, false],
        ["SourceSans3-It.ttf", 400, true],
        ["SourceSans3-Semibold.ttf", 600, false],
        ["SourceSans3-Bold.ttf", 700, false],
    ],
};

export type FontStatus = "loading" | "ready" | "missing";

const status = new Map<string, FontStatus>();
const waiting = new Map<string, (() => void)[]>();
const listeners = new Set<() => void>();
const metricListeners = new Set<() => void>();
let version = 0;
let metricsTimer: ReturnType<typeof setTimeout> | null = null;

// `metrics`: glyphs changed (a font or alias face loaded, or turned out missing), so text must be
// measured again. Several loads close together are reported once.
function changed(metrics = true) {
    version++;
    for (const listener of listeners) listener();
    if (!metrics || metricsTimer) return;
    metricsTimer = setTimeout(() => {
        metricsTimer = null;
        for (const listener of metricListeners) listener();
    }, 30);
}

// Any font news (loaded, missing, axes known): for panels.
export function subscribeFonts(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Only when text needs measuring again.
export function subscribeFontMetrics(listener: () => void) {
    metricListeners.add(listener);
    return () => metricListeners.delete(listener);
}

export function fontsVersion() {
    return version;
}

export function fontStatus(family: string): FontStatus | undefined {
    if (family === DEFAULT_FAMILY) return "ready";
    return status.get(family);
}

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined" && typeof document.createElement === "function" && typeof FontFace !== "undefined";

const base = () => {
    try {
        return import.meta.env.BASE_URL ?? "/";
    } catch {
        return "/";
    }
};

export function googleCssUrl(family: string): string {
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`;
}

// Whether a family is installed on this computer: text set in it measures differently from the
// generic fallbacks.
export function installedLocally(family: string): boolean {
    if (!isBrowser()) return false;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return false;
    const sample = "mmmmmmmmmlliWW@#0123";
    return ["monospace", "serif", "sans-serif"].some((generic) => {
        ctx.font = `72px ${generic}`;
        const fallback = ctx.measureText(sample).width;
        ctx.font = `72px "${family}", ${generic}`;
        return ctx.measureText(sample).width !== fallback;
    });
}

function settle(family: string, next: FontStatus) {
    status.set(family, next);
    const callbacks = waiting.get(family) ?? [];
    waiting.delete(family);
    changed();
    for (const callback of callbacks) callback();
}

// Loads a font the first time it's used (bundled, else from Google Fonts); calls back once it's
// ready (or known to be missing) so text can be re-measured.
export function ensureFont(family: string, onReady: () => void) {
    if (family === DEFAULT_FAMILY || !isBrowser()) return;
    const known = status.get(family);
    if (known) {
        if (known === "loading") waiting.set(family, [...(waiting.get(family) ?? []), onReady]);
        return;
    }
    status.set(family, "loading");
    waiting.set(family, [onReady]);
    const faces = BUNDLED[family];
    if (faces) {
        const loads = faces.map(([file, weight, italic]) => {
            const face = new FontFace(family, `url(${base()}fonts/${file})`, { weight: String(weight), style: italic ? "italic" : "normal" });
            document.fonts.add(face);
            return face.load();
        });
        void Promise.allSettled(loads).then(() => settle(family, "ready"));
        return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = googleCssUrl(family);
    link.onload = () => {
        void Promise.all([400, 700].map((w) => document.fonts.load(`${w} 16px "${family}"`)))
            .catch(() => undefined)
            .then(() => settle(family, "ready"));
    };
    // Not on Google Fonts: fine if it's installed here, missing otherwise.
    link.onerror = () => {
        link.remove();
        settle(family, installedLocally(family) ? "ready" : "missing");
    };
    document.head.appendChild(link);
}

// Families whose faces were added to the document's fonts by hand (a captured page's own fonts,
// engine/capture-fonts.ts): ready, and text set in them is measured again.
export function markFontsInstalled(families: string[]) {
    for (const family of families) settle(family, "ready");
}

// Starts loading a family and resolves when it's settled.
export function loadFont(family: string): Promise<FontStatus> {
    if (family === DEFAULT_FAMILY) return Promise.resolve("ready");
    const known = status.get(family);
    if (known && known !== "loading") return Promise.resolve(known);
    return new Promise((resolve) => ensureFont(family, () => resolve(status.get(family) ?? "missing")));
}

// Family metadata from the Google Fonts repository: variable axes and the font files.
export interface FamilyMeta {
    url: string;
    axes: { tag: string; min: number; max: number }[];
    files: { filename: string; style: string; weight: number }[];
}

const metaCache = new Map<string, Promise<FamilyMeta | null>>();
const REPO = "https://raw.githubusercontent.com/google/fonts/main";

export function familyMeta(family: string): Promise<FamilyMeta | null> {
    let cached = metaCache.get(family);
    if (cached) return cached;
    cached = (async () => {
        if (BUNDLED[family] || typeof fetch === "undefined") return null;
        const dir = family.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const license of ["ofl", "apache", "ufl"]) {
            try {
                const res = await fetch(`${REPO}/${license}/${dir}/METADATA.pb`);
                if (!res.ok) continue;
                const text = await res.text();
                const files = [...text.matchAll(/fonts\s*\{([^}]*)\}/g)].map((m) => {
                    const body = m[1] ?? "";
                    return {
                        filename: /filename:\s*"([^"]+)"/.exec(body)?.[1] ?? "",
                        style: /style:\s*"([^"]+)"/.exec(body)?.[1] ?? "normal",
                        weight: Number(/weight:\s*(\d+)/.exec(body)?.[1] ?? 400),
                    };
                });
                const axes = [...text.matchAll(/axes\s*\{([^}]*)\}/g)].map((m) => {
                    const body = m[1] ?? "";
                    return { tag: /tag:\s*"([^"]+)"/.exec(body)?.[1] ?? "", min: Number(/min_value:\s*([\d.-]+)/.exec(body)?.[1] ?? 0), max: Number(/max_value:\s*([\d.-]+)/.exec(body)?.[1] ?? 0) };
                });
                return { url: `${REPO}/${license}/${dir}`, axes: axes.filter((a) => a.tag), files: files.filter((f) => f.filename) };
            } catch {
                // Offline or blocked: no metadata.
            }
        }
        return null;
    })();
    metaCache.set(family, cached);
    return cached;
}

// Axes known so far (synchronously), loading them in the background.
const axesKnown = new Map<string, FamilyMeta["axes"]>();
export function familyAxes(family: string): FamilyMeta["axes"] | undefined {
    const known = axesKnown.get(family);
    if (known) return known;
    if (family === DEFAULT_FAMILY && !metaCache.has(family)) {
        // Inter is variable in weight and optical size.
        axesKnown.set(family, [
            { tag: "opsz", min: 14, max: 32 },
            { tag: "wght", min: 100, max: 900 },
        ]);
        return axesKnown.get(family);
    }
    void familyMeta(family).then((meta) => {
        if (axesKnown.has(family)) return;
        axesKnown.set(family, meta?.axes ?? []);
        changed(false);
    });
    return undefined;
}

// Google's CSS API wants axes in order: lower-case tags alphabetically, then upper-case ones.
function axisOrder(a: string, b: string) {
    const ua = a === a.toUpperCase();
    const ub = b === b.toUpperCase();
    if (ua !== ub) return ua ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
}

async function variableCssUrl(family: string): Promise<string | null> {
    const meta = await familyMeta(family);
    if (!meta?.axes.length) return null;
    const axes = [...meta.axes].sort((a, b) => axisOrder(a.tag, b.tag));
    const italic = meta.files.some((f) => f.style === "italic");
    const ranges = axes.map((a) => `${a.min}..${a.max}`).join(",");
    const tags = axes.map((a) => a.tag).join(",");
    const query = italic ? `ital,${tags}@0,${ranges};1,${ranges}` : `${tags}@${ranges}`;
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${query}&display=swap`;
}

interface FaceSource {
    src: string;
    weight: string;
    style: string;
    unicodeRange?: string;
    stretch?: string;
}

const sourceCache = new Map<string, Promise<FaceSource[]>>();

// The @font-face rules a family is served with (variable ones when the family has axes).
function faceSources(family: string): Promise<FaceSource[]> {
    let cached = sourceCache.get(family);
    if (cached) return cached;
    cached = (async () => {
        const bundled = BUNDLED[family];
        if (bundled) return bundled.map(([file, weight, italic]) => ({ src: `url(${base()}fonts/${file})`, weight: String(weight), style: italic ? "italic" : "normal" }));
        const urls = [await variableCssUrl(family), googleCssUrl(family)].filter((u): u is string => Boolean(u));
        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (!res.ok) continue;
                const css = await res.text();
                return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
                    const body = m[1] ?? "";
                    return {
                        src: /src:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "",
                        weight: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "400",
                        style: /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "normal",
                        unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim(),
                        stretch: /font-stretch:\s*([^;]+);/.exec(body)?.[1]?.trim(),
                    };
                });
            } catch {
                // Try the next form of the request.
            }
        }
        // Installed locally (or missing): the alias points at the local font.
        return [
            { src: `local("${family}")`, weight: "100 900", style: "normal" },
            { src: `local("${family} Italic")`, weight: "100 900", style: "italic" },
        ];
    })();
    sourceCache.set(family, cached);
    return cached;
}

// Default-on features that only count when switched off, and the rest that count when on.
const DEFAULT_ON = new Set(["liga", "clig", "calt", "kern"]);

export function featureSettings(features: Record<string, boolean> | undefined): string {
    if (!features) return "";
    return Object.entries(features)
        .filter(([tag, on]) => (DEFAULT_ON.has(tag) ? !on : on))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([tag, on]) => `"${tag}" ${on ? 1 : 0}`)
        .join(", ");
}

export function variationSettings(axes: Record<string, number> | undefined): string {
    if (!axes) return "";
    return Object.entries(axes)
        .filter(([, v]) => Number.isFinite(v))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([tag, v]) => `"${tag}" ${Math.round(v * 100) / 100}`)
        .join(", ");
}

const aliases = new Map<string, string>();
const aliasState = new Map<string, "loading" | "ready">();

// The family name to draw with: the family itself, or an alias registered with the OpenType
// features and axis values switched on (the canvas has no per-call feature settings).
export function renderFamily(family: string, features?: Record<string, boolean>, axes?: Record<string, number>, onReady?: () => void): string {
    const feat = featureSettings(features);
    // Weight on a variable font is set through the weight itself (any value works).
    const vars = variationSettings(axes ? Object.fromEntries(Object.entries(axes).filter(([t]) => t !== "wght")) : undefined);
    if (!feat && !vars) return family;
    const key = `${family}|${feat}|${vars}`;
    let alias = aliases.get(key);
    if (!alias) {
        alias = `${family} __${(aliases.size + 1).toString(36)}`;
        aliases.set(key, alias);
    }
    if (!aliasState.has(key) && isBrowser()) {
        aliasState.set(key, "loading");
        const name = alias;
        void faceSources(family).then(async (sources) => {
            const faces = sources.map((s) => {
                const descriptors: FontFaceDescriptors = { weight: s.weight, style: s.style };
                if (s.unicodeRange) descriptors.unicodeRange = s.unicodeRange;
                if (s.stretch) descriptors.stretch = s.stretch;
                if (feat) descriptors.featureSettings = feat;
                if (vars) (descriptors as FontFaceDescriptors & { variationSettings?: string }).variationSettings = vars;
                const face = new FontFace(name, s.src, descriptors);
                document.fonts.add(face);
                return face;
            });
            await Promise.allSettled(faces.map((f) => f.load()));
            aliasState.set(key, "ready");
            changed();
            onReady?.();
        });
    }
    return aliasState.get(key) === "ready" ? alias : family;
}

// The font file itself (TrueType or CFF), for turning text into outlines.
const binaryCache = new Map<string, Promise<ArrayBuffer | null>>();

export function fontBinary(family: string, weight: number, italic: boolean): Promise<ArrayBuffer | null> {
    const key = `${family}|${weight}|${italic}`;
    let cached = binaryCache.get(key);
    if (cached) return cached;
    cached = (async () => {
        const get = async (url: string) => {
            try {
                const res = await fetch(url);
                return res.ok ? await res.arrayBuffer() : null;
            } catch {
                return null;
            }
        };
        const bundled = BUNDLED[family];
        if (bundled) {
            const pick = [...bundled].sort((a, b) => Number(a[2] !== italic) - Number(b[2] !== italic) || Math.abs(a[1] - weight) - Math.abs(b[1] - weight))[0];
            return pick ? get(`${base()}fonts/${pick[0]}`) : null;
        }
        const meta = await familyMeta(family);
        if (meta?.files.length) {
            const style = italic ? "italic" : "normal";
            const variable = meta.files.find((f) => f.filename.includes("[") && f.style === style) ?? (italic ? undefined : meta.files.find((f) => f.filename.includes("[")));
            const pick =
                variable ??
                [...meta.files].sort((a, b) => Number(a.style !== style) - Number(b.style !== style) || Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
            if (pick) {
                const data = await get(`${meta.url}/${encodeURIComponent(pick.filename)}`);
                if (data) return data;
            }
        }
        // A font installed on this computer, through the Local Font Access API where the browser has it.
        const query = (globalThis as { queryLocalFonts?: () => Promise<{ family: string; style: string; blob(): Promise<Blob> }[]> }).queryLocalFonts;
        if (query) {
            try {
                const fonts = (await query()).filter((f) => f.family === family);
                const want = italic ? /italic|oblique/i : /^(?!.*(italic|oblique))/i;
                const named = WEIGHT_NAMES[Math.round(weight / 100) * 100] ?? "Regular";
                const pick = fonts.find((f) => want.test(f.style) && f.style.replace(/\s*italic/i, "").trim().toLowerCase() === named.toLowerCase()) ?? fonts.find((f) => want.test(f.style)) ?? fonts[0];
                if (pick) return await (await pick.blob()).arrayBuffer();
            } catch {
                // Permission refused.
            }
        }
        return null;
    })();
    binaryCache.set(key, cached);
    return cached;
}

const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
