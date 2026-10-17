import type { SVGProps } from "react";

// Four diamonds: a main component.
export function ComponentIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
            <path d="M12 2.5l3.2 3.2L12 8.9 8.8 5.7 12 2.5zM12 15.1l3.2 3.2-3.2 3.2-3.2-3.2 3.2-3.2zM5.7 8.8l3.2 3.2-3.2 3.2L2.5 12l3.2-3.2zM18.3 8.8l3.2 3.2-3.2 3.2-3.2-3.2 3.2-3.2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
    );
}

// One diamond: an instance of a component.
export function InstanceIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
            <path d="M12 3l9 9-9 9-9-9 9-9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
    );
}
