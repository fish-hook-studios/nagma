// Animated stickers for comments: small looping SVGs drawn here (no outside service needed). When the
// server has a GIF provider key, the picker searches GIFs too (server: /gifs/search).
import { authHeaders } from "./auth";
import { httpBase } from "./server-url";

export interface Sticker {
    id: string;
    name: string;
    svg: string;
}

const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">${body}</svg>`;
// A glyph that does something on a loop: bob, pulse, spin, wiggle.
const glyph = (char: string, anim: string) => `<g transform="translate(60 64)"><g>${anim}<text text-anchor="middle" dominant-baseline="central" font-size="64" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${char}</text></g></g>`;
const bob = `<animateTransform attributeName="transform" type="translate" values="0 6;0 -8;0 6" dur="0.9s" repeatCount="indefinite"/>`;
const pulse = `<animateTransform attributeName="transform" type="scale" values="1;1.18;1;1.1;1" dur="1.1s" repeatCount="indefinite"/>`;
const spin = `<animateTransform attributeName="transform" type="rotate" values="0;360" dur="2.4s" repeatCount="indefinite"/>`;
const wiggle = `<animateTransform attributeName="transform" type="rotate" values="-14;14;-14" dur="0.6s" repeatCount="indefinite"/>`;

// Confetti bits falling behind a glyph.
const confetti = Array.from({ length: 10 }, (_, i) => {
    const x = 12 + ((i * 37) % 96);
    const colors = ["#F24822", "#FFA629", "#FFCD29", "#14AE5C", "#0D99FF", "#9747FF", "#FF24BD"];
    return `<rect x="${x}" y="-10" width="6" height="10" rx="1.5" fill="${colors[i % colors.length]}"><animateTransform attributeName="transform" type="translate" values="0 0;${(i % 3) * 6 - 6} 140" dur="${1.2 + (i % 4) * 0.25}s" begin="${(i * 0.13).toFixed(2)}s" repeatCount="indefinite"/></rect>`;
}).join("");

// A check mark that draws itself.
const check = `<circle cx="60" cy="60" r="44" fill="#14AE5C"><animate attributeName="r" values="40;46;44" dur="1.6s" repeatCount="indefinite"/></circle><path d="M38 62 L54 77 L84 45" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="70" stroke-dashoffset="70"><animate attributeName="stroke-dashoffset" values="70;0;0" keyTimes="0;0.5;1" dur="1.6s" repeatCount="indefinite"/></path>`;

// Sparkles that twinkle in turn.
const sparkle = [
    [60, 54, 30, 0],
    [28, 30, 14, 0.3],
    [92, 86, 16, 0.6],
]
    .map(([x, y, r, d]) => `<path d="M${x} ${(y as number) - (r as number)} Q${x} ${y} ${(x as number) + (r as number)} ${y} Q${x} ${y} ${x} ${(y as number) + (r as number)} Q${x} ${y} ${(x as number) - (r as number)} ${y} Q${x} ${y} ${x} ${(y as number) - (r as number)}Z" fill="#FFCD29"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" begin="${d}s" repeatCount="indefinite"/></path>`)
    .join("");

// A speech bubble whose dots type.
const typing = `<rect x="14" y="30" width="92" height="56" rx="28" fill="#0D99FF"/><path d="M34 82 L28 100 L50 84Z" fill="#0D99FF"/>${[40, 60, 80].map((x, i) => `<circle cx="${x}" cy="58" r="7" fill="#fff"><animate attributeName="cy" values="58;50;58" dur="0.9s" begin="${i * 0.15}s" repeatCount="indefinite"/></circle>`).join("")}`;

export const STICKERS: Sticker[] = [
    { id: "thumbs", name: "Thumbs up", svg: wrap(glyph("👍", bob)) },
    { id: "heart", name: "Heart", svg: wrap(glyph("❤️", pulse)) },
    { id: "party", name: "Party", svg: wrap(confetti + glyph("🎉", wiggle)) },
    { id: "check", name: "Done", svg: wrap(check) },
    { id: "fire", name: "Fire", svg: wrap(glyph("🔥", pulse)) },
    { id: "clap", name: "Clap", svg: wrap(glyph("👏", wiggle)) },
    { id: "wave", name: "Wave", svg: wrap(glyph("👋", wiggle)) },
    { id: "eyes", name: "Looking", svg: wrap(glyph("👀", bob)) },
    { id: "rocket", name: "Ship it", svg: wrap(glyph("🚀", bob)) },
    { id: "star", name: "Star", svg: wrap(glyph("⭐", spin)) },
    { id: "sparkle", name: "Sparkle", svg: wrap(sparkle) },
    { id: "typing", name: "Thinking", svg: wrap(typing) },
];

export const stickerUrl = (s: Sticker) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;

export interface Gif {
    id: string;
    title: string;
    url: string;
    preview: string;
    w: number;
    h: number;
}

// GIF search through the server's provider key. null: the server has no key (stickers only).
export async function searchGifs(query: string): Promise<Gif[] | null> {
    try {
        const res = await fetch(`${httpBase()}/gifs/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
        if (res.status === 501 || res.status === 404) return null;
        if (!res.ok) return [];
        return (await res.json()) as Gif[];
    } catch {
        return null;
    }
}

// The file to attach for a sticker or a GIF.
export async function stickerFile(s: Sticker): Promise<File> {
    return new File([s.svg], `${s.id}.svg`, { type: "image/svg+xml" });
}

export async function gifFile(g: Gif): Promise<File> {
    const res = await fetch(g.url);
    const blob = await res.blob();
    return new File([blob], `${g.title || "gif"}.gif`.slice(0, 100), { type: blob.type || "image/gif" });
}
