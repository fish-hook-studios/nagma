import type { ConnectorCap, ShapeKind } from "./types";
import { ICON_SHAPES, iconSubpaths, shapePath } from "./model";

// Drawn for the board's toolbar: a marker standing in its tray, a stack of stickies, a cluster of
// shapes, and small outlines of each shape for the trays and the Shapes panel.

export function MarkerArt({ color = "#1E1E1E", active }: { color?: string; active?: boolean }) {
    return (
        <svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true" style={{ transform: active ? "translateY(-6px)" : undefined, transition: "transform 120ms" }}>
            <rect x="9" y="12" width="16" height="30" rx="3" fill="#FFFFFF" stroke="#D0D0D0" />
            <rect x="9" y="30" width="16" height="6" fill={color} />
            <path d="M12 12 L14 4 Q17 1 20 4 L22 12 Z" fill="#E8E8E8" stroke="#D0D0D0" />
            <path d="M15 5 Q17 2.5 19 5 L18.4 7 L15.6 7 Z" fill={color} />
        </svg>
    );
}

export function StickyStackArt({ color = "#FFE299", active }: { color?: string; active?: boolean }) {
    return (
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" style={{ transform: active ? "translateY(-4px)" : undefined, transition: "transform 120ms" }}>
            <rect x="9" y="9" width="26" height="26" rx="2" fill={color} opacity="0.55" transform="rotate(6 22 22)" />
            <rect x="7" y="7" width="26" height="26" rx="2" fill={color} />
            <path d="M7 29 L7 31 Q7 33 9 33 L33 33 L33 31" fill="rgba(0,0,0,0.08)" />
        </svg>
    );
}

export function ShapesArt({ color = "#0D99FF" }: { color?: string }) {
    return (
        <svg width="44" height="36" viewBox="0 0 44 36" aria-hidden="true">
            <rect x="3" y="12" width="16" height="16" rx="2" fill={color} opacity="0.9" />
            <circle cx="32" cy="20" r="9" fill="#14AE5C" opacity="0.9" />
            <path d="M11 9 L22 4" stroke="#1E1E1E" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M19.5 3 L23 3.6 L21 6.6 Z" fill="#1E1E1E" />
        </svg>
    );
}

export function ShapeGlyph({ shape, size = 20, fill = "none", stroke = "currentColor" }: { shape: ShapeKind; size?: number; fill?: string; stroke?: string }) {
    const inner = size - 4;
    const path = ICON_SHAPES.includes(shape) ? { w: inner, h: inner, subpaths: iconSubpaths(shape, 0, 0, inner) } : shapePath(shape, inner, shape === "parallelogram" || shape === "rounded" || shape === "ellipse" ? inner * 0.7 : inner);
    const d = path.subpaths
        .map((sp) => {
            const pts = sp.points;
            if (!pts.length) return "";
            let s = `M${pts[0]?.x} ${pts[0]?.y}`;
            const seg = (a: (typeof pts)[number], b: (typeof pts)[number]) => (a.out || b.in ? ` C${(a.out ?? a).x} ${(a.out ?? a).y} ${(b.in ?? b).x} ${(b.in ?? b).y} ${b.x} ${b.y}` : ` L${b.x} ${b.y}`);
            for (let i = 1; i < pts.length; i++) s += seg(pts[i - 1] as (typeof pts)[number], pts[i] as (typeof pts)[number]);
            if (sp.closed) s += `${seg(pts[pts.length - 1] as (typeof pts)[number], pts[0] as (typeof pts)[number])} Z`;
            return s;
        })
        .join(" ");
    return (
        <svg width={size} height={size} viewBox={`-2 -2 ${size} ${size}`} aria-hidden="true">
            <g transform={`translate(0 ${(inner - path.h) / 2})`}>
                <path d={d} fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
            </g>
        </svg>
    );
}

export function ConnectorGlyph({ line }: { line: "elbow" | "curved" | "straight" | "plain" }) {
    const d = line === "elbow" ? "M3 17 L10 17 L10 4 L16 4" : line === "curved" ? "M3 17 C10 17 9 4 16 4" : "M3 17 L16 4";
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            {line !== "plain" && <path d={line === "straight" ? "M17.5 2.5 L12.5 4 L16 7.5 Z" : "M18 4 L14 1.5 L14 6.5 Z"} fill="currentColor" />}
        </svg>
    );
}

export function SectionGlyph() {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3" y="6" width="14" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="3" y="2.5" width="7" height="3" rx="1" fill="currentColor" />
        </svg>
    );
}

export function WashiGlyph({ color = "#FF8FB1" }: { color?: string }) {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M2 7 L18 4 L19 9 L3 12 Z" fill={color} />
            <circle cx="7" cy="8.6" r="1" fill="#fff" />
            <circle cx="12" cy="7.6" r="1" fill="#fff" />
        </svg>
    );
}

export function HighlighterGlyph({ color = "#FFCD29" }: { color?: string }) {
    return (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 16 L8 12 L12 16 Z" fill={color} />
            <path d="M8 12 L14 3 L17 6 L12 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    );
}

// A connector end for the end pickers: a short line ending (on the right) in the cap.
export function CapGlyph({ cap }: { cap: ConnectorCap }) {
    const bar = (x: number) => `M${x} 5 V15`;
    const fork = "M30 5 L22 10 L30 15";
    const ring = (cx: number) => <circle cx={cx} cy="10" r="2.6" fill="#2C2C2C" />;
    const marks: Record<ConnectorCap, { d?: string; fill?: string; ring?: number; end?: number }> = {
        none: { end: 30 },
        arrow: { d: "M30 10 L23 6 L23 14 Z", fill: "currentColor", end: 24 },
        "line-arrow": { d: "M23 5.5 L30 10 L23 14.5", end: 30 },
        triangle: { d: "M23 10 L30 6 L30 14 Z", fill: "currentColor", end: 24 },
        diamond: { d: "M30 10 L26 7 L22 10 L26 13 Z", fill: "currentColor", end: 22 },
        circle: { d: "M30 10 a3 3 0 1 1 -6 0 a3 3 0 1 1 6 0", fill: "currentColor", end: 24 },
        "erd-one": { d: bar(25), end: 30 },
        "erd-only-one": { d: `${bar(26)} ${bar(22)}`, end: 30 },
        "erd-many": { d: fork, end: 30 },
        "erd-one-or-many": { d: `${fork} ${bar(19)}`, end: 30 },
        "erd-zero-or-one": { d: bar(26), ring: 19, end: 30 },
        "erd-zero-or-many": { d: fork, ring: 17, end: 30 },
    };
    const m = marks[cap];
    return (
        <svg width="32" height="20" viewBox="0 0 32 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <path d={`M2 10 H${m.end ?? 30}`} />
            {m.d && <path d={m.d} fill={m.fill ?? "none"} />}
            {m.ring !== undefined && ring(m.ring)}
        </svg>
    );
}
