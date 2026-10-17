import type { SVGProps } from "react";

// The Document workbench's own tool icons, drawn in the icon set's line style.

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function FormIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <rect x="3" y="3.5" width="14" height="4" rx="1" />
            <rect x="3" y="11" width="14" height="4" rx="1" />
            <path d="M5.5 5.5h4M5.5 13h2.5" />
        </svg>
    );
}

export function HighlightIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <path d="m11.5 3.5 4 4-6.5 6.5H5v-4z" />
            <path d="M3 17h14" strokeWidth={2.2} />
        </svg>
    );
}

export function StampIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <path d="M7.5 9.5c0-1.2-1-2-1-3.5a3.5 3.5 0 0 1 7 0c0 1.5-1 2.3-1 3.5v1h-5z" />
            <rect x="3.5" y="10.5" width="13" height="3.5" rx="1" />
            <path d="M4.5 17h11" />
        </svg>
    );
}

export function SignIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <path d="M3 14c2-4 3.5-8 5-8s-1 7 1 7 2.5-3 3.5-3 0 3 1.5 3 1.5-1 2-1.5" />
            <path d="M3 17h14" />
        </svg>
    );
}

export function RedactIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <rect x="3" y="4" width="14" height="3.5" rx="0.8" fill="currentColor" />
            <path d="M3 11h9M3 14.5h14" />
        </svg>
    );
}

export function FillSignIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <path d="M4 16V4h8l4 4v3" />
            <path d="M12 4v4h4" />
            <path d="m10.5 16.5 5-5 1.5 1.5-5 5h-1.5z" />
        </svg>
    );
}

export function ShapesIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <rect x="3" y="3" width="8" height="8" rx="1" />
            <circle cx="13" cy="13" r="4" />
        </svg>
    );
}

export function EditContentIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <path d="M3 4.5h8M3 8h6M3 11.5h4" />
            <path d="m10 16.5 6-6 1.5 1.5-6 6H10z" />
        </svg>
    );
}

export function CompressIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <path d="M10 2.5v5m0 0L7.5 5M10 7.5 12.5 5M10 17.5v-5m0 0L7.5 15m2.5-2.5 2.5 2.5" />
            <path d="M3.5 10h13" />
        </svg>
    );
}

export function NoteIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <path d="M4 4h12v9l-4 4H4z" />
            <path d="M12 17v-4h4M7 8h6M7 11h3" />
        </svg>
    );
}

export function TextBoxIcon(props: P) {
    return (
        <svg {...base} {...props}>
            <rect x="2.5" y="4" width="15" height="12" rx="1" strokeDasharray="2.5 2" />
            <path d="M7 8h6M10 8v5" />
        </svg>
    );
}
