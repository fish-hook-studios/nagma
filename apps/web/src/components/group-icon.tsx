import type { SVGProps } from "react";

// A dashed square, the usual mark for a group of layers.
export function GroupIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
        </svg>
    );
}
