import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { capHeight, fontMetrics, metricsFrom, scriptOf } from "./text-layout";

// Line metrics measured per script: a font's own ascent and descent (TextMetrics
// fontBoundingBoxAscent/Descent) taken with the run's own letters, so Arabic, Hebrew, Devanagari and
// Malayalam lines sit on the baseline the font sets, not on one measured from Latin "Hg".

// A measuring context standing in for the browser's: a Latin font (ascent 0.9, descent 0.25 of the
// size) and an Arabic or Malayalam font (1.37 and 0.75, as Noto Sans Arabic has) chosen by the letters
// measured, as a browser does when a family covers the script. `fontBounds` off: an older browser
// without font metrics, which only knows how far the letters reach.
const measured: string[] = [];
let fontBounds = true;
const fake = {
    font: "",
    measureText(text: string) {
        measured.push(text);
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
        const tall = /[؀-ۿഀ-ൿ]/.test(text);
        const ink = tall ? { up: 0.72, down: 0.38 } : { up: 0.73, down: 0.21 };
        return {
            width: text.length * size * 0.5,
            fontBoundingBoxAscent: fontBounds ? (tall ? 1.37 : 0.9) * size : undefined,
            fontBoundingBoxDescent: fontBounds ? (tall ? 0.75 : 0.25) * size : undefined,
            actualBoundingBoxAscent: ink.up * size,
            actualBoundingBoxDescent: ink.down * size,
        } as unknown as TextMetrics;
    },
};

describe("text metrics per script", () => {
    beforeAll(() => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => fake) as unknown as HTMLCanvasElement["getContext"]);
    });
    afterAll(() => vi.restoreAllMocks());

    it("tells the script by the first letter outside Latin", () => {
        expect(scriptOf("Hello")).toBe("latin");
        expect(scriptOf("مرحبا")).toBe("arabic");
        expect(scriptOf("Price: 20 مرحبا")).toBe("arabic");
        expect(scriptOf("שלום")).toBe("hebrew");
        expect(scriptOf("नमस्ते")).toBe("devanagari");
        expect(scriptOf("മലയാളം")).toBe("malayalam");
        expect(scriptOf("Café ñ")).toBe("latin");
        expect(scriptOf("")).toBe("latin");
    });

    it("uses the font's own ascent and descent, measured with the script's letters", () => {
        measured.length = 0;
        const arabic = fontMetrics('400 40px "Noto Sans Arabic", system-ui, sans-serif', 40, "مرحبا بالعالم");
        expect(arabic.ascent).toBeCloseTo(54.8, 5);
        expect(arabic.descent).toBeCloseTo(30, 5);
        expect(measured.at(-1)).not.toBe("Hg");
        expect(scriptOf(measured.at(-1) ?? "")).toBe("arabic");
        const malayalam = fontMetrics('400 40px "Noto Sans Malayalam", system-ui, sans-serif', 40, "മലയാളം ഭാഷ");
        expect(scriptOf(measured.at(-1) ?? "")).toBe("malayalam");
        expect(malayalam.ascent).toBeCloseTo(54.8, 5);
        const latin = fontMetrics('400 40px "Inter", system-ui, sans-serif', 40, "Hello");
        expect(measured.at(-1)).toBe("Hg");
        expect(latin).toEqual({ ascent: 36, descent: 10 });
        // One font, two scripts: measured (and kept) apart.
        const mixed = fontMetrics('400 40px "Inter", system-ui, sans-serif', 40, "مرحبا");
        expect(mixed.ascent).not.toBe(latin.ascent);
    });

    it("without font metrics, falls back to how far the script's letters reach", () => {
        fontBounds = false;
        const m = fontMetrics('400 20px "Noto Sans Arabic Old", system-ui, sans-serif', 20, "مرحبا");
        // 0.72 and 0.38 of the size, with a little room; never under 0.8 and 0.2 of the size.
        expect(m.ascent).toBeCloseTo(16, 5);
        expect(m.descent).toBeCloseTo(0.38 * 20 * 1.15, 5);
        fontBounds = true;
        expect(metricsFrom(null, 10)).toEqual({ ascent: 8, descent: 2 });
        const ink = metricsFrom({ fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 0, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }, 10);
        expect(ink.ascent).toBeCloseTo(13.2, 9);
        expect(ink.descent).toBeCloseTo(4.6, 9);
        expect(metricsFrom({ fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3 }, 10)).toEqual({ ascent: 11, descent: 3 });
    });

    it("measures the trim line with the script's own tall letter", () => {
        measured.length = 0;
        capHeight('400 40px "Noto Sans Arabic", system-ui, sans-serif', 40, "مرحبا");
        expect(measured.at(-1)).toBe("ا");
        capHeight('400 40px "Inter", system-ui, sans-serif', 40, "Hello");
        expect(measured.at(-1)).toBe("H");
    });
});
