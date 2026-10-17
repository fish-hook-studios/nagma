// Time and colour text for the video editor's panels.

export function timecode(t: number, fps: number): string {
    const f = Math.max(1, Math.round(fps));
    const total = Math.max(0, Math.round(t * f));
    const frames = total % f;
    const secs = Math.floor(total / f);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}:${pad(frames)}`;
}

export function shortTime(t: number): string {
    if (t < 60) return `${(Math.round(t * 10) / 10).toFixed(1)}s`;
    const m = Math.floor(t / 60);
    return `${m}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

// "#RRGGBBAA" and "#RRGGBB" strings for colour swatches.
export function splitColor(value: string): { color: string; opacity: number } {
    const hex = value.replace("#", "");
    const color = `#${hex.slice(0, 6).padEnd(6, "0")}`.toUpperCase();
    const opacity = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { color, opacity: Number.isNaN(opacity) ? 1 : opacity };
}

export function joinColor(color: string, opacity: number): string {
    const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
    return a >= 255 ? color.toUpperCase() : `${color.toUpperCase()}${a.toString(16).padStart(2, "0").toUpperCase()}`;
}

export const FIELD = "h-7 min-w-0 rounded-md border border-transparent bg-field px-1.5 text-ink outline-none hover:border-panel-border focus:border-brand-500";
