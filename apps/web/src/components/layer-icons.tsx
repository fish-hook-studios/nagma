import type { SVGProps } from "react";

// A mask: a shape half filled, the way design tools mark the layer that clips the ones above it.
export function MaskIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" {...props}>
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
        </svg>
    );
}

// A component set: dashed outline around the component mark.
export function ComponentSetIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 16 16" fill="none" {...props}>
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
            <path d="M8 4.5 10 6.5 8 8.5 6 6.5zM8 8.5l2 2-2 2-2-2z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
    );
}

