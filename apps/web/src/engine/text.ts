import type { SceneNode, TextCase } from "./types";
import { DEFAULT_FAMILY } from "./fonts";
import { AUTO_LINE_HEIGHT, casedText as layoutCasedText, clearLayoutCache, fontString as layoutFontString, layoutText, measureWidth } from "./text-layout";

export { DEFAULT_FAMILY } from "./fonts";
export { AUTO_LINE_HEIGHT } from "./text-layout";
export const LINE_HEIGHT = AUTO_LINE_HEIGHT;
export const FONT_FAMILY = `${DEFAULT_FAMILY}, system-ui, sans-serif`;

// Fonts offered in the picker, loaded from Google Fonts when first used.
export const FONT_FAMILIES = [
    "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "DM Sans", "Manrope", "Space Grotesk", "Plus Jakarta Sans",
    "Nunito", "Nunito Sans", "Raleway", "Work Sans", "Rubik", "Karla", "Outfit", "Figtree", "Sora", "Urbanist", "Lexend", "Mulish",
    "Oswald", "Bebas Neue", "Anton", "Archivo", "Barlow", "Josefin Sans", "Quicksand", "Comfortaa", "Fredoka", "Pacifico", "Caveat",
    "Dancing Script", "Lobster", "Playfair Display", "Merriweather", "Lora", "EB Garamond", "Cormorant Garamond", "Libre Baskerville",
    "Crimson Pro", "Noto Serif", "Source Serif 4", "Source Sans 3", "Noto Sans", "PT Sans", "PT Serif", "Fira Sans", "Fira Code",
    "JetBrains Mono", "IBM Plex Mono", "IBM Plex Sans", "Roboto Mono", "Space Mono", "DM Mono", "Inconsolata", "Courier Prime",
];

export function fontString(size: number, weight: number, family = DEFAULT_FAMILY, italic = false) {
    return layoutFontString(size, weight, family, italic);
}

export interface TextStyle {
    text: string;
    size: number;
    weight: number;
    family: string;
    italic: boolean;
    lineHeight: number;
    // In pixels.
    tracking: number;
    list?: "bullet" | "number" | null;
    direction?: "ltr" | "rtl";
    textCase?: TextCase;
    maxLines?: number | null;
    paragraphSpacing?: number;
    paragraphIndent?: number;
}

export const casedText = layoutCasedText;

export function styleOf(node: SceneNode): TextStyle {
    const size = node.fontSize ?? 16;
    return {
        text: node.text ?? "",
        size,
        weight: node.fontWeight ?? 400,
        family: node.fontFamily ?? DEFAULT_FAMILY,
        italic: node.italic ?? false,
        lineHeight: (node.lineHeight ?? AUTO_LINE_HEIGHT) * size,
        tracking: ((node.letterSpacing ?? 0) / 100) * size,
        list: node.list ?? null,
        direction: node.direction ?? "ltr",
        textCase: node.textCase ?? "none",
        maxLines: node.truncate === false ? null : (node.maxLines ?? null),
        paragraphSpacing: node.paragraphSpacing ?? 0,
        paragraphIndent: node.paragraphIndent ?? 0,
    };
}

// Clears measurements after a web font loads, so text is measured again.
export function clearTextCache() {
    clearLayoutCache();
}

// Whether a text layer wraps: anything but auto width ("hug" horizontally) wraps at its width.
export function wraps(node: SceneNode): boolean {
    return node.sizing.h !== "hug";
}

// The size a text layer should have for its resize mode: auto width hugs both ways,
// auto height keeps the width and hugs the height, fixed keeps both.
export function textSize(node: SceneNode): { w: number; h: number } {
    const layout = layoutText(node);
    const width = Math.max(1, Math.ceil(layout.lines.reduce((w, l) => Math.max(w, l.left + l.width), 0)));
    const height = Math.max(1, Math.ceil(layout.height));
    return {
        w: node.sizing.h === "hug" ? width : node.w,
        h: node.sizing.v === "hug" ? height : node.h,
    };
}

// Kept for callers that size plain Inter text before a layer exists.
export function measureText(text: string, size: number, weight: number) {
    const lines = text.split("\n");
    const font = fontString(size, weight);
    return { w: Math.max(1, Math.ceil(Math.max(0, ...lines.map((l) => measureWidth(font, 0, "normal", l))))), h: Math.ceil(lines.length * size * AUTO_LINE_HEIGHT) };
}

export { ensureFont } from "./fonts";
