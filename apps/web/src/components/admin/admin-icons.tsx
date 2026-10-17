import type { SVGProps } from "react";

// Line icons for the admin console's sidebar that the icon set doesn't have, drawn to match it
// (24-unit grid, 2-unit stroke, round joins).

export function AiCreditsIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 7.5c.4 2.6 1.9 4.1 4.5 4.5-2.6.4-4.1 1.9-4.5 4.5-.4-2.6-1.9-4.1-4.5-4.5 2.6-.4 4.1-1.9 4.5-4.5Z" />
        </svg>
    );
}

export function RegistryIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...props}>
            <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
            <path d="M8.5 20.5V8.5h7v12M12 8.5v12" />
        </svg>
    );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
            <path d="M7 3v5.5M7 14.5V21M17 3v6.5M17 15.5V21" />
            <circle cx="7" cy="11.5" r="3" />
            <circle cx="17" cy="12.5" r="3" />
        </svg>
    );
}

export function DashedCircleIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2.6 3" {...props}>
            <circle cx="12" cy="12" r="9" />
        </svg>
    );
}
