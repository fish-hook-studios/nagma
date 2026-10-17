// Colour notation conversions for the picker: hex, RGB, HSL and HSB (HSV).

export interface RGB {
    r: number;
    g: number;
    b: number;
}
export interface HSV {
    h: number;
    s: number;
    v: number;
}
export interface HSL {
    h: number;
    s: number;
    l: number;
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function hexToRgb(hex: string): RGB {
    let h = hex.replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = Number.parseInt(h.slice(0, 6).padEnd(6, "0"), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
    const to = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const d = max - min;
    let h = 0;
    if (d > 0) {
        if (max === rr) h = ((gg - bb) / d) % 6;
        else if (max === gg) h = (bb - rr) / d + 2;
        else h = (rr - gg) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: ((r ?? 0) + m) * 255, g: ((g ?? 0) + m) * 255, b: ((b ?? 0) + m) * 255 };
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
    const { h, s, v } = rgbToHsv({ r, g, b });
    const l = v * (1 - s / 2);
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
    return { h, s: sl, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
    const v = l + s * Math.min(l, 1 - l);
    const sv = v === 0 ? 0 : 2 * (1 - l / v);
    return hsvToRgb({ h, s: sv, v });
}

export function isHex(text: string): boolean {
    return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.trim());
}

export function normalizeHex(text: string): string {
    return rgbToHex(hexToRgb(text));
}

// Contrast ratio (WCAG) between two hex colours.
export function contrastRatio(a: string, b: string): number {
    const lum = (hex: string) => {
        const { r, g, b: bb } = hexToRgb(hex);
        const f = (c: number) => {
            const x = c / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bb);
    };
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
